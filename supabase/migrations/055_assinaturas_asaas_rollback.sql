-- =====================================================
-- ROLLBACK da Migration 055: assinaturas-asaas
--
-- NAO auto-aplicado. Use manualmente apenas em DEV para reverter a 055.
-- ATENCAO: remove tabelas de assinatura e o guard de interacao. As colunas de
-- trial em users sao mantidas por seguranca (podem ter dados); descomente o
-- bloco final se quiser remove-las tambem.
-- =====================================================

BEGIN;

-- 8. Restaura toggle_frete_like SEM o guard de assinatura (versao pre-055).
CREATE OR REPLACE FUNCTION toggle_frete_like(p_frete_id uuid)
RETURNS jsonb
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
    FROM fretes WHERE id = p_frete_id;

  IF v_embarcador_id IS NULL THEN
    RAISE EXCEPTION 'frete not found';
  END IF;

  SELECT id INTO v_existing_id
    FROM frete_likes
   WHERE frete_id = p_frete_id AND motorista_id = v_motorista_id;

  IF v_existing_id IS NOT NULL THEN
    DELETE FROM frete_likes WHERE id = v_existing_id;
    DELETE FROM notifications
     WHERE user_id = v_embarcador_id
       AND type = 'frete_like'
       AND link = '/embarcador?frete=' || p_frete_id::text || '&motorista=' || v_motorista_id::text;
    SELECT count(*) INTO v_total FROM frete_likes WHERE frete_id = p_frete_id;
    RETURN jsonb_build_object('liked', false, 'total', v_total);
  END IF;

  INSERT INTO frete_likes (frete_id, motorista_id) VALUES (p_frete_id, v_motorista_id);
  SELECT name INTO v_motorista_name FROM users WHERE id = v_motorista_id;
  INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (v_embarcador_id, 'frete_like', 'Motorista interessado',
      coalesce(v_motorista_name, 'Um motorista') || ' curtiu o seu frete ' || v_frete_origin || ' → ' || v_frete_dest,
      '/embarcador?frete=' || p_frete_id::text || '&motorista=' || v_motorista_id::text);
  SELECT count(*) INTO v_total FROM frete_likes WHERE frete_id = p_frete_id;
  RETURN jsonb_build_object('liked', true, 'total', v_total);
END;
$fn$;
GRANT EXECUTE ON FUNCTION toggle_frete_like(UUID) TO authenticated;

-- 7. Remove predicado de interacao.
DROP FUNCTION IF EXISTS motorista_can_interact(uuid);

-- 6/5/4/3. Remove tabelas novas (ordem por dependencia).
DROP TABLE IF EXISTS company_embarcadores;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS asaas_webhook_events;
DROP TABLE IF EXISTS subscription_charges;
DROP TABLE IF EXISTS subscriptions;

-- 2. Remove trigger de trial defaults.
DROP TRIGGER IF EXISTS users_set_trial_defaults ON users;
DROP FUNCTION IF EXISTS users_set_trial_defaults();

-- 1. (OPCIONAL) Remover colunas de trial de users. Mantido comentado por seguranca.
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_subscription_status;
-- ALTER TABLE users DROP COLUMN IF EXISTS is_subscribed;
-- ALTER TABLE users DROP COLUMN IF EXISTS subscription_status;
-- ALTER TABLE users DROP COLUMN IF EXISTS trial_ends_at;
-- DROP INDEX IF EXISTS idx_users_trial_motoristas;

COMMIT;
