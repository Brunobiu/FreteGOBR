/**
 * Testes de integração (mock) de `getFreteStatus` — spec chat-frete-conversa, tarefa 2.2.
 *
 * Valida:
 *   - Req 3.1: consulta `fretes` por id e mapeia status/source/value.
 *   - Req 3.5: em erro do Supabase, resolve `null` sem lançar (fail-safe → unknown).
 *
 * Convenção do projeto: `vi.mock` é hoisted — o resultado mutável é exposto via
 * `globalThis`, sem referenciar variáveis externas no factory.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getFreteStatus } from '../services/chatFrete';

// Mock do cliente Supabase: builder encadeável cujo `.single()` resolve o
// resultado configurado em `globalThis.__freteStatusResult`.
vi.mock('../services/supabase', () => {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.single = () => (globalThis as Record<string, unknown>).__freteStatusResult;
  return {
    supabase: {
      from: () => builder,
    },
  };
});

function setResult(r: unknown) {
  (globalThis as Record<string, unknown>).__freteStatusResult = Promise.resolve(r);
}

describe('getFreteStatus (chat-frete-conversa)', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__freteStatusResult;
  });

  it('Req 3.1: mapeia status/source/value do frete ativo', async () => {
    setResult({ data: { status: 'ativo', source: 'embarcador', value: '1500.5' }, error: null });
    const info = await getFreteStatus('frete-1');
    expect(info).toEqual({ status: 'ativo', source: 'embarcador', value: 1500.5 });
  });

  it('Req 3.1: frete encerrado com value nulo → value null', async () => {
    setResult({ data: { status: 'encerrado', source: null, value: null }, error: null });
    const info = await getFreteStatus('frete-2');
    expect(info).toEqual({ status: 'encerrado', source: null, value: null });
  });

  it('Req 3.5: erro do Supabase resolve null sem lançar', async () => {
    setResult({ data: null, error: { message: 'boom' } });
    await expect(getFreteStatus('frete-3')).resolves.toBeNull();
  });

  it('Req 3.5: sem data resolve null', async () => {
    setResult({ data: null, error: null });
    await expect(getFreteStatus('frete-4')).resolves.toBeNull();
  });
});
