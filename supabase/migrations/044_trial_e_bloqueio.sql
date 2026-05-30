-- =====================================================
-- Migration 044: trial-e-bloqueio
--
-- Adiciona o periodo de teste gratuito (trial) de 30 dias
-- exclusivo para motoristas, o bloqueio de acesso por trial
-- expirado, a protecao anti-fraude no cadastro e o reflexo
-- no painel admin. Construida sobre as fundacoes:
--   - 030_admin_foundation.sql (is_admin_with_permission, admin_audit_logs)
--   - 031_admin_users.sql      (users.banned_by, Master_Admin imutavel)
--   - 008_chat_system.sql      (conversations: relacao frete <-> motorista
--                               usada para continuidade de fretes em andamento)
--
-- NOTA DE NUMERACAO: proxima livre apos 043_chat_support_admin_rls.sql.
--
-- Componentes (inventario do design "Migration 044"):
--   1. users.trial_ends_at / subscription_status / is_subscribed + CHECK de dominio
--   2. Indice parcial idx_users_trial_motoristas
--   3. Trigger users_set_trial_defaults (BEFORE INSERT)
--   4. Backfill de trial_ends_at para motoristas
--   (5..12 anexados pelas tasks 2.2, 2.3 e 2.4 neste mesmo arquivo)
--
-- A regra-mae de bloqueio NAO usa subscription_status como fonte de
-- verdade: um motorista esta bloqueado quando
--   user_type = 'motorista' AND trial_ends_at <= now() AND is_subscribed = false.
-- subscription_status e apenas um rotulo informativo de dominio fechado.
--
-- Idempotente: pode ser reaplicada sem erros.
-- Acompanhada de 044_trial_e_bloqueio_rollback.sql (task 2.5).
-- =====================================================

BEGIN;

-- ========== 0. Pre-checks defensivos ==========

-- Garante que a migration 030 (admin-foundation) esta aplicada
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao esta aplicada: is_admin_with_permission ausente';
  END IF;
END
$check$;

-- Garante que a migration 031 (admin-users) esta aplicada
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'banned_by'
  ) THEN
    RAISE EXCEPTION 'Migration 031 (admin-users) nao esta aplicada: users.banned_by ausente';
  END IF;
END
$check$;

-- Garante que a migration 008 (chat-system) esta aplicada: a tabela
-- conversations representa um frete em andamento de um motorista e e usada
-- pelas tasks seguintes (continuidade na RLS de fretes).
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'conversations'
  ) THEN
    RAISE EXCEPTION 'Migration 008 (chat-system) nao esta aplicada: tabela conversations ausente';
  END IF;
END
$check$;


-- ========== 1. Colunas de trial em users + CHECK de dominio fechado ==========

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_ends_at        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS subscription_status  TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS is_subscribed        BOOLEAN NOT NULL DEFAULT false;

-- Dominio fechado de subscription_status (rotulo informativo).
-- Padrao idempotente: DROP CONSTRAINT IF EXISTS antes de ADD (a clausula
-- ADD COLUMN IF NOT EXISTS nao recria a constraint em reaplicacoes).
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_subscription_status;
ALTER TABLE users ADD  CONSTRAINT chk_users_subscription_status
  CHECK (subscription_status IN ('trial','active','past_due','canceled','blocked'));

COMMENT ON COLUMN users.trial_ends_at       IS 'Instante de expiracao do trial. Preenchido por users_set_trial_defaults p/ motoristas; NULL p/ embarcador/admin (sem efeito sobre acesso).';
COMMENT ON COLUMN users.subscription_status IS 'Rotulo informativo de dominio fechado (trial|active|past_due|canceled|blocked). NAO e a fonte de verdade do bloqueio.';
COMMENT ON COLUMN users.is_subscribed       IS 'Assinatura paga ativa. Nesta spec permanece false para todos (sem cobranca real).';


-- ========== 2. Indice parcial para motoristas ==========

-- Acelera a listagem/filtros do painel admin e a checagem de bloqueio,
-- indexando trial_ends_at apenas para a fatia de motoristas.
CREATE INDEX IF NOT EXISTS idx_users_trial_motoristas
  ON users (trial_ends_at) WHERE user_type = 'motorista';


-- ========== 3. Trigger users_set_trial_defaults (concessao do trial) ==========

-- BEFORE INSERT: motorista sem trial_ends_at recebe created_at + 30 dias.
-- Embarcador/admin nao sao tocados (trial_ends_at fica NULL, sem efeito).
-- subscription_status / is_subscribed ja recebem os defaults da coluna.
CREATE OR REPLACE FUNCTION users_set_trial_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  IF NEW.user_type = 'motorista' AND NEW.trial_ends_at IS NULL THEN
    NEW.trial_ends_at := COALESCE(NEW.created_at, NOW()) + INTERVAL '30 days';
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS users_set_trial_defaults ON users;
CREATE TRIGGER users_set_trial_defaults
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION users_set_trial_defaults();


-- ========== 4. Backfill de trial_ends_at para motoristas existentes ==========

-- Fiel ao requisito (created_at + 30 dias). Motoristas antigos (criados ha
-- mais de 30 dias) ficarao imediatamente classificados como bloqueados.
-- Uma eventual janela de carencia para a base existente e decisao de produto
-- (ver NOTA OPERACIONAL no design) e ficaria em uma 044b posterior.
-- Idempotente: so afeta linhas ainda com trial_ends_at NULL.
UPDATE users
   SET trial_ends_at = created_at + INTERVAL '30 days'
 WHERE user_type = 'motorista'
   AND trial_ends_at IS NULL;


-- ========== 5. Predicado de bloqueio no servidor ==========

-- Fonte de verdade do bloqueio (defense-in-depth). Retorna true EXATAMENTE
-- quando o usuario e motorista AND is_subscribed = false AND trial_ends_at
-- NAO e NULL AND trial_ends_at <= now(). Para qualquer outro caso
-- (id inexistente/NULL, embarcador, admin, assinante, trial_ends_at NULL ou
-- ainda no futuro) retorna false.
--
-- STABLE: nao muda o banco e da resultados consistentes dentro de um mesmo
-- statement. SECURITY DEFINER + SET search_path = public: pode ler users
-- ignorando RLS e fica imune a search-path attacks. Usada pela RLS de fretes
-- (secao 6), pelo guard de toggle_frete_like (secao 7) e pelos RPCs admin.
CREATE OR REPLACE FUNCTION is_motorista_trial_blocked(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p_user_id
      AND u.user_type = 'motorista'
      AND u.is_subscribed = false
      AND u.trial_ends_at IS NOT NULL
      AND u.trial_ends_at <= NOW()
  );
$func$;

COMMENT ON FUNCTION is_motorista_trial_blocked(uuid) IS 'Predicado de bloqueio por trial expirado. true sse motorista nao-assinante com trial_ends_at <= now(). NULL/embarcador/admin/assinante => false.';

-- Posture de seguranca: so authenticated executa (a RLS/RPC ja roda no
-- contexto do caller autenticado). REVOKE defensivo de PUBLIC.
REVOKE ALL ON FUNCTION is_motorista_trial_blocked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_motorista_trial_blocked(uuid) TO authenticated;


-- ========== 6. RLS de fretes: continuidade + bloqueio do feed ==========

-- Substitui a fretes_select_policy original (migration 003), que era:
--   USING ( status = 'ativo'
--           OR embarcador_id = auth.uid()
--           OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type='admin') )
--
-- O que e PRESERVADO da semantica original:
--   - embarcador dono ve os proprios fretes (qualquer status);
--   - admin ve todos (branch via users.user_type='admin');
--   - quem NAO e motorista bloqueado continua vendo o feed 'ativo'
--     (anonimo/embarcador/admin/motorista em trial), pois
--     is_motorista_trial_blocked retorna false nesses casos, tornando
--     NOT is_motorista_trial_blocked(...) verdadeiro.
--
-- O que MUDA (apenas adicoes):
--   - continuidade (Req 9.4): motorista bloqueado ainda enxerga fretes com
--     conversa propria (frete em andamento), via EXISTS em conversations;
--   - feed bloqueado (Req 9.1): o branch 'ativo' passa a exigir
--     NOT is_motorista_trial_blocked(auth.uid()), removendo o feed geral
--     apenas para o motorista com trial expirado e sem assinatura.
--
-- A policy admin separada fretes_admin_select (migration 032) permanece
-- intacta; policies permissivas se combinam por OR.
DROP POLICY IF EXISTS fretes_select_policy ON fretes;
CREATE POLICY fretes_select_policy ON fretes
FOR SELECT
USING (
  embarcador_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
  OR EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.frete_id = fretes.id
      AND c.motorista_id = auth.uid()
  )  -- continuidade: frete em andamento do motorista (Req 9.4)
  OR (
    status = 'ativo'
    AND NOT is_motorista_trial_blocked(auth.uid())
  )  -- feed 'ativo' negado ao motorista com trial expirado (Req 9.1, 9.2)
);


-- ========== 7. Guard de trial em toggle_frete_like ==========

-- Reaplica toggle_frete_like (migration 021) PRESERVANDO toda a logica
-- original (toggle like/unlike + notificacao ao embarcador + contagem) e
-- apenas PRE-pendendo o guard de bloqueio: motorista bloqueado nao cria novo
-- like/contato (novo "aceite" - Req 6.3, 9.2). O guard fica logo apos a
-- checagem de autenticacao (auth.uid()), seguindo a postura de seguranca
-- (auth primeiro, depois regra de negocio). REVOKE/GRANT mantidos como no
-- original (somente GRANT EXECUTE a authenticated; nao havia REVOKE).
CREATE OR REPLACE FUNCTION toggle_frete_like(p_frete_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_motorista_id   UUID := auth.uid();
  v_motorista_name TEXT;
  v_embarcador_id  UUID;
  v_frete_origin   TEXT;
  v_frete_dest     TEXT;
  v_existing_id    UUID;
  v_total          INT;
BEGIN
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Guard de trial (Req 6.3, 9.2): motorista bloqueado nao pode aceitar/
  -- curtir um novo frete, mesmo que tenha fretes em andamento. A
  -- continuidade (fretes ja aceitos) e garantida pela RLS de fretes, nao
  -- por novos likes.
  IF is_motorista_trial_blocked(v_motorista_id) THEN
    RAISE EXCEPTION 'trial_blocked' USING ERRCODE = 'P0001';
  END IF;

  SELECT embarcador_id, origin, destination
    INTO v_embarcador_id, v_frete_origin, v_frete_dest
    FROM fretes
   WHERE id = p_frete_id;

  IF v_embarcador_id IS NULL THEN
    RAISE EXCEPTION 'frete not found';
  END IF;

  SELECT id INTO v_existing_id
    FROM frete_likes
   WHERE frete_id    = p_frete_id
     AND motorista_id = v_motorista_id;

  IF v_existing_id IS NOT NULL THEN
    DELETE FROM frete_likes WHERE id = v_existing_id;
    -- Remove a notificação correspondente desse motorista nesse frete
    DELETE FROM notifications
     WHERE user_id = v_embarcador_id
       AND type    = 'frete_like'
       AND link    = '/embarcador?frete=' || p_frete_id::text || '&motorista=' || v_motorista_id::text;
    SELECT count(*) INTO v_total FROM frete_likes WHERE frete_id = p_frete_id;
    RETURN jsonb_build_object('liked', false, 'total', v_total);
  END IF;

  INSERT INTO frete_likes (frete_id, motorista_id) VALUES (p_frete_id, v_motorista_id);

  SELECT name INTO v_motorista_name FROM users WHERE id = v_motorista_id;

  INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (
      v_embarcador_id,
      'frete_like',
      'Motorista interessado',
      coalesce(v_motorista_name, 'Um motorista')
        || ' curtiu o seu frete ' || v_frete_origin || ' → ' || v_frete_dest,
      '/embarcador?frete=' || p_frete_id::text || '&motorista=' || v_motorista_id::text
    );

  SELECT count(*) INTO v_total FROM frete_likes WHERE frete_id = p_frete_id;
  RETURN jsonb_build_object('liked', true, 'total', v_total);
END;
$fn$;

-- REVOKE/GRANT preservados como no original (migration 021).
GRANT EXECUTE ON FUNCTION toggle_frete_like(UUID) TO authenticated;


-- ========== 8. Anti-fraude: checagem isolada de disponibilidade ==========

-- is_identifier_available(p_type, p_value): retorna true quando o
-- identificador (phone|cpf|email) NAO consta em nenhuma conta existente
-- (Req 8.7 - resultado booleano isolado, sem criar conta). E usada como
-- pre-check de UX no auth.register (uma chamada por identificador antes do
-- INSERT). NAO e a autoridade da atomicidade: o aborto definitivo de
-- cadastros duplicados e responsabilidade do trigger da secao 9 (Req 8.5).
--
-- Normalizacao (paridade com o modelo puro TS normalizeIdentifier):
--   phone: remove nao-digitos; se ficar com 12 ou 13 digitos e comecar com
--          '55' (DDI Brasil), descarta o '55' para comparar so DDD+numero;
--   cpf:   remove nao-digitos; compara apenas quando v_norm <> '' (evita que
--          cadastros sem cpf colidam entre si por string vazia);
--   email: lower(trim(...)); idem guarda de string vazia.
--
-- STABLE: nao escreve e e consistente dentro de um statement. SECURITY
-- DEFINER + SET search_path = public: le users ignorando RLS (necessario
-- pre-signup) e fica imune a search-path attacks. RAISE para p_type invalido.
CREATE OR REPLACE FUNCTION is_identifier_available(p_type text, p_value text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_norm   text;
  v_exists boolean;
BEGIN
  IF p_type = 'phone' THEN
    v_norm := regexp_replace(p_value, '\D', '', 'g');
    IF length(v_norm) IN (12, 13) AND left(v_norm, 2) = '55' THEN
      v_norm := substring(v_norm, 3);
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM users
       WHERE regexp_replace(phone, '\D', '', 'g') = v_norm
    ) INTO v_exists;
  ELSIF p_type = 'cpf' THEN
    v_norm := regexp_replace(p_value, '\D', '', 'g');
    SELECT EXISTS (
      SELECT 1 FROM users
       WHERE regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_norm
         AND v_norm <> ''
    ) INTO v_exists;
  ELSIF p_type = 'email' THEN
    v_norm := lower(trim(p_value));
    SELECT EXISTS (
      SELECT 1 FROM users
       WHERE lower(trim(coalesce(email, ''))) = v_norm
         AND v_norm <> ''
    ) INTO v_exists;
  ELSE
    RAISE EXCEPTION 'invalid_identifier_type: %', p_type USING ERRCODE = 'P0001';
  END IF;

  RETURN NOT v_exists;  -- true = disponivel; sem criar conta (independente do bloqueio de criacao)
END;
$func$;

COMMENT ON FUNCTION is_identifier_available(text, text) IS 'Checagem isolada de disponibilidade (phone|cpf|email): true sse o identificador normalizado nao consta em users. Pre-signup; nao cria conta. Atomicidade do anti-fraude e do trigger users_antifraud_duplicate_block.';

-- Posture de seguranca: pre-signup, como is_blacklisted. Exposta a anon e
-- authenticated (o pre-check roda antes do login). REVOKE defensivo de PUBLIC.
REVOKE ALL ON FUNCTION is_identifier_available(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_identifier_available(text, text) TO anon, authenticated;


-- ========== 9. Trigger anti-fraude: aborto atomico de duplicidade ==========

-- users_antifraud_duplicate_block(): BEFORE INSERT em users. E a AUTORIDADE
-- da atomicidade do anti-fraude (Req 8.1-8.6): verifica phone/cpf/email do
-- NEW contra OUTRAS contas (id <> NEW.id) usando a MESMA normalizacao da
-- secao 8 e, em qualquer duplicidade, RAISE 'duplicate_identifier:<campo>'
-- com ERRCODE 'P0001', abortando a transacao inteira antes de qualquer linha
-- persistir. O resultado da RPC isolada is_identifier_available (Req 8.7) NAO
-- influencia este aborto.
--
-- Este e um segundo trigger BEFORE INSERT em users (alem de
-- users_set_trial_defaults, secao 3). Os dois disparam para cada INSERT e
-- sao independentes (concern distinto: defaults de trial vs. anti-fraude);
-- a ordem entre eles e irrelevante porque nenhum depende do efeito do outro.
-- SECURITY DEFINER + SET search_path = public: le users ignorando RLS e fica
-- imune a search-path attacks.
CREATE OR REPLACE FUNCTION users_antifraud_duplicate_block()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_norm text;
BEGIN
  -- phone
  IF NEW.phone IS NOT NULL THEN
    v_norm := regexp_replace(NEW.phone, '\D', '', 'g');
    IF EXISTS (
      SELECT 1 FROM users
       WHERE id <> NEW.id
         AND regexp_replace(phone, '\D', '', 'g') = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_identifier:phone' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- cpf
  IF NEW.cpf IS NOT NULL AND regexp_replace(NEW.cpf, '\D', '', 'g') <> '' THEN
    v_norm := regexp_replace(NEW.cpf, '\D', '', 'g');
    IF EXISTS (
      SELECT 1 FROM users
       WHERE id <> NEW.id
         AND regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_identifier:cpf' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- email
  IF NEW.email IS NOT NULL AND lower(trim(NEW.email)) <> '' THEN
    v_norm := lower(trim(NEW.email));
    IF EXISTS (
      SELECT 1 FROM users
       WHERE id <> NEW.id
         AND lower(trim(coalesce(email, ''))) = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_identifier:email' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION users_antifraud_duplicate_block() IS 'BEFORE INSERT em users: aborta cadastro (RAISE duplicate_identifier:<campo>, P0001) se phone/cpf/email normalizado ja existir em outra conta. Autoridade atomica do anti-fraude (Req 8.5).';

DROP TRIGGER IF EXISTS users_antifraud_duplicate_block ON users;
CREATE TRIGGER users_antifraud_duplicate_block
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION users_antifraud_duplicate_block();


-- ========== 10. RPC admin de listagem: admin_list_trial_motoristas ==========

-- Lista paginada de motoristas com status de trial computado no servidor
-- (autoridade do now()), para o painel admin (Req 10.1-10.3, 10.5).
--
-- Gating em duas camadas (admin-patterns Sec. 2 e 10):
--   1. auth.uid() IS NULL          => permission_denied (42501);
--   2. is_admin_with_permission('USER_VIEW') falso => grava audit negativo
--      TRIAL_VIEW_DENIED (before=NULL, after={user_id, reason}) e RAISE 42501.
--
-- Calculo no servidor:
--   days_left   = GREATEST(0, CEIL(EXTRACT(EPOCH FROM (trial_ends_at - now()))
--                                  / 86400.0))::int   (trial_ends_at NULL => 0,
--                 pois GREATEST ignora NULL);
--   trial_state = CASE assinante (is_subscribed)
--                      / expirado (trial_ends_at <= now())
--                      / em_trial (caso contrario).
--
-- Filtros (todos opcionais):
--   p_status         : NULL|''|'todos' => sem filtro; senao em_trial|expirado|assinante;
--   p_about_to_expire: true => days_left > 0 AND days_left <= 5 (Req 10.3);
--   p_q              : busca (>= 2 chars apos trim) ILIKE em name OR phone;
--   p_sort           : days_left_asc (default) | days_left_desc | created_desc;
--   p_limit/p_offset : paginacao (limit default 10, faixa [1,100]; offset >= 0).
--
-- Retorna jsonb { rows: [...], total, limit, offset }. Apenas motoristas.
-- Ordenacao com tiebreaker id ASC para determinismo da paginacao.
--
-- STABLE: a RPC nao muta dados de dominio. O INSERT em admin_audit_logs no
-- path negativo (TRIAL_VIEW_DENIED) e admissivel sob STABLE porque e o unico
-- ramo que escreve e encerra com RAISE (mesmo padrao de admin_repasses_list,
-- migration 037). SECURITY DEFINER + SET search_path = public.
CREATE OR REPLACE FUNCTION admin_list_trial_motoristas(
  p_status          text,
  p_about_to_expire boolean,
  p_q               text,
  p_sort            text,
  p_limit           int,
  p_offset          int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_status         text;
  v_about          boolean := COALESCE(p_about_to_expire, false);
  v_search_raw     text;
  v_search         text;
  v_search_pat     text;
  v_search_active  boolean;
  v_sort           text;
  v_limit          int;
  v_offset         int;
  v_rows           jsonb;
  v_total          int;
BEGIN
  -- ---------- Camada 1: gating ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('USER_VIEW') THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller,
      'TRIAL_VIEW_DENIED',
      NULL,
      NULL,
      NULL,
      jsonb_build_object(
        'user_id', v_caller,
        'reason',  'permission_denied',
        'rpc',     'list'
      )
    );
    RAISE EXCEPTION 'permission_denied: USER_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- ---------- Camada 2: parse + validacoes ----------
  -- status: NULL/''/'todos' => sem filtro; senao dominio fechado.
  v_status := NULLIF(p_status, '');
  IF v_status = 'todos' THEN
    v_status := NULL;
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('em_trial','expirado','assinante') THEN
    RAISE EXCEPTION 'INVALID_INPUT: status must be em_trial|expirado|assinante|todos|null'
      USING ERRCODE = 'P0001';
  END IF;

  -- sort: default days_left_asc; dominio fechado.
  v_sort := COALESCE(NULLIF(p_sort, ''), 'days_left_asc');
  IF v_sort NOT IN ('days_left_asc','days_left_desc','created_desc') THEN
    RAISE EXCEPTION 'INVALID_INPUT: sort must be days_left_asc|days_left_desc|created_desc'
      USING ERRCODE = 'P0001';
  END IF;

  -- search: ativo apenas com >= 2 chars apos trim (mesmo padrao financeiro 037).
  v_search_raw    := COALESCE(p_q, '');
  v_search        := trim(v_search_raw);
  v_search_active := char_length(v_search) >= 2;
  v_search_pat    := '%' || v_search || '%';

  -- paginacao: limit default 10 (faixa [1,100]); offset default 0 (>= 0).
  v_limit  := COALESCE(p_limit, 10);
  v_offset := COALESCE(p_offset, 0);
  IF v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_INPUT: limit must be in [1, 100]' USING ERRCODE = 'P0001';
  END IF;
  IF v_offset < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: offset must be >= 0' USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Predicado + projecao via CTEs ----------
  -- base: todos os motoristas com days_left/trial_state computados no servidor.
  -- filtered: aplica status / about_to_expire / busca.
  -- page: ordena (com tiebreaker id) e pagina; row_number garante a ordem
  --       estavel dentro do jsonb_agg. rows e total derivam do MESMO predicado.
  WITH base AS (
    SELECT
      u.id,
      u.name,
      u.phone,
      u.trial_ends_at,
      u.subscription_status,
      u.is_subscribed,
      u.updated_at,
      u.created_at,
      u.admin_username,
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM (u.trial_ends_at - NOW())) / 86400.0))::int
        AS days_left,
      CASE
        WHEN u.is_subscribed THEN 'assinante'
        WHEN u.trial_ends_at IS NOT NULL AND u.trial_ends_at <= NOW() THEN 'expirado'
        ELSE 'em_trial'
      END AS trial_state
    FROM users u
    WHERE u.user_type = 'motorista'
  ),
  filtered AS (
    SELECT b.*
      FROM base b
     WHERE (v_status IS NULL OR b.trial_state = v_status)
       AND (NOT v_about OR (b.days_left > 0 AND b.days_left <= 5))
       AND (
            NOT v_search_active
         OR b.name  ILIKE v_search_pat
         OR b.phone ILIKE v_search_pat
           )
  ),
  page AS (
    SELECT
      f.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_sort = 'days_left_asc'  THEN f.days_left  END ASC  NULLS LAST,
          CASE WHEN v_sort = 'days_left_desc' THEN f.days_left  END DESC NULLS LAST,
          CASE WHEN v_sort = 'created_desc'   THEN f.created_at END DESC NULLS LAST,
          f.id ASC
      ) AS rn
      FROM filtered f
     ORDER BY rn
     LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',                  p.id,
               'name',                p.name,
               'phone',               p.phone,
               'trial_ends_at',       p.trial_ends_at,
               'subscription_status', p.subscription_status,
               'is_subscribed',       p.is_subscribed,
               'days_left',           p.days_left,
               'trial_state',         p.trial_state,
               'updated_at',          p.updated_at,
               'admin_username',      p.admin_username
             ) ORDER BY p.rn)
        FROM page p
    ), '[]'::jsonb),
    (SELECT count(*) FROM filtered)
  INTO v_rows, v_total;

  RETURN jsonb_build_object(
    'rows',   v_rows,
    'total',  COALESCE(v_total, 0),
    'limit',  v_limit,
    'offset', v_offset
  );
END;
$func$;

COMMENT ON FUNCTION admin_list_trial_motoristas(text, boolean, text, text, int, int)
  IS 'RPC STABLE SECURITY DEFINER que retorna { rows, total, limit, offset } da listagem de motoristas com status de trial computado no servidor (days_left, trial_state). Filtros opcionais: status (em_trial|expirado|assinante|todos), about_to_expire (0<days_left<=5), q (>=2 chars, ILIKE em name OR phone), sort (days_left_asc default|days_left_desc|created_desc), limit (default 10, max 100), offset (default 0). Apenas user_type=motorista. Gated por USER_VIEW; falha de gating grava TRIAL_VIEW_DENIED em admin_audit_logs. trial-e-bloqueio 044.';

-- Posture de seguranca (admin-patterns Sec. 10): so authenticated executa;
-- gating real depende de auth.uid() + USER_VIEW. REVOKE defensivo de PUBLIC.
REVOKE ALL ON FUNCTION admin_list_trial_motoristas(text, boolean, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_trial_motoristas(text, boolean, text, text, int, int) TO authenticated;


-- ========== 11. RPC admin de extensao: admin_extend_trial ==========

-- Estende manualmente o trial de um motorista (Req 11.1-11.6), com:
--   - gating USER_EDIT + audit negativo TRIAL_VIEW_DENIED (Req 11.6);
--   - INVALID_INPUT quando a nova data e NULL ou nao-futura;
--   - SELECT ... FOR UPDATE (trava a linha durante a checagem/escrita);
--   - NOT_FOUND quando o usuario nao existe;
--   - MASTER_PROTECTED (admin_username = 'Nexus_Vortex99') ANTES de qualquer
--     touch (Master Admin imutavel, admin-patterns Sec. 8);
--   - NOT_MOTORISTA quando o alvo nao e motorista;
--   - STALE_VERSION (versionamento otimista) quando updated_at divergir do
--     p_expected_updated_at enviado pelo cliente (admin-patterns Sec. 3);
--   - UPDATE com guarda otimista (WHERE updated_at = p_expected_updated_at)
--     setando trial_ends_at, subscription_status='trial' (rotulo coerente; o
--     bloqueio e derivado de trial_ends_at + is_subscribed) e updated_at=NOW().
--
-- Estender trial_ends_at para o futuro torna is_motorista_trial_blocked falso
-- na proxima avaliacao (Req 11.4), sem campo de bloqueio explicito.
--
-- VOLATILE (default): muta users. SECURITY DEFINER + SET search_path = public.
-- A auditoria positiva da mutacao e responsabilidade do wrapper
-- executeAdminMutation no cliente (action TRIAL_EXTEND, task 8.2).
CREATE OR REPLACE FUNCTION admin_extend_trial(
  p_user_id             uuid,
  p_new_trial_ends_at   timestamptz,
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
BEGIN
  -- ---------- Camada 1: gating ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('USER_EDIT') THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller,
      'TRIAL_VIEW_DENIED',
      NULL,
      NULL,
      NULL,
      jsonb_build_object(
        'user_id', v_caller,
        'reason',  'permission_denied',
        'rpc',     'extend'
      )
    );
    RAISE EXCEPTION 'permission_denied: USER_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- ---------- Camada 2: validacao de input ----------
  IF p_new_trial_ends_at IS NULL OR p_new_trial_ends_at <= NOW() THEN
    RAISE EXCEPTION 'INVALID_INPUT: nova data deve ser futura' USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Camada 3: pre-fetch travado + invariantes ----------
  SELECT id, user_type, admin_username, trial_ends_at, updated_at
    INTO v_existing
    FROM users
   WHERE id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Master Admin imutavel: aborta antes de qualquer touch (Req 11.5).
  IF v_existing.admin_username = 'Nexus_Vortex99' THEN
    RAISE EXCEPTION 'MASTER_PROTECTED' USING ERRCODE = 'P0001';
  END IF;

  IF v_existing.user_type <> 'motorista' THEN
    RAISE EXCEPTION 'NOT_MOTORISTA' USING ERRCODE = 'P0001';
  END IF;

  -- Versionamento otimista (Req 11.2, 11.3).
  IF v_existing.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION: expected % got %', p_expected_updated_at, v_existing.updated_at
      USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Mutacao com guarda otimista ----------
  UPDATE users
     SET trial_ends_at       = p_new_trial_ends_at,
         subscription_status = 'trial',
         updated_at          = NOW()
   WHERE id = p_user_id
     AND updated_at = p_expected_updated_at
   RETURNING updated_at INTO v_new_updated_at;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new_updated_at);
END;
$func$;

COMMENT ON FUNCTION admin_extend_trial(uuid, timestamptz, timestamptz)
  IS 'RPC SECURITY DEFINER que estende trial_ends_at de um motorista com versionamento otimista (updated_at). Gated por USER_EDIT (audit negativo TRIAL_VIEW_DENIED). Erros: INVALID_INPUT (data nao futura), NOT_FOUND, MASTER_PROTECTED (Nexus_Vortex99, antes do touch), NOT_MOTORISTA, STALE_VERSION. Seta subscription_status=trial e retorna { ok, updated_at }. trial-e-bloqueio 044.';

-- Posture de seguranca (admin-patterns Sec. 10): so authenticated executa;
-- gating real depende de auth.uid() + USER_EDIT. REVOKE defensivo de PUBLIC.
REVOKE ALL ON FUNCTION admin_extend_trial(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_extend_trial(uuid, timestamptz, timestamptz) TO authenticated;


-- ===================================================================
-- Secoes 10-11 (RPCs admin admin_list_trial_motoristas e
-- admin_extend_trial, cada uma com REVOKE ALL FROM PUBLIC +
-- GRANT EXECUTE TO authenticated inline, conforme admin-patterns
-- Sec. 10) CONCLUIDAS pela task 2.4. Nada mais a anexar antes do
-- COMMIT abaixo.
-- ===================================================================


COMMIT;

/*
-- VERIFY (apos apply):
-- Colunas e constraint de dominio
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users'
   AND column_name IN ('trial_ends_at','subscription_status','is_subscribed')
 ORDER BY column_name;

SELECT conname FROM pg_constraint WHERE conname = 'chk_users_subscription_status';

-- Indice parcial
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_users_trial_motoristas';

-- Trigger de concessao
SELECT tgname FROM pg_trigger WHERE tgname = 'users_set_trial_defaults' AND NOT tgisinternal;

-- Backfill: nenhum motorista deve ficar sem trial_ends_at
SELECT COUNT(*) AS motoristas_sem_trial
  FROM users WHERE user_type = 'motorista' AND trial_ends_at IS NULL;

-- Predicado de bloqueio
SELECT proname, prosecdef, provolatile
  FROM pg_proc WHERE proname = 'is_motorista_trial_blocked';

-- RLS de fretes substituida (continuidade + bloqueio do feed)
SELECT policyname, cmd, qual
  FROM pg_policies WHERE tablename = 'fretes' AND policyname = 'fretes_select_policy';

-- Policy admin separada permanece intacta
SELECT policyname FROM pg_policies
 WHERE tablename = 'fretes' AND policyname = 'fretes_admin_select';

-- Guard de trial em toggle_frete_like (deve conter is_motorista_trial_blocked)
SELECT pg_get_functiondef(oid) LIKE '%is_motorista_trial_blocked%' AS has_guard
  FROM pg_proc WHERE proname = 'toggle_frete_like';

-- Anti-fraude: checagem isolada de disponibilidade (secao 8)
SELECT proname, prosecdef, provolatile
  FROM pg_proc WHERE proname = 'is_identifier_available';

-- Grants esperados: anon + authenticated (pre-signup, como is_blacklisted)
SELECT grantee, privilege_type
  FROM information_schema.routine_privileges
 WHERE routine_schema = 'public' AND routine_name = 'is_identifier_available'
 ORDER BY grantee;

-- Em base vazia (ou para valor inexistente) deve retornar true (disponivel);
-- p_type invalido deve lancar invalid_identifier_type.
SELECT is_identifier_available('email', 'ninguem@exemplo.test') AS disponivel_email;

-- Anti-fraude: trigger atomico de duplicidade (secao 9)
SELECT proname, prosecdef
  FROM pg_proc WHERE proname = 'users_antifraud_duplicate_block';

SELECT tgname, tgenabled
  FROM pg_trigger
 WHERE tgname = 'users_antifraud_duplicate_block' AND NOT tgisinternal;

-- Conferir que os DOIS triggers BEFORE INSERT coexistem em users
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'users'::regclass AND NOT tgisinternal
   AND tgname IN ('users_set_trial_defaults', 'users_antifraud_duplicate_block')
 ORDER BY tgname;

-- RPC admin de listagem (secao 10): existe, SECURITY DEFINER, STABLE
SELECT proname, prosecdef, provolatile
  FROM pg_proc WHERE proname = 'admin_list_trial_motoristas';

-- Grants esperados da listagem: SOMENTE authenticated (sem anon/PUBLIC)
SELECT grantee, privilege_type
  FROM information_schema.routine_privileges
 WHERE routine_schema = 'public' AND routine_name = 'admin_list_trial_motoristas'
 ORDER BY grantee;

-- RPC admin de extensao (secao 11): existe, SECURITY DEFINER, VOLATILE
SELECT proname, prosecdef, provolatile
  FROM pg_proc WHERE proname = 'admin_extend_trial';

-- Grants esperados da extensao: SOMENTE authenticated (sem anon/PUBLIC)
SELECT grantee, privilege_type
  FROM information_schema.routine_privileges
 WHERE routine_schema = 'public' AND routine_name = 'admin_extend_trial'
 ORDER BY grantee;

-- Smoke da listagem (executar como admin com USER_VIEW): deve voltar
-- { rows: [...], total, limit, offset } apenas com motoristas; days_left e
-- trial_state computados no servidor. p_status invalido => INVALID_INPUT.
-- SELECT admin_list_trial_motoristas(NULL, false, NULL, 'days_left_asc', 10, 0);
-- SELECT admin_list_trial_motoristas('expirado', false, NULL, NULL, 10, 0);
-- SELECT admin_list_trial_motoristas(NULL, true, NULL, NULL, 50, 0);  -- prestes a expirar (0<days_left<=5)

-- Smoke da extensao (executar como admin com USER_EDIT): primeiro leia o
-- updated_at atual do motorista alvo e reenvie como p_expected_updated_at.
-- Esperado: { ok: true, updated_at } e is_motorista_trial_blocked volta false.
-- Erros esperados: INVALID_INPUT (data <= now), NOT_FOUND (id inexistente),
-- MASTER_PROTECTED (alvo Nexus_Vortex99), NOT_MOTORISTA (alvo nao-motorista),
-- STALE_VERSION (updated_at divergente).
-- SELECT admin_extend_trial('00000000-0000-0000-0000-000000000000'::uuid,
--                           NOW() + INTERVAL '30 days', NOW());  -- NOT_FOUND
*/
