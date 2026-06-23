/**
 * Testes de integração (mock Supabase) de `src/services/chatDocuments.ts`.
 *
 * Valida:
 *   - `listSendableDriverDocuments` junta documentos + referências e aplica o
 *     catálogo (exclui `profile_photo`, exige `ctePath`);
 *   - `sendDriverDocuments` baixa do bucket `documents` por `sourcePath` e chama
 *     `sendFreteAttachment` com o `kind` correto e texto vazio;
 *   - falha de download/upload de um item é isolada (só ele em `failed`);
 *   - concorrência limitada (pool não estoura).
 *
 * Convenção: `vi.mock` é hoisted — implementações mutáveis expostas via
 * `globalThis`, sem referenciar variáveis externas no factory.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

type G = Record<string, unknown>;

vi.mock('../services/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        download: (path: string) =>
          ((globalThis as G).__downloadImpl as (b: string, p: string) => unknown)(bucket, path),
      }),
    },
  },
}));

vi.mock('../services/documents', () => ({
  getDocumentsByUser: (...a: unknown[]) =>
    ((globalThis as G).__getDocsImpl as (...x: unknown[]) => unknown)(...a),
}));

vi.mock('../services/motorista', () => ({
  getMotoristaReferences: (...a: unknown[]) =>
    ((globalThis as G).__getRefsImpl as (...x: unknown[]) => unknown)(...a),
}));

vi.mock('../services/chatFrete', () => ({
  sendFreteAttachment: (...a: unknown[]) =>
    ((globalThis as G).__sendAttachImpl as (...x: unknown[]) => unknown)(...a),
}));

import {
  listSendableDriverDocuments,
  sendDriverDocuments,
  type SendableDocument,
} from '../services/chatDocuments';

function doc(id: string, documentType: string, mimeType: string | null) {
  return {
    id,
    userId: 'user-1',
    documentType,
    fileName: `${documentType}.bin`,
    filePath: `user-1/${documentType}_${id}.bin`,
    fileSize: 10,
    mimeType: mimeType ?? '',
    uploadedAt: new Date(),
  };
}

describe('chatDocuments — listSendableDriverDocuments', () => {
  beforeEach(() => {
    const g = globalThis as G;
    delete g.__getDocsImpl;
    delete g.__getRefsImpl;
  });

  it('junta docs + refs, exclui profile_photo e refs sem CT-e', async () => {
    (globalThis as G).__getDocsImpl = () =>
      Promise.resolve([
        doc('1', 'cnh', 'application/pdf'),
        doc('2', 'crlv_cavalo', 'image/png'),
        doc('3', 'profile_photo', 'image/jpeg'), // deve ser excluído
      ]);
    (globalThis as G).__getRefsImpl = () =>
      Promise.resolve([
        { id: 'r1', userId: 'user-1', companyName: 'Transportes X', phone: '', ctePath: 'user-1/cte_1.pdf', cteName: 'cte.pdf', createdAt: new Date() },
        { id: 'r2', userId: 'user-1', companyName: 'Sem CTe', phone: '', ctePath: null, cteName: null, createdAt: new Date() },
      ]);

    const catalog = await listSendableDriverDocuments('user-1');
    const ids = catalog.map((i) => i.id);

    expect(ids).toContain('doc:1');
    expect(ids).toContain('doc:2');
    expect(ids).toContain('ref:r1');
    expect(ids).not.toContain('doc:3'); // profile_photo excluído
    expect(ids).not.toContain('ref:r2'); // ref sem CT-e excluída
    expect(catalog.length).toBe(3);
  });
});

describe('chatDocuments — sendDriverDocuments', () => {
  let attachCalls: Array<{ conv: string; sender: string; fileName: string; kind: string; text: string }>;

  beforeEach(() => {
    attachCalls = [];
    const g = globalThis as G;
    // Download bem-sucedido por padrão (Blob com o tipo do path).
    g.__downloadImpl = (_bucket: string, path: string) =>
      Promise.resolve({ data: new Blob(['x'], { type: 'application/pdf' }), error: null, _path: path });
    g.__sendAttachImpl = (
      conv: string,
      sender: string,
      file: File,
      kind: string,
      text: string
    ) => {
      attachCalls.push({ conv, sender, fileName: file.name, kind, text });
      return Promise.resolve({ id: `m_${file.name}`, conversationId: conv, senderId: sender });
    };
  });

  const cnhItem: SendableDocument = {
    id: 'doc:1', kind: 'document', docType: 'cnh',
    groupKey: 'perfil', label: 'CNH', sourcePath: 'user-1/cnh_1.pdf',
    fileName: 'cnh.pdf', mimeType: 'application/pdf',
  };
  const fotoItem: SendableDocument = {
    id: 'doc:2', kind: 'document', docType: 'foto_frente_caminhao',
    groupKey: 'tracao', label: 'Foto da frente do caminhão', sourcePath: 'user-1/foto_2.png',
    fileName: 'foto.png', mimeType: 'image/png',
  };

  it('baixa por sourcePath e envia com kind correto e texto vazio', async () => {
    const result = await sendDriverDocuments('conv-1', 'user-1', [cnhItem, fotoItem]);

    expect(result.failed).toHaveLength(0);
    expect(result.sent.map((i) => i.id).sort()).toEqual(['doc:1', 'doc:2']);
    expect(attachCalls).toHaveLength(2);
    // Texto sempre vazio (sem legenda).
    expect(attachCalls.every((c) => c.text === '')).toBe(true);
    // Classificação por MIME: pdf → file, png → image.
    const cnhCall = attachCalls.find((c) => c.fileName === 'cnh.pdf');
    const fotoCall = attachCalls.find((c) => c.fileName === 'foto.png');
    expect(cnhCall?.kind).toBe('file');
    expect(fotoCall?.kind).toBe('image');
  });

  it('isola falha de download de um item (só ele em failed)', async () => {
    (globalThis as G).__downloadImpl = (_bucket: string, path: string) =>
      path.includes('cnh')
        ? Promise.resolve({ data: null, error: { message: 'denied' } })
        : Promise.resolve({ data: new Blob(['x'], { type: 'image/png' }), error: null });

    const result = await sendDriverDocuments('conv-1', 'user-1', [cnhItem, fotoItem]);

    expect(result.sent.map((i) => i.id)).toEqual(['doc:2']);
    expect(result.failed.map((f) => f.item.id)).toEqual(['doc:1']);
    expect(attachCalls.map((c) => c.fileName)).toEqual(['foto.png']);
  });

  it('lista vazia → nada enviado, sem erro', async () => {
    const result = await sendDriverDocuments('conv-1', 'user-1', []);
    expect(result.sent).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(attachCalls).toHaveLength(0);
  });
});
