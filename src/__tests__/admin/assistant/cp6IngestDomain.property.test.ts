// Feature: admin-assistant, Property 6
/**
 * CP-6: Ingestao particiona o lote pelo dominio fechado de Error_Type
 *
 * Para todo lote de itens de erro com `error_type` arbitrario,
 * partitionErrorBatch aceita EXATAMENTE os itens cujo `error_type` pertence
 * ao dominio fechado de Error_Type e rejeita os demais, com
 * `valid.length + rejected.length === total` e NENHUM item de tipo invalido
 * em `valid`.
 *
 * Espelha a validacao item-a-item da Error_Ingest_RPC
 * (rpc_assistant_ingest_errors), que rejeita o item invalido sem abortar a
 * transacao.
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 3.9, 3.10
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { partitionErrorBatch, type ErrorType } from '../../../services/admin/assistant';

// Dominio fechado de Error_Type (oraculo independente do helper sob teste).
const VALID_ERROR_TYPES: ReadonlySet<string> = new Set<string>([
  'react_render',
  'window_error',
  'unhandled_rejection',
  'console_error',
  'request_failure',
]);

// ----- Geradores -----

// error_type valido sorteado do dominio fechado.
const validErrorTypeGen = fc.constantFrom<ErrorType>(
  'react_render',
  'window_error',
  'unhandled_rejection',
  'console_error',
  'request_failure'
);

// error_type arbitrario: mistura de validos, vizinhos proximos (case,
// espacos, nomes parecidos) e strings aleatorias, para exercitar tanto o
// ramo aceito quanto o rejeitado.
const anyErrorTypeGen = fc.oneof(
  validErrorTypeGen,
  fc.constantFrom('React_Render', 'WINDOW_ERROR', ' console_error', 'rejection', '', 'fetch_fail'),
  fc.string({ minLength: 0, maxLength: 30 })
);

// Item de lote com `error_type` arbitrario + um campo extra para garantir
// que a particao preserva o item intacto (sem mutar nem perder campos).
const batchItemGen = fc.record({
  error_type: anyErrorTypeGen,
  message: fc.string({ minLength: 0, maxLength: 40 }),
});

const batchGen = fc.array(batchItemGen, { minLength: 0, maxLength: 50 });

describe('CP-6: Ingestao particiona o lote pelo dominio fechado de Error_Type', () => {
  it('aceita exatamente os tipos do dominio e rejeita o resto; soma preservada', () => {
    fc.assert(
      fc.property(batchGen, (items) => {
        const { valid, rejected } = partitionErrorBatch(items);

        // Soma preservada: nenhum item perdido ou duplicado.
        expect(valid.length + rejected.length).toBe(items.length);

        // Nenhum tipo invalido entrou em `valid`.
        for (const item of valid) {
          expect(VALID_ERROR_TYPES.has(item.error_type)).toBe(true);
        }

        // Todo item rejeitado tem tipo fora do dominio.
        for (const item of rejected) {
          expect(VALID_ERROR_TYPES.has(item.error_type)).toBe(false);
        }

        // Particao corresponde exatamente ao oraculo de dominio.
        const expectedValid = items.filter((i) => VALID_ERROR_TYPES.has(i.error_type));
        const expectedRejected = items.filter((i) => !VALID_ERROR_TYPES.has(i.error_type));
        expect(valid).toEqual(expectedValid);
        expect(rejected).toEqual(expectedRejected);
      }),
      { numRuns: 100 }
    );
  });
});
