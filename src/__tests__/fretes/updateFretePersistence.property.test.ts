/**
 * Teste de regressão (simulação de salvar) — updateFrete persiste TODOS os
 * campos editáveis no banco.
 *
 * CONTEXTO / BUG HISTÓRICO:
 * A edição de frete no painel do embarcador parou de salvar `originDetail`
 * (local de carregamento), `destinationDetail` (local de entrega) e os pins
 * do mapa, porque o handler de edição listava os campos um a um e esquecia
 * alguns. Este teste "simula o salvar": monta um payload completo, chama
 * `updateFrete`, captura o objeto que iria para o banco (`.update(...)`) e
 * garante que cada campo do formulário foi mapeado para a coluna correta.
 *
 * Se alguém futuramente esquecer de propagar um campo na edição (ou quebrar
 * o mapeamento camelCase → snake_case), este teste falha ANTES de ir pro ar.
 *
 * Property (CP): para todo payload válido P, o objeto enviado ao banco
 * contém TODAS as colunas snake_case esperadas com os valores de P.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// ----- Mock hoisted do supabase: captura o objeto do .update() -----
vi.mock('../../services/supabase', () => {
  const updateSpy = vi.fn();
  (globalThis as Record<string, unknown>).__ufUpdateSpy = updateSpy;

  return {
    supabase: {
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        builder.update = vi.fn((payload: Record<string, unknown>) => {
          updateSpy(payload);
          return builder;
        });
        // `.eq(...)` finaliza a cadeia e resolve sem erro.
        builder.eq = vi.fn().mockResolvedValue({ error: null });
        return builder;
      }),
    },
  };
});

import { updateFrete, type UpdateFreteData } from '../../services/fretes';

function getLastUpdatePayload(): Record<string, unknown> {
  const spy = (globalThis as Record<string, unknown>).__ufUpdateSpy as ReturnType<typeof vi.fn>;
  const calls = spy.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('updateFrete — persistência de todos os campos (simulação de salvar)', () => {
  beforeEach(() => {
    const spy = (globalThis as Record<string, unknown>).__ufUpdateSpy as ReturnType<typeof vi.fn>;
    spy.mockClear();
  });

  it('mapeia local de carregamento/entrega e pins do mapa para as colunas corretas', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          originDetail: fc.constantFrom('Fazenda São João', 'Pátio Central', 'Armazém 3'),
          destinationDetail: fc.constantFrom('Depósito Central', 'Doca 5', 'Silo Norte'),
          originPinnedLat: fc.double({ min: -33, max: 5, noNaN: true }),
          originPinnedLng: fc.double({ min: -73, max: -34, noNaN: true }),
          destinationPinnedLat: fc.double({ min: -33, max: 5, noNaN: true }),
          destinationPinnedLng: fc.double({ min: -73, max: -34, noNaN: true }),
        }),
        async (p) => {
          await updateFrete('frete-1', p as UpdateFreteData);
          const sent = getLastUpdatePayload();

          // Estes são exatamente os campos que o bug deixava de fora.
          expect(sent.origin_detail).toBe(p.originDetail);
          expect(sent.destination_detail).toBe(p.destinationDetail);
          expect(sent.origin_pinned_lat).toBe(p.originPinnedLat);
          expect(sent.origin_pinned_lng).toBe(p.originPinnedLng);
          expect(sent.destination_pinned_lat).toBe(p.destinationPinnedLat);
          expect(sent.destination_pinned_lng).toBe(p.destinationPinnedLng);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('persiste os principais dados da carga ao salvar a edição', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          cargoType: fc.constantFrom('Soja', 'Milho', 'Adubo'),
          product: fc.constantFrom('Soja em grãos', 'Milho seco'),
          weight: fc.integer({ min: 1, max: 50000 }),
          value: fc.integer({ min: 1, max: 999999 }),
          vehicleType: fc.constantFrom('Truck', 'Carreta', 'Bitrem'),
          paymentMethods: fc.constantFrom('Pix', 'Boleto', 'Pix, Boleto'),
          advancePercentage: fc.integer({ min: 0, max: 100 }),
        }),
        async (p) => {
          await updateFrete('frete-2', p as UpdateFreteData);
          const sent = getLastUpdatePayload();

          expect(sent.cargo_type).toBe(p.cargoType);
          expect(sent.product).toBe(p.product);
          expect(sent.weight).toBe(p.weight);
          expect(sent.value).toBe(p.value);
          expect(sent.vehicle_type).toBe(p.vehicleType);
          expect(sent.payment_methods).toBe(p.paymentMethods);
          expect(sent.advance_percentage).toBe(p.advancePercentage);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('não envia ao banco chaves de campos ausentes (update parcial seguro)', async () => {
    // Salvar apenas o status não deve sobrescrever outras colunas com undefined.
    await updateFrete('frete-3', { status: 'encerrado' });
    const sent = getLastUpdatePayload();

    expect(sent.status).toBe('encerrado');
    expect('origin_detail' in sent).toBe(false);
    expect('value' in sent).toBe(false);
    expect('cargo_type' in sent).toBe(false);
  });
});
