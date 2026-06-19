/**
 * Integração — gating das RPCs operacionais (migration 117) e isolamento.
 *
 * Prova que admin (ADMIN) lê admin_operations_metrics/admin_alerts_list/
 * admin_logs_list, enquanto um Cliente comum recebe permission_denied (42501)
 * em TODAS as RPCs (incluindo as de mutação e a avaliação sob demanda), e nunca
 * obtém métricas/alertas/logs nem linhas de system_alerts (isolamento).
 *
 * NOTA (Postgres): o log negativo `*_VIEW_DENIED` é gravado e então a RPC faz
 * `RAISE`, o que reverte o INSERT na mesma transação (PostgREST = 1 transação
 * por chamada). Por isso asserimos o ERRO `permission_denied` (42501) — não a
 * persistência do log negativo (que não sobrevive ao rollback). Os audits de
 * caminho de SUCESSO (ALERT_GENERATED/_SKIPPED) persistem e são verificados em
 * alerts_lifecycle.integration.test.ts.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 1.10, 3.1, 5.1, 12.1, 12.5, 13.1, 13.2
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asUser,
  asService,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';
import { ensureUserRow, seedAdminRole, cleanupUserRow } from '../../_helpers/adminSeed';

const HOOK_TIMEOUT = 30_000;

function deniedCode(res: { error: { code?: string; message?: string } | null }): string {
  return `${res.error?.code ?? ''}${res.error?.message ?? ''}`;
}

describeIntegration('Integração 117 — gating das RPCs operacionais', () => {
  let admin: SeededUser;
  let client: SeededUser;

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'op-gate-admin', userType: 'embarcador' });
    client = await seedUser({ tag: 'op-gate-client', userType: 'motorista' });
    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    await ensureUserRow(svc, { id: client.id, userType: 'motorista' });
    await seedAdminRole(svc, admin.id, 'ADMIN'); // DASHBOARD_VIEW + ALERT_* + LOG_VIEW
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    for (const u of [admin, client]) {
      if (u) {
        await cleanupUserRow(svc, u.id);
        await cleanupUser(u.id);
      }
    }
  }, HOOK_TIMEOUT);

  it('admin lê admin_operations_metrics (bundle com meta/kpis/errors)', async () => {
    const { data, error } = await asUser(admin.accessToken).rpc('admin_operations_metrics', {
      p_online_window_sec: 300,
    });
    expect(error).toBeNull();
    const bundle = data as { meta?: unknown; kpis?: Record<string, unknown>; errors?: unknown };
    expect(bundle.meta).toBeTruthy();
    expect(bundle.kpis).toBeTruthy();
    // USERS_ONLINE sempre indisponível (sem Presence_Source) — nunca 0.
    const online = (bundle.kpis as Record<string, { value: number | null; available: boolean }>)
      .USERS_ONLINE;
    expect(online).toEqual({ value: null, available: false });
  });

  it('admin lê admin_alerts_list ({items,total})', async () => {
    const { data, error } = await asUser(admin.accessToken).rpc('admin_alerts_list', {
      p_state: null,
      p_type: null,
      p_severity: null,
      p_limit: 10,
      p_offset: 0,
    });
    expect(error).toBeNull();
    const res = data as { items?: unknown[]; total?: number };
    expect(Array.isArray(res.items)).toBe(true);
    expect(typeof res.total).toBe('number');
  });

  it('admin lê admin_logs_list ({items,total})', async () => {
    const { data, error } = await asUser(admin.accessToken).rpc('admin_logs_list', {
      p_event_types: null,
      p_from: null,
      p_to: null,
      p_actor: null,
      p_target_type: null,
      p_limit: 10,
      p_offset: 0,
    });
    expect(error).toBeNull();
    const res = data as { items?: unknown[]; total?: number };
    expect(Array.isArray(res.items)).toBe(true);
  });

  it('Cliente comum => permission_denied (42501) em TODAS as RPCs', async () => {
    const c = asUser(client.accessToken);
    expect(deniedCode(await c.rpc('admin_operations_metrics', { p_online_window_sec: 300 }))).toContain(
      '42501'
    );
    expect(
      deniedCode(
        await c.rpc('admin_alerts_list', {
          p_state: null,
          p_type: null,
          p_severity: null,
          p_limit: 10,
          p_offset: 0,
        })
      )
    ).toContain('42501');
    expect(
      deniedCode(
        await c.rpc('admin_logs_list', {
          p_event_types: null,
          p_from: null,
          p_to: null,
          p_actor: null,
          p_target_type: null,
          p_limit: 10,
          p_offset: 0,
        })
      )
    ).toContain('42501');
    expect(
      deniedCode(await c.rpc('admin_alerts_evaluate', { p_expiring_window_days: 3, p_awaiting_threshold_min: 30 }))
    ).toContain('42501');
    expect(
      deniedCode(
        await c.rpc('admin_alert_acknowledge', {
          p_id: '11111111-1111-4111-8111-111111111111',
          p_expected_updated_at: new Date().toISOString(),
        })
      )
    ).toContain('42501');
    expect(
      deniedCode(
        await c.rpc('admin_alert_resolve', {
          p_id: '11111111-1111-4111-8111-111111111111',
          p_expected_updated_at: new Date().toISOString(),
        })
      )
    ).toContain('42501');
  });

  it('isolamento: Cliente comum não lê system_alerts direto', async () => {
    const { data } = await asUser(client.accessToken).from('system_alerts').select('id').limit(5);
    expect((data ?? []).length).toBe(0);
  });
});
