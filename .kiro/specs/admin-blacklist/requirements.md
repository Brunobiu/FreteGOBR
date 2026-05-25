# Requirements Document: admin-blacklist

## Introduction

Esta spec entrega o **módulo de Blacklist** do painel administrativo do FreteGO. Sobre as fundações já entregues em `admin-foundation` (RBAC, MFA, audit-by-construction, sessão isolada, Stealth 404, RPC `is_admin_with_permission`, padrão `executeAdminMutation`), `admin-users` (gestão de usuários, colunas `users.is_active`/`ban_reason`/`banned_at`/`banned_by`, padrão de versionamento otimista via `updated_at`, padrão de bulk com `Promise.allSettled` + concorrência 5, CSV BOM UTF-8 + sep `;`) e `admin-fretes` (gestão de fretes, RPC `admin_delete_frete`, padrão de skip idempotente, audit log explícito de operação pulada), este módulo adiciona:

1. Tela de listagem paginada de entradas em `/admin/blacklist` com filtros (tipo, status, criado por, período, busca livre), paginação 25/página e export CSV padrão admin (BOM UTF-8 + `;`, RFC 4180).
2. Tela de detalhe em `/admin/blacklist/:id` com dados da entrada, snapshots de criação/atualização/remoção, link para o usuário banido que originou a entrada (se houver) e timeline de tentativas de uso (login/signup/verificação bloqueados) extraída de `admin_audit_logs`.
3. Adição manual de entradas (single) em modal, com 5 tipos de identificador (`phone`, `cpf`, `cnpj`, `email`, `ip_address`), normalização canônica e detecção de duplicata (oferta de reativação ao admin se já existir entrada removida).
4. Edição de entrada (motivo, expiração) com versionamento otimista via `updated_at`.
5. Remoção (soft delete) com motivo opcional, single ou em massa (até 200), idempotente.
6. Bulk import via upload de arquivo CSV (até 1000 linhas/operação) com pré-visualização, validação por linha e relatório de resultado (`success`, `skipped`, `failed`).
7. Auto-blacklist opt-in no fluxo de **ban** de usuário (entregue em `admin-users` Req 4): checkbox `Adicionar identificadores à blacklist` que, ao banir, cria entradas para `phone`, `cpf` (motorista), `cnpj` (embarcador) e `email`, todas vinculadas ao `users.id` banido com motivo herdado de `ban_reason`.
8. Reverso: no fluxo de **unban**, oferecer remover automaticamente as entradas vinculadas ao `users.id` desbanido.
9. Hook de bloqueio em **login** (telefone): se o telefone informado está em entrada ativa de blacklist, o login falha com mensagem genérica `Não foi possível autenticar.` e gera audit log `BLACKLIST_LOGIN_BLOCKED`.
10. Hook de bloqueio em **signup** (motorista, embarcador): se phone, cpf, cnpj ou email estão em entradas ativas, o cadastro falha com mensagem genérica `Não foi possível concluir o cadastro.` e gera audit log `BLACKLIST_SIGNUP_BLOCKED`.
11. Hook de bloqueio em **verificação de e-mail**: se o email está em entrada ativa, a verificação falha antes de mandar o código, com mensagem genérica e audit log `BLACKLIST_EMAIL_BLOCKED`.
12. Reforço de RLS via novas policies em `admin_blacklist` baseadas em `is_admin_with_permission`, mais função `is_blacklisted(p_type text, p_value text) RETURNS boolean` `STABLE SECURITY DEFINER` consumível pelos hooks (anônimo no signup, `authenticated` no login).
13. Trigger `BEFORE INSERT ON users` que rejeita criação de conta com phone/cpf/cnpj/email em entrada ativa, fechando o caminho contra bypass via cliente service-role ou janela de corrida.
14. Migration `034_admin_blacklist.sql` adicionando: tabela `admin_blacklist`, índices, função `is_blacklisted`, RPCs `admin_blacklist_add`, `admin_blacklist_update`, `admin_blacklist_remove`, `admin_blacklist_remove_by_user`, trigger de bloqueio em `users`, policies RLS, atualização de `is_admin_with_permission` para `BLACKLIST_MANAGE` e `BLACKLIST_BULK`. Acompanhada de `034_admin_blacklist_rollback.sql`.

A stack continua TypeScript + React + Vite + TailwindCSS + Supabase + Vitest + fast-check. Esta spec adiciona a migration `034_admin_blacklist.sql`, novos componentes em `src/components/admin/blacklist/`, novas páginas em `src/pages/admin/blacklist/`, o serviço `src/services/admin/blacklist.ts`, atualizações em `src/services/admin/permissions.ts` (adicionar `BLACKLIST_MANAGE` e `BLACKLIST_BULK`, manter `BLACKLIST_VIEW`, descontinuar `BLACKLIST_EDIT`), e os hooks de bloqueio nos formulários de login, cadastro e verificação de e-mail. Mensagens user-facing (não-admin) em pontos de bloqueio são genéricas e idênticas às mensagens já existentes de credencial inválida / usuário duplicado, para evitar enumeration.

**Fora de escopo desta spec** (vão para outras specs já planejadas):

- `admin-suporte`: workflow de revisão de blacklist apelada pelo usuário, tickets de desbloqueio.
- `admin-dashboard`: cards de métricas globais (total de entradas, bloqueios na semana, top motivos).
- `admin-crm`: comunicação ativa com usuários impactados.
- Detecção automática de fraude (heurísticas, scoring, ML) — esta spec apenas oferece o mecanismo manual + auto-blacklist no ban.
- Captura e bloqueio por `device_fingerprint` — não está nos 5 tipos suportados nesta spec; fica para spec futura quando houver captura client-side estável.
- Captura automática de `ip_address` na criação de conta para auto-blacklist — não há coluna `users.last_login_ip` no schema atual; o bloqueio por IP nesta spec funciona apenas via inserção manual pelo admin.

## Glossary

- **Admin_Panel**: Painel administrativo já entregue em `admin-foundation`, acessível em `/admin/*`.
- **Admin_Session**: Sessão admin isolada em `localStorage` sob `fretego_admin_session`, fornecida pelo `AdminProvider`.
- **AdminGuard**: Componente que envolve rotas `/admin/*` e cai em `Stealth_404` se sessão admin inválida.
- **Stealth_404**: Página 404 visualmente idêntica à 404 padrão do app, renderizada para acessos não autorizados a `/admin/*` (entregue em `admin-foundation`).
- **Permission_Matrix**: Matriz determinística `(AdminRole, AdminAction) → boolean` em `src/services/admin/permissions.ts`.
- **executeAdminMutation**: Helper em `src/services/admin/audit.ts` que executa uma mutação admin sempre acompanhada de audit log, com rollback-log em caso de falha (entregue em `admin-foundation`).
- **is_admin_with_permission**: Função SQL `STABLE SECURITY DEFINER` em Postgres que reproduz a `Permission_Matrix` no banco para reforço de RLS.
- **Master_Admin**: Super_Admin com `users.admin_username = 'Nexus_Vortex99'` (Bruno Henrique). Imutável em todas as operações admin (definido em `admin-users`). Identificadores ligados ao Master_Admin **não podem** ser inseridos na blacklist (Req 21).
- **Blacklist_Service**: Novo serviço em `src/services/admin/blacklist.ts` que centraliza as operações da spec.
- **Blacklist_List_Page**: Página `/admin/blacklist` com listagem paginada, filtros, busca, ordenação e bulk actions.
- **Blacklist_Detail_Page**: Página `/admin/blacklist/:id` com dados consolidados de uma entrada.
- **Blacklist_Add_Modal**: Modal para adição manual de uma única entrada.
- **Blacklist_Edit_Modal**: Modal para edição de motivo e expiração de uma entrada existente.
- **Blacklist_Remove_Modal**: Modal de confirmação de remoção (soft delete) com textarea de motivo opcional.
- **Blacklist_Bulk_Import_Page**: Página `/admin/blacklist/bulk` com upload de CSV, pré-visualização e relatório.
- **Blacklist_Entry**: Linha em `admin_blacklist` representando um identificador bloqueado.
- **Blacklist_Type**: Tipo do identificador. Domínio fechado (CHECK constraint): `phone`, `cpf`, `cnpj`, `email`, `ip_address`.
- **Blacklist_Status**: Status derivado da entrada, calculado em runtime:
  - `ativo` quando `removed_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`.
  - `expirado` quando `removed_at IS NULL AND expires_at IS NOT NULL AND expires_at <= NOW()`.
  - `removido` quando `removed_at IS NOT NULL`.
- **Blacklist_Active**: Predicado SQL `removed_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`. Único critério usado pelos pontos de bloqueio (login/signup/email).
- **Blacklist_Value_Raw**: Valor textual recebido do admin antes de qualquer normalização.
- **Blacklist_Value_Normalized**: Valor canônico armazenado em `admin_blacklist.value`, resultado de aplicar `Blacklist_Normalizer` ao `Blacklist_Value_Raw`.
- **Blacklist_Normalizer**: Função pura (existe no TS em `src/services/admin/blacklist.ts` e no SQL como `blacklist_normalize(p_type text, p_raw text) RETURNS text`) que, dado `(type, raw) → normalized`, aplica:
  - `phone`: remove tudo que não é dígito; remove prefixo `55` quando o resultado tem 12 ou 13 dígitos (DDI Brasil). Resultado: 10 ou 11 dígitos.
  - `cpf`: remove tudo que não é dígito. Resultado: 11 dígitos.
  - `cnpj`: remove tudo que não é dígito. Resultado: 14 dígitos.
  - `email`: `trim()` + `lower()`.
  - `ip_address`: `trim()`; preserva forma original (IPv4 dotted ou IPv6 hex), sem expansão de zeros nem `lower()` adicional além do já textual.
- **Blacklist_Validator**: Função pura em `src/services/admin/blacklist.ts` que, dado `(type, normalized) → { ok: true } | { ok: false, reason: 'INVALID_INPUT', detail }`. Regras em Req 14.
- **Blacklist_Reason**: Motivo obrigatório de criação da entrada. Texto livre 1..1000 caracteres após `trim()`.
- **Blacklist_Remove_Reason**: Motivo opcional de remoção. Texto livre 0..1000 caracteres.
- **Blacklist_Expires_At**: Timestamp opcional `expires_at TIMESTAMPTZ NULL`. `NULL` = bloqueio permanente; valor futuro = expiração programada. Valores `<= NOW()` no momento da inserção são rejeitados como `INVALID_INPUT`.
- **Blacklist_Status_Filter**: Filtro de status com valores `todos`, `ativo`, `expirado`, `removido`.
- **Blacklist_Type_Filter**: Filtro de tipo com valores `todos`, `phone`, `cpf`, `cnpj`, `email`, `ip_address`.
- **Blacklist_Period_Filter**: Filtro de período aplicado a `created_at`, com `from` e `to` em datas ISO (UTC).
- **Blacklist_Search**: Busca livre que casa, case-insensitive, contra `admin_blacklist.value` e `admin_blacklist.reason` usando `ILIKE '%termo%'`.
- **Blacklist_Sort**: Ordenação com valores `created_desc` (padrão), `created_asc`, `expires_asc`, `removed_desc`.
- **Blacklist_CSV_Header**: Cabeçalho fixo do export `id;type;value;reason;status;created_by_name;created_at;expires_at;removed_by_name;removed_at;source_user_id`.
- **Blacklist_Export_Format**: CSV com `Blacklist_CSV_Header`, separador `;`, prefixo BOM UTF-8 (`\uFEFF`), aspas RFC 4180, e até 10000 linhas por export.
- **Blacklist_Import_Header**: Cabeçalho fixo aceito pelo upload de bulk import: `type;value;reason;expires_at`. `expires_at` é coluna opcional (vazio = permanente).
- **Bulk_Blacklist_Import**: Operação que recebe um arquivo CSV de até 1000 linhas (excluindo cabeçalho) e tenta inserir cada linha. Resultado `{ success: number, skipped: number, failed: number, details: BulkRow[] }` com 1 audit log `BLACKLIST_BULK_IMPORT` no início + 1 audit log `BLACKLIST_CREATED` ou `BLACKLIST_BULK_IMPORT_SKIPPED` por linha processada.
- **Bulk_Blacklist_Remove**: Operação que recebe lista de até 200 IDs de entradas e remove (soft delete) cada uma. Resultado `{ success, skipped, failed }` com 1 audit log por item processado.
- **Auto_Blacklist_From_Ban**: Operação opcional disparada pelo modal de ban de usuário (`admin-users`) que insere até 4 entradas (`phone`, `cpf` se motorista, `cnpj` se embarcador, `email`) referenciando `users.id` no campo `source_user_id`, com `reason` herdado de `users.ban_reason`. Roda na mesma chamada `executeAdminMutation` do ban (transação implícita ao serviço; ver Req 9).
- **Auto_Unblacklist_From_Unban**: Operação reversa: ao desbanir um usuário em `admin-users`, oferecer checkbox `Remover entradas de blacklist vinculadas a este usuário`. Quando marcado, dispara `admin_blacklist_remove_by_user(p_user_id)` que remove todas as entradas com `source_user_id = p_user_id` ainda ativas.
- **Source_User_Id**: Coluna `admin_blacklist.source_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`. Ligação opcional ao usuário cuja conta originou a inclusão. Usada para rastreabilidade no detalhe da entrada e para o `Auto_Unblacklist_From_Unban`.
- **Signup_Block**: Hook de bloqueio em fluxo de cadastro. Implementado em duas camadas: (a) client-side em `RegisterForm.tsx` via RPC `is_blacklisted(type, value)` antes de `supabase.auth.signUp`; (b) server-side via trigger `BEFORE INSERT ON users` que consulta a mesma função e rejeita o INSERT.
- **Login_Block**: Hook de bloqueio em fluxo de login. Implementado em `LoginForm.tsx` via RPC `is_blacklisted('phone', phoneInput)` ANTES de `supabase.auth.signInWithPassword`. Mensagem genérica idêntica à de credencial inválida.
- **Email_Verification_Block**: Hook de bloqueio na verificação de e-mail (`ModalVerificacaoEmail.tsx`) via RPC `is_blacklisted('email', emailInput)` antes do envio do código.
- **Generic_Login_Message**: String canônica `Não foi possível autenticar.` (sem distinção de causa, idêntica à mensagem de credencial inválida exibida hoje).
- **Generic_Signup_Message**: String canônica `Não foi possível concluir o cadastro.` (idêntica à mensagem genérica de erro de cadastro).
- **Generic_Email_Message**: String canônica `Não foi possível enviar o código.` (idêntica à mensagem genérica de erro no envio de e-mail).
- **Migration_034**: Arquivo `supabase/migrations/034_admin_blacklist.sql`, dependente de migrations `001..033`. Idempotente (uso de `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`/`CREATE POLICY`), envelopada em `BEGIN`/`COMMIT`, com bloco final `-- VERIFY` comentado. Acompanhada de `034_admin_blacklist_rollback.sql`.
- **is_blacklisted**: Função SQL `STABLE SECURITY DEFINER` criada em `Migration_034` com assinatura `is_blacklisted(p_type text, p_value text) RETURNS boolean`. Aplica `blacklist_normalize` server-side e consulta `admin_blacklist WHERE type = p_type AND value = <normalizado> AND removed_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`. Concedida `EXECUTE` para `anon` e `authenticated` (necessário para signup pré-login).
- **admin_blacklist_add**: RPC SQL `SECURITY DEFINER` que insere uma `Blacklist_Entry`, retornando `jsonb_build_object('id', <uuid>)` em sucesso, ou levantando exceção com `errcode` mapeado para um dos códigos: `INVALID_INPUT`, `ALREADY_BLACKLISTED` (entrada ativa já existe), `MASTER_PROTECTED`, `permission_denied`.
- **admin_blacklist_update**: RPC SQL `SECURITY DEFINER` que atualiza `reason` e/ou `expires_at` com checagem de `expected_updated_at`, retornando `jsonb_build_object('updated', true, 'updated_at', <ts>)` ou erro `STALE_VERSION` / `NOT_FOUND` / `ALREADY_REMOVED`.
- **admin_blacklist_remove**: RPC SQL `SECURITY DEFINER` que aplica soft delete (`removed_at = NOW()`, `removed_by = auth.uid()`, `removed_reason = <texto>`), retornando `{ removed: true }` ou `{ skipped: true, reason: 'ALREADY_REMOVED' }`.
- **admin_blacklist_remove_by_user**: RPC SQL `SECURITY DEFINER` que aplica soft delete em todas as entradas ativas com `source_user_id = p_user_id`, retornando `{ removed_count: N }`.
- **Blacklist_Detail_Bundle**: Estrutura agregada retornada por `Blacklist_Service.getBlacklistDetail(id)` contendo: dados completos da entrada, snapshot do criador (admin nome/username), snapshot do removedor (se aplicável), snapshot do `source_user` (se aplicável), e lista paginada de tentativas de uso (`admin_audit_logs WHERE action IN ('BLACKLIST_LOGIN_BLOCKED','BLACKLIST_SIGNUP_BLOCKED','BLACKLIST_EMAIL_BLOCKED') AND target_id = entry.id`).

## Requirements

### Requirement 1: Página `/admin/blacklist` — Listagem Paginada

**User Story:** Como admin com `BLACKLIST_VIEW`, quero uma listagem paginada de entradas com filtros e busca, para encontrar e auditar bloqueios rapidamente.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/blacklist` protegida por `AdminGuard`.
2. THE Blacklist_List_Page SHALL ser acessível apenas a admins com permissão `BLACKLIST_VIEW`.
3. WHEN um admin sem `BLACKLIST_VIEW` acessa `/admin/blacklist`, THE AdminGuard SHALL renderizar `Stealth_404`.
4. THE Blacklist_List_Page SHALL listar registros de `admin_blacklist` com paginação de 25 por página.
5. THE Blacklist_List_Page SHALL exibir, em cada linha: id curto (primeiros 8 chars), tipo (badge colorido por valor), valor exibido conforme regra:
   - `phone`: formatado `(XX) XXXXX-XXXX` quando 11 dígitos, `(XX) XXXX-XXXX` quando 10 dígitos.
   - `cpf`: mascarado `***.***.***-XX` (apenas os 2 últimos dígitos visíveis).
   - `cnpj`: mascarado `**.***.***/****-XX` (apenas os 2 últimos dígitos visíveis).
   - `email`: integral.
   - `ip_address`: integral.
   - motivo truncado em 60 chars + `…`, criado por (nome do admin), criado em, expira em (`—` quando NULL, data quando preenchido), status (`Ativo`/`Expirado`/`Removido`).
6. THE Blacklist_List_Page SHALL exibir contador `Total: N entradas (filtradas)` no topo.
7. THE Blacklist_List_Page SHALL paginar via parâmetros `?page=N&pageSize=25` na URL.
8. WHEN a paginação resulta em página vazia, THE Blacklist_List_Page SHALL exibir estado vazio com mensagem `Nenhuma entrada encontrada com os filtros atuais.`.
9. THE Blacklist_List_Page SHALL renderizar skeleton loading enquanto carrega a página.
10. IF a query falha por erro de rede, THEN THE Blacklist_List_Page SHALL exibir estado de erro com botão `Tentar novamente`.
11. THE Blacklist_List_Page SHALL exibir botão `Adicionar entrada` no topo direito quando o admin tem permissão `BLACKLIST_MANAGE`.
12. THE Blacklist_List_Page SHALL exibir botão `Importar CSV` no topo direito quando o admin tem permissão `BLACKLIST_BULK`.
13. THE Blacklist_List_Page SHALL exibir botão `Exportar CSV` no topo direito quando o admin tem permissão `BLACKLIST_VIEW`.
14. WHEN o admin clica em uma linha, THE Blacklist_List_Page SHALL navegar para `/admin/blacklist/<id>`.

### Requirement 2: Filtros, Busca e Ordenação

**User Story:** Como admin, quero filtrar por tipo, status, criador e período, buscar texto livre e ordenar a lista, para refinar resultados.

#### Acceptance Criteria

1. THE Blacklist_List_Page SHALL oferecer `Blacklist_Type_Filter` como dropdown com opções `Todos`, `Telefone`, `CPF`, `CNPJ`, `E-mail`, `IP`.
2. THE Blacklist_List_Page SHALL oferecer `Blacklist_Status_Filter` como dropdown com opções `Todos`, `Ativos`, `Expirados`, `Removidos`.
3. THE Blacklist_List_Page SHALL oferecer filtro `Criado por` como dropdown searchable que consulta admins (`users WHERE is_superuser = true`) por `name ILIKE '%q%' OR admin_username ILIKE '%q%'`, exibindo `name (admin_username)` em cada item.
4. THE Blacklist_List_Page SHALL oferecer `Blacklist_Period_Filter` com 2 inputs `<input type="date">` para `from` e `to`, ambos opcionais.
5. WHEN `from` é preenchido, THE Blacklist_Service SHALL filtrar `created_at >= from` (00:00:00 UTC do dia).
6. WHEN `to` é preenchido, THE Blacklist_Service SHALL filtrar `created_at <= to` (23:59:59 UTC do dia).
7. IF `from > to` ao submeter, THEN THE Blacklist_List_Page SHALL exibir erro de validação `Data inicial deve ser menor ou igual à final.` e NÃO disparar busca.
8. THE Blacklist_List_Page SHALL oferecer campo `Blacklist_Search` que aceita texto e dispara busca após 300ms de debounce.
9. WHEN `Blacklist_Search` é aplicado, THE Blacklist_Service SHALL casar o termo (case-insensitive) contra `admin_blacklist.value` e `admin_blacklist.reason` usando `ILIKE '%termo%'`.
10. WHEN `Blacklist_Search` recebe string com apenas dígitos e tamanho >= 8, THE Blacklist_Service SHALL casar também contra `admin_blacklist.value` aplicando o mesmo termo já normalizado (somente dígitos), permitindo busca por `(64) 99999-9999` que case com `64999999999`.
11. THE Blacklist_List_Page SHALL oferecer `Blacklist_Sort` como dropdown com `Mais recentes` (padrão), `Mais antigos`, `Expira em breve`, `Removidos recentes`.
12. THE Blacklist_Sort padrão SHALL ser `created_at DESC`.
13. WHEN qualquer filtro ou ordenação muda, THE Blacklist_List_Page SHALL resetar `page = 1`.
14. THE Blacklist_List_Page SHALL preservar todos os filtros e ordenação como query params na URL (`?type=phone&status=ativo&createdBy=<uuid>&from=2025-01-01&to=2025-03-31&q=joao&sort=created_desc&page=1`).
15. WHEN o admin recarrega a página com query params válidos, THE Blacklist_List_Page SHALL aplicar os filtros e ordenação automaticamente.
16. IF um query param recebe valor inválido (ex: `?type=foo`, `?from=not-a-date`), THEN THE Blacklist_List_Page SHALL ignorar o param e usar o default correspondente.


### Requirement 3: Página `/admin/blacklist/:id` — Detalhe da Entrada

**User Story:** Como admin com `BLACKLIST_VIEW`, quero abrir o detalhe de uma entrada para inspecionar dados completos, criador, removedor, usuário-fonte e tentativas de uso bloqueadas.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/blacklist/:id` protegida por `AdminGuard`.
2. THE Blacklist_Detail_Page SHALL ser acessível apenas a admins com permissão `BLACKLIST_VIEW`.
3. WHEN o `:id` recebido na URL não é UUID válido, THE Blacklist_Detail_Page SHALL renderizar `Stealth_404` sem chamar o banco.
4. WHEN o `:id` não existe em `admin_blacklist`, THE Blacklist_Detail_Page SHALL renderizar `Stealth_404`.
5. THE Blacklist_Detail_Page SHALL chamar `Blacklist_Service.getBlacklistDetail(id, attemptsPage)` que retorna `Blacklist_Detail_Bundle`.
6. THE Blacklist_Detail_Page SHALL exibir bloco `Dados da Entrada` com: id completo, tipo, valor (renderizado conforme regra de Req 1.5; admins com `BLACKLIST_MANAGE` veem CPF/CNPJ integrais clicando em `Mostrar`), motivo integral, expiração (`Permanente` quando NULL, data formatada quando preenchida, com badge `Expirada em <data>` quando `expires_at <= NOW()`), status, criado por (nome do admin, link para `/admin/users/<criador.id>` se admin tem `USER_VIEW`), criado em.
7. THE Blacklist_Detail_Page SHALL exibir bloco `Removida` apenas quando `removed_at IS NOT NULL`, com: removido por (nome do admin, com link igual ao do criador), removido em, motivo de remoção (ou `Sem motivo informado` quando NULL).
8. THE Blacklist_Detail_Page SHALL exibir bloco `Usuário de origem` apenas quando `source_user_id IS NOT NULL`, com: nome do usuário, tipo (`motorista`/`embarcador`), status atual (`ativo`/`inativo`/`banido`) e link `Ver perfil` que navega para `/admin/users/<source_user_id>` quando o admin tem `USER_VIEW`.
9. THE Blacklist_Detail_Page SHALL exibir bloco `Tentativas Bloqueadas` listando registros de `admin_audit_logs WHERE action IN ('BLACKLIST_LOGIN_BLOCKED','BLACKLIST_SIGNUP_BLOCKED','BLACKLIST_EMAIL_BLOCKED') AND target_type = 'admin_blacklist' AND target_id = :id` ordenados por `created_at DESC`, paginado em 10 por página, com colunas: data/hora, ação (`Login bloqueado`/`Cadastro bloqueado`/`E-mail bloqueado`), IP de origem, user agent. Visível apenas se o admin tem `AUDIT_VIEW`.
10. THE Blacklist_Detail_Page SHALL exibir bloco `Histórico de Mudanças` listando registros de `admin_audit_logs WHERE action IN ('BLACKLIST_CREATED','BLACKLIST_UPDATED','BLACKLIST_REMOVED') AND target_type = 'admin_blacklist' AND target_id = :id` ordenados por `created_at DESC`, com data/hora, nome do admin, action e botão `Ver detalhes` que abre modal com `before_data` e `after_data` formatados como JSON. Visível apenas se o admin tem `AUDIT_VIEW`.
11. THE Blacklist_Detail_Page SHALL exibir botão `Editar` quando `removed_at IS NULL` e o admin tem permissão `BLACKLIST_MANAGE`.
12. THE Blacklist_Detail_Page SHALL exibir botão `Remover` quando `removed_at IS NULL` e o admin tem permissão `BLACKLIST_MANAGE`.
13. WHEN `getBlacklistDetail` falha em qualquer sub-query (tentativas, histórico, source_user), THE Blacklist_Detail_Page SHALL exibir o bloco correspondente em estado de erro mas continuar renderizando os outros blocos (degradação parcial, padrão herdado de `admin-users`).

### Requirement 4: Ação `Adicionar Entrada` (manual, single)

**User Story:** Como admin com `BLACKLIST_MANAGE`, quero adicionar uma única entrada manualmente, para bloquear um identificador específico.

#### Acceptance Criteria

1. THE Blacklist_List_Page SHALL exibir botão `Adicionar entrada` quando o admin tem permissão `BLACKLIST_MANAGE`.
2. WHEN o admin sem `BLACKLIST_MANAGE` visualiza a página, THE Blacklist_List_Page SHALL ocultar (não apenas desabilitar) o botão `Adicionar entrada`.
3. WHEN o admin clica em `Adicionar entrada`, THE Blacklist_List_Page SHALL abrir `Blacklist_Add_Modal`.
4. THE Blacklist_Add_Modal SHALL conter: dropdown `Tipo` (obrigatório, opções `Telefone`, `CPF`, `CNPJ`, `E-mail`, `IP`); campo `Valor` (obrigatório, com placeholder e máscara dependentes do tipo selecionado); textarea `Motivo` (obrigatório, 1..1000 chars com contador); date-picker `Expira em` (opcional, mínimo amanhã 00:00 UTC); textarea `Identificador de origem (UUID do usuário)` (opcional, 36 chars).
5. WHEN o admin altera `Tipo`, THE Blacklist_Add_Modal SHALL limpar o campo `Valor` e atualizar a máscara/placeholder.
6. WHEN o admin submete o formulário, THE Blacklist_Add_Modal SHALL aplicar `Blacklist_Normalizer` ao `Valor` antes de qualquer outra validação.
7. IF `Blacklist_Validator(type, normalized)` retorna `{ ok: false }`, THEN THE Blacklist_Add_Modal SHALL exibir erro de validação no campo `Valor` com mensagem específica (ex: `CPF deve ter 11 dígitos.`, `E-mail inválido.`) e NÃO disparar mutação.
8. IF `expires_at` é preenchido com data <= hoje, THEN THE Blacklist_Add_Modal SHALL exibir erro `Expiração deve ser uma data futura.` e NÃO disparar mutação.
9. IF `Motivo` está vazio ou só whitespace após `trim()`, THEN THE Blacklist_Add_Modal SHALL exibir erro `Motivo é obrigatório.` e NÃO disparar mutação.
10. WHEN o admin submete dados válidos, THE Blacklist_Service.addEntry SHALL chamar `executeAdminMutation` com `action = 'BLACKLIST_CREATED'`, `target_type = 'admin_blacklist'`, `target_id = <uuid gerado pela RPC>`, `before = null`, `after = { type, value, reason, expires_at, source_user_id }`, e em seguida invocar a RPC `admin_blacklist_add(p_type, p_value, p_reason, p_expires_at, p_source_user_id)`.
11. THE admin_blacklist_add RPC SHALL: (a) verificar `is_admin_with_permission('BLACKLIST_MANAGE')`, (b) aplicar `blacklist_normalize(p_type, p_value)`, (c) revalidar formato (mesmas regras do `Blacklist_Validator`), (d) checar se já existe entrada ativa com mesmo `(type, value)` e, se sim, falhar com `ALREADY_BLACKLISTED` retornando o `id` existente, (e) checar se o valor pertence ao Master_Admin (Req 21) e, se sim, falhar com `MASTER_PROTECTED`, (f) inserir a linha com `created_by = auth.uid()`.
12. IF a RPC retorna `ALREADY_BLACKLISTED` E existe uma entrada ativa, THEN THE Blacklist_Add_Modal SHALL exibir mensagem `Já existe entrada ativa para este identificador.` com link `Ver entrada existente` que navega para `/admin/blacklist/<existing_id>`.
13. IF a RPC retorna `ALREADY_BLACKLISTED` E a entrada existente está removida (`removed_at IS NOT NULL`), THEN THE Blacklist_Add_Modal SHALL exibir mensagem `Existe uma entrada anterior removida para este identificador. Deseja reativar?` com botão `Reativar` que dispara `admin_blacklist_update` para reverter `removed_at = NULL` e atualizar `reason`/`expires_at` aos valores submetidos.
14. WHEN a inserção é bem-sucedida, THE Blacklist_Add_Modal SHALL fechar, exibir toast `Entrada adicionada à blacklist.`, e a Blacklist_List_Page SHALL recarregar a página atual.

### Requirement 5: Ação `Editar Entrada`

**User Story:** Como admin com `BLACKLIST_MANAGE`, quero editar motivo e expiração de uma entrada ativa, para corrigir ou prorrogar/encurtar bloqueios.

#### Acceptance Criteria

1. THE Blacklist_Detail_Page SHALL exibir botão `Editar` quando `removed_at IS NULL` e o admin tem permissão `BLACKLIST_MANAGE`.
2. WHEN o admin clica em `Editar`, THE Blacklist_Detail_Page SHALL abrir `Blacklist_Edit_Modal`.
3. THE Blacklist_Edit_Modal SHALL conter campos editáveis: `Motivo` (textarea, obrigatório, 1..1000 chars); `Expira em` (date-picker, opcional, com botão `Limpar` para tornar permanente).
4. THE Blacklist_Edit_Modal SHALL exibir `Tipo` e `Valor` em campos readonly. Tipo e valor são imutáveis após criação; para mudar, o admin remove e adiciona nova entrada.
5. THE Blacklist_Edit_Modal SHALL pré-preencher os campos com valores atuais.
6. THE Blacklist_Edit_Modal SHALL aceitar `expires_at` no passado apenas se igual ao valor atual da entrada (admin pode salvar sem mexer na expiração já vencida); IF o admin tenta definir `expires_at` novo no passado/presente, THEN THE Blacklist_Edit_Modal SHALL exibir erro `Expiração deve ser uma data futura.`.
7. WHEN o admin submete dados válidos, THE Blacklist_Service.updateEntry SHALL chamar `executeAdminMutation` com `action = 'BLACKLIST_UPDATED'`, `before = { reason: <antigo>, expires_at: <antigo> }`, `after = { reason: <novo>, expires_at: <novo> }`, e em seguida invocar `admin_blacklist_update(p_id, p_reason, p_expires_at, p_expected_updated_at)`.
8. THE Blacklist_Service.updateEntry SHALL aceitar parâmetro `expectedUpdatedAt: string` representando o `admin_blacklist.updated_at` que o admin viu ao abrir o modal.
9. WHEN a RPC `admin_blacklist_update` detecta `updated_at` divergente, THE Blacklist_Service SHALL falhar com `STALE_VERSION` e gravar audit log `BLACKLIST_UPDATE_STALE_VERSION`.
10. THE Blacklist_Edit_Modal SHALL exibir, em caso de `STALE_VERSION`, opção `Recarregar` que fecha o modal e recarrega o `Blacklist_Detail_Bundle`.
11. WHEN a RPC retorna `ALREADY_REMOVED` (entrada foi removida entre abrir o modal e salvar), THE Blacklist_Edit_Modal SHALL exibir mensagem `Esta entrada foi removida. Recarregue a página.` e desabilitar o botão de salvar.
12. WHEN o `UPDATE` é bem-sucedido, THE Blacklist_Detail_Page SHALL atualizar a UI sem reload completo e exibir toast `Entrada atualizada.`.

### Requirement 6: Ação `Remover Entrada` (soft delete, single)

**User Story:** Como admin com `BLACKLIST_MANAGE`, quero remover uma entrada da blacklist, para destrancar um identificador sem perder o histórico.

#### Acceptance Criteria

1. THE Blacklist_Detail_Page SHALL exibir botão `Remover` quando `removed_at IS NULL` e o admin tem permissão `BLACKLIST_MANAGE`.
2. THE Blacklist_List_Page SHALL exibir botão `Remover` em cada linha (`removed_at IS NULL`) quando o admin tem permissão `BLACKLIST_MANAGE`.
3. WHEN o admin clica em `Remover`, THE Blacklist_Detail_Page (ou List_Page) SHALL abrir `Blacklist_Remove_Modal`.
4. THE Blacklist_Remove_Modal SHALL conter: textarea `Motivo da remoção` (opcional, 0..1000 chars); checkbox de confirmação `Estou ciente de que o identificador volta a poder se cadastrar/logar.`.
5. THE Blacklist_Remove_Modal SHALL desabilitar o botão `Confirmar` enquanto o checkbox de confirmação estiver desmarcado.
6. WHEN o admin confirma, THE Blacklist_Service.removeEntry SHALL chamar `executeAdminMutation` com `action = 'BLACKLIST_REMOVED'`, `before = { removed_at: null }`, `after = { removed_at: <NOW>, removed_reason: <texto ou null> }`, e em seguida invocar `admin_blacklist_remove(p_id, p_remove_reason)`.
7. WHEN a entrada já está removida no momento da chamada (`removed_at IS NOT NULL`), THE Blacklist_Service.removeEntry SHALL gravar audit log `BLACKLIST_REMOVED_SKIPPED` com `before = { removed_at: <já existente> }` e `after = { reason: 'ALREADY_REMOVED' }`, NÃO executar `UPDATE`, e retornar `{ skipped: true, reason: 'ALREADY_REMOVED' }` sem lançar erro.
8. THE remoção SHALL ser soft delete: `UPDATE admin_blacklist SET removed_at = NOW(), removed_by = auth.uid(), removed_reason = <texto>, updated_at = NOW() WHERE id = p_id`. NÃO ocorre `DELETE` físico.
9. WHEN bem-sucedida, THE Blacklist_Detail_Page SHALL atualizar a UI exibindo o bloco `Removida` (Req 3.7) e ocultando os botões `Editar`/`Remover`. THE Blacklist_List_Page SHALL atualizar a linha sem reload completo.

### Requirement 7: Bulk Remove (em massa, até 200)

**User Story:** Como admin com `BLACKLIST_MANAGE`, quero selecionar múltiplas entradas e remover em uma operação, para destrancar identificadores em lote.

#### Acceptance Criteria

1. THE Blacklist_List_Page SHALL exibir checkbox em cada linha `(removed_at IS NULL)` quando o admin tem permissão `BLACKLIST_MANAGE`.
2. THE Blacklist_List_Page SHALL exibir checkbox no header da tabela para `Selecionar todos da página atual` (apenas linhas elegíveis).
3. THE Blacklist_List_Page SHALL exibir barra de bulk actions no topo quando há pelo menos 1 entrada selecionada, com botão `Remover selecionados` e contador `[N] selecionados`.
4. WHEN o admin clica em `Remover selecionados`, THE Blacklist_List_Page SHALL exibir modal de confirmação com texto `Remover [N] entradas da blacklist?` e textarea `Motivo da remoção (aplicado a todas)` opcional.
5. WHEN o admin confirma, THE Blacklist_Service.bulkRemove SHALL iterar pelas entradas selecionadas e chamar `executeAdminMutation` por entrada (1 audit log por target), com `action = 'BLACKLIST_REMOVED'`.
6. THE Blacklist_Service SHALL processar em paralelo com `Promise.allSettled` e concorrência máxima de 5 requisições simultâneas.
7. THE Blacklist_List_Page SHALL exibir progresso `[K] de [N] processados` durante a execução.
8. WHEN uma entrada no lote já está removida, THE Blacklist_Service SHALL pular essa entrada, registrar audit log `BLACKLIST_REMOVED_SKIPPED` com motivo `ALREADY_REMOVED`, e continuar com as outras.
9. WHEN a operação termina, THE Blacklist_List_Page SHALL exibir resumo: `[K] sucesso, [F] falhas, [S] pulados.` e oferecer link `Ver detalhes` que abre modal listando os pulados/falhos.
10. THE Blacklist_List_Page SHALL desmarcar todos os checkboxes ao final da operação.
11. THE Bulk_Blacklist_Remove SHALL ter limite máximo de 200 entradas por operação. IF o admin seleciona mais de 200, THEN THE Blacklist_List_Page SHALL desabilitar o botão `Remover selecionados` e exibir aviso `Máximo de 200 por operação.`.

### Requirement 8: Bulk Import via CSV (até 1000 linhas)

**User Story:** Como admin com `BLACKLIST_BULK`, quero importar uma planilha CSV com até 1000 entradas, para popular a blacklist em massa.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/blacklist/bulk` protegida por `AdminGuard`.
2. THE Blacklist_Bulk_Import_Page SHALL ser acessível apenas a admins com permissão `BLACKLIST_BULK`.
3. WHEN um admin sem `BLACKLIST_BULK` acessa `/admin/blacklist/bulk`, THE AdminGuard SHALL renderizar `Stealth_404`.
4. THE Blacklist_Bulk_Import_Page SHALL exibir input `<input type="file" accept=".csv,text/csv">` e botão `Baixar modelo CSV` que gera arquivo com `Blacklist_Import_Header` e 1 linha de exemplo por tipo.
5. THE Blacklist_Bulk_Import_Page SHALL aceitar arquivos CSV de no máximo 2 MB. IF o arquivo excede o limite, THEN THE Blacklist_Bulk_Import_Page SHALL exibir erro `Arquivo excede o limite de 2 MB.` e NÃO processar.
6. THE Blacklist_Bulk_Import_Page SHALL parsear o CSV usando RFC 4180 (separador `;`, aspas duplas para escape, quebra de linha CRLF ou LF, BOM UTF-8 opcional removido).
7. IF o cabeçalho não for exatamente `type;value;reason;expires_at` (ignorando ordem reversível? não — ordem fixa), THEN THE Blacklist_Bulk_Import_Page SHALL exibir erro `Cabeçalho inválido. Esperado: type;value;reason;expires_at.` e NÃO processar.
8. IF o arquivo (excluindo cabeçalho) tem mais de 1000 linhas, THEN THE Blacklist_Bulk_Import_Page SHALL exibir erro `Máximo de 1000 linhas por importação.` e NÃO processar.
9. THE Blacklist_Bulk_Import_Page SHALL exibir pré-visualização de até 50 linhas com 3 colunas adicionais: `Tipo`, `Valor normalizado`, `Validação` (`OK` em verde ou `ERRO: <detalhe>` em vermelho).
10. THE Blacklist_Bulk_Import_Page SHALL exibir contadores `[N] linhas`, `[V] válidas`, `[I] inválidas` antes da execução.
11. WHEN o admin clica em `Importar`, THE Blacklist_Service.bulkImport SHALL chamar `executeAdminMutation` UMA vez com `action = 'BLACKLIST_BULK_IMPORT'`, `target_type = 'admin_blacklist'`, `target_id = null`, `before = null`, `after = { total: N, valid: V, invalid: I }` ANTES de iniciar as inserções (audit log de cabeçalho da operação).
12. THE Blacklist_Service.bulkImport SHALL iterar pelas linhas válidas e chamar `admin_blacklist_add` por linha (1 audit log `BLACKLIST_CREATED` por sucesso, `BLACKLIST_BULK_IMPORT_SKIPPED` por linha pulada/falha, com `target_id` apontando para a linha inserida ou null).
13. THE Blacklist_Service.bulkImport SHALL processar em paralelo com `Promise.allSettled` e concorrência máxima de 5 requisições simultâneas.
14. THE Blacklist_Bulk_Import_Page SHALL exibir progresso `[K] de [V] processados` durante a execução.
15. WHEN uma linha falha por `ALREADY_BLACKLISTED`, THE Blacklist_Service SHALL registrar audit log `BLACKLIST_BULK_IMPORT_SKIPPED` com `after = { reason: 'ALREADY_BLACKLISTED', existing_id: <uuid> }` e contar como `skipped`.
16. WHEN a operação termina, THE Blacklist_Bulk_Import_Page SHALL exibir relatório final: `[K] inseridos, [S] pulados, [F] falhas.` com tabela detalhada de cada linha (linha original + resultado) e botão `Baixar relatório CSV`.
17. THE Blacklist_Bulk_Import_Page SHALL gerar relatório CSV com cabeçalho `linha;type;value;reason;expires_at;resultado;detalhe` (separador `;`, BOM UTF-8) ao clicar em `Baixar relatório CSV`.

### Requirement 9: Auto-Blacklist no Fluxo de Ban (admin-users)

**User Story:** Como admin com `BLACKLIST_MANAGE` que está banindo um usuário, quero opcionalmente adicionar os identificadores do usuário banido à blacklist na mesma operação, para impedir recadastro com os mesmos dados.

#### Acceptance Criteria

1. THE Ban_User_Form (componente de `admin-users`) SHALL exibir checkbox `Adicionar identificadores à blacklist` quando o admin tem permissão `BLACKLIST_MANAGE`.
2. WHEN o admin sem `BLACKLIST_MANAGE` abre o form de ban, THE Ban_User_Form SHALL ocultar o checkbox.
3. WHEN o checkbox está marcado, THE Ban_User_Form SHALL exibir lista expandida abaixo dele com checkboxes individuais por tipo: `Telefone (<valor mascarado>)`, `CPF (<valor mascarado>)` (apenas se motorista e cpf não-nulo), `CNPJ (<valor mascarado>)` (apenas se embarcador e cnpj não-nulo), `E-mail (<valor>)`. Todos pré-marcados.
4. THE Ban_User_Form SHALL exibir mensagem informativa abaixo da lista: `Os identificadores selecionados serão adicionados à blacklist com o motivo do ban.`.
5. WHEN o admin confirma o ban com `Adicionar identificadores à blacklist` marcado, THE Users_Service.banUser SHALL, após o `UPDATE users` de ban bem-sucedido, iterar pelos identificadores selecionados e chamar `Blacklist_Service.addEntry(type, value, reason = users.ban_reason, expires_at = null, source_user_id = userId)` para cada um, em paralelo com concorrência 5.
6. WHEN qualquer inserção de blacklist falha por `ALREADY_BLACKLISTED`, THE Users_Service SHALL pular essa inserção, registrar audit log `BLACKLIST_CREATED_SKIPPED` com `after = { reason: 'ALREADY_BLACKLISTED' }`, e continuar com as outras.
7. WHEN o ban é bem-sucedido E pelo menos uma inserção de blacklist foi tentada, THE User_Detail_Page SHALL exibir toast `Usuário banido. [K] identificadores adicionados à blacklist, [S] pulados.`.
8. IF o ban falha, THEN THE Users_Service SHALL NÃO tentar nenhuma inserção de blacklist e exibir toast com erro do ban.
9. THE auto-blacklist insertion SHALL gerar audit logs `BLACKLIST_CREATED` separados (1 por entrada inserida) com `target_id = <uuid da entrada>` e `before = null`, `after = { type, value, reason, source_user_id, triggered_by_ban: true }`. O audit log de ban (`USER_BANNED`) e os de blacklist (`BLACKLIST_CREATED`) ficam encadeados via `created_at` próximos no tempo.

### Requirement 10: Auto-Unblacklist no Fluxo de Unban (admin-users)

**User Story:** Como admin com `BLACKLIST_MANAGE` que está desbanindo um usuário, quero opcionalmente remover da blacklist os identificadores que foram adicionados quando o usuário foi banido, para liberar recadastro.

#### Acceptance Criteria

1. THE Unban_User_Form (componente de `admin-users`) SHALL exibir checkbox `Remover entradas de blacklist vinculadas a este usuário` quando o admin tem permissão `BLACKLIST_MANAGE` E existe pelo menos 1 entrada com `source_user_id = userId AND removed_at IS NULL`.
2. THE Unban_User_Form SHALL exibir contador `[N] entradas ativas vinculadas` ao lado do checkbox.
3. WHEN o admin sem `BLACKLIST_MANAGE` abre o form de unban, THE Unban_User_Form SHALL ocultar o checkbox.
4. THE checkbox SHALL vir desmarcado por padrão (admin precisa decidir explicitamente).
5. WHEN o admin confirma o unban com checkbox marcado, THE Users_Service.unbanUser SHALL, após o `UPDATE users` de unban bem-sucedido, invocar `admin_blacklist_remove_by_user(p_user_id)` que aplica soft delete em todas as entradas ativas vinculadas e retorna `{ removed_count: N }`.
6. THE admin_blacklist_remove_by_user RPC SHALL gerar 1 audit log `BLACKLIST_REMOVED` por entrada removida, com `before = { removed_at: null }`, `after = { removed_at: NOW(), removed_reason: 'auto-removed by unban', triggered_by_unban: true }`.
7. WHEN o unban é bem-sucedido E o checkbox foi marcado, THE User_Detail_Page SHALL exibir toast `Usuário desbanido. [N] entradas de blacklist removidas.`.
8. IF o unban falha, THEN THE Users_Service SHALL NÃO chamar `admin_blacklist_remove_by_user`.

### Requirement 11: Hook de Bloqueio em Login

**User Story:** Como usuário não autenticado tentando logar com um telefone na blacklist, devo receber a mesma mensagem genérica de credencial inválida, para que não haja como descobrir que estou banido.

#### Acceptance Criteria

1. THE LoginForm.tsx SHALL, ANTES de chamar `supabase.auth.signInWithPassword`, invocar a RPC `is_blacklisted('phone', <phoneInput após Blacklist_Normalizer client-side>)`.
2. WHEN `is_blacklisted` retorna `true`, THE LoginForm SHALL exibir mensagem `Não foi possível autenticar.` (idêntica à mensagem de credencial inválida).
3. WHEN `is_blacklisted` retorna `true`, THE LoginForm SHALL chamar a RPC `log_blacklist_block(p_action 'BLACKLIST_LOGIN_BLOCKED', p_type 'phone', p_value <normalized>, p_ip <client_ip se disponível>, p_user_agent <navigator.userAgent>)` que registra audit log com `target_type = 'admin_blacklist'`, `target_id = <id da entrada que matchou>`, e `admin_id = NULL`.
4. WHEN `is_blacklisted` retorna `true`, THE LoginForm SHALL NÃO chamar `supabase.auth.signInWithPassword`.
5. IF a chamada `is_blacklisted` falha por erro de rede ou timeout (>3000ms), THEN THE LoginForm SHALL prosseguir com `signInWithPassword` (fail-open para não derrubar login durante outage), MAS o `Login_Block` server-side via trigger não cobre login (só signup); a defesa em profundidade aqui é apenas client-side. Esta limitação SHALL ser documentada no design.
6. THE LoginForm SHALL aplicar mesmo timing artificial em ambos os caminhos (blocked/unblocked) — adicionar delay aleatório de 300..600ms antes de exibir o erro — para evitar timing attack que distinga "telefone na blacklist" de "credencial inválida".
7. THE log_blacklist_block RPC SHALL ser `SECURITY DEFINER`, executável por `anon` e `authenticated`, com rate limit implícito (mesmo IP só pode chamar 30x/min — implementação via tabela `auth_attempt_throttle` ou similar; decisão final no design).

### Requirement 12: Hook de Bloqueio em Cadastro

**User Story:** Como usuário não autenticado tentando me cadastrar com identificador na blacklist, devo receber mensagem genérica de erro de cadastro, para que não haja como descobrir qual campo está bloqueado.

#### Acceptance Criteria

1. THE RegisterForm.tsx SHALL, APÓS validação local dos campos e ANTES de chamar `supabase.auth.signUp`, invocar a RPC `is_blacklisted` para cada identificador preenchido: `phone` (sempre), `cpf` (motorista), `cnpj` (embarcador), `email` (sempre que preenchido).
2. THE RegisterForm SHALL fazer as 2..4 chamadas em paralelo (`Promise.all`) com timeout total de 3000ms.
3. WHEN qualquer `is_blacklisted` retorna `true`, THE RegisterForm SHALL exibir mensagem `Não foi possível concluir o cadastro.` (sem indicar qual campo) e NÃO chamar `signUp`.
4. WHEN qualquer `is_blacklisted` retorna `true`, THE RegisterForm SHALL chamar `log_blacklist_block(p_action 'BLACKLIST_SIGNUP_BLOCKED', p_type <tipo que matchou>, p_value <normalized>, ...)` para CADA tipo que matchou (1 audit log por match).
5. IF múltiplos tipos matchem, THEN THE RegisterForm SHALL gerar 1 audit log por tipo, mas exibir UMA única mensagem genérica ao usuário.
6. IF a chamada `is_blacklisted` falha por erro de rede ou timeout, THEN THE RegisterForm SHALL prosseguir com `signUp` (fail-open client-side), confiando na defesa em profundidade do server-side trigger (Req 13).
7. THE RegisterForm SHALL aplicar delay artificial 300..600ms igual ao do login (Req 11.6) para evitar timing attack.

### Requirement 13: Defesa em Profundidade — Trigger BEFORE INSERT em `users`

**User Story:** Como engenheiro de segurança, quero que mesmo se o cliente bypassar a checagem de blacklist (via service-role, scripts ou janela de corrida), o INSERT em `users` falhe quando o telefone, CPF, CNPJ ou e-mail está na blacklist ativa.

#### Acceptance Criteria

1. THE Migration_034 SHALL criar trigger `users_blacklist_block` `BEFORE INSERT ON users` que:
   - Calcula `phone_normalized = blacklist_normalize('phone', NEW.phone)`.
   - IF `is_blacklisted('phone', phone_normalized)` THEN raise exception `blacklisted_phone`.
   - IF `NEW.cpf IS NOT NULL` AND `is_blacklisted('cpf', blacklist_normalize('cpf', NEW.cpf))` THEN raise `blacklisted_cpf`.
   - IF `NEW.email IS NOT NULL` AND `is_blacklisted('email', blacklist_normalize('email', NEW.email))` THEN raise `blacklisted_email`.
2. THE Migration_034 SHALL criar trigger `embarcadores_blacklist_block` `BEFORE INSERT ON embarcadores` que verifica `is_blacklisted('cnpj', blacklist_normalize('cnpj', NEW.cnpj))` e raise `blacklisted_cnpj` se positivo.
3. THE triggers SHALL gerar audit log `BLACKLIST_SIGNUP_BLOCKED` com `target_type = 'admin_blacklist'`, `target_id = <id da entrada>`, `admin_id = NULL`, `before = null`, `after = { type, value_normalized, source: 'trigger' }` ANTES de levantar a exceção.
4. THE triggers SHALL ser bypass-eligíveis para `auth.role() = 'service_role'` apenas se a sessão atual tem `current_setting('app.skip_blacklist_check', true) = 'true'`. Esta variável de sessão SHALL ser setada apenas em scripts de migração documentados (recovery flows do `admin-foundation`); o painel admin nunca a seta.
5. THE Migration_034 SHALL adicionar bloco `-- VERIFY` comentado com testes manuais para validar cada trigger.

### Requirement 14: Hook de Bloqueio em Verificação de E-mail

**User Story:** Como usuário tentando verificar um e-mail na blacklist, devo receber mensagem genérica antes de o sistema enviar o código, para que não haja como confirmar bloqueio via inbox.

#### Acceptance Criteria

1. THE ModalVerificacaoEmail.tsx SHALL, ANTES de chamar a função que envia o código de verificação, invocar a RPC `is_blacklisted('email', <emailInput após Blacklist_Normalizer>)`.
2. WHEN `is_blacklisted` retorna `true`, THE ModalVerificacaoEmail SHALL exibir mensagem `Não foi possível enviar o código.` e NÃO chamar o envio.
3. WHEN bloqueado, THE ModalVerificacaoEmail SHALL chamar `log_blacklist_block(p_action 'BLACKLIST_EMAIL_BLOCKED', p_type 'email', p_value <normalized>, ...)`.
4. IF a chamada `is_blacklisted` falha por erro de rede ou timeout (>3000ms), THEN THE ModalVerificacaoEmail SHALL prosseguir com o envio (fail-open).

### Requirement 15: Validações de Formato (`Blacklist_Validator`)

**User Story:** Como admin, quero que valores fora de padrão sejam rejeitados na adição, para evitar entradas que nunca casariam com nada.

#### Acceptance Criteria

1. THE Blacklist_Validator SHALL aceitar `phone` quando `normalized` tem exatamente 10 ou 11 dígitos numéricos. ELSE retornar `{ ok: false, reason: 'INVALID_INPUT', detail: 'Telefone deve ter 10 ou 11 dígitos.' }`.
2. THE Blacklist_Validator SHALL aceitar `cpf` quando `normalized` tem exatamente 11 dígitos numéricos AND passa em validação de dígitos verificadores (módulo 11) AND não é uma sequência repetida (`00000000000`..`99999999999`). ELSE retornar `{ ok: false, reason: 'INVALID_INPUT', detail: 'CPF inválido.' }`.
3. THE Blacklist_Validator SHALL aceitar `cnpj` quando `normalized` tem exatamente 14 dígitos numéricos AND passa em validação de dígitos verificadores (módulo 11) AND não é uma sequência repetida. ELSE retornar `{ ok: false, reason: 'INVALID_INPUT', detail: 'CNPJ inválido.' }`.
4. THE Blacklist_Validator SHALL aceitar `email` quando `normalized` casa com regex `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$` AND tem comprimento <= 320 chars. ELSE retornar `{ ok: false, reason: 'INVALID_INPUT', detail: 'E-mail inválido.' }`.
5. THE Blacklist_Validator SHALL aceitar `ip_address` quando `normalized` casa com IPv4 (`^(\d{1,3}\.){3}\d{1,3}$` com cada octeto entre 0..255) OR IPv6 (formato hex padrão `^[0-9a-fA-F:]+$` com 2..7 grupos separados por `:`). ELSE retornar `{ ok: false, reason: 'INVALID_INPUT', detail: 'IP inválido.' }`.
6. THE Blacklist_Validator SHALL ser exposto em TS (`src/services/admin/blacklist.ts`) E em SQL (função `blacklist_validate(p_type text, p_value text) RETURNS text` que retorna `'OK'` ou mensagem de erro). As duas implementações SHALL produzir o mesmo resultado para o mesmo input (validado por property test em Req 23).
7. THE admin_blacklist_add RPC SHALL chamar `blacklist_validate` server-side ANTES da checagem de duplicata, para falhar rápido com `INVALID_INPUT`.

### Requirement 16: Schema da Tabela `admin_blacklist`

**User Story:** Como engenheiro, quero schema bem definido com constraints corretas, para garantir consistência dos dados.

#### Acceptance Criteria

1. THE Migration_034 SHALL criar tabela `admin_blacklist` com colunas:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `type TEXT NOT NULL` com `CHECK (type IN ('phone','cpf','cnpj','email','ip_address'))`
   - `value TEXT NOT NULL` (sempre normalizado pelo `blacklist_normalize`)
   - `reason TEXT NOT NULL` com `CHECK (char_length(trim(reason)) BETWEEN 1 AND 1000)`
   - `expires_at TIMESTAMPTZ NULL`
   - `source_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`
   - `created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `removed_at TIMESTAMPTZ NULL`
   - `removed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`
   - `removed_reason TEXT NULL` com `CHECK (removed_reason IS NULL OR char_length(removed_reason) <= 1000)`
2. THE Migration_034 SHALL criar índice UNIQUE PARCIAL `idx_admin_blacklist_active_unique ON admin_blacklist (type, value) WHERE removed_at IS NULL`.
3. THE Migration_034 SHALL criar índices secundários:
   - `idx_admin_blacklist_type ON admin_blacklist(type)`
   - `idx_admin_blacklist_created_at ON admin_blacklist(created_at DESC)`
   - `idx_admin_blacklist_created_by ON admin_blacklist(created_by)`
   - `idx_admin_blacklist_expires_at ON admin_blacklist(expires_at) WHERE expires_at IS NOT NULL AND removed_at IS NULL`
   - `idx_admin_blacklist_source_user_id ON admin_blacklist(source_user_id) WHERE source_user_id IS NOT NULL AND removed_at IS NULL`
4. THE Migration_034 SHALL adicionar constraint `chk_admin_blacklist_remove_consistency`: `(removed_at IS NULL AND removed_by IS NULL AND removed_reason IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)`.
5. THE Migration_034 SHALL adicionar trigger `BEFORE UPDATE ON admin_blacklist` que atualiza `updated_at = NOW()`.
6. THE Migration_034 SHALL ser idempotente: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`. A migration pode ser rodada 2x no mesmo banco sem erro.
7. THE Migration_034 SHALL ser envelopada em `BEGIN; ... COMMIT;`.
8. THE Migration_034 SHALL conter bloco final `-- VERIFY` comentado com 5..10 queries de validação (existência da tabela, contagens, índices, policies, RPCs).
9. THE migration `034_admin_blacklist_rollback.sql` SHALL: `DROP TRIGGER` triggers de bloqueio, `DROP FUNCTION` `is_blacklisted`/`blacklist_normalize`/`blacklist_validate`/`admin_blacklist_*`, `DROP POLICY` policies, `DROP TABLE admin_blacklist CASCADE`, e reverter `is_admin_with_permission` para o estado pré-034 (sem `BLACKLIST_MANAGE`/`BLACKLIST_BULK`).

### Requirement 17: Permissões `BLACKLIST_VIEW`, `BLACKLIST_MANAGE`, `BLACKLIST_BULK`

**User Story:** Como engenheiro de RBAC, quero que as 3 permissões de blacklist sejam atribuídas corretamente aos papéis existentes.

#### Acceptance Criteria

1. THE Permission_Matrix em `src/services/admin/permissions.ts` SHALL adicionar `BLACKLIST_MANAGE` e `BLACKLIST_BULK` ao enum `ADMIN_ACTIONS`.
2. THE Permission_Matrix SHALL marcar `BLACKLIST_EDIT` como `@deprecated` em comentário JSDoc, mantendo a string no enum por compatibilidade durante a transição (rollout sem breaking change). Esta string SHALL ser removida em uma migração futura quando todo código consumidor estiver migrado para `BLACKLIST_MANAGE`.
3. THE `SUPER_ADMIN` SHALL ter as 3 permissões (`BLACKLIST_VIEW`, `BLACKLIST_MANAGE`, `BLACKLIST_BULK`).
4. THE `ADMIN` SHALL ter as 3 permissões.
5. THE `MODERADOR` SHALL ter `BLACKLIST_VIEW` e `BLACKLIST_MANAGE`, MAS NÃO `BLACKLIST_BULK` (bulk import é restrito por risco de poluição em massa).
6. THE `SUPORTE` SHALL ter `BLACKLIST_VIEW` apenas (consulta para responder a usuários, mas não alterar).
7. THE `FINANCEIRO` SHALL NÃO ter nenhuma permissão de blacklist.
8. THE `is_admin_with_permission` SQL SHALL ser atualizado em `Migration_034` via `CREATE OR REPLACE FUNCTION` para refletir a Permission_Matrix acima. THE função SQL e a TS Permission_Matrix SHALL produzir o mesmo resultado para qualquer `(role, action)` (validado por property test em Req 23).

### Requirement 18: RLS em `admin_blacklist`

**User Story:** Como engenheiro de segurança, quero que o banco bloqueie qualquer acesso a `admin_blacklist` que não venha de admin com permissão correta.

#### Acceptance Criteria

1. THE Migration_034 SHALL habilitar RLS em `admin_blacklist`: `ALTER TABLE admin_blacklist ENABLE ROW LEVEL SECURITY`.
2. THE Migration_034 SHALL criar policy `admin_blacklist_select` permitindo SELECT quando `is_admin_with_permission('BLACKLIST_VIEW')`.
3. THE Migration_034 SHALL criar policy `admin_blacklist_insert` permitindo INSERT quando `is_admin_with_permission('BLACKLIST_MANAGE')`.
4. THE Migration_034 SHALL criar policy `admin_blacklist_update` permitindo UPDATE quando `is_admin_with_permission('BLACKLIST_MANAGE')`.
5. THE Migration_034 SHALL criar policy `admin_blacklist_delete` com `USING (false)` (DELETE físico nunca é permitido via cliente; apenas soft delete via UPDATE).
6. THE função `is_blacklisted` SHALL ser `SECURITY DEFINER` com `GRANT EXECUTE TO anon, authenticated`. Necessário para signup pré-login (anônimo) e login (já authenticated mas durante a transição).
7. THE função `blacklist_normalize` SHALL ser `IMMUTABLE` `SECURITY INVOKER` com `GRANT EXECUTE TO anon, authenticated`.
8. THE função `blacklist_validate` SHALL ser `IMMUTABLE` `SECURITY INVOKER` com `GRANT EXECUTE TO authenticated`.
9. THE função `log_blacklist_block` SHALL ser `SECURITY DEFINER` com `GRANT EXECUTE TO anon, authenticated`. Internamente faz `INSERT INTO admin_audit_logs` bypassing RLS.
10. THE RPCs `admin_blacklist_add`, `admin_blacklist_update`, `admin_blacklist_remove`, `admin_blacklist_remove_by_user` SHALL ser `SECURITY DEFINER` com `GRANT EXECUTE TO authenticated`. Cada uma valida permissão internamente via `is_admin_with_permission`.

### Requirement 19: Export CSV de Lista Filtrada

**User Story:** Como admin com `BLACKLIST_VIEW`, quero exportar a lista filtrada para CSV, para análise externa em planilha.

#### Acceptance Criteria

1. THE Blacklist_List_Page SHALL exibir botão `Exportar CSV` quando o admin tem permissão `BLACKLIST_VIEW`.
2. WHEN o admin clica em `Exportar CSV`, THE Blacklist_Service SHALL chamar `exportCSV(filters)` que aplica os mesmos filtros, busca e ordenação da listagem visível.
3. THE Blacklist_Export_Format SHALL ter cabeçalho fixo (separador `;`): `id;type;value;reason;status;created_by_name;created_at;expires_at;removed_by_name;removed_at;source_user_id`.
4. THE Blacklist_Export_Format SHALL escapar campos contendo `;`, `"`, ou newline com aspas duplas e duplicação de aspas internas (RFC 4180).
5. THE Blacklist_Export_Format SHALL prefixar o conteúdo com BOM UTF-8 (`\uFEFF`) para abertura correta no Excel pt-BR.
6. THE Blacklist_Export_Format SHALL formatar `created_at` e `expires_at` como ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`).
7. THE Blacklist_Export_Format SHALL exibir `value` integral (sem mascaramento) — o admin já passou pelo `BLACKLIST_VIEW` e o CSV é destinado a análise interna.
8. THE Blacklist_Export_Format SHALL conter no máximo 10000 linhas. IF o filtro retorna mais de 10000, THEN THE Blacklist_Service SHALL exportar apenas as primeiras 10000 (ordenadas por `Blacklist_Sort` atual) e a UI SHALL exibir aviso `Export limitado a 10000 linhas. Refine os filtros para exportar todos.`.
9. THE Blacklist_Service.exportCSV SHALL gerar 1 audit log `BLACKLIST_EXPORTED` com `after = { row_count: <N>, filters: <objeto serializado> }`.

### Requirement 20: Audit Logs

**User Story:** Como auditor, quero que toda mutação e todo bloqueio gere audit log com action code distinto, para rastrear histórico completo.

#### Acceptance Criteria

1. THE módulo SHALL produzir os seguintes action codes em `admin_audit_logs`:
   - `BLACKLIST_CREATED` — entrada criada (manual ou auto-blacklist).
   - `BLACKLIST_CREATED_SKIPPED` — tentativa pulada (já existia, etc).
   - `BLACKLIST_UPDATED` — entrada editada (motivo/expiração).
   - `BLACKLIST_UPDATE_STALE_VERSION` — tentativa de edição com `updated_at` divergente.
   - `BLACKLIST_REMOVED` — soft delete.
   - `BLACKLIST_REMOVED_SKIPPED` — tentativa de remoção pulada (já estava removida).
   - `BLACKLIST_BULK_IMPORT` — cabeçalho da operação de bulk import (1 por operação).
   - `BLACKLIST_BULK_IMPORT_SKIPPED` — linha pulada/falha dentro do bulk import.
   - `BLACKLIST_EXPORTED` — export CSV.
   - `BLACKLIST_LOGIN_BLOCKED` — login bloqueado por blacklist.
   - `BLACKLIST_SIGNUP_BLOCKED` — cadastro bloqueado por blacklist (client-side ou trigger).
   - `BLACKLIST_EMAIL_BLOCKED` — verificação de e-mail bloqueada.
2. THE audit logs de mutação SHALL ter `target_type = 'admin_blacklist'` e `target_id = <uuid da entrada>` (exceto `BLACKLIST_BULK_IMPORT` cabeçalho que tem `target_id = NULL`).
3. THE audit logs de bloqueio SHALL ter `target_type = 'admin_blacklist'`, `target_id = <uuid da entrada que matchou>`, `admin_id = NULL` (não há admin no fluxo, é o usuário comum/anônimo).
4. THE audit logs de bloqueio SHALL incluir em `after_data` o `type` e `value` (mascarado para CPF/CNPJ exibindo `***.***.***-XX`; phone/email/ip integrais para investigação) e `ip` + `user_agent` quando disponíveis.
5. WHEN qualquer mutação falha após o audit log inicial, THE executeAdminMutation SHALL gravar audit log de rollback com sufixo `_ROLLBACK` (padrão herdado de `admin-foundation`).

### Requirement 21: Imutabilidade do Master_Admin

**User Story:** Como engenheiro de plataforma, quero que identificadores do Master_Admin (Bruno Henrique) NUNCA possam ser inseridos na blacklist, para evitar bloqueio acidental ou malicioso da conta master.

#### Acceptance Criteria

1. THE admin_blacklist_add RPC SHALL, antes de inserir, consultar `users WHERE admin_username = 'Nexus_Vortex99'` e obter `phone`, `cpf`, `email`. Se o `(p_type, p_value normalizado)` casar com qualquer um desses, THEN raise exception `MASTER_PROTECTED`.
2. THE admin_blacklist_add RPC SHALL aplicar a mesma checagem para `cnpj` consultando `embarcadores WHERE user_id = <master_id>` quando `p_type = 'cnpj'`.
3. THE Blacklist_Add_Modal SHALL exibir mensagem `Identificador pertence a conta protegida.` ao receber `MASTER_PROTECTED` e gerar audit log `BLACKLIST_CREATED_SKIPPED` com `after = { reason: 'MASTER_PROTECTED' }`.
4. THE admin_blacklist_add RPC SHALL aplicar a checagem mesmo quando o caller é o próprio Master_Admin (defesa por construção).

### Requirement 22: Limpeza de Entradas Expiradas (informativo, não automático)

**User Story:** Como admin, quero ver entradas expiradas separadamente das ativas e poder removê-las em lote, sem precisar de cron.

#### Acceptance Criteria

1. THE Blacklist_List_Page SHALL exibir entradas com `expires_at <= NOW() AND removed_at IS NULL` sob status `Expirado` (Req 1.5).
2. THE Blacklist_Active predicado SHALL excluir entradas expiradas, ou seja: o ponto de bloqueio (login/signup/email) trata expiradas como inativas — o usuário NÃO é bloqueado por uma entrada expirada.
3. THE Migration_034 SHALL NÃO criar cron, scheduled function nem `pg_cron` para limpeza automática. A limpeza fica a cargo do admin via Bulk Remove no filtro `Status = Expirados`.
4. THE Blacklist_List_Page SHALL exibir contador `[N] entradas expiradas` no topo quando `Blacklist_Status_Filter = 'todos'` ou `'expirado'`, com link `Filtrar` que aplica `?status=expirado`.

### Requirement 23: Property Tests Obrigatórios

**User Story:** Como engenheiro, quero property tests cobrindo as invariantes críticas de bloqueio e idempotência, para evitar regressão em refactors.

#### Acceptance Criteria

1. THE módulo SHALL incluir property test `CP-1: phone na blacklist ativa SEMPRE bloqueia login/signup` em `src/services/admin/__tests__/blacklist.cp1.test.ts` usando fast-check, com a invariante:
   - **FOR ALL** `phoneRaw: arbitrary.string` que normaliza para 10 ou 11 dígitos válidos, **FOR ALL** `reason: arbitrary.string` válido, **GIVEN** entrada ativa `(type='phone', value=blacklist_normalize('phone', phoneRaw), reason)`:
     - `is_blacklisted('phone', phoneRaw_em_qualquer_formatacao)` retorna `true`.
     - LoginForm com `phoneInput = phoneRaw_em_qualquer_formatacao` exibe `Generic_Login_Message` e NÃO chama `signInWithPassword` (verificado via mock).
     - RegisterForm com `phoneInput = phoneRaw_em_qualquer_formatacao` exibe `Generic_Signup_Message` e NÃO chama `signUp`.
   - O teste SHALL gerar 100+ casos com fast-check, incluindo variações de formatação (`(64) 99999-9999`, `64999999999`, `+5564999999999`, `64 9 9999-9999`).
2. THE módulo SHALL incluir property test `CP-2: adicionar entrada duplicada ativa é idempotente` em `src/services/admin/__tests__/blacklist.cp2.test.ts` usando fast-check, com a invariante:
   - **FOR ALL** `(type, valueRaw, reason1, reason2)` válidos, **GIVEN** entrada ativa já existe para `(type, blacklist_normalize(type, valueRaw))`:
     - Segunda chamada `admin_blacklist_add(type, valueRaw_em_qualquer_formatacao, reason2, ...)` retorna `ALREADY_BLACKLISTED` SEM lançar erro genérico não-tratado.
     - O número de linhas em `admin_blacklist WHERE type = type AND value = normalized AND removed_at IS NULL` permanece exatamente 1.
     - O `reason` da entrada NÃO é sobrescrito por `reason2` (operação é no-op silenciosa).
     - A segunda chamada gera audit log `BLACKLIST_CREATED_SKIPPED` (não `BLACKLIST_CREATED`).
3. THE módulo SHALL incluir property test `CP-3: round-trip blacklist_normalize` em `src/services/admin/__tests__/blacklist.cp3.test.ts`:
   - **FOR ALL** `type, raw` válidos: `blacklist_normalize(type, blacklist_normalize(type, raw)) === blacklist_normalize(type, raw)` (idempotência da normalização).
4. THE módulo SHALL incluir property test `CP-4: Permission_Matrix TS == is_admin_with_permission SQL` em `src/services/admin/__tests__/blacklist.cp4.test.ts`:
   - **FOR ALL** `role IN AdminRole`, **FOR ALL** `action IN AdminAction`: `hasPermission(role, action)` no TS retorna o mesmo booleano que `is_admin_with_permission` no SQL retorna (executado em banco de teste com role-mockada).
5. THE property tests SHALL rodar com `vitest --run` em CI sem flag de watch.
6. THE property tests CP-1 e CP-2 SHALL ser obrigatórios no PR de implementação. Falha desses 2 testes SHALL bloquear merge.

### Requirement 24: Mensagens, i18n e Anti-Enumeration

**User Story:** Como engenheiro de segurança, quero que toda mensagem user-facing em ponto de bloqueio seja genérica e idêntica à mensagem normal de erro, para impedir enumeration via UI ou logs do navegador.

#### Acceptance Criteria

1. THE Generic_Login_Message SHALL ser exatamente `Não foi possível autenticar.` e SHALL ser usada tanto para senha errada quanto para telefone na blacklist quanto para qualquer outro erro de auth.
2. THE Generic_Signup_Message SHALL ser exatamente `Não foi possível concluir o cadastro.` e SHALL ser usada tanto para identificador na blacklist quanto para telefone/email já cadastrado quanto para falha genérica.
3. THE Generic_Email_Message SHALL ser exatamente `Não foi possível enviar o código.` e SHALL ser usada tanto para email na blacklist quanto para falha de provider.
4. THE LoginForm, RegisterForm e ModalVerificacaoEmail SHALL NÃO logar no console nem no Sentry/observability detalhes que distingam blacklist de outros erros (ex: NÃO usar `console.error('blocked by blacklist')`). O log da causa específica fica APENAS em `admin_audit_logs` (acessível só por admin com `AUDIT_VIEW`).
5. THE LoginForm e RegisterForm SHALL aplicar timing artificial 300..600ms aleatório em todos os caminhos de erro (Req 11.6, Req 12.7), para impedir distinção via tempo de resposta.
6. THE network responses (status code, headers) SHALL ser idênticos entre blacklist e outros erros — a chamada `is_blacklisted` retorna 200 sempre; o redirect/error vem do client lógico.
7. THE Blacklist_Service mensagens admin-facing (toasts, modals dentro do painel) SHALL ser explícitas: `Entrada adicionada à blacklist.`, `Já existe entrada ativa para este identificador.`, `Identificador pertence a conta protegida.`, etc. O painel admin é confiado.

### Requirement 25: Padrões Operacionais Herdados

**User Story:** Como engenheiro, quero que esta spec siga sem exceção os padrões consolidados em `admin-foundation`, `admin-users` e `admin-fretes`.

#### Acceptance Criteria

1. THE toda mutação SHALL ser executada via `executeAdminMutation` (audit-by-construction, padrão de `admin-foundation`).
2. THE toda edição SHALL usar versionamento otimista via `expected_updated_at` comparado com `updated_at` (padrão de `admin-users`).
3. THE toda operação em massa SHALL processar em paralelo com `Promise.allSettled` e concorrência máxima 5 (padrão de `admin-users` e `admin-fretes`).
4. THE limite de bulk para REMOVE SHALL ser 200; o limite de bulk para IMPORT SHALL ser 1000 (mais alto por ser a operação primária do `BLACKLIST_BULK`).
5. THE CSV de export e o relatório do bulk import SHALL usar BOM UTF-8 + separador `;` + RFC 4180 (padrão de `admin-users`).
6. THE Stealth_404 SHALL ser renderizado quando o admin não tem permissão para a rota (padrão de `admin-foundation`).
7. THE migrations SHALL ser idempotentes, envelopadas em `BEGIN`/`COMMIT`, com bloco `-- VERIFY` comentado, e ter rollback separado em arquivo `_rollback.sql` (padrão de migrations 030..033).
8. THE operações idempotentes (segunda chamada de remoção, inserção duplicada) SHALL retornar resultado estruturado `{ skipped: true, reason: <code> }` com audit log `*_SKIPPED`, sem lançar erro (padrão de `admin-fretes`).

## Edge Cases (não-funcionais, mas obrigatórios)

Os comportamentos a seguir SHALL ser cobertos por testes ou documentação explícita:

1. **Adicionar entrada com telefone em formato variado** (`(64) 99999-9999`, `64999999999`, `+5564999999999`, `64 9 9999-9999`): todos os formatos normalizam para o mesmo `Blacklist_Value_Normalized` (11 dígitos, sem prefixo `55`); o índice único parcial `idx_admin_blacklist_active_unique` impede duplicata. Coberto por **CP-1** e **CP-3**.
2. **Adicionar entrada duplicada ativa**: idempotente — `admin_blacklist_add` retorna `ALREADY_BLACKLISTED` com `id` da entrada existente, gera audit log `BLACKLIST_CREATED_SKIPPED`, NÃO sobrescreve `reason` (Req 4.11..4.12). Coberto por **CP-2**.
3. **Adicionar entrada cuja remoção foi soft-deleted antes**: a UI oferece reativação (Req 4.13); reativação reseta `removed_at = NULL`, atualiza `reason`/`expires_at` aos novos valores, mantém `created_by`/`created_at` originais e gera audit log `BLACKLIST_UPDATED` com `before = { removed_at: <ts>, ... }`.
4. **Adicionar entrada com `expires_at` no passado**: bloqueado em UI e em `admin_blacklist_add` com `INVALID_INPUT` (Req 4.8).
5. **Adicionar identificador do Master_Admin**: bloqueado com `MASTER_PROTECTED` em todos os tipos (`phone`, `cpf`, `email`, `cnpj`), inclusive quando o caller é o próprio Master (Req 21).
6. **Editar entrada que outro admin já alterou**: detectado via `expected_updated_at`, retorna `STALE_VERSION` com botão `Recarregar` no modal (Req 5.9..5.10).
7. **Editar entrada que outro admin já removeu**: `admin_blacklist_update` retorna `ALREADY_REMOVED`, modal exibe `Esta entrada foi removida. Recarregue a página.` (Req 5.11).
8. **Remover entrada já removida**: idempotente, gera `BLACKLIST_REMOVED_SKIPPED` com `reason: ALREADY_REMOVED`, NÃO toca o banco (Req 6.7).
9. **Bulk remove com mistura de ativas e já removidas**: cada entrada avaliada individualmente; já removidas viram skip; resumo `[K] sucesso, [F] falhas, [S] pulados` ao final (Req 7.8..7.9).
10. **Bulk import com cabeçalho errado**: rejeitado antes do parse com `Cabeçalho inválido. Esperado: type;value;reason;expires_at.` (Req 8.7), nenhuma linha é processada, nenhum audit log de mutação é gerado.
11. **Bulk import com mais de 1000 linhas**: rejeitado com `Máximo de 1000 linhas por importação.` (Req 8.8) antes da execução.
12. **Bulk import com linha duplicando entrada ativa**: linha é `skipped` com `BLACKLIST_BULK_IMPORT_SKIPPED` (`reason: ALREADY_BLACKLISTED`); demais linhas continuam (Req 8.15).
13. **Bulk import com linha de tipo inválido (ex: `device`)**: linha é `failed` com `INVALID_INPUT` na pré-visualização (Req 8.9); admin pode optar por importar só as válidas.
14. **Auto-blacklist no ban com checkbox marcado mas usuário sem CPF/CNPJ/email**: apenas os identificadores existentes são inseridos; campos NULL são pulados silenciosamente sem audit log de skip (não há tentativa, então não há registro).
15. **Auto-blacklist no ban quando o telefone do usuário já está na blacklist (cenário de re-ban)**: a inserção daquele tipo retorna `ALREADY_BLACKLISTED`, gera `BLACKLIST_CREATED_SKIPPED`, demais tipos prosseguem (Req 9.6).
16. **Auto-unblacklist no unban quando não há entradas vinculadas**: o checkbox aparece desabilitado com contador `0 entradas ativas vinculadas`; clicar não tem efeito além de no-op silencioso na RPC (Req 10.1..10.2).
17. **Login de telefone não-blacklisted com `is_blacklisted` retornando timeout**: fail-open client-side, login prossegue normalmente; defesa server-side em login NÃO existe (não há trigger em sessões), risco aceito e documentado (Req 11.5).
18. **Signup com `is_blacklisted` retornando timeout**: fail-open client-side, mas o trigger `BEFORE INSERT ON users` rejeita o `signUp` server-side com `blacklisted_*` se o identificador estiver na blacklist (Req 12.6 + Req 13). Defesa em profundidade.
19. **Signup com `service_role` setando `app.skip_blacklist_check = 'true'`**: trigger é bypassado (Req 13.4); este caminho existe APENAS em scripts de recovery documentados; o painel admin nunca seta a variável.
20. **Verificação de e-mail blacklisted em fluxo de recuperação de senha**: o hook `Email_Verification_Block` cobre o envio do código de verificação (Req 14); recovery via SMS via `phone` blacklisted é coberto pelo trigger em `users` (que aplica em INSERT, não em UPDATE de `auth.users`), portanto recovery de senha de usuário existente NÃO é bloqueado por blacklist — comportamento intencional, blacklist atua sobre tentativa de criar conta nova ou logar em conta existente.
21. **Tentativa de bloqueio com timing attack**: delay artificial 300..600ms aleatório aplicado em todos os caminhos de erro (Req 11.6, 12.7, 24.5); responses HTTP são idênticas em status/headers entre blacklist e outros erros (Req 24.6).
22. **Export CSV com filtros que retornam 0 resultados**: download do CSV vazio (apenas cabeçalho), audit log `BLACKLIST_EXPORTED` gerado normalmente com `row_count = 0`.
23. **Acesso a `/admin/blacklist/:id` com `:id` UUID válido mas inexistente**: Stealth_404, audit log `ADMIN_STEALTH_BLOCK` registrado (Req 3.4 + padrão herdado de `admin-foundation`).
24. **Acesso a `/admin/blacklist/:id` com `:id` não-UUID**: Stealth_404 sem chamar o banco (Req 3.3).
25. **Concorrência: dois admins removendo a mesma entrada ao mesmo tempo**: o segundo cai em skip (`ALREADY_REMOVED`) sem erro, não há override silencioso nem duplicação de audit log (Req 6.7).
26. **Concorrência: criar entrada e auto-blacklist do ban inserindo o mesmo `(type, value)` simultaneamente**: o índice único parcial garante que apenas uma INSERT vence; a outra cai em `ALREADY_BLACKLISTED` (skip), sem corrupção de dados.
27. **Filtro de período com `from` ou `to` em data inválida**: query param ignorado e default aplicado (Req 2.16); validação `from > to` ocorre em UI antes da busca (Req 2.7).
28. **Entrada expirada (`expires_at <= NOW()`) tentando bloquear login/signup**: NÃO bloqueia — `Blacklist_Active` exclui expiradas (Req 22.2); admin precisa renovar `expires_at` ou aceitar o desbloqueio implícito.
29. **Tentativa de DELETE físico via cliente Supabase**: bloqueado pela policy `admin_blacklist_delete USING (false)` (Req 18.5); cliente vê 0 linhas afetadas.
30. **RLS bloqueia INSERT silenciosamente para admin sem `BLACKLIST_MANAGE`**: cliente recebe erro da RPC `admin_blacklist_add` que validou permissão e retornou `permission_denied`; UI traduz para toast `Você não tem permissão para esta ação.`.
31. **Inserir IPv6 com letras maiúsculas e minúsculas mistas**: `Blacklist_Normalizer` para `ip_address` faz apenas `trim()` (preserva case do hex); validação aceita ambos. Comparação no `is_blacklisted` é case-sensitive — duas entradas com `2001:DB8::1` e `2001:db8::1` seriam distintas. Comportamento aceito; admins SHALL inserir consistentemente em lowercase (não enforced em SQL para evitar perda de info em IPs). Documentado como caveat no design.

## Correctness Properties (Property-Based Tests)

Estas propriedades DEVEM ser testáveis com fast-check (já em uso). Funções alvo são puras ou facilmente isoláveis com mocks de banco. **CP-1 e CP-2 são obrigatórias**; demais (CP-3, CP-4) são adicionais já especificadas em Req 23.

### CP-1: Telefone na Blacklist Ativa Sempre Bloqueia (Property — OBRIGATÓRIA)

**Propriedade:** Para todo `phoneRaw` que normaliza via `blacklist_normalize('phone', _)` para 10 ou 11 dígitos válidos, e toda entrada ativa `(type='phone', value=normalized, reason)`:
- `is_blacklisted('phone', phoneRaw em qualquer formatação)` retorna `true`.
- `LoginForm.submit({ phone: phoneRaw })` exibe `Generic_Login_Message`, NÃO chama `signInWithPassword` (mock), e gera 1 audit log `BLACKLIST_LOGIN_BLOCKED`.
- `RegisterForm.submit({ phone: phoneRaw, ... })` exibe `Generic_Signup_Message`, NÃO chama `signUp` (mock), e gera 1 audit log `BLACKLIST_SIGNUP_BLOCKED`.

**Tipo:** Property (Invariante de bloqueio).
**Geradores:** `phoneRaw` em formatos `(64) 99999-9999`, `64999999999`, `+5564999999999`, `64 9 9999-9999`, `055 64 99999-9999`; `reason` string 1..1000.

### CP-2: Adicionar Entrada Duplicada Ativa é Idempotente (Property — OBRIGATÓRIA)

**Propriedade:** Para todo `(type, valueRaw, reason1, reason2)` válidos, dado que entrada ativa já existe para `(type, blacklist_normalize(type, valueRaw))`:
- Segunda chamada `admin_blacklist_add(type, valueRaw em qualquer formatação, reason2, ...)` retorna `ALREADY_BLACKLISTED` com `existing_id` da entrada original, sem lançar erro genérico.
- A contagem `SELECT COUNT(*) FROM admin_blacklist WHERE type = type AND value = normalized AND removed_at IS NULL` permanece exatamente 1.
- O `reason` da entrada NÃO é sobrescrito por `reason2`.
- A segunda chamada gera audit log `BLACKLIST_CREATED_SKIPPED` (não `BLACKLIST_CREATED`).

**Tipo:** Property (Idempotência).
**Geradores:** `type ∈ {'phone','cpf','cnpj','email','ip_address'}`, `valueRaw` válido para o tipo (gerador específico por tipo), `reason1, reason2: string 1..1000`.

### CP-3: blacklist_normalize é Idempotente (Property — adicional, ver Req 23.3)

**Propriedade:** Para todo `(type, raw)` válidos: `blacklist_normalize(type, blacklist_normalize(type, raw)) === blacklist_normalize(type, raw)`. Aplicar a normalização duas vezes produz o mesmo resultado de aplicar uma vez.

**Tipo:** Round-Trip (Idempotência da normalização).
**Geradores:** `type ∈ enum`, `raw` arbitrário (incluindo strings com whitespace, máscaras, prefixos `+55`, mistura de case em emails/IPs).

### CP-4: Permission_Matrix TS == is_admin_with_permission SQL (Property — adicional, ver Req 23.4)

**Propriedade:** Para todo `(role, action)` em `AdminRole × AdminAction`, `hasPermission(role, action)` no TS retorna o mesmo booleano que `is_admin_with_permission(action)` retorna no SQL quando o `auth.uid()` corrente tem exatamente `role` ativo em `admin_roles`.

**Tipo:** Property (Concordância TS ↔ SQL).
**Geradores:** exaustivo.

## Padrões de Sucesso

A spec é considerada bem implementada quando:

1. Todos os 25 requisitos têm testes correspondentes (unitários, integração ou E2E).
2. Pelo menos 2 das 4 correctness properties (CP-1..CP-4) passam em PBT com ≥100 iterações via `vitest --run`; **CP-1 (telefone na blacklist sempre bloqueia) e CP-2 (adicionar duplicata é idempotente)** são obrigatórias e bloqueiam merge se falharem.
3. Migration `034_admin_blacklist.sql` aplica limpa em banco com migrations 001..033; rollback `034_admin_blacklist_rollback.sql` reverte sem deixar resíduo (tabela, funções, policies, triggers, alterações em `is_admin_with_permission`).
4. Build TypeScript (`npm run build` ou equivalente) limpa, sem warnings de tipo nem erros de lint.
5. Todos os textos de UI no painel admin estão em pt-BR; chaves técnicas (`BLACKLIST_HIT`, `BLACKLIST_PHONE`, `BLACKLIST_CREATED`, etc.) em inglês.
6. Tentativa de adicionar entrada para identificador do Master_Admin falha com `MASTER_PROTECTED` tanto no service quanto na RPC SQL, em todos os tipos suportados (`phone`, `cpf`, `cnpj`, `email`).
7. Tentativa de mutar `admin_blacklist` sem `BLACKLIST_MANAGE` falha tanto no service (`Permission_Matrix`) quanto no banco (RLS + checagem interna da RPC). Defesa em camadas verificável.
8. Toda mutação em `Blacklist_Service` tem audit log correspondente em `admin_audit_logs` (ou par log + log_ROLLBACK em falha pós-log, ou log_SKIPPED em idempotência), conforme tabela de action codes em Req 20.1.
9. Stealth_404 é renderizado para acessos a `/admin/blacklist/*` por admins sem permissão e para `:id` inexistente ou inválido.
10. Hook de bloqueio em login, signup e verificação de e-mail exibe somente mensagens genéricas (`Generic_Login_Message`, `Generic_Signup_Message`, `Generic_Email_Message`); inspeção do DevTools, network tab e console NÃO revela que a causa do erro foi blacklist (Req 24).
11. Trigger `BEFORE INSERT ON users` e `BEFORE INSERT ON embarcadores` rejeitam INSERT com identificador blacklisted, mesmo se o cliente bypassar a checagem `is_blacklisted` no front (validável via teste de integração com Supabase service-role sem `app.skip_blacklist_check`).
12. Auto-blacklist no fluxo de ban e auto-unblacklist no fluxo de unban funcionam fim-a-fim, com checkboxes opt-in, audit logs encadeados e toast informativo no `User_Detail_Page` (`admin-users`).
13. Bulk import aceita até 1000 linhas, exibe pré-visualização com validação por linha, gera audit log de cabeçalho + audit log por linha processada, e oferece download de relatório CSV ao final.
14. Export CSV usa BOM UTF-8 + separador `;` + RFC 4180, abre corretamente no Excel pt-BR, e gera audit log `BLACKLIST_EXPORTED` com filtros e contagem.
15. Ordem de rotas em `AdminLayoutRoute` preserva `blacklist` (lista) → `blacklist/bulk` (import) → `blacklist/:id` (detalhe), nesta ordem para evitar conflito de matching com `:id`.
