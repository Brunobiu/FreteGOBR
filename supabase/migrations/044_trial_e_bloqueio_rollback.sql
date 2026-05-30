-- =====================================================
-- ROLLBACK Migration 044: trial-e-bloqueio
--
-- DOCUMENTACAO APENAS — NAO E AUTO-APLICADO.
-- (As migrations *_rollback.sql nao entram no pipeline de apply automatico;
--  este arquivo existe para reverter manualmente a 044 em caso de necessidade.)
--
-- Reverte, em ordem segura de dependencias, tudo o que a
-- 044_trial_e_bloqueio.sql adicionou:
--   - triggers users_antifraud_duplicate_block e users_set_trial_defaults;
--   - funcoes admin_extend_trial, admin_list_trial_motoristas,
--     users_antifraud_duplicate_block(), users_set_trial_defaults(),
--     is_identifier_available(text,text) e is_motorista_trial_blocked(uuid);
--   - restaura a fretes_select_policy ANTERIOR (migration 003) e o
--     toggle_frete_like ANTERIOR (migration 021), ambos sem qualquer
--     referencia ao predicado de trial;
--   - remove o indice parcial idx_users_trial_motoristas, a constraint de
--     dominio chk_users_subscription_status e as tres colunas de trial.
--
-- !!! AVISO DE PERDA DE DADOS !!!
-- O DROP das colunas trial_ends_at / subscription_status / is_subscribed
-- DESTROI permanentemente todo o estado de trial (datas de expiracao,
-- rotulos de assinatura e flags). NAO ha como recuperar esses valores apos
-- o COMMIT. Faca backup das colunas antes de rodar este rollback se houver
-- intencao de reaplicar a 044 preservando o estado.
--
-- ORDEM DE DEPENDENCIAS (por que esta sequencia):
--   1. Triggers primeiro (dependem das funcoes-trigger).
--   2. Restaurar fretes_select_policy e toggle_frete_like ANTES de dropar
--      is_motorista_trial_blocked — enquanto a policy/funcao atuais
--      referenciam o predicado, o DROP FUNCTION seria bloqueado.
--   3. Dropar as funcoes (RPCs admin, funcoes-trigger, anti-fraude e
--      predicado de bloqueio).
--   4. Dropar indice e constraint ANTES das colunas (idempotencia/clareza;
--      ambos dependem das colunas de trial).
--   5. Dropar as colunas por ultimo.
--
-- Idempotente: todos os passos usam IF EXISTS / OR REPLACE e podem ser
-- reexecutados sem erro.
-- =====================================================

BEGIN;

-- ========== 1. Triggers de users (BEFORE INSERT) ==========

DROP TRIGGER IF EXISTS users_antifraud_duplicate_block ON users;
DROP TRIGGER IF EXISTS users_set_trial_defaults ON users;


-- ========== 2. Restaurar fretes_select_policy ANTERIOR (migration 003) ==========

-- Original (003_rls_policies.sql), sem continuidade nem bloqueio de trial:
--   status = 'ativo'        => feed publico (qualquer um, inclusive anon);
--   embarcador_id = uid     => dono ve os proprios fretes (qualquer status);
--   EXISTS(users admin)     => admin ve todos.
-- Restaurar ANTES de dropar is_motorista_trial_blocked: a policy da 044
-- referencia esse predicado e, enquanto existir, impede o DROP FUNCTION.
DROP POLICY IF EXISTS fretes_select_policy ON fretes;
CREATE POLICY fretes_select_policy ON fretes
FOR SELECT
USING (
  status = 'ativo' OR
  embarcador_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);


-- ========== 3. Restaurar toggle_frete_like ANTERIOR (migration 021) ==========

-- Corpo original da 021_frete_likes.sql, SEM o guard de trial
-- (is_motorista_trial_blocked). CREATE OR REPLACE mantem a mesma assinatura
-- e remove a referencia ao predicado, liberando o DROP FUNCTION da secao 4.
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

-- GRANT preservado como no original (migration 021): nao havia REVOKE.
GRANT EXECUTE ON FUNCTION toggle_frete_like(UUID) TO authenticated;


-- ========== 4. Dropar as funcoes criadas pela 044 ==========

-- RPCs admin (secoes 10 e 11). Assinaturas completas para desambiguar.
DROP FUNCTION IF EXISTS admin_extend_trial(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS admin_list_trial_motoristas(text, boolean, text, text, int, int);

-- Funcoes-trigger (secoes 9 e 3). Os triggers ja foram removidos na secao 1.
DROP FUNCTION IF EXISTS users_antifraud_duplicate_block();
DROP FUNCTION IF EXISTS users_set_trial_defaults();

-- Anti-fraude: checagem isolada de disponibilidade (secao 8).
DROP FUNCTION IF EXISTS is_identifier_available(text, text);

-- Predicado de bloqueio (secao 5). Seguro agora que a policy e o
-- toggle_frete_like restaurados nao o referenciam mais.
DROP FUNCTION IF EXISTS is_motorista_trial_blocked(uuid);


-- ========== 5. Dropar indice parcial (secao 2) ==========

DROP INDEX IF EXISTS idx_users_trial_motoristas;


-- ========== 6. Dropar constraint de dominio (secao 1) ==========

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_subscription_status;


-- ========== 7. Dropar as colunas de trial (secao 1) ==========

-- !!! PERDA DE DADOS IRREVERSIVEL !!! (ver aviso no cabecalho)
ALTER TABLE users
  DROP COLUMN IF EXISTS trial_ends_at,
  DROP COLUMN IF EXISTS subscription_status,
  DROP COLUMN IF EXISTS is_subscribed;


COMMIT;

/*
-- VERIFY (apos rollback):
-- Colunas removidas: deve retornar 0 linhas.
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users'
   AND column_name IN ('trial_ends_at','subscription_status','is_subscribed');

-- Constraint removida: deve retornar 0 linhas.
SELECT conname FROM pg_constraint WHERE conname = 'chk_users_subscription_status';

-- Indice removido: deve retornar 0 linhas.
SELECT indexname FROM pg_indexes WHERE indexname = 'idx_users_trial_motoristas';

-- Funcoes removidas: deve retornar 0 linhas.
SELECT proname FROM pg_proc
 WHERE proname IN (
   'is_motorista_trial_blocked','is_identifier_available',
   'users_set_trial_defaults','users_antifraud_duplicate_block',
   'admin_list_trial_motoristas','admin_extend_trial'
 );

-- Triggers removidos: deve retornar 0 linhas.
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'users'::regclass AND NOT tgisinternal
   AND tgname IN ('users_set_trial_defaults','users_antifraud_duplicate_block');

-- fretes_select_policy restaurada (sem referencia a is_motorista_trial_blocked):
SELECT policyname, qual FROM pg_policies
 WHERE tablename = 'fretes' AND policyname = 'fretes_select_policy';

-- toggle_frete_like restaurado (NAO deve conter o guard de trial):
SELECT pg_get_functiondef(oid) LIKE '%is_motorista_trial_blocked%' AS ainda_tem_guard
  FROM pg_proc WHERE proname = 'toggle_frete_like';  -- esperado: false
*/
