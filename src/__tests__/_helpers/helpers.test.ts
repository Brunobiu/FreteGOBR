/**
 * Testes dos helpers compartilhados da spec `testes` (Tarefas 1 e 2).
 *
 * Garante que geradores produzem valores no formato esperado e que as
 * assertions canônicas aprovam o caso correto e reprovam o errado.
 *
 * Validates: Requirements 1.5, 3.6, 16.5, 7.6, 7.7, 7.8, 19.1, 19.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validCpf,
  invalidCpf,
  validCnpj,
  validPhone,
  validEmail,
  safeText,
  financialAmount,
  validFinancialAmount,
  uuidLike,
} from './generators';
import {
  extractErrorCode,
  expectPermissionDenied,
  expectRejectsPermissionDenied,
} from './authAssertions';
import {
  CANONICAL_MESSAGES,
  expectAntiEnumeration,
  expectIndistinguishable,
} from './antiEnumeration';
import { expectNoSecrets, expectStructuredLog } from './logAssertions';

describe('generators', () => {
  it('validCpf produz CPF no formato 000.000.000-00', () => {
    fc.assert(
      fc.property(validCpf(), (cpf) => {
        expect(cpf).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
      })
    );
  });

  it('validCnpj produz CNPJ no formato 00.000.000/0000-00', () => {
    fc.assert(
      fc.property(validCnpj(), (cnpj) => {
        expect(cnpj).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
      })
    );
  });

  it('validPhone produz telefone BR com DDD 11-99', () => {
    fc.assert(
      fc.property(validPhone(), (phone) => {
        const digits = phone.replace(/\D/g, '');
        expect(digits.length === 10 || digits.length === 11).toBe(true);
        const ddd = parseInt(digits.slice(0, 2), 10);
        expect(ddd).toBeGreaterThanOrEqual(11);
        expect(ddd).toBeLessThanOrEqual(99);
      })
    );
  });

  it('validEmail produz e-mail com @ e domínio', () => {
    fc.assert(
      fc.property(validEmail(), (email) => {
        expect(email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
      })
    );
  });

  it('invalidCpf inclui valores reconhecidamente inválidos', () => {
    fc.assert(
      fc.property(invalidCpf(), (cpf) => {
        // Todos têm DV inválido, formato errado ou são vazios.
        const isRepeated = /^(\d)\.?\1/.test(cpf.replace(/\D/g, '').slice(0, 2));
        expect(cpf === '' || cpf.length < 14 || isRepeated || cpf === '123.456.789-00').toBe(true);
      })
    );
  });

  it('safeText respeita os limites e nunca é só espaço', () => {
    fc.assert(
      fc.property(safeText(3, 20), (s) => {
        expect(s.trim().length).toBeGreaterThanOrEqual(3);
        expect(s.trim().length).toBeLessThanOrEqual(20);
      })
    );
  });

  it('financialAmount eventualmente gera extremos perigosos', () => {
    // Coleta uma amostra e confirma que NaN/Infinity aparecem no conjunto.
    const seen = new Set<string>();
    fc.assert(
      fc.property(financialAmount(), (n) => {
        if (Number.isNaN(n)) seen.add('NaN');
        else if (n === Infinity) seen.add('Infinity');
        else if (n === -Infinity) seen.add('-Infinity');
        return true;
      }),
      { numRuns: 500 }
    );
    expect(seen.size).toBeGreaterThan(0);
  });

  it('validFinancialAmount nunca é NaN/Infinity e é >= 0', () => {
    fc.assert(
      fc.property(validFinancialAmount(), (n) => {
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('uuidLike produz formato UUID v4', () => {
    fc.assert(
      fc.property(uuidLike(), (id) => {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      })
    );
  });
});

describe('authAssertions', () => {
  it('extractErrorCode lê string, .code, .error e .message', () => {
    expect(extractErrorCode('permission_denied')).toBe('permission_denied');
    expect(extractErrorCode({ code: 'permission_denied' })).toBe('permission_denied');
    expect(extractErrorCode({ error: 'permission_denied' })).toBe('permission_denied');
    expect(extractErrorCode({ message: 'permission_denied: X' })).toBe('permission_denied: X');
    expect(extractErrorCode(null)).toBe('');
  });

  it('expectPermissionDenied aprova o caso correto', () => {
    expect(() => expectPermissionDenied({ code: 'permission_denied' })).not.toThrow();
    expect(() =>
      expectPermissionDenied({ message: 'permission_denied: MODULE_EDIT required' })
    ).not.toThrow();
  });

  it('expectPermissionDenied reprova outro código', () => {
    expect(() => expectPermissionDenied({ code: 'STALE_VERSION' })).toThrow();
    expect(() => expectPermissionDenied('validation_error')).toThrow();
  });

  it('expectRejectsPermissionDenied aprova Promise rejeitada com o código', async () => {
    await expectRejectsPermissionDenied(Promise.reject({ code: 'permission_denied' }));
  });

  it('expectRejectsPermissionDenied falha se a Promise resolver', async () => {
    await expect(expectRejectsPermissionDenied(Promise.resolve('ok'))).rejects.toThrow();
  });
});

describe('antiEnumeration', () => {
  it('expectAntiEnumeration aprova mensagem canônica', () => {
    expect(() => expectAntiEnumeration(CANONICAL_MESSAGES.AUTH, 'AUTH')).not.toThrow();
    expect(() => expectAntiEnumeration(CANONICAL_MESSAGES.SIGNUP, 'SIGNUP')).not.toThrow();
    expect(() => expectAntiEnumeration(CANONICAL_MESSAGES.CODE, 'CODE')).not.toThrow();
  });

  it('expectAntiEnumeration reprova mensagem divergente', () => {
    expect(() => expectAntiEnumeration('Senha incorreta para fulano', 'AUTH')).toThrow();
  });

  it('expectIndistinguishable aprova respostas iguais e reprova diferentes', () => {
    expect(() =>
      expectIndistinguishable(
        { message: CANONICAL_MESSAGES.AUTH, status: 401 },
        { message: CANONICAL_MESSAGES.AUTH, status: 401 }
      )
    ).not.toThrow();
    expect(() =>
      expectIndistinguishable(
        { message: 'Usuário existe', status: 401 },
        { message: 'Usuário não existe', status: 404 }
      )
    ).toThrow();
  });
});

describe('logAssertions', () => {
  it('expectNoSecrets aprova conteúdo limpo', () => {
    expect(() => expectNoSecrets({ ok: true, name: 'João', city: 'Goiânia' })).not.toThrow();
    expect(() => expectNoSecrets('frete publicado com sucesso')).not.toThrow();
  });

  it('expectNoSecrets detecta JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKLmno';
    expect(() => expectNoSecrets({ token: jwt })).toThrow();
  });

  it('expectNoSecrets detecta service key e resend key', () => {
    expect(() => expectNoSecrets('sb_secret_bXyU0cKxVFWXHu51aR8AnDy4Uym')).toThrow();
    expect(() => expectNoSecrets('chave: re_abcd1234efgh5678ijkl')).toThrow();
  });

  it('expectNoSecrets detecta stack trace', () => {
    expect(() => expectNoSecrets('Error: x\n    at foo (/app/src/x.ts:10:5)')).toThrow();
  });

  it('expectStructuredLog exige level e ts', () => {
    expect(() =>
      expectStructuredLog({ level: 'info', ts: '2026-06-05T00:00:00Z', module: 'auth' })
    ).not.toThrow();
    expect(() => expectStructuredLog({ msg: 'sem level nem ts' })).toThrow();
  });
});
