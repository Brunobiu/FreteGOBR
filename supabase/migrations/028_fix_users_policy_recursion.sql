-- ============================================================================
-- Migration 028: Corrige recursão infinita nas policies da Migration 027
-- ============================================================================
-- A policy `users_select_conversation_peers` (Migration 027) usa um
-- subquery em `conversations` que reaviva a RLS de `users`, causando
-- `42P17: infinite recursion detected in policy for relation "users"`.
--
-- Solução: encapsular o subquery numa função SECURITY DEFINER, que roda
-- com o dono da função e ignora RLS. Isso quebra o ciclo.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Função: caller compartilha conversa com o usuário-alvo?
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION shares_conversation_with(p_other UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE (c.motorista_id  = auth.uid() AND c.embarcador_id = p_other)
        OR (c.embarcador_id = auth.uid() AND c.motorista_id  = p_other)
  );
$$;

GRANT EXECUTE ON FUNCTION shares_conversation_with(UUID) TO authenticated;

-- Para os subqueries específicos de embarcadores/motoristas
CREATE OR REPLACE FUNCTION caller_conversa_com_embarcador(p_embarcador UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.motorista_id  = auth.uid()
       AND c.embarcador_id = p_embarcador
  );
$$;

GRANT EXECUTE ON FUNCTION caller_conversa_com_embarcador(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION caller_conversa_com_motorista(p_motorista UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.embarcador_id = auth.uid()
       AND c.motorista_id  = p_motorista
  );
$$;

GRANT EXECUTE ON FUNCTION caller_conversa_com_motorista(UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Recria policies sem subquery direto (sem recursão)
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS users_select_conversation_peers ON users;
CREATE POLICY users_select_conversation_peers ON users
FOR SELECT
USING (shares_conversation_with(users.id));

DROP POLICY IF EXISTS embarcadores_select_conversation_peers ON embarcadores;
CREATE POLICY embarcadores_select_conversation_peers ON embarcadores
FOR SELECT
USING (caller_conversa_com_embarcador(embarcadores.id));

DROP POLICY IF EXISTS motoristas_select_conversation_peers ON motoristas;
CREATE POLICY motoristas_select_conversation_peers ON motoristas
FOR SELECT
USING (caller_conversa_com_motorista(motoristas.id));

COMMIT;
