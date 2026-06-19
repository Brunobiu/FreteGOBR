-- ============================================================================
-- Migration 116: Cliente_360 — Pesquisa Global + Visao 360 do Cliente
-- ============================================================================
-- Spec: .kiro/specs/admin-cliente-360/{requirements,design,tasks}.md
--
-- Segunda das quatro specs do dono. AMPLIA o que ja esta em producao sem
-- recriar nem quebrar modulos existentes (admin-users 031, admin-financeiro
-- 037, assinaturas-pagamento 055, notifications-hub 041, suporte-inteligente
-- 115, chat 008, security 005). Cria UMA tabela nova (admin_user_notes); todas
-- as demais tabelas sao apenas LIDAS.
--
-- ENTREGA (tasks 1.1 a 1.6 do tasks.md):
--   - admin_user_notes (Internal_Note) + trigger updated_at + indice (Req 13.1).
--   - RLS admin-only em admin_user_notes: SELECT sob USER_NOTE_VIEW; escrita
--     direta sempre negada (mutacao so via RPC SECURITY DEFINER) (Req 13.4/13.5).
--   - RBAC: re-assere is_admin_with_permission preservando integralmente o corpo
--     vigente (030 + deny-list 048 + FAQ_VIEW de 115). USER_NOTE_VIEW/EDIT sao
--     reconhecidas POR CONSTRUCAO: SUPER_ADMIN (wildcard) e ADMIN (allow-all
--     menos deny-list) as recebem; SUPORTE/FINANCEIRO/MODERADOR (allowlists
--     fechadas) as negam. Sem ramo dedicado (Req 13.2/13.3).
--   - RPCs SECURITY DEFINER de leitura: admin_global_search (USER_VIEW),
--     admin_user_financial_history (FINANCEIRO_VIEW), admin_user_login_history
--     (USER_VIEW) (Req 2,3,4,9,12).
--   - RPCs SECURITY DEFINER de CRUD de Internal_Note: admin_user_note_create /
--     _update / _delete (USER_NOTE_EDIT), com precedencia de permission_denied,
--     protecao do Master_Admin, versionamento otimista e idempotencia _SKIPPED
--     so na inexistencia (Req 13,14, CP-5/CP-7).
--
-- DEPENDENCIAS (validadas no DO $check$):
--   030 admin-foundation: is_admin_with_permission, admin_audit_logs.
--   055 assinaturas-pagamento: users.subscription_status, subscriptions,
--       subscription_charges.
--   037 admin-financeiro: financial_repasses.
--   041 notifications-hub: support_tickets.
--   008 chat: conversations.
--   005 security-tables: login_attempts.
--
-- CORRECOES ao rascunho de design (verificadas no schema real):
--   - embarcadores tem PK `id` == users.id (NAO existe coluna user_id). O JOIN
--     da busca usa `e.id = u.id`.
--   - A policy de negacao de escrita e PERMISSIVE (nao RESTRICTIVE): politicas
--     permissivas sao combinadas por OR no SELECT, entao a leitura continua
--     regida so por admin_user_notes_select; uma policy RESTRICTIVE faria AND e
--     quebraria o SELECT.
--
-- IDEMPOTENTE (admin-patterns Sec. 9): CREATE TABLE/INDEX IF NOT EXISTS,
--   CREATE OR REPLACE FUNCTION, DROP POLICY/TRIGGER IF EXISTS antes de CREATE.
--   Envolvida em BEGIN; ... COMMIT;. Par documentado (nao auto-aplicado):
--   116_admin_cliente_360_rollback.sql.
--
-- Idioma: identifiers / action codes / error codes em ingles (UPPER_SNAKE);
--   mensagens user-facing pt-BR moram no client.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Validacoes defensivas: dependencias precisam estar aplicadas (Req 16.3)
-- ────────────────────────────────────────────────────────────────────────────

DO $check$
BEGIN
  -- Fundacao (030)
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                  WHERE routine_schema='public' AND routine_name='is_admin_with_permission') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='admin_audit_logs') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;

  -- users + colunas de assinatura (055)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='users'
                    AND column_name='subscription_status') THEN
    RAISE EXCEPTION 'Migration 055 (assinaturas-pagamento) nao aplicada: users.subscription_status ausente';
  END IF;

  -- Financeiro / assinaturas
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='subscriptions') THEN
    RAISE EXCEPTION 'Migration 055 (assinaturas-pagamento) nao aplicada: subscriptions ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='subscription_charges') THEN
    RAISE EXCEPTION 'Migration 055 (assinaturas-pagamento) nao aplicada: subscription_charges ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='financial_repasses') THEN
    RAISE EXCEPTION 'Migration 037 (admin-financeiro) nao aplicada: financial_repasses ausente';
  END IF;

  -- Suporte (041)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='support_tickets') THEN
    RAISE EXCEPTION 'Migration 041 (notifications-hub) nao aplicada: support_tickets ausente';
  END IF;

  -- Chat de frete (008)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='conversations') THEN
    RAISE EXCEPTION 'Migration 008 (chat) nao aplicada: conversations ausente';
  END IF;

  -- Login attempts (005)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='login_attempts') THEN
    RAISE EXCEPTION 'Migration 005 (security-tables) nao aplicada: login_attempts ausente';
  END IF;
END
$check$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tabela admin_user_notes (Internal_Note) — Req 13.1
-- ────────────────────────────────────────────────────────────────────────────
-- user_id ON DELETE CASCADE: a nota pertence ao Cliente; excluir o Cliente as
-- remove (sem nota orfa). author_id ON DELETE SET NULL: preserva a nota mesmo
-- se o admin autor for removido. body com CHECK 1..5000 (defesa em profundidade:
-- tabela + RPC + frontend).
CREATE TABLE IF NOT EXISTS admin_user_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id   uuid        NULL     REFERENCES users(id) ON DELETE SET NULL,
  body        text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_user_notes_user_created
  ON admin_user_notes (user_id, created_at DESC);

COMMENT ON TABLE  admin_user_notes            IS 'Observacoes internas do admin sobre um Cliente. NUNCA visiveis ao Cliente (admin-cliente-360 / 116).';
COMMENT ON COLUMN admin_user_notes.user_id    IS 'Cliente alvo. ON DELETE CASCADE: excluir o Cliente remove suas notas.';
COMMENT ON COLUMN admin_user_notes.author_id  IS 'Admin autor. ON DELETE SET NULL: preserva a nota mesmo se o autor for excluido.';
COMMENT ON COLUMN admin_user_notes.body       IS 'Corpo 1..5000 chars (validado tambem na RPC e no frontend).';

-- 1.1 Trigger updated_at (idempotente; nao depende de outra migration)
CREATE OR REPLACE FUNCTION admin_user_notes_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $func$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_admin_user_notes_updated_at ON admin_user_notes;
CREATE TRIGGER trg_admin_user_notes_updated_at
  BEFORE UPDATE ON admin_user_notes
  FOR EACH ROW EXECUTE FUNCTION admin_user_notes_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS de admin_user_notes — admin-only (Req 13.4, 13.5, CP-6)
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT: somente admin com USER_NOTE_VIEW. Nenhuma policy concede acesso a
-- anon, a usuario comum ou ao proprio Cliente => CP-6 (notas nunca expostas).
-- Escrita direta sempre negada: o CRUD legitimo passa pelas RPCs SECURITY
-- DEFINER (que bypassam RLS). A policy de negacao e PERMISSIVE com USING/CHECK
-- false: politicas permissivas sao combinadas por OR no SELECT, entao a leitura
-- continua regida apenas por admin_user_notes_select; INSERT/UPDATE/DELETE
-- diretos batem em WITH CHECK/USING false e sao negados.
ALTER TABLE admin_user_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_user_notes_select ON admin_user_notes;
CREATE POLICY admin_user_notes_select ON admin_user_notes
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('USER_NOTE_VIEW'));

DROP POLICY IF EXISTS admin_user_notes_no_direct_write ON admin_user_notes;
CREATE POLICY admin_user_notes_no_direct_write ON admin_user_notes
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RBAC — re-assercao de is_admin_with_permission (Req 13.2, 13.3, CP-8)
-- ────────────────────────────────────────────────────────────────────────────
-- Recriacao idempotente que PRESERVA INTEGRALMENTE o corpo vigente (030 +
-- deny-list de marketing/assistant de 048 + grant FAQ_VIEW ao SUPORTE de 115).
-- USER_NOTE_VIEW/USER_NOTE_EDIT NAO exigem ramo proprio:
--   - SUPER_ADMIN => wildcard (recebe).
--   - ADMIN       => allow-all menos deny-list; USER_NOTE_* NAO estao na
--                    deny-list => ADMIN recebe (Req 13.3).
--   - SUPORTE / FINANCEIRO / MODERADOR => allowlists fechadas que NAO listam
--                    USER_NOTE_* => negados por construcao (Req 13.3).
-- Nao criamos ramo dedicado para evitar mascarar regressoes na deny-list.
-- Paridade 1:1 com src/services/admin/permissions.ts. Caller anonimo
-- (auth.uid() nulo) nao possui linha em `active` => false (deny-by-default).
CREATE OR REPLACE FUNCTION is_admin_with_permission(p_action text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  WITH active AS (
    SELECT role
    FROM admin_roles
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1 FROM active a
    WHERE
      a.role = 'SUPER_ADMIN'
      OR (a.role = 'ADMIN' AND p_action NOT IN
           ('USER_DELETE','ADMIN_ROLE_GRANT','ADMIN_ROLE_REVOKE',
            'ASSISTANT_VIEW','ASSISTANT_EDIT'))
      OR (a.role = 'FINANCEIRO' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FINANCEIRO_VIEW','FINANCEIRO_EDIT','AUDIT_VIEW'))
      OR (a.role = 'SUPORTE' AND p_action IN
           ('USER_VIEW','USER_TOGGLE_ACTIVE','FRETE_VIEW',
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW','FAQ_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_EDIT'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC admin_global_search (Pesquisa Global) — Req 2, 3, 4, CP-1/2/3
-- ────────────────────────────────────────────────────────────────────────────
-- Search_Result = { id, user_type, name, email, phone, company_name,
--                   matched_field, match_rank }. Ordenacao total deterministica
-- no SQL: match_rank ASC -> name ASC -> id ASC (id unico => desempate total).
-- Sanitized_Query: trim + colapso de espacos + escape de % _ \ com ESCAPE '\'.
-- Privacidade: NAO loga Search_Query bruto; phone_digits/cpf_digits sao colunas
-- de trabalho removidas do JSON final. Telefone/CPF so casam com >= 8 digitos.
CREATE OR REPLACE FUNCTION admin_global_search(p_query text, p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_raw      text := COALESCE(p_query, '');
  v_norm     text;          -- trim + colapso de espacos
  v_escaped  text;          -- escape de % _ \ para ILIKE
  v_digits   text;          -- somente digitos (telefone/cpf)
  v_is_uuid  boolean := false;
  v_uuid     uuid;
  v_limit    int;
  v_result   jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('USER_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'GLOBAL_SEARCH_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: USER_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- clamp do limit em [1,50], default 20 quando ausente/fora (Req 2.8)
  v_limit := COALESCE(p_limit, 20);
  IF v_limit < 1 OR v_limit > 50 THEN v_limit := 20; END IF;

  -- Sanitized_Query: trim + colapso de espacos internos (Req 2.2)
  v_norm := regexp_replace(btrim(v_raw), '\s+', ' ', 'g');

  -- deteccao de UUID exato (Req 2.6, 3.1)
  BEGIN
    v_uuid := v_norm::uuid; v_is_uuid := true;
  EXCEPTION WHEN others THEN v_is_uuid := false;
  END;

  v_digits := regexp_replace(v_norm, '\D', '', 'g');

  -- query vazia/curta e nao-UUID => conjunto vazio sem erro (Req 2.3)
  IF NOT v_is_uuid AND char_length(v_norm) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- escape dos curingas de ILIKE: \ primeiro, depois % e _ (Req 2.2, CP-3)
  v_escaped := replace(replace(replace(v_norm, '\', '\\'), '%', '\%'), '_', '\_');

  WITH base AS (
    SELECT u.id, u.user_type, u.name, u.email, u.phone,
           e.company_name,
           regexp_replace(COALESCE(u.phone,''), '\D', '', 'g') AS phone_digits,
           regexp_replace(COALESCE(u.cpf,''),   '\D', '', 'g') AS cpf_digits
    FROM users u
    LEFT JOIN embarcadores e ON e.id = u.id     -- embarcadores.id == users.id
    WHERE u.user_type IN ('motorista','embarcador')   -- exclui admin (Req 2.7, CP-2)
  ),
  matched AS (
    SELECT b.id, b.user_type, b.name, b.email, b.phone, b.company_name,
      -- matched_field e match_rank deterministicos (Req 3.1-3.3)
      CASE
        WHEN v_is_uuid AND b.id = v_uuid                                   THEN 'id'
        WHEN b.email IS NOT NULL AND lower(b.email) = lower(v_norm)        THEN 'email'
        WHEN char_length(v_digits) >= 8 AND b.phone_digits = v_digits      THEN 'phone'
        WHEN b.name ILIKE v_escaped || '%' ESCAPE '\'                      THEN 'name'
        WHEN b.company_name ILIKE v_escaped || '%' ESCAPE '\'              THEN 'company_name'
        WHEN b.name ILIKE '%' || v_escaped || '%' ESCAPE '\'              THEN 'name'
        WHEN b.email ILIKE '%' || v_escaped || '%' ESCAPE '\'            THEN 'email'
        WHEN b.company_name ILIKE '%' || v_escaped || '%' ESCAPE '\'      THEN 'company_name'
        WHEN char_length(v_digits) >= 8
             AND (b.phone_digits ILIKE '%'||v_digits||'%'
                  OR b.cpf_digits ILIKE '%'||v_digits||'%')               THEN 'phone'
        ELSE NULL
      END AS matched_field,
      CASE
        WHEN (v_is_uuid AND b.id = v_uuid)
          OR (b.email IS NOT NULL AND lower(b.email) = lower(v_norm))
          OR (char_length(v_digits) >= 8 AND b.phone_digits = v_digits)   THEN 0
        WHEN b.name ILIKE v_escaped || '%' ESCAPE '\'
          OR b.company_name ILIKE v_escaped || '%' ESCAPE '\'             THEN 1
        ELSE 2
      END AS match_rank
    FROM base b
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.match_rank ASC, m.name ASC, m.id ASC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM matched WHERE matched_field IS NOT NULL
    ORDER BY match_rank ASC, name ASC, id ASC
    LIMIT v_limit
  ) m;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION admin_global_search(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_global_search(text, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPC admin_user_financial_history — Req 9
-- ────────────────────────────────────────────────────────────────────────────
-- Le subscriptions / subscription_charges (do p_user_id) e financial_repasses
-- (embarcador_id ou motorista_id = p_user_id) sob SECURITY DEFINER, sem afrouxar
-- a RLS dessas tabelas. Clampa p_limit em [1,200] (default 50). Retorna
-- { plan, charges[], repasses[] }, charges/repasses por data desc. Remove
-- identificadores de gateway (asaas_*) do JSON.
CREATE OR REPLACE FUNCTION admin_user_financial_history(p_user_id uuid, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller    uuid := auth.uid();
  v_limit     int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_plan      jsonb;
  v_charges   jsonb;
  v_repasses  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('FINANCEIRO_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'FINANCEIRO_VIEW_DENIED', 'users', p_user_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(s) - 'asaas_customer_id' - 'asaas_subscription_id'
    INTO v_plan
  FROM subscriptions s WHERE s.user_id = p_user_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) - 'asaas_payment_id' ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_charges
  FROM (SELECT * FROM subscription_charges WHERE user_id = p_user_id
        ORDER BY created_at DESC LIMIT v_limit) c;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', r.id, 'valor_bruto', r.valor_bruto, 'commission_value', r.commission_value,
            'valor_liquido', r.valor_liquido, 'status', r.status,
            'closed_at', r.closed_at, 'paid_at', r.paid_at,
            'role', CASE WHEN r.embarcador_id = p_user_id THEN 'embarcador' ELSE 'motorista' END)
            ORDER BY r.closed_at DESC), '[]'::jsonb)
    INTO v_repasses
  FROM (SELECT * FROM financial_repasses
        WHERE embarcador_id = p_user_id OR motorista_id = p_user_id
        ORDER BY closed_at DESC LIMIT v_limit) r;

  RETURN jsonb_build_object('plan', v_plan, 'charges', v_charges, 'repasses', v_repasses);
END;
$func$;

REVOKE ALL ON FUNCTION admin_user_financial_history(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_user_financial_history(uuid, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RPC admin_user_login_history — Req 12, CP-9*
-- ────────────────────────────────────────────────────────────────────────────
-- Correlaciona login_attempts pelo telefone normalizado (somente digitos) do
-- Cliente. login_attempts tem RLS USING(false) (service-role) => so esta RPC
-- SECURITY DEFINER a le, sem afrouxar a RLS. Retorna estrutura mesmo sem
-- telefone (lista vazia) e informa a janela de retencao (~30 dias).
CREATE OR REPLACE FUNCTION admin_user_login_history(p_user_id uuid, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller    uuid := auth.uid();
  v_limit     int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_digits    text;
  v_attempts  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('USER_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'USER_VIEW_DENIED', 'users', p_user_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: USER_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT regexp_replace(COALESCE(phone,''), '\D', '', 'g') INTO v_digits
  FROM users WHERE id = p_user_id;

  IF v_digits IS NULL OR char_length(v_digits) = 0 THEN
    RETURN jsonb_build_object('attempts', '[]'::jsonb, 'retention_days', 30, 'has_phone', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'created_at', la.created_at, 'success', la.success,
            'failure_reason', la.failure_reason,
            'ip_address', la.ip_address, 'user_agent', la.user_agent)
            ORDER BY la.created_at DESC), '[]'::jsonb)
    INTO v_attempts
  FROM (SELECT * FROM login_attempts
        WHERE regexp_replace(COALESCE(phone,''), '\D', '', 'g') = v_digits
        ORDER BY created_at DESC LIMIT v_limit) la;

  RETURN jsonb_build_object('attempts', v_attempts, 'retention_days', 30, 'has_phone', true);
END;
$func$;

REVOKE ALL ON FUNCTION admin_user_login_history(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_user_login_history(uuid, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. CRUD de Internal_Note — Req 13, 14, CP-5, CP-7
-- ────────────────────────────────────────────────────────────────────────────
-- Postura comum: auth.uid() -> gating USER_NOTE_EDIT (com USER_NOTE_VIEW_DENIED)
-- -> protecao do Master_Admin -> validacao de input. A precedencia de
-- permission_denied (CP-5) e ESTRUTURAL: o gating ocorre ANTES de qualquer
-- validacao de body/expected_updated_at.

-- 7.1 CREATE (Req 14.2, 14.3, 14.9)
CREATE OR REPLACE FUNCTION admin_user_note_create(p_user_id uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_id uuid; v_now timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('USER_NOTE_EDIT') THEN          -- precedencia (CP-5)
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'USER_NOTE_VIEW_DENIED', 'admin_user_notes', p_user_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: USER_NOTE_EDIT required' USING ERRCODE = '42501';
  END IF;
  -- Master imutavel: nota nao pode ter como alvo o master (Req 14.9)
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND admin_username = 'Nexus_Vortex99') THEN
    RAISE EXCEPTION 'master_admin_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF p_body IS NULL OR char_length(btrim(p_body)) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'invalid_input: body length must be 1..5000' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO admin_user_notes(user_id, author_id, body)
  VALUES (p_user_id, v_caller, p_body)
  RETURNING id, updated_at INTO v_id, v_now;

  RETURN jsonb_build_object('id', v_id, 'created_at', v_now, 'updated_at', v_now);
END;
$func$;

-- 7.2 UPDATE (Req 14.4, 14.5: STALE_VERSION)
CREATE OR REPLACE FUNCTION admin_user_note_update(
  p_note_id uuid, p_body text, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_rows int; v_now timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('USER_NOTE_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'USER_NOTE_VIEW_DENIED', 'admin_user_notes', p_note_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: USER_NOTE_EDIT required' USING ERRCODE = '42501';
  END IF;
  IF p_body IS NULL OR char_length(btrim(p_body)) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'invalid_input: body length must be 1..5000' USING ERRCODE = 'P0001';
  END IF;

  UPDATE admin_user_notes
     SET body = p_body  -- updated_at e tocado pelo trigger
   WHERE id = p_note_id
     AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_now;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    -- distingue inexistencia de divergencia de versao
    IF NOT EXISTS (SELECT 1 FROM admin_user_notes WHERE id = p_note_id) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_now);
END;
$func$;

-- 7.3 DELETE idempotente (Req 14.6, 14.7, 14.10, CP-7)
CREATE OR REPLACE FUNCTION admin_user_note_delete(p_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('USER_NOTE_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'USER_NOTE_VIEW_DENIED', 'admin_user_notes', p_note_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: USER_NOTE_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- idempotencia EXCLUSIVAMENTE na inexistencia (Req 14.7, 14.10)
  IF NOT EXISTS (SELECT 1 FROM admin_user_notes WHERE id = p_note_id) THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'USER_NOTE_DELETE_SKIPPED', 'admin_user_notes', p_note_id::text, NULL,
            jsonb_build_object('reason', 'ALREADY_REMOVED'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_REMOVED');
  END IF;

  DELETE FROM admin_user_notes WHERE id = p_note_id;   -- qualquer outro erro propaga normalmente
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', v_rows);
END;
$func$;

REVOKE ALL ON FUNCTION admin_user_note_create(uuid, text)              FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_user_note_update(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_user_note_delete(uuid)                    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_user_note_create(uuid, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION admin_user_note_update(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_user_note_delete(uuid)                    TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFY (smoke manual — comentado; nao executa no push)
-- ============================================================================
/*
-- Tabela + RLS habilitada:
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'admin_user_notes';

-- Policies de admin_user_notes (espera-se admin_user_notes_select [SELECT] e
-- admin_user_notes_no_direct_write [ALL]):
SELECT polname, polcmd, polpermissive FROM pg_policy
 WHERE polrelid = 'admin_user_notes'::regclass ORDER BY polname;

-- Trigger updated_at:
SELECT tgname FROM pg_trigger WHERE tgrelid = 'admin_user_notes'::regclass
   AND NOT tgisinternal;

-- Existencia das 6 RPCs:
SELECT proname FROM pg_proc
 WHERE proname IN ('admin_global_search','admin_user_financial_history',
                   'admin_user_login_history','admin_user_note_create',
                   'admin_user_note_update','admin_user_note_delete')
 ORDER BY proname;

-- Grant efetivo das acoes novas (rodar autenticado como cada papel em teste de
-- integracao; espera-se TRUE so para SUPER_ADMIN/ADMIN):
--   SELECT is_admin_with_permission('USER_NOTE_VIEW'),
--          is_admin_with_permission('USER_NOTE_EDIT');
*/
