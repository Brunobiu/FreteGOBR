-- 121_chat_whatsapp_handoff.sql
-- ---------------------------------------------------------------------------
-- Estado da conversa de frete para o gating do chat (handoff de WhatsApp +
-- bloqueio por frete indisponivel).
--
-- PROBLEMA 1 (bloqueio nos dois lados): a `fretes_select_policy` so expoe ao
-- motorista fretes `status='ativo'` (alem do dono/admin). Quando o frete e
-- excluido/encerrado/cancelado, o motorista NAO consegue ler o status por
-- SELECT direto (`getFreteStatus` -> null -> gate 'unknown' -> NAO bloqueia).
-- Resultado: o bloqueio so funcionava para o embarcador (dono). Precisamos de
-- uma fonte autoritativa que enxergue o estado REAL para qualquer participante.
--
-- PROBLEMA 2 (handoff de WhatsApp): o motorista so deve ver o WhatsApp do
-- embarcador depois que ambos os lados trocaram um minimo de mensagens
-- (nudge para manter a negociacao inicial no app). O telefone e PII e nao pode
-- ser exposto antes disso nem para quem nao participa da conversa.
--
-- SOLUCAO: RPC SECURITY DEFINER `get_conversation_chat_state` que:
--   (i)   exige auth e participacao na conversa (motorista OU embarcador);
--   (ii)  le o frete vinculado IGNORANDO a RLS do feed -> disponibilidade real
--         (excluido = linha ausente -> indisponivel; nao-'ativo' -> indisponivel);
--   (iii) conta mensagens por lado e so devolve o telefone do peer quando
--         AMBOS atingiram o limiar (3) E o frete ainda esta disponivel.
-- Telefone do peer: embarcador -> COALESCE(embarcadores.whatsapp, users.phone);
-- motorista -> users.phone.
--
-- Tambem adiciona `embarcadores.whatsapp` de forma idempotente (a aplicacao ja
-- usa essa coluna, mas ela nunca foi registrada em migration).
-- ---------------------------------------------------------------------------

BEGIN;

-- Validacao defensiva: dependencias.
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='conversations') THEN
    RAISE EXCEPTION 'Tabela conversations ausente: aplicar migrations de chat primeiro';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='messages') THEN
    RAISE EXCEPTION 'Tabela messages ausente: aplicar migrations de chat primeiro';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='fretes' AND column_name='source') THEN
    RAISE EXCEPTION 'Coluna fretes.source ausente: aplicar a 061 antes';
  END IF;
END
$check$;

-- Alinha o schema com o que a aplicacao ja usa (embarcadores.whatsapp).
ALTER TABLE public.embarcadores ADD COLUMN IF NOT EXISTS whatsapp text;

CREATE OR REPLACE FUNCTION public.get_conversation_chat_state(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller            uuid := auth.uid();
  v_motorista         uuid;
  v_embarcador        uuid;
  v_frete_id          uuid;
  v_status            text;
  v_source            text;
  v_value             numeric;
  v_linked            boolean := false;
  v_exists            boolean := false;
  v_available         boolean := true;   -- sem frete vinculado => sem gating
  v_msgs_motorista    integer := 0;
  v_msgs_embarcador   integer := 0;
  v_msgs_self         integer := 0;
  v_msgs_peer         integer := 0;
  v_peer              uuid;
  v_peer_is_embarcador boolean;
  v_unlocked          boolean := false;
  v_peer_phone        text := NULL;
  v_threshold         constant integer := 3;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  SELECT c.motorista_id, c.embarcador_id, c.frete_id
    INTO v_motorista, v_embarcador, v_frete_id
    FROM conversations c
   WHERE c.id = p_conversation_id;

  IF v_motorista IS NULL THEN
    RAISE EXCEPTION 'not_found: conversation' USING ERRCODE = 'P0002';
  END IF;

  -- Apenas participantes da conversa enxergam o estado (anti acesso cruzado).
  IF v_caller <> v_motorista AND v_caller <> v_embarcador THEN
    RAISE EXCEPTION 'permission_denied: not a conversation participant' USING ERRCODE = '42501';
  END IF;

  -- ── Disponibilidade real do frete (bypassa RLS do feed) ──────────────────
  IF v_frete_id IS NOT NULL THEN
    v_linked := true;
    SELECT f.status::text, f.source::text, f.value
      INTO v_status, v_source, v_value
      FROM fretes f
     WHERE f.id = v_frete_id;

    IF FOUND THEN
      v_exists := true;
      -- Frete Comunidade nunca bloqueia (sem embarcador real). Demais: so
      -- 'ativo' segue liberado; encerrado/cancelado bloqueiam.
      IF v_source = 'comunidade' THEN
        v_available := true;
      ELSE
        v_available := (v_status = 'ativo');
      END IF;
    ELSE
      -- Frete excluido (hard delete) -> indisponivel.
      v_exists := false;
      v_available := false;
    END IF;
  END IF;

  -- ── Contagem de mensagens por lado ───────────────────────────────────────
  SELECT
    count(*) FILTER (WHERE m.sender_id = v_motorista),
    count(*) FILTER (WHERE m.sender_id = v_embarcador)
    INTO v_msgs_motorista, v_msgs_embarcador
    FROM messages m
   WHERE m.conversation_id = p_conversation_id;

  v_unlocked := (v_msgs_motorista >= v_threshold AND v_msgs_embarcador >= v_threshold);

  -- Peer relativo ao chamador.
  IF v_caller = v_motorista THEN
    v_peer := v_embarcador;
    v_peer_is_embarcador := true;
    v_msgs_self := v_msgs_motorista;
    v_msgs_peer := v_msgs_embarcador;
  ELSE
    v_peer := v_motorista;
    v_peer_is_embarcador := false;
    v_msgs_self := v_msgs_embarcador;
    v_msgs_peer := v_msgs_motorista;
  END IF;

  -- Telefone do peer SOMENTE quando liberado E o frete ainda disponivel.
  IF v_unlocked AND v_available AND v_peer IS NOT NULL THEN
    IF v_peer_is_embarcador THEN
      SELECT COALESCE(NULLIF(btrim(e.whatsapp), ''), u.phone)
        INTO v_peer_phone
        FROM users u
        LEFT JOIN embarcadores e ON e.id = u.id
       WHERE u.id = v_peer;
    ELSE
      SELECT u.phone INTO v_peer_phone FROM users u WHERE u.id = v_peer;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'frete', jsonb_build_object(
      'linked', v_linked,
      'exists', v_exists,
      'status', v_status,
      'available', v_available,
      'value', v_value
    ),
    'whatsapp', jsonb_build_object(
      'unlocked', v_unlocked,
      'peer_phone', v_peer_phone,
      'msgs_self', v_msgs_self,
      'msgs_peer', v_msgs_peer,
      'threshold', v_threshold
    )
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.get_conversation_chat_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_conversation_chat_state(uuid) TO authenticated;

COMMIT;

-- VERIFY (smoke test manual):
/*
-- Como participante de uma conversa:
SELECT public.get_conversation_chat_state('00000000-0000-0000-0000-000000000000');
-- Esperado: jsonb { "frete": {...}, "whatsapp": {...} }.
-- peer_phone deve ser null enquanto unlocked=false ou available=false.
*/
