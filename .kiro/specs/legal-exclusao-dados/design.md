# Design Document

> Feature 4 — Exclusão de Dados pelo Usuário (FreteGO)

## Overview

Fluxo LGPD de exclusão de conta/dados com agendamento de 30 dias, email de confirmação e gestão no painel admin. Reusa integralmente os padrões do projeto: tabela com RLS, RPCs SECURITY DEFINER gated por RBAC, `executeAdminMutation` (audit-by-construction), versionamento otimista, idempotência `_SKIPPED`, Edge Function de email (Resend, via Vault/`EDGE_SHARED_SECRET`), e proteção do Master Admin.

Estados: `pending → completed` (execução) ou `pending → cancelled` (usuário desiste). Timestamps sempre do servidor.

## Architecture

```
PERFIL (motorista/embarcador)
  └─ botão "Solicitar exclusão" ─> Confirmation_Modal ─> rpc_request_data_deletion()
        │                                                    │ cria pending, scheduled_for=now()+30d
        │                                                    │ dispara email (pg_net -> Edge)
        ▼                                                    ▼
  estado da solicitação (pending: status + prazo + cancelar)  data_deletion_requests (RLS)

ADMIN  /admin/exclusoes
  └─ Admin_Deletion_Panel ─ listDeletionRequests() [DATA_DELETION_VIEW]
       ├─ executar exclusão ─ rpc_execute_data_deletion() [DATA_DELETION_MANAGE]  (executeAdminMutation)
       └─ versionamento otimista (updated_at + STALE_VERSION)

EDGE  send-account-deletion-email  (reusa padrão send-verification-email: Bearer EDGE_SHARED_SECRET)
```

## Components and Interfaces

### Tabela `data_deletion_requests`

```sql
CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','cancelled','completed')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz NOT NULL,            -- requested_at + 30 dias (servidor)
  completed_at  timestamptz,
  email_sent_at timestamptz,                      -- NULL = email não enviado/falhou
  reason        text,                             -- opcional (motivo informado)
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- índice parcial: no máximo uma pending por usuário
CREATE UNIQUE INDEX IF NOT EXISTS uq_deletion_pending_per_user
  ON public.data_deletion_requests(user_id) WHERE status = 'pending';
```

RLS:
- `SELECT` próprio: `user_id = auth.uid()`.
- Admin acessa via RPC SECURITY DEFINER (não por policy direta).

### RPC `rpc_request_data_deletion(p_reason text)` — usuário

```
SECURITY DEFINER, search_path=public
- v_uid := auth.uid(); se NULL => permission_denied (42501)
- bloquear se v_uid é Master Admin => RAISE 'MASTER_ADMIN_IMMUTABLE'
- se já existe pending do usuário => retorna { skipped:true, reason:'DELETION_ALREADY_REQUESTED' }
- INSERT pending, scheduled_for = now() + interval '30 days'  (servidor — Req 2.1, 2.2, 5.6)
- dispara email via pg_net.http_post -> send-account-deletion-email (Bearer edge_shared_secret)
    * sucesso => email_sent_at = now()
    * falha   => email_sent_at = NULL (não bloqueia — Req 3.3)
- REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated
- retorna { ok:true, id, scheduled_for }
```

### RPC `rpc_cancel_data_deletion(p_id, p_expected_updated_at)` — usuário

```
- valida dono (user_id = auth.uid())
- se completed => { skipped:true, reason:'ALREADY_COMPLETED' }  (Req 6.3)
- UPDATE status='cancelled' WHERE id=p_id AND updated_at=p_expected_updated_at
    GET DIAGNOSTICS => 0 linhas => STALE_VERSION
```

### RPC `rpc_execute_data_deletion(p_id, p_expected_updated_at)` — admin

```
- auth.uid() NULL => permission_denied
- NOT is_admin_with_permission('DATA_DELETION_MANAGE') =>
    grava DATA_DELETION_VIEW_DENIED (before=NULL) e RAISE permission_denied (Req 4.4)
- carrega request; se status='completed' => { skipped:true, reason:'ALREADY_COMPLETED' } (Req 2.6)
- se user_id é Master Admin => RAISE 'MASTER_ADMIN_IMMUTABLE' (Req 4.8)
- aplica Personal_Data_Scope:
    * apaga documents, motorista_references, device_tokens, push, mensagens com PII...
    * anonimiza linhas que precisam ser retidas (fretes encerrados): nome -> 'Usuário removido',
      cpf/cnpj/email/phone -> NULL/hash; (Req 2.5)
    * users: anonimiza PII e marca conta como removida
- UPDATE status='completed', completed_at=now() WHERE id=p_id AND updated_at=p_expected_updated_at
    0 linhas => STALE_VERSION
```

A camada TS (`services/admin/dataDeletion.ts`) chama esta RPC dentro de `executeAdminMutation` (audit-by-construction; falha de audit não bloqueia a operação principal — Req 4.5).

### Serviço TS (admin)

```ts
// services/admin/dataDeletion.ts
listDeletionRequests(filters): Promise<DeletionRequestRow[]>   // via RPC gated DATA_DELETION_VIEW
executeDeletion(id, expectedUpdatedAt): Promise<Result>        // executeAdminMutation -> rpc_execute_data_deletion
```

### Serviço TS (usuário)

```ts
// services/dataDeletion.ts
requestAccountDeletion(reason?): Promise<{ id; scheduledFor } | { skipped; reason }>
cancelAccountDeletion(id, expectedUpdatedAt): Promise<Result>
getMyDeletionRequest(): Promise<DeletionRequestRow | null>
```

### UI

- **Perfil (motorista/embarcador):** seção "Privacidade" com botão "Solicitar exclusão da minha conta e dados"; abre `AccountDeletionModal`. Se há pending, mostra status + prazo + botão cancelar.
- **`AccountDeletionModal`:** explica o Personal_Data_Scope e o prazo de 30 dias; botão "Confirmar exclusão" (destrutivo, vermelho) e "Cancelar".
- **Admin `/admin/exclusoes`:** `DeletionRequestsTable` (padrão admin compacto: filtros em popover, paginação 10/50/100, status badge, coluna prazo, indicador de email enviado). Ação "Executar exclusão" gated por `DATA_DELETION_MANAGE`; Stealth_404 sem `DATA_DELETION_VIEW`.

### Edge Function `send-account-deletion-email`

Reusa o padrão de `send-verification-email`: aceita Bearer `SUPABASE_SERVICE_ROLE_KEY` OU `EDGE_SHARED_SECRET`; envia via Resend; template informa data da solicitação, prazo (Scheduled_For) e escopo.

### Permissões (permissions.ts)

Adicionar ao enum `ADMIN_ACTIONS`: `DATA_DELETION_VIEW`, `DATA_DELETION_MANAGE`. Conceder a `SUPER_ADMIN` (wildcard) e `ADMIN`; negar aos demais por construção.

## Data Models

```ts
type DeletionStatus = 'pending' | 'cancelled' | 'completed';

interface DeletionRequestRow {
  id: string;
  userId: string;
  userName: string | null;
  status: DeletionStatus;
  requestedAt: string;
  scheduledFor: string;
  completedAt: string | null;
  emailSentAt: string | null;
  updatedAt: string;
}
```

## Error Handling

| Situação | Resultado |
|---|---|
| Não autenticado | `permission_denied` |
| Já existe pending | `{ skipped:true, reason:'DELETION_ALREADY_REQUESTED' }` |
| Admin sem `DATA_DELETION_MANAGE` | log `DATA_DELETION_VIEW_DENIED` + `permission_denied` (precedência) |
| Conflito entre admins | `STALE_VERSION` (toast "Outro admin atualizou. Recarregando.") |
| Execução sobre completed | `{ skipped:true, reason:'ALREADY_COMPLETED' }` |
| Master Admin alvo | `MASTER_ADMIN_IMMUTABLE` (bloqueado) |
| Falha de email | request mantida, `email_sent_at=NULL`, sinalizado no painel |

## Correctness Properties

### Property 1: Prazo de 30 dias definido pelo servidor
**Validates: Requirements 2.1, 2.2, 5.6**
Para toda Deletion_Request criada, `scheduled_for == requested_at + 30 dias`, ambos derivados do relógio do servidor.

### Property 2: No máximo uma solicitação pendente por usuário
**Validates: Requirements 1.6, 5.3**
Para qualquer sequência de pedidos do mesmo usuário, existe no máximo uma Deletion_Request `pending` (índice único parcial); pedidos extras retornam `DELETION_ALREADY_REQUESTED` sem criar linha.

### Property 3: permission_denied tem precedência
**Validates: Requirements 4.4**
Toda chamada de gestão admin sem `DATA_DELETION_MANAGE` retorna `permission_denied`, mesmo com erros de validação simultâneos.

### Property 4: Auditoria persistida em toda ação admin
**Validates: Requirements 4.5**
Toda execução de gestão produz um registro persistido em `admin_audit_logs`; falha de audit logging não bloqueia a operação principal.

### Property 5: Idempotência da execução
**Validates: Requirements 2.6, 6.3**
Executar a exclusão sobre uma request já `completed` retorna `_SKIPPED` sem reprocessar; cancelar uma `completed` também retorna `_SKIPPED`.

### Property 6: Email não bloqueia a solicitação
**Validates: Requirements 3.3, 3.5**
Para toda criação de Deletion_Request, a request persiste mesmo se o email falhar ou se não houver email do usuário; o estado do envio fica refletido em `email_sent_at`.

### Property 7: Master Admin imutável
**Validates: Requirements 4.8**
Nenhuma execução de exclusão conclui sobre o usuário Master Admin (`Nexus_Vortex99`); a operação é bloqueada antes de qualquer mutação de dados.

### Property 8: Versionamento otimista
**Validates: Requirements 4.6**
Duas ações admin concorrentes sobre a mesma Deletion_Request: no máximo uma sucede; a outra recebe `STALE_VERSION` sem alterar o registro.

## Testing Strategy

- **Unit/property (puro)**: cálculo de `scheduled_for` (+30d); máquina de estados (`pending→completed`, `pending→cancelled`, transições inválidas barradas); idempotência `_SKIPPED`.
- **RPC (integração, quando a infra de teste existir)**: criação impede duplicado pending; gestão sem permissão ⇒ `permission_denied`; execução sobre completed ⇒ `_SKIPPED`; Master Admin bloqueado; STALE_VERSION em conflito.
- **Email**: falha de email mantém request; `email_sent_at` reflete o resultado.
- **UI**: modal exige confirmação explícita; perfil mostra status pending; admin gated (Stealth_404 sem VIEW).

## Decisões e Trade-offs

1. **Agendar (30 dias), não apagar na hora.** Cumpre o prazo legal e dá janela de cancelamento ao usuário (Req 6). A execução pode ser manual (admin) e/ou por job agendado futuro.
2. **Anonimizar onde apagar quebraria retenção legal.** Fretes encerrados podem ter obrigação fiscal/contratual; anonimizar PII preserva o histórico mínimo sem expor o titular (Req 2.5).
3. **Reuso total dos padrões admin.** `executeAdminMutation`, RBAC, optimistic locking, `_SKIPPED`, Edge de email — zero reinvenção, consistente com o resto do painel.
4. **Índice único parcial** garante a invariante "uma pending por usuário" no nível do banco, não só na aplicação.
5. **Email via Edge + Vault/EDGE_SHARED_SECRET** reaproveita exatamente a infra que já funciona (Feature de verificação de email).
