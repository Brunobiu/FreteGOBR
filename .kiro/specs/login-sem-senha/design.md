# Design — Login sem Senha (código por WhatsApp ou E-mail)

## Visão Geral

O login sem senha verifica a posse do `Identificador` (telefone ou e-mail) por um código de
6 dígitos e, em seguida, **emite uma sessão real do Supabase** sem usar senha. A peça central
é como criar a `Sessao_Supabase` depois de validar **nosso próprio** código — resolvido com o
padrão oficial `auth.admin.generateLink({ type:'magiclink' })` → `verifyOtp({ token_hash })`.

Reusa integralmente o **canal de OTP** (WhatsApp Cloud API + fallback de e-mail) e a util
`phoneE164` entregues pela spec `auth-otp-whatsapp`. Esta spec **depende** dela.

## Decisão arquitetural central: emitir sessão sem senha

O Supabase não loga um usuário "por código próprio" diretamente. Fluxo adotado:

```
Tela_Login (modo sem senha)
   │ 1) request_login_otp(identifier)         (RPC SECURITY DEFINER, anon)
   │      resolve user, gera código, dispara Canal_OTP (reuso da Edge send-signup-otp)
   ▼
(usuário recebe o código por WhatsApp/e-mail)
   │ 2) supabase.functions.invoke('login-otp-verify', { identifier, code })
   ▼
Edge_Sessao login-otp-verify (anon, verify_jwt=false, service role interno)
   │  a) verify_login_otp(identifier, code)   (RPC SECURITY DEFINER) → {status, email}
   │  b) se OK: admin.generateLink({type:'magiclink', email}) → hashed_token
   │  c) retorna { ok:true, token_hash }
   ▼
Cliente: supabase.auth.verifyOtp({ token_hash, type:'email' })  → Sessao_Supabase
   │  saveAuthData(...) e redireciona por user_type
```

Por que `generateLink`/`verifyOtp` (e não retornar tokens direto): mantém o ciclo de sessão
do Supabase íntegro (refresh, expiração, rotação) e nunca expõe service role ao cliente. O
`token_hash` é de uso único e curtíssima vida; a validação do **nosso** código é pré-requisito.

## Componentes

| Papel | Arquivo |
| --- | --- |
| Tabela_Login_OTP + RPCs | **NOVO** `supabase/migrations/126_login_otp.sql` (+ `_rollback.sql`) |
| Edge_Sessao | **NOVO** `supabase/functions/login-otp-verify/index.ts` |
| Cliente do login sem senha | **NOVO** `src/services/passwordlessLogin.ts` |
| UI | `src/components/LoginForm.tsx` (opção "Entrar sem senha" + etapa de código) |
| Integração de sessão | `src/hooks/useAuth.tsx` (novo método `loginWithSession(tokens)` ou reuso de `saveAuthData`) |
| Canal de envio (reuso) | `supabase/functions/send-signup-otp/index.ts` (da spec auth-otp-whatsapp) |
| Normalização/validação (reuso) | `src/utils/phoneE164.ts`, validação de e-mail existente |

## Modelo de Dados (Migration 126)

```sql
CREATE TABLE IF NOT EXISTS public.login_otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('whatsapp','email')),
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  consumed    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_otp_user ON public.login_otp_codes (user_id, consumed, created_at DESC);
ALTER TABLE public.login_otp_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY login_otp_no_access ON public.login_otp_codes FOR ALL USING (false) WITH CHECK (false);
```

## RPCs (SECURITY DEFINER, search_path = public, extensions)

- `request_login_otp(p_identifier text) → jsonb`
  - Resolve usuário (e-mail direto, ou telefone via `resolve_login_email` + `users` por phone).
  - Anti-enumeração: conta inexistente ⇒ `{ok:true}` sem envio.
  - Rate limit 5/h por usuário. Gera código, hash, invalida pendentes, `net.http_post` p/ a
    Edge de envio (mesma `send-signup-otp`, passando `phone`/`email` conforme o canal).
- `verify_login_otp(p_identifier text, p_code text) → jsonb`
  - Localiza o código não consumido mais recente do usuário; trata EXPIRED/BLOCKED/INVALID/OK
    por hash, incrementa `attempts`. Em OK, marca `consumed = true` e retorna `{status:'OK', email}`.
  - Recusa quando `users.is_active = false` (mesma semântica do login por senha).
- `GRANT EXECUTE ... TO anon, authenticated; REVOKE ALL FROM PUBLIC`.

## Edge_Sessao `login-otp-verify`

- `verify_jwt = false` (anon pode chamar); usa **service role** internamente.
- Passos: (a) `verify_login_otp` → status/email; (b) se OK, `supabase.auth.admin.generateLink({type:'magiclink', email})`; (c) extrai `properties.hashed_token`; (d) retorna `{ok:true, token_hash}`.
- Erros neutros (sem revelar conta). Sem segredos em log. Trata corpo externo como não confiável.
- Anti-timing: garante tempo mínimo de resposta (espelha `ensureMinResponseTime` do `auth.ts`).

## Integração no Cliente

- `src/services/passwordlessLogin.ts`:
  - `requestLoginCode(identifier)` → `supabase.rpc('request_login_otp', ...)`.
  - `verifyLoginCode(identifier, code)` → `functions.invoke('login-otp-verify')` → `verifyOtp({token_hash})` → retorna `User`/sessão.
- `LoginForm.tsx`: novo submodo "sem senha" com 2 passos (identificador → código), botão
  "Entrar sem senha" à esquerda do "Entrar"; reusa `OtpInput`. Em sucesso, usa o mesmo
  `saveAuthData`/redirecionamento do login por senha.

## Postura de Segurança

1. `login_otp_codes` RLS deny-all; só via RPC `SECURITY DEFINER` com `SET search_path`.
2. Só hash do código; comparação por hash; 5 tentativas; expira 10 min; uso único.
3. `generateLink`/service role só na Edge_Sessao; nunca no cliente.
4. Anti-enumeração + anti-timing iguais ao login por senha; blacklist reaproveitada.
5. Conta inativa/banida ⇒ recusa com a mensagem padrão.
6. Logs sem código, sem `token_hash`, sem segredos.

## Correctness Properties

- **CP1 — Anti-enumeração:** `request_login_otp` retorna a mesma resposta neutra para conta
  existente e inexistente; só insere/Envia quando existe (verificável por efeito no banco).
- **CP2 — Uso único do código:** `verify_login_otp` retorna OK no máximo uma vez por código;
  segunda tentativa ⇒ EXPIRED/INVALID.
- **CP3 — Tentativas/expiração:** 5 inválidas ⇒ BLOCKED; após `expires_at` ⇒ EXPIRED; nunca
  emite e-mail/token de sessão nesses casos.
- **CP4 — Detecção de canal:** a função pura de classificação do `Identificador` mapeia
  e-mail→email e telefone→whatsapp de forma determinística; entradas inválidas ⇒ rejeitadas.
- **CP5 — Binding usuário↔código:** um código só valida para o `user_id` que o gerou.
- **CP6 — Sem segredos/sessão indevida:** a Edge nunca retorna service role nem `token_hash`
  para código inválido; logs não contêm código/token (`expectNoSecrets`).
- **CP7 — Conta inativa:** usuário `is_active=false` nunca recebe sessão, independente do código correto.

## Estratégia de Testes (governança)

- **Unit/property (`src/__tests__/auth/login/`):** CP4 (classificação de identificador),
  round-trip de código (reuso), masking de logs (CP6 nível função).
- **Integração (`tests/auth/login/`):** CP1, CP2, CP3, CP5, CP7 nas RPCs; emissão de sessão
  ponta a ponta com `verifyOtp` (mock/Supabase efêmero); blacklist; anti-timing.
- **Cenários de falha:** código errado/expirado/bloqueado; identificador inválido; conta
  inexistente (resposta neutra); conta inativa; WhatsApp falha → fallback e-mail.
- **Validações:** front (formato identificador, 6 dígitos) E back (RPCs + Edge).
- **Regression_Suite + Critical_Modules:** `login_otp_codes`, `passwordlessLogin`, Edge_Sessao.

## Dependências

- **Bloqueante:** spec `auth-otp-whatsapp` (canal OTP, Edge `send-signup-otp`, `phoneE164`).
- Reusa `resolve_login_email` (migration 066) e o padrão de blacklist/anti-timing do `auth.ts`.

## Riscos e Mitigações

- **Sequestro por SIM-swap/e-mail comprometido:** risco inerente a OTP; mitigação: expiração
  curta, uso único, rate limit, blacklist, e (futuro) 2º fator/biometria no app.
- **`generateLink` indisponível/erro:** Edge retorna erro neutro; usuário tenta de novo ou usa senha.
- **Custo de mensagens:** login sem senha também consome OTP; rate limit contém abuso.
