/**
 * Testes de UI do EnviarDocumentosModal (feature chat-enviar-documentos,
 * Req 4, 5, 6, 8). Render manual (react-dom/client + React.act) — o projeto NÃO
 * usa @testing-library/react. Mocks hoisted via globalThis.
 *
 * Valida: estados loading/empty/error/ready; checkbox por item; "Enviar (N)"
 * reflete a contagem e desabilita com 0; envio com sucesso fecha; falha parcial
 * mantém aberto e reduz a seleção; guard !unlocked não envia; Esc fecha.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type G = Record<string, unknown>;

vi.mock('../services/chatDocuments', () => ({
  listSendableDriverDocuments: (...a: unknown[]) =>
    ((globalThis as G).__listImpl as (...x: unknown[]) => unknown)(...a),
  sendDriverDocuments: (...a: unknown[]) =>
    ((globalThis as G).__sendImpl as (...x: unknown[]) => unknown)(...a),
}));

vi.mock('../services/motorista', () => ({
  getDocumentSignedUrlByPath: () => Promise.resolve(null),
}));

import { EnviarDocumentosModal } from '../components/EnviarDocumentosModal';

const CATALOG = [
  { id: 'doc:1', kind: 'document', docType: 'cnh', groupKey: 'perfil', label: 'CNH', sourcePath: 'u/cnh.pdf', fileName: 'cnh.pdf', mimeType: 'application/pdf' },
  { id: 'doc:2', kind: 'document', docType: 'crlv_cavalo', groupKey: 'tracao', label: 'CRLV do cavalo', sourcePath: 'u/crlv.png', fileName: 'crlv.png', mimeType: 'image/png' },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  (globalThis as G).__listImpl = () => Promise.resolve(CATALOG);
  (globalThis as G).__sendImpl = () => Promise.resolve({ sent: CATALOG, failed: [] });
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
function render(node: unknown) {
  act(() => {
    root = createRoot(container);
    root.render(node as never);
  });
}
function btn(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(text)
  ) as HTMLButtonElement | undefined;
}
function checkboxes(): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="checkbox"]'));
}
function baseProps(over: Record<string, unknown> = {}) {
  return {
    open: true,
    conversationId: 'conv-1',
    userId: 'user-1',
    unlocked: true,
    onClose: () => {},
    ...over,
  };
}

describe('EnviarDocumentosModal — estados e seleção', () => {
  it('não renderiza nada quando open=false', () => {
    render(createElement(EnviarDocumentosModal, baseProps({ open: false })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('ready: lista itens com checkbox e "Enviar (0)" desabilitado', async () => {
    render(createElement(EnviarDocumentosModal, baseProps()));
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.textContent).toContain('CNH');
    expect(container.textContent).toContain('CRLV do cavalo');
    expect(checkboxes().length).toBe(2);
    const enviar = btn('Enviar (0)');
    expect(enviar).toBeTruthy();
    expect(enviar!.disabled).toBe(true);
  });

  it('empty: mostra orientação e mantém envio indisponível', async () => {
    (globalThis as G).__listImpl = () => Promise.resolve([]);
    render(createElement(EnviarDocumentosModal, baseProps()));
    await flush();
    expect(container.textContent).toContain('Conclua seu cadastro');
    expect(checkboxes().length).toBe(0);
  });

  it('error: mostra aviso e botão Tentar novamente', async () => {
    (globalThis as G).__listImpl = () => Promise.reject(new Error('boom'));
    render(createElement(EnviarDocumentosModal, baseProps()));
    await flush();
    expect(container.textContent).toContain('Não foi possível carregar');
    expect(btn('Tentar novamente')).toBeTruthy();
  });

  it('seleção reflete em "Enviar (N)"', async () => {
    render(createElement(EnviarDocumentosModal, baseProps()));
    await flush();
    act(() => checkboxes()[0].click());
    expect(btn('Enviar (1)')).toBeTruthy();
    act(() => checkboxes()[1].click());
    expect(btn('Enviar (2)')).toBeTruthy();
  });
});

describe('EnviarDocumentosModal — envio', () => {
  it('sucesso total: chama sendDriverDocuments e fecha', async () => {
    const onClose = vi.fn();
    const onSent = vi.fn();
    const sendSpy = vi.fn(() => Promise.resolve({ sent: CATALOG, failed: [] }));
    (globalThis as G).__sendImpl = sendSpy;
    render(createElement(EnviarDocumentosModal, baseProps({ onClose, onSent })));
    await flush();
    act(() => checkboxes()[0].click());
    act(() => {
      btn('Enviar (1)')!.click();
    });
    await flush();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('falha parcial: mantém aberto, mostra erro e reduz seleção ao que falhou', async () => {
    (globalThis as G).__sendImpl = () =>
      Promise.resolve({ sent: [CATALOG[0]], failed: [{ item: CATALOG[1], reason: 'x' }] });
    const onClose = vi.fn();
    render(createElement(EnviarDocumentosModal, baseProps({ onClose })));
    await flush();
    act(() => checkboxes()[0].click());
    act(() => checkboxes()[1].click());
    act(() => {
      btn('Enviar (2)')!.click();
    });
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Não foi possível enviar');
    // Seleção reduzida ao item que falhou (doc:2) → "Enviar (1)".
    expect(btn('Enviar (1)')).toBeTruthy();
  });

  it('guard !unlocked: não envia e avisa', async () => {
    const sendSpy = vi.fn();
    (globalThis as G).__sendImpl = sendSpy;
    render(createElement(EnviarDocumentosModal, baseProps({ unlocked: false })));
    await flush();
    act(() => checkboxes()[0].click());
    act(() => {
      btn('Enviar (1)')!.click();
    });
    await flush();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('ainda não estão liberados');
  });

  it('Esc fecha o modal', async () => {
    const onClose = vi.fn();
    render(createElement(EnviarDocumentosModal, baseProps({ onClose })));
    await flush();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
