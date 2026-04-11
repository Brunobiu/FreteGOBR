-- Fix: Política RLS de fretes muito restritiva
-- O problema: fretes_insert_policy exige registro na tabela embarcadores
-- mas o registro pode não ter sido criado durante o cadastro

-- Dropar política antiga
DROP POLICY IF EXISTS fretes_insert_policy ON fretes;

-- Nova política: permite inserção se o usuário autenticado é o embarcador_id
-- e existe na tabela users como embarcador
CREATE POLICY fretes_insert_policy ON fretes
FOR INSERT
WITH CHECK (
  embarcador_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'embarcador'
  )
);

-- Fix: Garantir que embarcadores são inseridos na tabela embarcadores durante registro
-- Inserir embarcadores faltantes que estão em users mas não em embarcadores
INSERT INTO embarcadores (id, company_name, created_at, updated_at)
SELECT 
  u.id,
  COALESCE(u.name, 'Empresa'),
  u.created_at,
  u.updated_at
FROM users u
WHERE u.user_type = 'embarcador'
  AND NOT EXISTS (SELECT 1 FROM embarcadores e WHERE e.id = u.id)
ON CONFLICT (id) DO NOTHING;
