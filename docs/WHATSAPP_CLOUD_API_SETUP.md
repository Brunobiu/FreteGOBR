# Setup do canal de OTP por WhatsApp (Cloud API oficial)

Guia de configuração da verificação de cadastro por WhatsApp (spec
`auth-otp-whatsapp`, migration 125). Enquanto a Cloud API não estiver
configurada, o sistema opera **100% por e-mail** (fallback) — o cadastro
continua funcionando. Ao adicionar os segredos abaixo, o WhatsApp passa a ser o
canal primário **sem mudança de código**.

## Visão geral do fluxo

1. Cadastro chama a RPC `request_signup_otp(phone, email, force_email)`.
2. A RPC gera o código, grava o hash em `signup_otp_verifications` e dispara a
   Edge `send-signup-otp` (via `pg_net`).
3. A Edge tenta a **WhatsApp Cloud API** (template de autenticação). Em qualquer
   falha (sem credenciais, HTTP != 2xx, timeout) cai para **e-mail** (reusa a
   Edge `send-verification-email`/Resend) com o **mesmo** código.
4. `confirm_signup_otp(phone, code)` valida e emite o `verification_token`.
5. O cadastro consome o token em `consume_signup_otp_token`.

## Pré-requisitos na Meta (uma vez)

1. **Conta Meta Business verificada.** No Brasil exige documento de empresa
   (CNPJ). Um **MEI** (grátis, via gov.br) já serve para liberar limites.
   - Sem verificação: limite ~250 conversas iniciadas/dia (pode bastar no
     começo; o excedente vira falha de envio ⇒ fallback de e-mail).
2. **Número de telefone dedicado** para a Cloud API. **Não pode** ser um número
   em uso no app normal do WhatsApp.
3. **App WhatsApp** no Meta for Developers + **WhatsApp Business Account (WABA)**.
4. **Template de autenticação** aprovado (categoria *Authentication*), idioma
   `pt_BR`, com corpo contendo o código e (opcional) botão de copiar código.
5. **System User token** (permanente) com permissão de envio de mensagens.

## Segredos (Supabase → Edge Function `send-signup-otp`)

Configurar via `supabase secrets set` (ou painel) na função:

| Variável | Descrição |
| --- | --- |
| `WHATSAPP_CLOUD_TOKEN` | Token do System User (envio de mensagens). |
| `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | `phone_number_id` do número dedicado. |
| `WHATSAPP_CLOUD_TEMPLATE_NAME` | Nome do template de autenticação aprovado. |
| `WHATSAPP_CLOUD_TEMPLATE_LANG` | Idioma do template (default `pt_BR`). |
| `WHATSAPP_CLOUD_API_VERSION` | Versão da Graph API (default `v21.0`). |
| `WHATSAPP_CLOUD_TEMPLATE_BUTTON` | `url` (copy-code, default) ou `none`. |

Já existentes/necessários (compartilhados):

| Variável / segredo | Onde | Uso |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | auto-injetadas | auth + fallback e-mail + grava `sent_channel` |
| `EDGE_SHARED_SECRET` | env da Edge + Vault `edge_shared_secret` | a RPC autentica na Edge |
| `edge_url` | Vault | base URL das Edges (a RPC monta `/send-signup-otp`) |
| `RESEND_API_KEY`, `RESEND_FROM` | env de `send-verification-email` | canal de e-mail (fallback) |

> Sem `WHATSAPP_CLOUD_TOKEN`/`PHONE_NUMBER_ID`/`TEMPLATE_NAME`, a Edge pula o
> WhatsApp e usa o e-mail (degradação controlada).

## Deploy

```bash
# Edge (server-to-server; sem verify_jwt de browser — é chamada pela RPC):
supabase functions deploy send-signup-otp

# Migration 125 é aplicada no push (Supabase GitHub integration).
```

## Custos (referência)

- Cobrança **por mensagem entregue**, categoria *authentication* (faixa baixa
  no Brasil). OTP de cadastro é 1 mensagem por usuário novo ⇒ custo proporcional
  ao volume de cadastros. Sem custo fixo na Cloud API oficial (direto na Meta).
- O tier grátis de 1.000 conversas/mês é de **serviço**, NÃO cobre OTP.

## Verificação rápida (smoke)

1. Com os segredos setados, criar conta de teste informando um WhatsApp real.
2. Conferir o recebimento do código no WhatsApp.
3. Desligar/forçar erro (ex.: remover `WHATSAPP_CLOUD_TOKEN`) e confirmar que o
   código chega por **e-mail** (fallback) e o cadastro conclui.
4. Botão "Não recebi no WhatsApp — enviar por e-mail" deve reenviar por e-mail.
