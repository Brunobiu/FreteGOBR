/**
 * Testes de Segurança — chat-enviar-documentos (Req 9).
 *
 * Garante que o motorista só consegue enviar OS PRÓPRIOS documentos:
 *   - o catálogo nunca inclui `profile_photo` nem referência sem CT-e
 *     (anti-vazamento / só arquivos enviáveis);
 *   - o envio baixa SEMPRE do bucket `documents` e SOMENTE o caminho do próprio
 *     item (nunca um caminho arbitrário), e grava o anexo com o `senderId` do
 *     próprio usuário (a RLS de `chat-attachments` exige `<conv>/<sender>/...`);
 *   - se o download é negado (RLS), o item falha e NADA é enviado por ele —
 *     ou seja, é impossível enviar documento que não se pode ler.
 *
 * As RLS reais (banco) são a fronteira efetiva; aqui validamos que o código
 * cliente sempre opera dentro dela (não fabrica caminhos nem troca o remetente).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

type G = Record<string, unknown>;

vi.mock('../../services/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => {
          ((globalThis as G).__downloads as string[][]).push([bucket, path]);
          return ((globalThis as G).__downloadImpl as (b: string, p: string) => unknown)(bucket, path);
        },
      }),
    },
  },
}));

vi.mock('../../services/chatFrete', () => ({
  sendFreteAttachment: (...a: unknown[]) => {
    ((globalThis as G).__attachCalls as unknown[][]).push(a);
    return Promise.resolve({ id: 'm1' });
  },
}));

import { buildSendableCatalog } from '../../services/driverDocsCatalog';
import { sendDriverDocuments, type SendableDocument } from '../../services/chatDocuments';

beforeEach(() => {
  (globalThis as G).__downloads = [];
  (globalThis as G).__attachCalls = [];
  (globalThis as G).__downloadImpl = () =>
    Promise.resolve({ data: new Blob(['x'], { type: 'application/pdf' }), error: null });
});

describe('chat-enviar-documentos — catálogo anti-vazamento (Req 9.1)', () => {
  it('nunca inclui profile_photo nem referência sem CT-e', () => {
    const catalog = buildSendableCatalog(
      [
        { id: '1', documentType: 'cnh', filePath: 'user-1/cnh.pdf', fileName: 'cnh.pdf', mimeType: 'application/pdf' },
        { id: '2', documentType: 'profile_photo', filePath: 'user-1/avatar.jpg', fileName: 'avatar.jpg', mimeType: 'image/jpeg' },
      ],
      [
        { id: 'r1', companyName: 'X', ctePath: 'user-1/cte_1.pdf', cteName: 'cte.pdf' },
        { id: 'r2', companyName: 'Y', ctePath: null, cteName: null },
      ]
    );
    const ids = catalog.map((i) => i.id);
    expect(ids).toEqual(['doc:1', 'ref:r1']);
    expect(catalog.some((i) => i.docType === 'profile_photo')).toBe(false);
    // Todo sourcePath vem da entrada (nunca fabricado).
    expect(catalog.every((i) => i.sourcePath.startsWith('user-1/'))).toBe(true);
  });
});

describe('chat-enviar-documentos — escopo de envio (Req 9.1, 9.2)', () => {
  const cnh: SendableDocument = {
    id: 'doc:1', kind: 'document', docType: 'cnh', groupKey: 'perfil',
    label: 'CNH', sourcePath: 'user-1/cnh_1.pdf', fileName: 'cnh.pdf', mimeType: 'application/pdf',
  };

  it('baixa só do bucket documents e exatamente o caminho do item', async () => {
    await sendDriverDocuments('conv-1', 'user-1', [cnh]);
    const downloads = (globalThis as G).__downloads as string[][];
    expect(downloads).toHaveLength(1);
    expect(downloads[0][0]).toBe('documents'); // bucket fixo
    expect(downloads[0][1]).toBe('user-1/cnh_1.pdf'); // caminho do próprio item
  });

  it('grava o anexo com o senderId do próprio usuário e sem texto', async () => {
    await sendDriverDocuments('conv-1', 'user-1', [cnh]);
    const calls = (globalThis as G).__attachCalls as unknown[][];
    expect(calls).toHaveLength(1);
    const [conversationId, senderId, , , text] = calls[0];
    expect(conversationId).toBe('conv-1');
    expect(senderId).toBe('user-1'); // remetente = self (RLS exige <conv>/<self>/...)
    expect(text).toBe('');
  });

  it('download negado (RLS) ⇒ item falha e NADA é enviado por ele', async () => {
    (globalThis as G).__downloadImpl = () =>
      Promise.resolve({ data: null, error: { message: 'permission denied' } });
    const result = await sendDriverDocuments('conv-1', 'user-1', [cnh]);
    expect(result.sent).toHaveLength(0);
    expect(result.failed.map((f) => f.item.id)).toEqual(['doc:1']);
    // Nenhum anexo enviado: impossível enviar o que não se pode ler.
    expect((globalThis as G).__attachCalls as unknown[][]).toHaveLength(0);
  });
});
