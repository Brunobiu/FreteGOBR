# Design — Entrada por Biometria no App (rosto/digital)

## Visão Geral

Biometria como **trava local** sobre uma `Sessao_Supabase` persistida. A autenticação real
continua sendo o refresh token do Supabase; a biometria apenas **autoriza o desbloqueio** e o
acesso ao `Refresh_Token_Guardado` no `Storage_Seguro`. Nada disso é server-side — é uma
camada do `App_Nativo` (Capacitor).

Esta é a **Fase 3**, dependente das specs `auth-otp-whatsapp` e `login-sem-senha` (o fallback
de login). É a **única** das três que exige rebuild nativo e re-submissão às lojas.

## Por que é uma trava local (e não login no servidor)

O Supabase não autentica "por digital". O padrão correto:
1. Usuário faz `Login_Completo` (senha ou código) → obtém `Sessao_Supabase`.
2. Opt-in de biometria: guardamos o **refresh token** no `Storage_Seguro` (cifrado por
   Keychain/Keystore) e marcamos `Biometria_Ativa`.
3. Na abertura, `Trava_Biometrica` chama o prompt nativo; em sucesso, lê o refresh token e
   faz `supabase.auth.setSession()` / `refreshSession()` para restaurar a sessão.

Assim mantemos todo o ciclo de sessão do Supabase intacto e não inventamos criptografia.

## Plugin e Plataforma

- Plugin recomendado: **`capacitor-native-biometric`** (prompt + `setCredentials`/`getCredentials`
  em Keychain/Keystore). Alternativa: `@aparajita/capacitor-biometric-auth`.
- Detecção: `Capacitor.isNativePlatform()` + `Plugin.isAvailable()` em runtime (Req 7).
- Web/navegador: sem plugin ⇒ recurso oculto; **feature detection** evita quebra (Req 6.4, 7).
- Alternativa documentada (não implementada): **WebAuthn/passkeys** funcionam no navegador, mas
  o suporte em WebView Capacitor é irregular; o plugin nativo é mais confiável.

## Componentes

| Papel | Arquivo |
| --- | --- |
| Serviço de biometria (wrapper do plugin) | **NOVO** `src/services/biometricAuth.ts` |
| Tela/guarda de bloqueio | **NOVO** `src/components/BiometricLockScreen.tsx` |
| Hook de gate na abertura | **NOVO** `src/hooks/useBiometricGate.ts` |
| Opt-in/opt-out | `src/pages/ConfiguracoesPage.tsx` (toggle "Entrar com biometria") |
| Integração de sessão | `src/hooks/useAuth.tsx` (restaurar sessão a partir do refresh token; limpar no logout) |
| Detecção de retorno do background | `@capacitor/app` (listener `appStateChange`) |
| Config nativa | `capacitor.config.ts`, `AndroidManifest.xml` (USE_BIOMETRIC), `Info.plist` (NSFaceIDUsageDescription) |
| Docs build/lojas | **NOVO** `docs/BIOMETRIA_APP_BUILD.md` |

> Sem migration: o estado vive no aparelho (Storage_Seguro + flag local). Nenhuma mudança de schema.

## Fluxos

### Ativação (opt-in)
```
Login_Completo OK → (Plataforma_Nativa && isAvailable) → oferta "Ativar biometria"
   usuário aceita → verifyIdentity() OK
       → setCredentials(refresh_token) no Storage_Seguro
       → flag Biometria_Ativa = true (Preferences)
```

### Abertura / retorno do background
```
app start | resume → Biometria_Ativa?
   não  → comportamento atual (sessão persistida, sem trava)
   sim  → BiometricLockScreen
            verifyIdentity()
              sucesso → getCredentials(refresh_token) → setSession/refreshSession
                         sucesso → libera conteúdo
                         falha   → limpa estado → Login_Completo
              cancela/falha repetida → Login_Completo (senha/código)
```

### Logout
```
logout → signOut + limpar localStorage + deleteCredentials(Storage_Seguro) + Biometria_Ativa=false
```

## Postura de Segurança

1. Só o **refresh token** vai ao Storage_Seguro; nunca senha nem access token persistente.
2. Leitura do token condicionada à verificação biométrica (getCredentials atrás do prompt).
3. Remoção do token em logout, opt-out e refresh inválido; invalidar se a biometria do
   aparelho for removida/alterada (Req 5.5).
4. Tokens nunca em logs.
5. Falha biométrica nunca bloqueia a conta — só redireciona ao Login_Completo (Req 3).

## Correctness Properties

Foco em lógica pura e máquina de estados do gate (testável fora do nativo, com o plugin mockado).

- **CP1 — Gate condicional:** a `Trava_Biometrica` só aparece quando `isNativePlatform() && isAvailable() && Biometria_Ativa`; em qualquer outra combinação, não há trava.
- **CP2 — Segredo mínimo:** o que é gravado no Storage_Seguro é exclusivamente o refresh token; a senha nunca é gravada (verificável na função de ativação).
- **CP3 — Fallback sem lockout:** após falha/cancelamento, a máquina de estados sempre alcança um estado de Login_Completo disponível (nunca um estado terminal de bloqueio).
- **CP4 — Degradação segura:** quando o plugin está ausente ou lança erro, a função de detecção retorna "indisponível" e o app segue para o fluxo normal (sem exceção propagada à UI).
- **CP5 — Restauração após verify:** a restauração de sessão (setSession) só é chamada **após** `verifyIdentity()` ter retornado sucesso (ordem garantida).
- **CP6 — Limpeza no logout:** após logout, não resta refresh token no Storage_Seguro nem flag Biometria_Ativa (idempotente).

## Estratégia de Testes (governança)

- **Unit/property (`src/__tests__/auth/biometria/`):** máquina de estados do gate (CP1, CP3,
  CP5), função de detecção/degradação (CP4), função de ativação/limpeza (CP2, CP6) — tudo com
  o Plugin_Biometria **mockado** via `(globalThis as Record<string, unknown>).__biometricSpy`.
- **Manual/dispositivo (`docs/`):** roteiro de teste em Android/iOS reais (cold start, resume,
  cancelar, remover digital do aparelho, logout) — biometria real não roda em CI.
- **Cenários de falha:** plugin ausente; hardware indisponível; verify cancelado; refresh token
  expirado/revogado; biometria do SO alterada; erro inesperado do plugin.
- **Regression_Suite + Critical_Modules:** `biometricAuth`, `useBiometricGate` (máquina de estados).

## Build e Publicação (resumo; detalhe em docs)

1. `npm i capacitor-native-biometric` → `npx cap sync android ios`.
2. Android: permissão `USE_BIOMETRIC` no `AndroidManifest.xml`.
3. iOS: `NSFaceIDUsageDescription` no `Info.plist`.
4. Rebuild do APK/IPA + re-submissão às lojas.
5. Web (shell) atualiza por `git push`, mas a biometria só funciona em builds com o plugin
   (feature detection cobre versões antigas do app).

## Dependências

- **Bloqueante (fallback):** `login-sem-senha` (e, por transitividade, `auth-otp-whatsapp`).
- `@capacitor/app` (já instalado) para detectar retorno do background.
- `@capacitor/preferences` (já instalado) para a flag `Biometria_Ativa` (não-secreta).

## Riscos e Mitigações

- **Rebuild/loja:** ciclo mais lento que `git push`; planejar como release nativo dedicado.
- **Persistência de sessão em WebView remota:** validar que localStorage/refresh token sobrevive
  a cold start no Android/iOS; se necessário, persistir via `@capacitor/preferences`.
- **Token de longa duração no aparelho:** mitigado por Storage_Seguro + biometria + limpeza em logout.
- **Fragmentação de hardware Android:** feature detection + fallback cobrem aparelhos sem sensor.
