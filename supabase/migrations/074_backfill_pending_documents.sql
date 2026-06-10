-- =====================================================
-- Migration 074: backfill de documentos 'pendente' legados
--
-- Contexto: antes do trigger documents_set_initial_status (072), todo
-- documento nascia 'pendente'. No modelo atual ("aprovação imediata"), um
-- documento só fica 'pendente' quando é REENVIADO após uma recusa — aguardando
-- a aprovação do admin. Documentos 'pendente' que NUNCA tiveram uma versão
-- recusada do mesmo tipo são legados e devem valer como 'aprovado'.
--
-- Esta migration corrige esses registros uma única vez. Idempotente:
-- rodar de novo não altera nada (só toca 'pendente' sem recusa anterior).
-- =====================================================

BEGIN;

UPDATE public.documents d
   SET status = 'aprovado',
       updated_at = now()
 WHERE d.status = 'pendente'
   AND d.document_type <> 'profile_photo'
   AND NOT EXISTS (
     SELECT 1 FROM public.documents r
      WHERE r.user_id = d.user_id
        AND r.document_type = d.document_type
        AND r.status = 'rejeitado'
   );

COMMIT;

-- VERIFY
/*
SELECT document_type, status FROM documents
 WHERE status = 'pendente' AND document_type <> 'profile_photo';
*/
