/**
 * Testes de componente da MotoristaBottomNav (Feature: motorista-chat-nav, Tarefa 2.3).
 *
 * Abordagem example-based para o Chat_Slot e o Chat_Badge: layout/ordem dos 6
 * slots, estado ativo, navegação, badge orientado a evento e degradação.
 *
 * Convenção do projeto (sem @testing-library): render manual via
 * `react-dom/client` (`createRoot`) + `React.act`, dentro de `MemoryRouter`
 * (mesma convenção de `legal/siteFooter.test.tsx`). A navegação é verificada
 * por um helper `LocationDisplay` que reflete o `pathname` corrente do router.
 *
 * Mocks (steering): `vi.mock` é hoisted — NÃO referenciar variáveis externas no
 * factory. Spies mutáveis são expostos via `(globalThis as Record<...>).__*`.
 * `formatBadge` é pura, então usamos a implementação REAL (via importOriginal).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.4, 3.4, 5.3, 6.1, 6.3, 7.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

// ─── Mocks (hoisted; sem refs externas) ────────────────────────────────────

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => (globalThis as Record<string, unknown>).__authReturn,
}));

vi.mock('../hooks/useMotoristaCompletude', () => ({
  useMotoristaCompletude: () => ({
    loading: false,
    groups: {
      perfil: false,
      tracao: false,
      carroceria: false,
      complemento: false,
      referencias: false,
    },
  }),
}));

// chatFrete: mantém `formatBadge` REAL; só `getUnreadConversationsCount` é spy.
vi.mock('../services/chatFrete', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/chatFrete')>();
  return {
    ...actual,
    getUnreadConversationsCount: (...args: unknown[]) => {
      const spy = (globalThis as Record<string, unknown>).__getUnreadSpy as
        | ((...a: unknown[]) => Promise<number>)
        | undefined;
      return spy ? spy(...args) : Promise.resolve(0);
    },
  };
});

// supabase: canal encadeável no-op (channel().on().subscribe(); removeChannel()).
vi.mock('../services/supabase', () => {
  const channelObj: Record<string, unknown> = {};
  channelObj.on = () => channelObj;
  channelObj.subscribe = () => channelObj;
  return {
    supabase: {
      channel: () => channelObj,
      removeChannel: () => undefined,
    },
  };
});

vi.mock('../services/documents', () => ({
  resolveProfilePhotoUrl: () => Promise.resolve(null),
}));

import MotoristaBottomNav from '../components/MotoristaBottomNav';
import { useAuth } from '../hooks/useAuth';

// ─── Helpers de render ──────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

const MOTORISTA = { id: 'm1', userType: 'motorista' as const };

function setAuth(user: { id: string; userType: string } | null) {
  (globalThis as Record<string, unknown>).__authReturn = { user };
}

/** Reflete o pathname corrente do router para verificar navegação. */
function LocationDisplay() {
  const loc = useLocation();
  return createElement('div', { id: '__loc' }, loc.pathname);
}

/**
 * Espelha o gate de montagem de produção (`{isMotorista && <MotoristaBottomNav/>}`
 * em `HomePage`). A `MotoristaBottomNav` não se auto-oculta; quem decide montá-la
 * é o site de montagem. Este wrapper fixa esse contrato (Req 7.1).
 */
function MountGuard() {
  const { user } = useAuth();
  const isMotorista = (user as { userType?: string } | null)?.userType === 'motorista';
  return isMotorista ? createElement(MotoristaBottomNav) : null;
}

async function render(route = '/', Component: () => unknown = MotoristaBottomNav) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [route] },
        createElement(Component as never),
        createElement(LocationDisplay)
      )
    );
  });
  // Flush da carga inicial do badge (getUnreadConversationsCount resolve).
  await act(async () => {
    await Promise.resolve();
  });
}

function navButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('nav button'));
}

function labelOf(btn: HTMLButtonElement): string {
  return btn.lastElementChild?.textContent?.trim() ?? '';
}

function buttonByLabel(text: string): HTMLButtonElement | undefined {
  return navButtons().find((b) => labelOf(b) === text);
}

function chatBadge(): HTMLElement | null {
  const chat = buttonByLabel('Chat');
  return chat ? chat.querySelector('span[aria-hidden="true"]') : null;
}

function currentPath(): string {
  return container.querySelector('#__loc')?.textContent ?? '';
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  setAuth(MOTORISTA);
  (globalThis as Record<string, unknown>).__getUnreadSpy = vi.fn().mockResolvedValue(0);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

// ─── Layout / ordem / acessibilidade (Req 1.1–1.5) ──────────────────────────

describe('MotoristaBottomNav — layout do Chat_Slot', () => {
  it('renderiza o item "Chat" para o motorista (Req 1.1)', async () => {
    await render('/');
    expect(buttonByLabel('Chat')).toBeDefined();
  });

  it('exibe os 6 slots na ordem Início, Chat, Mapa, ANTT, Marketplace, Menu (Req 1.2, 1.3, 1.4)', async () => {
    await render('/');
    const labels = navButtons().map(labelOf);
    expect(labels).toEqual(['Início', 'Chat', 'Mapa', 'ANTT', 'Marketplace', 'Menu']);
  });

  it('usa grid-cols-6 no container dos slots (Req 1.4)', async () => {
    await render('/');
    const grid = container.querySelector('nav > div');
    expect(grid).not.toBeNull();
    expect(grid!.className).toContain('grid-cols-6');
  });

  it('define aria-label pt-BR "Chat" quando não há não lidas (Req 1.5)', async () => {
    await render('/');
    expect(buttonByLabel('Chat')!.getAttribute('aria-label')).toBe('Chat');
  });
});

// ─── Estado ativo (Req 1.6) ─────────────────────────────────────────────────

describe('MotoristaBottomNav — estado ativo', () => {
  it('aplica text-green-400 ao Chat_Slot quando a rota é /mensagens (Req 1.6)', async () => {
    await render('/mensagens');
    expect(buttonByLabel('Chat')!.className).toContain('text-green-400');
  });

  it('NÃO aplica text-green-400 ao Chat_Slot fora de /mensagens (Req 1.6)', async () => {
    await render('/');
    expect(buttonByLabel('Chat')!.className).not.toContain('text-green-400');
  });
});

// ─── Navegação (Req 2.1, 2.4) ───────────────────────────────────────────────

describe('MotoristaBottomNav — navegação', () => {
  it('navega para /mensagens ao clicar no Chat_Slot (Req 2.1)', async () => {
    await render('/');
    expect(currentPath()).toBe('/');
    await act(async () => {
      buttonByLabel('Chat')!.click();
    });
    expect(currentPath()).toBe('/mensagens');
  });

  it('mantém em /mensagens ao clicar estando já na rota (Req 2.4)', async () => {
    await render('/mensagens');
    await act(async () => {
      buttonByLabel('Chat')!.click();
    });
    expect(currentPath()).toBe('/mensagens');
  });
});

// ─── Chat_Badge orientado a evento (Req 3.4, 5.3, 6.1) ──────────────────────

describe('MotoristaBottomNav — Chat_Badge', () => {
  it('oculta o badge quando o Conversation_Badge_Count é 0 (Req 6.1)', async () => {
    await render('/');
    expect(chatBadge()).toBeNull();
  });

  it('exibe o número quando o Unread_Count_Event traz detail > 0 (Req 3.4, 5.3)', async () => {
    await render('/');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('fretego-chat-unread-count', { detail: 3 }));
    });
    expect(chatBadge()).not.toBeNull();
    expect(chatBadge()!.textContent).toBe('3');
    // aria-label reflete a contagem em pt-BR (Req 1.5).
    expect(buttonByLabel('Chat')!.getAttribute('aria-label')).toBe('Chat - 3 conversas não lidas');
  });

  it('satura o badge em "9+" quando detail > 9 (Req 3.4)', async () => {
    await render('/');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('fretego-chat-unread-count', { detail: 12 }));
    });
    expect(chatBadge()!.textContent).toBe('9+');
  });

  it('volta a ocultar o badge quando detail é 0 (Req 5.3, 6.1)', async () => {
    await render('/');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('fretego-chat-unread-count', { detail: 5 }));
    });
    expect(chatBadge()!.textContent).toBe('5');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('fretego-chat-unread-count', { detail: 0 }));
    });
    expect(chatBadge()).toBeNull();
  });

  it('ignora detail não numérico, preservando o valor atual (Req 5.3)', async () => {
    await render('/');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('fretego-chat-unread-count', { detail: 4 }));
    });
    expect(chatBadge()!.textContent).toBe('4');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('fretego-chat-unread-count', { detail: 'abc' }));
    });
    // Mantém o último valor numérico válido.
    expect(chatBadge()!.textContent).toBe('4');
  });
});

// ─── Degradação (Req 6.3) ───────────────────────────────────────────────────

describe('MotoristaBottomNav — degradação', () => {
  it('não quebra e preserva navegação quando a contagem falha (Req 6.3)', async () => {
    (globalThis as Record<string, unknown>).__getUnreadSpy = vi
      .fn()
      .mockRejectedValue(new Error('network down'));

    await render('/');

    // Sem crash: o Chat_Slot existe e não há badge.
    expect(buttonByLabel('Chat')).toBeDefined();
    expect(chatBadge()).toBeNull();

    // Navegação preservada.
    await act(async () => {
      buttonByLabel('Chat')!.click();
    });
    expect(currentPath()).toBe('/mensagens');
  });
});

// ─── Escopo: não-motorista (Req 7.1) ────────────────────────────────────────

describe('MotoristaBottomNav — escopo do motorista', () => {
  it('não monta a Bottom_Nav para embarcador (Req 7.1)', async () => {
    setAuth({ id: 'e1', userType: 'embarcador' });
    await render('/', MountGuard);
    expect(container.querySelector('nav')).toBeNull();
  });

  it('não monta a Bottom_Nav para admin (Req 7.1)', async () => {
    setAuth({ id: 'a1', userType: 'admin' });
    await render('/', MountGuard);
    expect(container.querySelector('nav')).toBeNull();
  });

  it('monta a Bottom_Nav para motorista (Req 7.1)', async () => {
    setAuth(MOTORISTA);
    await render('/', MountGuard);
    expect(container.querySelector('nav')).not.toBeNull();
    expect(buttonByLabel('Chat')).toBeDefined();
  });
});
