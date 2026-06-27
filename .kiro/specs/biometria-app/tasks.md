# Plano de Implementação — Entrada por Biometria no App (rosto/digital)

## Visão Geral

Fase 3, **após** `auth-otp-whatsapp` e `login-sem-senha` (o login por código é o fallback).
Única spec que exige **rebuild nativo + re-submissão às lojas**. Ordem: (1) plugin + config
nativa; (2) serviço de biometria com feature detection; (3) integração de sessão no `useAuth`;
(4) opt-in nas Configurações; (5) trava na abertura; (6) testes (plugin mockado) + roteiro
manual; (7) docs e release nativo.

Convenção: `*` = opcional. Testes de invariante (CP) são obrigatórios (governança). A
biometria real é validada em dispositivo (não em CI). `_Refs:_` citam requisitos.

## Tarefas

- [ ] 0. Pré-requisitos
  - `login-sem-senha` e `auth-otp-whatsapp` implementadas (fallback de login disponível).
  - _Refs: dependência_

- [ ] 1. Plugin e configuração nativa
  - [ ] 1.1 Adicionar `capacitor-native-biometric` e `npx cap sync android ios`
    - _Refs: Requisito 6.1_
  - [ ] 1.2 Android: permissão `USE_BIOMETRIC` no `AndroidManifest.xml`
    - _Refs: Requisito 6.2_
  - [ ] 1.3 iOS: `NSFaceIDUsageDescription` no `Info.plist`
    - _Refs: Requisito 6.2_

- [ ] 2. Serviço `src/services/biometricAuth.ts` (wrapper + feature detection)
  - [ ] 2.1 `isBiometricAvailable()` — `isNativePlatform()` + `isAvailable()`, degrada sem lançar
    - _Refs: Requisito 1.1, 1.2, 7_
  - [ ] 2.2 `enableBiometric(refreshToken)` — verifyIdentity + setCredentials + flag Preferences
    - Nunca grava senha; só o refresh token
    - _Refs: Requisito 1.3, 1.5, 5.1, 5.2_
  - [ ] 2.3 `unlockAndGetToken()` — verifyIdentity → getCredentials(refresh token)
    - _Refs: Requisito 2.2, 5.2, CP5_
  - [ ] 2.4 `disableBiometric()` / `clearBiometric()` — deleteCredentials + flag=false
    - _Refs: Requisito 1.4, 5.3, 6.x_

- [ ] 3. Integração de sessão no `useAuth.tsx`
  - [ ] 3.1 `restoreSessionFromRefreshToken(token)` — `setSession`/`refreshSession`; falha ⇒ limpar + Login_Completo
    - _Refs: Requisito 2.2, 2.3, 4.2_
  - [ ] 3.2 Logout limpa Storage_Seguro + flag (além do localStorage atual)
    - _Refs: Requisito 4.4, 5.3, CP6_

- [ ] 4. Opt-in/opt-out em `ConfiguracoesPage.tsx`
  - [ ] 4.1 Toggle "Entrar com biometria" visível só quando disponível
    - Ativar chama `enableBiometric(refreshToken atual)`; desativar chama `disableBiometric()`
    - _Refs: Requisito 1.1, 1.3, 1.4_

- [ ] 5. Trava na abertura — `useBiometricGate.ts` + `BiometricLockScreen.tsx`
  - [ ] 5.1 Hook detecta cold start e `appStateChange` (@capacitor/app) e decide exibir a trava
    - Só quando `isNativePlatform() && isAvailable() && Biometria_Ativa`
    - _Refs: Requisito 2.1, CP1_
  - [ ] 5.2 `BiometricLockScreen`: prompt, sucesso → restaura sessão; cancelar/falha → Login_Completo
    - Bloqueia navegação autenticada até sucesso/fallback
    - _Refs: Requisito 2.2, 2.4, 2.5, 3_
  - [ ] 5.3 Limite de tentativas → fallback Login_Completo (senha/código), sem lockout de conta
    - _Refs: Requisito 3.1, 3.2, 3.3, CP3_

- [ ] 6. Testes property (obrigatórios; plugin mockado via `__biometricSpy`)
  - [ ] 6.1 `src/__tests__/auth/biometria/cp1_gate_condicional.property.test.ts` (CP1)
  - [ ] 6.2 `src/__tests__/auth/biometria/cp3_fallback_sem_lockout.property.test.ts` (CP3)
  - [ ] 6.3 `src/__tests__/auth/biometria/cp4_degradacao_segura.property.test.ts` (CP4)
  - [ ] 6.4 `src/__tests__/auth/biometria/cp5_cp6_ordem_e_limpeza.property.test.ts` (CP5, CP6, CP2)
  - _Refs: Requisito 1, 2, 3, 5, 7_

- [ ] 7. Cenários de falha (unit + roteiro manual)
  - plugin ausente; hardware indisponível; verify cancelado; refresh token expirado/revogado;
    biometria do SO alterada/removida; erro inesperado do plugin
  - _Refs: Requisito 2.3, 3, 5.5, 7.3_

- [ ] 8. Roteiro de teste em dispositivo + docs
  - [ ] 8.1 `docs/BIOMETRIA_APP_BUILD.md` — build, permissões, publicação, feature detection
    - _Refs: Requisito 6.5_
  - [ ] 8.2 Roteiro manual Android/iOS: cold start, resume, cancelar, logout, remover digital
    - _Refs: Requisito 2, 3, 4, 5_
  - [ ] 8.3 Registrar `biometricAuth` e `useBiometricGate` como Critical_Modules
    - _Refs: governança_

- [ ] 9. Release nativo
  - Rebuild APK/IPA, validar feature detection em build sem/“com” plugin, submeter às lojas.
  - _Refs: Requisito 6.3, 6.4_

## Notas

- Esta spec NÃO tem migration (estado vive no aparelho).
- O Login_Completo (senha + `login-sem-senha`) é sempre a rota de saída quando a biometria falha.
- Persistência da sessão na WebView remota deve ser validada em dispositivo real.
