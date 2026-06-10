/**
 * Property tests da normalização de identificadores do anti-reuso (Feature 4).
 *
 * Espelho TS puro da função SQL `legal_normalize_identifier` (migration 065).
 * O hash em si é sha256 determinístico no banco; aqui validamos a INVARIANTE
 * crítica: a normalização é estável a formatações (pontuação, espaços, DDI 55),
 * de modo que o MESMO telefone/CPF — escrito de formas diferentes — produz a
 * MESMA chave de bloqueio.
 *
 * Validates: anti-reuso por CPF/telefone independe de formatação.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/** Espelho de legal_normalize_identifier('phone'|'cpf', value). */
function normalize(type: 'phone' | 'cpf', value: string): string | null {
  let v = value.replace(/\D/g, '');
  if (type === 'phone') {
    if ((v.length === 12 || v.length === 13) && v.startsWith('55')) {
      v = v.slice(2);
    }
  }
  return v === '' ? null : v;
}

describe('normalize — telefone', () => {
  it('formatações do mesmo número normalizam igual (com e sem DDI 55)', () => {
    const variants = [
      '(11) 99999-0000',
      '11999990000',
      '+55 11 99999-0000',
      '5511999990000',
      '  11 9 9999 0000 ',
    ];
    const normed = variants.map((v) => normalize('phone', v));
    for (const n of normed) {
      expect(n).toBe('11999990000');
    }
  });

  it('Property: remover pontuação não muda a normalização', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('11999990000', '21988887777', '4733334444'),
        fc.constantFrom('(', ')', '-', ' ', '.'),
        (digits, sep) => {
          // Insere separadores arbitrários entre os dígitos.
          const formatted = digits.split('').join(sep);
          expect(normalize('phone', formatted)).toBe(digits);
        }
      )
    );
  });

  it('Property: prefixo DDI 55 (12-13 dígitos) é removido', () => {
    fc.assert(
      fc.property(fc.constantFrom('11999990000', '2133334444', '11988887777'), (local) => {
        const withDdi = '55' + local;
        expect(normalize('phone', withDdi)).toBe(local);
      })
    );
  });
});

describe('normalize — cpf', () => {
  it('formatações do mesmo CPF normalizam igual', () => {
    const variants = ['111.444.777-35', '11144477735', ' 111 444 777 35 '];
    for (const v of variants) {
      expect(normalize('cpf', v)).toBe('11144477735');
    }
  });

  it('CPF nunca remove prefixo 55 (regra é só de telefone)', () => {
    // Um CPF que por acaso começa com 55 deve permanecer intacto.
    expect(normalize('cpf', '555.444.777-35')).toBe('55544477735');
  });
});

describe('normalize — vazio', () => {
  it('valor sem dígitos vira null (não bloqueia)', () => {
    expect(normalize('phone', '   ')).toBeNull();
    expect(normalize('cpf', 'abc')).toBeNull();
  });
});
