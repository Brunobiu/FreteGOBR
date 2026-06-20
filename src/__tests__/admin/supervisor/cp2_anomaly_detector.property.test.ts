// Feature: admin-ia-supervisora, Property 2: Determinismo do Anomaly_Detector.
//
// Para qualquer snapshot, detectAnomalies produz sempre o mesmo conjunto; toda
// anomalia tem severidade do mapa; campo de fonte ausente (undefined) => zero
// anomalias daquele tipo (omissão sem fabricação).
//
// Validates: Requirements 5.1, 5.2, 5.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { detectAnomalies } from '../../../services/admin/supervisor/anomalyDetector';
import { anomalySnapshotGen } from './_generators';

describe('CP2 supervisor: Anomaly_Detector determinístico', () => {
  it('determinismo: mesma entrada => mesma saída (ordenada por dedupKey)', () => {
    fc.assert(
      fc.property(anomalySnapshotGen, (snap) => {
        const a = detectAnomalies(snap);
        const b = detectAnomalies(snap);
        expect(a).toEqual(b);
        // ordenação estável por dedupKey
        const keys = a.map((x) => x.dedupKey);
        expect(keys).toEqual([...keys].sort((x, y) => x.localeCompare(y)));
      }),
      { numRuns: 200 }
    );
  });

  it('toda anomalia de diagnóstico tem occurrenceCount >= threshold e tipo válido', () => {
    fc.assert(
      fc.property(anomalySnapshotGen, (snap) => {
        const out = detectAnomalies(snap);
        for (const item of out) {
          expect(['ANOMALY', 'SECURITY']).toContain(item.insightType);
          expect(['CRITICAL', 'WARNING', 'INFO']).toContain(item.severity);
        }
        // o nº de anomalias de diagnóstico = nº de diagnósticos acima do threshold
        const threshold = Math.max(1, snap.config.errorThreshold);
        const expectedDiag = (snap.diagnostics ?? []).filter(
          (d) => d.occurrenceCount >= threshold
        ).length;
        expect(out.filter((x) => x.insightType === 'ANOMALY').length).toBe(expectedDiag);
      }),
      { numRuns: 200 }
    );
  });

  it('fonte ausente (undefined) => zero anomalias daquele tipo (sem fabricar)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (threshold) => {
        // sem diagnostics nem alertas => nenhuma anomalia
        expect(detectAnomalies({ config: { errorThreshold: threshold } })).toEqual([]);
        // sem diagnostics, só alertas => nenhuma ANOMALY (só SECURITY)
        const out = detectAnomalies({
          openCriticalAlerts: [{ dedupKey: 'k1', alertType: 'X' }],
          config: { errorThreshold: threshold },
        });
        expect(out.every((x) => x.insightType === 'SECURITY')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
