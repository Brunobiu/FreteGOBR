// Feature: admin-ia-supervisora, Property 9: Totalidade do Question_Context_Plan.
//
// planIntents é total/determinística e retorna ao menos um intent (default
// OVERVIEW quando nada casa); palavras-chave conhecidas mapeiam para os intents
// corretos; a saída preserva a ordem de CONTEXT_INTENTS e não tem duplicatas.
//
// Validates: Requirements 2.1

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  planIntents,
  CONTEXT_INTENTS,
  type ContextIntent,
} from '../../../services/admin/supervisor/questionContextPlan';
import { questionGen } from './_generators';

describe('CP9 supervisor: Question_Context_Plan total e determinístico', () => {
  it('total: sempre >= 1 intent, determinístico, sem duplicatas, ordem estável', () => {
    fc.assert(
      fc.property(questionGen, (q) => {
        const a = planIntents(q);
        const b = planIntents(q);
        expect(a).toEqual(b); // determinístico
        expect(a.length).toBeGreaterThanOrEqual(1); // total
        // todos pertencem ao domínio
        for (const i of a) expect(CONTEXT_INTENTS).toContain(i);
        // sem duplicatas
        expect(new Set(a).size).toBe(a.length);
        // ordem estável (subsequência de CONTEXT_INTENTS)
        const idx = a.map((i) => CONTEXT_INTENTS.indexOf(i));
        expect(idx).toEqual([...idx].sort((x, y) => x - y));
      }),
      { numRuns: 300 }
    );
  });

  it('palavras-chave conhecidas mapeiam para o intent correto', () => {
    const cases: Array<[string, ContextIntent]> = [
      ['quantos usuários entraram hoje?', 'USERS'],
      ['qual o faturamento?', 'SUBSCRIPTIONS'],
      ['algum atendimento parado?', 'TICKETS'],
      ['quais instâncias de whatsapp caíram?', 'MESSAGES'],
      ['tem alerta crítico?', 'ALERTS'],
      ['algum erro recorrente?', 'DIAGNOSTICS'],
    ];
    for (const [q, intent] of cases) expect(planIntents(q)).toContain(intent);
  });

  it('sem palavra-chave => [OVERVIEW]', () => {
    expect(planIntents('bom dia, tudo certo?')).toEqual(['OVERVIEW']);
    expect(planIntents('')).toEqual(['OVERVIEW']);
  });
});
