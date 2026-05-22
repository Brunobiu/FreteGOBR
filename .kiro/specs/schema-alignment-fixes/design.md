# Schema Alignment Fixes — Bugfix Design

## Visão Geral

Este documento descreve a solução técnica para os 15 bugs documentados em `bugfix.md`, todos decorrentes do desalinhamento entre o código TypeScript do FreteGO e o schema do Supabase. A correção é executada em **duas frentes paralelas**:

- **Frente A — Migration SQL consolidada e idempotente** (`009_consolidated_alignment.sql`): garante que o estado do schema atinja o ponto correto independente de quais migrations corretivas anteriores (004, 006, 007, 008) tenham sido aplicadas. Pode ser rodada múltiplas vezes sem erro.
- **Frente B — Ajustes no código TypeScript**: alinha tipos, mapeia colunas faltantes, substitui erros silenciosos por exceções tipadas, torna o cadastro transacional via rollback compensatório e adiciona validações client-side.

A estratégia foi pensada para que cada frente possa ser revisada e implantada separadamente, mas a ordem recomendada de deploy é **migration primeiro, depois código** (a migration é segura sob o código antigo; o código novo depende do schema novo).

A correção segue rigorosamente a metodologia de bug condition: cada um dos 15 bugs tem `C(X)` formal definida em `bugfix.md`, e cada mudança é justificada como atendendo a `P(result)` para `C(X)` ou como preservação de comportamento para `¬C(X)`.

## Glossário

- **Bug_Condition (C)**: predicado que identifica os inputs onde o sistema atual produz comportamento incorreto. Os 15 `isBugCondition_N` estão definidos em `bugfix.md`.
- **Property (P)**: comportamento correto esperado para os inputs em `C(X)`. Definido em `Correctness Properties` abaixo.
- **Preservation**: para todo input em `¬C(X)`, `F(X) = F'(X)` — o sistema corrigido se comporta identicamente ao original.
- **Migration consolidada**: arquivo SQL único, idempotente, que resolve todos os desvios de schema. Ver Seção `Estrutura do Arquivo de Migration`.
- **Rollback compensatório**: quando uma operação multi-passo (ex: cadastro) não pode ser feita em uma transação atômica do Supabase, executa-se a operação inversa (delete) caso um passo posterior falhe.
- **CHECK constraint canônico**: lista única de tipos de documento aceitos, definida no SQL e replicada em `documents.ts` via `VALID_DOCUMENT_TYPES`.

## Arquitetura da Migration Consolidada

A migration `009_consolidated_alignment.sql` segue uma ordem rigorosa para garantir que, mesmo executada em um banco "sujo" (com migrations parciais aplicadas), o estado final seja idêntico ao de um banco limpo onde todas as migrations 001-008 rodaram em sequência.

### Princípios de idempotência

Cada operação SQL usa a forma idempotente correspondente:

| Objeto | Forma idempotente |
|--------|-------------------|
| Tabela | `CREATE TABLE IF NOT EXISTS` |
| Coluna | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` |
| Constraint | `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` |
| Política RLS | `DROP POLICY IF EXISTS` + `CREATE POLICY` |
| Função | `CREATE OR REPLACE FUNCTION` |
| Trigger | `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` |
| Índice | `CREATE INDEX IF NOT EXISTS` |
| Backfill | `INSERT ... ON CONFLICT (id) DO NOTHING` |

### Ordem de execução

A ordem é estrita porque algumas operações dependem de objetos criados antes:

1. **Schema (tabelas)**: garante que `chat_conversations`, `chat_messages`, `conversations`, `messages` existem.
2. **Colunas**: adiciona colunas faltantes em `motoristas` (`vehicle_plate`, `vehicle_model`, `vehicle_year`) e `documents` (`status`, `rejection_reason`, `reviewed_by`, `reviewed_at`).
3. **Constraints**: drop e recreate do `documents_document_type_check` com a lista canônica completa de tipos.
4. **RLS policies**: drop and recreate de todas as políticas afetadas, garantindo idempotência.
5. **Backfill de dados**: insere registros em `embarcadores` para todos os usuários `user_type = 'embarcador'` que não têm correspondência. Validação prévia de dados que possam violar o novo CHECK.
6. **Índices compostos**: cria índices que aceleram queries quentes.
7. **Funções e triggers**: recria `increment_frete_views` com nome de parâmetro `frete_id_param`. Cria trigger de sincronização de `profile_photo_url`.

### Backfill seguro

O backfill de embarcadores executa antes da recriação da política RLS de fretes para que, no momento em que um embarcador legacy tente criar um frete, o registro já exista. O backfill usa `ON CONFLICT (id) DO NOTHING` para nunca sobrescrever dados.

```sql
INSERT INTO embarcadores (id, company_name, whatsapp)
SELECT
  u.id,
  COALESCE(u.name, 'Empresa'),
  u.phone
FROM users u
WHERE u.user_type = 'embarcador'
  AND NOT EXISTS (SELECT 1 FROM embarcadores e WHERE e.id = u.id)
ON CONFLICT (id) DO NOTHING;
```

### Drop e recreate de constraints sem perda de dados

Para o CHECK constraint de `documents.document_type`, primeiro removemos a constraint antiga e depois adicionamos a nova com a lista expandida. Como CHECK constraints não armazenam dados, esse drop é seguro. Antes da recriação, validamos que nenhum registro existente viola o novo constraint:

```sql
-- Validação prévia: garantir que dados existentes são compatíveis
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM documents
  WHERE document_type NOT IN ('cpf', 'cnh', /* ...lista completa... */);
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Existem % documentos com document_type inválido. Limpe antes de aplicar.', invalid_count;
  END IF;
END $$;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_document_type_check
  CHECK (document_type IN (/* lista canônica completa */));
```


## Detalhamento por Bug

### Bug 1 — Chat duplicado em duas tabelas

**Mudança**: SQL na migration 009.

A migration garante que as quatro tabelas existam idempotentemente: `chat_conversations` e `chat_messages` (suporte ao usuário, usadas por `chat.ts`) e `conversations` e `messages` (chat motorista-embarcador, usadas por `chatFrete.ts`). RLS é habilitada e políticas básicas são (re)aplicadas.

```sql
CREATE TABLE IF NOT EXISTS chat_conversations ( /* ... */ );
CREATE TABLE IF NOT EXISTS chat_messages ( /* ... */ );
CREATE TABLE IF NOT EXISTS conversations ( /* ... */ );
CREATE TABLE IF NOT EXISTS messages ( /* ... */ );

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
-- (e demais)
```

**Preserva**: 3.21 (admin enxerga chats), 3.23/3.24 (idempotência). Fluxos de chat já funcionais para inputs em `¬C(X)` continuam idênticos.

---

### Bug 2 — Colunas de veículo ausentes em motoristas

**Mudança**: SQL na migration 009.

```sql
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(10);
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR(100);
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_year INTEGER;
```

**Mudança no código**: `src/services/motorista.ts` já mapeia esses campos. Apenas garantir que nulls sejam aceitos sem erro (já é o caso na lógica atual com `if (data.vehicleX !== undefined)`).

**Preserva**: 3.16 (atualização de `name`, `email`, `cpf` continua funcionando). O campo `vehicle_type` original permanece intacto.

---

### Bug 3 — CHECK constraint de document_type incompatível

**Mudança**: SQL na migration 009 e TypeScript em `src/services/documents.ts`.

SQL — drop e recreate com lista canônica completa:

```sql
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_document_type_check
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
```

TypeScript — expandir union type `DocumentType` para a mesma lista, exportar `VALID_DOCUMENT_TYPES` como const array fonte única de verdade:

```typescript
export const VALID_DOCUMENT_TYPES = [
  'cpf', 'cnh', 'antt',
  'vehicle_registration', 'vehicle_insurance', 'profile_photo',
  'crlv_cavalo', 'crlv_carreta_1', 'crlv_carreta_2',
  'crlv_carreta_3', 'crlv_carreta_4',
  'rntrc_cavalo', 'rntrc_carreta_1', 'rntrc_carreta_2',
  'foto_segurando_cnh', 'foto_frente_caminhao',
  'comprovante_endereco_proprietario',
  'comprovante_endereco_motorista',
  'foto_caminhao_completo',
] as const;

export type DocumentType = (typeof VALID_DOCUMENT_TYPES)[number];

export function validateDocumentType(type: string): type is DocumentType {
  return (VALID_DOCUMENT_TYPES as readonly string[]).includes(type);
}
```

**Preserva**: 3.12, 3.13, 3.14, 3.15. Todos os tipos antigos continuam aceitos (são subset da lista nova).

---

### Bug 4 — RLS de fretes exige registro em embarcadores

**Mudança**: SQL na migration 009 (recreate da política + backfill).

```sql
-- Backfill primeiro
INSERT INTO embarcadores (id, company_name, whatsapp)
SELECT u.id, COALESCE(u.name, 'Empresa'), u.phone
FROM users u
WHERE u.user_type = 'embarcador'
  AND NOT EXISTS (SELECT 1 FROM embarcadores e WHERE e.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- Política recriada
DROP POLICY IF EXISTS fretes_insert_policy ON fretes;
CREATE POLICY fretes_insert_policy ON fretes
FOR INSERT WITH CHECK (
  embarcador_id = auth.uid() AND
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'embarcador')
);
```

A nova política valida `user_type = 'embarcador'` em `users` (não em `embarcadores`), tornando-a robusta a estados inconsistentes. O backfill garante que mesmo a verificação anterior funcionaria.

**Preserva**: 3.5, 3.6, 3.7, 3.8, 3.9. Embarcadores legítimos continuam podendo criar/listar/editar fretes.

---

### Bug 5 — Cadastro não-transacional

**Mudança**: TypeScript em `src/services/auth.ts`.

Como o Supabase JS não expõe transações multi-tabela, implementamos rollback compensatório: se a inserção em `motoristas` ou `embarcadores` falhar após `users` ter sido inserido, executamos `delete` do registro em `users` e `signOut` do Auth para garantir estado limpo.

```typescript
// Pseudocódigo da estrutura
try {
  // 1. signUp Supabase Auth
  // 2. insert users
  // 3. insert motoristas/embarcadores
} catch (err) {
  // Rollback compensatório
  if (authData?.user?.id) {
    await supabase.from('users').delete().eq('id', authData.user.id);
    await supabase.auth.signOut(); // limpa sessão e token
  }
  throw err;
}
```

Pontos importantes:
- O `signOut` é chamado mesmo quando a falha não é de auth (limpa qualquer token persistido pelo `signUp`).
- O usuário em Auth do Supabase pode permanecer (não temos privilégio de delete pelo client). Isso é aceito porque sem o registro em `users` o usuário não consegue fazer login (a query em `users` retorna vazio e o login falha com `INVALID_CREDENTIALS`).
- Em caso futuro de melhoria, criar uma RPC `register_user_atomic` no Postgres que executa todos os inserts em uma transação real.

**Preserva**: 3.1, 3.2, 3.3 (regras de validação de senha e anti-enumeração inalteradas).

---

### Bug 6 — profile_photo no CHECK constraint

Subset estrito de Bug 3. A correção do CHECK constraint expandido contempla `profile_photo`.

**Preserva**: nenhuma preservação adicional além das de Bug 3.

---

### Bug 7 — profile_photo_url não é atualizado

**Mudança**: SQL na migration 009 (trigger) e TypeScript em `documents.ts` (defesa em profundidade).

SQL — trigger que sincroniza `users.profile_photo_url` quando um documento `profile_photo` é inserido:

```sql
CREATE OR REPLACE FUNCTION sync_profile_photo_url()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.document_type = 'profile_photo' THEN
    UPDATE users
    SET profile_photo_url = NEW.file_path,
        updated_at = NOW()
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
```

`SECURITY DEFINER` permite que o trigger atualize `users` sem depender da política RLS do usuário corrente — necessário porque a política `users_update_policy` é `auth.uid() = id`, o que já permitiria, mas explicitamos por robustez.

TypeScript — defesa em profundidade no `uploadDocument`: caso o trigger não esteja ativo (ambiente legacy, deploy parcial), o serviço atualiza `users.profile_photo_url` após o insert ter sucesso:

```typescript
if (documentType === 'profile_photo') {
  await supabase
    .from('users')
    .update({ profile_photo_url: uploadData.path })
    .eq('id', userId); // erros aqui são logados mas não interrompem o upload
}
```

**Preserva**: 3.12, 3.13, 3.15. Uploads de documentos não-foto não são afetados.

---

### Bug 8 — Erro silencioso ao buscar fretes

**Mudança**: TypeScript em `src/services/fretes.ts`.

Substitui a degradação silenciosa por log estruturado e propagação de erro:

```typescript
if (error) {
  console.error('[FRETES] getActiveFretes failed', {
    code: error.code,
    message: error.message,
    filters,
  });
  throw new Error(`Erro ao buscar fretes: ${error.message}`);
}
```

A UI tem responsabilidade de capturar e exibir mensagem amigável ao usuário (já existe `ErrorBoundary`).

**Preserva**: 3.5, 3.6 (caminho feliz inalterado). A única mudança é no caminho de erro.

---

### Bug 9 — RLS de chat_conversations excessivamente restritiva

**Mudança**: SQL na migration 009 — recriação idempotente das políticas de `chat_conversations` e `chat_messages` exatamente como definidas em `003_rls_policies.sql`, garantindo que o estado seja consistente.

```sql
DROP POLICY IF EXISTS chat_conversations_select_policy ON chat_conversations;
CREATE POLICY chat_conversations_select_policy ON chat_conversations
FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);
-- (idem para insert, update, delete)
```

**Preserva**: 3.21 (admin), 3.22 (notificações).

---

### Bug 10 — Parâmetro inconsistente em increment_frete_views

**Mudança**: SQL na migration 009.

A função é recriada com `CREATE OR REPLACE FUNCTION` usando exatamente `frete_id_param` como nome de parâmetro, alinhado ao chamador em `fretes.ts`:

```sql
CREATE OR REPLACE FUNCTION increment_frete_views(frete_id_param UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE fretes
  SET views_count = views_count + 1,
      updated_at = NOW()
  WHERE id = frete_id_param;
END;
$$ LANGUAGE plpgsql;
```

Observação: a migration 004 atual define com `p_frete_id`. A migration 009 sobrescreve para `frete_id_param`.

**Preserva**: 3.7, 3.8 (cliques e visualizações continuam sendo registrados).

---

### Bug 11 — Status de documento não mapeado

**Mudança**: TypeScript em `src/services/documents.ts`.

Garantir que as colunas `status`, `rejection_reason`, `reviewed_by`, `reviewed_at` existam (idempotente na migration 009) e adicionar campos correspondentes em `DocumentMetadata`:

```typescript
export interface DocumentMetadata {
  id: string;
  userId: string;
  documentType: DocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  status?: 'pendente' | 'aprovado' | 'rejeitado';
  rejectionReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  url?: string;
}
```

Mapear esses campos em `getDocumentsByUser`, `getDocumentByType` e `uploadDocument`. A `MotoristaPerfilPage` já tem UI para `status` e `rejection_reason`, mas hoje lê diretamente do supabase com queries inline. Após o ajuste, ela poderá usar o mapeamento centralizado.

**Preserva**: 3.12, 3.13, 3.14. Documentos antigos sem `status` recebem `undefined` (que a UI já tolera).

---

### Bug 12 — Falta validação client-side de tipos de documento

**Mudança**: TypeScript em `src/pages/MotoristaPerfilPage.tsx` e `documents.ts`.

Em `MotoristaPerfilPage`, remover o cast `as any` e validar antes de chamar:

```typescript
// Em handleDocUpload
if (!validateDocumentType(docType)) {
  setError(`Tipo de documento inválido: "${docType}"`);
  return;
}
const doc = await uploadDocument(user.id, docType, file);
```

Em `documents.ts`, `uploadDocument` valida defensivamente:

```typescript
if (!validateDocumentType(documentType)) {
  throw new DocumentError(
    `Tipo de documento inválido: "${documentType}"`,
    'INVALID_DOCUMENT_TYPE',
    400
  );
}
```

**Preserva**: 3.12 (todos os tipos válidos continuam sendo aceitos sem alteração de comportamento).

---

### Bug 13 — RLS bloqueia admin de ver documentos

**Mudança**: SQL na migration 009.

Recriação idempotente das políticas de `documents` consolidando as definições conflitantes das migrations 003, 004 e 007 numa única definição canônica:

```sql
DROP POLICY IF EXISTS documents_select_policy ON documents;
DROP POLICY IF EXISTS documents_insert_policy ON documents;
DROP POLICY IF EXISTS documents_update_policy ON documents;
DROP POLICY IF EXISTS documents_delete_policy ON documents;
DROP POLICY IF EXISTS "Admin can update document status" ON documents;

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
```

**Preserva**: 3.13 (usuários comuns continuam vendo só seus documentos), 3.14 (delete de documento próprio funciona).

---

### Bug 14 — Índices ausentes em queries comuns

**Mudança**: SQL na migration 009.

```sql
CREATE INDEX IF NOT EXISTS idx_documents_user_type_status
  ON documents(user_id, document_type, status);

CREATE INDEX IF NOT EXISTS idx_conversations_motorista_embarcador
  ON conversations(motorista_id, embarcador_id);
```

`CREATE INDEX IF NOT EXISTS` é seguro mesmo se índices com nomes diferentes mas colunas iguais já existirem — neste caso o novo índice é redundante mas não causa erro.

**Preserva**: nenhuma alteração funcional, apenas performance.

---

### Bug 15 — Tratamento de erro genérico em chat

**Mudança**: TypeScript em `src/services/chat.ts` e `src/services/chatFrete.ts`.

Introduzir `ChatError` análoga a `DocumentError` e mapear erros do Supabase para códigos discriminados:

```typescript
export class ChatError extends Error {
  constructor(
    message: string,
    public code: 'PERMISSION_DENIED' | 'NOT_FOUND' | 'NETWORK_ERROR'
              | 'VALIDATION_ERROR' | 'UNKNOWN',
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

function mapSupabaseError(error: { code?: string; message: string }): ChatError {
  if (error.code === 'PGRST301' || /permission/i.test(error.message))
    return new ChatError('Sem permissão para esta operação', 'PERMISSION_DENIED', 403);
  if (error.code === 'PGRST116')
    return new ChatError('Recurso não encontrado', 'NOT_FOUND', 404);
  if (/network|fetch/i.test(error.message))
    return new ChatError('Falha de rede', 'NETWORK_ERROR', 503);
  return new ChatError(`Erro: ${error.message}`, 'UNKNOWN', 500);
}
```

Substituir todos os `throw new Error('Erro ao ...')` por `throw mapSupabaseError(error)`.

**Preserva**: caminhos felizes inalterados; apenas a estrutura dos erros muda.

---

## Mudanças no Schema do Banco

### Tabelas garantidas existirem

- `chat_conversations` (suporte ao usuário)
- `chat_messages` (suporte ao usuário)
- `conversations` (chat motorista-embarcador)
- `messages` (chat motorista-embarcador)

### Colunas adicionadas em `motoristas`

- `vehicle_plate VARCHAR(10)` nullable
- `vehicle_model VARCHAR(100)` nullable
- `vehicle_year INTEGER` nullable

### Colunas garantidas em `documents`

- `status VARCHAR(20) DEFAULT 'pendente'`
- `rejection_reason TEXT`
- `reviewed_by UUID REFERENCES users(id)`
- `reviewed_at TIMESTAMP WITH TIME ZONE`
- `updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
- `file_path TEXT NOT NULL` (caso ainda exista o esquema antigo `file_url`)
- `file_size BIGINT NOT NULL DEFAULT 0`
- `mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream'`

### CHECK constraint canônico de `documents.document_type`

Lista expandida para incluir todos os tipos:

```
'cpf', 'cnh', 'antt',
'vehicle_registration', 'vehicle_insurance', 'profile_photo',
'crlv_cavalo', 'crlv_carreta_1', 'crlv_carreta_2',
'crlv_carreta_3', 'crlv_carreta_4',
'rntrc_cavalo', 'rntrc_carreta_1', 'rntrc_carreta_2',
'foto_segurando_cnh', 'foto_frente_caminhao',
'comprovante_endereco_proprietario',
'comprovante_endereco_motorista',
'foto_caminhao_completo'
```

### RLS policies recriadas

- `fretes_insert_policy` permissiva: `embarcador_id = auth.uid() AND user_type = 'embarcador'` (sem dependência de `embarcadores`).
- `chat_conversations_*_policy` recriadas idempotentemente.
- `documents_*_policy` consolidadas (admin vê todos, owner vê os próprios).

### Backfill

- Inserir em `embarcadores` todos os `users` com `user_type = 'embarcador'` que não têm registro correspondente.

### Índices compostos

- `idx_documents_user_type_status` em `documents(user_id, document_type, status)`
- `idx_conversations_motorista_embarcador` em `conversations(motorista_id, embarcador_id)`

### Funções e triggers

- `increment_frete_views(frete_id_param UUID)` recriada com nome de parâmetro alinhado ao frontend.
- `sync_profile_photo_url()` trigger AFTER INSERT em `documents` que atualiza `users.profile_photo_url` quando `document_type = 'profile_photo'`. Usa `SECURITY DEFINER` para evitar conflitos com RLS.

---

## Mudanças no Código TypeScript

### `src/services/documents.ts`

- Definir `VALID_DOCUMENT_TYPES` como const array exportada.
- Derivar `DocumentType` de `VALID_DOCUMENT_TYPES`.
- Exportar `validateDocumentType(type: string): type is DocumentType`.
- Adicionar campos `status`, `rejectionReason`, `reviewedBy`, `reviewedAt` em `DocumentMetadata`.
- Mapear esses campos em `getDocumentsByUser` e `getDocumentByType`.
- Validar `documentType` em `uploadDocument` antes do request.
- Após upload bem-sucedido com `documentType === 'profile_photo'`, executar UPDATE em `users.profile_photo_url` (defesa em profundidade caso o trigger SQL não esteja ativo).

### `src/services/auth.ts`

- Tornar `register` resiliente via rollback compensatório:
  - Se `insert users` falhar: nada a fazer (Supabase Auth pode reter o usuário, mas sem `users` o login falha).
  - Se `insert motoristas`/`embarcadores` falhar: `delete from users where id = ...` + `supabase.auth.signOut()`.
- Limpar token de sessão (`signOut`) em qualquer falha posterior ao `signUp`.

### `src/services/fretes.ts`

- Em `getActiveFretes`, remover a degradação silenciosa para erros com `lock`/`auth`/`PGRST301`. Substituir por log estruturado e `throw`.

### `src/services/chat.ts` e `src/services/chatFrete.ts`

- Adicionar classe `ChatError` com `code` discriminado.
- Adicionar helper `mapSupabaseError(error): ChatError`.
- Substituir `throw new Error(...)` por `throw mapSupabaseError(...)` em todas as funções.

### `src/pages/MotoristaPerfilPage.tsx`

- Importar `validateDocumentType` de `documents.ts`.
- Em `handleDocUpload`, validar `docType` antes de chamar `uploadDocument`. Exibir erro em pt-BR caso inválido.
- Remover cast `as any` na chamada de `uploadDocument`.

### `src/services/motorista.ts`

- Garantir que campos `vehiclePlate`, `vehicleModel`, `vehicleYear` aceitam `undefined` e `null` no mapeamento (já é o caso, validar explicitamente).

---

## Estrutura do Arquivo de Migration

Esqueleto do `supabase/migrations/009_consolidated_alignment.sql`:

```sql
-- Migration 009: Alinhamento Consolidado
-- Idempotente: pode ser aplicada múltiplas vezes sem erro
-- Resolve os 15 bugs documentados em .kiro/specs/schema-alignment-fixes/bugfix.md

BEGIN;

-- ===========================================================================
-- 1. Garantir tabelas existem (Bug 1)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS chat_conversations ( /* ... */ );
CREATE TABLE IF NOT EXISTS chat_messages ( /* ... */ );
CREATE TABLE IF NOT EXISTS conversations ( /* ... */ );
CREATE TABLE IF NOT EXISTS messages ( /* ... */ );

-- ===========================================================================
-- 2. Garantir colunas existem (Bugs 2, 11)
-- ===========================================================================
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_plate  VARCHAR(10);
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_model  VARCHAR(100);
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_year   INTEGER;

ALTER TABLE documents  ADD COLUMN IF NOT EXISTS status           VARCHAR(20) DEFAULT 'pendente';
ALTER TABLE documents  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE documents  ADD COLUMN IF NOT EXISTS reviewed_by      UUID REFERENCES users(id);
ALTER TABLE documents  ADD COLUMN IF NOT EXISTS reviewed_at      TIMESTAMP WITH TIME ZONE;

-- ===========================================================================
-- 3. Atualizar CHECK constraints (Bugs 3, 6)
-- ===========================================================================
-- Validação prévia de dados existentes
DO $$ /* checa registros violando o novo constraint */ $$;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_document_type_check
  CHECK (document_type IN ( /* lista canônica completa */ ));

-- ===========================================================================
-- 4. Recriar RLS policies (Bugs 4, 9, 13)
-- ===========================================================================
DROP POLICY IF EXISTS fretes_insert_policy ON fretes;
CREATE POLICY fretes_insert_policy ON fretes FOR INSERT WITH CHECK ( /* ... */ );

DROP POLICY IF EXISTS chat_conversations_select_policy ON chat_conversations;
CREATE POLICY chat_conversations_select_policy ON chat_conversations FOR SELECT USING ( /* ... */ );
-- (demais políticas de chat_conversations, chat_messages, documents)

-- ===========================================================================
-- 5. Backfill de dados (Bug 4)
-- ===========================================================================
INSERT INTO embarcadores (id, company_name, whatsapp)
SELECT u.id, COALESCE(u.name, 'Empresa'), u.phone
FROM users u
WHERE u.user_type = 'embarcador'
  AND NOT EXISTS (SELECT 1 FROM embarcadores e WHERE e.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- 6. Índices (Bug 14)
-- ===========================================================================
CREATE INDEX IF NOT EXISTS idx_documents_user_type_status
  ON documents(user_id, document_type, status);
CREATE INDEX IF NOT EXISTS idx_conversations_motorista_embarcador
  ON conversations(motorista_id, embarcador_id);

-- ===========================================================================
-- 7. Funções e triggers (Bugs 7, 10)
-- ===========================================================================
CREATE OR REPLACE FUNCTION increment_frete_views(frete_id_param UUID)
RETURNS VOID AS $$ /* ... */ $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_profile_photo_url()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$ /* ... */ $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_profile_photo_url_trigger ON documents;
CREATE TRIGGER sync_profile_photo_url_trigger
  AFTER INSERT ON documents
  FOR EACH ROW EXECUTE FUNCTION sync_profile_photo_url();

COMMIT;
```

---

## Correctness Properties

Property 1: Bug Condition — Schema alinhado e fluxos quebrados restaurados

_For any_ input where the bug condition holds (`isBugCondition_N(X)` returns true para qualquer `N ∈ {1..15}`), the fixed system SHALL produce the corrected behavior specified in clauses `2.1` a `2.15` de `bugfix.md`: chat operacional, colunas de veículo persistidas, todos os tipos de documento aceitos, criação de fretes permitida para embarcadores, cadastro consistente, `profile_photo_url` sincronizado, erros propagados em vez de mascarados, RLS de chat_conversations operacional, RPC com parâmetro correto, status de documento mapeado, validação client-side, admin enxergando documentos, índices presentes e erros de chat tipados.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15**

Property 2: Preservation — Comportamentos existentes inalterados

_For any_ input where the bug condition does NOT hold (`¬isBugCondition_N(X)` for all `N ∈ {1..15}`), the fixed system SHALL produce exactly the same observable result as the original system, preserving: autenticação anti-enumeração e tempos mínimos, regras de validação de senha, leitura pública e privada de fretes (incluindo masking de valor para anônimos), registro de cliques e visualizações, geocoding e busca PostGIS, upload e listagem de documentos, atualização de campos de perfil já mapeados, criação de avaliações com unique constraint, painéis admin, notificações, e idempotência da migration sob múltiplas execuções.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 3.20, 3.21, 3.22, 3.23, 3.24**

---

## Estratégia de Validação

### Validação manual por bug

Cada bug tem um teste manual mínimo executável após o deploy:

| Bug | Teste manual |
|-----|--------------|
| 1   | Abrir chat de suporte e chat de frete, verificar que não há 406. |
| 2   | Editar perfil de motorista preenchendo placa, modelo, ano. Recarregar e verificar persistência. |
| 3   | Upload de cada tipo de documento (incluindo `crlv_carreta_4`). |
| 4   | Login como embarcador novo (cadastro recente) e criar frete. |
| 5   | Simular falha forçada após `users` insert e verificar que o usuário não consegue fazer login depois. |
| 6   | Coberto por Bug 3. |
| 7   | Upload de `profile_photo` e abrir outra tela que lê `users.profile_photo_url`. |
| 8   | Forçar erro `PGRST301` (ex: revogar grants temporariamente) e ver erro propagado. |
| 9   | Login como usuário não-admin e abrir chat de suporte. |
| 10  | Visualizar um frete e verificar incremento de `views_count`. |
| 11  | Aprovar manualmente um documento via admin e verificar status na UI do motorista. |
| 12  | Tentar passar tipo inválido via DevTools e ver mensagem em pt-BR. |
| 13  | Login como admin e listar documentos pendentes. |
| 14  | Verificar via `EXPLAIN ANALYZE` que queries usam os índices novos. |
| 15  | Forçar erro de chat e verificar `instanceof ChatError` no console. |

### Property-Based Tests planejados (fase de tasks)

- **`documentTypeValidation.property.test.ts`**: para qualquer string aleatória, `validateDocumentType` retorna `true` se e somente se a string está em `VALID_DOCUMENT_TYPES`.
- **`registerRollback.property.test.ts`**: para qualquer cenário simulado de falha (mock do supabase em qualquer passo), o estado final em `users` é vazio se a falha ocorreu após `users` insert.
- **`chatErrorMapping.property.test.ts`**: para qualquer combinação de `code` e `message` do Supabase, `mapSupabaseError` retorna uma `ChatError` com `code` no conjunto canônico.
- **`migrationIdempotence.property.test.ts`** (integração SQL): rodar a migration N vezes em um banco de teste e verificar que o estado final é igual.

### Ordem recomendada de aplicação

1. **Aplicar migration 009** em ambiente de staging. Validar com smoke tests manuais.
2. **Aplicar migration 009** em produção (janela de manutenção opcional, mas operações são online-safe exceto o backfill que é rápido).
3. **Deploy do código TypeScript** após confirmação de que o schema novo está ativo.
4. **Smoke test manual** dos 7 sintomas de alto nível originalmente reportados (cadastro, upload foto, atualização de dados, ver valor frete, upload doc motorista, criar frete, chat).

---

## Riscos e Mitigações

### Risco: migration falha em ambiente sujo

Registros existentes podem violar o novo CHECK constraint de `documents.document_type` se houver lixo histórico. O `ALTER TABLE ADD CONSTRAINT` falharia.

**Mitigação**: bloco `DO $$ ... $$` antes do `ALTER` que conta registros violadores e levanta exceção amigável instruindo limpeza prévia. A migration falha de forma limpa antes de causar dano, e o operador sabe exatamente o que fazer.

### Risco: rollback compensatório em auth deixa registro órfão no Supabase Auth

Se `insert motoristas`/`embarcadores` falha, deletamos de `users` mas o usuário em `auth.users` permanece (não temos privilégio para deletar do client).

**Mitigação 1**: sempre fazer `supabase.auth.signOut()` antes de retornar erro, garantindo que nenhum token persistido aponte para o usuário órfão.

**Mitigação 2**: como o login depende do registro em `users` (a query `SELECT * FROM users WHERE id = ...` retorna vazio), o usuário órfão não consegue logar. O efeito do órfão é apenas ocupar uma entrada em `auth.users`, sem riscos de segurança.

**Mitigação 3 (futura)**: implementar RPC `register_user_atomic` no Postgres que faz tudo numa transação real e expor via `supabase.rpc(...)`.

### Risco: trigger de profile_photo_url pode entrar em loop com RLS

O trigger executa UPDATE em `users` sob a sessão do usuário corrente. Se a política `users_update_policy` for muito restritiva, o UPDATE falha silenciosamente.

**Mitigação**: usar `SECURITY DEFINER` na função do trigger para que o UPDATE rode com privilégio do owner da função (postgres), bypassando RLS. Definir `SET search_path = public` para evitar ataques de search_path hijacking.

### Risco: dois inserts de `chat_conversations` para o mesmo `user_id` (race condition em getOrCreateConversation)

A constraint `UNIQUE(user_id)` em `chat_conversations` garante que o segundo insert falhe — porém o código atual não trata o caso, propagando erro em cenários de double-click.

**Mitigação (não-bloqueante)**: documentar como melhoria futura. Não impacta os 15 bugs deste spec.

### Risco: deploy do código antes da migration

Se o código novo (`VALID_DOCUMENT_TYPES` expandido) for deployado antes da migration, uploads de novos tipos falharão no servidor com violação de CHECK constraint.

**Mitigação**: ordem estrita: migration primeiro, código depois. O código antigo é compatível com schema novo (subset de tipos), então a migration sozinha é segura.
