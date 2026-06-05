/**
 * Testes de não-vazamento de segredos em respostas/logs (Tarefa 21).
 *
 * Property 11: para toda resposta de API e linha de log, não aparece hash
 * de senha, token, secret nem stack trace.
 *
 * Aqui exercitamos o contrato com payloads representativos das respostas do
 * projeto (sucesso, erro, dados de usuário) e verificamos via expectNoSecrets.
 *
 * Validates: Requirements 19.1, 19.2, 19.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { expectNoSecrets, expectStructuredLog } from '../../src/__tests__/_helpers/logAssertions';
import { validEmail, validPhone, safeText } from '../../src/__tests__/_helpers/generators';

describe('Property 11 — respostas de API sem segredos', () => {
  it('payloads de sucesso típicos não vazam segredos', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          name: safeText(2, 40),
          email: validEmail(),
          phone: validPhone(),
          ok: fc.boolean(),
        }),
        (payload) => {
          expect(() => expectNoSecrets(payload)).not.toThrow();
        }
      ),
      { numRuns: 200 }
    );
  });

  it('mensagens de erro user-facing não vazam segredos nem stack trace', () => {
    const errors = [
      { error: 'Não foi possível autenticar.' },
      { error: 'permission_denied' },
      { error: 'STALE_VERSION', message: 'Outro admin atualizou.' },
      { error: 'INVALID_FILE_TYPE' },
    ];
    for (const e of errors) {
      expect(() => expectNoSecrets(e)).not.toThrow();
    }
  });
});

describe('Property 11 — detecção positiva (garante que não é no-op)', () => {
  it('rejeita payload que contém JWT', () => {
    const leak = {
      user: 'x',
      session: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcDEFghiJKLmnoPQRst',
    };
    expect(() => expectNoSecrets(leak)).toThrow();
  });

  it('rejeita payload com campo password/token preenchido', () => {
    expect(() => expectNoSecrets({ password: 'minhaSenha123!' })).toThrow();
    expect(() => expectNoSecrets({ api_key: 'qualquer-coisa-aqui' })).toThrow();
  });

  it('rejeita resposta com stack trace', () => {
    const serverError = {
      error: 'internal',
      detail: 'TypeError: x is undefined\n    at handler (/app/src/api.ts:42:10)',
    };
    expect(() => expectNoSecrets(serverError)).toThrow();
  });
});

describe('logs estruturados não vazam segredos', () => {
  it('linha de log válida passa; linha com token falha', () => {
    expect(() =>
      expectStructuredLog({
        level: 'info',
        ts: '2026-06-05T12:00:00Z',
        module: 'auth',
        msg: 'login ok',
      })
    ).not.toThrow();
    expect(() =>
      expectStructuredLog({
        level: 'error',
        ts: '2026-06-05T12:00:00Z',
        token: 'sb_secret_bXyU0cKxVFWXHu51aR8AnDy4Uym',
      })
    ).toThrow();
  });
});
