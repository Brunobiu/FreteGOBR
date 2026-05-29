# Implementation Plan — Mobile App Capacitor

## Overview

Plano de implementação do FreteGO como app nativo Android (Phase 1) e
iOS (Phase 2) usando Capacitor.

Convenções herdadas (não redocumentar — ver `project-conventions.md` e
`admin-patterns.md`):
- pt-BR em UI/comentários; identifiers e configs em inglês.
- Idempotência via versionamento e checks defensivos.
- Sem novas dependências de runtime fora do Capacitor.

## Tasks

- [x] 1. Setup Capacitor (Phase 1.A — APK direto)
  - [x] 1.1 Instalar Capacitor core e CLI como devDependencies
    - `npm i -D @capacitor/cli`
    - `npm i @capacitor/core @capacitor/android`
    - _Requirements: Capacitor base_

  - [x] 1.2 Inicializar Capacitor no projeto
    - `npx cap init "FreteGO" "br.com.fretego.app"`
    - Aceitar webDir = `dist`.
    - Gera `capacitor.config.ts` na raiz.
    - _Requirements: Capacitor base_
    - **Nota**: criamos o `capacitor.config.ts` direto em vez do interativo `cap init`, com config completa (server remoto, splash, status bar).

  - [x] 1.3 Configurar `capacitor.config.ts` para app shell remoto
    - `server.url = 'https://fretego.com.br'` (apontando pra produção Vercel).
    - `server.cleartext = false`.
    - Plugin SplashScreen com bg verde FreteGO.
    - Plugin StatusBar style DARK.
    - _Requirements: app shell remoto_

  - [x] 1.4 Adicionar plataforma Android
    - `npx cap add android`.
    - Gera pasta `android/` na raiz.
    - Adicionar `android/` ao `.gitignore` parcial (mantém `build.gradle`,
      `AndroidManifest.xml`, `res/`; ignora `build/`).
    - _Requirements: Android nativo_

  - [x] 1.5 Instalar plugins essenciais
    - `npm i @capacitor/geolocation @capacitor/camera`
    - `npm i @capacitor/push-notifications @capacitor/preferences`
    - `npm i @capacitor/status-bar @capacitor/splash-screen @capacitor/app`
    - `npx cap sync` — copia plugins para `android/`.
    - _Requirements: plugins essenciais_

  - [x] 1.6 Configurar permissões no AndroidManifest.xml
    - `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` (GPS).
    - `CAMERA` (foto perfil, documentos).
    - `READ_EXTERNAL_STORAGE` / `READ_MEDIA_IMAGES` (galeria).
    - `INTERNET`, `POST_NOTIFICATIONS` (Android 13+).
    - _Requirements: permissões nativas_

- [ ] 2. Branding e identidade visual
  - [ ] 2.1 Criar ícone do app (todas as densidades)
    - 1024x1024 master (logo verde FreteGO).
    - Gerar via `npx @capacitor/assets generate --android` (precisa
      `assets/icon.png` 1024x1024).
    - Distribui pra mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi automaticamente.
    - _Requirements: ícone do app_

  - [ ] 2.2 Criar splash screen
    - 2732x2732 master (logo centralizado em fundo verde #16a34a).
    - `npx @capacitor/assets generate --android` cria todas as densidades.
    - _Requirements: splash screen_

  - [ ] 2.3 Configurar status bar
    - Cor: verde FreteGO (#16a34a) ou transparente sobreposto.
    - Texto branco (style DARK no Capacitor = branco em fundo escuro).
    - _Requirements: identidade visual_

- [ ] 3. Adaptações no código React (compatibilidade nativo + web)
  - [x] 3.1 Criar helper `src/services/platform.ts`
    - Exporta `isNative()`, `isAndroid()`, `isIOS()`.
    - Usa `Capacitor.isNativePlatform()` e `Capacitor.getPlatform()`.
    - _Requirements: ponte nativa_

  - [ ] 3.2 Refatorar `useGeolocation` para usar plugin nativo quando aplicável
    - Detecta nativo → usa `@capacitor/geolocation`.
    - Browser → mantém `navigator.geolocation` (já funciona).
    - Mesmo retorno: `GeographicPoint`.
    - _Requirements: GPS nativo_

  - [ ] 3.3 Refatorar upload de foto/documento para usar Camera nativa
    - Em `MotoristaPerfilPage`, `EmbarcadorPerfilPage`, `DocSlot`.
    - Substituir `<input type="file">` por botão que dispara
      `Camera.getPhoto({ source: 'PROMPT' })` quando nativo.
    - Browser mantém `<input>`.
    - _Requirements: câmera nativa_

  - [ ] 3.4 Adicionar listener de back button Android
    - `App.addListener('backButton', ...)` para navegar voltar
      em vez de fechar app.
    - Em rota raiz (`/`), prompt "Sair do FreteGO?".
    - _Requirements: back button Android_

  - [ ] 3.5 Substituir `localStorage` crítico por `Preferences` (Capacitor)
    - Apenas para tokens/preferências que devem sobreviver a
      reinstalação de WebView (raro, mas defensivo).
    - localStorage continua funcionando, mudança é pontual.
    - _Requirements: persistência defensiva_

- [ ] 4. Build e distribuição APK debug
  - [ ] 4.1 Build inicial Android
    - `npm run build` (Vite).
    - `npx cap sync android` (copia dist/ para android/).
    - `cd android && ./gradlew assembleDebug`.
    - Output: `android/app/build/outputs/apk/debug/app-debug.apk`.
    - _Requirements: APK debug_

  - [ ] 4.2 Testar em celular real (Android)
    - Habilitar USB debugging no celular.
    - `npx cap run android` ou instalar APK manualmente.
    - Validar: GPS abre permissão, câmera funciona, navegação volta
      corretamente, splash aparece, ícone correto.
    - _Requirements: smoke test nativo_

  - [ ] 4.3 Hospedar APK pra distribuição por link
    - Bucket público no Supabase Storage: `app-builds/`.
    - Upload `app-debug.apk` versionado: `fretego-v1.0.0.apk`.
    - Gerar URL pública.
    - Compartilhar via WhatsApp / link encurtado.
    - _Requirements: distribuição beta_

- [ ] 5. Push Notifications (Phase 1.5)
  - [ ] 5.1 Migration: tabela `device_tokens`
    - Colunas: id, user_id, token, platform, app_version, created_at, last_seen_at.
    - UNIQUE (user_id, token).
    - RLS: SELECT/INSERT/UPDATE só do próprio user.
    - _Requirements: registro de tokens_

  - [ ] 5.2 Service `src/services/pushNotifications.ts`
    - `registerForPush()`: pede permissão, registra token, envia pra
      Supabase via insert em `device_tokens`.
    - `unregisterPush()`: remove token ao logout.
    - Listener `pushNotificationReceived` (foreground).
    - Listener `pushNotificationActionPerformed` (tap → navigate).
    - _Requirements: client de push_

  - [ ] 5.3 Setup Firebase Cloud Messaging (FCM)
    - Criar projeto Firebase em console.firebase.google.com.
    - Adicionar app Android com applicationId `br.com.fretego.app`.
    - Baixar `google-services.json`, colocar em `android/app/`.
    - Gerar Server Key (legacy) ou OAuth2 token (HTTP v1).
    - _Requirements: FCM Android_

  - [ ] 5.4 Edge Function `send-push-notification`
    - Trigger: chamada quando insere em `notifications`.
    - Lê `device_tokens` do `user_id` destinatário.
    - Dispara request pro FCM (HTTP v1) com title, body, data.
    - Para iOS futuro: integra APN via mesmo payload.
    - _Requirements: dispatcher de push_

  - [ ] 5.5 Trigger SQL: `notifications_dispatch_push_after_insert`
    - `AFTER INSERT ON notifications` chama Edge Function via
      `pg_net.http_post` com headers de service role.
    - Ignora notificações de tipos não-push (ex: ticket_resolved
      não precisa push se for muito barulhento — config futuro).
    - _Requirements: trigger automático_

- [ ] 6. Phase 1.B — Play Store
  - [ ] 6.1 Criar conta Google Play Console
    - https://play.google.com/console
    - USD 25 uma vez. Aceita CPF + cartão internacional.
    - _Requirements: conta dev Google_

  - [ ] 6.2 Gerar keystore release
    - `keytool -genkey -v -keystore fretego-release.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias fretego`.
    - **CRÍTICO**: backup em local seguro (perder = nunca mais atualiza app).
    - Adicionar credenciais em `android/keystore.properties` (gitignored).
    - _Requirements: assinatura release_

  - [ ] 6.3 Configurar build release
    - Editar `android/app/build.gradle` para usar keystore.properties.
    - Habilitar minify (`minifyEnabled true` em release).
    - Habilitar shrinkResources.
    - _Requirements: build otimizado_

  - [ ] 6.4 Gerar AAB
    - `cd android && ./gradlew bundleRelease`.
    - Output: `android/app/build/outputs/bundle/release/app-release.aab`.
    - _Requirements: bundle pra Play Store_

  - [ ] 6.5 Criar página `/politica-privacidade`
    - Texto pt-BR com cobertura LGPD.
    - Lista dados coletados (nome, email, foto, GPS, etc.).
    - Lista finalidades.
    - Como exercer direitos do titular.
    - _Requirements: política de privacidade obrigatória_

  - [ ] 6.6 Preparar assets pra loja
    - Ícone alta resolução 512x512.
    - Feature graphic 1024x500.
    - Mínimo 2 screenshots (mobile).
    - Ideal: 4-8 screenshots cobrindo telas principais.
    - Vídeo curto (opcional, mas aumenta conversão).
    - _Requirements: assets Play Store_

  - [ ] 6.7 Criar listing no Play Console
    - Nome: FreteGO.
    - Descrição curta (80 chars).
    - Descrição longa (4000 chars) com palavras-chave.
    - Categoria: "Negócios" ou "Mapas e Navegação".
    - Classificação etária.
    - Política de privacidade URL.
    - _Requirements: listing Play Store_

  - [ ] 6.8 Submeter pra revisão (Internal Testing primeiro)
    - Subir AAB em "Internal testing".
    - Adicionar emails dos testers (até 100).
    - Validar que funciona via link de teste.
    - Promover pra "Production" depois de OK.
    - _Requirements: revisão Google_

- [ ] 7. Phase 2 — App Store iOS (futuro)
  - [ ] 7.1 Adquirir Apple Developer Program
    - USD 99/ano em developer.apple.com.
    - Verificação demora alguns dias (Apple liga, valida CPF/CNPJ).
    - _Requirements: conta dev Apple_

  - [ ] 7.2 Setup ambiente macOS
    - Opção A: Mac próprio (Mac Mini M4 usado R$ 4-7k).
    - Opção B: Codemagic / GitHub Actions macOS (USD 0-30/mês).
    - _Requirements: ambiente build iOS_

  - [ ] 7.3 Adicionar plataforma iOS
    - `npx cap add ios`.
    - `cd ios/App && pod install`.
    - _Requirements: iOS nativo_

  - [ ] 7.4 Configurar Info.plist
    - Privacy descriptions: NSCameraUsageDescription,
      NSLocationWhenInUseUsageDescription, NSPhotoLibraryUsageDescription.
    - Bundle Identifier: br.com.fretego.app.
    - URL schemes pra deep links.
    - _Requirements: configuração iOS_

  - [ ] 7.5 Configurar APN (Apple Push Notifications)
    - Gerar key APN no developer portal.
    - Configurar Capability "Push Notifications" no Xcode.
    - Atualizar Edge Function `send-push-notification` pra suportar APN.
    - _Requirements: push iOS_

  - [ ] 7.6 Build IPA
    - `xcodebuild -workspace ios/App/App.xcworkspace -scheme App archive`.
    - Export archive → IPA.
    - _Requirements: bundle iOS_

  - [ ] 7.7 Submeter App Store Connect
    - Criar app em appstoreconnect.apple.com.
    - Subir IPA via Transporter ou Xcode.
    - Preencher metadados (similar Play Store).
    - Submeter pra revisão.
    - Apple geralmente rebote 1-2 vezes pedindo ajustes.
    - _Requirements: revisão Apple_

- [ ] 8. Manutenção contínua
  - [ ] 8.1 Atualizações OTA via Vercel
    - Push pro git → Vercel atualiza → app puxa nova versão automático.
    - Sem rebuild necessário.
    - _Requirements: atualização hot_

  - [ ] 8.2 Política de versionamento APK/AAB
    - Incrementar `versionCode` (int) e `versionName` (semver) em
      `android/app/build.gradle` a cada rebuild.
    - Documentar mudanças em CHANGELOG.md.
    - _Requirements: versionamento_

  - [ ] 8.3 Atualizar Android SDK target anualmente
    - Google força target SDK mais recente uma vez por ano.
    - Atualizar `compileSdkVersion`, `targetSdkVersion`.
    - Testar em devices novos.
    - _Requirements: compliance Play Store_

  - [ ] 8.4 Monitorar crashes
    - Phase 2 opcional: integrar Sentry ou Firebase Crashlytics.
    - _Requirements: observabilidade nativa_

## Notas

### Não escopo desta spec

- Modo offline com cache local (Phase 3).
- Login biométrico (Phase 3).
- Compartilhamento nativo de fretes (Phase 3).
- Live Activities iOS / Ongoing Notifications Android (Phase 3).

### Bloqueadores externos

- **Política de privacidade publicada**: bloqueia submissão Play Store.
- **CPF/CNPJ verificado**: bloqueia conta Google Play e Apple Developer.
- **Cartão internacional**: necessário para pagar contas dev.
- **Mac**: bloqueia Phase 2 inteira.

### Dependências do que já está pronto

- App web atual deve continuar funcional via HTTPS no Vercel
  (já está).
- Login funcionando no browser (já está).
- Sino de notificações (já está).
- GPS via browser (já está, plugin nativo só substitui).
