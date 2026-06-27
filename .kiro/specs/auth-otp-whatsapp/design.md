# Design — Verificação de Cadastro por WhatsApp (Cloud API) com Fallback de E-mail

## Visão Geral

A verificação de cadastro deixa de depender só do e-mail e passa a usar um **canal de OTP
por telefone** entregue via **WhatsApp Cloud API oficial**, com **fallback para e-mail**.
A arquitetura reusa fielmente o padrão da migration 066 (RPCs `SECURITY DEFINER` sobre
tabela RLS deny-all, despacho assíncrono via `pg_net` para uma Edge Function) e adiciona:

1. Uma **Tabela_OTP** generalizada (`signup_otp_verifications`) com canal + alvo.
2. Três RPCs anônimas: `request_signup_otp`, `confirm_signup_otp`, `consume_signup_otp_token`.
3. Uma **Edge_Envio** (`send-signup-otp`) que orquestra WhatsApp → (fallback) e-mail.
4. Reuso da Edge `send-verification-email` (Resend) já existente, como canal de e-mail.
5. Ajustes de cadastro no front (`RegisterForm`, `auth.ts`) e do gate do embarcador.

O design garante **degradação controlada**: sem segredos da Cloud_API no Vault, tudo cai
no e-mail e o cadastro continua funcionando (Req 15).

## Decisão arquitetural central: fallback síncrono na Edge

O `pg_net.http_post` da RPC é **assíncrono** (fire-and-forget) — a RPC não sabe se o
WhatsApp falhou. Por isso o **fallback vive dentro da Edge_Envio**, que pode `await` a
resposta da Cloud_API e, em falha, chamar o e-mail no mesmo request. A RPC apenas dispara
a Edge_Envio uma vez; a Edge decide o `Canal_Efetivo` e o grava de volta na `Tabela_OTP`
(via service role) para observabilidade. O usuário nunca fica dependente de saber o canal
em tempo real — a UI mostra "enviamos seu código" e oferece o fallback manual (Req 3).

```
Cliente (RegisterForm)
   │  supabase.rpc('request_signup_otp', {phone,email,force_email})
   ▼
RPC request_signup_otp  (SECURITY DEFINER, anon)
   │  valida+normaliza phone, rate limit, gera código, grava hash
   │  net.http_post (assíncrono) ─────────────►  Edge_Envio (send-signup-otp)
   │                                                 │  force_email? → e-mail
   └─ retorna {ok:true}                              │  senão: Cloud API (await)
                                                     │     2xx → sent_channel=whatsapp
                                                     │     erro → Fallback_Email (await)
                                                     │              ok → sent_channel=email
                                                     └─ update signup_otp_verifications.sent_channel
```

## Componentes

| Papel | Arquivo |
| --- | --- |
| Tabela_OTP + RPCs + colunas | **NOVO** `supabase/migrations/125_auth_otp_whatsapp.sql` (+ `_rollback.sql`) |
| Edge_Envio (WhatsApp + fallback) | **NOVO** `supabase/functions/send-signup-otp/index.ts` |
| Cliente das RPCs | **NOVO** `src/services/signupOtp.ts` (espelha `signupVerification.ts`) |
| Normalização E.164 (puro) | **NOVO** `src/utils/phoneE164.ts` |
| Form de cadastro | `src/components/RegisterForm.tsx` (canal WhatsApp + remover nome empresa do embarcador) |
| Registro de conta | `src/services/auth.ts` (consumir token de telefone; phone_verified; embarcador sem company_name) |
| Canal de e-mail (reuso) | `supabase/functions/send-verification-email/index.ts` (sem mudança) |
| Gate do embarcador | `src/services/embarcador.ts` / política de fretes (aceitar Contato_Verificado) |
| Docs de configuração | **NOVO** `docs/WHATSAPP_CLOUD_API_SETUP.md` |

## Modelo de Dados (Migration 125)

```sql
CREATE TABLE IF NOT EXISTS public.signup_otp_verifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel            text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','email')),
  phone              text,                 -- Telefone_E164 (alvo primário)
  email              text,                 -- alvo do fallback
  code_hash          text NOT NULL,        -- sha256 base64 do código normalizado
  expires_at         timestamptz NOT NULL, -- now() + 10 min
  attempts           int  NOT NULL DEFAULT 0,
  consumed           boolean NOT NULL DEFAULT false,
  verified_at        timestamptz,
  verified_channel   text CHECK (verified_channel IN ('whatsapp','email')),
  verification_token uuid,
  token_expires_at   timestamptz,
  sent_channel       text CHECK (sent_channel IN ('whatsapp','email')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signup_otp_phone ON public.signup_otp_verifications (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_otp_token ON public.signup_otp_verifications (verification_token) WHERE verification_token IS NOT NULL;

ALTER TABLE public.signup_otp_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY signup_otp_no_access ON public.signup_otp_verifications FOR ALL USING (false) WITH CHECK (false);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
-- company_name passa a ser opcional (preenchido no perfil):
ALTER TABLE public.embarcadores ALTER COLUMN company_name DROP NOT NULL;  -- defensivo (IF aplicável)
```

`verified_channel` registra o canal que o usuário **confirmou** (telefone via WhatsApp ou
e-mail via fallback). É a base para marcar `users.phone_verified` ou `users.email_verified`
no cadastro.

## Cloud API: contrato de envio (Edge_Envio)

- Endpoint: `POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
- Header: `Authorization: Bearer {WHATSAPP_CLOUD_TOKEN}`
- Corpo (template de autenticação):

```jsonc
{
  "messaging_product": "whatsapp",
  "to": "5511987654321",
  "type": "template",
  "template": {
    "name": "{TEMPLATE_NAME}",          // ex.: codigo_verificacao
    "language": { "code": "pt_BR" },
    "components": [
      { "type": "body", "parameters": [ { "type": "text", "text": "123456" } ] },
      { "type": "button", "sub_type": "url", "index": "0",
        "parameters": [ { "type": "text", "text": "123456" } ] }   // copy-code (auth template)
    ]
  }
}
```

Segredos no Vault: `whatsapp_cloud_token`, `whatsapp_cloud_phone_number_id`,
`whatsapp_cloud_template_name`, `whatsapp_cloud_template_lang` (default `pt_BR`).
Ausência de qualquer um ⇒ `Canal_WhatsApp` indisponível ⇒ usa `Canal_Email` (Req 1.5/15.1).

> Observação importante de produto: a Cloud_API oficial exige número dedicado, verificação
> de negócio (CNPJ — MEI serve) e template de autenticação aprovado. Enquanto isso não
> existe, o sistema opera por e-mail (degradação controlada). Detalhes em
> `docs/WHATSAPP_CLOUD_API_SETUP.md`.

## Fluxo de Cadastro (após a mudança)

1. **Etapa 1 (dados):** motorista/embarcador informam nome, WhatsApp e e-mail (embarcador
   **sem** nome da empresa). Checagem de duplicidade/blacklist (mantida). `request_signup_otp(phone,email,false)`.
2. **Etapa 2 (código):** usuário digita 6 dígitos. `confirm_signup_otp(phone,code)`. Em `OK`
   guarda `{token, channel}`. Botões: "Reenviar código" (primário) e "Não recebi — enviar
   por e-mail" (`request_signup_otp(phone,email,true)`).
3. **Etapa 3 (senha):** define senha + aceita Termos. `register(...)` com `phoneVerificationToken`.
   `auth.ts` chama `consume_signup_otp_token(phone, token)`; em `ok`, cria a conta com
   `phone_verified`/`email_verified` conforme `channel`.

## Mudanças em `auth.ts` (register)

- Trocar a exigência de `emailVerificationToken` por `phoneVerificationToken` (o token agora
  vem do fluxo de telefone). E-mail continua coletado e usado como **identidade no Auth**
  (`signUp({ email, password })`) e para reset de senha.
- Consumir via `consume_signup_otp_token(phone, token)`. Em falha ⇒ `EMAIL_NOT_VERIFIED`
  (mantém o code de erro/uX; renomear mensagem para "Verificação expirada. Refaça.").
- Setar `users.phone_verified = (channel === 'whatsapp')`, `users.email_verified = (channel === 'email')`.
- Embarcador: inserir `embarcadores` **sem** `company_name` obrigatório (nulo/uppercase quando vier do perfil).
- Manter rollback compensatório e mapeamento de duplicidade/blacklist já existentes.

## Postura de Segurança

1. Tabela_OTP RLS deny-all; acesso só via RPC `SECURITY DEFINER` com `SET search_path`.
2. Código guardado só como hash SHA-256 base64; comparação por hash (nunca texto claro).
3. Segredos (Cloud_API, shared secret da Edge) só no Vault/env server-side; nunca no browser.
4. Edge_Envio valida `Authorization: Bearer` == service role OU shared secret (tempo constante).
5. Logs nunca contêm código, token, telefone completo ou segredos (mascarar últimos 4).
6. Anti-enumeração: alvo já cadastrado ⇒ `{ok:true}` sem envio; mensagem genérica em falhas.
7. Rate limit server-side por alvo (5/h).

## Correctness Properties

Estas propriedades guiam os property tests (`src/__tests__/` para lógica pura;
`tests/` para o que depende do Supabase). Naming `cp<N>_<nome>.property.test.ts`.

- **CP1 — Round-trip do código:** para todo código de 6 dígitos, `hash(normalizar(gerar))`
  é igual ao `hash` armazenado; inserir ruído (espaços/hífens) e normalizar não muda o hash.
- **CP2 — Normalização E.164 idempotente:** para todo telefone BR válido (com/sem `55`,
  com/sem 9º dígito), `e164(e164(x)) = e164(x)`; entradas inválidas ⇒ `null`/`invalid_phone`.
- **CP3 — Expiração:** após `expires_at`, `confirm_signup_otp` retorna `EXPIRED` e nunca
  emite `Token_Verificacao`.
- **CP4 — Tentativas:** após 5 tentativas inválidas, retorna `BLOCKED` e invalida o registro;
  nunca aceita um 6º palpite.
- **CP5 — Uso único do token:** `consume_signup_otp_token` retorna `ok:true` no máximo uma
  vez por token; chamadas subsequentes retornam `ok:false`.
- **CP6 — Binding do token ao alvo:** um `Token_Verificacao` só valida para o mesmo
  `Telefone_E164` que o gerou (não cruza alvos).
- **CP7 — Rate limit:** com ≥5 envios na janela de 1h, `request_signup_otp` retorna
  `rate_limited` e não cria novo registro.
- **CP8 — Anti-enumeração:** `request_signup_otp` para alvo já cadastrado retorna `{ok:true}`
  sem inserir registro nem enfileirar envio.
- **CP9 — Fallback determinístico:** dado um resultado de envio WhatsApp = falha, o
  `Canal_Efetivo` resultante é `email` quando há e-mail válido; com WhatsApp = sucesso, é
  `whatsapp`; o **mesmo** código é usado nos dois canais (função pura de decisão de canal).
- **CP10 — Sem segredos em logs:** para qualquer entrada, o logger estruturado da Edge não
  emite código, token, telefone completo nem segredos (`expectNoSecrets`).

## Estratégia de Testes (governança)

- **Unit/property (`src/__tests__/auth/otp/`):** `phoneE164` (CP2), normalização/round-trip
  de código (CP1), função pura de decisão de canal/fallback (CP9), masking de logs (CP10),
  binding lógico de token (CP6, nível de função pura quando aplicável).
- **Integração (`tests/auth/otp/`, branch Supabase efêmero):** CP3, CP4, CP5, CP7, CP8 nas
  RPCs reais; deny-all RLS; consumo único do token; ajuste do gate do embarcador.
- **Cenários de falha:** WhatsApp 4xx/5xx/timeout → fallback; sem segredos → e-mail; token
  expirado/reusado; telefone inválido; rate limit; alvo duplicado.
- **Validações:** front (formato de telefone/e-mail, confirmação de e-mail) E back (RPCs).
- **Regression_Suite:** incorporar os novos testes; `signup_otp_verifications` e `phoneE164`
  entram como Critical_Modules em `tests/coverage.config.ts`.

## Riscos e Mitigações

- **Entrega assíncrona do WhatsApp:** não-entrega real não dá erro na hora ⇒ fallback manual
  (Req 3) cobre isso.
- **Ban/limite Meta:** limite de tier sem verificação ⇒ tratado como falha ⇒ fallback e-mail.
- **E-mail não verificado (quando verifica por WhatsApp):** reset de senha por e-mail pode ir
  a um e-mail não confirmado; mitigação: verificação de e-mail opcional no perfil + login sem
  senha (spec seguinte) como rota de recuperação.
- **Quebra do embarcador-onboarding:** mudança do gate para `Contato_Verificado` deve ser
  coordenada e testada para não bloquear quem já tinha `email_verified`.
