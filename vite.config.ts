import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  appType: 'spa',
  server: {
    // Não interceptar /links — servir como arquivo estático do public/
    proxy: {},
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Grupos preservados do baseline (Req 11.1 — não-regressão).
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          // leaflet/mapas: isolado e nunca importado estaticamente por chunk
          // crítico — HomePage usa lazy(InteractiveMap) (Req 11.2).
          leaflet: ['leaflet', 'react-leaflet'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          // crypto: bcryptjs é usado apenas no MFA do painel admin
          // (services/admin/mfa.ts), alcançado só por rotas lazy. Lib pesada
          // não crítica ao First_Useful_Paint — isolada sob demanda (Req 11.2).
          crypto: ['bcryptjs'],
        },
      },
    },
  },
});
