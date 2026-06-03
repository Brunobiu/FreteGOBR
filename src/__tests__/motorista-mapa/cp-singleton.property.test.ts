/**
 * cp-singleton.property.test.ts
 *
 * Property-based tests do estado puro de selecao de pino do
 * `MotoristaMapaFullscreen`. Cobre:
 *  - Property B: seleção é singleton.
 *  - Property D: idempotência de SELECT do mesmo frete.
 *  - Property E: confluence de seleções consecutivas (último vence).
 *  - Property H: fade restaura todos para 'default' apos CLEAR.
 *
 * Aqui testamos APENAS funcoes puras de estado/derivacao — nao
 * monta componente, nao usa Leaflet, nao usa rede. Cada propriedade
 * roda 100+ runs e usa `fc.constantFrom` com fretes mock fixos
 * (convencao do projeto: nada de coordenadas aleatorias quando
 * nao for relevante).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Tipos minimos (espelham o que o componente vai expor) ----------

type FreteMock = { id: string };

type SelectionState = {
  selectedRouteFrete: FreteMock | null;
};

type PinState = 'default' | 'selected' | 'faded';

// --- Reducer puro ---------------------------------------------------
// Action SELECT(f) é idempotente: aplicada duas vezes seguidas em f
// retorna o mesmo objeto de estado por igualdade referencial. Action
// CLEAR é idempotente da mesma forma.

type Action = { type: 'SELECT'; frete: FreteMock } | { type: 'CLEAR' };

const initialState: SelectionState = { selectedRouteFrete: null };

function reducer(state: SelectionState, action: Action): SelectionState {
  switch (action.type) {
    case 'SELECT': {
      // Idempotencia: se ja esta selecionado, retorna o mesmo state.
      if (state.selectedRouteFrete?.id === action.frete.id) {
        return state;
      }
      return { selectedRouteFrete: action.frete };
    }
    case 'CLEAR': {
      if (state.selectedRouteFrete === null) {
        return state;
      }
      return { selectedRouteFrete: null };
    }
  }
}

// Funcao de derivacao do estado visual do pino (singleton + fade).
function getPinState(pin: FreteMock, state: SelectionState): PinState {
  if (state.selectedRouteFrete === null) return 'default';
  if (state.selectedRouteFrete.id === pin.id) return 'selected';
  return 'faded';
}

// --- Geradores de mock ----------------------------------------------

const FRETES_MOCK: FreteMock[] = [
  { id: 'frete-1' },
  { id: 'frete-2' },
  { id: 'frete-3' },
  { id: 'frete-4' },
  { id: 'frete-5' },
];

const freteArb = fc.constantFrom(...FRETES_MOCK);

const actionArb = fc.oneof(
  freteArb.map((frete) => ({ type: 'SELECT', frete }) as Action),
  fc.constant({ type: 'CLEAR' } as Action)
);

const actionsArb = fc.array(actionArb, { minLength: 0, maxLength: 50 });

// --- Properties ----------------------------------------------------

describe('motorista-mapa: pin selection state', () => {
  it('Property B: no maximo um pino selecionado em qualquer estado alcancavel', () => {
    fc.assert(
      fc.property(actionsArb, (actions) => {
        const finalState = actions.reduce(reducer, initialState);
        const states = FRETES_MOCK.map((p) => getPinState(p, finalState));
        const selectedCount = states.filter((s) => s === 'selected').length;
        // Singleton: no maximo um pino com 'selected'.
        expect(selectedCount === 0 || selectedCount === 1).toBe(true);
        // Quando ha selecao, todos os outros pinos visiveis devem
        // estar em 'faded'.
        if (selectedCount === 1) {
          const fadedCount = states.filter((s) => s === 'faded').length;
          expect(fadedCount).toBe(FRETES_MOCK.length - 1);
        } else {
          // Sem selecao: todos em 'default'.
          const defaultCount = states.filter((s) => s === 'default').length;
          expect(defaultCount).toBe(FRETES_MOCK.length);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('Property D: SELECT(f) e idempotente — chamar duas vezes e equivalente a uma', () => {
    fc.assert(
      fc.property(actionsArb, freteArb, (prefix, frete) => {
        const base = prefix.reduce(reducer, initialState);
        const oneSelect = reducer(base, { type: 'SELECT', frete });
        const twoSelects = reducer(oneSelect, { type: 'SELECT', frete });
        // Igualdade referencial: o segundo SELECT do mesmo frete
        // retorna o mesmo objeto de state (sem alocar novo).
        expect(twoSelects).toBe(oneSelect);
      }),
      { numRuns: 200 }
    );
  });

  it('Property D: CLEAR e idempotente — chamar duas vezes e equivalente a uma', () => {
    fc.assert(
      fc.property(actionsArb, (prefix) => {
        const base = prefix.reduce(reducer, initialState);
        const oneClear = reducer(base, { type: 'CLEAR' });
        const twoClears = reducer(oneClear, { type: 'CLEAR' });
        expect(twoClears).toBe(oneClear);
      }),
      { numRuns: 200 }
    );
  });

  it('Property E: confluence — SELECT(fA) seguido de SELECT(fB) tem o mesmo estado final que SELECT(fB) sozinho', () => {
    fc.assert(
      fc.property(freteArb, freteArb, (fA, fB) => {
        const path1 = [
          { type: 'SELECT', frete: fA } as const,
          { type: 'SELECT', frete: fB } as const,
        ].reduce<SelectionState>(reducer, initialState);
        const path2 = reducer(initialState, { type: 'SELECT', frete: fB });
        expect(path1.selectedRouteFrete?.id).toBe(path2.selectedRouteFrete?.id);
      }),
      { numRuns: 200 }
    );
  });

  it('Property H: fade restaura — apos CLEAR todos os pinos voltam pra default', () => {
    fc.assert(
      fc.property(actionsArb, (actions) => {
        const beforeClear = actions.reduce(reducer, initialState);
        const afterClear = reducer(beforeClear, { type: 'CLEAR' });
        const states = FRETES_MOCK.map((p) => getPinState(p, afterClear));
        // Todos em 'default' apos CLEAR — sem fade residual.
        const allDefault = states.every((s) => s === 'default');
        expect(allDefault).toBe(true);
      }),
      { numRuns: 200 }
    );
  });
});
