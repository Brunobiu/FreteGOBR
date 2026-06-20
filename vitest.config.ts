import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
    // Variáveis dummy para os testes — o frontend valida `VITE_SUPABASE_URL`/
    // `VITE_SUPABASE_ANON_KEY` no boot (src/config/env.ts lança se faltarem).
    // No CI não há `.env` (gitignored), então sem isto os testes que importam
    // env.ts quebram. Valores fake: o Supabase é sempre mockado nos testes;
    // nada real é acessado. (Disponíveis em import.meta.env e process.env.)
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key-not-a-secret',
      VITE_ADMIN_MFA_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    },
    // bcrypt (passwordHash) é intencionalmente lento; sob instrumentação de
    // cobertura (v8) fica ~2x mais lento. 30s evita timeout sem mascarar
    // regressões reais (testes normais terminam em ms).
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.config.ts', '**/*.d.ts', '**/types/'],
    },
  },
});
