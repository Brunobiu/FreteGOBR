/**
 * Testes de UI da ChatHandoffBar (feature chat-enviar-documentos, Req 1, 2, 3).
 * Render manual (react-dom/client + React.act) — o projeto NÃO usa
 * @testing-library/react.
 *
 * Valida: layout de dois botões só no lado do motorista; nudge "liberar os
 * botões"; embarcador inalterado (só WhatsApp, nudge antigo); botões
 * desabilitados enquanto não liberado; cliques chamam os callbacks certos.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatHandoffBar } from '../components/ChatHandoffBar';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function render(node: unknown) {
  act(() => {
    root = createRoot(container);
    root.render(node as never);
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(text)
  ) as HTMLButtonElement | undefined;
}

describe('ChatHandoffBar — embarcador (showDocuments=false)', () => {
  it('mostra só o WhatsApp e o nudge antigo (sem regressão)', () => {
    render(
      createElement(ChatHandoffBar, {
        unlocked: false,
        error: null,
        onOpenWhatsapp: () => {},
      })
    );
    expect(container.textContent).toContain('Converse um pouco para liberar o WhatsApp.');
    expect(container.textContent).not.toContain('Enviar documentos');
    expect(buttonByText('WhatsApp')).toBeTruthy();
  });
});

describe('ChatHandoffBar — motorista (showDocuments=true)', () => {
  it('mostra dois botões e o nudge "liberar os botões" quando travado', () => {
    render(
      createElement(ChatHandoffBar, {
        unlocked: false,
        error: null,
        onOpenWhatsapp: () => {},
        showDocuments: true,
        onOpenDocuments: () => {},
      })
    );
    expect(container.textContent).toContain('Converse um pouco para liberar os botões.');
    const docsBtn = buttonByText('Enviar documentos');
    const waBtn = buttonByText('WhatsApp');
    expect(docsBtn).toBeTruthy();
    expect(waBtn).toBeTruthy();
    // Ambos desabilitados enquanto não liberado (Req 2.2).
    expect(docsBtn!.disabled).toBe(true);
    expect(waBtn!.disabled).toBe(true);
  });

  it('quando liberado, habilita e os cliques chamam os callbacks certos', () => {
    const onOpenWhatsapp = vi.fn();
    const onOpenDocuments = vi.fn();
    render(
      createElement(ChatHandoffBar, {
        unlocked: true,
        error: null,
        onOpenWhatsapp,
        showDocuments: true,
        onOpenDocuments,
      })
    );
    expect(container.textContent).toContain(
      'Vocês já podem conversar no WhatsApp e enviar documentos.'
    );
    const docsBtn = buttonByText('Enviar documentos')!;
    const waBtn = buttonByText('WhatsApp')!;
    expect(docsBtn.disabled).toBe(false);
    expect(waBtn.disabled).toBe(false);

    act(() => docsBtn.click());
    expect(onOpenDocuments).toHaveBeenCalledTimes(1);
    act(() => waBtn.click());
    expect(onOpenWhatsapp).toHaveBeenCalledTimes(1);
  });
});
