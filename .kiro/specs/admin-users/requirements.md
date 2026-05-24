# Requirements Document: admin-users

## Introduction

Esta spec entrega o **módulo de Gestão de Usuários** do painel administrativo do FreteGO. Sobre a fundação já entregue em `admin-foundation` (RBAC, MFA, audit-by-construction, sessão isolada, Stealth 404, RPC `is_admin_with_permission`), este módulo adiciona:

1. Tela de listagem paginada de motoristas e embarcadores em `/admin/users` com filtros, busca e ordenação.
2. Tela de detalhes consolidada por usuário em `/admin/users/:id`, agregando dados cadastrais, documentos, localização, histórico de fretes, avaliações e metadados de chat.
3. Conjunto de ações administrativas (ativar/desativar, editar, excluir, reset de senha, force-logout) gated por permissões da `Permission_Matrix` e auditadas via `executeAdminMutation`.
4. Aba `/admin/users/admins` para gestão dos próprios admins (grant/revoke de papéis), restrita a `SUPER_ADMIN`.
5. Bulk actions (ativar/desativar em massa) com 1 audit log por usuário afetado e export CSV da lista filtrada gerando audit log `USERS_EXPORT`.
6. Reforço de RLS via novas policies em `users`, `motoristas`, `embarcadores`, `documents`, `notifications`, `chat_messages` baseadas em `is_admin_with_permission`.
7. Imutabilidade do **Master_Admin** Bruno Henrique (`admin_username = 'Nexus_Vortex99'`) garantida tanto na UI quanto via trigger SQL: nem desativação, nem revogação de `SUPER_ADMIN`, nem exclusão.

A stack continua TypeScript + React + Vite + TailwindCSS + Supabase + Vitest + fast-check. Esta spec adiciona a migration `031_admin_users.sql`, novos componentes em `src/components/admin/users/`, novas páginas em `src/pages/admin/users/`, e o serviço `src/services/admin/users.ts`.

**Fora de escopo desta spec** (vão para outras specs já planejadas):

- `admin-blacklist`: banir IPs, CPFs, dispositivos.
- `admin-suporte`: tickets de atendimento, leitura de conteúdo de chat.
- `admin-dashboard`: cards de métricas e gráficos.
- `admin-crm`: campanhas, segmentação, comunicação ativa.
- Qualquer fluxo de pagamento, frete ou financeiro.

## Glossary

- **Admin_Panel**: Painel administrativo já entregue em `admin-foundation`, acessível em `/admin/*`.
- **Admin_Session**: Sessão admin isolada em `localStorage` sob `fretego_admin_session`, fornecida pelo `AdminProvider`.
- **AdminGuard**: Componente que envolve rotas `/admin/*` e cai em `Stealth_404` se sessão admin inválida.
- **Stealth_404**: Página 404 visualmente idêntica à 404 padrão do app, renderizada para acessos não autorizados a `/admin/*`.
- **Permission_Matrix**: Matriz determinística `(AdminRole, AdminAction) → boolean` em `src/services/admin/permissions.ts`.
- **executeAdminMutation**: Helper em `src/services/admin/audit.ts` que executa uma mutação admin sempre acompanhada de audit log, com rollback-log em caso de falha.
- **is_admin_with_permission**: Função SQL `STABLE SECURITY DEFINER` em Postgres que reproduz a `Permission_Matrix` no banco para reforço de RLS.
- **Users_Service**: Novo serviço em `src/services/admin/users.ts` que centraliza as operações da spec.
- **Users_List_Page**: Página `/admin/users` com listagem paginada, filtros e ações em massa.
- **User_Detail_Page**: Página `/admin/users/:id` com dados consolidados de um usuário.
- **Admins_List_Page**: Página `/admin/users/admins` com listagem de Super_Admins ativos e ações de grant/revoke.
- **Admin_User**: Usuário com `users.is_superuser = true` E pelo menos 1 papel ativo em `admin_roles`.
- **Master_Admin**: O Super_Admin com `users.admin_username = 'Nexus_Vortex99'` (Bruno Henrique). Sua linha em `users` e seus papéis em `admin_roles` são imutáveis em todos os fluxos do painel.
- **Last_Super_Admin**: O único registro ativo em `admin_roles` com `role = 'SUPER_ADMIN' AND revoked_at IS NULL` quando não há outros. Ao restar 1, a revogação dele é bloqueada.
- **Target_User**: Usuário comum (motorista ou embarcador) sendo administrado pela tela.
- **User_Type_Filter**: Filtro de tipo de usuário com valores `motorista`, `embarcador` ou `todos`.
- **User_Status_Filter**: Filtro de status com valores `ativo`, `inativo`, `banido` ou `todos`. `banido` é derivado: `is_active = false AND ban_reason IS NOT NULL` (coluna nova `ban_reason` opcional, ver Req 18).
- **User_Search**: Busca livre que casa contra `users.name`, `users.phone`, `users.email`, `users.cpf`, `embarcadores.company_name` (case-insensitive, `ILIKE` com prefixo e sufixo).
- **User_Sort**: Ordenação por `created_at DESC` (padrão), `created_at ASC`, `last_activity_at DESC` ou `last_activity_at ASC`.
- **Users_Export_Format**: CSV com cabeçalho fixo (ver Req 14) e até 10000 linhas por export.
- **Bulk_Action**: Operação `USER_TOGGLE_ACTIVE` aplicada a um conjunto de usuários selecionados, gerando 1 audit log por usuário afetado.
- **Migration_031**: Arquivo `supabase/migrations/031_admin_users.sql`, dependente de migrations `001..030`.
- **User_Detail_Bundle**: Estrutura agregada retornada por `Users_Service.getUserDetail(id)` contendo: dados cadastrais, documentos, localização, fretes (publicados + clicados), avaliações, contagem de mensagens de chat (sem conteúdo).
- **Chat_Metadata**: Para cada conversa do usuário, retorna: `conversation_id`, `total_messages`, `last_message_at`, `last_admin_reply_at`. Conteúdo das mensagens **não** é exposto em `User_Detail_Page` (fica para `admin-suporte` com permissão `SUPORTE_REPLY`).
- **Force_Logout**: Operação que invalida todas as sessões Supabase Auth do usuário (token revoke), forçando relogin.
- **Reset_Password_Token**: Token de uso único gerado por `Users_Service.requestPasswordReset(userId)` e enviado via email/SMS pelo provider Supabase.

## Requirements

### Requirement 1: Página `/admin/users` — Listagem Paginada

**User Story:** Como Super_Admin, quero uma listagem paginada de motoristas e embarcadores com filtros e busca, para encontrar usuários rapidamente.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/users` protegida por `AdminGuard`.
2. THE Users_List_Page SHALL ser acessível apenas a admins com permissão `USER_VIEW`.
3. WHEN um admin sem `USER_VIEW` acessa `/admin/users`, THE AdminGuard SHALL renderizar `Stealth_404`.
4. THE Users_List_Page SHALL listar registros de `users WHERE user_type IN ('motorista','embarcador')` com paginação de 25 por página.
5. THE Users_List_Page SHALL exibir, em cada linha: foto (`profile_photo_url`), nome, tipo (`motorista`/`embarcador`), telefone formatado, email, status (`ativo`/`inativo`/`banido`), data de cadastro, última atividade.
6. THE Users_List_Page SHALL exibir contador `Total: N usuários (filtrados)` no topo.
7. THE Users_List_Page SHALL paginar via parâmetros `?page=N&pageSize=25` na URL para permitir compartilhamento de filtro.
8. WHEN a paginação resulta em página vazia (ex: filtro sem matches), THE Users_List_Page SHALL exibir estado vazio com mensagem `Nenhum usuário encontrado com os filtros atuais.`.
9. THE Users_List_Page SHALL renderizar skeleton loading enquanto carrega a página.
10. IF a query falha por erro de rede, THEN THE Users_List_Page SHALL exibir estado de erro com botão `Tentar novamente`.

### Requirement 2: Filtros, Busca e Ordenação

**User Story:** Como Super_Admin, quero filtrar por tipo, status, buscar texto livre e ordenar a lista, para refinar resultados.

#### Acceptance Criteria

1. THE Users_List_Page SHALL oferecer `User_Type_Filter` como dropdown com opções `Todos`, `Motorista`, `Embarcador`.
2. THE Users_List_Page SHALL oferecer `User_Status_Filter` como dropdown com opções `Todos`, `Ativo`, `Inativo`, `Banido`.
3. THE Users_List_Page SHALL oferecer campo `User_Search` que aceita texto e dispara busca após 300ms de debounce.
4. WHEN `User_Search` é aplicado, THE Users_Service SHALL casar o termo (case-insensitive) contra `users.name`, `users.phone`, `users.email`, `users.cpf`, e `embarcadores.company_name` usando `ILIKE '%termo%'`.
5. WHEN `User_Search` recebe string com apenas dígitos e tamanho >= 8, THE Users_Service SHALL casar também contra a versão normalizada de `users.phone` e `users.cpf` (sem máscaras).
6. THE Users_List_Page SHALL oferecer `User_Sort` como dropdown com `Mais recentes`, `Mais antigos`, `Última atividade (recente)`, `Última atividade (antiga)`.
7. THE User_Sort padrão SHALL ser `created_at DESC`.
8. WHEN qualquer filtro ou ordenação muda, THE Users_List_Page SHALL resetar `page = 1`.
9. THE Users_List_Page SHALL preservar todos os filtros e ordenação como query params na URL (`?type=motorista&status=ativo&q=joao&sort=created_desc&page=1`).
10. WHEN o admin recarrega a página com query params válidos, THE Users_List_Page SHALL aplicar os filtros e ordenação automaticamente.
11. IF um query param recebe valor inválido (ex: `?status=foo`), THEN THE Users_List_Page SHALL ignorar o param e usar o default correspondente.

### Requirement 3: Página `/admin/users/:id` — Detalhe do Usuário

**User Story:** Como Super_Admin, quero abrir o detalhe de um usuário, para inspecionar tudo que ele fez na plataforma.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/users/:id` protegida por `AdminGuard`.
2. THE User_Detail_Page SHALL ser acessível apenas a admins com permissão `USER_VIEW`.
3. WHEN o `:id` recebido na URL não existe em `users` ou tem `user_type = 'admin'`, THE User_Detail_Page SHALL renderizar `Stealth_404`.
4. THE User_Detail_Page SHALL chamar `Users_Service.getUserDetail(id)` que retorna `User_Detail_Bundle`.
5. THE User_Detail_Page SHALL exibir bloco `Dados cadastrais` com: foto, nome, tipo, telefone, email, CPF (motorista) ou CNPJ (embarcador via `embarcadores.company_name` + campo CNPJ), data de cadastro, última atividade, status.
6. THE User_Detail_Page SHALL exibir bloco `Documentos` listando os registros de `documents` do usuário com nome do arquivo, tipo, data de upload e link `Ver` que abre URL assinada do storage por 10min.
7. WHEN o usuário é motorista, THE User_Detail_Page SHALL exibir documentos: CNH, ANTT, comprovante de veículo (`vehicle_documents` em JSONB), foto de perfil.
8. WHEN o usuário é embarcador, THE User_Detail_Page SHALL exibir documentos: CNPJ (se houver), logo da empresa.
9. THE User_Detail_Page SHALL exibir bloco `Localização` com `latitude`, `longitude` e mini-mapa estático (reuso de `InteractiveMap` em modo readonly) quando `location` está preenchido. IF location é null, THEN THE User_Detail_Page SHALL exibir `Localização não informada`.
10. THE User_Detail_Page SHALL exibir bloco `Fretes` com:
    - Para embarcador: lista de fretes em `fretes WHERE embarcador_id = :id` paginada (10 por página), com `origin`, `destination`, `status`, `created_at`.
    - Para motorista: lista de cliques em `frete_clicks WHERE motorista_id = :id` join `fretes`, paginada (10 por página), com `frete_id`, `origin`, `destination`, `clicked_at`.
11. THE User_Detail_Page SHALL exibir bloco `Avaliações` listando `avaliacoes` recebidas pelo usuário (motorista → como avaliado por embarcadores; embarcador → como avaliado por motoristas) com `rating`, `comment`, `created_at`.
12. THE User_Detail_Page SHALL exibir bloco `Mensagens` com `Chat_Metadata` agregada (uma linha por conversa): `total_messages`, `last_message_at`, `last_admin_reply_at`.
13. THE User_Detail_Page SHALL NÃO exibir o conteúdo de mensagens de chat. WHERE o admin tem `SUPORTE_REPLY` ativo, THE User_Detail_Page SHALL exibir botão `Abrir conversa` que linka para `admin-suporte` (rota será criada em outra spec; por ora, link disabled com tooltip `Disponível na spec admin-suporte`).
14. WHEN `getUserDetail` falha em qualquer sub-query, THE User_Detail_Page SHALL exibir o bloco correspondente em estado de erro mas continuar renderizando os outros blocos (degradação parcial).

### Requirement 4: Ação `Ativar / Desativar Conta`

**User Story:** Como Super_Admin, quero ativar ou desativar uma conta de usuário, para suspender acesso sem excluir o registro.

#### Acceptance Criteria

1. THE User_Detail_Page SHALL exibir botão `Desativar conta` quando `users.is_active = true` e o admin tem permissão `USER_TOGGLE_ACTIVE`.
2. THE User_Detail_Page SHALL exibir botão `Ativar conta` quando `users.is_active = false` e o admin tem permissão `USER_TOGGLE_ACTIVE`.
3. WHEN o admin sem `USER_TOGGLE_ACTIVE` visualiza o detalhe, THE User_Detail_Page SHALL ocultar (não apenas desabilitar) os botões de ativar/desativar.
4. WHEN o admin clica em `Desativar conta`, THE User_Detail_Page SHALL exibir modal de confirmação com texto `Deseja desativar a conta de [nome]? O usuário perderá acesso imediato.`.
5. WHEN o admin confirma a desativação, THE Users_Service SHALL chamar `executeAdminMutation` com `action = 'USER_TOGGLE_ACTIVE'`, `target_type = 'users'`, `target_id = userId`, `before = {is_active: true}`, `after = {is_active: false}`, e em seguida `UPDATE users SET is_active = false WHERE id = userId`.
6. WHEN o `UPDATE` é bem-sucedido, THE User_Detail_Page SHALL atualizar a UI imediatamente sem reload completo.
7. IF a tentativa é desativar o `Master_Admin`, THEN THE Users_Service SHALL falhar com erro `MASTER_ADMIN_IMMUTABLE` antes mesmo de chamar o banco, e a UI SHALL exibir toast `Master_Admin é imutável.`.
8. IF a tentativa é desativar o próprio admin logado (`userId === adminSession.userId`), THEN THE Users_Service SHALL falhar com `SELF_ACTION_FORBIDDEN` e a UI SHALL exibir toast `Não é permitido desativar a própria conta.`.
9. THE ação `Ativar conta` SHALL seguir fluxo simétrico, com `before = {is_active: false}`, `after = {is_active: true}`, sem necessidade de modal de confirmação (apenas toast de sucesso).
10. FOR ALL execuções de toggle, THE executeAdminMutation SHALL garantir que o audit log seja gravado ANTES da mutação no banco; IF a mutação falha após o log, THEN THE Users_Service SHALL gravar audit log adicional `USER_TOGGLE_ACTIVE_ROLLBACK`.

### Requirement 5: Ação `Editar Dados Básicos`

**User Story:** Como Super_Admin, quero editar nome, email, telefone e CPF/CNPJ de um usuário, para corrigir dados cadastrais.

#### Acceptance Criteria

1. THE User_Detail_Page SHALL exibir botão `Editar` que abre modal de edição quando o admin tem permissão `USER_EDIT`.
2. THE Edit_User_Modal SHALL conter campos: `name` (obrigatório, 3..255 chars), `email` (opcional, formato RFC 5322), `phone` (obrigatório, formato `^\+?\d{10,15}$` após normalização), `cpf` (motorista, opcional, 11 dígitos com validação módulo 11), `cnpj` (embarcador, opcional, 14 dígitos com validação módulo 11), `company_name` (embarcador, obrigatório se `user_type = 'embarcador'`).
3. THE Edit_User_Modal SHALL pré-preencher os campos com valores atuais do `User_Detail_Bundle`.
4. WHEN o admin submete o formulário com dados inválidos, THE Edit_User_Modal SHALL exibir mensagens de erro por campo e NÃO disparar mutação.
5. WHEN o admin submete o formulário com dados válidos, THE Users_Service SHALL chamar `executeAdminMutation` com `action = 'USER_EDIT'`, `before = <dados antigos>`, `after = <dados novos>`, e em seguida `UPDATE users SET ... WHERE id = userId` (e `UPDATE motoristas` ou `UPDATE embarcadores` quando aplicável).
6. WHEN o `phone` é alterado para valor já existente em outra linha, THE Users_Service SHALL falhar com `PHONE_ALREADY_USED` e a UI SHALL exibir toast `Telefone já cadastrado em outra conta.`.
7. WHEN o `email` é alterado para valor já existente em outra linha (case-insensitive), THE Users_Service SHALL falhar com `EMAIL_ALREADY_USED` e a UI SHALL exibir toast equivalente.
8. IF a tentativa é editar o `Master_Admin`, THEN THE Users_Service SHALL falhar com `MASTER_ADMIN_IMMUTABLE`. Edição de campos do Master_Admin é feita exclusivamente via SQL direto (documentado em RECOVERY).
9. WHEN dois admins editam simultaneamente o mesmo `Target_User` (concorrência), THE Users_Service SHALL detectar via comparação `updated_at` enviado no payload e atual no banco. IF os timestamps divergem, THEN THE Users_Service SHALL falhar com `STALE_VERSION` e a UI SHALL exibir `Os dados foram alterados por outro admin. Recarregue antes de salvar.`.
10. WHEN o `UPDATE` é bem-sucedido, THE User_Detail_Page SHALL atualizar a UI sem reload completo.

### Requirement 6: Ação `Excluir Conta` (Cascade Controlado)

**User Story:** Como Super_Admin, quero excluir definitivamente a conta de um usuário, para casos de violação grave ou solicitação LGPD.

#### Acceptance Criteria

1. THE User_Detail_Page SHALL exibir botão `Excluir conta` apenas quando o admin tem permissão `USER_DELETE` (ou seja, somente `SUPER_ADMIN`).
2. WHEN o admin sem `USER_DELETE` visualiza o detalhe, THE User_Detail_Page SHALL ocultar o botão `Excluir conta`.
3. WHEN o admin clica em `Excluir conta`, THE User_Detail_Page SHALL exibir modal de confirmação dupla: digitar nome exato do usuário no input e clicar `Confirmar exclusão`.
4. THE Delete_Confirmation_Modal SHALL exibir aviso visual destacado em vermelho com texto `Esta ação é irreversível. Todos os dados deste usuário serão removidos.`.
5. WHEN o admin confirma a exclusão, THE Users_Service SHALL chamar `executeAdminMutation` com `action = 'USER_DELETE'`, `before = <snapshot completo do usuário>`, `after = null`, e em seguida `DELETE FROM users WHERE id = userId` (cascade para `motoristas`, `embarcadores`, `documents`, `notifications`, `chat_messages`, `frete_clicks`, `avaliacoes`).
6. THE Users_Service SHALL garantir que o `before_data` do audit log contenha JSON com todos os campos da linha em `users` mais a contagem de registros relacionados (fretes, documentos, avaliações).
7. IF a tentativa é excluir o `Master_Admin`, THEN THE Users_Service SHALL falhar com `MASTER_ADMIN_IMMUTABLE`.
8. IF a tentativa é excluir o próprio admin logado, THEN THE Users_Service SHALL falhar com `SELF_ACTION_FORBIDDEN`.
9. WHEN o usuário a ser excluído é embarcador com fretes ativos (`fretes.status = 'ativo'`), THE Delete_Confirmation_Modal SHALL exibir aviso adicional listando quantidade de fretes ativos e exigir checkbox `Estou ciente de que [N] fretes ativos serão cancelados`.
10. WHEN a exclusão de embarcador é confirmada com fretes ativos, THE Users_Service SHALL primeiro fazer `UPDATE fretes SET status = 'cancelado' WHERE embarcador_id = userId AND status = 'ativo'` em transação antes do `DELETE`, gerando audit log adicional `FRETE_AUTO_CANCEL` por frete cancelado.
11. WHEN o `DELETE` é bem-sucedido, THE User_Detail_Page SHALL redirecionar para `/admin/users` com toast `Conta excluída com sucesso.`.
12. THE Migration_031 SHALL adicionar trigger `BEFORE DELETE ON users` que bloqueia `DELETE` quando `admin_username = 'Nexus_Vortex99'`, com erro `master_admin_immutable: cannot delete Master_Admin`.

### Requirement 7: Ação `Forçar Reset de Senha`

**User Story:** Como Super_Admin, quero forçar reset de senha de um usuário, para casos em que ele perdeu acesso e precisa de um link de recuperação.

#### Acceptance Criteria

1. THE User_Detail_Page SHALL exibir botão `Forçar reset de senha` quando o admin tem permissão `USER_EDIT`.
2. WHEN o admin clica em `Forçar reset de senha`, THE User_Detail_Page SHALL exibir modal de confirmação com texto `Enviar link de reset de senha para [email/telefone] do usuário?`.
3. WHEN o admin confirma, THE Users_Service SHALL chamar `executeAdminMutation` com `action = 'USER_PASSWORD_RESET_REQUESTED'`, e em seguida invocar `supabase.auth.admin.generateLink({type: 'recovery', email: <user.email>})` ou equivalente para SMS.
4. WHEN o usuário não tem email cadastrado E não tem provider de SMS configurado, THE Users_Service SHALL falhar com `NO_RECOVERY_CHANNEL` e a UI SHALL exibir toast `Usuário não possui email nem telefone válido para reset.`.
5. THE Users_Service SHALL NÃO armazenar nem expor o token de reset gerado; o token vai direto do Supabase para o canal do usuário.
6. THE audit log de reset SHALL incluir `after_data = {channel: 'email' | 'sms', target_email: <obfuscado>, target_phone: <obfuscado>}` onde obfuscação substitui meio do valor por `***`.
7. IF a tentativa é resetar senha do `Master_Admin`, THEN THE Users_Service SHALL falhar com `MASTER_ADMIN_IMMUTABLE`. O reset de senha do Master_Admin é feito via SQL direto (documentado em RECOVERY do `admin-foundation`).

### Requirement 8: Ação `Forçar Logout em Todas as Sessões`

**User Story:** Como Super_Admin, quero invalidar todas as sessões ativas de um usuário, para garantir que ele seja desconectado em todos os dispositivos imediatamente.

#### Acceptance Criteria

1. THE User_Detail_Page SHALL exibir botão `Forçar logout` quando o admin tem permissão `USER_EDIT`.
2. WHEN o admin clica em `Forçar logout`, THE User_Detail_Page SHALL exibir modal de confirmação simples.
3. WHEN o admin confirma, THE Users_Service SHALL chamar `executeAdminMutation` com `action = 'USER_FORCE_LOGOUT'`, e em seguida invocar `supabase.auth.admin.signOut(userId, 'global')` (ou equivalente RPC com SECURITY DEFINER).
4. THE Migration_031 SHALL criar função `admin_force_logout(p_user_id uuid)` SECURITY DEFINER que:
   - Verifica se o caller tem permissão `USER_EDIT` via `is_admin_with_permission`.
   - Bloqueia se `p_user_id` é o `Master_Admin`.
   - Bloqueia se `p_user_id = auth.uid()`.
   - Revoga todos os refresh tokens em `auth.refresh_tokens` filtrando por `user_id`.
5. IF a tentativa é forçar logout do `Master_Admin`, THEN THE função SQL SHALL falhar com `master_admin_immutable`.
6. IF a tentativa é forçar logout do próprio admin, THEN THE função SQL SHALL falhar com `self_action_forbidden`.
7. WHEN bem-sucedido, THE User_Detail_Page SHALL exibir toast `Todas as sessões do usuário foram encerradas.`.

### Requirement 9: Página `/admin/users/admins` — Gestão de Admins

**User Story:** Como SUPER_ADMIN, quero uma aba dedicada listando admins ativos e seus papéis, para conceder ou revogar permissões.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/users/admins` protegida por `AdminGuard`.
2. THE Admins_List_Page SHALL ser acessível apenas a admins com permissão `ADMIN_ROLE_GRANT` (ou seja, somente `SUPER_ADMIN`).
3. WHEN um admin sem `ADMIN_ROLE_GRANT` acessa `/admin/users/admins`, THE AdminGuard SHALL renderizar `Stealth_404`.
4. THE Admins_List_Page SHALL listar todos os usuários com `is_superuser = true`, exibindo: nome, `admin_username`, papéis ativos (chips com cor por papel), data do último login (de `admin_audit_logs WHERE action = 'ADMIN_LOGIN_SUCCESS'`), botão `Gerenciar`.
5. THE Admins_List_Page SHALL marcar a linha do `Master_Admin` com badge `Master` e ícone de cadeado.
6. THE Admins_List_Page SHALL marcar a linha do próprio admin logado com badge `Você`.
7. WHEN o admin clica em `Gerenciar`, THE Admins_List_Page SHALL abrir modal `Manage_Admin_Modal` com lista de papéis (`SUPER_ADMIN`, `ADMIN`, `SUPORTE`, `FINANCEIRO`, `MODERADOR`) e checkboxes refletindo papéis ativos.
8. WHEN o admin marca um checkbox de papel não-ativo e confirma, THE Users_Service SHALL chamar `grantRole(userId, role)` (já implementado em `roles.ts`), o qual usa `executeAdminMutation` com `action = 'ADMIN_ROLE_GRANTED'`.
9. WHEN o admin desmarca um checkbox de papel ativo e confirma, THE Users_Service SHALL chamar `revokeRole(userId, role)`, o qual usa `executeAdminMutation` com `action = 'ADMIN_ROLE_REVOKED'`.
10. WHEN o `Manage_Admin_Modal` é aberto para um usuário com `is_active = false`, THE Manage_Admin_Modal SHALL exibir aviso `Este admin está desativado. Reative em [link para detalhe] antes de promovê-lo.` e desabilitar o checkbox `SUPER_ADMIN`.
11. THE Admins_List_Page SHALL atualizar a lista em tempo real via `subscribeRoleChanges` (já implementado).

### Requirement 10: Proteção do `Last_Super_Admin`

**User Story:** Como SUPER_ADMIN, quero que o sistema impeça a revogação do último SUPER_ADMIN, para evitar bloqueio total do painel.

#### Acceptance Criteria

1. WHEN o admin tenta desmarcar o checkbox `SUPER_ADMIN` no `Manage_Admin_Modal` E o usuário-alvo é o `Last_Super_Admin` (única linha com `role = 'SUPER_ADMIN' AND revoked_at IS NULL` no banco), THE Manage_Admin_Modal SHALL desabilitar o checkbox e exibir tooltip `Não é possível revogar o último SUPER_ADMIN.`.
2. WHEN o admin tenta revogar o próprio papel `SUPER_ADMIN` E ele é o `Last_Super_Admin`, THE Manage_Admin_Modal SHALL desabilitar o checkbox com mesmo tooltip.
3. THE Migration_031 SHALL adicionar trigger `BEFORE UPDATE` em `admin_roles` que bloqueia setar `revoked_at IS NOT NULL` quando o papel é `SUPER_ADMIN` E não há outro registro ativo de `SUPER_ADMIN` para outro `user_id`. O erro SHALL ser `last_super_admin_protected`.
4. THE Users_Service SHALL chamar a função SQL `count_active_super_admins()` antes de exibir o `Manage_Admin_Modal` para decidir se desabilita o checkbox; o resultado é re-validado pela trigger no momento do commit (UI + banco redundantes).
5. THE Migration_031 SHALL criar `count_active_super_admins() RETURNS integer` STABLE retornando `COUNT(*) FROM admin_roles WHERE role = 'SUPER_ADMIN' AND revoked_at IS NULL`.

### Requirement 11: Imutabilidade do `Master_Admin`

**User Story:** Como engenheiro de plataforma, quero que o Master_Admin seja imutável por construção, para garantir que ninguém (nem outro SUPER_ADMIN) consiga removê-lo via painel ou cliente Supabase.

#### Acceptance Criteria

1. THE Master_Admin SHALL ser definido como `users WHERE admin_username = 'Nexus_Vortex99'`.
2. THE Migration_031 SHALL adicionar trigger `BEFORE UPDATE ON users` que falha com `master_admin_immutable` quando a linha do Master_Admin tem `is_active`, `admin_username`, `is_superuser` ou `name` alterado.
3. THE Migration_031 SHALL adicionar trigger `BEFORE DELETE ON users` que falha com `master_admin_immutable` quando a linha alvo é o Master_Admin.
4. THE Migration_031 SHALL adicionar trigger `BEFORE INSERT OR UPDATE ON admin_roles` que falha com `master_admin_immutable` quando a operação tenta inserir `revoked_at` em um registro `(user_id = master, role = 'SUPER_ADMIN')` ativo, ou quando tenta inserir um registro com `granted_by` que removeria implicitamente o Master_Admin.
5. THE Users_List_Page e Users_Service SHALL bloquear, antes mesmo da chamada ao banco, qualquer mutação (`USER_TOGGLE_ACTIVE`, `USER_EDIT`, `USER_DELETE`, `USER_FORCE_LOGOUT`, `USER_PASSWORD_RESET_REQUESTED`, `ADMIN_ROLE_REVOKE` em SUPER_ADMIN) cujo target seja o Master_Admin, retornando erro `MASTER_ADMIN_IMMUTABLE`.
6. THE User_Detail_Page e Admins_List_Page SHALL ocultar (não apenas desabilitar) os botões de ação destrutivos quando o target é o Master_Admin.
7. THE Manage_Admin_Modal aberto para o Master_Admin SHALL exibir o checkbox `SUPER_ADMIN` desabilitado com tooltip `Master_Admin: papel imutável.` e ocultar todos os outros checkboxes (Master_Admin tem todas as permissões).
8. WHEN qualquer trigger SQL relacionada ao Master_Admin é acionada e bloqueia a operação, THE log_admin_action_rollback SHALL registrar `action = 'MASTER_ADMIN_IMMUTABLE_BLOCKED'` com `before_data = {attempted_action, target_id}` para investigação.

### Requirement 12: Bulk Actions (Ativar/Desativar em Massa)

**User Story:** Como Super_Admin, quero selecionar múltiplos usuários e ativar/desativar em uma operação, para agilizar moderação em lote.

#### Acceptance Criteria

1. THE Users_List_Page SHALL exibir checkbox em cada linha quando o admin tem permissão `USER_TOGGLE_ACTIVE`.
2. THE Users_List_Page SHALL exibir checkbox no header da tabela para `Selecionar todos da página atual`.
3. THE Users_List_Page SHALL exibir barra de bulk actions no topo quando há pelo menos 1 usuário selecionado, com botões `Ativar selecionados` e `Desativar selecionados` e contador `[N] selecionados`.
4. WHEN o admin clica em `Ativar selecionados` ou `Desativar selecionados`, THE Users_List_Page SHALL exibir modal de confirmação com texto `Aplicar [ativar/desativar] em [N] usuários?`.
5. WHEN o admin confirma, THE Users_Service SHALL iterar pelos usuários selecionados e chamar `executeAdminMutation` por usuário (1 audit log por target), com `action = 'USER_TOGGLE_ACTIVE'`, `target_id = userId`.
6. THE Users_Service SHALL processar em paralelo com `Promise.allSettled` e concorrência máxima de 5 requisições simultâneas.
7. THE Users_List_Page SHALL exibir progresso `[K] de [N] processados` durante a execução.
8. WHEN um usuário no lote falha (ex: Master_Admin, próprio admin), THE Users_Service SHALL pular esse usuário, registrar audit log `USER_TOGGLE_ACTIVE_SKIPPED` com motivo, e continuar com os outros.
9. WHEN a operação termina, THE Users_List_Page SHALL exibir resumo: `[K] sucesso, [F] falhas, [S] pulados.` e oferecer link `Ver detalhes` que abre modal listando os pulados/falhos.
10. THE Users_List_Page SHALL desmarcar todos os checkboxes ao final da operação.
11. THE bulk action SHALL ter limite máximo de 200 usuários por operação. IF o admin seleciona mais de 200, THEN THE Users_List_Page SHALL desabilitar os botões de bulk e exibir aviso `Máximo de 200 por operação.`.

### Requirement 13: RLS Reforçada via `is_admin_with_permission`

**User Story:** Como engenheiro de segurança, quero que o banco garanta que apenas admins com permissão correta possam ler/alterar dados sensíveis dos usuários, independentemente do que o front-end faz.

#### Acceptance Criteria

1. THE Migration_031 SHALL adicionar política `users_admin_select` em `users` permitindo SELECT quando `is_admin_with_permission('USER_VIEW')`.
2. THE Migration_031 SHALL adicionar política `users_admin_update` em `users` permitindo UPDATE quando `is_admin_with_permission('USER_EDIT') OR is_admin_with_permission('USER_TOGGLE_ACTIVE')`.
3. THE Migration_031 SHALL adicionar política `users_admin_delete` em `users` permitindo DELETE quando `is_admin_with_permission('USER_DELETE')`.
4. THE Migration_031 SHALL adicionar políticas equivalentes em `motoristas`, `embarcadores`, `documents`, `notifications`, `chat_messages` (apenas SELECT para `USER_VIEW`).
5. WHERE policies já existem para o app comum (auth.uid() = user_id), THE Migration_031 SHALL preservá-las intactas e adicionar as policies admin como `OR` lógico no `USING` de uma policy combinada OU como policies separadas adicionais (decisão por tabela; idempotência exige `DROP POLICY IF EXISTS`).
6. THE Migration_031 SHALL preservar a imutabilidade de `admin_audit_logs` (UPDATE/DELETE permanecem `false` mesmo para SUPER_ADMIN).
7. WHEN um cliente Supabase com `auth.uid()` de um motorista comum tenta `SELECT * FROM users WHERE id != auth.uid()`, THE RLS_Engine SHALL retornar 0 linhas (mesmo comportamento de antes).
8. WHEN um cliente Supabase com `auth.uid()` de um SUPORTE (que tem `USER_VIEW`) tenta `SELECT * FROM users`, THE RLS_Engine SHALL retornar todas as linhas.
9. WHEN um cliente Supabase com `auth.uid()` de um SUPORTE (que NÃO tem `USER_DELETE`) tenta `DELETE FROM users WHERE id = X`, THE RLS_Engine SHALL retornar 0 linhas afetadas (silently denied).

### Requirement 14: Export CSV de Lista Filtrada

**User Story:** Como Super_Admin, quero exportar a lista filtrada para CSV, para análise externa em planilha.

#### Acceptance Criteria

1. THE Users_List_Page SHALL exibir botão `Exportar CSV` quando o admin tem permissão `USER_VIEW`.
2. WHEN o admin clica em `Exportar CSV`, THE Users_Service SHALL chamar `exportUsersCSV(filters)` que aplica os mesmos filtros, busca e ordenação da listagem visível.
3. THE Users_Export_Format SHALL ter cabeçalho fixo: `id,user_type,name,phone,email,cpf_or_cnpj,company_name,is_active,created_at,last_activity_at`.
4. THE Users_Export_Format SHALL escapar campos contendo `,`, `"`, ou newline com aspas duplas e duplicação de aspas internas (RFC 4180).
5. THE Users_Export_Format SHALL conter no máximo 10000 linhas. IF o filtro retorna mais de 10000, THEN THE Users_Service SHALL exportar apenas as primeiras 10000 (ordenadas por `User_Sort` atual) e a UI SHALL exibir aviso `Export limitado a 10000 linhas. Refine os filtros para exportar todos.`.
6. WHEN a exportação termina, THE Users_Service SHALL chamar `executeAdminMutation` com `action = 'USERS_EXPORT'`, `before = null`, `after = {filters, total_exported, requested_limit}`.
7. THE Users_List_Page SHALL disparar download do CSV no navegador com nome `fretego-usuarios-YYYYMMDD-HHmmss.csv`.
8. THE CSV SHALL ser gerado client-side a partir dos dados em memória; nenhum dado é enviado a servidor externo.

### Requirement 15: Audit-by-Construction em Toda Mutação

**User Story:** Como compliance officer, quero que toda mutação de usuário gere audit log automaticamente, para que nenhuma alteração passe sem registro.

#### Acceptance Criteria

1. FOR ALL operações de mutação expostas em `Users_Service` (`toggleActive`, `editUser`, `deleteUser`, `requestPasswordReset`, `forceLogout`, `bulkToggleActive`, `exportUsersCSV`, `grantRole`, `revokeRole`), THE Users_Service SHALL invocar `executeAdminMutation` com a `AdminAction` correspondente.
2. THE Users_Service SHALL NUNCA chamar `supabase.from('users').update(...)` ou similar diretamente sem passar por `executeAdminMutation`.
3. THE audit log SHALL conter `target_type ∈ {'users','admin_roles','documents'}` e `target_id` igual ao UUID do alvo.
4. THE `before_data` SHALL conter snapshot dos campos editáveis antes da mutação. THE `after_data` SHALL conter snapshot após a mutação.
5. WHEN a serialização de `before` ou `after` falha (objeto circular), THE executeAdminMutation SHALL gravar `{error: 'serialization_failed'}` e continuar (já garantido em `audit.ts`).
6. THE testes desta spec SHALL incluir teste de propriedade que verifica: para toda chamada a `Users_Service.<mutação>`, existe exatamente 1 registro novo em `admin_audit_logs` com `action` correspondente (mock de banco).

### Requirement 16: Stealth 404 em Sub-rotas Não Autorizadas

**User Story:** Como engenheiro de segurança, quero que toda sub-rota do módulo de usuários respeite o stealth 404, para que admins sem permissão não saibam que a tela existe.

#### Acceptance Criteria

1. WHEN um admin sem `USER_VIEW` acessa `/admin/users` ou `/admin/users/:id`, THE AdminGuard SHALL renderizar `Stealth_404`.
2. WHEN um admin sem `ADMIN_ROLE_GRANT` acessa `/admin/users/admins`, THE AdminGuard SHALL renderizar `Stealth_404`.
3. WHEN o `:id` não existe ou é admin (`user_type = 'admin'`), THE User_Detail_Page SHALL renderizar `Stealth_404` (Req 3.3).
4. WHEN um admin acessa `/admin/users/:id` com `:id` inválido (não-UUID), THE User_Detail_Page SHALL renderizar `Stealth_404` sem chamar o banco.
5. THE rendering de `Stealth_404` em qualquer sub-rota SHALL acionar `logAdminAction` com `action = 'ADMIN_STEALTH_BLOCK'` e `target_id = <pathname>` (já comportamento herdado de `admin-foundation`).

### Requirement 17: Concorrência e Versionamento Otimista

**User Story:** Como engenheiro, quero que edições concorrentes do mesmo usuário sejam detectadas, para evitar sobrescrita silenciosa.

#### Acceptance Criteria

1. THE Users_Service.editUser SHALL aceitar parâmetro `expectedUpdatedAt: string` representando o `users.updated_at` que o admin viu ao abrir o modal.
2. WHEN o `UPDATE` é executado, THE Users_Service SHALL incluir `WHERE id = userId AND updated_at = expectedUpdatedAt` no statement.
3. WHEN o `UPDATE` retorna 0 linhas afetadas, THE Users_Service SHALL falhar com `STALE_VERSION` e gerar audit log `USER_EDIT_STALE_VERSION`.
4. THE Edit_User_Modal SHALL exibir, em caso de `STALE_VERSION`, opção `Recarregar` que fecha o modal e recarrega o `User_Detail_Bundle`.
5. THE comportamento de `STALE_VERSION` SHALL ser aplicado também em `toggleActive` e `forceLogout` para garantir consistência.
6. THE bulk actions SHALL ser exceção: por serem operações idempotentes (`USER_TOGGLE_ACTIVE` não falha se já no estado desejado), NÃO requerem `expectedUpdatedAt`.

### Requirement 18: Coluna Opcional `ban_reason` para Distinguir Banido de Inativo

**User Story:** Como Super_Admin, quero distinguir um usuário banido (sancionado) de um usuário apenas inativo (auto-desativado ou inação), para classificar adequadamente.

#### Acceptance Criteria

1. THE Migration_031 SHALL adicionar coluna `ban_reason TEXT NULL` em `users`.
2. THE Migration_031 SHALL adicionar coluna `banned_at TIMESTAMPTZ NULL` em `users`.
3. THE Migration_031 SHALL adicionar coluna `banned_by UUID NULL REFERENCES users(id)` em `users`.
4. THE User_Status_Filter SHALL classificar como `Banido` quando `is_active = false AND ban_reason IS NOT NULL`. As demais combinações são `Ativo` (`is_active = true`) ou `Inativo` (`is_active = false AND ban_reason IS NULL`).
5. THE Edit_User_Modal SHALL incluir aba `Moderação` (visível com `USER_TOGGLE_ACTIVE`) com campo `ban_reason` (textarea, max 1000 chars).
6. WHEN o admin desativa um usuário e preenche `ban_reason`, THE Users_Service SHALL gravar `is_active = false`, `ban_reason = <texto>`, `banned_at = NOW()`, `banned_by = <admin_id>` em uma única transação, com audit log `USER_BAN`.
7. WHEN o admin reativa um usuário banido, THE Users_Service SHALL gravar `is_active = true`, `ban_reason = NULL`, `banned_at = NULL`, `banned_by = NULL` em uma única transação, com audit log `USER_UNBAN`.
8. THE User_Detail_Page SHALL exibir bloco `Banimento` com `ban_reason`, `banned_at`, nome do `banned_by` quando o usuário está banido.

### Requirement 19: Migration `031_admin_users.sql`

**User Story:** Como engenheiro, quero uma migration única, idempotente e reversível para o módulo de usuários, para que o setup possa ser aplicado em dev/staging/prod sem dor.

#### Acceptance Criteria

1. THE Migration_031 SHALL ser arquivada como `supabase/migrations/031_admin_users.sql`.
2. THE Migration_031 SHALL aplicar em ordem: alteração de `users` (colunas `ban_reason`, `banned_at`, `banned_by`), trigger Master_Admin imutável, trigger Last_Super_Admin protegido, função `count_active_super_admins`, função `admin_force_logout`, policies RLS adicionais em `users`, `motoristas`, `embarcadores`, `documents`, `notifications`, `chat_messages`.
3. THE Migration_031 SHALL ser idempotente (uso de `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).
4. THE Migration_031 SHALL incluir comentário de cabeçalho explicando objetivo, dependência (migrations 001..030), e nota sobre triggers do Master_Admin.
5. THE Migration_031 SHALL ser envolvida em transação `BEGIN; ... COMMIT;`.
6. IF a migration falha em qualquer passo, THEN o estado anterior SHALL ser preservado.
7. THE Migration_031 SHALL incluir, ao final, bloco `-- VERIFY` com queries SELECT que validam: presença de colunas novas, presença de policies novas, presença de funções novas. Esses SELECTs servem como smoke test pós-deploy.

### Requirement 20: UI em pt-BR e Acessibilidade Básica

**User Story:** Como Super_Admin brasileiro, quero todas as mensagens, labels e botões em português do Brasil e com acessibilidade básica, para usar o painel sem fricção.

#### Acceptance Criteria

1. THE Users_List_Page, User_Detail_Page e Admins_List_Page SHALL ter todos os textos em pt-BR.
2. THE inputs de filtro e formulário SHALL ter `<label>` associado via `htmlFor`/`id`.
3. THE botões com ícones-only SHALL ter `aria-label` em pt-BR.
4. THE modais de confirmação SHALL ter `role="dialog"`, `aria-modal="true"`, foco inicial no botão de cancelar.
5. THE tabela de listagem SHALL ter `<th scope="col">` em todas as colunas e `<caption>` invisível para leitores de tela com texto `Lista de usuários do FreteGO`.
6. THE checkboxes de bulk actions SHALL ter `aria-label` descritivo (ex: `Selecionar usuário [nome]`).
7. THE estados de loading SHALL ter `aria-busy="true"` no container.
8. THE estado vazio SHALL ter `role="status"`.

## Edge Cases (não-funcionais, mas obrigatórios)

Os comportamentos a seguir SHALL ser cobertos por testes ou documentação explícita:

1. **Admin tenta desativar a si mesmo**: bloqueado em UI (botão oculto na própria linha) e em `Users_Service` (`SELF_ACTION_FORBIDDEN`). Reforçado por trigger SQL em `USER_TOGGLE_ACTIVE` opcional (Req 4.8).
2. **Admin tenta revogar próprio papel `SUPER_ADMIN` sendo o último**: bloqueado por trigger `last_super_admin_protected` (Req 10.3) e por desabilitação na UI (Req 10.2).
3. **Admin tenta excluir embarcador com fretes ativos**: requer checkbox extra de confirmação (Req 6.9), cancela fretes em transação antes do delete (Req 6.10).
4. **Admin tenta promover usuário desativado a SUPER_ADMIN**: bloqueado na UI (Req 9.10); o backend permite (não há trigger), mas o admin desativado não consegue logar (já garantido em `admin-foundation`).
5. **Concorrência em edit**: dois admins editando o mesmo usuário detectados via `expectedUpdatedAt` (Req 17). Cliente que perde a corrida vê `STALE_VERSION` e tem opção de recarregar.
6. **Bulk action que inclui o Master_Admin**: o Master_Admin é pulado (skip), audit log `USER_TOGGLE_ACTIVE_SKIPPED` é gerado, operação continua nos demais (Req 12.8).
7. **Bulk action que inclui o próprio admin**: o próprio admin é pulado (skip), comportamento idêntico ao item anterior.
8. **Export CSV com filtros que retornam 0 resultados**: download do CSV vazio (apenas cabeçalho), audit log `USERS_EXPORT` gerado normalmente com `total_exported = 0`.
9. **Master_Admin está com sessão admin ativa enquanto outro admin tenta promovê-lo a outro papel**: Master_Admin já tem todos os papéis implicitamente; promoção é no-op (já é SUPER_ADMIN), grant duplicado é bloqueado pelo índice único `uq_admin_roles_active`.
10. **`admin_username` removido do Master_Admin via SQL direto**: cenário fora do escopo do painel; documentado como ataque interno requerendo audit forense pós-evento.
11. **RLS bloqueia DELETE silenciosamente**: cliente vê 0 linhas afetadas; UI deve detectar isso comparando `count` retornado e exibir erro genérico `Operação não permitida.` (Req 13.9).
12. **Reset de senha quando o usuário não tem email**: bloqueado com `NO_RECOVERY_CHANNEL` (Req 7.4); admin precisa primeiro adicionar email via `Editar`.
13. **Force logout de usuário sem sessão ativa**: a função RPC retorna sucesso (no-op), audit log gerado normalmente.

## Correctness Properties (Property-Based Tests)

Estas propriedades DEVEM ser testáveis com fast-check (já em uso). Funções alvo são puras ou facilmente isoláveis com mocks de banco.

### CP-1: Master_Admin é Imutável (Property)
**Propriedade:** Para toda `AdminAction a ∈ {USER_TOGGLE_ACTIVE, USER_EDIT, USER_DELETE, USER_FORCE_LOGOUT, USER_PASSWORD_RESET_REQUESTED}` e todo `Target_User u` com `u.admin_username = 'Nexus_Vortex99'`, `Users_Service.<mutação>(u.id, ...)` falha com `MASTER_ADMIN_IMMUTABLE` antes de chamar o banco.
**Tipo:** Property (Invariante de segurança).
**Geradores:** `a` exaustivo no enum, `u` com `admin_username = 'Nexus_Vortex99'` e demais campos arbitrários.

### CP-2: Toggle Ativo→Ativo é Idempotente (Property)
**Propriedade:** Para todo `userId` válido (não-Master, não-self), executar `Users_Service.toggleActive(userId, targetState)` duas vezes consecutivas com o mesmo `targetState` produz o mesmo estado final em `users.is_active`. A segunda chamada gera audit log mas não altera o banco (`UPDATE` afeta 0 linhas).
**Tipo:** Property (Idempotência).
**Geradores:** `userId: UUID`, `targetState ∈ {true, false}`.

### CP-3: Toda Mutação Gera Exatamente 1 Audit Log (Property)
**Propriedade:** Para toda chamada a `Users_Service.<mutação>(args)` com mock de banco bem-sucedido, há exatamente 1 registro novo em `admin_audit_logs` com `action` correspondente à mutação. Em caso de falha pós-log, há 1 log original + 1 log `_ROLLBACK` (total 2).
**Tipo:** Property (Invariante).
**Geradores:** `mutação ∈ {toggleActive, editUser, deleteUser, requestPasswordReset, forceLogout, grantRole, revokeRole}`, `args` arbitrários.

### CP-4: Permission_Matrix Decide Visibilidade dos Botões (Property)
**Propriedade:** Para todo conjunto de papéis `R` e todo `Target_User u`, a presença ou ausência dos botões de ação em `User_Detail_Page` é exatamente `hasPermissionForRoles(R, action)` para cada ação correspondente, exceto quando `u` é Master_Admin (todos os botões destrutivos ocultos) ou `u.id === adminId` (botões self-action ocultos).
**Tipo:** Property (Invariante de UI).
**Geradores:** `R: AdminRole[]`, `u: User`.

### CP-5: Last_Super_Admin Não Pode Ser Revogado (Property)
**Propriedade:** Para todo cenário em que existe exatamente 1 registro ativo de `SUPER_ADMIN` em `admin_roles` para `user_id = u`, qualquer tentativa de `revokeRole(u, 'SUPER_ADMIN')` falha com `last_super_admin_protected` e o registro permanece ativo.
**Tipo:** Property (Invariante de segurança).
**Geradores:** `u: UUID`, número de outros papéis ativos para `u` (irrelevante), simulação de banco.

### CP-6: Round-Trip de Filtros via URL (Property)
**Propriedade:** Para todo objeto `f: UsersFilters` válido (`type`, `status`, `q`, `sort`, `page`), `parseUsersFiltersFromQuery(serializeUsersFiltersToQuery(f))` é deep-equal a `f` (round-trip).
**Tipo:** Round-Trip.
**Geradores:** `type ∈ {'todos','motorista','embarcador'}`, `status ∈ {'todos','ativo','inativo','banido'}`, `q ∈ string`, `sort ∈ {'created_desc','created_asc','activity_desc','activity_asc'}`, `page ∈ ℕ⁺`.

### CP-7: CSV Export Respeita RFC 4180 (Property)
**Propriedade:** Para toda lista `L` de `User_Row` com strings arbitrárias (incluindo `,`, `"`, `\n`, `\r`), `parseCsv(exportUsersToCsvString(L))` é deep-equal a `L` (round-trip), e cada linha do CSV tem exatamente 10 campos (cabeçalho fixo do `Users_Export_Format`).
**Tipo:** Round-Trip.
**Geradores:** `L: User_Row[]` com strings que incluem caracteres especiais.

### CP-8: Bulk Action Pula Master e Self (Property)
**Propriedade:** Para toda lista `userIds` que inclui `master_admin_id` e/ou `self_admin_id`, `bulkToggleActive(userIds, targetState)` retorna `{success: K, skipped: S, failed: F}` onde `S >= |{ids ∈ userIds : ids ∈ {master, self}}|`, e o estado de `users.is_active` para esses dois IDs permanece inalterado.
**Tipo:** Property (Invariante de segurança).
**Geradores:** `userIds: UUID[]` arbitrários, com inserção forçada de master/self em posições aleatórias.

### CP-9: Versionamento Otimista Detecta Concorrência (Property)
**Propriedade:** Para toda sequência `[t1, t2]` de timestamps onde `t1 < t2`, executar `editUser(u, expectedUpdatedAt = t1)` quando o banco já tem `users.updated_at = t2` falha com `STALE_VERSION`, e `users` permanece inalterado.
**Tipo:** Property (Invariante de consistência).
**Geradores:** `t1, t2: ISO timestamps com t1 < t2`, `u: UUID`.

### CP-10: Search Normaliza Telefone e CPF (Property)
**Propriedade:** Para toda string de busca `q` contendo apenas dígitos com tamanho >= 8, e todo registro `u` com `u.phone` ou `u.cpf` que normalizado contém `q`, `Users_Service.list({q})` retorna `u` no resultado. Equivalentemente, para `q` com máscara (ex: `(11) 99999-9999`), o resultado é o mesmo de `q` sem máscara (`11999999999`).
**Tipo:** Property (Metamórfica).
**Geradores:** `u.phone: string com máscara`, `q: string com ou sem máscara`.

### CP-11: User_Status_Filter Classifica Corretamente (Property)
**Propriedade:** Para todo `User_Row u`:
  - `u.is_active = true` ⇒ classificado como `Ativo`.
  - `u.is_active = false AND u.ban_reason IS NULL` ⇒ classificado como `Inativo`.
  - `u.is_active = false AND u.ban_reason IS NOT NULL` ⇒ classificado como `Banido`.
  Não existe `u` que se encaixe em mais de uma categoria.
**Tipo:** Property (Invariante de classificação).
**Geradores:** `u: User_Row` com combinações arbitrárias de `is_active` e `ban_reason`.

### CP-12: Trigger SQL e Service Concordam sobre Master_Admin (Property)
**Propriedade:** Para toda `AdminAction a` aplicada ao Master_Admin, o resultado de `Users_Service.<a>(master_id)` e o resultado de uma tentativa direta de mutação no banco (bypassing service) são ambos falhos. Ou seja, o conjunto de mutações bloqueadas pelo service é subconjunto do bloqueado pelo banco.
**Tipo:** Property (Defesa em profundidade).
**Geradores:** `a` exaustivo, banco com Master_Admin presente.

### CP-13: Permission_Matrix Determinística para USER_*  (Property)
**Propriedade:** Para todo par `(role, action)` onde `role ∈ AdminRole` e `action ∈ {USER_VIEW, USER_EDIT, USER_DELETE, USER_TOGGLE_ACTIVE, ADMIN_ROLE_GRANT, ADMIN_ROLE_REVOKE}`, `hasPermission(role, action)` é função pura e o resultado coincide com a tabela esperada documentada (Req 9.4..9.7 de `admin-foundation`).
**Tipo:** Property (Determinismo, herdada de admin-foundation, validada no contexto deste módulo).
**Geradores:** exaustivo.

## Padrões de Sucesso

A spec é considerada bem implementada quando:

1. Todos os 20 requisitos têm testes correspondentes (unitários, integração ou E2E).
2. Pelo menos 2 das 13 correctness properties (CP-1..CP-13) passam em PBT com ≥100 iterações; CP-1 (Master imutável) e CP-2 (idempotência de toggle) são obrigatórias.
3. Migration `031_admin_users.sql` aplica limpa em banco com migrations 001..030.
4. Todos os textos de UI estão em pt-BR.
5. Tentativa de mutar Master_Admin falha tanto no service (TypeScript) quanto no banco (trigger SQL).
6. Tentativa de revogar `Last_Super_Admin` falha no banco mesmo se o service for contornado.
7. Toda mutação em `Users_Service` tem audit log correspondente em `admin_audit_logs`.
8. Stealth_404 é renderizada para acessos a `/admin/users/*` por admins sem permissão.
