-- FreteGO Database Schema
-- Migration 004: Fix schema alignment between SQL and application code

-- ============================================================================
-- FIX DOCUMENTS TABLE
-- The original schema had file_url, but the app uses file_path, file_size, mime_type
-- Also fix document_type CHECK constraint to match app types
-- ============================================================================

-- Drop old documents table and recreate with correct schema
DROP TABLE IF EXISTS documents CASCADE;

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type VARCHAR(30) NOT NULL CHECK (
    document_type IN ('cpf', 'cnh', 'antt', 'vehicle_registration', 'vehicle_insurance', 'profile_photo')
  ),
  file_name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recreate indexes
CREATE INDEX idx_documents_user ON documents(user_id);
CREATE INDEX idx_documents_type ON documents(user_id, document_type);

-- Recreate RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

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

-- ============================================================================
-- FIX MOTORISTAS TABLE
-- Add missing columns used by the app: vehicle_plate, vehicle_model, vehicle_year
-- ============================================================================

ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(10);
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR(100);
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_year INTEGER;

-- ============================================================================
-- FIX password_hash nullable (already done via SQL editor, but ensure it's here)
-- ============================================================================

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- ============================================================================
-- FIX increment_frete_views function parameter name
-- The app calls with p_frete_id but function expects frete_id_param
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_frete_views(p_frete_id UUID)
RETURNS VOID AS $
BEGIN
  UPDATE fretes
  SET views_count = views_count + 1,
      updated_at = NOW()
  WHERE id = p_frete_id;
END;
$ LANGUAGE plpgsql;
