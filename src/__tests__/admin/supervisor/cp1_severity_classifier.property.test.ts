// Feature: admin-ia-supervisora, Property 1: Determinismo do Severity_Classifier.
//
// Para qualquer entrada de diagnóstico, classifySeverity é total e determinística
// (mesma entrada => mesma severidade) e respeita o mapa fixo (severidade de origem
// CRITICAL, módulo crítico ou occurrenceCount >= threshold => CRITICAL);
// notifyImmediately <=> CRITICAL.
//
// Validates: Requirements 4.1, 4.2, 4.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  classifySeverity,
  notifyImmediately,
  CRITICAL_MODULES_SET,
} from '../../../services/admin/supervisor/severityClassifier';
import { diagnosticInputGen } from './_generators';

describe('CP1 supervisor: Severity_Classifier determinístico e total', () => {
  it('determinismo: duas chamadas iguais => mesma severidade', () => {
    fc.assert(
      fc.property(diagnosticInputGen, (input) => {
        expect(classifySeverity(input)).toBe(classifySeverity(input));
      }),
      { numRuns: 200 }
    );
  });

  it('totalidade: sempre CRITICAL/WARNING/INFO', () => {
    fc.assert(
      fc.property(diagnosticInputGen, (input) => {
        expect(['CRITICAL', 'WARNING', 'INFO']).toContain(classifySeverity(input));
      }),
      { numRuns: 200 }
    );
  });

  it('regras fixas: origem CRITICAL / módulo crítico / recorrência alta => CRITICAL', () => {
    fc.assert(
      fc.property(diagnosticInputGen, (input) => {
        const sev = classifySeverity(input);
        const threshold = Math.max(1, input.criticalThreshold ?? 20);
        if (
          input.severity === 'CRITICAL' ||
          CRITICAL_MODULES_SET.has(input.module) ||
          input.occurrenceCount >= threshold
        ) {
          expect(sev).toBe('CRITICAL');
        }
        // notifyImmediately <=> CRITICAL
        expect(notifyImmediately(sev)).toBe(sev === 'CRITICAL');
      }),
      { numRuns: 300 }
    );
  });
});
