# Biometria no app (rosto/digital) — build e publicação

Guia da feature de **entrada por biometria** (spec `biometria-app`). É a única
das três features de auth que exige **rebuild nativo + reenvio às lojas** — o
restante (cadastro por WhatsApp, login sem senha) vai por `git push` no shell web.

## Como funciona

A biometria é uma **trava local** sobre a sessão já persistida — não autentica
no servidor. Fluxo:

1. Usuário loga (senha ou código) e, nas Configurações, ativa "Entrar com
   biometria". O **refresh token** é guardado no armazenamento seguro do
   aparelho (Keychain/Keystore).
2. Ao abrir o app (ou voltar do background), aparece a `BiometricLockScreen`.
   Em sucesso, o refresh token é lido e a sessão é restaurada (`refreshSession`).
3. Falha/cancelamento ⇒ permanece na trava com a opção "Entrar com senha ou
   código". Logout limpa o token seguro e a flag.

Camada de código (já entregue, builda no web sem o plugin via feature detection):
- `src/services/biometricGate.ts` — máquina de estados pura (testada).
- `src/services/biometricAuth.ts` — wrapper via `registerPlugin` (bridge Capacitor).
- `src/hooks/useBiometricGate.ts` + `src/components/BiometricLockScreen.tsx` — trava.
- `src/hooks/useAuth.tsx` — `unlockWithBiometric` + limpeza no logout.
- `src/pages/ConfiguracoesPage.tsx` — opt-in/opt-out.

## Passos nativos (necessários para funcionar no aparelho)

1. **Instalar o plugin** compatível com Capacitor 8 (registra `NativeBiometric`):
   ```bash
   npm i capacitor-native-biometric   # ou fork compatível com Capacitor 8
   npx cap sync android ios
   ```
   > O código acessa o plugin pelo bridge (`registerPlugin('NativeBiometric')`),
   > então não há import direto do pacote — mas o plugin PRECISA estar no projeto
   > nativo para a feature funcionar.

2. **Android** — permissão já adicionada em `android/app/src/main/AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.USE_BIOMETRIC" />
   ```

3. **iOS** — descrição já adicionada em `ios/App/App/Info.plist`:
   ```xml
   <key>NSFaceIDUsageDescription</key>
   <string>O FreteGO usa o Face ID para desbloquear o app com segurança.</string>
   ```

4. **Rebuild + publicar**: gerar APK/IPA e reenviar às lojas. A versão web nova
   (shell) não habilita a biometria sozinha — ela só aparece em builds com o
   plugin (feature detection cobre versões antigas do app, sem quebrar).

## Segurança

- Só o **refresh token** vai ao armazenamento seguro (nunca a senha).
- Leitura condicionada à verificação biométrica.
- Logout, opt-out e refresh token inválido limpam a credencial.
- Falha biométrica nunca bloqueia a conta — sempre há "Entrar com senha/código".

## Roteiro de teste em dispositivo (manual; não roda em CI)

- Cold start com biometria ativa ⇒ trava aparece e desbloqueia com digital/rosto.
- Voltar do background ⇒ re-trava.
- Cancelar a biometria ⇒ fica na trava com opção de senha; não desloga sozinho.
- "Entrar com senha ou código" ⇒ vai para o login.
- Logout ⇒ próxima abertura não tem trava (credencial limpa) até reativar.
- Remover a digital/rosto do aparelho ⇒ refresh inválido cai no login.
- Aparelho sem sensor / web ⇒ opção nem aparece; app funciona normal.
