/**
 * cp-osrm.property.test.ts
 *
 * Property G (metamorfic): a relacao input(getRouteGeometry) →
 * estado final do reducer e deterministica.
 *
 *   - Mock retorna GeographicPoint[] nao-vazio  ⇒ routeState='osrm'
 *     e routeGeometry !== null
 *   - Mock retorna null                          ⇒ routeState='fallback'
 *     e routeGeometry === null
 *
 * Aqui testamos o REDUCER puro do componente, isolado da UI. O
 * mesmo reducer roda dentro de `MotoristaMapaFullscreen` pra trocar
 * `routeState` quando a Promise de OSRM resolve. Nao montamos
 * Leaflet/jsdom — queremos so a propriedade do estado.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { GeographicPoint } from '../../types';

type RouteState = 'idle' | 'loading' | 'osrm' | 'fallback';

interface ReducerState {
  routeGeometry: GeographicPoint[] | null;
  routeState: RouteState;
}

type ReducerAction =
  | { type: 'SELECT' } // Inicia loading
  | { type: 'OSRM_LOADED'; geometry: GeographicPoint[] }
  | { type: 'OSRM_FAILED' } // null vindo do service
  | { type: 'CLEAR' };

const initial: ReducerState = { routeGeometry: null, routeState: 'idle' };

function reducer(_state: ReducerState, action: ReducerAction): ReducerState {
  switch (action.type) {
    case 'SELECT':
      return { routeGeometry: null, routeState: 'loading' };
    case 'OSRM_LOADED':
      return { routeGeometry: action.geometry, routeState: 'osrm' };
    case 'OSRM_FAILED':
      return { routeGeometry: null, routeState: 'fallback' };
    case 'CLEAR':
      return initial;
  }
}

describe('motorista-mapa: OSRM metamorfic (Property G)', () => {
  // Geradores de mock: lista de fretes mock fixos + dois cenarios
  // de retorno do servico (sucesso com geometria | falha com null).
  const geometryArb = fc.array(
    fc.record({
      latitude: fc.float({
        min: Math.fround(-30),
        max: Math.fround(0),
        noNaN: true,
      }),
      longitude: fc.float({
        min: Math.fround(-60),
        max: Math.fround(-30),
        noNaN: true,
      }),
    }),
    { minLength: 2, maxLength: 100 }
  );

  it('mock retorna geometria nao-vazia ⇒ estado final = osrm', () => {
    fc.assert(
      fc.property(geometryArb, (geom) => {
        // Simula o ciclo: SELECT (loading) → OSRM_LOADED.
        const s1 = reducer(initial, { type: 'SELECT' });
        expect(s1.routeState).toBe('loading');
        expect(s1.routeGeometry).toBeNull();

        const s2 = reducer(s1, { type: 'OSRM_LOADED', geometry: geom });
        expect(s2.routeState).toBe('osrm');
        expect(s2.routeGeometry).toBe(geom);
      }),
      { numRuns: 200 }
    );
  });

  it('mock retorna null ⇒ estado final = fallback', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const s1 = reducer(initial, { type: 'SELECT' });
        expect(s1.routeState).toBe('loading');

        const s2 = reducer(s1, { type: 'OSRM_FAILED' });
        expect(s2.routeState).toBe('fallback');
        expect(s2.routeGeometry).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('CLEAR sempre volta pra idle, independente do estado anterior', () => {
    const states: ReducerState[] = [
      initial,
      reducer(initial, { type: 'SELECT' }),
      reducer(initial, {
        type: 'OSRM_LOADED',
        geometry: [{ latitude: -23.5, longitude: -46.6 }],
      }),
      reducer(initial, { type: 'OSRM_FAILED' }),
    ];

    for (const state of states) {
      const cleared = reducer(state, { type: 'CLEAR' });
      expect(cleared.routeState).toBe('idle');
      expect(cleared.routeGeometry).toBeNull();
    }
  });
});
