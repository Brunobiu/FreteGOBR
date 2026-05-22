-- ============================================================================
-- Migration 009: Alinhamento Consolidado
-- ============================================================================
-- Idempotente: pode ser aplicada múltiplas vezes sem erro.
-- Resolve os 15 bugs documentados em
-- .kiro/specs/schema-alignment-fixes/bugfix.md
--
-- Uso de:
--   * CREATE TABLE IF NOT EXISTS
--   * ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   * DROP CONSTRAINT IF EXISTS / DROP POLICY IF EXISTS / DROP TRIGGER IF EXISTS
--   * CREATE OR REPLACE FUNCTION
--   * CREATE INDEX IF NOT EXISTS
--   * INSERT ... ON CONFLICT (id) DO NOTHING
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. GARANTIR TABELAS DE CHAT EXISTEM (Bug 1)
-- ============================================================================
-- Tabelas de chat de SUPORTE ao usuário (chat_conversations, chat_messages)
-- já são criadas pela migration 001. Tabelas de chat de FRETE
-- (conversations, messages) são criadas pela migration 008.
-- Aqui garantimos idempotência para os dois conjuntos.

-- Chat de suporte ao usuário
CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_andamento', 'resolvida')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat de frete (motorista <-> embarcador)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id UUID REFERENCES fretes(id) ON DELETE SET NULL,
  motorista_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  embarcador_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(frete_id, motorista_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS (idempotente, não falha se já estiver habilitado)
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 2. ADICIONAR COLUNAS DE VEÍCULO EM motoristas (Bug 2)
-- ============================================================================
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(10);
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR(100);
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_year  INTEGER;

-- ============================================================================
-- 3. ADICIONAR COLUNAS DE REVISÃO EM documents (Bug 11)
-- ============================================================================
-- Garantir que colunas usadas pelo código existam, mesmo que migrations
-- 004 e 007 não tenham sido aplicadas ou tenham aplicado parcialmente.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_path        TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_size        BIGINT NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS mime_type        VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status           VARCHAR(20) DEFAULT 'pendente';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reviewed_by      UUID REFERENCES users(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reviewed_at      TIMESTAMP WITH TIME ZONE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Caso a tabela ainda esteja no esquema antigo (file_url) e o file_path
-- esteja vazio, copiar valores como migração silenciosa.
UPDATE documents
SET file_path = file_url
WHERE file_path IS NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'file_url'
  );

-- Forçar NOT NULL em file_path (idempotente — só aplica se ainda não estiver)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'file_path'
      AND is_nullable = 'YES'
  ) THEN
    -- Se houver registros com file_path NULL, deixamos string vazia
    UPDATE documents SET file_path = '' WHERE file_path IS NULL;
    ALTER TABLE documents ALTER COLUMN file_path SET NOT NULL;
  END IF;
END $$;

-- Garantir CHECK do status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND constraint_name = 'documents_status_check'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_status_check
      CHECK (status IN ('pendente', 'aprovado', 'rejeitado'));
  END IF;
END $$;


-- ============================================================================
-- 4. CHECK CONSTRAINT CANÔNICO DE documents.document_type (Bugs 3, 6)
-- ============================================================================
-- Lista canônica de 19 tipos. Antes de recriar, validamos que nenhum
-- registro existente viola a nova lista — caso viole, abortamos com erro
-- amigável para o operador limpar antes.

DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM documents
  WHERE document_type NOT IN (
    'cpf', 'cnh', 'antt',
    'vehicle_registration', 'vehicle_insurance', 'profile_photo',
    'crlv_cavalo', 'crlv_carreta_1', 'crlv_carreta_2',
    'crlv_carreta_3', 'crlv_carreta_4',
    'rntrc_cavalo', 'rntrc_carreta_1', 'rntrc_carreta_2',
    'foto_segurando_cnh', 'foto_frente_caminhao',
    'comprovante_endereco_proprietario',
    'comprovante_endereco_motorista',
    'foto_caminhao_completo',
    -- Tipos legados aceitos antes da consolidação:
    'vehicle', 'photo'
  );

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Existem % documentos com document_type fora da lista canônica. Limpe os registros antes de aplicar a migration 009.',
      invalid_count;
  END IF;
END $$;

-- Migrar tipos legados para os novos equivalentes
UPDATE documents SET document_type = 'vehicle_registration' WHERE document_type = 'vehicle';
UPDATE documents SET document_type = 'profile_photo'        WHERE document_type = 'photo';

-- Recriar o CHECK constraint
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_document_type_check
  CHECK (document_type IN (
    'cpf', 'cnh', 'antt',
    'vehicle_registration', 'vehicle_insurance', 'profile_photo',
    'crlv_cavalo', 'crlv_carreta_1', 'crlv_carreta_2',
    'crlv_carreta_3', 'crlv_carreta_4',
    'rntrc_cavalo', 'rntrc_carreta_1', 'rntrc_carreta_2',
    'foto_segurando_cnh', 'foto_frente_caminhao',
    'comprovante_endereco_proprietario',
    'comprovante_endereco_motorista',
    'foto_caminhao_completo'
  ));


-- ============================================================================
-- 5. RECRIAR fretes_insert_policy PERMISSIVA (Bug 4)
-- ============================================================================
-- Antes: dependia de EXISTS (... FROM embarcadores ...) — falhava se o
-- embarcador legado não tivesse registro filho.
-- Agora: depende apenas de user_type = 'embarcador' em users.

DROP POLICY IF EXISTS fretes_insert_policy ON fretes;

CREATE POLICY fretes_insert_policy ON fretes
FOR INSERT
WITH CHECK (
  embarcador_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'embarcador'
  )
);

-- ============================================================================
-- 6. RECRIAR POLÍTICAS RLS DE chat_conversations e chat_messages (Bug 9)
-- ============================================================================
DROP POLICY IF EXISTS chat_conversations_select_policy ON chat_conversations;
DROP POLICY IF EXISTS chat_conversations_insert_policy ON chat_conversations;
DROP POLICY IF EXISTS chat_conversations_update_policy ON chat_conversations;
DROP POLICY IF EXISTS chat_conversations_delete_policy ON chat_conversations;

CREATE POLICY chat_conversations_select_policy ON chat_conversations
FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

CREATE POLICY chat_conversations_insert_policy ON chat_conversations
FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY chat_conversations_update_policy ON chat_conversations
FOR UPDATE USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

CREATE POLICY chat_conversations_delete_policy ON chat_conversations
FOR DELETE USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

DROP POLICY IF EXISTS chat_messages_select_policy ON chat_messages;
DROP POLICY IF EXISTS chat_messages_insert_policy ON chat_messages;
DROP POLICY IF EXISTS chat_messages_update_policy ON chat_messages;
DROP POLICY IF EXISTS chat_messages_delete_policy ON chat_messages;

CREATE POLICY chat_messages_select_policy ON chat_messages
FOR SELECT USING (
  sender_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = conversation_id AND user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

CREATE POLICY chat_messages_insert_policy ON chat_messages
FOR INSERT WITH CHECK (
  sender_id = auth.uid() AND (
    EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id = conversation_id AND user_id = auth.uid()
    ) OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
  )
);

CREATE POLICY chat_messages_update_policy ON chat_messages
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = conversation_id AND user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

CREATE POLICY chat_messages_delete_policy ON chat_messages
FOR DELETE USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);


-- ============================================================================
-- 7. CONSOLIDAR POLÍTICAS RLS DE documents (Bug 13)
-- ============================================================================
-- Drop de TODAS as políticas existentes (incluindo nomes alternativos
-- usados em migrations 003, 004, 007).
DROP POLICY IF EXISTS documents_select_policy        ON documents;
DROP POLICY IF EXISTS documents_insert_policy        ON documents;
DROP POLICY IF EXISTS documents_update_policy        ON documents;
DROP POLICY IF EXISTS documents_delete_policy        ON documents;
DROP POLICY IF EXISTS "Admin can update document status" ON documents;
DROP POLICY IF EXISTS "Users can view own documents"     ON documents;
DROP POLICY IF EXISTS "Users can insert own documents"   ON documents;

CREATE POLICY documents_select_policy ON documents
FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

CREATE POLICY documents_insert_policy ON documents
FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY documents_update_policy ON documents
FOR UPDATE USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

CREATE POLICY documents_delete_policy ON documents
FOR DELETE USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

-- Políticas idempotentes para conversations/messages (chat de frete).
-- Recriadas com nomes canônicos snake_case para alinhar com as outras tabelas.
DROP POLICY IF EXISTS "Participants can view conversations"          ON conversations;
DROP POLICY IF EXISTS "Participants can insert conversations"        ON conversations;
DROP POLICY IF EXISTS conversations_select_policy                    ON conversations;
DROP POLICY IF EXISTS conversations_insert_policy                    ON conversations;

CREATE POLICY conversations_select_policy ON conversations
FOR SELECT USING (
  motorista_id = auth.uid() OR embarcador_id = auth.uid() OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

CREATE POLICY conversations_insert_policy ON conversations
FOR INSERT WITH CHECK (
  motorista_id = auth.uid() OR embarcador_id = auth.uid()
);

DROP POLICY IF EXISTS "Participants can view messages"               ON messages;
DROP POLICY IF EXISTS "Participants can send messages"               ON messages;
DROP POLICY IF EXISTS "Participants can update messages (mark read)" ON messages;
DROP POLICY IF EXISTS messages_select_policy                         ON messages;
DROP POLICY IF EXISTS messages_insert_policy                         ON messages;
DROP POLICY IF EXISTS messages_update_policy                         ON messages;

CREATE POLICY messages_select_policy ON messages
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation_id
      AND (c.motorista_id = auth.uid() OR c.embarcador_id = auth.uid())
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

CREATE POLICY messages_insert_policy ON messages
FOR INSERT WITH CHECK (
  sender_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation_id
      AND (c.motorista_id = auth.uid() OR c.embarcador_id = auth.uid())
  )
);

CREATE POLICY messages_update_policy ON messages
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation_id
      AND (c.motorista_id = auth.uid() OR c.embarcador_id = auth.uid())
  )
);


-- ============================================================================
-- 8. BACKFILL DE EMBARCADORES FALTANTES (Bug 4)
-- ============================================================================
-- Para todo usuário com user_type = 'embarcador' que não tem registro
-- correspondente em embarcadores, criar com defaults seguros.
INSERT INTO embarcadores (id, company_name, whatsapp)
SELECT u.id,
       COALESCE(u.name, 'Empresa'),
       u.phone
FROM users u
WHERE u.user_type = 'embarcador'
  AND NOT EXISTS (SELECT 1 FROM embarcadores e WHERE e.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 9. ÍNDICES COMPOSTOS (Bug 14)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_documents_user_type_status
  ON documents(user_id, document_type, status);

CREATE INDEX IF NOT EXISTS idx_conversations_motorista_embarcador
  ON conversations(motorista_id, embarcador_id);

-- ============================================================================
-- 10. FUNÇÃO increment_frete_views COM PARÂMETRO CANÔNICO (Bug 10)
-- ============================================================================
-- O frontend chama supabase.rpc('increment_frete_views', { frete_id_param: ... })
-- Recriamos a função com exatamente esse nome de parâmetro.
CREATE OR REPLACE FUNCTION increment_frete_views(frete_id_param UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE fretes
  SET views_count = views_count + 1,
      updated_at  = NOW()
  WHERE id = frete_id_param;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 11. TRIGGER sync_profile_photo_url (Bug 7)
-- ============================================================================
-- Sempre que um documento do tipo 'profile_photo' é inserido, atualiza
-- users.profile_photo_url com o file_path do documento. Usa SECURITY DEFINER
-- para bypass de RLS (search_path explícito para evitar hijack).
CREATE OR REPLACE FUNCTION sync_profile_photo_url()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.document_type = 'profile_photo' THEN
    UPDATE users
    SET profile_photo_url = NEW.file_path,
        updated_at        = NOW()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_profile_photo_url_trigger ON documents;

CREATE TRIGGER sync_profile_photo_url_trigger
  AFTER INSERT ON documents
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_photo_url();

COMMIT;
