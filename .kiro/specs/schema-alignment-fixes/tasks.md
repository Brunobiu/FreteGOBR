# Plano de Implementação — Schema Alignment Fixes

Este plano implementa as correções dos 15 bugs documentados em `bugfix.md`, seguindo a solução técnica detalhada em `design.md`. A execução está dividida em duas frentes paralelas:

- **Frente A — SQL**: migration consolidada `009_consolidated_alignment.sql` (Tarefa 1).
- **Frente B — TypeScript**: ajustes nos serviços e páginas (Tarefas 2 a 6).

Após as correções, testes baseados em propriedades (Tarefa 7, opcionais) e validação manual end-to-end (Tarefa 8).

**Ordem recomendada de deploy**: aplicar migration primeiro, depois código TypeScript. A migration é segura sob o código antigo; o código novo depende do schema novo.

**Convenções**:
- `_Refs: Bug N_` indica quais bugs do `bugfix.md` cada tarefa endereça.
- Tarefas marcadas com `*` são opcionais (testes baseados em propriedades).
- Cada tarefa identifica os arquivos a modificar.

---

- [x] 1. Criar migration SQL consolidada `supabase/migrations/009_consolidated_alignment.sql`
  - Arquivo único, idempotente, envolto em `BEGIN; ... COMMIT;`
  - Pode ser aplicada múltiplas vezes sem erro (uso de `IF NOT EXISTS`, `DROP ... IF EXISTS`, `CREATE OR REPLACE`)
  - Resolve o estado de schema independente das migrations corretivas anteriores (004, 006, 007, 008) terem sido aplicadas
  - _Refs: Bugs 1, 2, 3, 4, 6, 7, 9, 10, 11, 13, 14_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.9, 2.10, 2.11, 2.13, 2.14, 3.23, 3.24_

  - [x] 1.1 Garantir tabelas de chat existem
    - `CREATE TABLE IF NOT EXISTS chat_conversations` (suporte ao usuário) com colunas e UNIQUE em `user_id`
    - `CREATE TABLE IF NOT EXISTS chat_messages` com FK para `chat_conversations`
    - `CREATE TABLE IF NOT EXISTS conversations` (chat motorista-embarcador) com colunas `motorista_id`, `embarcador_id`, `frete_id`
    - `CREATE TABLE IF NOT EXISTS messages` com FK para `conversations`
    - Habilitar RLS em todas as quatro tabelas
    - _Refs: Bug 1_

  - [x] 1.2 Adicionar colunas de veículo em `motoristas`
    - `ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(10)`
    - `ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR(100)`
    - `ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS vehicle_year INTEGER`
    - _Refs: Bug 2_

  - [x] 1.3 Adicionar colunas de revisão em `documents`
    - `ALTER TABLE documents ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pendente'`
    - `ALTER TABLE documents ADD COLUMN IF NOT EXISTS rejection_reason TEXT`
    - `ALTER TABLE documents ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id)`
    - `ALTER TABLE documents ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE`
    - _Refs: Bug 11_

  - [x] 1.4 Recriar CHECK constraint de `documents.document_type` com lista canônica
    - Bloco `DO $$ ... $$` que conta registros existentes violando a nova lista e levanta exceção amigável caso encontre lixo histórico
    - `DROP CONSTRAINT IF EXISTS documents_document_type_check`
    - `ADD CONSTRAINT documents_document_type_check CHECK (document_type IN (...))` com os 19 tipos: `cpf`, `cnh`, `antt`, `vehicle_registration`, `vehicle_insurance`, `profile_photo`, `crlv_cavalo`, `crlv_carreta_1` a `crlv_carreta_4`, `rntrc_cavalo`, `rntrc_carreta_1` e `rntrc_carreta_2`, `foto_segurando_cnh`, `foto_frente_caminhao`, `comprovante_endereco_proprietario`, `comprovante_endereco_motorista`, `foto_caminhao_completo`
    - _Refs: Bugs 3, 6_

  - [x] 1.5 Recriar `fretes_insert_policy` permissiva
    - `DROP POLICY IF EXISTS fretes_insert_policy ON fretes`
    - `CREATE POLICY fretes_insert_policy ON fretes FOR INSERT WITH CHECK (embarcador_id = auth.uid() AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'embarcador'))`
    - Removida a dependência de `EXISTS (... FROM embarcadores)`
    - _Refs: Bug 4_

  - [x] 1.6 Recriar políticas RLS de `chat_conversations` e `chat_messages`
    - Drop e recreate idempotente das políticas SELECT/INSERT/UPDATE/DELETE
    - Owner (`user_id = auth.uid()`) ou admin (`user_type = 'admin'`) podem operar
    - _Refs: Bug 9_

  - [x] 1.7 Consolidar políticas RLS de `documents`
    - Drop de todas as políticas existentes (incluindo a duplicada `"Admin can update document status"` da migration 007)
    - Recreate unificado: SELECT/UPDATE/DELETE permitidos para owner OU admin; INSERT apenas para owner
    - _Refs: Bug 13_

  - [x] 1.8 Backfill de embarcadores faltantes
    - `INSERT INTO embarcadores (id, company_name, whatsapp) SELECT u.id, COALESCE(u.name, 'Empresa'), u.phone FROM users u WHERE u.user_type = 'embarcador' AND NOT EXISTS (...) ON CONFLICT (id) DO NOTHING`
    - Executado depois da recriação da política para garantir que todos os embarcadores legados tenham registro filho
    - _Refs: Bug 4_

  - [x] 1.9 Criar índices compostos
    - `CREATE INDEX IF NOT EXISTS idx_documents_user_type_status ON documents(user_id, document_type, status)`
    - `CREATE INDEX IF NOT EXISTS idx_conversations_motorista_embarcador ON conversations(motorista_id, embarcador_id)`
    - _Refs: Bug 14_

  - [x] 1.10 Recriar `increment_frete_views` com parâmetro `frete_id_param`
    - `CREATE OR REPLACE FUNCTION increment_frete_views(frete_id_param UUID) RETURNS VOID`
    - Corpo faz `UPDATE fretes SET views_count = views_count + 1, updated_at = NOW() WHERE id = frete_id_param`
    - Sobrescreve a versão antiga com `p_frete_id` da migration 004
    - _Refs: Bug 10_

  - [x] 1.11 Criar trigger `sync_profile_photo_url` com SECURITY DEFINER
    - `CREATE OR REPLACE FUNCTION sync_profile_photo_url() RETURNS TRIGGER SECURITY DEFINER SET search_path = public`
    - Corpo: `IF NEW.document_type = 'profile_photo' THEN UPDATE users SET profile_photo_url = NEW.file_path, updated_at = NOW() WHERE id = NEW.user_id; END IF`
    - `DROP TRIGGER IF EXISTS sync_profile_photo_url_trigger ON documents`
    - `CREATE TRIGGER sync_profile_photo_url_trigger AFTER INSERT ON documents FOR EACH ROW EXECUTE FUNCTION sync_profile_photo_url()`
    - _Refs: Bug 7_

---

- [x] 2. Atualizar `src/services/documents.ts` (base para outros serviços)
  - Centralizar lista canônica de tipos como fonte única da verdade
  - Mapear todas as colunas do banco para a interface TypeScript
  - Validar `documentType` antes de qualquer chamada ao Supabase
  - _Refs: Bugs 3, 6, 7, 11, 12_
  - _Requirements: 2.3, 2.6, 2.7, 2.11, 2.12_

  - [x] 2.1 Definir `VALID_DOCUMENT_TYPES` como const array com 19 tipos
    - Exportar `as const` para preservar literal types
    - Lista exatamente igual à do CHECK constraint da migration (Tarefa 1.4)
    - _Refs: Bugs 3, 6_

  - [x] 2.2 Derivar `DocumentType` de `VALID_DOCUMENT_TYPES`
    - `export type DocumentType = (typeof VALID_DOCUMENT_TYPES)[number]`
    - Substitui o union type literal antigo
    - _Refs: Bug 3_

  - [x] 2.3 Exportar `validateDocumentType` como type guard
    - `export function validateDocumentType(type: string): type is DocumentType`
    - Usa `(VALID_DOCUMENT_TYPES as readonly string[]).includes(type)`
    - _Refs: Bug 12_

  - [x] 2.4 Adicionar campos de revisão em `DocumentMetadata`
    - `status?: 'pendente' | 'aprovado' | 'rejeitado'`
    - `rejectionReason?: string | null`
    - `reviewedBy?: string | null`
    - `reviewedAt?: Date | null`
    - _Refs: Bug 11_

  - [x] 2.5 Mapear novos campos em `getDocumentsByUser` e `getDocumentByType`
    - Incluir `status`, `rejection_reason`, `reviewed_by`, `reviewed_at` na lista de SELECT
    - Converter snake_case para camelCase no retorno
    - Tolerar `undefined`/`null` para registros antigos sem `status`
    - _Refs: Bug 11_

  - [x] 2.6 Validar `documentType` em `uploadDocument` antes do request
    - Chamar `validateDocumentType(documentType)` no início da função
    - Lançar `DocumentError('Tipo de documento inválido: "..."', 'INVALID_DOCUMENT_TYPE', 400)` se inválido
    - Nenhuma chamada ao Supabase quando o tipo é inválido
    - _Refs: Bug 12_

  - [x] 2.7 Sincronizar `users.profile_photo_url` quando upload é `profile_photo`
    - Após upload bem-sucedido, se `documentType === 'profile_photo'`, executar `UPDATE users SET profile_photo_url = uploadData.path WHERE id = userId`
    - Defesa em profundidade: caso o trigger SQL (Tarefa 1.11) não esteja ativo
    - Erros nesse UPDATE são logados mas não interrompem o upload (idempotente com o trigger)
    - _Refs: Bug 7_

---

- [x] 3. Tornar `register` transacional em `src/services/auth.ts`
  - Implementar rollback compensatório quando inserts subsequentes ao `users` falham
  - Garantir que estado final é consistente (sem usuário "órfão" capaz de logar)
  - _Refs: Bug 5_
  - _Requirements: 2.5, 3.1, 3.2, 3.3_

  - [x] 3.1 Implementar rollback compensatório em caso de falha pós-`users` insert
    - Se `insert motoristas` ou `insert embarcadores` falhar, executar `DELETE FROM users WHERE id = authData.user.id`
    - Bloco `try/catch` envolvendo os inserts dependentes
    - Reproduzir o erro original ao chamador via `throw`
    - _Refs: Bug 5_

  - [x] 3.2 Chamar `supabase.auth.signOut()` em qualquer falha pós-`signUp`
    - Garante que nenhum token persistido aponte para usuário órfão em `auth.users`
    - Executado dentro do mesmo bloco `catch` do rollback (Tarefa 3.1)
    - _Refs: Bug 5_

  - [x] 3.3 Garantir consistência observável: usuário sem registro filho não consegue logar
    - Documentar inline (comentário) que o login depende de `SELECT * FROM users WHERE id = ...`
    - Sem registro em `users`, o usuário não consegue autenticar mesmo que `auth.users` retenha a entrada
    - Preservar o caminho feliz: nenhuma alteração na lógica de sucesso
    - _Refs: Bug 5_

---

- [x] 4. Propagar erros em `src/services/fretes.ts`
  - Substituir degradação silenciosa por log estruturado e exceção propagada
  - _Refs: Bug 8_
  - _Requirements: 2.8, 3.5, 3.6, 3.7_

  - [x] 4.1 Em `getActiveFretes`, substituir `return []` silencioso por `log + throw`
    - Remover o `if (error.message.includes('lock') || ...) return []`
    - Substituir por `throw new Error(\`Erro ao buscar fretes: ${error.message}\`)`
    - _Refs: Bug 8_

  - [x] 4.2 Adicionar log estruturado com `code`, `message`, `filters`
    - `console.error('[FRETES] getActiveFretes failed', { code: error.code, message: error.message, filters })`
    - Antes do `throw`, para que problemas reais (RLS, auth) sejam visíveis nos logs
    - _Refs: Bug 8_

---

- [x] 5. Criar `ChatError` em `src/services/chat.ts` e `src/services/chatFrete.ts`
  - Substituir `Error` genérico por exceção tipada com códigos discriminados
  - Padrão similar a `DocumentError` existente
  - _Refs: Bug 15_
  - _Requirements: 2.15_

  - [x] 5.1 Adicionar classe `ChatError` com codes discriminados
    - Codes: `'PERMISSION_DENIED' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'VALIDATION_ERROR' | 'UNKNOWN'`
    - Construtor: `(message: string, code: ChatErrorCode, statusCode: number = 400)`
    - `name = 'ChatError'`
    - Definir uma vez em `chat.ts` e reusar em `chatFrete.ts` via import
    - _Refs: Bug 15_

  - [x] 5.2 Adicionar helper `mapSupabaseError(error): ChatError`
    - `PGRST301` ou mensagem com `permission` → `PERMISSION_DENIED` (403)
    - `PGRST116` → `NOT_FOUND` (404)
    - Mensagem com `network`/`fetch` → `NETWORK_ERROR` (503)
    - Caso default → `UNKNOWN` (500)
    - Mensagens em pt-BR
    - _Refs: Bug 15_

  - [x] 5.3 Substituir todos os `throw new Error` por `throw mapSupabaseError`
    - Em `chat.ts`: funções como `getOrCreateConversation`, `sendMessage`, `getMessages`, `getConversation`
    - Em `chatFrete.ts`: funções equivalentes para chat motorista-embarcador
    - Caminhos felizes inalterados; apenas a estrutura dos erros muda
    - _Refs: Bug 15_

---

- [x] 6. Validar tipo de documento em `src/pages/MotoristaPerfilPage.tsx`
  - Remover cast `as any` e validar antes do upload
  - Feedback em pt-BR para o usuário
  - _Refs: Bug 12_
  - _Requirements: 2.12_

  - [x] 6.1 Importar `validateDocumentType` de `documents.ts`
    - Junto com `DocumentType` se necessário para tipagem local
    - _Refs: Bug 12_

  - [x] 6.2 Validar `docType` em `handleDocUpload` antes de chamar `uploadDocument`
    - `if (!validateDocumentType(docType)) { setError(...); return; }`
    - Validação ocorre antes de qualquer chamada de rede
    - _Refs: Bug 12_

  - [x] 6.3 Remover cast `as any` na chamada de `uploadDocument`
    - Após a guarda da Tarefa 6.2, o TypeScript estreita `docType` para `DocumentType`
    - `uploadDocument(user.id, docType, file)` sem cast
    - _Refs: Bug 12_

  - [x] 6.4 Exibir erro em pt-BR se tipo inválido
    - Mensagem amigável: `Tipo de documento inválido: "${docType}". Recarregue a página e tente novamente.`
    - Usar o mesmo `setError` já existente na página
    - _Refs: Bug 12_

---

- [ ] 7. Property-Based Tests (opcionais)

  - [ ] 7.1* Criar `src/__tests__/documentTypeValidation.property.test.ts`
    - **Property 1: Bug Condition** — Validação de tipos de documento
    - Para qualquer string aleatória, `validateDocumentType` retorna `true` se e somente se a string ∈ `VALID_DOCUMENT_TYPES`
    - Usar `fc.string()` e `fc.constantFrom(...VALID_DOCUMENT_TYPES)`
    - Cobre Bugs 3, 6, 12
    - _Refs: Bugs 3, 6, 12_
    - _Requirements: 2.3, 2.12_

  - [ ] 7.2* Criar `src/__tests__/registerRollback.property.test.ts`
    - **Property 1: Bug Condition** — Rollback transacional do cadastro
    - Mock do `supabase` com falha forçada em qualquer passo após `signUp`
    - Para qualquer cenário simulado de falha, o estado final em `users` deve ser vazio
    - Verificar que `signOut` foi chamado em todos os caminhos de erro
    - Cobre Bug 5
    - _Refs: Bug 5_
    - _Requirements: 2.5_

  - [ ] 7.3* Criar `src/__tests__/chatErrorMapping.property.test.ts`
    - **Property 1: Bug Condition** — Mapeamento de erros de chat
    - Para qualquer combinação de `code` e `message` do Supabase, `mapSupabaseError` retorna `ChatError` com `code` no conjunto `{PERMISSION_DENIED, NOT_FOUND, NETWORK_ERROR, VALIDATION_ERROR, UNKNOWN}`
    - **Property 2: Preservation** — Códigos canônicos conhecidos sempre mapeiam corretamente: `PGRST301` → `PERMISSION_DENIED`, `PGRST116` → `NOT_FOUND`
    - Cobre Bug 15
    - _Refs: Bug 15_
    - _Requirements: 2.15_

---

- [ ] 8. Validação manual end-to-end (após aplicação da migration)
  - Smoke tests que cobrem os 7 sintomas originalmente reportados pelo usuário
  - Executar em ambiente de staging primeiro, depois em produção
  - _Refs: Bugs 1-15_
  - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.9, 2.10, 2.13, 2.15_

  - [x] 8.1 Aplicar migration 009 no Supabase
    - Rodar em staging primeiro
    - Verificar logs por exceções amigáveis (ex: lixo histórico em `documents.document_type`)
    - Re-executar a migration uma segunda vez para validar idempotência (Tarefa 1)
    - _Refs: Bugs 1-14, 3.23, 3.24_

  - [ ] 8.2 Smoke test: cadastro de motorista
    - Cadastrar motorista novo via UI
    - Confirmar registro em `users` E `motoristas`
    - Forçar falha simulada (DevTools) e verificar que `users` permanece limpo
    - _Refs: Bug 5_

  - [ ] 8.3 Smoke test: cadastro de embarcador
    - Cadastrar embarcador novo via UI
    - Confirmar registro em `users` E `embarcadores`
    - _Refs: Bug 5_

  - [ ] 8.4 Smoke test: upload de foto de perfil
    - Logar como embarcador, fazer upload de foto
    - Confirmar registro em `documents` com `document_type = 'profile_photo'`
    - Recarregar e verificar que `users.profile_photo_url` está preenchido
    - Avatar deve aparecer em outras telas que leem `users.profile_photo_url`
    - _Refs: Bugs 6, 7_

  - [ ] 8.5 Smoke test: atualização de dados de motorista
    - Editar perfil preenchendo `name`, `vehicle_plate`, `vehicle_model`, `vehicle_year`
    - Salvar, recarregar a página, confirmar persistência de todos os campos
    - _Refs: Bug 2_

  - [ ] 8.6 Smoke test: upload de cada tipo de documento do motorista
    - Iterar sobre os 19 tipos válidos (especialmente `crlv_carreta_4`, `rntrc_carreta_2`, `foto_segurando_cnh`)
    - Cada upload deve retornar sucesso e aparecer na lista
    - Tentar tipo inválido via DevTools deve falhar com mensagem em pt-BR (sem chamada ao servidor)
    - _Refs: Bugs 3, 12_

  - [ ] 8.7 Smoke test: criação de frete pelo embarcador
    - Logar como embarcador (incluindo legacy sem registro em `embarcadores` antes da migration)
    - Criar frete via UI
    - Confirmar inserção em `fretes` sem 401 Unauthorized
    - _Refs: Bug 4_

  - [ ] 8.8 Smoke test: motorista visualiza frete com valor formatado
    - Logar como motorista, abrir um frete da listagem
    - Valor deve aparecer em formato BRL no `FreteCard`
    - Confirmar que `views_count` incrementa via RPC `increment_frete_views(frete_id_param: ...)`
    - _Refs: Bug 10_

  - [ ] 8.9 Smoke test: chat de suporte e chat de frete sem erro 406
    - Abrir chat de suporte (`chat_conversations`/`chat_messages`)
    - Abrir chat de frete (`conversations`/`messages`)
    - Enviar mensagens em ambos e confirmar persistência
    - Forçar erro de permissão (ex: invalidar sessão) e verificar que erro é `instanceof ChatError` com `code` correto
    - _Refs: Bugs 1, 9, 15_

---

## Checkpoint final

Ao concluir todas as tarefas:

1. Migration 009 aplicada em produção e idempotente confirmada (Tarefa 8.1)
2. Build TypeScript limpo (`tsc --noEmit`)
3. Lint sem erros novos (`npm run lint`)
4. Todos os smoke tests da Tarefa 8 passando
5. Os 7 sintomas originalmente reportados pelo usuário resolvidos:
   - Cadastro funciona sem 422
   - Upload de foto de perfil persiste e aparece nas demais telas
   - Atualização de dados pessoais persiste
   - Motoristas veem o valor dos fretes (sem mudança, mas validar)
   - Upload de documentos do motorista funciona para todos os tipos
   - Criação de fretes não retorna 401
   - Tabelas de chat não retornam 406
