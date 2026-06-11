/**
 * Teste de regressão — commodities mapeia a segunda imagem (sem fundo).
 *
 * Garante que `image_no_bg_path` (coluna nova, migration 088) é mapeado para
 * `imageNoBgPath`/`imageNoBgUrl` no objeto CommodityCategory, e que ausência
 * (null) resulta em URL vazia. É a imagem que aparece no modal do frete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/supabase', () => {
  const orderSpy = vi.fn();
  (globalThis as Record<string, unknown>).__commOrderSpy = orderSpy;
  return {
    supabase: {
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.order = vi.fn(() => {
          // segunda chamada de .order encadeada resolve a Promise
          const spy = (globalThis as Record<string, unknown>).__commOrderSpy as ReturnType<
            typeof vi.fn
          >;
          (spy as unknown as () => void)();
          if (spy.mock.calls.length % 2 === 0) {
            return Promise.resolve({
              data: (globalThis as Record<string, unknown>).__commRows,
              error: null,
            });
          }
          return builder;
        });
        return builder;
      }),
      storage: {
        from: vi.fn(() => ({
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://pub/${path}` } }),
        })),
      },
    },
  };
});

import { listActiveCommodities } from '../../services/commodities';

describe('commodities — imagem sem fundo', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__commOrderSpy &&
      (
        (globalThis as Record<string, unknown>).__commOrderSpy as ReturnType<typeof vi.fn>
      ).mockClear();
  });

  it('mapeia image_no_bg_path para imageNoBgUrl quando presente', async () => {
    (globalThis as Record<string, unknown>).__commRows = [
      {
        id: '1',
        name: 'Soja',
        slug: 'soja',
        icon_path: 'soja.jpg',
        image_no_bg_path: 'soja_nobg.png',
        sort_order: 0,
        is_active: true,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ];
    const list = await listActiveCommodities();
    expect(list[0].imageNoBgPath).toBe('soja_nobg.png');
    expect(list[0].imageNoBgUrl).toBe('https://pub/soja_nobg.png');
  });

  it('imageNoBgUrl vazio quando não há segunda imagem (null)', async () => {
    (globalThis as Record<string, unknown>).__commRows = [
      {
        id: '2',
        name: 'Milho',
        slug: 'milho',
        icon_path: 'milho.jpg',
        image_no_bg_path: null,
        sort_order: 1,
        is_active: true,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ];
    const list = await listActiveCommodities();
    expect(list[0].imageNoBgPath).toBeNull();
    expect(list[0].imageNoBgUrl).toBe('');
  });
});
