/**
 * contents.ts — gerência dos WhatsApp_Contents de um disparo (camada de serviço).
 *
 * Envolve as RPCs `whatsapp_upsert_content` / `whatsapp_list_contents` /
 * `whatsapp_delete_content` (migration 096), que persistem os Contents
 * escopados por `instance_id`. Um disparo suporta **múltiplos** Contents
 * (Req 6.1), ordenados por `position` para a distribuição BLOCK/INTERLEAVED.
 *
 * Regra de validade (Req 6.5): um Content é válido quando tem TEXTO (body não
 * vazio) OU ao menos UMA mídia associada. A regra é validada em DUAS camadas:
 * - frontend/serviço, reusando `validateContent` de `validation.ts` antes de
 *   chamar a RPC (bloqueio + Canonical_Message pt-BR);
 * - backend, na própria RPC, que RECALCULA `is_valid` a partir do body e da
 *   contagem real de `whatsapp_content_media` (o cliente não decide a validade).
 *
 * Padrões (admin-patterns):
 * - LEITURA (`listContents`) chama a RPC diretamente, sem auditar.
 * - MUTAÇÕES (`createContent`/`updateContent`/`deleteContent`) passam por
 *   `executeAdminMutation` (audit-by-construction, #1), sempre registrando o
 *   `instance_id` no log.
 * - Erros são mapeados por `mapInstanceGuardError` (anti-enumeração canônica).
 *
 * NOTA: o upload do arquivo de mídia + validação de MIME é a task 9.2
 * (MediaUploader). Aqui as mídias associadas são apenas referenciadas (via
 * `mediaCount`); este serviço não faz upload.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 *
 * _Requirements: 6.1, 6.5, 6.6, 2.5_
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError } from './guards';
import { validateContent } from './validation';

/**
 * Um WhatsApp_Content como exposto à UI. `isValid` reflete a regra Req 6.5
 * (texto OU ≥1 mídia), recalculada server-side. `mediaCount` é a contagem de
 * `whatsapp_content_media` associadas (gerenciadas pela task 9.2).
 */
export interface WhatsAppContent {
  id: string;
  instanceId: string;
  dispatchJobId: string | null;
  body: string | null;
  position: number;
  mediaCount: number;
  isValid: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Forma crua (snake_case) retornada pelas RPCs de Content. */
interface WhatsAppContentRow {
  id: string;
  instance_id: string;
  dispatch_job_id: string | null;
  body: string | null;
  position: number;
  media_count: number;
  is_valid: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** Entrada para criar um Content. */
export interface CreateContentInput {
  /** Texto do Content (template com Message_Variables). Opcional se houver mídia. */
  body?: string | null;
  /** Ordem do Content na distribuição (BLOCK/INTERLEAVED). */
  position: number;
  /** Disparo ao qual o Content pertence (opcional para rascunho/avulso). */
  dispatchJobId?: string | null;
  /**
   * Quantidade de mídias já associadas, usada na validação front. Em criação
   * normalmente é 0 (mídias são anexadas depois, task 9.2).
   */
  mediaCount?: number;
}

/** Entrada para atualizar um Content existente. */
export interface UpdateContentInput {
  body?: string | null;
  position: number;
  dispatchJobId?: string | null;
  /** Versão esperada (versionamento otimista → `STALE_VERSION`). */
  expectedUpdatedAt?: string | null;
  /** Mídias já associadas, para validação front (texto OU ≥1 mídia). */
  mediaCount?: number;
}

/** Resultado de `deleteContent`. */
export interface DeleteContentResult {
  id: string;
  dispatchJobId: string | null;
  /** Contents restantes no mesmo disparo após a remoção. */
  remaining: number;
}

/** Converte a linha crua da RPC para o shape camelCase da camada de serviço. */
function mapContent(row: WhatsAppContentRow): WhatsAppContent {
  return {
    id: row.id,
    instanceId: row.instance_id,
    dispatchJobId: row.dispatch_job_id,
    body: row.body,
    position: row.position,
    mediaCount: row.media_count ?? 0,
    isValid: row.is_valid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lista os Contents da instância, ordenados por `position`. Quando
 * `dispatchJobId` é informado, filtra os Contents daquele disparo. LEITURA —
 * não audita.
 *
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function listContents(
  instanceId: string,
  dispatchJobId: string | null = null
): Promise<WhatsAppContent[]> {
  const { data, error } = await supabase.rpc('whatsapp_list_contents', {
    p_instance_id: instanceId,
    p_dispatch_job_id: dispatchJobId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const rows = (data ?? []) as WhatsAppContentRow[];
  return rows.map(mapContent);
}

/**
 * Cria um novo Content escopado por `instance_id`. Revalida a regra Req 6.5 no
 * front (texto OU ≥1 mídia) antes de chamar a RPC, que reenforça a regra no
 * backend. Mutação auditada com `instance_id`.
 *
 * @throws Error('Informe um texto ou anexe ao menos uma mídia.') quando inválido.
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function createContent(
  instanceId: string,
  input: CreateContentInput
): Promise<WhatsAppContent> {
  const validation = validateContent({ body: input.body, mediaCount: input.mediaCount ?? 0 });
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  return executeAdminMutation(
    {
      action: 'WHATSAPP_CONTENT_CREATE',
      targetType: 'whatsapp_contents',
      targetId: instanceId,
      before: null,
      after: {
        instance_id: instanceId,
        dispatch_job_id: input.dispatchJobId ?? null,
        position: input.position,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_upsert_content', {
        p_instance_id: instanceId,
        p_position: input.position,
        p_content_id: null,
        p_body: input.body ?? null,
        p_dispatch_job_id: input.dispatchJobId ?? null,
        p_expected_updated_at: null,
      });
      if (error) {
        throw new Error(mapInstanceGuardError(error));
      }
      return mapContent(data as WhatsAppContentRow);
    }
  );
}

/**
 * Atualiza um Content existente escopado por `instance_id`, com versionamento
 * otimista (`expectedUpdatedAt` → `STALE_VERSION`). Revalida a regra Req 6.5 no
 * front antes da RPC, que reenforça no backend recalculando `is_valid` com a
 * contagem real de mídias. Mutação auditada com `instance_id`.
 *
 * @throws Error('Informe um texto ou anexe ao menos uma mídia.') quando inválido.
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function updateContent(
  instanceId: string,
  contentId: string,
  input: UpdateContentInput
): Promise<WhatsAppContent> {
  const validation = validateContent({ body: input.body, mediaCount: input.mediaCount ?? 0 });
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  return executeAdminMutation(
    {
      action: 'WHATSAPP_CONTENT_UPDATE',
      targetType: 'whatsapp_contents',
      targetId: contentId,
      before: { instance_id: instanceId },
      after: {
        instance_id: instanceId,
        dispatch_job_id: input.dispatchJobId ?? null,
        position: input.position,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_upsert_content', {
        p_instance_id: instanceId,
        p_position: input.position,
        p_content_id: contentId,
        p_body: input.body ?? null,
        p_dispatch_job_id: input.dispatchJobId ?? null,
        p_expected_updated_at: input.expectedUpdatedAt ?? null,
      });
      if (error) {
        throw new Error(mapInstanceGuardError(error));
      }
      return mapContent(data as WhatsAppContentRow);
    }
  );
}

/**
 * Remove um Content escopado por `instance_id` (cascade nas mídias associadas).
 * Versionamento otimista opcional (`expectedUpdatedAt` → `STALE_VERSION`).
 * Mutação auditada com `instance_id`.
 *
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function deleteContent(
  instanceId: string,
  contentId: string,
  expectedUpdatedAt: string | null = null
): Promise<DeleteContentResult> {
  return executeAdminMutation(
    {
      action: 'WHATSAPP_CONTENT_DELETE',
      targetType: 'whatsapp_contents',
      targetId: contentId,
      before: { instance_id: instanceId },
      after: null,
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_delete_content', {
        p_instance_id: instanceId,
        p_content_id: contentId,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) {
        throw new Error(mapInstanceGuardError(error));
      }
      const row = data as { id: string; dispatch_job_id: string | null; remaining: number };
      return {
        id: row.id,
        dispatchJobId: row.dispatch_job_id,
        remaining: row.remaining,
      };
    }
  );
}
