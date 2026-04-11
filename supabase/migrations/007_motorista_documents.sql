-- Migration 007: Motorista Documents System
-- Adiciona sistema completo de documentos com status de aprovação

-- Adicionar colunas de status na tabela documents existente
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pendente';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Atualizar constraint de document_type para suportar novos tipos
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_document_type_check;

-- Tabela para número PIS do motorista
CREATE TABLE IF NOT EXISTS motorista_pis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pis_number VARCHAR(11) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_user_status ON documents(user_id, status);

-- RLS para motorista_pis
ALTER TABLE motorista_pis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own PIS" ON motorista_pis
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own PIS" ON motorista_pis
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own PIS" ON motorista_pis
  FOR UPDATE USING (auth.uid() = user_id);

-- Admin pode ver e atualizar status de documentos
CREATE POLICY "Admin can update document status" ON documents
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
  );

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_motorista_pis_updated_at
  BEFORE UPDATE ON motorista_pis
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
