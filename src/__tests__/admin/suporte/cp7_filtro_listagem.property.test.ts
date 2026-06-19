/**
 * Property-Based Test — CP7* (opcional): filtro, ordenação e paginação.
 *
 * // Feature: suporte-inteligente, Property 7: todo item retornado satisfaz
 * // todos os critérios ativos; a página tem no máximo pageSize itens; a
 * // ordenação inicial é não-crescente por created_at.
 *
 * Alvo: src/services/admin/suporte/listFilter.ts (filterSortPaginate).
 *
 * Validates: Requirements 2.5, 2.6, 2.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  filterSortPaginate,
  matchesFilter,
  PAGE_SIZES,
  type SupportTicketLite,
  type SupportFilterCriteria,
} from '../../../services/admin/suporte/listFilter';
import { TICKET_STATUSES } from '../../../services/admin/suporte/statusMachine';

const ticketArb = (): fc.Arbitrary<SupportTicketLite> =>
  fc.record({
    status: fc.constantFrom(...TICKET_STATUSES),
    priorityLevel: fc.constantFrom(1 as const, 2 as const, 3 as const),
    responderMode: fc.constantFrom('ai' as const, 'human' as const),
    createdAt: fc
      .integer({ min: 1_600_000_000_000, max: 1_800_000_000_000 })
      .map((ms) => new Date(ms).toISOString()),
    subject: fc.constantFrom('Cobrança', 'Erro no app', 'Dúvida de plano', 'Outro assunto'),
    clientName: fc.constantFrom('Ana', 'Bruno', null),
    clientEmail: fc.constantFrom('a@x.com', 'b@y.com', null),
  });

const criteriaArb = (): fc.Arbitrary<SupportFilterCriteria> =>
  fc.record({
    status: fc.option(fc.constantFrom(...TICKET_STATUSES), { nil: null }),
    priorityLevel: fc.option(fc.constantFrom(1 as const, 2 as const, 3 as const), { nil: null }),
    responderMode: fc.option(fc.constantFrom('ai' as const, 'human' as const), { nil: null }),
    search: fc.option(fc.constantFrom('cobr', 'app', 'plano', 'ana'), { nil: null }),
  });

describe('CP7* — filtro/ordenação/paginação', () => {
  it('toda página satisfaz os critérios, respeita pageSize e ordena por created_at desc', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArb(), { maxLength: 60 }),
        criteriaArb(),
        fc.constantFrom(...PAGE_SIZES),
        fc.integer({ min: 0, max: 5 }),
        (items, criteria, pageSize, page) => {
          const { items: pageItems, total } = filterSortPaginate(items, criteria, page, pageSize);

          // (a) cada item satisfaz TODOS os critérios ativos.
          for (const it of pageItems) expect(matchesFilter(it, criteria)).toBe(true);

          // (b) página tem no máximo pageSize itens.
          expect(pageItems.length).toBeLessThanOrEqual(pageSize);

          // (c) ordenação não-crescente por created_at.
          for (let i = 1; i < pageItems.length; i++) {
            expect(pageItems[i - 1].createdAt >= pageItems[i].createdAt).toBe(true);
          }

          // (d) total = nº de itens que casam o filtro (independe da página).
          expect(total).toBe(items.filter((it) => matchesFilter(it, criteria)).length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
