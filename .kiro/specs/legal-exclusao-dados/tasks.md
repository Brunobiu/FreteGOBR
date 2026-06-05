# Implementation Plan

> Feature 4 — Exclusão de Dados pelo Usuário (FreteGO)

## Overview

Plano incremental para o fluxo LGPD de exclusão de conta/dados: tabela com RLS, RPCs SECURITY DEFINER (criar/cancelar/executar), Edge Function de email, permissões RBAC, UI de perfil (modal + status) e painel admin. Reusa `executeAdminMutation`, optimistic locking, idempotência `_SKIPPED` e proteção do Master Admin.

## Task Dependency Graph

```
1 (migration tabela+RLS+índice) ──> 2 (permissões RBAC)
1 ──> 3 (RPC request) ──> 4 (RPC cancel)
1 ──> 5 (RPC execute, gated)
3 ──> 6 (Edge email) 
2,5 ─> 7 (serviço admin)
3,4 ─> 8 (serviço usuário)
8 ──> 9 (UI perfil: modal + status)
7 ──> 10 (painel admin + rota + sidebar)
todas ─> 11 (testes + validação)
```

```json
{
  "waves": [
    { "wave": 1, "tasks": [1], "description": "Migration: tabela, RLS, índice único parcial (base)." },
    { "wave": 2, "tasks": [2, 3, 5, 6], "description": "Permissões, RPCs request/execute e Edge de email." },
    { "wave": 3, "tasks": [4, 7, 8], "description": "RPC cancel e serviços TS (admin + usuário)." },
    { "wave": 4, "tasks": [9, 10], "description": "UI de perfil e painel admin." },
    { "wave": 5, "tasks": [11], "description": "Testes e validação final." }
  ]
}
```

## Tasks

- [ ] 1. Migration: tabela `data_deletion_requests` + RLS + índice
  - Criar migration idempotente (`DO $check$` defensivo) com a tabela (id, user_id, status CHECK, requested_at, scheduled_for, completed_at, email_sent_at, reason, updated_at), RLS (SELECT próprio por `user_id = auth.uid()`), e índice único parcial `WHERE status='pending'`. Par `_rollback.sql` documentado. Próxima numeração livre do repo.
  - _Requirements: 5.1, 5.2, 5.5_

- [ ] 2. Adicionar permissões RBAC de exclusão
  - Em `services/admin/permissions.ts`: adicionar `DATA_DELETION_VIEW` e `DATA_DELETION_MANAGE` ao enum; conceder a SUPER_ADMIN (wildcard) e ADMIN; negar aos demais por construção. Espelhar em `is_admin_with_permission` (SQL) se necessário.
  - _Requirements: 4.4, 5.4_

- [ ] 3. RPC `rpc_request_data_deletion` (usuário)
  - SECURITY DEFINER, search_path=public: valida `auth.uid()`; bloqueia Master Admin; se já há pending ⇒ `{skipped, reason:'DELETION_ALREADY_REQUESTED'}`; INSERT pending com `scheduled_for = now()+30d` (servidor); dispara email via `pg_net.http_post` para a Edge (Bearer edge_shared_secret), setando `email_sent_at` conforme resultado. REVOKE/GRANT.
  - _Requirements: 1.5, 1.6, 2.1, 2.2, 3.1, 5.3, 5.6_

- [ ] 4. RPC `rpc_cancel_data_deletion` (usuário)
  - Valida dono; `completed` ⇒ `{skipped, reason:'ALREADY_COMPLETED'}`; UPDATE para `cancelled` com versionamento otimista (`updated_at = p_expected_updated_at`, 0 linhas ⇒ STALE_VERSION). Permite nova solicitação após cancelado.
  - _Requirements: 6.2, 6.3, 6.4_

- [ ] 5. RPC `rpc_execute_data_deletion` (admin, gated)
  - Exige `DATA_DELETION_MANAGE` (log negativo `DATA_DELETION_VIEW_DENIED` + permission_denied se negado); bloqueia Master Admin; `completed` ⇒ `_SKIPPED`; aplica Personal_Data_Scope (apaga documents/refs/tokens/PII; anonimiza fretes encerrados); UPDATE `completed` + `completed_at` com optimistic locking.
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 4.3, 4.8_

- [ ] 6. Edge Function `send-account-deletion-email`
  - Reusar padrão `send-verification-email`: aceita Bearer SUPABASE_SERVICE_ROLE_KEY OU EDGE_SHARED_SECRET; envia via Resend; template com data da solicitação, prazo (scheduled_for) e escopo. Deploy com verify_jwt=false.
  - _Requirements: 3.1, 3.2, 3.4_

- [ ] 7. Serviço admin `services/admin/dataDeletion.ts`
  - `listDeletionRequests(filters)` via RPC gated `DATA_DELETION_VIEW`; `executeDeletion(id, expectedUpdatedAt)` dentro de `executeAdminMutation` (audit-by-construction). Mapear erros (permission_denied, STALE_VERSION, _SKIPPED, MASTER_ADMIN_IMMUTABLE).
  - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.7_

- [ ] 8. Serviço usuário `services/dataDeletion.ts`
  - `requestAccountDeletion(reason?)`, `cancelAccountDeletion(id, expectedUpdatedAt)`, `getMyDeletionRequest()`. Tratar `DELETION_ALREADY_REQUESTED` e `_SKIPPED` como estados neutros (não erro).
  - _Requirements: 1.5, 6.1, 6.2_

- [ ] 9. UI no perfil (motorista e embarcador)
  - Seção "Privacidade" com botão "Solicitar exclusão da minha conta e dados" → `AccountDeletionModal` (explica escopo + prazo 30 dias; confirmação explícita destrutiva; cancelar não cria nada). Se há pending: mostra status + scheduled_for + botão cancelar.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1_

- [ ] 10. Painel admin `/admin/exclusoes`
  - `DeletionRequestsTable` (padrão admin compacto: filtros em popover, paginação 10/50/100, badge de status, coluna prazo, indicador de email enviado); ação "Executar exclusão" gated por `DATA_DELETION_MANAGE`; Stealth_404 sem `DATA_DELETION_VIEW`. Adicionar rota + item na AdminSidebar.
  - _Requirements: 4.1, 4.2, 4.3, 4.7_

- [ ] 11. Testes e validação final
  - Property/unit puros: `scheduled_for = requested_at + 30d` (Property 1); máquina de estados; idempotência `_SKIPPED` (Property 5); precedência permission_denied (Property 3).
  - Integração (quando infra existir): uma pending por usuário (Property 2); auditoria persistida (Property 4); Master Admin bloqueado (Property 7); STALE_VERSION (Property 8); email não bloqueia (Property 6).
  - Rodar `npx tsc --noEmit`, `npm run test:run`, `npm run build`; confirmar verde.
  - _Requirements: 2.1, 2.6, 4.4, 4.5, 4.8_

## Notes

- Timestamps (`requested_at`, `scheduled_for`) SEMPRE no servidor (Req 5.6).
- Anonimizar em vez de apagar onde houver retenção legal (fretes encerrados) — Req 2.5.
- Master Admin (`Nexus_Vortex99`) imutável: exclusão bloqueada antes de qualquer mutação.
- Falha de email NÃO bloqueia a solicitação; `email_sent_at` reflete o estado.
- Integra com Feature 1 (escopo de dados alinhado à Política de Privacidade).
