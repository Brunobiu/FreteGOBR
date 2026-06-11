/**
 * Assertions de auditoria — spec finalizacao-lancamento (Área 2).
 *
 * Decisões oficiais de governança (testing-governance.md):
 *   - Verificação de auditoria só passa quando o registro está PERSISTIDO
 *     em `admin_audit_logs` (Property 8). A execução do processo não basta.
 *   - Falha de audit logging NÃO bloqueia a mutação administrativa
 *     (Property 9).
 *   - RPC sem permissão grava `<MODULE>_VIEW_DENIED` com `before=NULL`.
 *
 * Estes helpers são agnósticos de transporte: recebem uma função de busca
 * (`fetchLogs`) que devolve as linhas de `admin_audit_logs`. Em testes de
 * integração ela consulta o Supabase real; em unit tests, um mock in-memory.
 *
 * Validates: Requirements 14.3, 14.4
 */

import { expect } from 'vitest';

/** Forma mínima de uma linha de admin_audit_logs relevante às asserções. */
export interface AuditLogRowLike {
  action: string;
  target_type: string | null;
  target_id: string | null;
  before_data?: unknown;
  after_data?: unknown;
}

/** Fonte de logs: devolve as linhas persistidas (ordem irrelevante). */
export type AuditLogFetcher = () => Promise<AuditLogRowLike[]> | AuditLogRowLike[];

export interface ExpectAuditPersistedArgs {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
}

/**
 * Property 8 — aprova SOMENTE se existe um registro PERSISTIDO em
 * admin_audit_logs com a `action` (e, se informados, targetType/targetId).
 */
export async function expectAuditPersisted(
  fetchLogs: AuditLogFetcher,
  args: ExpectAuditPersistedArgs
): Promise<void> {
  const rows = await fetchLogs();
  const match = rows.find(
    (r) =>
      r.action === args.action &&
      (args.targetType === undefined || r.target_type === args.targetType) &&
      (args.targetId === undefined || r.target_id === args.targetId)
  );
  expect(
    match,
    `esperava registro de auditoria persistido action=${args.action} ` +
      `targetType=${args.targetType} targetId=${args.targetId}, mas não encontrei. ` +
      `Ações presentes: ${rows.map((r) => r.action).join(', ') || '(nenhuma)'}`
  ).toBeTruthy();
}

/**
 * Property 9 — a mutação deve ter sucesso MESMO quando o audit logging
 * falha. Recebe a promise da mutação (com o logger forçado a falhar) e
 * verifica que ela resolve sem lançar.
 */
export async function expectMutationSucceedsDespiteAuditFailure<T>(
  mutation: Promise<T>
): Promise<T> {
  let result: T;
  try {
    result = await mutation;
  } catch (err) {
    expect.fail(
      `a mutação deveria ter sucesso apesar da falha de audit logging, mas lançou: ${
        (err as Error)?.message ?? String(err)
      }`
    );
  }
  return result!;
}

/**
 * Caminho negativo de RPC gated — verifica que foi gravado
 * `<MODULE>_VIEW_DENIED` com `before=NULL` (e, opcionalmente, after com
 * user_id/reason).
 */
export async function expectViewDenied(
  fetchLogs: AuditLogFetcher,
  deniedAction: string
): Promise<void> {
  const rows = await fetchLogs();
  const match = rows.find((r) => r.action === deniedAction);
  expect(match, `esperava ${deniedAction} persistido no caminho negativo`).toBeTruthy();
  if (match) {
    expect(match.before_data ?? null, `${deniedAction} deve ter before=NULL`).toBeNull();
  }
}
