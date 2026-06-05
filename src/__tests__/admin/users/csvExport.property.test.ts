/**
 * Property-Based Tests — CSV export padrão admin (Tarefa 8).
 *
 * Cobre `exportUsersToCsvString` validando o padrão herdado
 * (project-conventions.md §CSV Export):
 *   - BOM UTF-8 (\uFEFF) prefixado quando withBom.
 *   - Separador ';' (Excel pt-BR).
 *   - Escape RFC 4180: campos com " ; \n \r entre aspas, aspa interna duplicada.
 *   - Quebra de linha \r\n.
 *
 * Validates: Requirements 5.6, 23.1
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { exportUsersToCsvString, type UserRow } from '../../../services/admin/users';

function makeRow(over: Partial<UserRow>): UserRow {
  return {
    id: 'u1',
    user_type: 'motorista',
    name: 'João',
    phone: '5562999998888',
    email: 'a@b.com',
    cpf: '11144477735',
    cnpj: null,
    company_name: null,
    is_active: true,
    ban_reason: null,
    banned_at: null,
    banned_by: null,
    profile_photo_url: null,
    admin_username: null,
    created_at: '2026-06-01T00:00:00Z',
    last_activity_at: null,
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

describe('exportUsersToCsvString — padrão CSV admin', () => {
  it('prefixa BOM UTF-8 quando withBom=true', () => {
    const csv = exportUsersToCsvString([makeRow({})], { separator: ';', withBom: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('não prefixa BOM quando withBom=false', () => {
    const csv = exportUsersToCsvString([makeRow({})], { separator: ';', withBom: false });
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('usa \\r\\n entre cabeçalho e linhas', () => {
    const csv = exportUsersToCsvString([makeRow({})], { separator: ';' });
    expect(csv).toContain('\r\n');
  });

  it('escapa campos com separador, aspas e quebras (RFC 4180)', () => {
    fc.assert(
      fc.property(fc.constantFrom('a;b', 'a"b', 'linha1\nlinha2', 'c\rd', 'normal'), (name) => {
        const csv = exportUsersToCsvString([makeRow({ name })], { separator: ';' });
        const needsQuote = /[";\n\r]/.test(name);
        if (needsQuote) {
          // O campo problemático aparece entre aspas, com aspa interna duplicada.
          const escaped = `"${name.replace(/"/g, '""')}"`;
          expect(csv).toContain(escaped);
        } else {
          expect(csv).toContain(name);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('cabeçalho tem 10 colunas separadas por ;', () => {
    const csv = exportUsersToCsvString([], { separator: ';', withBom: false });
    const header = csv.split('\r\n')[0];
    expect(header.split(';')).toHaveLength(10);
  });

  it('motorista exporta cpf; embarcador exporta cnpj na coluna cpf_or_cnpj', () => {
    const mot = exportUsersToCsvString([makeRow({ user_type: 'motorista', cpf: '11144477735' })], {
      separator: ';',
      withBom: false,
    });
    expect(mot).toContain('11144477735');

    const emb = exportUsersToCsvString(
      [makeRow({ user_type: 'embarcador', cpf: null, cnpj: '11222333000181' })],
      { separator: ';', withBom: false }
    );
    expect(emb).toContain('11222333000181');
  });

  it('campos null viram string vazia (sem "null" literal)', () => {
    const csv = exportUsersToCsvString([makeRow({ email: null, company_name: null })], {
      separator: ';',
      withBom: false,
    });
    expect(csv).not.toContain('null');
  });
});
