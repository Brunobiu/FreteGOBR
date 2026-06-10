-- =====================================================
-- Migration 080: pina search_path nas funções SECURITY DEFINER próprias (R4)
--
-- Hardening: funções SECURITY DEFINER sem `SET search_path` podem ser
-- sequestradas via manipulação de search_path do chamador (uma tabela/função
-- maliciosa em schema controlado pelo atacante poderia ser resolvida no lugar
-- da pública). Risco baixo na config atual do Supabase, mas é a recomendação
-- oficial (lint 0011). Pinamos `public` nas funções DEFINER do projeto.
--
-- ALTER FUNCTION ... SET search_path NÃO altera o corpo; é seguro e reversível.
-- Funções internas do PostGIS (st_*, geometry_*) NÃO são tocadas (não são
-- nossas e são SECURITY INVOKER).
-- =====================================================

BEGIN;

ALTER FUNCTION public.caller_conversa_com_embarcador(uuid) SET search_path = public;
ALTER FUNCTION public.caller_conversa_com_motorista(uuid)  SET search_path = public;
ALTER FUNCTION public.get_conversation_peer(uuid)          SET search_path = public;
ALTER FUNCTION public.get_likers_of_frete(uuid)            SET search_path = public;
ALTER FUNCTION public.notify_new_message()                 SET search_path = public;
ALTER FUNCTION public.shares_conversation_with(uuid)       SET search_path = public;
ALTER FUNCTION public.toggle_frete_like(uuid)              SET search_path = public;

COMMIT;

-- VERIFY
/*
SELECT proname, proconfig FROM pg_proc
WHERE proname IN ('caller_conversa_com_embarcador','caller_conversa_com_motorista',
 'get_conversation_peer','get_likers_of_frete','notify_new_message',
 'shares_conversation_with','toggle_frete_like');
*/
