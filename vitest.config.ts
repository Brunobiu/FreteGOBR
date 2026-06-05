import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
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
