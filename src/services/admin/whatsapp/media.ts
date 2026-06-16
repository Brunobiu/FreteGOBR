/**
 * media.ts — upload e remocao de WhatsApp_Content_Media (camada de servico).
 *
 * Implementa a parte de MIDIA de um WhatsApp_Content (task 9.2). Um Content
 * aceita QUALQUER combinacao de texto + imagem/video/audio/documento (Req 6.2);
 * este servico cuida apenas das midias: faz o upload do arquivo para o bucket
 * privado `whatsapp-media` (path `<instance_id>/<content_id>/<filename>`,
 * isolado por instancia — Req 6.4) e registra a linha em
 * `whatsapp_content_media` via a RPC `whatsapp_add_content_media` (migration
 * 100), que recalcula a validade do Content-pai (Req 6.5).
 *
 * Validacao de MIME (Req 6.3): ANTES do upload, o tipo do arquivo e validado
 * com `validateMimeType` de `validation.ts` (reuso de `SUPPORTED_MIME_TYPES`).
 * MIME nao suportado => erro com `code = 'INVALID_FILE_TYPE'` e Canonical_Message
 * pt-BR `Tipo de arquivo nao suportado.` — o arquivo nem chega a subir.
 *
 * Padroes (admin-patterns):
 * - As mutacoes (`uploadContentMedia`/`removeContentMedia`) passam por
 *   `executeAdminMutation` (audit-by-construction, #1), registrando o
 *   `instance_id`. O audit NUNCA carrega o conteudo binario do arquivo.
 * - Erros de RPC sao mapeados por `mapInstanceGuardError` (anti-enumeracao).
 * - Best-effort de consistencia: se a RPC falhar apos o upload, o objeto
 *   recem-enviado e removido do bucket (rollback), evitando orfaos.
 *
 * Identifiers/codes em ingles; mensagens user-facing em pt-BR.
 *
 * _Requirements: 6.2, 6.3, 6.4, 6.5, 2.5_
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError } from './guards';
import { SUPPORTED_MIME_TYPES, validateMimeType } from './validation';

/** Nome do bucket privado de midias (criado na migration 092). */
const WHATSAPP_MEDIA_BUCKET = 'whatsapp-media' as const;

/**
 * Domínio fechado de media_type (espelha o domínio SQL `media_type` da 092).
 */
export type WhatsAppMediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

/** Uma midia anexada a um Content, como exposta a UI. */
export interface WhatsAppContentMedia {
  id: string;
  instanceId: string;
  contentId: string;
  mediaType: WhatsAppMediaType;
  storagePath: string;
  mimeType: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Forma crua (snake_case) retornada pela RPC `whatsapp_add_content_media`. */
interface WhatsAppContentMediaRow {
  id: string;
  instance_id: string;
  content_id: string;
  media_type: WhatsAppMediaType;
  storage_path: string;
  mime_type: string;
  created_at: string | null;
  updated_at: string | null;
}

/** Resultado de `removeContentMedia`. */
export interface RemoveContentMediaResult {
  id: string;
  contentId: string;
  /** Midias restantes no mesmo Content apos a remocao. */
  remaining: number;
}

/**
 * Erro tipado de validacao de arquivo. Carrega o Error_Code estavel
 * (`INVALID_FILE_TYPE`) para uso programatico, alem da Canonical_Message pt-BR.
 */
export class MediaValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MediaValidationError';
    this.code = code;
  }
}

/** Converte a linha crua da RPC para o shape camelCase da camada de servico. */
function mapMedia(row: WhatsAppContentMediaRow): WhatsAppContentMedia {
  return {
    id: row.id,
    instanceId: row.instance_id,
    contentId: row.content_id,
    mediaType: row.media_type,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deriva o `media_type` (IMAGE|VIDEO|AUDIO|DOCUMENT) a partir do MIME, reusando
 * o mapeamento canonico `SUPPORTED_MIME_TYPES`. Retorna `null` quando o MIME
 * nao pertence a nenhum grupo suportado. A comparacao ignora caixa e os
 * parametros pos-`;` (ex.: `; charset=...`), igual a `validateMimeType`.
 */
export function mediaTypeForMime(mime: unknown): WhatsAppMediaType | null {
  const normalized = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
  if (normalized === '') return null;

  for (const group of Object.keys(SUPPORTED_MIME_TYPES) as WhatsAppMediaType[]) {
    const list = SUPPORTED_MIME_TYPES[group] as readonly string[];
    if (list.includes(normalized)) {
      return group;
    }
  }
  return null;
}

/**
 * Normaliza o nome do arquivo para um segmento de path seguro do Storage,
 * preservando a extensao. Evita caracteres problematicos no path e colisoes.
 */
function safeStorageFilename(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const rawExt = dot >= 0 ? originalName.slice(dot + 1) : '';
  const ext = rawExt
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  const prefix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return ext ? `${prefix}.${ext}` : prefix;
}

/**
 * Faz o upload de um arquivo de midia e o associa ao Content (Req 6.2, 6.3, 6.4).
 *
 * Fluxo:
 *  1. Valida o MIME com `validateMimeType` (Req 6.3). MIME nao suportado =>
 *     `MediaValidationError` (`code = 'INVALID_FILE_TYPE'`) ANTES de qualquer I/O.
 *  2. Faz o upload para `whatsapp-media` em
 *     `<instanceId>/<contentId>/<filename>` (isolamento por instancia no path).
 *  3. Registra a linha via RPC `whatsapp_add_content_media` (recalcula a
 *     validade do Content-pai). Se a RPC falhar, o objeto enviado e removido
 *     (rollback best-effort) e o erro e propagado (mapeado para anti-enumeracao).
 *
 * @throws MediaValidationError quando o MIME nao e suportado.
 * @throws Error com a mensagem mapeada (anti-enumeracao quando aplicavel).
 */
export async function uploadContentMedia(
  instanceId: string,
  contentId: string,
  file: File
): Promise<WhatsAppContentMedia> {
  // (1) Validacao de MIME (Req 6.3) — reuso da validacao pura compartilhada.
  const validation = validateMimeType(file.type);
  if (!validation.ok) {
    throw new MediaValidationError(validation.error, validation.message);
  }

  const mediaType = mediaTypeForMime(file.type);
  if (mediaType === null) {
    // Defensivo: validateMimeType ja garante suporte, mas mantemos a coerencia.
    throw new MediaValidationError('INVALID_FILE_TYPE', 'Tipo de arquivo não suportado.');
  }

  // (2) Upload para o bucket privado, escopado por instancia no path.
  const storagePath = `${instanceId}/${contentId}/${safeStorageFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(WHATSAPP_MEDIA_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) {
    throw new Error(mapInstanceGuardError(uploadError));
  }

  // (3) Registra a midia (RPC recalcula is_valid do Content). Em falha, faz
  //     rollback do objeto enviado para nao deixar orfaos no bucket.
  try {
    return await executeAdminMutation(
      {
        action: 'WHATSAPP_MEDIA_ADD',
        targetType: 'whatsapp_content_media',
        targetId: contentId,
        before: null,
        after: {
          instance_id: instanceId,
          content_id: contentId,
          media_type: mediaType,
          storage_path: storagePath,
          mime_type: file.type,
        },
      },
      async () => {
        const { data, error } = await supabase.rpc('whatsapp_add_content_media', {
          p_instance_id: instanceId,
          p_content_id: contentId,
          p_media_type: mediaType,
          p_storage_path: storagePath,
          p_mime_type: file.type,
        });
        if (error) {
          throw new Error(mapInstanceGuardError(error));
        }
        return mapMedia(data as WhatsAppContentMediaRow);
      }
    );
  } catch (err) {
    // Rollback best-effort: remove o objeto recem-enviado (ignora falha).
    await supabase.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .remove([storagePath])
      .catch(() => {});
    throw err;
  }
}

/**
 * Remove uma midia do Content (Req 6.5) e o objeto correspondente no bucket.
 *
 * A RPC `whatsapp_remove_content_media` apaga a linha, recalcula a validade do
 * Content-pai e retorna o `storage_path` do objeto; em seguida removemos o
 * arquivo do bucket (best-effort). Mutacao auditada com `instance_id`.
 *
 * @throws Error com a mensagem mapeada (anti-enumeracao quando aplicavel).
 */
export async function removeContentMedia(
  instanceId: string,
  mediaId: string
): Promise<RemoveContentMediaResult> {
  return executeAdminMutation(
    {
      action: 'WHATSAPP_MEDIA_REMOVE',
      targetType: 'whatsapp_content_media',
      targetId: mediaId,
      before: { instance_id: instanceId },
      after: null,
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_remove_content_media', {
        p_instance_id: instanceId,
        p_media_id: mediaId,
      });
      if (error) {
        throw new Error(mapInstanceGuardError(error));
      }

      const row = data as {
        id: string;
        content_id: string;
        storage_path: string;
        remaining: number;
      };

      // Remove o objeto do bucket (best-effort; o registro ja foi removido).
      if (row.storage_path) {
        await supabase.storage
          .from(WHATSAPP_MEDIA_BUCKET)
          .remove([row.storage_path])
          .catch(() => {});
      }

      return {
        id: row.id,
        contentId: row.content_id,
        remaining: row.remaining,
      };
    }
  );
}
