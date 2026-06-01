// Feature: admin-assistant, Property 3
/**
 * CP-3: Forma e dominio do Error_Log capturado
 *
 * Para todo erro capturado (mensagem, stack opcional, rota, sessao opcional,
 * tipo gerado dentro do dominio fechado), o draft produzido por
 * `buildErrorDraft` contem:
 *  - `occurredAt`: timestamp ISO valido (round-trip canonico via Date);
 *  - `errorType`: pertencente ao dominio fechado (ERROR_TYPES);
 *  - `route`: string;
 *  - `affectedUserId`: string OU null, sem falhar quando nao ha sessao;
 *  - `stack`: string OU null.
 *
 * Convencoes de PBT do projeto (project-conventions.md):
 *  - `errorTypeGen = fc.constantFrom(...)` para o dominio fechado;
 *  - sem `fc.stringOf` (usa `fc.string`);
 *  - `numRuns: 100`.
 *
 * O modulo errorCapture importa o client unico (`../supabase`); mockamos para
 * evitar a criacao de um client real durante o teste (buildErrorDraft e puro e
 * nao toca a rede).
 *
 * Validates: Requirements 3.5, 3.6
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Mock hoist-safe do client unico: buildErrorDraft nao usa rpc, mas o import
// no topo de errorCapture criaria um client real. Factory sem variaveis
// externas (convencao do projeto).
vi.mock('../../../services/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve({ error: null }),
  },
}));

import {
  buildErrorDraft,
  ERROR_TYPES,
  type ErrorType,
  type ErrorDraftInput,
} from '../../../services/admin/errorCapture';

// ----- Geradores -----

// Dominio fechado de Error_Type.
const errorTypeGen = fc.constantFrom<ErrorType>(...ERROR_TYPES);

// Epoch-millis dentro de um range valido (1970..2100), para Date sempre valido.
const validDateGen = fc.integer({ min: 0, max: 4102444800000 }).map((ms) => new Date(ms));

// `occurredAt` cobre: ausente (undefined), Date valido, string ISO, string
// arbitraria (possivelmente invalida -> fallback "agora") e null.
const occurredAtGen = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  validDateGen,
  validDateGen.map((d) => d.toISOString()),
  fc.string({ minLength: 0, maxLength: 30 })
);

// Entrada bruta arbitraria. Campos opcionais usam `fc.option`, incluindo o
// caso "sem sessao" (`affectedUserId` undefined/null).
const draftInputGen: fc.Arbitrary<ErrorDraftInput> = fc.record({
  errorType: errorTypeGen,
  message: fc.option(fc.string({ minLength: 0, maxLength: 80 }), { nil: undefined }),
  stack: fc.option(fc.string({ minLength: 0, maxLength: 120 }), { nil: null }),
  route: fc.option(fc.string({ minLength: 0, maxLength: 60 }), { nil: undefined }),
  affectedUserId: fc.option(fc.string({ minLength: 1, maxLength: 36 }), { nil: undefined }),
  occurredAt: occurredAtGen,
});

const ERROR_TYPE_SET: ReadonlySet<string> = new Set<string>(ERROR_TYPES);

describe('CP-3: forma e dominio do Error_Log (buildErrorDraft)', () => {
  it('sempre produz occurredAt ISO, errorType no dominio, route string e stack/userId string|null', () => {
    fc.assert(
      fc.property(draftInputGen, (input) => {
        // Nunca lança, mesmo sem sessao ou com occurredAt invalido (Req 3.6).
        const draft = buildErrorDraft(input);

        // occurredAt: ISO valido e canonico (round-trip).
        const parsed = new Date(draft.occurredAt);
        expect(Number.isNaN(parsed.getTime())).toBe(false);
        expect(parsed.toISOString()).toBe(draft.occurredAt);

        // errorType: preservado e dentro do dominio fechado.
        expect(draft.errorType).toBe(input.errorType);
        expect(ERROR_TYPE_SET.has(draft.errorType)).toBe(true);

        // route: sempre string (usa a entrada quando string, senao deriva).
        expect(typeof draft.route).toBe('string');
        if (typeof input.route === 'string') {
          expect(draft.route).toBe(input.route);
        }

        // affectedUserId: string quando ha sessao, senao null (sem falhar).
        if (typeof input.affectedUserId === 'string') {
          expect(draft.affectedUserId).toBe(input.affectedUserId);
        } else {
          expect(draft.affectedUserId).toBeNull();
        }
        expect(draft.affectedUserId === null || typeof draft.affectedUserId === 'string').toBe(
          true
        );

        // stack: string quando fornecida, senao null.
        if (typeof input.stack === 'string') {
          expect(draft.stack).toBe(input.stack);
        } else {
          expect(draft.stack).toBeNull();
        }
        expect(draft.stack === null || typeof draft.stack === 'string').toBe(true);

        // message: normalizada sempre para string (invariante de robustez).
        expect(typeof draft.message).toBe('string');
      }),
      { numRuns: 100 }
    );
  });
});
