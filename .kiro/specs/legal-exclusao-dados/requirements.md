# Requirements Document

> Feature 4 — Exclusão de Dados pelo Usuário (FreteGO)

## Introduction

Esta feature implementa o **direito de exclusão (LGPD art. 18)**. No perfil do motorista e do embarcador, o usuário pode "Solicitar exclusão da minha conta e dados". A solicitação abre um modal de confirmação explicando o que será deletado; ao confirmar, o sistema **agenda** a exclusão completa dos dados pessoais em até **30 dias**, envia email de confirmação da solicitação, e o admin gerencia as solicitações no painel administrativo.

Reusa padrões já consolidados do projeto: `executeAdminMutation` (audit-by-construction), RBAC server-side via `is_admin_with_permission`, RPCs SECURITY DEFINER, versionamento otimista (`updated_at` + `STALE_VERSION`), idempotência `_SKIPPED`, e envio de email via Edge Function (mesmo padrão do `send-verification-email`). O Master Admin (`Nexus_Vortex99`) é imutável.

Convenções: UI/pt-BR; action codes e identifiers em inglês (`DATA_DELETION_VIEW`, `data_deletion_requests`, `DELETION_ALREADY_REQUESTED`).

## Glossary

- **Deletion_Request**: Registro de uma solicitação de exclusão de conta/dados feita por um usuário.
- **Deletion_Status**: Estado da solicitação — `pending` (agendada), `cancelled` (cancelada antes do prazo), `completed` (dados apagados/anonimizados).
- **Scheduled_For**: Data-limite em que a exclusão deve ser concluída — `requested_at + 30 dias` (LGPD).
- **Requested_At**: Timestamp UTC em que o usuário confirmou a solicitação.
- **Confirmation_Modal**: Modal exibido ao usuário explicando o que será deletado, antes de confirmar.
- **Deletion_Confirmation_Email**: Email enviado ao usuário confirmando o recebimento da solicitação e o prazo.
- **Admin_Deletion_Panel**: Tela no painel admin que lista e gerencia as Deletion_Requests.
- **Personal_Data_Scope**: Conjunto de dados pessoais a apagar/anonimizar (perfil, documentos, CPF/CNPJ, RNTRC, veículo, localização, mensagens com PII).
- **DATA_DELETION_VIEW / DATA_DELETION_MANAGE**: Permissões RBAC para ver e gerenciar solicitações no admin.

## Requirements

### Requirement 1: Solicitar exclusão no perfil

**User Story:** Como motorista ou embarcador, quero solicitar a exclusão da minha conta e dados, para exercer meu direito previsto na LGPD.

#### Acceptance Criteria

1. THE perfil do motorista e o perfil do embarcador SHALL exibir a opção "Solicitar exclusão da minha conta e dados".
2. WHEN o usuário acionar a opção, THE sistema SHALL exibir o Confirmation_Modal explicando claramente o que será deletado (Personal_Data_Scope) e o prazo de até 30 dias.
3. THE Confirmation_Modal SHALL exigir uma confirmação explícita (ex.: botão "Confirmar exclusão") distinta de um cancelamento.
4. WHEN o usuário cancelar o Confirmation_Modal, THE sistema SHALL NÃO criar nenhuma Deletion_Request.
5. WHEN o usuário confirmar, THE sistema SHALL criar uma Deletion_Request com `status=pending`, `requested_at=now()` e `scheduled_for = now() + 30 dias`.
6. WHILE já existir uma Deletion_Request `pending` para o usuário, THE sistema SHALL exibir o status da solicitação existente em vez de criar outra.

### Requirement 2: Agendamento e prazo de 30 dias

**User Story:** Como titular de dados, quero que minha exclusão seja concluída no prazo legal, para ter meus dados removidos.

#### Acceptance Criteria

1. WHEN uma Deletion_Request for criada, THE Scheduled_For SHALL ser exatamente `requested_at + 30 dias`.
2. THE Requested_At e o Scheduled_For SHALL ser definidos pelo servidor (não pelo cliente).
3. WHEN a exclusão for executada, THE sistema SHALL remover ou anonimizar todos os dados do Personal_Data_Scope do usuário.
4. WHEN a exclusão for concluída, THE Deletion_Request SHALL passar a `status=completed` com um timestamp de conclusão.
5. WHERE a remoção total quebrar integridade referencial necessária a registros legais (ex.: fretes encerrados para fins fiscais), THE sistema SHALL anonimizar os dados pessoais em vez de apagar a linha, preservando apenas o que a lei exige reter.
6. THE execução da exclusão SHALL ser idempotente: reexecutar sobre uma Deletion_Request já `completed` retorna resultado `_SKIPPED` sem reprocessar.

### Requirement 3: Email de confirmação da solicitação

**User Story:** Como usuário, quero receber um email confirmando minha solicitação, para ter comprovação do pedido e do prazo.

#### Acceptance Criteria

1. WHEN uma Deletion_Request for criada com sucesso, THE sistema SHALL enviar o Deletion_Confirmation_Email ao email do usuário.
2. THE Deletion_Confirmation_Email SHALL informar a data da solicitação, o prazo de conclusão (Scheduled_For) e o que será excluído.
3. IF o envio do Deletion_Confirmation_Email falhar, THEN THE sistema SHALL ainda assim manter a Deletion_Request criada (a falha de email NÃO bloqueia a solicitação) e registrar a falha para reprocesso.
4. THE Deletion_Confirmation_Email SHALL ser enviado pelo mesmo provedor/Edge Function já usado pelo projeto (Resend), reutilizando a infraestrutura existente.
5. WHERE o usuário não tiver email cadastrado, THE sistema SHALL criar a Deletion_Request mesmo assim e sinalizar que não foi possível enviar confirmação por email.

### Requirement 4: Gestão no painel administrativo

**User Story:** Como admin, quero ver e gerenciar as solicitações de exclusão, para cumprir o prazo legal e executar as exclusões.

#### Acceptance Criteria

1. THE Admin_Deletion_Panel SHALL listar as Deletion_Requests com usuário, data da solicitação, prazo (Scheduled_For) e status.
2. THE Admin_Deletion_Panel SHALL permitir filtrar por Deletion_Status e ordenar por proximidade do prazo.
3. WHEN um admin com `DATA_DELETION_MANAGE` executar a exclusão de uma Deletion_Request `pending`, THE sistema SHALL aplicar o Personal_Data_Scope e mover a solicitação para `completed`.
4. WHEN um admin sem `DATA_DELETION_MANAGE` tentar gerenciar uma solicitação, THE sistema SHALL retornar `permission_denied`, mesmo que existam outros erros simultâneos.
5. WHEN qualquer ação de gestão for executada, THE sistema SHALL gravar um registro de auditoria persistido em `admin_audit_logs` (via `executeAdminMutation`).
6. WHEN um admin abrir uma solicitação para edição/ação, THE sistema SHALL usar versionamento otimista (`updated_at` + `STALE_VERSION`) para evitar conflito entre admins.
7. THE Admin_Deletion_Panel SHALL exibir, para cada solicitação, se o Deletion_Confirmation_Email foi enviado com sucesso.
8. WHERE a solicitação for de um usuário Master Admin (`Nexus_Vortex99`), THE sistema SHALL bloquear a exclusão (Master Admin imutável).

### Requirement 5: Esquema, segurança e RLS

**User Story:** Como engenheiro, quero um modelo de dados seguro e auditável para as solicitações, para garantir conformidade e isolamento.

#### Acceptance Criteria

1. THE banco SHALL conter uma tabela `data_deletion_requests` com pelo menos: `id`, `user_id`, `status`, `requested_at`, `scheduled_for`, `completed_at`, `email_sent_at`, `updated_at`.
2. THE tabela `data_deletion_requests` SHALL ter RLS habilitada: o usuário só enxerga as próprias solicitações; admins enxergam via RPC SECURITY DEFINER gated por `DATA_DELETION_VIEW`.
3. THE RPC de criação de Deletion_Request SHALL ser SECURITY DEFINER, validar `auth.uid()`, e impedir criação duplicada de `pending` para o mesmo usuário (idempotência `DELETION_ALREADY_REQUESTED`).
4. THE RPC de execução da exclusão SHALL exigir `DATA_DELETION_MANAGE`, gravando log negativo quando negado.
5. THE migration SHALL ser idempotente, com `DO $check$` defensivo e par de rollback documentado (não auto-aplicado), conforme convenções do projeto.
6. THE Scheduled_For e Requested_At SHALL ser calculados em SQL (servidor), nunca recebidos do cliente.

### Requirement 6: Cancelamento e estado para o usuário

**User Story:** Como usuário, quero ver o status da minha solicitação e poder cancelá-la dentro do prazo, para reverter caso mude de ideia.

#### Acceptance Criteria

1. WHILE uma Deletion_Request estiver `pending`, THE perfil do usuário SHALL exibir o status e a data-limite da exclusão.
2. WHEN o usuário cancelar uma Deletion_Request `pending` antes da execução, THE sistema SHALL mover a solicitação para `cancelled` e manter a conta ativa.
3. WHEN o usuário tentar cancelar uma solicitação já `completed`, THE sistema SHALL retornar um resultado `_SKIPPED` indicando que a exclusão já ocorreu.
4. WHEN uma Deletion_Request estiver `cancelled`, THE usuário SHALL poder criar uma nova solicitação posteriormente.
