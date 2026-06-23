/**
 * Service de envio de documentos do motorista para a conversa do chat
 * (feature `chat-enviar-documentos`).
 *
 * Ponte cliente que reusa a infraestrutura existente:
 *  - `getDocumentsByUser` / `getMotoristaReferences` → origem dos arquivos
 *    (bucket `documents`, RLS owner-only);
 *  - `sendFreteAttachment` → entrega no chat (bucket `chat-attachments`, RLS de
 *    participante + pasta do remetente).
 *
 * Segurança por defesa em profundidade: o download só funciona para arquivos do
 * próprio motorista (RLS de `documents`) e o upload só na pasta do remetente em
 * conversa de que ele participa (RLS de `chat-attachments`). Nenhum caminho
 * envia documento de terceiro — não há código de servidor novo.
 */

import { getDocumentsByUser } from './documents';
import { getMotoristaReferences } from './motorista';
import { sendFreteAttachment, type FreteMessage } from './chatFrete';
import { supabase } from './supabase';
import {
  buildSendableCatalog,
  attachmentKindForMime,
  type SendableDocument,
  type CatalogDocInput,
  type CatalogRefInput,
} from './driverDocsCatalog';

export type { SendableDocument } from './driverDocsCatalog';

/**
 * Carrega os documentos do cadastro + CT-e das referências do motorista e
 * devolve o catálogo de itens enviáveis pronto para o modal. Pode lançar se a
 * leitura falhar — o chamador (modal) trata exibindo erro com opção de retry.
 */
export async function listSendableDriverDocuments(userId: string): Promise<SendableDocument[]> {
  const [docs, refs] = await Promise.all([
    getDocumentsByUser(userId),
    getMotoristaReferences(userId),
  ]);

  const docInputs: CatalogDocInput[] = docs.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    filePath: d.filePath,
    fileName: d.fileName,
    mimeType: d.mimeType ?? null,
  }));

  const refInputs: CatalogRefInput[] = refs.map((r) => ({
    id: r.id,
    companyName: r.companyName,
    ctePath: r.ctePath ?? null,
    cteName: r.cteName ?? null,
  }));

  return buildSendableCatalog(docInputs, refInputs);
}

/** Resultado do envio em lote: o que foi enviado e o que falhou (por item). */
export interface SendResult {
  sent: SendableDocument[];
  failed: { item: SendableDocument; reason: string }[];
}

/** Limite de envios simultâneos (pool de concorrência). */
const SEND_CONCURRENCY = 3;

/**
 * Envia UM documento: baixa o arquivo do bucket `documents` (a RLS só deixa o
 * dono baixar) e o reenvia ao chat via `sendFreteAttachment`. Lança em qualquer
 * falha (download/upload/insert) para ser isolada por item no lote.
 */
async function sendOneDocument(
  conversationId: string,
  senderId: string,
  item: SendableDocument
): Promise<FreteMessage> {
  const { data: blob, error } = await supabase.storage
    .from('documents')
    .download(item.sourcePath);

  if (error || !blob) {
    throw new Error('Não foi possível baixar o documento.');
  }

  const mime = item.mimeType ?? (blob as Blob).type ?? 'application/octet-stream';
  const file = new File([blob], item.fileName, { type: mime });
  const kind = attachmentKindForMime(mime);

  // Texto vazio: enviamos apenas o arquivo, sem legenda (Req 7.2).
  return sendFreteAttachment(conversationId, senderId, file, kind, '');
}

/**
 * Envia os documentos selecionados para a conversa como anexos. Falhas são
 * isoladas por item (o lote nunca aborta inteiro); o resultado reporta os
 * enviados e os que falharam para a UI permitir reenvio (Req 8).
 */
export async function sendDriverDocuments(
  conversationId: string,
  senderId: string,
  items: SendableDocument[]
): Promise<SendResult> {
  const sent: SendableDocument[] = [];
  const failed: { item: SendableDocument; reason: string }[] = [];
  const queue = [...items];

  async function worker(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (!item) break;
      try {
        await sendOneDocument(conversationId, senderId, item);
        sent.push(item);
      } catch (err) {
        failed.push({
          item,
          reason: err instanceof Error ? err.message : 'Falha ao enviar o documento.',
        });
      }
    }
  }

  const poolSize = Math.min(SEND_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  return { sent, failed };
}
