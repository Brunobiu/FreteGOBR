# Ideia 13 — Assinatura Recorrente com Stripe (Motorista)

**Prioridade:** A definir (complementa Ideia 12 — Trial 30 dias)
**Status:** Aguardando execução

## Conceito

Após os 30 dias de trial grátis, o motorista precisa assinar um plano pago para continuar usando a plataforma. Pagamento recorrente via Stripe (cartão de crédito/débito ou PIX). Embarcador NÃO paga nada (por enquanto). Se atrasar 3 dias após vencimento, acesso bloqueado. Integração completa com painel admin para gerenciar assinaturas e cancelamentos.

## Planos e Preços

| Plano | Preço/mês | Cobrança | Total cobrado |
|-------|-----------|----------|---------------|
| Mensal | R$ 29/mês | Todo mês | R$ 29 |
| Trimestral | R$ 25/mês | A cada 3 meses (valor total) | R$ 75 |
| Semestral | R$ 19/mês | A cada 6 meses (valor total) | R$ 114 |

- Sempre cobra o valor total do período de uma vez (não parcela)
- Desconto progressivo: quanto mais meses, menor o valor mensal
- Renovação automática ao final do período

## Regras de Negócio (rascunho)

### Quem Paga
- **Motorista:** obrigatório após trial de 30 dias
- **Embarcador:** grátis (por enquanto — já deixar estrutura preparada para cobrar no futuro)
- **Admin:** sem cobrança (bypass total)

### Fluxo do Motorista

#### Primeiro acesso (trial):
1. Cria conta → trial de 30 dias começa
2. Contador visual no topo: "X dias restantes"
3. Nos últimos 5 dias: banner "Seu teste acaba em X dias. Escolha um plano."

#### Escolha de plano:
1. Página de planos com os 3 cards (Mensal / Trimestral / Semestral)
2. Destaque no plano trimestral (melhor custo-benefício)
3. Seleciona plano → vai para checkout Stripe
4. Métodos: cartão de crédito, cartão de débito, PIX
5. Após pagamento confirmado → acesso liberado, `is_subscribed = true`

#### Renovação:
- Stripe cobra automaticamente no vencimento
- Se pagamento falhar: 3 dias de grace period
- Após 3 dias sem pagamento: bloqueio total (mesma tela do trial expirado)
- Notificações: "Pagamento falhou, atualize seu método" (dia 1, 2, 3)

### Cartão Armazenado
- Obrigatório ter pelo menos 1 método de pagamento cadastrado (cartão principal)
- NÃO pode remover o último cartão (sempre precisa ter 1 fixo)
- Pode adicionar métodos extras (outros cartões)
- Pode trocar o cartão principal por outro
- Stripe armazena os dados do cartão (PCI compliant — nunca toca no nosso banco)

### Cancelamento
- Botão "Cancelar assinatura" na área de configurações do motorista
- Ao clicar: NÃO cancela imediatamente
- Envia solicitação para o painel admin (dashboard do Bruno)
- Admin vê a solicitação e decide: aprovar cancelamento ou entrar em contato
- Se aprovado: acesso continua até o fim do período pago, depois bloqueia
- Motivo do cancelamento: campo obrigatório (feedback)

### Anti-fraude / Cadastro Duplicado
- NÃO permitir cadastro com:
  - CPF já usado em outra conta
  - Telefone já usado em outra conta
  - E-mail já usado em outra conta
- Validação no momento do cadastro (antes de criar a conta)
- Evita que motorista crie conta nova para ganhar trial de novo
- Se tentar: mensagem "Este CPF/telefone/e-mail já está cadastrado"

### Painel Admin
- Ver todos os assinantes ativos
- Ver assinaturas vencidas / inadimplentes
- Ver solicitações de cancelamento pendentes
- Aprovar/rejeitar cancelamento
- Ver receita mensal (MRR)
- Estender trial manualmente (caso especial)
- Bloquear/desbloquear manualmente

## Modelo de Dados (rascunho)

### Alteração em `users`
- `trial_ends_at` timestamptz (já da Ideia 12)
- `is_subscribed` boolean DEFAULT false
- `subscription_plan` text CHECK ('mensal', 'trimestral', 'semestral') NULL
- `subscription_started_at` timestamptz NULL
- `subscription_ends_at` timestamptz NULL (fim do período pago atual)
- `stripe_customer_id` text NULL (ID do customer no Stripe)
- `subscription_status` text CHECK ('trial', 'active', 'past_due', 'canceled', 'blocked') DEFAULT 'trial'

### Tabela `subscription_events` (histórico)
- `id` uuid PK
- `user_id` uuid FK users
- `event_type` text ('created', 'renewed', 'payment_failed', 'canceled', 'reactivated')
- `plan` text
- `amount` numeric(10,2)
- `stripe_event_id` text (ID do webhook event)
- `created_at` timestamptz

### Tabela `cancellation_requests`
- `id` uuid PK
- `user_id` uuid FK users
- `reason` text NOT NULL
- `status` text CHECK ('pending', 'approved', 'rejected') DEFAULT 'pending'
- `requested_at` timestamptz
- `resolved_at` timestamptz NULL
- `resolved_by` uuid FK users (admin) NULL

## Dependências Técnicas

- **Stripe:** conta Stripe configurada, API keys, webhooks
- **Stripe Checkout:** para página de pagamento (hosted ou embedded)
- **Stripe Customer Portal:** para gerenciar métodos de pagamento
- **Webhooks:** endpoint para receber eventos do Stripe (payment_succeeded, payment_failed, subscription_canceled, etc.)
- **Edge Function ou API route:** para criar checkout session e processar webhooks
- **Ideia 12 (Trial):** base do trial + bloqueio

## Integração com Existente

- Ideia 12 (Trial 30 dias) — estende com pagamento real
- `ProtectedRoute.tsx` — check de subscription_status
- Painel admin — novo módulo "Assinaturas"
- Sistema de notificações — avisos de vencimento/falha
- Cadastro — validação de CPF/telefone/email únicos (pode já existir parcialmente)

## Notas para Implementação

- **Stripe Products:** criar 3 products/prices no Stripe Dashboard (mensal R$29, trimestral R$75, semestral R$114)
- **Webhook endpoint:** Edge Function `supabase/functions/stripe-webhook/index.ts`
  - Recebe eventos: `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`
  - Atualiza `subscription_status` no banco conforme evento
- **Checkout:** `stripe.checkout.sessions.create()` com `mode: 'subscription'`
- **PIX no Stripe:** Stripe suporta PIX para pagamentos únicos (não recorrente nativo). Para recorrente com PIX: gerar boleto/PIX a cada ciclo via webhook
- **Cartão obrigatório:** usar `setup_intent` do Stripe para salvar cartão sem cobrar imediatamente
- **Grace period 3 dias:** Stripe tem `days_until_due` configurável no subscription — usar isso
- **Cancelamento via admin:** NÃO usar `subscription.cancel()` direto — criar request no banco, admin aprova, aí sim cancela no Stripe
- **Segurança:** webhook deve validar assinatura Stripe (`stripe.webhooks.constructEvent`)
- **Ambiente:** usar Stripe test mode durante desenvolvimento (chaves `sk_test_*`)
- **Sem cobrar embarcador:** simplesmente não mostrar página de planos para embarcador (bypass no check de subscription)
