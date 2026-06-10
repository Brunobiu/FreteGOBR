-- =====================================================
-- Migration 076: anexo de CT-e por referência profissional
--
-- O motorista cadastra referências (transportadoras com quem já carregou):
-- nome + telefone + o CT-e (Conhecimento de Transporte eletrônico) daquele
-- frete, como prova. O CT-e é um arquivo (PDF ou imagem) guardado no bucket
-- `documents` sob a pasta do próprio usuário ({user_id}/cte_*.<ext>).
--
-- Aqui só adicionamos as colunas que apontam para o arquivo. O upload em si
-- usa o storage existente (mesma RLS de documentos por pasta de usuário).
-- =====================================================

BEGIN;

ALTER TABLE public.motorista_references
  ADD COLUMN IF NOT EXISTS cte_file_path text,
  ADD COLUMN IF NOT EXISTS cte_file_name text;

COMMENT ON COLUMN public.motorista_references.cte_file_path IS
  'Caminho no bucket documents do CT-e desta referência (PDF/imagem). (076)';
COMMENT ON COLUMN public.motorista_references.cte_file_name IS
  'Nome original do arquivo de CT-e enviado pelo motorista. (076)';

COMMIT;
