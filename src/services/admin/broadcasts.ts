/**
 * services/admin/broadcasts.ts
 *
 * Service do módulo Broadcast (Comunicados) do painel admin.
 *
 * Spec: .kiro/specs/notifications-hub/{requirements,design,tasks}.md
 *
 * Cobertura:
 *   - 2.1: tipos públicos (Broadcast, TargetAudience, BroadcastStatus).
 *   - 2.4: helper mapPostgresError.
 *   - 3.1-3.3: leituras (listBroadcasts, getBroadcastDetail,
 *     previewBroadcastRecipients).
 *   - 4.1: createBroadcast (mutação envolvida em executeAdminMutation).
 *
 * Padrões herdados (ver project-conventions.md e admin-patterns.md):
 *   - Audit-by-construction via executeAdminMutation.
 *   - Two-layer gating (UI + RPC SECURITY DEFINER).
 *   - pt-BR em comentários e mensagens user-facing; action codes em inglês
 *     UPPER_SNAKE.
 */

import { supabase } from '../supabase';
import { executeAdminMutation } from './audit';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

/**
 * Audiência alvo de um broadcast.
 *
 * - `motorista`: todos motoristas ativos.
 * - `embarcador`: todos embarcadores ativos.
 * - `empresa`: reservado para Phase 2 (papel ainda não existe). O fan-out
 *   ignora silenciosamente, mas a opção é exposta na UI como "(em breve)"
 *   para permitir comunicados pré-criados quando o papel chegar.
 */
export type TargetAudience = 'motorista' | 'embarcador' | 'empresa';

/**
 * Status de um broadcast.
 *
 * Phase 1 só usa `'sent'`. `'draft'` e `'scheduled'` reservados para Phase 2
 * (rascunho e agendamento).
 */
export type BroadcastStatus = 'sent' | 'draft' | 'scheduled';

/**
 * Comunicado broadcast criado pelo admin. Persistido em
 * `broadcast_announcements`, com fan-out automático via trigger
 * `broadcast_fanout_after_insert` que gera linhas em `notifications` para
 * cada usuário ativo dentro do `targetAudience`.
 */
export interface Broadcast {
  /** UUID da linha em `broadcast_announcements`. */
  id: string;
  /** Título exibido na notificação. 1–120 caracteres. */
  title: string;
  /** Corpo exibido na notificação. 1–2000 caracteres. */
  body: string;
  /** Link opcional acionado ao clicar na notificação. ≤500 chars. */
  link: string | null;
  /** Subset não-vazio de `{motorista, embarcador, empresa}`. */
  targetAudience: TargetAudience[];
  /** Phase 1 sempre `'sent'`. */
  status: BroadcastStatus;
  /** Quantos usuários receberam (preenchido pelo trigger). NULL antes do dispatch. */
  recipientsCount: number | null;
  /** Quando o fan-out concluiu. NULL antes do dispatch. */
  dispatchedAt: string | null;
  /** UUID do admin criador. */
  createdBy: string | null;
  /** ISO timestamp de criação. */
  createdAt: string;
  /** ISO timestamp de última modificação. */
  updatedAt: string;
}

/** Detalhe estendido com breakdown de destinatários por papel. */
export interface BroadcastDetail extends Broadcast {
  /**
   * Quantidade de destinatários por papel (motorista, embarcador, empresa).
   * Preenchido apenas no `getBroadcastDetail`.
   */
  recipientsByType: Record<TargetAudience, number>;
}

// ─── Erros tipados ──────────────────────────────────────────────────────────

export type BroadcastErrorCode =
  | 'PERMISSION_DENIED'
  | 'INVALID_TITLE'
  | 'INVALID_BODY'
  | 'INVALID_LINK'
  | 'EMPTY_AUDIENCE'
  | 'INVALID_AUDIENCE'
  | 'NOT_FOUND'
  | 'UNKNOWN';

const BROADCAST_ERROR_MESSAGES: Record<BroadcastErrorCode, string> = {
  PERMISSION_DENIED: 'Voce nao tem permissao para acessar esta area.',
  INVALID_TITLE: 'Titulo invalido. Use entre 1 e 120 caracteres.',
  INVALID_BODY: 'Mensagem invalida. Use entre 1 e 2000 caracteres.',
  INVALID_LINK: 'Link invalido. Maximo de 500 caracteres.',
  EMPTY_AUDIENCE: 'Selecione pelo menos um publico-alvo.',
  INVALID_AUDIENCE: 'Publico-alvo contem valor invalido.',
  NOT_FOUND: 'Comunicado nao encontrado.',
  UNKNOWN: 'Nao foi possivel concluir.',
};

export class BroadcastError extends Error {
  readonly code: BroadcastErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: BroadcastErrorCode, details?: Record<string, unknown>, cause?: unknown) {
    super(BROADCAST_ERROR_MESSAGES[code]);
    this.name = 'BroadcastError';
    this.code = code;
    this.details = details;
    if (cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = cause;
    }
  }
}

/**
 * Mapeia erros do Postgres/Supabase para `BroadcastError` tipado.
 *
 * Códigos esperados:
 * - ERRCODE 42501 / `permission_denied: FINANCEIRO_EDIT required` ⇒ PERMISSION_DENIED
 * - ERRCODE P0001 / 'INVALID_TITLE' ⇒ INVALID_TITLE
 * - ERRCODE P0001 / 'INVALID_BODY' ⇒ INVALID_BODY
 * - ERRCODE P0001 / 'INVALID_LINK' ⇒ INVALID_LINK
 * - ERRCODE P0001 / 'EMPTY_AUDIENCE' ⇒ EMPTY_AUDIENCE
 * - ERRCODE P0001 / 'INVALID_AUDIENCE' ⇒ INVALID_AUDIENCE
 * - Outros ⇒ UNKNOWN (preserva anti-enumeration).
 */
export function mapPostgresError(err: unknown): BroadcastError {
  if (err instanceof BroadcastError) return err;

  const msg =
    (err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)) || '';
  const code =
    (err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '') || '';

  const wrap = (c: BroadcastErrorCode) => new BroadcastError(c, { original: msg }, err);

  if (code === '42501' || msg.includes('permission_denied')) return wrap('PERMISSION_DENIED');
  if (msg.includes('INVALID_TITLE')) return wrap('INVALID_TITLE');
  if (msg.includes('INVALID_BODY')) return wrap('INVALID_BODY');
  if (msg.includes('INVALID_LINK')) return wrap('INVALID_LINK');
  if (msg.includes('EMPTY_AUDIENCE')) return wrap('EMPTY_AUDIENCE');
  if (msg.includes('INVALID_AUDIENCE')) return wrap('INVALID_AUDIENCE');
  if (msg.includes('NOT_FOUND')) return wrap('NOT_FOUND');

  return wrap('UNKNOWN');
}

// ─── Mapeadores de DB row ───────────────────────────────────────────────────

interface BroadcastRow {
  id: string;
  title: string;
  body: string;
  link: string | null;
  target_audience: string[];
  status: string;
  recipients_count: number | null;
  dispatched_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToBroadcast(row: BroadcastRow): Broadcast {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    link: row.link,
    targetAudience: row.target_audience as TargetAudience[],
    status: row.status as BroadcastStatus,
    recipientsCount: row.recipients_count,
    dispatchedAt: row.dispatched_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Leituras ───────────────────────────────────────────────────────────────

/**
 * Lista comunicados com paginação. Apenas admin com FINANCEIRO_VIEW
 * ou FINANCEIRO_EDIT vê linhas (RLS).
 *
 * @param opts.limit padrão 50.
 * @param opts.offset padrão 0.
 */
export async function listBroadcasts(
  opts: { limit?: number; offset?: number } = {}
): Promise<{ items: Broadcast[]; total: number }> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);

  const { data, error, count } = await supabase
    .from('broadcast_announcements')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw mapPostgresError(error);

  return {
    items: (data ?? []).map((r) => rowToBroadcast(r as BroadcastRow)),
    total: count ?? 0,
  };
}

/**
 * Detalhe de um broadcast com breakdown de destinatários por papel.
 * Faz JOIN com `notifications` filtrando `broadcast_id = id` e agregando
 * por `users.user_type`.
 */
export async function getBroadcastDetail(id: string): Promise<BroadcastDetail> {
  const { data: broadcastRow, error: broadcastErr } = await supabase
    .from('broadcast_announcements')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (broadcastErr) throw mapPostgresError(broadcastErr);
  if (!broadcastRow) throw new BroadcastError('NOT_FOUND');

  const broadcast = rowToBroadcast(broadcastRow as BroadcastRow);

  // Breakdown: agrega notifications.user_id → users.user_type
  const { data: breakdownRows, error: breakdownErr } = await supabase
    .from('notifications')
    .select('user_id, users!inner(user_type)')
    .eq('broadcast_id', id);

  const recipientsByType: Record<TargetAudience, number> = {
    motorista: 0,
    embarcador: 0,
    empresa: 0,
  };

  if (!breakdownErr && breakdownRows) {
    for (const row of breakdownRows as Array<{
      users: { user_type: string } | { user_type: string }[] | null;
    }>) {
      const u = row.users;
      const userType = Array.isArray(u) ? u[0]?.user_type : u?.user_type;
      if (userType === 'motorista' || userType === 'embarcador' || userType === 'empresa') {
        recipientsByType[userType]++;
      }
    }
  }

  return { ...broadcast, recipientsByType };
}

/**
 * Estima destinatários antes de despachar. Usado no modal de confirmação
 * para mostrar "Enviar para X destinatários estimados?".
 *
 * Performance: consulta com `count='exact'` é eficiente quando há índice
 * em `users.user_type` (existe — migration 001).
 */
export async function previewBroadcastRecipients(audience: TargetAudience[]): Promise<number> {
  if (!audience || audience.length === 0) return 0;

  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .in('user_type', audience);

  if (error) {
    // Não bloquear UI por falha de preview — retorna 0 e segue.
    return 0;
  }
  return count ?? 0;
}

// ─── Mutações ───────────────────────────────────────────────────────────────

/**
 * Cria um broadcast. O fan-out é automático via trigger SQL.
 *
 * Audit-by-construction: envolvido em `executeAdminMutation` com action
 * `BROADCAST_CREATE`.
 *
 * @throws BroadcastError com `code` canônico (ver mapPostgresError).
 */
export async function createBroadcast(input: {
  title: string;
  body: string;
  link?: string | null;
  targetAudience: TargetAudience[];
}): Promise<Broadcast> {
  return executeAdminMutation(
    {
      action: 'BROADCAST_CREATE',
      targetType: 'broadcast_announcements',
      targetId: null,
      before: null,
      after: {
        title: input.title,
        target_audience: input.targetAudience,
        link: input.link ?? null,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('rpc_create_broadcast', {
        p_title: input.title,
        p_body: input.body,
        p_link: input.link ?? null,
        p_target_audience: input.targetAudience,
      });
      if (error) throw mapPostgresError(error);

      const row = (data ?? {}) as Partial<BroadcastRow>;
      // Validação defensiva: o RPC sempre retorna row completa, mas se algo
      // saiu errado (driver, version mismatch), levanta erro tipado.
      if (!row.id || !row.title) {
        throw new BroadcastError('UNKNOWN', { reason: 'rpc_response_malformed' });
      }
      return rowToBroadcast(row as BroadcastRow);
    }
  );
}
