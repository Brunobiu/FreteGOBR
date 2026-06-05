/**
 * Testes da detecção de compatibilidade de contrato (Tarefa 24).
 *
 * Property 13: mudança compatível NÃO falha; incompatível SEMPRE falha.
 *
 * Validates: Requirements 24.2, 24.3, 24.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { diffSchemas, formatBreaking, type SchemaSpec } from './schemaCompat';

const BASELINE: SchemaSpec = {
  id: { type: 'string', required: true },
  user_type: { type: 'string', required: true, enum: ['motorista', 'embarcador'] },
  name: { type: 'string', required: true },
  email: { type: 'string', required: false },
  is_active: { type: 'boolean', required: true },
};

describe('Property 13 — mudanças compatíveis NÃO falham', () => {
  it('adicionar campo opcional é compatível', () => {
    const current: SchemaSpec = { ...BASELINE, nickname: { type: 'string', required: false } };
    const diff = diffSchemas(BASELINE, current);
    expect(diff.breaking, formatBreaking(diff)).toHaveLength(0);
    expect(diff.compatible.length).toBeGreaterThan(0);
  });

  it('adicionar valor de enum é compatível', () => {
    const current: SchemaSpec = {
      ...BASELINE,
      user_type: { type: 'string', required: true, enum: ['motorista', 'embarcador', 'admin'] },
    };
    const diff = diffSchemas(BASELINE, current);
    expect(diff.breaking).toHaveLength(0);
  });

  it('schema idêntico não tem breaking nem compatible', () => {
    const diff = diffSchemas(BASELINE, { ...BASELINE });
    expect(diff.breaking).toHaveLength(0);
    expect(diff.compatible).toHaveLength(0);
  });
});

describe('Property 13 — mudanças incompatíveis SEMPRE falham', () => {
  it('remover campo é breaking', () => {
    const { email: _omit, ...current } = BASELINE;
    void _omit;
    const diff = diffSchemas(BASELINE, current);
    expect(diff.breaking.some((b) => b.includes('email'))).toBe(true);
  });

  it('mudar tipo de campo é breaking', () => {
    const current: SchemaSpec = { ...BASELINE, is_active: { type: 'string', required: true } };
    const diff = diffSchemas(BASELINE, current);
    expect(diff.breaking.some((b) => b.includes('is_active'))).toBe(true);
  });

  it('tornar opcional obrigatório é breaking', () => {
    const current: SchemaSpec = { ...BASELINE, email: { type: 'string', required: true } };
    const diff = diffSchemas(BASELINE, current);
    expect(diff.breaking.some((b) => b.includes('email'))).toBe(true);
  });

  it('novo campo obrigatório é breaking', () => {
    const current: SchemaSpec = { ...BASELINE, cpf: { type: 'string', required: true } };
    const diff = diffSchemas(BASELINE, current);
    expect(diff.breaking.some((b) => b.includes('cpf'))).toBe(true);
  });

  it('remover valor de enum é breaking', () => {
    const current: SchemaSpec = {
      ...BASELINE,
      user_type: { type: 'string', required: true, enum: ['motorista'] },
    };
    const diff = diffSchemas(BASELINE, current);
    expect(diff.breaking.some((b) => b.includes('user_type'))).toBe(true);
  });
});

describe('Property — adicionar campo opcional nunca gera breaking (aleatório)', () => {
  it('qualquer conjunto de novos campos opcionais é compatível', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !(s in BASELINE)),
            type: fc.constantFrom('string', 'number', 'boolean' as const),
          }),
          { maxLength: 5 }
        ),
        (extras) => {
          const current: SchemaSpec = { ...BASELINE };
          for (const e of extras) {
            current[e.name] = { type: e.type, required: false };
          }
          const diff = diffSchemas(BASELINE, current);
          expect(diff.breaking).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
