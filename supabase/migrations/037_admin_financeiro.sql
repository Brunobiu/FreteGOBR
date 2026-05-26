-- ============================================================================
-- Migration 037: Admin Financeiro - Comissao, Repasses, Storage
-- ============================================================================
-- Adiciona o modulo Financeiro do painel administrativo sobre as fundacoes:
--   - 030 admin_foundation        (is_admin_with_permission, executeAdminMutation,
--                                  admin_audit_logs)
--   - 031 admin_users             (padrao de versionamento otimista)
--   - 032 admin_fretes            (padrao _SKIPPED, fretes.status='encerrado')
--   - 033 embarcador_branch       (referenciada, nao-dependencia direta)
--   - 034 admin_notify_user       (nao-dependencia)
--   - 035 admin_blacklist         (padrao de bucket privado)
--   - 036 admin_dashboard         (padrao de RPC STABLE agregadora)
--
-- OBJETIVO:
--   Modulo Financeiro = settings com snapshot historico de comissao
--   + repasses 1:1 com fretes encerrados (snapshot imutavel da comissao
--   no momento do encerramento) + bucket privado de comprovantes de
--   pagamento.
--
-- ESTA MIGRATION ENTREGA (Fase 1 do tasks.md -- completa):
--   - Tabela financial_settings (snapshot historico de regras)
--   - Tabela financial_repasses (1:1 com fretes encerrados)
--   - Funcao SQL pura IMMUTABLE compute_commission_value(numeric, jsonb)
--   - Trigger AFTER UPDATE em fretes: on_frete_close_create_repasse
--   - RPC admin_financeiro_settings_get      (STABLE,  FINANCEIRO_VIEW)
--   - RPC admin_financeiro_settings_update   (         FINANCEIRO_EDIT)
--   - RPC admin_repasse_mark_paid            (         FINANCEIRO_EDIT, idempotente CP-2)
--   - RPC admin_repasse_estornar             (         FINANCEIRO_EDIT, idempotente)
--   - RPC admin_repasses_list                (STABLE,  FINANCEIRO_VIEW)
--   - RPC admin_financeiro_summary           (STABLE,  FINANCEIRO_VIEW)
--   - Bucket privado financial_proofs + 4 policies
--     (SELECT: FINANCEIRO_VIEW, INSERT/UPDATE: FINANCEIRO_EDIT, DELETE: false)
--   - Bloco -- VERIFY pos-deploy comentado (smoke test manual)
--
-- IDEMPOTENTE: aplicar 2x nao falha nem duplica objetos
--   (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--    DROP POLICY IF EXISTS antes de CREATE POLICY,
--    INSERT INTO storage.buckets ... ON CONFLICT DO NOTHING).
--
-- ROLLBACK: 037_admin_financeiro_rollback.sql (nao auto-aplicado).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Validacoes defensivas (ver admin-patterns.md Sec. 9)
-- ============================================================================

-- 1.1 - Migration 030 (admin-foundation) aplicada: is_admin_with_permission existe.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;
END
$check$;

-- 1.2 - admin_audit_logs existe (migration 030) com a coluna after_data
--       usada por todos os action codes financeiros (FINANCIAL_*).
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admin_audit_logs'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;
END
$check$;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_audit_logs'
      AND column_name = 'after_data'
  ) THEN
    RAISE EXCEPTION 'admin_audit_logs.after_data ausente -- schema inesperado';
  END IF;
END
$check$;

-- 1.3 - fretes existe com colunas usadas pelo trigger (status, value, embarcador_id).
--       NB: o schema atual (001_initial_schema.sql) usa fretes.value (DECIMAL(10,2))
--       como valor monetario do frete. NAO ha coluna valor_frete -- a referencia
--       feita no tasks.md a "valor_frete ou equivalente" resolve para fretes.value.
--       Toda a migration usa fretes.value consistentemente.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fretes' AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'fretes.status ausente -- schema inesperado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fretes' AND column_name = 'value'
  ) THEN
    RAISE EXCEPTION 'fretes.value ausente -- schema inesperado (esperado DECIMAL/numeric do valor monetario do frete)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fretes' AND column_name = 'embarcador_id'
  ) THEN
    RAISE EXCEPTION 'fretes.embarcador_id ausente -- schema inesperado';
  END IF;
END
$check$;

-- 1.4 - users existe (referenciada por updated_by, paid_by, reverted_by, embarcador_id, motorista_id).
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'users ausente -- schema inesperado';
  END IF;
END
$check$;

-- 1.5 - storage.buckets / storage.objects acessiveis
--       (Supabase Storage instalado). Necessario para o bucket
--       financial_proofs e suas 4 policies (criados em subtask 1.12).
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    RAISE EXCEPTION 'storage.buckets ausente -- Supabase Storage nao instalado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    RAISE EXCEPTION 'storage.objects ausente -- Supabase Storage nao instalado';
  END IF;
END
$check$;


-- ============================================================================
-- 2. Tabela financial_settings + RLS no_dml + indice
-- ============================================================================
-- Snapshot historico de regras de comissao. Cada UPDATE da config (via RPC
-- admin_financeiro_settings_update) faz, na pratica, um INSERT de nova linha
-- preservando o historico completo. NUNCA atualizamos linha existente; a
-- "Vigent_Settings" e resolvida por:
--   SELECT * FROM financial_settings ORDER BY effective_from DESC LIMIT 1
-- O indice idx_financial_settings_effective_from (DESC) suporta essa query.
--
-- A coluna updated_at e mantida no schema mesmo neste modelo append-only para:
--   (a) preservar o padrao de versionamento otimista herdado do projeto
--       (admin-patterns.md Sec. 3) -- a UI le updated_at antes de abrir o modal
--       de edicao e envia de volta para a RPC, que compara com a ultima linha;
--   (b) registrar o instante exato em que a linha-snapshot foi criada.
--
-- RLS: bloqueio total de DML direto via policy financial_settings_no_dml.
-- Toda interacao acontece atraves das RPCs SECURITY DEFINER (subtasks 1.6, 1.7),
-- que bypassam RLS por design (mesmo padrao de admin_blacklist em 035).

CREATE TABLE IF NOT EXISTS financial_settings (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_pct        numeric(5,2)  NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 50),
  commission_brackets   jsonb         NOT NULL DEFAULT '[]'::jsonb,
  effective_from        timestamptz   NOT NULL DEFAULT NOW(),
  updated_at            timestamptz   NOT NULL DEFAULT NOW(),
  updated_by            uuid          NULL REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_financial_settings_brackets_is_array
    CHECK (jsonb_typeof(commission_brackets) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_financial_settings_effective_from
  ON financial_settings (effective_from DESC);

ALTER TABLE financial_settings ENABLE ROW LEVEL SECURITY;

-- Policy: bloqueia 100% de DML pelo role authenticated. Acesso exclusivo via
-- RPCs SECURITY DEFINER (admin_financeiro_settings_get / _update). Mesmo
-- padrao adotado em admin_blacklist (035) e dashboard_views (036).
DROP POLICY IF EXISTS financial_settings_no_dml ON financial_settings;
CREATE POLICY financial_settings_no_dml
  ON financial_settings FOR ALL
  USING (false) WITH CHECK (false);

COMMENT ON TABLE  financial_settings              IS 'Snapshot historico de regras de comissao. Cada UPDATE da config gera nova linha (admin-financeiro 037).';
COMMENT ON COLUMN financial_settings.commission_pct      IS 'Percentual flat aplicado quando nenhum bracket cobre o valor do frete. 0..50%.';
COMMENT ON COLUMN financial_settings.commission_brackets IS 'Array jsonb [{min_value:number, max_value:number, pct:number}] ordenado por min_value ASC, sem buracos, sem sobreposicao, max 5 entradas. [] = sem brackets (so flat).';
COMMENT ON COLUMN financial_settings.effective_from      IS 'Quando a regra passa a valer. Trigger resolve Vigent_Settings = max(effective_from <= NOW()) ORDER BY effective_from DESC LIMIT 1.';
COMMENT ON COLUMN financial_settings.updated_at          IS 'Instante de criacao da linha-snapshot. Usado para versionamento otimista pelas RPCs (admin-patterns.md Sec. 3).';
COMMENT ON COLUMN financial_settings.updated_by          IS 'Admin que criou esta linha-snapshot (FK users.id, ON DELETE SET NULL para preservar o historico mesmo se a conta for removida).';


-- ============================================================================
-- 3. Tabela financial_repasses + constraints de coerencia + indices + RLS no_dml
-- ============================================================================
-- 1 linha por frete encerrado, snapshot IMUTAVEL da comissao no momento do
-- encerramento. NUNCA recalcula se as financial_settings mudarem depois -- a
-- aplicacao de mudancas de regra e estritamente prospectiva. As colunas
-- commission_pct, commission_value e valor_liquido sao congeladas pelo trigger
-- on_frete_close_create_repasse (subtask 1.5) usando a Vigent_Settings vigente
-- naquele instante.
--
-- 1:1 com fretes encerrados via UNIQUE em frete_id -- o trigger usa
-- ON CONFLICT (frete_id) DO NOTHING para ser idempotente em re-encerramento.
--
-- Defesa em profundidade -- as 3 constraints abaixo bloqueiam estados
-- inconsistentes mesmo se um dia houver bypass do path normal (hot-fix manual,
-- restore parcial, etc.). As RPCs ja validam, mas a tabela e a ultima linha
-- de defesa.
--
-- RLS: bloqueio total de DML direto via policy financial_repasses_no_dml.
-- Toda interacao acontece atraves das RPCs SECURITY DEFINER (subtasks 1.8,
-- 1.9, 1.10, 1.11), que bypassam RLS por design. Mesmo padrao herdado de
-- financial_settings (acima) e admin_blacklist (035).

CREATE TABLE IF NOT EXISTS financial_repasses (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id              uuid          NOT NULL UNIQUE REFERENCES fretes(id) ON DELETE RESTRICT,
  embarcador_id         uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  motorista_id          uuid          NULL REFERENCES users(id) ON DELETE SET NULL,
  valor_bruto           numeric(12,2) NOT NULL CHECK (valor_bruto >= 0),
  commission_pct        numeric(5,2)  NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 50),
  commission_value      numeric(12,2) NOT NULL CHECK (commission_value >= 0),
  valor_liquido         numeric(12,2) NOT NULL CHECK (valor_liquido >= 0),
  status                text          NOT NULL DEFAULT 'pendente'
                                       CHECK (status IN ('pendente','pago','estornado')),
  closed_at             timestamptz   NOT NULL,
  paid_at               timestamptz   NULL,
  paid_by               uuid          NULL REFERENCES users(id) ON DELETE SET NULL,
  payment_method        text          NULL
                                       CHECK (payment_method IS NULL
                                              OR payment_method IN ('pix','ted','boleto','dinheiro','outro')),
  payment_proof_url     text          NULL CHECK (payment_proof_url IS NULL OR char_length(payment_proof_url) <= 500),
  notes                 text          NULL CHECK (notes IS NULL OR char_length(notes) <= 1000),
  reverted_at           timestamptz   NULL,
  reverted_by           uuid          NULL REFERENCES users(id) ON DELETE SET NULL,
  revert_reason         text          NULL CHECK (revert_reason IS NULL
                                                  OR (char_length(revert_reason) >= 1 AND char_length(revert_reason) <= 500)),
  created_at            timestamptz   NOT NULL DEFAULT NOW(),
  updated_at            timestamptz   NOT NULL DEFAULT NOW(),

  -- Coerencia de estado:
  --   pago      => tem paid_at + paid_by + payment_method
  --   estornado => tem paid_at + paid_by + payment_method (preserva snapshot do pagamento)
  --                + reverted_at + reverted_by + revert_reason
  --   pendente  => nada de paid_*, reverted_*, payment_method, payment_proof_url, notes
  CONSTRAINT chk_financial_repasses_paid_consistency CHECK (
    (status <> 'pago' AND status <> 'estornado')
    OR (status = 'pago'      AND paid_at IS NOT NULL AND paid_by IS NOT NULL AND payment_method IS NOT NULL)
    OR (status = 'estornado' AND paid_at IS NOT NULL AND paid_by IS NOT NULL AND payment_method IS NOT NULL
                             AND reverted_at IS NOT NULL AND reverted_by IS NOT NULL AND revert_reason IS NOT NULL)
  ),

  CONSTRAINT chk_financial_repasses_pendente_clean CHECK (
    status <> 'pendente'
    OR (paid_at IS NULL AND paid_by IS NULL AND payment_method IS NULL
        AND payment_proof_url IS NULL AND notes IS NULL
        AND reverted_at IS NULL AND reverted_by IS NULL AND revert_reason IS NULL)
  ),

  CONSTRAINT chk_financial_repasses_arithmetic CHECK (
    valor_liquido = valor_bruto - commission_value
  )
);

-- Indice principal de listagem por status + ordenacao por data de fechamento
-- desc (usado por admin_repasses_list quando period_kind = 'fechamento').
CREATE INDEX IF NOT EXISTS idx_financial_repasses_status_closed_at
  ON financial_repasses (status, closed_at DESC);

-- Filtros por embarcador (cliente) cruzados com status. Usado por
-- admin_repasses_list e por admin_financeiro_summary.top_embarcador_devedor.
CREATE INDEX IF NOT EXISTS idx_financial_repasses_embarcador_status
  ON financial_repasses (embarcador_id, status);

-- Filtros por motorista cruzados com status. Indice parcial -- ignora linhas
-- com motorista_id NULL (frete encerrado sem motorista vinculado e legitimo).
CREATE INDEX IF NOT EXISTS idx_financial_repasses_motorista_status
  ON financial_repasses (motorista_id, status) WHERE motorista_id IS NOT NULL;

-- Indice parcial para ordenacao por data de pagamento desc quando o usuario
-- escolhe period_kind = 'pagamento'. So existe linha relevante quando status
-- = 'pago' (e estornados preservam paid_at, mas a busca de "pagamentos
-- recentes" foca em pagos efetivos).
CREATE INDEX IF NOT EXISTS idx_financial_repasses_paid_at
  ON financial_repasses (paid_at DESC) WHERE status = 'pago';

ALTER TABLE financial_repasses ENABLE ROW LEVEL SECURITY;

-- Policy: bloqueia 100% de DML pelo role authenticated. Acesso exclusivo via
-- trigger (INSERT pelo on_frete_close_create_repasse, SECURITY DEFINER) e
-- pelas RPCs SECURITY DEFINER (admin_repasse_mark_paid / _estornar /
-- admin_repasses_list). Mesmo padrao adotado em financial_settings (acima),
-- admin_blacklist (035) e dashboard_views (036).
DROP POLICY IF EXISTS financial_repasses_no_dml ON financial_repasses;
CREATE POLICY financial_repasses_no_dml
  ON financial_repasses FOR ALL
  USING (false) WITH CHECK (false);

COMMENT ON TABLE  financial_repasses                  IS '1 linha por frete encerrado, snapshot imutavel da comissao no momento do encerramento (admin-financeiro 037). Nao recalcula se settings mudar depois.';
COMMENT ON COLUMN financial_repasses.frete_id          IS '1:1 com fretes encerrados (UNIQUE). Trigger on_frete_close_create_repasse usa ON CONFLICT (frete_id) DO NOTHING para idempotencia em re-encerramento.';
COMMENT ON COLUMN financial_repasses.embarcador_id     IS 'Cliente do frete (FK users.id, ON DELETE RESTRICT para preservar o repasse historico).';
COMMENT ON COLUMN financial_repasses.motorista_id      IS 'Motorista do frete (FK users.id, ON DELETE SET NULL). NULL e legitimo (frete encerrado sem motorista vinculado).';
COMMENT ON COLUMN financial_repasses.valor_bruto       IS 'Snapshot de fretes.value no momento do encerramento. Imutavel apos criacao.';
COMMENT ON COLUMN financial_repasses.commission_pct    IS 'Snapshot do percentual aplicado (flat ou bracket) no momento do encerramento. Imutavel.';
COMMENT ON COLUMN financial_repasses.commission_value  IS 'Snapshot de valor_bruto * commission_pct / 100, ROUND(2). Imutavel apos criacao.';
COMMENT ON COLUMN financial_repasses.valor_liquido     IS 'Snapshot de valor_bruto - commission_value. Imutavel apos criacao. Garantido pelo CHECK chk_financial_repasses_arithmetic.';
COMMENT ON COLUMN financial_repasses.status            IS 'Ciclo: pendente -> pago -> estornado. Idempotencia via audit log _SKIPPED nas RPCs (admin-patterns.md Sec. 4).';
COMMENT ON COLUMN financial_repasses.closed_at         IS 'Snapshot de fretes.updated_at no instante do encerramento (status mudou para encerrado).';
COMMENT ON COLUMN financial_repasses.paid_at           IS 'Quando o pagamento foi marcado. Preservado apos estorno para auditoria.';
COMMENT ON COLUMN financial_repasses.paid_by           IS 'Admin que marcou como pago (FK users.id, ON DELETE SET NULL). Preservado apos estorno.';
COMMENT ON COLUMN financial_repasses.payment_method    IS 'pix | ted | boleto | dinheiro | outro. Preservado apos estorno.';
COMMENT ON COLUMN financial_repasses.payment_proof_url IS 'Path no bucket privado financial_proofs (subtask 1.12). NULL se sem comprovante. <= 500 chars.';
COMMENT ON COLUMN financial_repasses.notes             IS 'Anotacao livre da marcacao de pagamento (opcional). <= 1000 chars.';
COMMENT ON COLUMN financial_repasses.reverted_at       IS 'Quando o pagamento foi estornado. Apenas pagos podem ser estornados.';
COMMENT ON COLUMN financial_repasses.reverted_by       IS 'Admin que executou o estorno (FK users.id, ON DELETE SET NULL).';
COMMENT ON COLUMN financial_repasses.revert_reason     IS 'Motivo obrigatorio do estorno (1..500 chars).';
COMMENT ON COLUMN financial_repasses.updated_at        IS 'Atualizado em cada mutacao. Usado para versionamento otimista (admin-patterns.md Sec. 3): UI envia expected_updated_at e RPC compara antes do UPDATE.';


-- ============================================================================
-- 4. Funcao SQL pura compute_commission_value (IMMUTABLE)
-- ============================================================================
-- Espelha 1:1 o helper TS computeCommission em src/services/admin/financeiro.ts.
-- A paridade SQL <-> TS e garantida pela propriedade obrigatoria CP-1
-- (src/__tests__/admin/financeiro/cp1_commission_parity.property.test.ts):
--   * P1: determinismo TS  (mesmo input -> mesmo output)
--   * P2: paridade TS <-> SQL helper-mirror (mesmo commission_value
--         modulo arredondamento Math.round(x*100)/100 (TS)
--                          ==     ROUND(x, 2)        (SQL)
--         -- ambos round-half-away-from-zero para 2 casas decimais)
--   * P3: paridade trigger (snapshot inserido em financial_repasses
--         pelo on_frete_close_create_repasse e identico)
--
-- IMUTAVEL: nao toca tabela alguma, mesmo input -> mesmo output. Marcar
-- IMMUTABLE permite indexacao funcional e cache de plano. Nao usa
-- SECURITY DEFINER (sem dados sensiveis); exposta a authenticated para
-- viabilizar simulacao client-side e o helper de testes de paridade.
-- (Ver design.md Sec. RPC Contracts e admin-patterns.md Sec. 10.)
--
-- LOGICA:
--   1. Defensivo: p_value NULL ou negativo -> 0.
--   2. Defensivo: p_settings NULL ou nao-objeto -> retorna flat 0%
--      com resolved_via='flat_default'.
--   3. Le commission_pct (flat) e commission_brackets do jsonb.
--   4. Se commission_brackets e array nao vazio:
--        - itera buscando o bracket onde min_value <= v < max_value
--          (exclusivo no max para evitar dupla contagem -- e como
--          brackets sao contiguas sem buracos, max[i] = min[i+1] da
--          ao bracket seguinte a posse do ponto);
--        - se nenhum cobre E o valor e exatamente o max_value da
--          ultima faixa, casa com a ultima faixa (inclusivo na borda
--          superior global);
--        - caso contrario, cai em flat (comportamento prospectivo
--          para fretes acima do teto da maior bracket).
--      Pre-condicao: brackets ordenadas ASC por min_value, sem buracos
--      e sem sobreposicao -- validacao reside em
--      admin_financeiro_settings_update (subtask 1.7).
--   5. Se commission_brackets e array vazio ('[]') ou ausente: aplica
--      flat (commission_pct).
--   6. commission_value = ROUND(v * resolved_pct / 100.0, 2)
--      (half-away-from-zero, default do PostgreSQL ROUND(numeric, int)).
--   7. Retorna jsonb { commission_pct, commission_value, resolved_via }
--      onde resolved_via e um dos:
--        'flat'                  -- aplicou commission_pct (caso default)
--        'bracket'               -- casou um bracket interno
--        'bracket_max_inclusive' -- casou exatamente o max da ultima faixa
--        'flat_default'          -- p_settings NULL/malformado
--
-- O trigger on_frete_close_create_repasse (subtask 1.5) consome o jsonb
-- via:  (resultado->>'commission_value')::numeric.

CREATE OR REPLACE FUNCTION compute_commission_value(
  p_value    numeric,
  p_settings jsonb
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $func$
DECLARE
  v_value           numeric;
  v_pct_flat        numeric;
  v_brackets        jsonb;
  v_bracket         jsonb;
  v_min             numeric;
  v_max             numeric;
  v_pct             numeric;
  v_resolved_pct    numeric;
  v_commission      numeric;
  v_resolved_via    text := 'flat';
BEGIN
  -- Normalizacao defensiva: NULL ou negativo -> 0 (espelha
  -- !Number.isFinite(valor_bruto) || valor_bruto < 0 ? 0 : valor_bruto em TS).
  v_value := COALESCE(p_value, 0);
  IF v_value < 0 THEN
    v_value := 0;
  END IF;

  -- Settings ausente / malformado -> flat 0% (espelha settings == null em TS).
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
    RETURN jsonb_build_object(
      'commission_pct',   0,
      'commission_value', 0,
      'resolved_via',     'flat_default'
    );
  END IF;

  v_pct_flat := COALESCE((p_settings->>'commission_pct')::numeric, 0);
  v_brackets := COALESCE(p_settings->'commission_brackets', '[]'::jsonb);

  -- Default: usa flat.
  v_resolved_pct := v_pct_flat;
  v_resolved_via := 'flat';

  -- Procura bracket que cobre v_value. Pre-condicao: brackets ordenadas ASC
  -- por min_value, sem buracos, sem sobreposicao (validado em
  -- admin_financeiro_settings_update).
  IF jsonb_typeof(v_brackets) = 'array' AND jsonb_array_length(v_brackets) > 0 THEN
    FOR v_bracket IN SELECT * FROM jsonb_array_elements(v_brackets)
    LOOP
      v_min := COALESCE((v_bracket->>'min_value')::numeric, 0);
      v_max := COALESCE((v_bracket->>'max_value')::numeric, 0);
      v_pct := COALESCE((v_bracket->>'pct')::numeric, 0);
      -- Inclusivo em min_value, exclusivo em max_value. Como brackets sao
      -- contiguas (max[i] = min[i+1]), o exclusivo na borda da ao bracket
      -- seguinte a posse do ponto -- evita dupla contagem.
      IF v_value >= v_min AND v_value < v_max THEN
        v_resolved_pct := v_pct;
        v_resolved_via := 'bracket';
        EXIT;
      END IF;
    END LOOP;

    -- Se nao casou em nenhum bracket interno: testa borda superior global.
    -- Quando v_value = max_value da ULTIMA faixa, casa inclusivamente
    -- com ela. Para v_value > max_value da ultima faixa, cai em flat
    -- (fretes acima do teto da maior bracket).
    IF v_resolved_via = 'flat' THEN
      SELECT (b->>'max_value')::numeric, (b->>'pct')::numeric
        INTO v_max, v_pct
        FROM jsonb_array_elements(v_brackets) WITH ORDINALITY t(b, idx)
       ORDER BY idx DESC
       LIMIT 1;
      IF v_value = v_max THEN
        v_resolved_pct := v_pct;
        v_resolved_via := 'bracket_max_inclusive';
      END IF;
      -- Caso contrario: mantem v_resolved_pct = v_pct_flat / v_resolved_via = 'flat'.
    END IF;
  END IF;

  -- Aplicacao + arredondamento half-away-from-zero. ROUND(numeric, int)
  -- do PostgreSQL e half-away-from-zero por padrao (NAO banker's rounding,
  -- que e o comportamento de ROUND(double precision, int)). Espelha
  -- Math.round(x*100)/100 do TS, que tambem e half-away-from-zero para
  -- positivos. CP-1.P2 valida a paridade exata.
  v_commission := ROUND(v_value * v_resolved_pct / 100.0, 2);

  RETURN jsonb_build_object(
    'commission_pct',   v_resolved_pct,
    'commission_value', v_commission,
    'resolved_via',     v_resolved_via
  );
END;
$func$;

-- Funcao pura: nao toca em tabelas, sem dados sensiveis. Exposicao a
-- authenticated viabiliza simulacao client-side e helper de testes
-- (ver §Threat-model S14/S15 em design.md).
REVOKE ALL ON FUNCTION compute_commission_value(numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compute_commission_value(numeric, jsonb) TO authenticated;

COMMENT ON FUNCTION compute_commission_value(numeric, jsonb)
  IS 'Funcao SQL pura IMMUTABLE que aplica a regra de comissao (flat ou brackets) sobre p_value e retorna jsonb {commission_pct, commission_value, resolved_via}. Paridade obrigatoria com computeCommission TS em src/services/admin/financeiro.ts (validada por CP-1 -- admin-financeiro 037).';


-- ============================================================================
-- 5. Trigger on_frete_close_create_repasse + funcao suporte
-- ============================================================================
-- Cria automaticamente 1 linha em financial_repasses sempre que um frete
-- transita para o status 'encerrado' (confirmado em 001_initial_schema.sql:
-- CHECK (status IN ('ativo', 'encerrado', 'cancelado'))).
--
-- A funcao suporte trg_on_frete_close_create_repasse():
--   1. Resolve Vigent_Settings = SELECT * FROM financial_settings
--      ORDER BY effective_from DESC LIMIT 1.
--      Se vazio (instalacao fresh) -> flat 0% com brackets=[].
--   2. Normaliza NEW.value: NULL ou negativo -> 0 (defensivo).
--   3. Chama compute_commission_value(value, settings_jsonb) -- ja IMMUTABLE
--      e validado por CP-1.
--   4. INSERT em financial_repasses com snapshot da comissao
--      (commission_pct, commission_value congelados) e ON CONFLICT
--      (frete_id) DO NOTHING para idempotencia em re-encerramento ou
--      duplo disparo.
--   5. Snapshot dos campos: valor_bruto = NEW.value normalizado,
--      valor_liquido = ROUND(valor_bruto - commission_value, 2),
--      status = 'pendente', closed_at = NOW().
--
-- O trigger usa clausula WHEN (OLD.status IS DISTINCT FROM NEW.status
-- AND NEW.status = 'encerrado') -- so dispara em transicao real de status,
-- nao em UPDATEs que mantem 'encerrado' (ex: edicao de campo nao-status).
--
-- SECURITY DEFINER + SET search_path = public sao requeridos porque a
-- policy financial_repasses_no_dml bloqueia INSERT direto. SECURITY DEFINER
-- bypassa RLS por design (mesmo padrao herdado de admin_blacklist 035).
--
-- DEFENSIVO motorista_id: o schema atual de fretes (001 + ate 036) NAO
-- possui a coluna motorista_id, embora a coluna financial_repasses.motorista_id
-- seja nullable e o design preveja vinculo opcional via NEW.motorista_id.
-- Usamos (to_jsonb(NEW)->>'motorista_id')::uuid -- avalia para NULL quando
-- a coluna nao existe e captura o valor real se uma migration futura adicionar
-- a coluna. Isso evita falha em runtime e mantem o trigger forward-compatible.
-- A constraint motorista_id IS NULL e legitima (design.md §Edge cases).

CREATE OR REPLACE FUNCTION trg_on_frete_close_create_repasse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_value          numeric;
  v_settings       record;
  v_settings_jsonb jsonb;
  v_compute        jsonb;
  v_pct            numeric;
  v_commission     numeric;
  v_motorista_id   uuid;
BEGIN
  -- Normalizacao defensiva de NEW.value: NULL ou negativo -> 0.
  -- Espelha exatamente o tratamento da funcao pura compute_commission_value
  -- e do helper TS computeCommission.
  v_value := COALESCE(NEW.value, 0);
  IF v_value < 0 THEN
    v_value := 0;
  END IF;

  -- Resolve motorista_id de forma defensiva (coluna pode nao existir no
  -- schema atual de fretes -- ver comentario na sec. 5 acima).
  BEGIN
    v_motorista_id := (to_jsonb(NEW)->>'motorista_id')::uuid;
  EXCEPTION WHEN others THEN
    v_motorista_id := NULL;
  END;

  -- Resolve Vigent_Settings = linha de financial_settings com maior
  -- effective_from <= NOW(). Indice idx_financial_settings_effective_from
  -- (DESC) suporta diretamente esta query.
  SELECT id, commission_pct, commission_brackets
    INTO v_settings
    FROM financial_settings
   WHERE effective_from <= NOW()
   ORDER BY effective_from DESC
   LIMIT 1;

  IF v_settings.id IS NULL THEN
    -- Instalacao fresh / nenhuma config vigente: aplica flat 0% com
    -- brackets vazios. Nao quebra o trigger (design.md §Edge cases).
    v_settings_jsonb := jsonb_build_object(
      'commission_pct',      0,
      'commission_brackets', '[]'::jsonb
    );
  ELSE
    v_settings_jsonb := jsonb_build_object(
      'commission_pct',      v_settings.commission_pct,
      'commission_brackets', v_settings.commission_brackets
    );
  END IF;

  -- Computa comissao (paridade SQL <-> TS validada por CP-1).
  v_compute    := compute_commission_value(v_value, v_settings_jsonb);
  v_pct        := (v_compute->>'commission_pct')::numeric;
  v_commission := (v_compute->>'commission_value')::numeric;

  -- INSERT idempotente. ON CONFLICT (frete_id) DO NOTHING garante que
  -- multiplos disparos (re-encerramento via toggle de status, replay de
  -- evento, etc.) nao duplicam o repasse. A constraint UNIQUE(frete_id)
  -- da tabela financial_repasses e a fonte de verdade.
  INSERT INTO financial_repasses (
    frete_id,
    embarcador_id,
    motorista_id,
    valor_bruto,
    commission_pct,
    commission_value,
    valor_liquido,
    status,
    closed_at,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.embarcador_id,
    v_motorista_id,
    v_value,
    v_pct,
    v_commission,
    ROUND(v_value - v_commission, 2),
    'pendente',
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT (frete_id) DO NOTHING;

  RETURN NEW;
END;
$func$;

-- Funcao do trigger e SECURITY DEFINER. Bloqueamos PUBLIC e nao concedemos
-- EXECUTE explicito a authenticated -- a funcao so e invocada pelo proprio
-- engine de triggers do Postgres no contexto AFTER UPDATE em fretes, nunca
-- por chamada direta. Mantemos a postura de minimo privilegio (admin-patterns
-- Sec. 10).
REVOKE ALL ON FUNCTION trg_on_frete_close_create_repasse() FROM PUBLIC;

COMMENT ON FUNCTION trg_on_frete_close_create_repasse()
  IS 'Funcao suporte do trigger on_frete_close_create_repasse. SECURITY DEFINER + search_path=public. Resolve Vigent_Settings, normaliza NEW.value, chama compute_commission_value e INSERT idempotente em financial_repasses (ON CONFLICT (frete_id) DO NOTHING). admin-financeiro 037.';

DROP TRIGGER IF EXISTS on_frete_close_create_repasse ON fretes;
CREATE TRIGGER on_frete_close_create_repasse
  AFTER UPDATE ON fretes
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'encerrado')
  EXECUTE FUNCTION trg_on_frete_close_create_repasse();

COMMENT ON TRIGGER on_frete_close_create_repasse ON fretes
  IS 'Cria 1 linha em financial_repasses (snapshot imutavel da comissao) sempre que fretes.status transita para "encerrado". Idempotente via ON CONFLICT (frete_id) DO NOTHING. admin-financeiro 037.';


-- ============================================================================
-- 6. RPC admin_financeiro_settings_get (STABLE, FINANCEIRO_VIEW)
-- ============================================================================
-- RPC STABLE SECURITY DEFINER que retorna a Vigent_Settings (linha mais
-- recente de financial_settings, resolvida por effective_from DESC).
--
-- Gating server-side em duas camadas (admin-patterns Sec. 2 e Sec. 10):
--   1. auth.uid() IS NULL  -> RAISE permission_denied (ERRCODE 42501).
--   2. is_admin_with_permission('FINANCEIRO_VIEW') = false ->
--      grava FINANCIAL_VIEW_DENIED em admin_audit_logs com
--      before_data=NULL e after_data={user_id, reason, rpc} e
--      RAISE permission_denied. UI converte em Stealth_404
--      (admin-patterns Sec. 5).
--
-- Resolucao da Vigent_Settings: SELECT * FROM financial_settings
-- ORDER BY effective_from DESC LIMIT 1. O indice
-- idx_financial_settings_effective_from suporta diretamente.
-- Quando a tabela esta vazia (instalacao fresh), retorna sentinel
-- com id=NULL e commission_pct=0 -- a UI trata como "configuracao
-- ainda nao existe, preencha".
--
-- STABLE (nao VOLATILE): a RPC nao muta dados; o INSERT em
-- admin_audit_logs no path negativo e admissivel sob STABLE porque
-- e o unico ramo que escreve e ele encerra com RAISE (nao retorna).
-- Mesmo padrao de RPCs gated em admin-dashboard 036 e admin-blacklist
-- 035 (admin-patterns Sec. 10).
--
-- Postura de privilegio: REVOKE ALL FROM PUBLIC + GRANT EXECUTE
-- TO authenticated. Nao expomos a anon -- o gating depende de
-- auth.uid().

CREATE OR REPLACE FUNCTION admin_financeiro_settings_get()
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_row    record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('FINANCEIRO_VIEW') THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller,
      'FINANCIAL_VIEW_DENIED',
      NULL,
      NULL,
      NULL,
      jsonb_build_object(
        'user_id', v_caller,
        'reason',  'permission_denied',
        'rpc',     'settings_get'
      )
    );
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- Vigent_Settings: linha de financial_settings mais recente.
  -- Indice idx_financial_settings_effective_from (DESC) cobre.
  SELECT *
    INTO v_row
    FROM financial_settings
   ORDER BY effective_from DESC
   LIMIT 1;

  -- Tabela vazia -> sentinel (instalacao fresh / pre-config).
  -- IF NOT FOUND e o predicado mais robusto em plpgsql para
  -- distinguir "sem linhas" de "linha com todos os campos NULL".
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'id',                  NULL,
      'commission_pct',      0,
      'commission_brackets', '[]'::jsonb,
      'effective_from',      NULL,
      'updated_at',          NULL,
      'updated_by',          NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'id',                  v_row.id,
    'commission_pct',      v_row.commission_pct,
    'commission_brackets', v_row.commission_brackets,
    'effective_from',      v_row.effective_from,
    'updated_at',          v_row.updated_at,
    'updated_by',          v_row.updated_by
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_financeiro_settings_get() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_financeiro_settings_get() TO authenticated;

COMMENT ON FUNCTION admin_financeiro_settings_get()
  IS 'RPC STABLE SECURITY DEFINER que retorna a Vigent_Settings (financial_settings com maior effective_from). Gated por FINANCEIRO_VIEW; falha de gating grava FINANCIAL_VIEW_DENIED em admin_audit_logs. Quando a tabela esta vazia, retorna sentinel {id:NULL, commission_pct:0, commission_brackets:[]}. admin-financeiro 037.';


-- ============================================================================
-- 7. RPC admin_financeiro_settings_update (FINANCEIRO_EDIT)
-- ============================================================================
-- RPC SECURITY DEFINER que faz INSERT de nova linha em financial_settings
-- (snapshot historico imutavel -- NAO UPDATE). Cada chamada cria uma nova
-- linha-snapshot; "Vigent_Settings" e sempre a linha com maior effective_from.
--
-- Gating em duas camadas (admin-patterns Sec. 2 e Sec. 10):
--   1. auth.uid() IS NULL -> RAISE permission_denied (ERRCODE 42501).
--   2. is_admin_with_permission('FINANCEIRO_EDIT') = false ->
--      grava FINANCIAL_VIEW_DENIED em admin_audit_logs com
--      after_data = {user_id, reason, rpc:'settings_update'} e
--      RAISE permission_denied. UI converte em Stealth_404
--      (admin-patterns Sec. 5).
--
-- Validacoes de dominio (cada falha = RAISE EXCEPTION ... USING ERRCODE = 'P0001'):
--   * COMMISSION_PCT_OUT_OF_RANGE  -- p_commission_pct fora de [0, 50]
--   * INVALID_BRACKETS             -- nao e array, ou item com numericos
--                                     ausentes / fora de range / max <= min
--   * BRACKETS_TOO_MANY            -- jsonb_array_length > 5
--   * BRACKETS_OUT_OF_ORDER        -- min_value[i] <= min_value[i-1]
--   * BRACKETS_OVERLAP             -- min_value[i] < max_value[i-1]
--   * BRACKETS_GAP                 -- min_value[i] > max_value[i-1]
-- A pre-condicao de brackets validas (ordenadas, sem buracos, sem overlap)
-- e consumida pela funcao pura compute_commission_value(numeric, jsonb)
-- (subtask 1.4) e pelo trigger on_frete_close_create_repasse (subtask 1.5).
--
-- Versionamento otimista (admin-patterns Sec. 3): le updated_at da ultima
-- linha de financial_settings (ORDER BY effective_from DESC LIMIT 1) e
-- compara com p_expected_updated_at. Mismatch -> RAISE STALE_VERSION.
-- Quando p_expected_updated_at IS NULL ou nao existe linha vigente, o
-- check e relaxado (instalacao fresh ou primeiro save sem snapshot
-- carregado pela UI -- conforme design.md).
--
-- INSERT (NAO UPDATE) preservando o historico completo. effective_from e
-- updated_at = NOW(); updated_by = caller. RETURNING id + updated_at para
-- compor o jsonb de retorno (linha-snapshot recem-criada).
--
-- Audit log de FINANCIAL_SETTINGS_UPDATED: NAO e gravado dentro da RPC.
-- O wrapper TS executeAdminMutation (src/services/admin/audit.ts) grava
-- com snapshot completo before/after em torno desta chamada
-- (admin-patterns Sec. 1, design.md §RPC Contracts). Manter o audit
-- "fora" mantem before_data/after_data com a estrutura idiomatica do
-- wrapper e evita duplicacao com a logica TS.
--
-- Postura de privilegio: REVOKE ALL FROM PUBLIC + GRANT EXECUTE
-- TO authenticated.

CREATE OR REPLACE FUNCTION admin_financeiro_settings_update(
  p_commission_pct      numeric,
  p_commission_brackets jsonb,
  p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller              uuid := auth.uid();
  v_existing_updated_at timestamptz;
  v_new_id              uuid;
  v_new_updated_at      timestamptz;
  v_new_effective_from  timestamptz;
  v_count               int;
  v_b                   jsonb;
  v_min                 numeric;
  v_max                 numeric;
  v_pct                 numeric;
  v_prev_min            numeric;
  v_prev_max            numeric;
  v_idx                 int := 0;
BEGIN
  -- ---------- Auth ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- ---------- RBAC server-side (FINANCEIRO_EDIT) ----------
  IF NOT is_admin_with_permission('FINANCEIRO_EDIT') THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller,
      'FINANCIAL_VIEW_DENIED',
      NULL,
      NULL,
      NULL,
      jsonb_build_object(
        'user_id', v_caller,
        'reason',  'permission_denied',
        'rpc',     'settings_update'
      )
    );
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- ---------- Validacao: commission_pct ----------
  IF p_commission_pct IS NULL
     OR p_commission_pct < 0
     OR p_commission_pct > 50 THEN
    RAISE EXCEPTION 'COMMISSION_PCT_OUT_OF_RANGE: 0..50'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Validacao: commission_brackets e array (ou null tratado como invalido) ----------
  -- DEFAULT da coluna e '[]'::jsonb; aceitamos array vazio. Rejeitamos NULL
  -- ou jsonb nao-array.
  IF p_commission_brackets IS NULL
     OR jsonb_typeof(p_commission_brackets) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_BRACKETS: nao e array'
      USING ERRCODE = 'P0001';
  END IF;

  v_count := jsonb_array_length(p_commission_brackets);
  IF v_count > 5 THEN
    RAISE EXCEPTION 'BRACKETS_TOO_MANY: max 5'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Validacao: cada bracket + relacao com anterior ----------
  -- Itera com indice manual (jsonb_array_elements nao expoe ordinality
  -- direto sem WITH ORDINALITY, e queremos manter o erro com idx legivel
  -- 1-based para mensagens user-facing).
  FOR v_b IN SELECT * FROM jsonb_array_elements(p_commission_brackets)
  LOOP
    v_idx := v_idx + 1;
    v_min := (v_b->>'min_value')::numeric;
    v_max := (v_b->>'max_value')::numeric;
    v_pct := (v_b->>'pct')::numeric;

    -- Cada item DEVE ter min_value, max_value, pct numericos no range valido.
    IF v_min IS NULL OR v_max IS NULL OR v_pct IS NULL
       OR v_min < 0
       OR v_max <= v_min
       OR v_pct < 0
       OR v_pct > 50 THEN
      RAISE EXCEPTION 'INVALID_BRACKETS: entrada % invalida (min_value=%, max_value=%, pct=%)',
                      v_idx, v_min, v_max, v_pct
        USING ERRCODE = 'P0001';
    END IF;

    -- Relacao com bracket anterior (1-based: idx 2 em diante).
    IF v_idx > 1 THEN
      -- Ordenacao ASC por min_value (estritamente crescente).
      IF v_min <= v_prev_min THEN
        RAISE EXCEPTION 'BRACKETS_OUT_OF_ORDER: idx % min_value % nao maior que anterior %',
                        v_idx, v_min, v_prev_min
          USING ERRCODE = 'P0001';
      END IF;
      -- Sem sobreposicao: min[i] >= max[i-1].
      IF v_min < v_prev_max THEN
        RAISE EXCEPTION 'BRACKETS_OVERLAP: idx % min_value % menor que max anterior %',
                        v_idx, v_min, v_prev_max
          USING ERRCODE = 'P0001';
      END IF;
      -- Sem buracos: min[i] = max[i-1].
      IF v_min > v_prev_max THEN
        RAISE EXCEPTION 'BRACKETS_GAP: idx % min_value % maior que max anterior %',
                        v_idx, v_min, v_prev_max
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    v_prev_min := v_min;
    v_prev_max := v_max;
  END LOOP;

  -- ---------- Versionamento otimista ----------
  -- Le o updated_at da Vigent_Settings (linha mais recente) e compara
  -- com o expected enviado pela UI. Indice idx_financial_settings_effective_from
  -- (DESC) cobre. Quando nao ha linha vigente OU o expected veio NULL,
  -- relaxamos o check (instalacao fresh / save sem snapshot carregado).
  -- Conforme design.md §RPC Contracts.
  SELECT updated_at
    INTO v_existing_updated_at
    FROM financial_settings
   ORDER BY effective_from DESC
   LIMIT 1;

  IF v_existing_updated_at IS NOT NULL
     AND p_expected_updated_at IS NOT NULL
     AND v_existing_updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION: expected % got %',
                    p_expected_updated_at, v_existing_updated_at
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- INSERT (snapshot historico, NAO UPDATE) ----------
  INSERT INTO financial_settings (
    commission_pct,
    commission_brackets,
    effective_from,
    updated_at,
    updated_by
  ) VALUES (
    p_commission_pct,
    p_commission_brackets,
    NOW(),
    NOW(),
    v_caller
  )
  RETURNING id, updated_at, effective_from
       INTO v_new_id, v_new_updated_at, v_new_effective_from;

  -- ---------- Retorna jsonb da nova linha-snapshot ----------
  RETURN jsonb_build_object(
    'id',                  v_new_id,
    'commission_pct',      p_commission_pct,
    'commission_brackets', p_commission_brackets,
    'effective_from',      v_new_effective_from,
    'updated_at',          v_new_updated_at,
    'updated_by',          v_caller
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_financeiro_settings_update(numeric, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_financeiro_settings_update(numeric, jsonb, timestamptz) TO authenticated;

COMMENT ON FUNCTION admin_financeiro_settings_update(numeric, jsonb, timestamptz)
  IS 'RPC SECURITY DEFINER que insere uma nova linha-snapshot em financial_settings (NAO UPDATE -- preserva o historico completo). Gated por FINANCEIRO_EDIT; falha de gating grava FINANCIAL_VIEW_DENIED. Valida commission_pct (0..50), commission_brackets (array, max 5, ordem ASC, sem sobreposicao, sem buracos). Versionamento otimista vs ultima linha vigente -> STALE_VERSION em mismatch. Audit FINANCIAL_SETTINGS_UPDATED e gravado pelo wrapper TS executeAdminMutation (admin-patterns Sec. 1). admin-financeiro 037.';


-- ============================================================================
-- 8. RPC admin_repasse_mark_paid (FINANCEIRO_EDIT, idempotente CP-2)
-- ============================================================================
-- RPC SECURITY DEFINER que materializa CP-2 (idempotencia forte de marcacao
-- como pago). Mutacao real -> retorna { ok: true, updated_at }. Repasse ja
-- pago -> NAO muta, grava FINANCIAL_PAYMENT_MARKED_SKIPPED em
-- admin_audit_logs e retorna { skipped: true, reason: 'ALREADY_PAID' }.
-- Repasse estornado -> RAISE 'INVALID_STATUS' (estornados nao retornam ao
-- ciclo de pagamento por este fluxo; o usuario deve abrir um novo repasse
-- ou seguir o procedimento de regularizacao manual).
--
-- Gating em duas camadas (admin-patterns Sec. 2 e Sec. 10):
--   1. auth.uid() IS NULL -> RAISE permission_denied (ERRCODE 42501).
--   2. is_admin_with_permission('FINANCEIRO_EDIT') = false ->
--      grava FINANCIAL_VIEW_DENIED em admin_audit_logs com
--      target_type='financial_repasses', target_id=p_id::text e
--      after_data = {user_id, reason, rpc:'mark_paid'}; depois
--      RAISE permission_denied. UI converte em Stealth_404
--      (admin-patterns Sec. 5).
--
-- Validacoes de input (cada falha = RAISE EXCEPTION ... USING ERRCODE = 'P0001'):
--   * INVALID_INPUT: payment_method        -- p_method NULL ou fora do enum
--                                            ('pix','ted','boleto','dinheiro','outro')
--   * INVALID_INPUT: notes > 1000 chars    -- p_notes opcional, max 1000
--   * INVALID_INPUT: proof_path > 500 chars -- p_proof_path opcional, max 500
--
-- Estados:
--   * NOT_FOUND       -- linha em financial_repasses nao existe
--   * INVALID_STATUS  -- status = 'estornado' (regularizacao fora do MVP)
--   * STALE_VERSION   -- updated_at != p_expected_updated_at (admin-patterns Sec. 3)
--
-- Padrao idempotente CP-2 (admin-patterns Sec. 4): pre-fetch do estado
-- via SELECT ... FOR UPDATE (lock pessimista durante a transacao garante
-- que nao ha race entre o check de status='pago' e o UPDATE). Se ja pago,
-- grava log _SKIPPED e retorna sem mutar -- garante invariantes:
--   - exatamente 1 linha FINANCIAL_PAYMENT_MARKED no audit por target
--   - >=0 linhas FINANCIAL_PAYMENT_MARKED_SKIPPED por target (uma por
--     tentativa repetida)
--   - snapshot de pagamento (paid_at, paid_by, payment_method,
--     payment_proof_url, notes) imutavel apos primeira marcacao
--
-- O audit log de FINANCIAL_PAYMENT_MARKED (mutacao real) NAO e gravado
-- aqui -- e responsabilidade do wrapper TS executeAdminMutation
-- (src/services/admin/audit.ts), que envolve a chamada RPC com snapshot
-- before/after completo. Apenas o log _SKIPPED (idempotencia) e gravado
-- dentro da RPC, conforme admin-patterns Sec. 1 e design.md
-- §RPC Contracts (decisao sobre coexistencia de logs).
--
-- Versionamento otimista: UPDATE com WHERE id = p_id AND updated_at =
-- p_expected_updated_at. ROW_COUNT = 0 -> RAISE STALE_VERSION (a UI
-- carregou o repasse, outro admin atualizou no meio, e o expected ficou
-- defasado). Pre-fetch + FOR UPDATE evita falsos positivos: se a UI esta
-- em sync, o lock garante que ninguem mais pode mudar updated_at entre
-- o SELECT e o UPDATE.
--
-- Postura de privilegio: REVOKE ALL FROM PUBLIC + GRANT EXECUTE
-- TO authenticated. Nao expomos a anon (gating depende de auth.uid()).

CREATE OR REPLACE FUNCTION admin_repasse_mark_paid(
  p_id                  uuid,
  p_method              text,
  p_proof_path          text,
  p_notes               text,
  p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_existing       record;
  v_new_updated_at timestamptz;
  v_rows           int;
BEGIN
  -- ---------- Auth ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- ---------- RBAC server-side (FINANCEIRO_EDIT) ----------
  IF NOT is_admin_with_permission('FINANCEIRO_EDIT') THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller,
      'FINANCIAL_VIEW_DENIED',
      'financial_repasses',
      p_id::text,
      NULL,
      jsonb_build_object(
        'user_id', v_caller,
        'reason',  'permission_denied',
        'rpc',     'mark_paid'
      )
    );
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- ---------- Validacao: payment_method ----------
  -- Dominio fechado (espelha CHECK constraint de financial_repasses.payment_method).
  IF p_method IS NULL
     OR p_method NOT IN ('pix','ted','boleto','dinheiro','outro') THEN
    RAISE EXCEPTION 'INVALID_INPUT: payment_method'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Validacao: notes (opcional, max 1000 chars) ----------
  IF p_notes IS NOT NULL AND char_length(p_notes) > 1000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: notes > 1000 chars'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Validacao: proof_path (opcional, max 500 chars) ----------
  IF p_proof_path IS NOT NULL AND char_length(p_proof_path) > 500 THEN
    RAISE EXCEPTION 'INVALID_INPUT: proof_path > 500 chars'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Pre-fetch + lock pessimista ----------
  -- FOR UPDATE garante que entre este SELECT e o UPDATE abaixo, nenhuma
  -- outra transacao pode mutar a linha. Isso fecha a janela de race
  -- entre check de status='pago' e UPDATE -- crucial para CP-2.
  SELECT *
    INTO v_existing
    FROM financial_repasses
   WHERE id = p_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: repasse % nao encontrado', p_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- CP-2: idempotencia (status='pago') ----------
  -- Repasse ja pago: NAO muta. Grava log _SKIPPED autoritativo (a contagem
  -- de CP-2 P3 conta exatamente 1 FINANCIAL_PAYMENT_MARKED + (N-1)
  -- FINANCIAL_PAYMENT_MARKED_SKIPPED para N chamadas). Retorna marker
  -- de skip que o wrapper TS detecta para nao gravar log normal duplicado.
  IF v_existing.status = 'pago' THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller,
      'FINANCIAL_PAYMENT_MARKED_SKIPPED',
      'financial_repasses',
      p_id::text,
      NULL,
      jsonb_build_object(
        'reason',           'ALREADY_PAID',
        'attempted_method', p_method
      )
    );
    RETURN jsonb_build_object(
      'skipped', true,
      'reason',  'ALREADY_PAID'
    );
  END IF;

  -- ---------- Estornado nao volta a 'pago' por este fluxo ----------
  IF v_existing.status = 'estornado' THEN
    RAISE EXCEPTION 'INVALID_STATUS: repasse estornado nao pode ser pago'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- UPDATE com versionamento otimista ----------
  -- Path normal: status='pendente' -> 'pago'. NULLIF(trim(...), '') normaliza
  -- notes vazias para NULL (evita gravar string em branco no historico).
  UPDATE financial_repasses
     SET status            = 'pago',
         payment_method    = p_method,
         paid_at            = NOW(),
         paid_by            = v_caller,
         payment_proof_url = p_proof_path,
         notes              = NULLIF(trim(COALESCE(p_notes, '')), ''),
         updated_at         = NOW()
   WHERE id = p_id
     AND updated_at = p_expected_updated_at
   RETURNING updated_at
        INTO v_new_updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- v_existing.updated_at foi capturado no SELECT FOR UPDATE acima:
    -- mostra o updated_at atual do banco vs o expected enviado pela UI.
    RAISE EXCEPTION 'STALE_VERSION: expected % got %',
                    p_expected_updated_at, v_existing.updated_at
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Sucesso: retorna marker de mutacao real ----------
  -- O wrapper TS executeAdminMutation grava FINANCIAL_PAYMENT_MARKED com
  -- snapshot before/after em torno desta chamada (admin-patterns Sec. 1).
  RETURN jsonb_build_object(
    'ok',         true,
    'id',         p_id,
    'updated_at', v_new_updated_at,
    'paid_at',    v_new_updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_repasse_mark_paid(uuid, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_repasse_mark_paid(uuid, text, text, text, timestamptz) TO authenticated;

COMMENT ON FUNCTION admin_repasse_mark_paid(uuid, text, text, text, timestamptz)
  IS 'RPC SECURITY DEFINER que marca repasse como pago. Idempotente CP-2: ja-pago -> grava FINANCIAL_PAYMENT_MARKED_SKIPPED em admin_audit_logs e retorna {skipped:true, reason:ALREADY_PAID} sem mutar. Estornado -> RAISE INVALID_STATUS. Gated por FINANCEIRO_EDIT; falha de gating grava FINANCIAL_VIEW_DENIED. Versionamento otimista via expected_updated_at -> STALE_VERSION em mismatch. Audit FINANCIAL_PAYMENT_MARKED de mutacao real e gravado pelo wrapper TS executeAdminMutation. admin-financeiro 037.';


-- ============================================================================
-- 9. RPC admin_repasse_estornar (FINANCEIRO_EDIT, idempotente)
-- ============================================================================
-- Simetrico a mark_paid: estorna um repasse 'pago' levando-o ao estado
-- 'estornado'. Idempotente: chamadas adicionais em repasse ja estornado
-- gravam FINANCIAL_PAYMENT_REVERTED_SKIPPED e retornam skip-marker sem mutar
-- (mesmo padrao CP-2 de mark_paid). Repasses 'pendentes' nao podem ser
-- estornados -- estorno e operacao reversa de pagamento, nao de criacao.
--
-- IMPORTANTE -- Snapshot historico preservado:
--   O UPDATE deste RPC NAO toca paid_at, paid_by, payment_method,
--   payment_proof_url ou notes. Esses campos permanecem como evidencia do
--   pagamento original (auditoria + comprovante baixavel pos-estorno via
--   FINANCEIRO_VIEW). Apenas reverted_*, status e updated_at sao mutados.

CREATE OR REPLACE FUNCTION admin_repasse_estornar(
  p_id                  uuid,
  p_revert_reason       text,
  p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_existing       record;
  v_reason_trimmed text;
  v_new_updated_at timestamptz;
  v_new_reverted_at timestamptz;
  v_rows           int;
BEGIN
  -- ---------- Auth ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- ---------- RBAC server-side (FINANCEIRO_EDIT) ----------
  IF NOT is_admin_with_permission('FINANCEIRO_EDIT') THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller,
      'FINANCIAL_VIEW_DENIED',
      'financial_repasses',
      p_id::text,
      NULL,
      jsonb_build_object(
        'user_id', v_caller,
        'reason',  'permission_denied',
        'rpc',     'estornar'
      )
    );
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- ---------- Validacao: revert_reason (NOT NULL, 1..500 chars) ----------
  -- Trim antes de medir: motivo so com whitespace e tratado como vazio.
  -- O texto trimado e o que sera persistido em revert_reason.
  v_reason_trimmed := trim(COALESCE(p_revert_reason, ''));
  IF char_length(v_reason_trimmed) < 1 OR char_length(v_reason_trimmed) > 500 THEN
    RAISE EXCEPTION 'INVALID_INPUT: revert_reason 1..500 chars'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Pre-fetch + lock pessimista ----------
  -- FOR UPDATE fecha a janela de race entre o check de status e o UPDATE.
  SELECT *
    INTO v_existing
    FROM financial_repasses
   WHERE id = p_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: repasse % nao encontrado', p_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Idempotencia: status='estornado' ----------
  -- Ja estornado: NAO muta. Grava log _SKIPPED autoritativo (mesmo padrao
  -- CP-2 de mark_paid). Retorna skip-marker para o wrapper TS.
  IF v_existing.status = 'estornado' THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller,
      'FINANCIAL_PAYMENT_REVERTED_SKIPPED',
      'financial_repasses',
      p_id::text,
      NULL,
      jsonb_build_object(
        'reason',           'ALREADY_REVERTED',
        'attempted_reason', v_reason_trimmed
      )
    );
    RETURN jsonb_build_object(
      'skipped', true,
      'reason',  'ALREADY_REVERTED'
    );
  END IF;

  -- ---------- Pendente nao pode ser estornado ----------
  -- Estorno e a inversao de um pagamento; nao faz sentido em pendente
  -- (que nunca foi pago). UI deve esconder o botao Estornar em pendentes.
  IF v_existing.status = 'pendente' THEN
    RAISE EXCEPTION 'INVALID_STATUS: pendente nao pode ser estornado'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- UPDATE com versionamento otimista ----------
  -- Path normal: status='pago' -> 'estornado'.
  -- Snapshot historico preservado: paid_at, paid_by, payment_method,
  -- payment_proof_url e notes intactos. Apenas reverted_*, status e
  -- updated_at sao mutados.
  UPDATE financial_repasses
     SET status        = 'estornado',
         reverted_at   = NOW(),
         reverted_by   = v_caller,
         revert_reason = v_reason_trimmed,
         updated_at    = NOW()
   WHERE id = p_id
     AND updated_at = p_expected_updated_at
   RETURNING updated_at, reverted_at
        INTO v_new_updated_at, v_new_reverted_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- v_existing.updated_at foi capturado no SELECT FOR UPDATE acima.
    RAISE EXCEPTION 'STALE_VERSION: expected % got %',
                    p_expected_updated_at, v_existing.updated_at
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Sucesso: retorna marker de mutacao real ----------
  -- O wrapper TS executeAdminMutation grava FINANCIAL_PAYMENT_REVERTED com
  -- snapshot before/after em torno desta chamada (admin-patterns Sec. 1).
  RETURN jsonb_build_object(
    'ok',          true,
    'id',          p_id,
    'updated_at',  v_new_updated_at,
    'reverted_at', v_new_reverted_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_repasse_estornar(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_repasse_estornar(uuid, text, timestamptz) TO authenticated;

COMMENT ON FUNCTION admin_repasse_estornar(uuid, text, timestamptz)
  IS 'RPC SECURITY DEFINER que estorna repasse pago. Idempotente: ja-estornado -> grava FINANCIAL_PAYMENT_REVERTED_SKIPPED em admin_audit_logs e retorna {skipped:true, reason:ALREADY_REVERTED} sem mutar. Pendente -> RAISE INVALID_STATUS. Snapshot historico preservado (paid_*, payment_*, notes intactos); apenas reverted_*, status e updated_at sao mutados. Gated por FINANCEIRO_EDIT; falha de gating grava FINANCIAL_VIEW_DENIED. Versionamento otimista via expected_updated_at -> STALE_VERSION em mismatch. Audit FINANCIAL_PAYMENT_REVERTED de mutacao real e gravado pelo wrapper TS executeAdminMutation. admin-financeiro 037.';


-- ============================================================================
-- 10. RPC admin_repasses_list (STABLE, FINANCEIRO_VIEW)
-- ============================================================================
-- RPC STABLE SECURITY DEFINER que aplica filtros, ordenacao e paginacao inline
-- com joins em users (embarcador_name, motorista_name). Retorna o jsonb
-- canonico { items, total, limit, offset } usado pela listagem em
-- /admin/financeiro (FinanceiroListPage) e pelo wrapper TS listRepasses.
--
-- Gating em duas camadas (admin-patterns Sec. 2 e Sec. 10):
--   1. auth.uid() IS NULL -> RAISE permission_denied (ERRCODE 42501).
--   2. is_admin_with_permission('FINANCEIRO_VIEW') = false ->
--      grava FINANCIAL_VIEW_DENIED em admin_audit_logs com
--      after_data = {user_id, reason, rpc:'list'} e RAISE permission_denied.
--      UI converte em Stealth_404 (admin-patterns Sec. 5).
--
-- Input p_filters jsonb (todas as chaves opcionais):
--   * status         -- 'pendente' | 'pago' | 'estornado' | null (todos)
--   * embarcador_id  -- uuid | null
--   * motorista_id   -- uuid | null
--   * period_kind    -- 'fechamento' (default) | 'pagamento'
--                       'fechamento' filtra por closed_at;
--                       'pagamento'  filtra por paid_at e implica status='pago'
--                       (paid_at IS NOT NULL).
--   * period_from    -- timestamptz | null  (borda inclusiva)
--   * period_to      -- timestamptz | null  (borda inclusiva)
--   * min_value      -- numeric | null  (filtra por valor_bruto >= min)
--   * max_value      -- numeric | null  (filtra por valor_bruto <= max)
--   * search         -- text (ILIKE em frete_id::text OR ue.name OR ue.email,
--                       aplicado apenas com >= 2 chars apos trim)
--   * limit          -- int (default 10, hard max 100)
--   * offset         -- int (default 0, >= 0)
--
-- Validacoes:
--   * limit fora de [1, 100] -> INVALID_INPUT (P0001).
--   * offset < 0 -> INVALID_INPUT.
--   * status fora do enum -> INVALID_INPUT.
--   * period_kind fora do enum -> INVALID_INPUT.
--   * period_to < period_from quando ambos nao-nulos -> INVALID_PERIOD (22023).
--   * max_value < min_value quando ambos nao-nulos -> INVALID_INPUT.
--
-- Ordenacao:
--   * period_kind = 'fechamento' -> ORDER BY closed_at DESC, id ASC
--     (tiebreaker id ASC para determinismo).
--   * period_kind = 'pagamento'  -> ORDER BY paid_at DESC NULLS LAST, id ASC.
--
-- Paginacao: LIMIT v_limit OFFSET v_offset; total computado em paralelo via
-- count(*) sobre o mesmo predicado (subquery sem LIMIT).
--
-- Retorno: { items, total, limit, offset }, items e jsonb array com cada
-- entrada contendo: id, frete_id, embarcador_id, embarcador_name,
-- motorista_id, motorista_name, valor_bruto, commission_pct,
-- commission_value, valor_liquido, status, closed_at, paid_at,
-- payment_method, updated_at. items=[] e total=0 quando vazio.
--
-- STABLE: a RPC nao muta dados. O INSERT em admin_audit_logs no path
-- negativo (FINANCIAL_VIEW_DENIED) e admissivel sob STABLE porque e o
-- unico ramo que escreve e ele encerra com RAISE (mesmo padrao de
-- admin_financeiro_settings_get nesta migration).
--
-- Postura de privilegio: REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO
-- authenticated. Nao expomos a anon -- gating depende de auth.uid().

CREATE OR REPLACE FUNCTION admin_repasses_list(p_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_status         text;
  v_period_kind    text;
  v_embarcador_id  uuid;
  v_motorista_id   uuid;
  v_period_from    timestamptz;
  v_period_to      timestamptz;
  v_min_value      numeric;
  v_max_value      numeric;
  v_search_raw     text;
  v_search         text;
  v_search_pat     text;
  v_search_active  boolean;
  v_limit          int;
  v_offset         int;
  v_total          int;
  v_items          jsonb;
BEGIN
  -- ---------- Camada 1: gating ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('FINANCEIRO_VIEW') THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller,
      'FINANCIAL_VIEW_DENIED',
      NULL,
      NULL,
      NULL,
      jsonb_build_object(
        'user_id', v_caller,
        'reason',  'permission_denied',
        'rpc',     'list'
      )
    );
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- p_filters NULL e tratado como jsonb vazio; todas as chaves sao opcionais.
  IF p_filters IS NULL THEN
    p_filters := '{}'::jsonb;
  END IF;

  -- ---------- Camada 2: parse + validacoes ----------
  v_status        := NULLIF(p_filters->>'status', '');
  v_period_kind   := COALESCE(NULLIF(p_filters->>'period_kind', ''), 'fechamento');
  v_embarcador_id := NULLIF(p_filters->>'embarcador_id', '')::uuid;
  v_motorista_id  := NULLIF(p_filters->>'motorista_id', '')::uuid;
  v_period_from   := NULLIF(p_filters->>'period_from', '')::timestamptz;
  v_period_to     := NULLIF(p_filters->>'period_to', '')::timestamptz;
  v_min_value     := NULLIF(p_filters->>'min_value', '')::numeric;
  v_max_value     := NULLIF(p_filters->>'max_value', '')::numeric;
  v_search_raw    := COALESCE(p_filters->>'search', '');
  v_limit         := COALESCE(NULLIF(p_filters->>'limit', '')::int, 10);
  v_offset        := COALESCE(NULLIF(p_filters->>'offset', '')::int, 0);

  -- search: apenas com >= 2 chars apos trim. ILIKE com escape de wildcards
  -- nao e necessario aqui pois o input nao chega ao usuario externo; ainda
  -- assim, prefixamos/sufixamos % para fazer match parcial.
  v_search        := trim(v_search_raw);
  v_search_active := char_length(v_search) >= 2;
  v_search_pat    := '%' || v_search || '%';

  -- limit e hard-capado em 100; defaults em 10 quando NULL/0.
  IF v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_INPUT: limit must be in [1, 100]' USING ERRCODE = 'P0001';
  END IF;
  IF v_offset < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: offset must be >= 0' USING ERRCODE = 'P0001';
  END IF;

  IF v_status IS NOT NULL AND v_status NOT IN ('pendente','pago','estornado') THEN
    RAISE EXCEPTION 'INVALID_INPUT: status must be pendente|pago|estornado|null'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_period_kind NOT IN ('fechamento','pagamento') THEN
    RAISE EXCEPTION 'INVALID_INPUT: period_kind must be fechamento|pagamento'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_period_from IS NOT NULL AND v_period_to IS NOT NULL
     AND v_period_to < v_period_from THEN
    RAISE EXCEPTION 'INVALID_PERIOD: period_to < period_from' USING ERRCODE = '22023';
  END IF;

  IF v_min_value IS NOT NULL AND v_max_value IS NOT NULL
     AND v_max_value < v_min_value THEN
    RAISE EXCEPTION 'INVALID_INPUT: max_value < min_value' USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Predicado dinamico via CTE ----------
  -- Predicado e materializado uma vez em filtered; items e total reusam.
  -- Tiebreaker id em ambos os branches de ordenacao garante determinismo
  -- na paginacao (admin-patterns Sec. 6).
  WITH filtered AS (
    SELECT
      r.id,
      r.frete_id,
      r.embarcador_id,
      ue.name  AS embarcador_name,
      r.motorista_id,
      um.name  AS motorista_name,
      r.valor_bruto,
      r.commission_pct,
      r.commission_value,
      r.valor_liquido,
      r.status,
      r.closed_at,
      r.paid_at,
      r.payment_method,
      r.updated_at
      FROM financial_repasses r
      LEFT JOIN users ue ON ue.id = r.embarcador_id
      LEFT JOIN users um ON um.id = r.motorista_id
     WHERE (v_status        IS NULL OR r.status        = v_status)
       AND (v_embarcador_id IS NULL OR r.embarcador_id = v_embarcador_id)
       AND (v_motorista_id  IS NULL OR r.motorista_id  = v_motorista_id)
       -- period_kind=fechamento -> closed_at; pagamento -> paid_at
       -- (e paid_at NOT NULL implica que so pagos/estornados aparecem).
       AND (
            (v_period_kind = 'fechamento'
              AND (v_period_from IS NULL OR r.closed_at >= v_period_from)
              AND (v_period_to   IS NULL OR r.closed_at <= v_period_to))
         OR (v_period_kind = 'pagamento'
              AND r.paid_at IS NOT NULL
              AND (v_period_from IS NULL OR r.paid_at >= v_period_from)
              AND (v_period_to   IS NULL OR r.paid_at <= v_period_to))
           )
       AND (v_min_value IS NULL OR r.valor_bruto >= v_min_value)
       AND (v_max_value IS NULL OR r.valor_bruto <= v_max_value)
       AND (
            NOT v_search_active
         OR r.frete_id::text ILIKE v_search_pat
         OR ue.name          ILIKE v_search_pat
         OR ue.email         ILIKE v_search_pat
           )
  ),
  page AS (
    SELECT *
      FROM filtered
     ORDER BY
       CASE WHEN v_period_kind = 'fechamento' THEN closed_at END DESC NULLS LAST,
       CASE WHEN v_period_kind = 'pagamento'  THEN paid_at   END DESC NULLS LAST,
       id ASC
     LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',                p.id,
      'frete_id',          p.frete_id,
      'embarcador_id',     p.embarcador_id,
      'embarcador_name',   p.embarcador_name,
      'motorista_id',      p.motorista_id,
      'motorista_name',    p.motorista_name,
      'valor_bruto',       p.valor_bruto,
      'commission_pct',    p.commission_pct,
      'commission_value',  p.commission_value,
      'valor_liquido',     p.valor_liquido,
      'status',            p.status,
      'closed_at',         p.closed_at,
      'paid_at',           p.paid_at,
      'payment_method',    p.payment_method,
      'updated_at',        p.updated_at
    )), '[]'::jsonb)
    INTO v_items
    FROM page p;

  -- Total computado sobre o mesmo predicado (sem LIMIT/OFFSET).
  -- Reaplicamos a CTE filtered acima dentro de um SELECT count separado
  -- para clareza; o planner reutiliza os indices
  -- idx_financial_repasses_status_closed_at e
  -- idx_financial_repasses_paid_at conforme o filtro.
  SELECT count(*)
    INTO v_total
    FROM financial_repasses r
    LEFT JOIN users ue ON ue.id = r.embarcador_id
    LEFT JOIN users um ON um.id = r.motorista_id
   WHERE (v_status        IS NULL OR r.status        = v_status)
     AND (v_embarcador_id IS NULL OR r.embarcador_id = v_embarcador_id)
     AND (v_motorista_id  IS NULL OR r.motorista_id  = v_motorista_id)
     AND (
          (v_period_kind = 'fechamento'
            AND (v_period_from IS NULL OR r.closed_at >= v_period_from)
            AND (v_period_to   IS NULL OR r.closed_at <= v_period_to))
       OR (v_period_kind = 'pagamento'
            AND r.paid_at IS NOT NULL
            AND (v_period_from IS NULL OR r.paid_at >= v_period_from)
            AND (v_period_to   IS NULL OR r.paid_at <= v_period_to))
         )
     AND (v_min_value IS NULL OR r.valor_bruto >= v_min_value)
     AND (v_max_value IS NULL OR r.valor_bruto <= v_max_value)
     AND (
          NOT v_search_active
       OR r.frete_id::text ILIKE v_search_pat
       OR ue.name          ILIKE v_search_pat
       OR ue.email         ILIKE v_search_pat
         );

  RETURN jsonb_build_object(
    'items',  v_items,
    'total',  COALESCE(v_total, 0),
    'limit',  v_limit,
    'offset', v_offset
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_repasses_list(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_repasses_list(jsonb) TO authenticated;

COMMENT ON FUNCTION admin_repasses_list(jsonb)
  IS 'RPC STABLE SECURITY DEFINER que retorna { items, total, limit, offset } para a listagem de repasses (FinanceiroListPage). Filtros opcionais via p_filters jsonb: status, embarcador_id, motorista_id, period_kind (fechamento|pagamento, default fechamento), period_from/to, min_value/max_value, search (>=2 chars, ILIKE em frete_id::text OR users.name OR users.email do embarcador), limit (default 10, max 100), offset (default 0). Ordenacao closed_at DESC quando period_kind=fechamento; paid_at DESC NULLS LAST quando period_kind=pagamento. Tiebreaker id ASC para determinismo. Gated por FINANCEIRO_VIEW; falha de gating grava FINANCIAL_VIEW_DENIED em admin_audit_logs. admin-financeiro 037.';


-- ============================================================================
-- 11. RPC admin_financeiro_summary (STABLE, FINANCEIRO_VIEW)
-- ============================================================================
-- RPC STABLE SECURITY DEFINER que retorna o jsonb agregado dos 4 cards do
-- mini-dashboard do FinanceiroListPage:
--
--   1. receita_mes            -> SUM(commission_value) de status='pago' no
--                                periodo (paid_at BETWEEN from AND to).
--   2. pendentes              -> { count, total } de status='pendente' no
--                                periodo (closed_at BETWEEN from AND to),
--                                somando valor_bruto.
--   3. pagos_mes              -> { count, total } de status='pago' no
--                                periodo (paid_at BETWEEN from AND to),
--                                somando valor_liquido.
--   4. top_embarcador_devedor -> top 1 por SUM(valor_bruto) entre
--                                status='pendente' (sem filtro de tempo --
--                                soma todos os pendentes em aberto, vide
--                                Requirement 5.1). Tiebreaker embarcador_id
--                                ASC. NULL se nao ha pendencias.
--
-- Defaults: from = COALESCE(p_from, date_trunc('month', NOW())),
--           to   = COALESCE(p_to, NOW()).
-- Validacoes: to >= from (RAISE INVALID_PERIOD),
--             (to - from) <= INTERVAL '365 days' (RAISE PERIOD_TOO_LARGE).
--
-- Gating padrao: auth.uid() obrigatorio + is_admin_with_permission(
-- 'FINANCEIRO_VIEW'); falha grava FINANCIAL_VIEW_DENIED em admin_audit_logs
-- antes de raise.
--
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated.
CREATE OR REPLACE FUNCTION admin_financeiro_summary(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller      uuid := auth.uid();
  v_from        timestamptz;
  v_to          timestamptz;
  v_receita     numeric;
  v_pend_count  bigint;
  v_pend_total  numeric;
  v_pagos_count bigint;
  v_pagos_total numeric;
  v_top_id      uuid;
  v_top_name    text;
  v_top_total   numeric;
  v_top_json    jsonb;
BEGIN
  -- 1. Auth: caller anonimo (sessao expirada / sem JWT) -> abort sem audit
  --    (nao ha auth.uid() para gravar). Padrao admin-patterns.md Sec. 10.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()'
      USING ERRCODE = '42501';
  END IF;

  -- 2. RBAC: FINANCEIRO_VIEW. Falha -> grava FINANCIAL_VIEW_DENIED
  --    (rpc:'summary') antes de raise (Requirement 5.9).
  IF NOT is_admin_with_permission('FINANCEIRO_VIEW') THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    )
    VALUES (
      v_caller,
      'FINANCIAL_VIEW_DENIED',
      NULL,
      NULL,
      NULL,
      jsonb_build_object(
        'user_id', v_caller,
        'reason',  'permission_denied',
        'rpc',     'summary'
      )
    );
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_VIEW required'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Defaults de periodo (Requirement 5.2): mes corrente quando ambos NULL.
  v_from := COALESCE(p_from, date_trunc('month', NOW()));
  v_to   := COALESCE(p_to,   NOW());

  -- 4. Validacoes de periodo (Requirements 5.3 e 5.4).
  IF v_to < v_from THEN
    RAISE EXCEPTION 'INVALID_PERIOD: p_to (%) < p_from (%)', v_to, v_from
      USING ERRCODE = '22023';
  END IF;
  IF (v_to - v_from) > INTERVAL '365 days' THEN
    RAISE EXCEPTION 'PERIOD_TOO_LARGE: (p_to - p_from) > 365 days'
      USING ERRCODE = '22023';
  END IF;

  -- 5. Card 1: receita_mes = SUM(commission_value) dos pagos no periodo.
  SELECT COALESCE(SUM(commission_value), 0)
    INTO v_receita
    FROM financial_repasses
   WHERE status = 'pago'
     AND paid_at IS NOT NULL
     AND paid_at BETWEEN v_from AND v_to;

  -- 6. Card 2: pendentes = (count, sum(valor_bruto)) por closed_at no periodo.
  SELECT COUNT(*), COALESCE(SUM(valor_bruto), 0)
    INTO v_pend_count, v_pend_total
    FROM financial_repasses
   WHERE status = 'pendente'
     AND closed_at BETWEEN v_from AND v_to;

  -- 7. Card 3: pagos_mes = (count, sum(valor_liquido)) por paid_at no periodo.
  SELECT COUNT(*), COALESCE(SUM(valor_liquido), 0)
    INTO v_pagos_count, v_pagos_total
    FROM financial_repasses
   WHERE status = 'pago'
     AND paid_at IS NOT NULL
     AND paid_at BETWEEN v_from AND v_to;

  -- 8. Card 4: top embarcador devedor (sum valor_bruto entre pendentes,
  --    sem filtro de tempo). Tiebreaker embarcador_id ASC. NULL se vazio.
  SELECT r.embarcador_id,
         u.name,
         SUM(r.valor_bruto)
    INTO v_top_id, v_top_name, v_top_total
    FROM financial_repasses r
    JOIN users u ON u.id = r.embarcador_id
   WHERE r.status = 'pendente'
   GROUP BY r.embarcador_id, u.name
   ORDER BY SUM(r.valor_bruto) DESC, r.embarcador_id ASC
   LIMIT 1;

  IF v_top_id IS NULL THEN
    v_top_json := NULL;
  ELSE
    v_top_json := jsonb_build_object(
      'embarcador_id',  v_top_id,
      'name',           v_top_name,
      'total_pendente', v_top_total
    );
  END IF;

  -- 9. Retorno final agregado.
  RETURN jsonb_build_object(
    'receita_mes', v_receita,
    'pendentes', jsonb_build_object(
      'count', v_pend_count,
      'total', v_pend_total
    ),
    'pagos_mes', jsonb_build_object(
      'count', v_pagos_count,
      'total', v_pagos_total
    ),
    'top_embarcador_devedor', v_top_json,
    'period', jsonb_build_object(
      'from', v_from,
      'to',   v_to
    )
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_financeiro_summary(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_financeiro_summary(timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION admin_financeiro_summary(timestamptz, timestamptz)
  IS 'RPC STABLE SECURITY DEFINER que retorna { receita_mes, pendentes:{count,total}, pagos_mes:{count,total}, top_embarcador_devedor, period:{from,to} } para o mini-dashboard do FinanceiroListPage. Defaults: from=date_trunc(month,NOW()), to=NOW(). Validacoes: to>=from (INVALID_PERIOD), to-from<=365 days (PERIOD_TOO_LARGE). Card receita_mes soma commission_value de pagos no periodo (paid_at). Card pendentes conta + soma valor_bruto de status=pendente no periodo (closed_at). Card pagos_mes conta + soma valor_liquido de pagos no periodo (paid_at). Top embarcador devedor agrega SUM(valor_bruto) de todos os pendentes em aberto (sem filtro de tempo); tiebreaker embarcador_id ASC; NULL quando sem pendencias. Gated por FINANCEIRO_VIEW; falha de gating grava FINANCIAL_VIEW_DENIED (rpc:summary) em admin_audit_logs. admin-financeiro 037.';


-- ============================================================================
-- 12. Bucket privado financial_proofs + 4 policies em storage.objects
-- ============================================================================
-- Bucket privado para comprovantes de pagamento de repasses.
--
-- Path layout (definido em src/services/admin/financeiro.ts):
--   <repasse_id>/<filename_sanitizado>
--
-- Tipos MIME ESPERADOS (validados client-side em uploadProof, NAO via
-- constraint SQL para manter o bucket flexivel a futuras extensoes):
--   - image/jpeg
--   - image/png
--   - image/webp
--   - application/pdf
--
-- TAMANHO MAXIMO: 5 MiB por arquivo. Tambem validado client-side em
-- uploadProof (NAO via storage.buckets.file_size_limit) -- mantido como
-- regra de logica TS para que mensagens de erro fiquem em pt-BR e o limite
-- possa evoluir sem migration nova.
--
-- POLICIES (4, drop+create idempotente sobre storage.objects):
--   1. financial_proofs_select_view  (SELECT, FINANCEIRO_VIEW)
--   2. financial_proofs_insert_edit  (INSERT, FINANCEIRO_EDIT)
--   3. financial_proofs_update_edit  (UPDATE, FINANCEIRO_EDIT) -- cobre replace
--   4. financial_proofs_delete_blocked (DELETE, USING (false)) -- bloqueado MVP
--
-- DELETE bloqueado no MVP: comprovantes sao evidencia de pagamento e nao
-- podem ser apagados via cliente. TODO documentado em design.md §Storage:
-- futura RPC admin_repasse_delete_proof com auditoria explicita.
--
-- Padrao herdado de 035_admin_blacklist.sql (bucket privado idempotente).
-- ============================================================================

-- 12.1 - Bucket privado financial_proofs (idempotente)
INSERT INTO storage.buckets (id, name, public)
VALUES ('financial_proofs', 'financial_proofs', false)
ON CONFLICT (id) DO NOTHING;


-- 12.2 - Policy SELECT: usuarios com FINANCEIRO_VIEW podem listar/baixar
DROP POLICY IF EXISTS financial_proofs_select_view ON storage.objects;
CREATE POLICY financial_proofs_select_view
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'financial_proofs'
    AND is_admin_with_permission('FINANCEIRO_VIEW')
  );


-- 12.3 - Policy INSERT: usuarios com FINANCEIRO_EDIT podem fazer upload
DROP POLICY IF EXISTS financial_proofs_insert_edit ON storage.objects;
CREATE POLICY financial_proofs_insert_edit
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'financial_proofs'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  );


-- 12.4 - Policy UPDATE: usuarios com FINANCEIRO_EDIT podem replace
--        (sobrescrita do mesmo path apos estorno + nova marcacao como pago)
DROP POLICY IF EXISTS financial_proofs_update_edit ON storage.objects;
CREATE POLICY financial_proofs_update_edit
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'financial_proofs'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  )
  WITH CHECK (
    bucket_id = 'financial_proofs'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  );


-- 12.5 - Policy DELETE: BLOQUEADA no MVP. Comprovantes sao evidencia
--        permanente. TODO: substituir por RPC admin_repasse_delete_proof
--        com auditoria FINANCIAL_PROOF_DELETED (ver design.md §Storage).
DROP POLICY IF EXISTS financial_proofs_delete_blocked ON storage.objects;
CREATE POLICY financial_proofs_delete_blocked
  ON storage.objects FOR DELETE
  TO authenticated
  USING (false);


COMMIT;

/*
-- Smoke test pos-deploy. Descomentar e rodar manualmente em DEV. Nunca
-- aplicar via migration. admin-financeiro 037.

SELECT 'financial_settings exists' AS check, COUNT(*) AS n
  FROM information_schema.tables
 WHERE table_schema='public' AND table_name='financial_settings';

SELECT 'financial_repasses exists' AS check, COUNT(*) AS n
  FROM information_schema.tables
 WHERE table_schema='public' AND table_name='financial_repasses';

SELECT 'compute_commission_value exists' AS check, proname
  FROM pg_proc WHERE proname='compute_commission_value';

SELECT 'trigger on_frete_close_create_repasse exists' AS check, tgname
  FROM pg_trigger WHERE tgname='on_frete_close_create_repasse';

SELECT 'RPCs exist' AS check, proname FROM pg_proc
 WHERE proname IN (
   'admin_financeiro_settings_get',
   'admin_financeiro_settings_update',
   'admin_repasse_mark_paid',
   'admin_repasse_estornar',
   'admin_repasses_list',
   'admin_financeiro_summary'
 );

SELECT 'bucket exists' AS check, id FROM storage.buckets WHERE id='financial_proofs';

SELECT 'storage policies exist' AS check, policyname FROM pg_policies
 WHERE schemaname='storage' AND tablename='objects'
   AND policyname LIKE 'financial_proofs_%';

-- Determinismo da funcao pura (mesmo input -> mesmo output).
SELECT compute_commission_value(1000, '{"commission_pct": 10, "commission_brackets": []}'::jsonb);
SELECT compute_commission_value(1000, '{"commission_pct": 10, "commission_brackets": []}'::jsonb);

-- Idempotencia da migration: reaplicar nao falha nem duplica objetos
-- (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY
--  IF EXISTS, INSERT ... ON CONFLICT DO NOTHING).
*/
