import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config — FreteGO mobile app.
 *
 * Estratégia: app shell remoto.
 * O invólucro nativo (Android/iOS) carrega o site hospedado no Vercel.
 * Atualizações de UI/regra de negócio não exigem rebuild do APK — basta
 * `git push` que a próxima abertura do app já mostra a versão nova.
 *
 * Apenas mudanças "binárias" (ícone, splash, plugin novo, permissão
 * nova) precisam de rebuild + redistribuir APK / re-submeter loja.
 *
 * Bundle local (`webDir: 'dist'` sem `server.url`) fica como Phase 2
 * para suporte offline.
 */
const config: CapacitorConfig = {
  appId: 'br.com.fretego.app',
  appName: 'FreteGO',
  webDir: 'dist',

  server: {
    // Phase 1: app shell aponta para producao Vercel.
    url: 'https://www.fretegobr.com.br',
    cleartext: false, // so HTTPS
    androidScheme: 'https',
  },

  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false, // habilita só em dev
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#16a34a', // verde FreteGO
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      androidSpinnerStyle: 'large',
      spinnerColor: '#ffffff',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK', // texto branco em fundo escuro
      backgroundColor: '#16a34a',
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
