/**
 * CP-1: Property test do contrato de prefixos do `categorizeNotification`.
 *
 * Spec: .kiro/specs/notifications-hub/requirements.md Requirement 3.
 *
 * Propriedades testadas:
 *
 *  P1. Especificidade vence: tipos `chat_support_*` SEMPRE caem em
 *      'chat' (Mensagens), nunca em 'tickets' — mesmo que o sufixo
 *      arbitrário. Cobre `chat_support_user_message`,
 *      `chat_support_admin_reply` e variações com sufixos quaisquer.
 *
 *  P2. Especificidade vence: `frete_like_*` SEMPRE cai em 'atividades',
 *      nunca em 'anuncios' — mesmo que `frete_*` (genérico) caia em
 *      anuncios.
 *
 *  P3. Mapeamentos diretos por prefixo (broadcast_, anuncio_, frete_,
 *      chat_, message_, msg_, ticket_, support_, suporte_).
 *
 *  P4. Catch-all: qualquer string que não casa com nenhum prefixo cai em
 *      'atividades'.
 *
 *  P5. Type-null e type-undefined caem em 'atividades' (defesa).
 *
 *  P6. Case-insensitivity: maiúsculas no prefixo não mudam a categoria
 *      (uppercase do tipo é normalizada via toLowerCase no categorize).
 *
 * Não há mocks: a função é pura.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { categorizeNotification } from '../../components/NotificationsModal';

const SAFE_SUFFIX = fc
  .string({ minLength: 0, maxLength: 30 })
  .filter((s) => /^[a-z0-9_]*$/.test(s));

describe('CP-1: categorizeNotification — contrato de prefixos', () => {
  // P1: especificidade vence em chat_support_
  it('chat_support_<sufixo> sempre cai em "chat"', () => {
    fc.assert(
      fc.property(SAFE_SUFFIX, (sufixo) => {
        const type = `chat_support_${sufixo}`;
        expect(categorizeNotification(type)).toBe('chat');
      }),
      { numRuns: 200 }
    );
  });

  // P2: especificidade vence em frete_like_
  it('frete_like_<sufixo> sempre cai em "atividades"', () => {
    fc.assert(
      fc.property(SAFE_SUFFIX, (sufixo) => {
        const type = `frete_like_${sufixo}`;
        expect(categorizeNotification(type)).toBe('atividades');
      }),
      { numRuns: 200 }
    );
  });

  // P3: mapeamentos diretos (gerados a partir de cada prefixo + sufixo).
  it('prefixos diretos caem na categoria documentada', () => {
    const cases: Array<[string, 'anuncios' | 'chat' | 'tickets' | 'atividades']> = [
      ['broadcast_', 'anuncios'],
      ['anuncio_', 'anuncios'],
      // frete_ genérico (sem _like_) -> anuncios. O filter abaixo garante.
      ['frete_', 'anuncios'],
      ['chat_', 'chat'],
      ['message_', 'chat'],
      ['msg_', 'chat'],
      ['ticket_', 'tickets'],
      ['support_', 'tickets'],
      ['suporte_', 'tickets'],
    ];

    for (const [prefixo, expected] of cases) {
      fc.assert(
        fc.property(SAFE_SUFFIX, (sufixo) => {
          // Garantir que sufixo de frete_ NUNCA comece por 'like_' (esse caso vai p/ atividades por especificidade).
          if (prefixo === 'frete_' && sufixo.startsWith('like_')) {
            return; // pular este draw específico
          }
          // Garantir que sufixo de chat_ NUNCA comece por 'support_' (especificidade leva p/ chat de qualquer forma, mas mantém a expectativa pura).
          const type = `${prefixo}${sufixo}`;
          expect(categorizeNotification(type)).toBe(expected);
        }),
        { numRuns: 100 }
      );
    }
  });

  // P4: catch-all
  it('strings sem prefixo conhecido caem em "atividades"', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => {
          const t = s.toLowerCase();
          // remove qualquer string que case com um prefixo conhecido
          const knownPrefixes = [
            'broadcast_',
            'anuncio_',
            'frete_',
            'chat_',
            'message_',
            'msg_',
            'ticket_',
            'support_',
            'suporte_',
            'new_message',
          ];
          return !knownPrefixes.some((p) => t.startsWith(p)) && t !== 'new_message';
        }),
        (random) => {
          expect(categorizeNotification(random)).toBe('atividades');
        }
      ),
      { numRuns: 200 }
    );
  });

  // P5: null / undefined / vazio
  it('null, undefined e string vazia caem em "atividades"', () => {
    expect(categorizeNotification(null)).toBe('atividades');
    expect(categorizeNotification(undefined)).toBe('atividades');
    expect(categorizeNotification('')).toBe('atividades');
  });

  // P6: case-insensitive
  it('uppercase no prefixo é normalizado (case-insensitive)', () => {
    expect(categorizeNotification('BROADCAST_GENERAL')).toBe('anuncios');
    expect(categorizeNotification('Chat_Support_User_Message')).toBe('chat');
    expect(categorizeNotification('TICKET_REPLIED')).toBe('tickets');
    expect(categorizeNotification('Frete_Like_FOO')).toBe('atividades');
  });

  // P7: tipos canonicos da spec sao mapeados corretamente
  it('tipos canônicos da spec mapeiam para a categoria documentada', () => {
    expect(categorizeNotification('broadcast_general')).toBe('anuncios');
    expect(categorizeNotification('chat_message')).toBe('chat');
    expect(categorizeNotification('chat_support_user_message')).toBe('chat');
    expect(categorizeNotification('chat_support_admin_reply')).toBe('chat');
    expect(categorizeNotification('ticket_created')).toBe('tickets');
    expect(categorizeNotification('ticket_replied')).toBe('tickets');
    expect(categorizeNotification('ticket_resolved')).toBe('tickets');
    // Legados
    expect(categorizeNotification('new_message')).toBe('chat');
    expect(categorizeNotification('frete_like_123')).toBe('atividades');
    expect(categorizeNotification('plan_expiring')).toBe('atividades');
    expect(categorizeNotification('rating_received')).toBe('atividades');
  });
});
