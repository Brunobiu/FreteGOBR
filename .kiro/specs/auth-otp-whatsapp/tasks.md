# Plano de Implementação — Verificação de Cadastro por WhatsApp (Cloud API) + Fallback

## Visão Geral

Implementação de baixo risco, do banco para a UI, com o **fallback de e-mail como rede de
segurança desde o dia 1** (o cadastro funciona mesmo antes da Cloud_API estar aprovada).
Ordem: (1) migration 125 com tabela/colunas/RPCs; (2) lógica pura testável (E.164,
decisão de canal); (3) Edge_Envio com WhatsApp + fallback; (4) serviço cliente; (5)
mudanças de cadastro no front; (6) ajuste do gate do embarcador; (7) testes
property/integração; (8) docs e checkpoints.

Convenção: tarefas com `*` são opcionais. Testes de invariante (CP) **não** são opcionais
(governança). Cada item cita `_Refs:_` aos requisitos.

## Tarefas

- [ ] 1. Migration 125 — schema do OTP por telefone
  - Arquivo: `supabase/migrations/125_auth_otp_whatsapp.sql` (+ `_rollback.sql`)
  - Idempotente, `BEGIN; ... COMMIT;`, bloco `DO $check$` defensivo, bloco `-- VERIFY` comentado

  - [ ] 1.1 Criar tabela `signup_otp_verifications` + índices + RLS deny-all
    - Colunas conforme design; índices `(phone, created_at DESC)` e `verification_token` parcial
    - `ENABLE ROW LEVEL SECURITY` + policy `FOR ALL USING (false) WITH CHECK (false)`
    - _Refs: Requisito 12.1, 13.1, 13.2_

  - [ ] 1.2 Adicionar `users.phone_verified` e tornar `embarcadores.company_name` opcional
    - `ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false`
    - `ALTER COLUMN company_name DROP NOT NULL` (defensivo, só se NOT NULL)
    - _Refs: Requisito 7.5, 8.3, 13.3, 13.4_

  - [ ] 1.3 RPC `request_signup_otp(p_phone, p_email, p_force_email)`
    - Normaliza E.164, rate limit 5/h por phone, anti-enumeração (alvo já cadastrado → ok sem envio)
    - Gera código, grava hash, invalida pendentes, `net.http_post` p/ Edge_Envio
    - `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO anon, authenticated`
    - _Refs: Requisito 4, 9, 10, 11_

  - [ ] 1.4 RPC `confirm_signup_otp(p_phone, p_code)`
    - Normaliza, compara por hash, trata EXPIRED/BLOCKED/INVALID, emite token 30min em OK
    - _Refs: Requisito 5_

  - [ ] 1.5 RPC `consume_signup_otp_token(p_phone, p_token)`
    - Valida binding ao phone, single-use, retorna `{ok, channel}`
    - _Refs: Requisito 6_

  - [ ] 1.6 Ajustar gate de "cadastro completo p/ postar frete" para Contato_Verificado
    - Recriar a regra/política que hoje exige `email_verified` para aceitar `phone_verified OR email_verified`
    - Coordenar com `embarcador-onboarding` (não bloquear quem já tinha email_verified)
    - _Refs: Requisito 8.5, 8.6_

- [ ] 2. Lógica pura testável
  - [ ] 2.1 `src/utils/phoneE164.ts` — normalização determinística BR
    - `toE164BR(raw): string | null` conforme Req 9
    - _Refs: Requisito 9_
  - [ ] 2.2 `src/services/admin/.../channelDecision` (ou util) — decisão de canal/fallback (função pura)
    - `decideChannel({ whatsappOk, hasEmail, forceEmail }) → 'whatsapp' | 'email' | 'none'`
    - _Refs: Requisito 1, 2_

- [ ] 3. Edge Function `send-signup-otp` (WhatsApp + fallback)
  - Arquivo: `supabase/functions/send-signup-otp/index.ts`
  - [ ] 3.1 Auth do request (Bearer service role OU shared secret, tempo constante; 401 caso contrário)
    - _Refs: Requisito 12.5_
  - [ ] 3.2 Envio via Cloud_API (template de autenticação), lendo segredos do Vault/env
    - Formatar `to` em E.164; tratar resposta como dado não confiável; sem segredos em log
    - _Refs: Requisito 1_
  - [ ] 3.3 Fallback para `send-verification-email` quando WhatsApp falha / sem credenciais
    - Mesmo código; exige e-mail válido; grava `sent_channel` na Tabela_OTP (service role)
    - _Refs: Requisito 2, 15.1, 15.4_
  - [ ] 3.4 `force_email = true` ⇒ envia direto por e-mail (fallback manual)
    - _Refs: Requisito 3.2_

- [ ] 4. Serviço cliente `src/services/signupOtp.ts`
  - Espelha `signupVerification.ts`: `requestSignupOtp(phone,email,forceEmail?)`,
    `confirmSignupOtp(phone,code) → {status, token, channel}`
  - Mapeia erros `invalid_phone` / `rate_limited` para mensagens pt-BR
  - _Refs: Requisito 3, 4, 5_

- [ ] 5. Atualizar `RegisterForm.tsx`
  - [ ] 5.1 Etapa 1: trocar geração de código para `requestSignupOtp(phone,email,false)`
    - Texto da etapa 2: "Enviamos um código para o seu WhatsApp"
    - _Refs: Requisito 7.1, 7.2, 8.1, 8.2_
  - [ ] 5.2 Etapa 2: `confirmSignupOtp(phone,code)`; guardar `{token, channel}`; botão "Não recebi — enviar por e-mail"
    - _Refs: Requisito 3, 5, 7.3_
  - [ ] 5.3 Embarcador: remover o campo "nome da empresa" do formulário
    - _Refs: Requisito 8.1_
  - [ ] 5.4 Etapa 3: enviar `phoneVerificationToken` no `onSubmit`
    - _Refs: Requisito 7.4_

- [ ] 6. Atualizar `src/services/auth.ts` (register)
  - [ ] 6.1 Consumir `consume_signup_otp_token(phone, token)` no lugar do token de e-mail
    - _Refs: Requisito 6_
  - [ ] 6.2 Setar `phone_verified`/`email_verified` conforme `channel`
    - _Refs: Requisito 7.5_
  - [ ] 6.3 Embarcador sem `company_name` obrigatório no insert
    - _Refs: Requisito 8.3, 8.4_

- [ ] 7. Ajustar perfil/gate do embarcador
  - [ ] 7.1 Garantir edição do nome da empresa no perfil (campo já existe)
    - _Refs: Requisito 8.4_
  - [ ] 7.2 Atualizar cálculo de "cadastro completo" no client p/ Contato_Verificado + nome da empresa
    - _Refs: Requisito 8.5, 8.6_

- [ ] 8. Testes property (governança — obrigatórios)
  - [ ] 8.1 `src/__tests__/auth/otp/cp1_code_roundtrip.property.test.ts` (CP1)
  - [ ] 8.2 `src/__tests__/auth/otp/cp2_phone_e164.property.test.ts` (CP2)
  - [ ] 8.3 `src/__tests__/auth/otp/cp9_channel_fallback.property.test.ts` (CP9)
  - [ ] 8.4 `src/__tests__/auth/otp/cp10_no_secrets_log.property.test.ts` (CP10)
  - _Refs: Requisito 1, 2, 9, 12_

- [ ] 9. Testes de integração (Supabase efêmero)
  - [ ] 9.1 `tests/auth/otp/otp_lifecycle.integration.test.ts` — CP3, CP4, CP5 (expira/tentativas/single-use)
  - [ ] 9.2 `tests/auth/otp/otp_ratelimit_enum.integration.test.ts` — CP7, CP8 (rate limit, anti-enumeração)
  - [ ] 9.3 `tests/auth/otp/otp_token_binding.integration.test.ts` — CP6 (binding token↔phone)
  - [ ] 9.4 `tests/auth/otp/embarcador_gate.integration.test.ts` — gate aceita Contato_Verificado
  - _Refs: Requisito 5, 6, 8, 10, 11_

- [ ] 10. Cenários de falha (caminhos negativos)
  - WhatsApp 4xx/5xx/timeout → fallback; sem segredos Cloud → e-mail; token expirado/reusado;
    telefone inválido; rate limit; alvo duplicado; e-mail inválido no fallback manual
  - _Refs: Requisito 2, 3, 6, 9, 10, 15_

- [ ] 11. Documentação e configuração
  - [ ] 11.1 `docs/WHATSAPP_CLOUD_API_SETUP.md` — verificação Meta (CNPJ/MEI), número dedicado,
    template de autenticação, segredos no Vault, limites/tiers
    - _Refs: Requisito 15.3_
  - [ ] 11.2 Registrar `signup_otp_verifications` e `phoneE164` como Critical_Modules em `tests/coverage.config.ts`
    - _Refs: governança_

- [ ] 12. Checkpoint final
  - `npm run build` + `npm run test:run`; aplicar migration 125 em branch efêmero; smoke do cadastro
    (WhatsApp quando configurado; e-mail no fallback). Parar e perguntar em qualquer divergência.

## Notas

- O cadastro deve permanecer funcional via e-mail mesmo sem a Cloud_API (Req 15.1) — validar isso explicitamente.
- Não tocar na automação de marketing (Evolution API).
- Esta spec é pré-requisito da spec `login-sem-senha` (reuso do canal OTP).
