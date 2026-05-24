/**
 * admin/audit.ts
 *
 * Audit log do painel admin.
 * - logAdminAction: registra acao via RPC log_admin_action
 * - executeAdminMutation: log + mutate com rollback-log on fail
 * - listAuditLogs / exportAuditLogsCSV
 */

import { supabase } from '../supabase';

export type AdminActionLog =
  | 'ADMIN_LOGIN_SUCCESS'
  | 'ADMIN_LOGIN_FAILURE'
  | 'ADMIN_LOGOUT'
  | 'ADMIN_LOCKOUT'
  | 'ADMIN_STEALTH_BLOCK'
  | 'ADMIN_MFA_SETUP'
  | 'ADMIN_MFA_VERIFY'
  | 'ADMIN_MFA_BACKUP_CODE_USED'
  | 'ADMIN_MFA_BACKUP_CODES_REGENERATED'
  | 'ADMIN_MFA_RESET'
  | 'ADMIN_ROLE_GRANTED'
  | 'ADMIN_ROLE_REVOKED'
  | 'AUDIT_VIEW'
  | 'AUDIT_EXPORT'
  | string; // extensivel

export interface LogAdminActionInput {
  action: AdminActionLog;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AdminAuditLogRow {
  id: string;
  admin_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before_data: unknown;
  after_data: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditFilters {
  adminId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  fromDate?: string;
  toDate?: string;
}

export function serializeAuditData(o: unknown): unknown {
  if (o === undefined) return null;
  return JSON.parse(JSON.stringify(o));
}

export function deserializeAuditData(s: unknown): unknown {
  if (s === null || s === undefined) return null;
  return s;
}

export async function logAdminAction(input: LogAdminActionInput): Promise<string | null> {
  const { data, error } = await supabase.rpc('log_admin_action', {
    p_action: input.action,
    p_target_type: input.targetType ?? null,
    p_target_id: input.targetId ?? null,
    p_before: input.before == null ? null : serializeAuditData(input.before),
    p_after: input.after == null ? null : serializeAuditData(input.after),
    p_ip: input.ip ?? null,
    p_user_agent:
      input.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
  });
  if (error) {
    console.error('[admin/audit] logAdminAction failed', error);
    return null;
  }
  return data as string;
}

/**
 * Garante que toda mutacao admin gere audit log.
 * Padrao: log -> mutate. Se mutate falhar, dispara um log _ROLLBACK.
 */
export async function executeAdminMutation<T>(
  input: LogAdminActionInput,
  fn: () => Promise<T>
): Promise<T> {
  const logId = await logAdminAction(input);
  try {
    const result = await fn();
    return result;
  } catch (err) {
    await logAdminAction({
      action: `${input.action}_ROLLBACK`,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      before: { originalLogId: logId },
      after: { error: (err as Error)?.message ?? String(err) },
    });
    throw err;
  }
}

export async function listAuditLogs(args: {
  filters?: AuditFilters;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: AdminAuditLogRow[]; total: number }> {
  const page = args.page ?? 0;
  const pageSize = args.pageSize ?? 50;
  let q = supabase
    .from('admin_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  const f = args.filters ?? {};
  if (f.adminId) q = q.eq('admin_id', f.adminId);
  if (f.action) q = q.eq('action', f.action);
  if (f.targetType) q = q.eq('target_type', f.targetType);
  if (f.targetId) q = q.eq('target_id', f.targetId);
  if (f.fromDate) q = q.gte('created_at', f.fromDate);
  if (f.toDate) q = q.lte('created_at', f.toDate);

  const { data, error, count } = await q;
  if (error) throw error;
  await logAdminAction({ action: 'AUDIT_VIEW' });
  return { rows: (data ?? []) as AdminAuditLogRow[], total: count ?? 0 };
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportAuditLogsCSV(args: { filters?: AuditFilters }): Promise<string> {
  const { rows } = await listAuditLogs({ filters: args.filters, pageSize: 10_000 });
  const header = [
    'id',
    'admin_id',
    'action',
    'target_type',
    'target_id',
    'before_data',
    'after_data',
    'ip',
    'user_agent',
    'created_at',
  ].join(',');
  const body = rows
    .map((r) =>
      [
        r.id,
        r.admin_id,
        r.action,
        r.target_type,
        r.target_id,
        r.before_data,
        r.after_data,
        r.ip,
        r.user_agent,
        r.created_at,
      ]
        .map(csvEscape)
        .join(',')
    )
    .join('\n');
  await logAdminAction({ action: 'AUDIT_EXPORT' });
  return `${header}\n${body}`;
}
