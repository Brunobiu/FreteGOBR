// Feature: whatsapp-automation, Property 14: O pacing respeita o Send_Interval
/**
 * CP-14: Property test do pacing por relógio (sem dormir).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md Requirement 8.6
 * Design: design.md → seção Dispatch / `shouldSendNow` (lógica pura, sem I/O).
 *
 * **Validates: Requirements 8.6**
 *
 * Property 14 — para quaisquer instantes `now` e `lastSendAt` (epoch ms) e
 * qualquer `intervalSec > 0`:
 *
 *  P14.1 (definição) `shouldSendNow(now, lastSendAt, intervalSec)` retorna
 *        `true` se, e somente se, `now >= lastSendAt + intervalSec * 1000`
 *        (unidades conforme a implementação: `now`/`lastSendAt` em ms,
 *        `intervalSec` em segundos convertido para ms via `× 1000`).
 *  P14.2 (primeiro envio) quando `lastSendAt` é `null`/`undefined` não há
 *        intervalo a respeitar ⇒ sempre retorna `true`.
 *  P14.3 (borda) exatamente no instante `lastSendAt + intervalSec*1000` o
 *        envio é permitido (comparação `>=`, não `>`).
 *  P14.4 (aceita `Date`) o helper aceita `Date` além de epoch ms, com o mesmo
 *        resultado da forma numérica equivalente.
 *
 * Geração de tempos via `fc.integer` (epoch ms) e `intervalSec` via
 * `fc.integer({ min: 1 })`. NÃO usamos `fc.stringOf` (não existe no projeto).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { shouldSendNow } from '../../../services/admin/whatsapp/dispatch';

// Epoch ms em uma faixa ampla porém segura para aritmética (evita overflow de
// `lastSendAt + intervalSec*1000` ao computar o oráculo). Usamos um teto bem
// abaixo de Number.MAX_SAFE_INTEGER para deixar folga ao intervalo em ms.
const EPOCH_MS = fc.integer({ min: 0, max: 4_000_000_000_000 });

// Send_Interval em segundos: sempre positivo (CHECK > 0 em send_interval_sec).
// Teto generoso (1 ano em segundos) que, × 1000, ainda cabe com folga.
const INTERVAL_SEC = fc.integer({ min: 1, max: 31_536_000 });

describe('CP-14: pacing respeita o Send_Interval — shouldSendNow', () => {
  // P14.1 — definição: true sse now >= lastSendAt + intervalSec*1000
  it('retorna true sse now >= lastSendAt + intervalSec*1000', () => {
    fc.assert(
      fc.property(EPOCH_MS, EPOCH_MS, INTERVAL_SEC, (now, lastSendAt, intervalSec) => {
        const expected = now >= lastSendAt + intervalSec * 1000;
        expect(shouldSendNow(now, lastSendAt, intervalSec)).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  // P14.2 — primeiro envio (lastSendAt null/undefined) ⇒ sempre true
  it('primeiro envio (lastSendAt null/undefined) sempre permite o envio', () => {
    fc.assert(
      fc.property(
        EPOCH_MS,
        INTERVAL_SEC,
        fc.constantFrom<null | undefined>(null, undefined),
        (now, intervalSec, lastSendAt) => {
          expect(shouldSendNow(now, lastSendAt, intervalSec)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // P14.3 — borda exata: now === lastSendAt + intervalSec*1000 ⇒ true;
  //         um ms antes ⇒ false.
  it('na borda exata permite o envio (>=) e um ms antes bloqueia', () => {
    fc.assert(
      fc.property(EPOCH_MS, INTERVAL_SEC, (lastSendAt, intervalSec) => {
        const boundary = lastSendAt + intervalSec * 1000;
        expect(shouldSendNow(boundary, lastSendAt, intervalSec)).toBe(true);
        expect(shouldSendNow(boundary - 1, lastSendAt, intervalSec)).toBe(false);
        expect(shouldSendNow(boundary + 1, lastSendAt, intervalSec)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // P14.4 — aceita Date com o mesmo resultado da forma numérica equivalente.
  it('aceita Date e produz o mesmo resultado das formas em epoch ms', () => {
    fc.assert(
      fc.property(EPOCH_MS, EPOCH_MS, INTERVAL_SEC, (now, lastSendAt, intervalSec) => {
        const numeric = shouldSendNow(now, lastSendAt, intervalSec);
        expect(shouldSendNow(new Date(now), new Date(lastSendAt), intervalSec)).toBe(numeric);
        expect(shouldSendNow(new Date(now), lastSendAt, intervalSec)).toBe(numeric);
        expect(shouldSendNow(now, new Date(lastSendAt), intervalSec)).toBe(numeric);
      }),
      { numRuns: 100 }
    );
  });

  // Exemplos fixos (sanidade) cobrindo os casos-chave explicitamente.
  it('exemplos canônicos de pacing', () => {
    // intervalSec=60 ⇒ 60_000 ms de espera.
    expect(shouldSendNow(1_000_000, 940_000, 60)).toBe(true); // exatamente na borda
    expect(shouldSendNow(999_999, 940_000, 60)).toBe(false); // 1 ms antes
    expect(shouldSendNow(1_000_001, 940_000, 60)).toBe(true); // 1 ms depois
    expect(shouldSendNow(940_000, 940_000, 1)).toBe(false); // ainda dentro do intervalo
    // Primeiro envio sempre permitido.
    expect(shouldSendNow(0, null, 3600)).toBe(true);
    expect(shouldSendNow(123_456, undefined, 1)).toBe(true);
  });
});
