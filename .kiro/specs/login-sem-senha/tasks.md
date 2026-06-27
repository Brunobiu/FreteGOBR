# Plano de Implementação — Login sem Senha (código por WhatsApp ou E-mail)

## Visão Geral

Depende da spec `auth-otp-whatsapp` (canal OTP + `phoneE164` + Edge de envio). Ordem:
(1) migration 126 (tabela + RPCs); (2) Edge_Sessao que emite a sessão; (3) serviço cliente;
(4) UI no login; (5) testes; (6) checkpoints. O login por senha permanece intacto durante
todo o processo.

Convenção: `*` = opcional. Testes de invariante (CP) são obrigatórios (governança). `_Refs:_`
citam os requisitos.

## Tarefas

- [ ] 0. Pré-requisito
  - Confirmar que a spec `auth-otp-whatsapp` está implementada (Edge `send-signup-otp`,
    `phoneE164`, segredos). Sem ela, o canal de envio não existe.
  - _Refs: dependência_

- [ ] 1. Migration 126 — `login_otp_codes` + RPCs
  - Arquivo: `supabase/migrations/126_login_otp.sql` (+ `_rollback.sql`), idempotente, `DO $check$`

  - [ ] 1.1 Criar `login_otp_codes` + índice + RLS deny-all
    - _Refs: Requisito 5.1, 7.1, 7.2, 7.3_
  - [ ] 1.2 RPC `request_login_otp(p_identifier)`
    - Resolve usuário (e-mail ou telefone via `resolve_login_email`/`users`), anti-enumeração,
      rate limit 5/h, gera/grava hash, invalida pendentes, `net.http_post` p/ `send-signup-otp`
    - _Refs: Requisito 3, 5.6, 5.7_
  - [ ] 1.3 RPC `verify_login_otp(p_identifier, p_code)`
    - EXPIRED/BLOCKED/INVALID/OK por hash; recusa `is_active=false`; OK ⇒ consome e retorna email
    - _Refs: Requisito 4.2, 5.3, 5.4, 5.8_
  - [ ] 1.4 Grants/revokes das RPCs
    - _Refs: Requisito 7.5_

- [ ] 2. Edge Function `login-otp-verify`
  - Arquivo: `supabase/functions/login-otp-verify/index.ts` (`verify_jwt = false`)
  - [ ] 2.1 Receber `{identifier, code}`, chamar `verify_login_otp`
    - _Refs: Requisito 4.1, 4.2_
  - [ ] 2.2 Em OK, `admin.generateLink({type:'magiclink', email})` e retornar `{ok, token_hash}`
    - service role só aqui; erros neutros; anti-timing; sem segredos em log
    - _Refs: Requisito 4.3, 4.4, 5.5, 5.7_
  - [ ] 2.3 Erros neutros para inválido/expirado/bloqueado/inativo
    - _Refs: Requisito 4.7, 5.8_

- [ ] 3. Serviço cliente `src/services/passwordlessLogin.ts`
  - [ ] 3.1 `requestLoginCode(identifier)` (classifica canal; reusa validação/`phoneE164`)
    - _Refs: Requisito 2, 3_
  - [ ] 3.2 `verifyLoginCode(identifier, code)` → invoke Edge → `supabase.auth.verifyOtp({token_hash, type:'email'})`
    - Retorna sessão/User; trata erros neutros
    - _Refs: Requisito 4.5, 4.6, 4.8_

- [ ] 4. UI no `LoginForm.tsx`
  - [ ] 4.1 Ação "Entrar sem senha" à esquerda do botão "Entrar"; alterna para o submodo
    - _Refs: Requisito 1.1, 1.2, 1.3, 1.4_
  - [ ] 4.2 Passo identificador → enviar código (`requestLoginCode`), feedback neutro
    - _Refs: Requisito 1.3, 2, 3.6_
  - [ ] 4.3 Passo código (`OtpInput`): verificar, reenviar (60s), "Não recebi — enviar por e-mail"
    - _Refs: Requisito 6_
  - [ ] 4.4 Em sucesso, `saveAuthData` + redirecionar por `user_type`; manter login por senha intacto
    - _Refs: Requisito 1.5, 4.6_
  - [ ] 4.5 Integrar com `useAuth` (método para setar sessão a partir do `verifyOtp`)
    - _Refs: Requisito 4.5, 4.6_

- [ ] 5. Testes property (obrigatórios)
  - [ ] 5.1 `src/__tests__/auth/login/cp4_identifier_channel.property.test.ts` (CP4)
  - [ ] 5.2 `src/__tests__/auth/login/cp6_no_secrets_log.property.test.ts` (CP6 nível função)
  - _Refs: Requisito 2, 5_

- [ ] 6. Testes de integração (Supabase efêmero)
  - [ ] 6.1 `tests/auth/login/login_otp_lifecycle.integration.test.ts` — CP2, CP3, CP5
  - [ ] 6.2 `tests/auth/login/login_otp_enum_timing.integration.test.ts` — CP1 + anti-timing
  - [ ] 6.3 `tests/auth/login/login_otp_session.integration.test.ts` — emissão de sessão OK; CP7 (inativo)
  - _Refs: Requisito 3, 4, 5_

- [ ] 7. Cenários de falha
  - código errado/expirado/bloqueado; identificador inválido; conta inexistente (neutro);
    conta inativa/banida; WhatsApp falha → fallback e-mail; `generateLink` erro
  - _Refs: Requisito 4, 5, 6_

- [ ] 8. Documentação + Critical_Modules
  - Atualizar docs de auth; registrar `login_otp_codes`, `passwordlessLogin` e a Edge_Sessao
    em `tests/coverage.config.ts`
  - _Refs: governança_

- [ ] 9. Checkpoint final
  - `npm run build` + `npm run test:run`; aplicar migration 126 em branch efêmero; smoke do
    login sem senha por WhatsApp e por e-mail; confirmar que o login por senha segue intacto.

## Notas

- Não remover nem alterar o login por senha — apenas adicionar a opção.
- Reusar `OtpInput`, `phoneE164`, blacklist e o padrão anti-timing já existentes.
