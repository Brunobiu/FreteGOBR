/**
 * Integração — gating das RPCs do Rastreamento (migration 124) e isolamento.
 *
 * Prova que admin (ADMIN) lê as RPCs gated (timeline/at_risk_list/funnel/
 * recovery_performance/get_config), enquanto um Cliente comum recebe
 * permission_denied (42501) em TODAS as RPCs (leitura E mutação), e nunca lê
 * journey_events/recovery_attempts direto (isolamento RLS). `auth.uid()` nulo
 * (anon) ⇒ permission_denied nas RPCs gated.
 *
 * NOTA (Postgres): o log negativo `RASTREAMENTO_VIEW_DENIED` é gravado e então a
 * RPC faz `RAISE`, o que reverte o INSERT na mesma transação (PostgREST = 1
 * transação por chamada). Por isso asserimos o ERRO `permission_denied` (42501)
 * — não a persistência do log negativo. Os audits de SUCESSO (skip/mutação)
 * persistem e são verificados em tracking_lifecycle.integration.test.ts.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 2.6, 3.9, 3.10, 15.1, 15.2, 15.4, 15.5
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asAnon,
  asUser,
  asService,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';
import { ensureUserRow, seedAdminRole, cleanupUserRow } from '../../_helpers/adminSeed';

const HOOK_TIMEOUT = 30_000;
const FAKE_ID = '11111111-1111-4111-8111-111111111111';

function deniedCode(res: { error: { code?: string; message?: string } | null }): string {
  return `${res.error?.code ?? ''}${res.error?.message ?? ''}`;
}

describeIntegration('Integração 124 — gating das RPCs do Rastreamento', () => {
  let admin: SeededUser;
  let client: SeededUser;

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'rastr-gate-admin', userType: 'embarcador' });
    client = await seedUser({ tag: 'rastr-gate-client', userType: 'motorista' });
    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    await ensureUserRow(svc, { id: client.id, userType: 'motorista' });
    await seedAdminRole(svc, admin.id, 'ADMIN'); // concede RASTREAMENTO_VIEW + MANAGE
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

  it('admin lê as RPCs de leitura gated sem erro', async () => {
    const a = asUser(admin.accessToken);
    expect((await a.rpc('rpc_tracking_at_risk_list', { p_filter: {}, p_page: 0, p_page_size: 10 })).error).toBeNull();
    expect((await a.rpc('rpc_tracking_funnel', { p_window: '7d' })).error).toBeNull();
    expect((await a.rpc('rpc_tracking_recovery_performance', { p_window: '7d' })).error).toBeNull();
    expect((await a.rpc('rpc_tracking_get_config')).error).toBeNull();
    expect((await a.rpc('rpc_tracking_timeline', { p_user_id: client.id })).error).toBeNull();
  });

  it('at_risk_list valida page_size ao conjunto {10,50,100} (default 10 fora do conjunto)', async () => {
    const a = asUser(admin.accessToken);
    const res = await a.rpc('rpc_tracking_at_risk_list', { p_filter: {}, p_page: 0, p_page_size: 999 });
    expect(res.error).toBeNull();
    expect((res.data as { page_size?: number }).page_size).toBe(10);
  });

  it('Cliente comum ⇒ permission_denied (42501) em TODAS as RPCs', async () => {
    const c = asUser(client.accessToken);
    expect(deniedCode(await c.rpc('rpc_tracking_at_risk_list', { p_filter: {}, p_page: 0, p_page_size: 10 }))).toContain('42501');
    expect(deniedCode(await c.rpc('rpc_tracking_funnel', { p_window: '7d' }))).toContain('42501');
    expect(deniedCode(await c.rpc('rpc_tracking_recovery_performance', { p_window: '7d' }))).toContain('42501');
    expect(deniedCode(await c.rpc('rpc_tracking_get_config'))).toContain('42501');
    expect(deniedCode(await c.rpc('rpc_tracking_timeline', { p_user_id: admin.id }))).toContain('42501');
    expect(
      deniedCode(await c.rpc('rpc_tracking_mark_contacted', { p_user_id: admin.id, p_expected_updated_at: new Date().toISOString() }))
    ).toContain('42501');
    expect(deniedCode(await c.rpc('rpc_tracking_trigger_recovery', { p_user_id: admin.id, p_trigger: { kind: 'RISK' } }))).toContain('42501');
    expect(
      deniedCode(await c.rpc('rpc_tracking_update_ai_config', { p_patch: { active_provider: 'grok' }, p_expected_updated_at: new Date().toISOString() }))
    ).toContain('42501');
  });

  it('anon (auth.uid() nulo) ⇒ permission_denied nas RPCs gated', async () => {
    const anon = asAnon();
    expect(deniedCode(await anon.rpc('rpc_tracking_at_risk_list', { p_filter: {}, p_page: 0, p_page_size: 10 }))).toContain('42501');
    expect(deniedCode(await anon.rpc('rpc_tracking_timeline', { p_user_id: FAKE_ID }))).toContain('42501');
    expect(deniedCode(await anon.rpc('rpc_tracking_get_config'))).toContain('42501');
  });

  it('isolamento: Cliente comum e anon não leem journey_events/recovery_attempts direto', async () => {
    const c = asUser(client.accessToken);
    expect(((await c.from('journey_events').select('id').limit(5)).data ?? []).length).toBe(0);
    expect(((await c.from('recovery_attempts').select('id').limit(5)).data ?? []).length).toBe(0);
    const anon = asAnon();
    expect(((await anon.from('journey_events').select('id').limit(5)).data ?? []).length).toBe(0);
  });
});
