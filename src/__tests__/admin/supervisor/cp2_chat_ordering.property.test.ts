// Feature: supervisor-chat-history (119), Property 2: ordenação total.
//
// compareSessions (updated_at desc, id asc) e compareMessages (created_at asc,
// id asc) são ordens totais: antissimétricas, transitivas, estáveis; ordenar
// qualquer permutação do mesmo conjunto produz a mesma sequência.
//
// Validates: Requirements 1.2, 2.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  compareSessions,
  compareMessages,
  type ChatSessionRow,
  type ChatMessageRow,
} from '../../../services/admin/supervisor/chatHistory';
import { chatSessionRowGen, chatMessageRowGen } from './_generators';

function sign(n: number): number {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}
function dedupeById<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('CP2 supervisor-chat: ordenação total (sessões e mensagens)', () => {
  it('compareSessions: antissimetria + permutação invariante', () => {
    fc.assert(
      fc.property(fc.array(chatSessionRowGen, { maxLength: 12 }), fc.integer(), (raw, seed) => {
        const rows = dedupeById(raw) as ChatSessionRow[];
        for (const a of rows)
          for (const b of rows)
            if (a.id !== b.id) expect(sign(compareSessions(a, b))).toBe(-sign(compareSessions(b, a)));
        const s1 = [...rows].sort(compareSessions);
        const s2 = shuffle(rows, seed).sort(compareSessions);
        expect(s2.map((r) => r.id)).toEqual(s1.map((r) => r.id));
      }),
      { numRuns: 200 }
    );
  });

  it('compareSessions: transitividade', () => {
    fc.assert(
      fc.property(chatSessionRowGen, chatSessionRowGen, chatSessionRowGen, (a, b, c) => {
        const ab = compareSessions(a, b);
        const bc = compareSessions(b, c);
        if (ab <= 0 && bc <= 0) expect(compareSessions(a, c)).toBeLessThanOrEqual(0);
        if (ab >= 0 && bc >= 0) expect(compareSessions(a, c)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 }
    );
  });

  it('compareMessages: antissimetria + permutação invariante', () => {
    fc.assert(
      fc.property(fc.array(chatMessageRowGen, { maxLength: 12 }), fc.integer(), (raw, seed) => {
        const rows = dedupeById(raw) as ChatMessageRow[];
        for (const a of rows)
          for (const b of rows)
            if (a.id !== b.id) expect(sign(compareMessages(a, b))).toBe(-sign(compareMessages(b, a)));
        const s1 = [...rows].sort(compareMessages);
        const s2 = shuffle(rows, seed).sort(compareMessages);
        expect(s2.map((r) => r.id)).toEqual(s1.map((r) => r.id));
      }),
      { numRuns: 200 }
    );
  });
});
