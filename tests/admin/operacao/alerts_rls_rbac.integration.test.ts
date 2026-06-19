/**
 * Integração — RLS de system_alerts + paridade RBAC das ações novas (migration 117).
 *
 * Semeia um System_Alert via service_role (contorna RLS) e prova que:
 *   - anon, um Cliente comum e admin SEM ALERT_VIEW (SUPORTE/FINANCEIRO/MODERADOR)
 *     recebem ZERO linhas, embora o alerta exista;
 *   - admin COM ALERT_VIEW (ADMIN) lê o alerta;
 *   - nenhum role escreve direto em system_alerts (política no_dml USING/CHECK false);
 *   - is_admin_with_permission('ALERT_VIEW'/'ALERT_ACK'/'ALERT_RESOLVE'/'LOG_VIEW')
 *     é verdadeiro SOMENTE para SUPER_ADMIN e ADMIN.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 2.2-2.6, 6.6, 6.7, 12.6, 13.3
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asAnon,
  asService,
  asUser,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';
import { ensureUserRow, seedAdminRole, cleanupUserRow } from '../../_helpers/adminSeed';
import type { AdminRole } from '../../../src/services/admin/permissions';

const HOOK_TIMEOUT = 30_000;
const TAG = `itest-rls117-${Date.now()}`;
const DEDUP = `WHATSAPP_DISCONNECTED:whatsapp_session:${TAG}`;

const ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'];
const NEW_ACTIONS = ['ALERT_VIEW', 'ALERT_ACK', 'ALERT_RESOLVE', 'LOG_VIEW'] as const;

describeIntegration('Integração 117 — RLS de system_alerts + RBAC', () => {
  const roleUsers: Partial<Record<AdminRole, SeededUser>> = {};
  let client: SeededUser;
  let alertId = '';

  beforeAll(async () => {
    const svc = asService();
    for (const role of ROLES) {
      const u = await seedUser({ tag: `op-rls-${role.toLowerCase()}`, userType: 'embarcador' });
      await ensureUserRow(svc, { id: u.id, userType: 'embarcador' });
      await seedAdminRole(svc, u.id, role);
      roleUsers[role] = u;
    }
    client = await seedUser({ tag: 'op-rls-client', userType: 'motorista' });
    await ensureUserRow(svc, { id: client.id, userType: 'motorista' });

    const ins = await svc
      .from('system_alerts')
      .insert({
        alert_type: 'WHATSAPP_DISCONNECTED',
        severity: 'CRITICAL',
        source_type: 'whatsapp_session',
        source_id: TAG,
        dedup_key: DEDUP,
        title: 'WhatsApp desconectado',
      })
      .select('id')
      .single();
    if (ins.error) throw new Error(`seed alerta falhou: ${ins.error.message}`);
    alertId = (ins.data as { id: string }).id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    if (alertId) await svc.from('system_alerts').delete().eq('id', alertId);
    for (const role of ROLES) {
      const u = roleUsers[role];
      if (u) {
        await cleanupUserRow(svc, u.id);
        await cleanupUser(u.id);
      }
    }
    if (client) {
      await cleanupUserRow(svc, client.id);
      await cleanupUser(client.id);
    }
  }, HOOK_TIMEOUT);

  it('service_role enxerga o alerta semeado (vazios depois são significativos)', async () => {
    const { data } = await asService().from('system_alerts').select('id').eq('id', alertId);
    expect((data ?? []).length).toBe(1);
  });

  it('anônimo não lê system_alerts', async () => {
    const { data } = await asAnon().from('system_alerts').select('id').eq('id', alertId);
    expect((data ?? []).length).toBe(0);
  });

  it('Cliente comum não lê system_alerts', async () => {
    const { data } = await asUser(client.accessToken)
      .from('system_alerts')
      .select('id')
      .eq('id', alertId);
    expect((data ?? []).length).toBe(0);
  });

  it('admin SEM ALERT_VIEW (SUPORTE/FINANCEIRO/MODERADOR) não lê', async () => {
    for (const role of ['SUPORTE', 'FINANCEIRO', 'MODERADOR'] as AdminRole[]) {
      const u = roleUsers[role]!;
      const { data } = await asUser(u.accessToken)
        .from('system_alerts')
        .select('id')
        .eq('id', alertId);
      expect((data ?? []).length, role).toBe(0);
    }
  });

  it('admin COM ALERT_VIEW (ADMIN) lê o alerta', async () => {
    const { data } = await asUser(roleUsers.ADMIN!.accessToken)
      .from('system_alerts')
      .select('id, title')
      .eq('id', alertId);
    expect((data ?? []).length).toBe(1);
  });

  it('nenhum role escreve direto em system_alerts (no_dml: escrita só via RPC)', async () => {
    const adminTok = roleUsers.ADMIN!.accessToken;
    const insErr = await asUser(adminTok).from('system_alerts').insert({
      alert_type: 'CAMPAIGN_PAUSED',
      severity: 'WARNING',
      source_type: 'dispatch_job',
      source_id: `${TAG}-direct`,
      dedup_key: `CAMPAIGN_PAUSED:dispatch_job:${TAG}-direct`,
      title: 'tentativa direta',
    });
    expect(insErr.error).not.toBeNull();

    const updErr = await asUser(adminTok)
      .from('system_alerts')
      .update({ title: 'hack' })
      .eq('id', alertId);
    expect(updErr.error).not.toBeNull();

    const delErr = await asUser(adminTok).from('system_alerts').delete().eq('id', alertId);
    expect(delErr.error).not.toBeNull();
  });

  it('is_admin_with_permission das 4 ações novas: verdadeiro só para SUPER_ADMIN e ADMIN', async () => {
    for (const role of ROLES) {
      const u = roleUsers[role]!;
      const expected = role === 'SUPER_ADMIN' || role === 'ADMIN';
      for (const action of NEW_ACTIONS) {
        const { data, error } = await asUser(u.accessToken).rpc('is_admin_with_permission', {
          p_action: action,
        });
        expect(error, `${role}/${action}`).toBeNull();
        expect(Boolean(data), `${role}/${action}`).toBe(expected);
      }
    }
  });
});
