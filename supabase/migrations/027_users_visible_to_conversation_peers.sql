-- ============================================================================
-- Migration 027: Permitir que participantes de uma conversa vejam o nome
-- e a foto do outro participante na tabela `users`.
-- ============================================================================
-- Antes desta migration, a RLS de `users` (Migration 003) só permitia que
-- cada um visse o próprio registro ou que admins vissem qualquer um.
--
-- Resultado: na lista de mensagens, o JOIN em `users!motorista_id_fkey(name)`
-- voltava `null`, então a UI exibia o placeholder "Motorista" / "Embarcador"
-- em vez do nome real do outro lado da conversa.
--
-- Esta migration adiciona uma policy adicional que permite SELECT em `users`
-- quando o caller faz parte de pelo menos uma conversa com o usuário-alvo.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS users_select_conversation_peers ON users;

CREATE POLICY users_select_conversation_peers ON users
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE
      (c.motorista_id = auth.uid() AND c.embarcador_id = users.id)
      OR
      (c.embarcador_id = auth.uid() AND c.motorista_id = users.id)
  )
);

-- Idem pra embarcadores: pra que o motorista veja `company_name` e
-- `company_logo_url` do embarcador da conversa.

DROP POLICY IF EXISTS embarcadores_select_conversation_peers ON embarcadores;

CREATE POLICY embarcadores_select_conversation_peers ON embarcadores
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.motorista_id = auth.uid()
      AND c.embarcador_id = embarcadores.id
  )
);

-- Idem pra motoristas: pra que o embarcador veja modelo/placa/eixos do
-- motorista da conversa (já cobre o que `get_conversation_peer` retorna,
-- mas deixa as queries diretas funcionando também).

DROP POLICY IF EXISTS motoristas_select_conversation_peers ON motoristas;

CREATE POLICY motoristas_select_conversation_peers ON motoristas
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.embarcador_id = auth.uid()
      AND c.motorista_id = motoristas.id
  )
);

COMMIT;
