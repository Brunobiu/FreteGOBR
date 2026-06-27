# Passo a passo — colocar no ar: WhatsApp OTP + Login sem senha + Biometria

Ordem segura de ativação das specs `auth-otp-whatsapp`, `login-sem-senha` e
`biometria-app`. Siga na ordem. O cadastro/login **já funciona por e-mail**
mesmo sem a Cloud API — o WhatsApp é um upgrade opcional (passo 5).

## 0. Antes de começar (o que NÃO precisa)

- Nenhuma variável nova no frontend (Vercel) — usa o cliente Supabase atual.
- E-mail (Resend) e o `EDGE_SHARED_SECRET` já estão configurados (o
  `send-verification-email` já usa). Então o fallback de e-mail funciona de cara.
- Nenhuma config nova de Auth URL (o login sem senha usa `verifyOtp` por
  token_hash, não link clicável).

## 1. Deploy das Edge Functions (FAZER PRIMEIRO)

⚠️ Crítico: a `send-signup-otp` é quem envia o código (WhatsApp + fallback de
e-mail). Se ela não estiver no ar, o cadastro não envia nada.

Se a sua integração Supabase↔GitHub já faz deploy de functions no push, o passo
2 cobre. **Na dúvida, faça manual** (garantido):

```bash
# uma vez, se não tiver a CLI:
npm i -g supabase
supabase login
supabase link --project-ref kvdwmgchtpdnllxwswtf

# deploy das 2 functions novas:
supabase functions deploy send-signup-otp
supabase functions deploy login-otp-verify --no-verify-jwt
```

> `--no-verify-jwt` só na `login-otp-verify` (é chamada por quem ainda não está
> logado). A `send-signup-otp` é server-to-server (a RPC autentica por Bearer).

## 2. Commit + push (aplica migrations 125/126 + publica o frontend)

```bash
git add -A
git commit -m "feat(auth): cadastro por WhatsApp OTP, login sem senha e biometria"
git push origin main
```

Isso dispara:
- Supabase aplica `125_auth_otp_whatsapp.sql` e `126_login_otp.sql` (idempotentes).
- Vercel publica o frontend novo (~2 min).

## 3. Testar (fluxo por e-mail — já deve funcionar)

1. Abrir o app publicado e criar uma conta nova (motorista ou embarcador).
2. Como o WhatsApp ainda não está configurado, o código chega **por e-mail**
   (fallback automático). Concluir cadastro → senha → login.
3. Testar **"Entrar sem senha"**: informar e-mail → receber código por e-mail →
   entrar.

Se o código não chegar nem por e-mail: a Edge `send-signup-otp` provavelmente
não subiu — refazer o passo 1 (deploy manual).

## 4. Verificação rápida no banco (opcional)

```sql
-- as RPCs existem?
select proname from pg_proc where proname in
  ('request_signup_otp','confirm_signup_otp','consume_signup_otp_token',
   'request_login_otp','verify_login_otp','normalize_phone_e164');
-- a coluna nova existe?
select column_name from information_schema.columns
  where table_name='users' and column_name='phone_verified';
```

## 5. Ligar o WhatsApp oficial (quando quiser — opcional)

Detalhes em `docs/WHATSAPP_CLOUD_API_SETUP.md`. Resumo:
1. Conta Meta Business verificada (CNPJ; MEI serve) + número dedicado + template
   de autenticação aprovado (pt_BR).
2. Setar os segredos nas functions:
   ```bash
   supabase secrets set WHATSAPP_CLOUD_TOKEN=... \
     WHATSAPP_CLOUD_PHONE_NUMBER_ID=... \
     WHATSAPP_CLOUD_TEMPLATE_NAME=... \
     WHATSAPP_CLOUD_TEMPLATE_LANG=pt_BR
   ```
3. Pronto — o WhatsApp vira o canal primário automaticamente (e-mail continua
   como fallback). Sem redeploy de código.

## 6. Biometria no app (fase à parte — exige rebuild nativo)

Detalhes em `docs/BIOMETRIA_APP_BUILD.md`. Resumo: instalar o plugin
(`capacitor-native-biometric` ou fork p/ Capacitor 8), `npx cap sync`, rebuild
do APK/IPA e reenviar às lojas. As permissões nativas já foram adicionadas.

## 7. Se algo der errado (rollback)

- As migrations têm par `_rollback.sql` documentado (não auto-aplicado).
- O frontend: reverter o commit e `git push` volta a versão anterior.
- Como o fallback de e-mail está sempre ativo, o pior caso (WhatsApp mal
  configurado) não derruba o cadastro — ele usa e-mail.
