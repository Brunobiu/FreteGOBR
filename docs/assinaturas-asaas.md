# Assinaturas e Pagamento (Asaas) — Documentação técnica

Feature de cobrança de mensalidade dos motoristas via gateway **Asaas**.
Spec completa em `.kiro/specs/assinaturas-pagamento/`.

> Escopo atual: cobra **somente motorista**. Embarcador é grátis. A estrutura
> de "Empresa" (`companies` / `company_embarcadores`) está reservada no banco,
> mas fora de escopo.

## Visão geral do fluxo

```
Motorista (app)                Edge Functions                 Asaas            Banco
   │  contrata plano  ─────────►  asaas-create-subscription ──► cria cobrança
   │                              (JWT do motorista)            (PIX/boleto/cartão)
   │  ◄── checkout (QR/boleto) ──                               └─► devolve IDs
   │                                                                 │
   │  paga (PIX/boleto/cartão)  ───────────────────────────────────►│
   │                                                                 ▼
   │                              asaas-webhook  ◄──── webhook ─── evento
   │                              (valida token, idempotente)        de pagamento
   │                                   │
   │                                   ├─► subscription_mark_paid / mark_past_due
   │                                   └─► notifications (plan_*) ─► push
   │
   └─ Billing_Notifier (pg_cron diário): avisa trial vencendo + suspende grace esgotado
```

## Planos

Definidos em `src/utils/subscriptionPlans.ts` (núcleo puro, espelhado em testes):

| Plano | Preço/mês | Meses | Total | Destaque |
|-------|-----------|-------|-------|----------|
| Mensal | R$ 39,90 | 1 | R$ 39,90 | — |
| Trimestral | R$ 34,90 | 3 | R$ 104,70 | — |
| Semestral | R$ 29,90 | 6 | R$ 179,40 | ✅ |

## Máquina de estados de acesso

Núcleo puro em `src/utils/trialStatus.ts` (`computeAccessState`, `canViewFeed`,
`canInteract`), espelhado no servidor por `motorista_can_interact(uuid)`.

```
trial ──paga──► active ──falha cobrança──► past_due ──5 dias sem pagar──► suspended
  │                                            │  paga (no grace)              │
  └─ trial vence sem pagar ──► suspended ◄──── ┘                              paga
                                                                               ▼
qualquer ──cancela──► canceled                                              active
```

- **trial / active / past_due (no grace)**: vê o feed **e** interage.
- **suspended / canceled**: vê o feed mas **não interage** (curtir bloqueado
  com aviso pt-BR + CTA para `/motorista/plano`).
- Embarcador/Admin: nunca suspensos.

Mapeamento `subscriptions.status` (detalhe) ↔ `users.subscription_status`
(fonte de verdade do app):

| subscriptions.status | users.subscription_status | is_subscribed |
|----------------------|---------------------------|---------------|
| active | active | true |
| past_due | past_due | false |
| suspended | **blocked** | false |
| canceled | canceled | false |

## Cartão recorrente — onde o cartão fica?

**O número do cartão NÃO é persistido no FreteGO** (política PCI — ver
`asaas-create-subscription`: "não persistir número de cartão"). A tabela
`subscriptions` guarda apenas referências: `asaas_customer_id` e
`asaas_subscription_id`. A tokenização e a cobrança recorrente são
responsabilidade do Asaas; o app só recebe os webhooks de cada cobrança.

> Hoje o cartão aparece como "em breve" na UI; o motorista usa PIX/boleto. A
> estrutura de IDs já está pronta para ligar a tokenização de cartão depois.

## Edge Functions

### `asaas-create-subscription` (verify_jwt: ON)

Exige JWT do motorista. Cria/recupera o customer no Asaas, gera a cobrança
(PIX/boleto único ou assinatura recorrente para cartão), persiste
`subscriptions` + `subscription_charges(pending)` via service-role e devolve os
dados de checkout. API key via secret (nunca no client).

### `asaas-webhook` (verify_jwt: OFF — valida token interno)

1. Valida header `asaas-access-token` == `ASAAS_WEBHOOK_TOKEN` → 401 em falha.
2. Idempotência: `INSERT` em `asaas_webhook_events` (`asaas_event_id` UNIQUE);
   evento duplicado ⇒ 200 sem efeito.
3. Mapeia evento → ação (`src/utils/asaasWebhook.ts`):
   - `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` → `subscription_mark_paid` +
     notificação `plan_charged`.
   - `PAYMENT_OVERDUE` (e afins) → `subscription_mark_past_due` (grace 5d) +
     notificação `plan_payment_failed`.
4. Suspensão (grace esgotado) é decidida pelo **cron**, não pelo webhook.

> O Asaas NÃO deve enviar cobranças/mensagens próprias — quem comunica é o
> nosso sistema (notificações + push). Configurar no painel Asaas com
> notificações desligadas.

## Variáveis de ambiente (Supabase → Edge Functions → Secrets)

| Variável | Descrição | Sandbox | Produção |
|----------|-----------|---------|----------|
| `ASAAS_API_KEY` | API key da conta Asaas. | `$aact_hmlg_...` | `$aact_prod_...` |
| `ASAAS_BASE_URL` | Base da API. | `https://sandbox.asaas.com/api/v3` | `https://api.asaas.com/v3` |
| `ASAAS_WEBHOOK_TOKEN` | Token compartilhado validado no webhook. | string aleatória | string aleatória |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Auto-injetados pelo Supabase. | — | — |

> Os valores reais ficam em `Credencial/asaas.txt` (gitignored). **Nunca**
> commitar nem expor no client.

### Migração sandbox → produção

1. Trocar `ASAAS_API_KEY` pela chave de produção e `ASAAS_BASE_URL` para
   `https://api.asaas.com/v3`.
2. Reconfigurar o webhook no painel Asaas de produção apontando para a URL da
   Edge `asaas-webhook`, com o mesmo `ASAAS_WEBHOOK_TOKEN`.
3. Conferir que as notificações automáticas do Asaas estão **desligadas**.

## Billing_Notifier (pg_cron diário)

Função SQL `run_billing_notifications()` (migration 059), agendada como
`billing_notifier_job` 1x/dia (12:00 UTC ≈ 09:00 BRT). Faz:

1. **Aviso de trial vencendo**: motoristas com `trial_ends_at` na janela
   `[now+1d, now+2d]` e `is_subscribed=false` recebem `plan_trial_expiring`.
   Idempotente via índice único parcial `uq_notifications_user_plan_unread`
   (`ON CONFLICT DO NOTHING`) — no máximo 1 não-lida por (user, type).
2. **Suspensão por grace esgotado**: assinaturas `past_due` com
   `grace_ends_at < now` viram `suspended` (via `subscription_suspend`).

> Notificações de falha/cobrança/reativação são disparadas pelo **webhook**,
> não pelo cron. O push de cada notificação é disparado pelo trigger
> `trg_notifications_dispatch_push` (042) em cada INSERT.

Segurança: `run_billing_notifications()` é SECURITY DEFINER e muta estado;
`EXECUTE` foi revogado de `anon`/`authenticated` (só o owner/cron executa).

Execução manual (smoke test, como owner):

```sql
SELECT public.run_billing_notifications();
-- → { ok, trial_notified, suspended, ran_at }
```

## Notificações ao usuário (tipos `plan_*`)

Todas caem na aba **"Atividades"** do `NotificationsModal` (sino) por fallback
de prefixo, contam como não-lidas e disparam push. `link = /motorista/plano`.

| type | Quando | Origem |
|------|--------|--------|
| `plan_trial_expiring` | Trial acaba em 1-2 dias | Billing_Notifier (cron) |
| `plan_payment_failed` | Cobrança vencida/falhou | Webhook |
| `plan_charged` | Pagamento confirmado | Webhook |
| `plan_reactivated` | Assinatura reativada | Webhook |

## Painel admin — Assinaturas

Rota `/admin/assinaturas` (gating `FINANCEIRO_VIEW`). RPC
`admin_list_subscriptions` (migration 060) com grupos **A vencer** / **Pagas** /
**Inadimplentes** (`past_due`+`suspended`), busca, paginação 10/50/100. Acesso
sem permissão ⇒ Stealth_404 + audit `SUBSCRIPTION_VIEW_DENIED`.

O módulo **Financeiro** (comissão, migration 037) foi **ocultado da sidebar** —
rota e código permanecem intactos.

## Migrations da feature

| Migration | Conteúdo |
|-----------|----------|
| 055 | Tabelas `subscriptions`, `subscription_charges`, `asaas_webhook_events`, `companies`/`company_embarcadores` (reservadas); `motorista_can_interact`; ajuste RLS de fretes |
| 056 | Anti-fraude (duplicate block) + admin trial (`admin_list_trial_motoristas`, `admin_extend_trial`) |
| 057 | RPCs de transição (`subscription_mark_paid/past_due/suspend/reactivate`, `list_my_charges`, `cancel_my_subscription`) |
| 058 | Fix `motorista_can_interact` (blocked/canceled negam interação) |
| 059 | Billing_Notifier (`run_billing_notifications` + pg_cron) |
| 060 | Painel admin (`admin_list_subscriptions`) |

Cada migration tem par `_rollback.sql` documentado (não auto-aplicado).

## iOS / App Store

Cobrança de bens digitais no iOS pode exigir In-App Purchase (regra da Apple).
O fluxo atual (PIX/boleto/cartão direto) funciona no Android e na web; para a
publicação na App Store, avaliar um fluxo IAP separado na build iOS. Não
bloqueia o lançamento web/Android.
