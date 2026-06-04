# Notifications_Hub — Variáveis de ambiente

## Edge Function `send-public-ticket-reply`

Configurar no Supabase Dashboard → Edge Functions → `send-public-ticket-reply` → Environment.

| Variável | Descrição | Valor sugerido |
|----------|-----------|----------------|
| `EMAIL_PROVIDER` | Provider de email a usar. | `log` (dev), `resend` ou `sendgrid` (prod) |
| `EMAIL_PROVIDER_API_KEY` | API key do provider escolhido. | obtida no painel do provider |
| `EMAIL_FROM_ADDRESS` | Email do remetente. | `suporte@fretegobr.com.br` |
| `EMAIL_FROM_NAME` | Nome de exibição. | `FreteGO Suporte` |
| `PUBLIC_TICKET_DEV_LOG` | Se `true`, apenas loga em vez de enviar (dev). | `true` em dev, ausente em prod |
| `SUPABASE_URL` | URL do projeto (auto-injetado pelo Supabase). | — |
| `SUPABASE_ANON_KEY` | Anon key (auto-injetado pelo Supabase). | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (auto-injetado pelo Supabase). | — |

### Modo dev (sem provider)

```
EMAIL_PROVIDER=log
PUBLIC_TICKET_DEV_LOG=true
```

A função apenas loga `console.log` o destino e o tamanho do HTML, retornando
`{ ok: true, message_id: 'dev-...' }`. Útil para testar o fluxo sem enviar
emails reais.

### Modo Resend (recomendado)

```
EMAIL_PROVIDER=resend
EMAIL_PROVIDER_API_KEY=re_xxx...
EMAIL_FROM_ADDRESS=suporte@fretegobr.com.br
EMAIL_FROM_NAME=FreteGO Suporte
```

1. Criar conta em [resend.com](https://resend.com).
2. Verificar domínio `fretegobr.com.br` (DNS records — DKIM, SPF, DMARC; ver `docs/RESEND_DNS_SETUP.md`).
3. Gerar API key e colar em `EMAIL_PROVIDER_API_KEY`.

### Modo SendGrid

```
EMAIL_PROVIDER=sendgrid
EMAIL_PROVIDER_API_KEY=SG.xxx...
EMAIL_FROM_ADDRESS=suporte@fretegobr.com.br
EMAIL_FROM_NAME=FreteGO Suporte
```

1. Criar conta em [sendgrid.com](https://sendgrid.com).
2. Verificar Sender Identity (single sender ou domain authentication).
3. Gerar API key (escopo Mail Send).

## Deploy

```bash
supabase functions deploy send-public-ticket-reply
```

Por padrão, deploy com `verify_jwt: true` (default do Supabase). A função
aceita:
- JWT do admin autenticado (browser via `supabase.functions.invoke`).
- `Authorization: Bearer <SERVICE_ROLE_KEY>` (chamadas internas via
  `pg_net.http_post` em RPCs SECURITY DEFINER, caso seja necessário no
  futuro).

A função verifica que o caller tem permissão `SUPORTE_REPLY` antes de
disparar o email. Sem permissão, retorna 401.

## Smoke test manual

```bash
# Logar como admin no app, abrir DevTools → Console:
const { data } = await supabase.functions.invoke('send-public-ticket-reply', {
  body: {
    ticket_id: 'uuid-de-teste',
    guest_name: 'Visitante Teste',
    guest_email: 'seu-email@gmail.com',
    subject: 'Teste',
    body: 'Mensagem de teste\nLinha 2',
    admin_name: 'Admin Teste',
  },
});
console.log(data);
```

Esperado em modo `log`: `{ ok: true, message_id: 'dev-...' }` + linha no
console da Edge Function.

Esperado em modo `resend`/`sendgrid`: email recebido em `seu-email@gmail.com`.
