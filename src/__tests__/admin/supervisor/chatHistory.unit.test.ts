// Feature: supervisor-chat-history (119) — exemplos/edge do núcleo puro.

import { describe, it, expect } from 'vitest';
import {
  deriveTitle,
  compareSessions,
  compareMessages,
  validateMessage,
  CHAT_LIMITS,
  DEFAULT_SESSION_TITLE,
} from '../../../services/admin/supervisor/chatHistory';

describe('chatHistory — deriveTitle (exemplos)', () => {
  it('usa a 1ª pergunta, colapsando espaços', () => {
    expect(deriveTitle('  Como    está\no sistema hoje?  ')).toBe('Como está o sistema hoje?');
  });

  it('trunca em TITLE_DERIVE_MAX', () => {
    const long = 'palavra '.repeat(40); // ~320 chars
    const t = deriveTitle(long);
    expect(t.length).toBeLessThanOrEqual(CHAT_LIMITS.TITLE_DERIVE_MAX);
  });

  it('redige PII/segredo no título', () => {
    expect(deriveTitle('por que joao@x.com foi suspenso?')).not.toContain('joao@x.com');
    const secret = 'sb_' + 'secret_' + 'ABCDEFGHIJ1234567890';
    expect(deriveTitle(`token ${secret} vazou`)).not.toContain(secret);
  });

  it('vazio ⇒ default', () => {
    expect(deriveTitle('   ')).toBe(DEFAULT_SESSION_TITLE);
  });
});

describe('chatHistory — comparadores (exemplos)', () => {
  it('compareSessions ordena por updated_at desc', () => {
    const a = { id: 'a', updatedAt: '2026-06-19T12:00:00Z' };
    const b = { id: 'b', updatedAt: '2026-06-19T10:00:00Z' };
    expect([b, a].sort(compareSessions).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('compareMessages ordena por created_at asc', () => {
    const a = { id: 'a', createdAt: '2026-06-19T10:00:00Z' };
    const b = { id: 'b', createdAt: '2026-06-19T12:00:00Z' };
    expect([b, a].sort(compareMessages).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('desempata por id quando timestamps iguais', () => {
    const x = { id: 'x', updatedAt: '2026-06-19T12:00:00Z' };
    const y = { id: 'y', updatedAt: '2026-06-19T12:00:00Z' };
    expect([y, x].sort(compareSessions).map((s) => s.id)).toEqual(['x', 'y']);
  });
});

describe('chatHistory — validateMessage (exemplos)', () => {
  it('aceita user/ai com content válido', () => {
    expect(validateMessage('user', 'oi').ok).toBe(true);
    expect(validateMessage('ai', 'resposta').ok).toBe(true);
  });
  it('rejeita role fora do domínio e content vazio', () => {
    expect(validateMessage('system', 'oi').ok).toBe(false);
    expect(validateMessage('user', '').ok).toBe(false);
    expect(validateMessage('user', '   ').ok).toBe(false);
  });
});
