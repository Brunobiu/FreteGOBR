/**
 * Integração — RLS de supervisor_diagnostics/insights + paridade RBAC das ações
 * novas (migration 118).
 *
 * Semeia um Supervisor_Diagnostic e um Supervisor_Insight via service_role
 * (contorna RLS) e prova que:
 *   - anon, um Cliente comum e admin SEM SUPERVISOR_VIEW (SUPORTE/FINANCEIRO/
 *     MODERADOR) recebem ZERO linhas, embora os registros existam;
 *   - admin COM SUPERVISOR_VIEW (ADMIN) lê os registros;
 *   - nenhum role escreve direto nas tabelas (política no_dml USING/CHECK false);
 *   - is_admin_with_permission('SUPERVISOR_VIEW'/'SUPERVISOR_MANAGE') é verdadeiro
 *     SOMENTE para SUPER_ADMIN e ADMIN (por construção — sem ramo dedicado).
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 11.x, 12.x, CP6 (admin-ia-supervisora)
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
const TAG = `itest-rls118-${Date.now()}`;
const DIAG_DEDUP = `integration:rls_probe:${TAG}`;
const INSIGHT_DEDUP = `SUGGESTION:rls:${TAG}`;

const ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'];
const NEW_ACTIONS = ['SUPERVISOR_VIEW', 'SUPERVISOR_MANAGE'] as const;

describeIntegration('Integração 118 — RLS de supervisor_* + RBAC', () => {
  const roleUsers: Partial<Record<AdminRole, SeededUser>> = {};
  let client: SeededUser;
  let diagId = '';
  let insightId = '';

  beforeAll(async () => {
    const svc = asService();
    for (const role of ROLES) {
      const u = await seedUser({ tag: `sup-rls-${role.toLowerCase()}`, userType: 'embarcador' });
      await ensureUserRow(svc, { id: u.id, userType: 'embarcador' });
      await seedAdminRole(svc, u.id, role);
      roleUsers[role] = u;
    }
    client = await seedUser({ tag: 'sup-rls-client', userType: 'motorista' });
    await ensureUserRow(svc, { id: client.id, userType: 'motorista' });

    const diag = await svc
      .from('supervisor_diagnostics')
      .insert({
        module: 'integration',
        operation: 'rls_probe',
        severity: 'WARNING',
        description: 'Diagnóstico RLS',
        dedup_key: DIAG_DEDUP,
      })
      .select('id')
      .single();
    if (diag.error) throw new Error(`seed diagnostic falhou: ${diag.error.message}`);
    diagId = (diag.data as { id: string }).id;

    const insight = await svc
      .from('supervisor_insights')
      .insert({
        insight_type: 'SUGGESTION',
        severity: 'WARNING',
        title: 'Insight RLS',
        dedup_key: INSIGHT_DEDUP,
      })
      .select('id')
      .single();
    if (insight.error) throw new Error(`seed insight falhou: ${insight.error.message}`);
    insightId = (insight.data as { id: string }).id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    if (diagId) await svc.from('supervisor_diagnostics').delete().eq('id', diagId);
    if (insightId) await svc.from('supervisor_insights').delete().eq('id', insightId);
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

  it('service_role enxerga os registros semeados (vazios depois são significativos)', async () => {
    const diag = await asService().from('supervisor_diagnostics').select('id').eq('id', diagId);
    expect((diag.data ?? []).length).toBe(1);
    const ins = await asService().from('supervisor_insights').select('id').eq('id', insightId);
    expect((ins.data ?? []).length).toBe(1);
  });

  it('anônimo não lê supervisor_diagnostics nem supervisor_insights', async () => {
    const diag = await asAnon().from('supervisor_diagnostics').select('id').eq('id', diagId);
    expect((diag.data ?? []).length).toBe(0);
    const ins = await asAnon().from('supervisor_insights').select('id').eq('id', insightId);
    expect((ins.data ?? []).length).toBe(0);
  });

  it('Cliente comum não lê supervisor_diagnostics nem supervisor_insights', async () => {
    const c = asUser(client.accessToken);
    const diag = await c.from('supervisor_diagnostics').select('id').eq('id', diagId);
    expect((diag.data ?? []).length).toBe(0);
    const ins = await c.from('supervisor_insights').select('id').eq('id', insightId);
    expect((ins.data ?? []).length).toBe(0);
  });

  it('admin SEM SUPERVISOR_VIEW (SUPORTE/FINANCEIRO/MODERADOR) não lê', async () => {
    for (const role of ['SUPORTE', 'FINANCEIRO', 'MODERADOR'] as AdminRole[]) {
      const u = roleUsers[role]!;
      const diag = await asUser(u.accessToken)
        .from('supervisor_diagnostics')
        .select('id')
        .eq('id', diagId);
      expect((diag.data ?? []).length, role).toBe(0);
      const ins = await asUser(u.accessToken)
        .from('supervisor_insights')
        .select('id')
        .eq('id', insightId);
      expect((ins.data ?? []).length, role).toBe(0);
    }
  });

  it('admin COM SUPERVISOR_VIEW (ADMIN) lê os dois registros', async () => {
    const adminTok = roleUsers.ADMIN!.accessToken;
    const diag = await asUser(adminTok)
      .from('supervisor_diagnostics')
      .select('id, module')
      .eq('id', diagId);
    expect((diag.data ?? []).length).toBe(1);
    const ins = await asUser(adminTok)
      .from('supervisor_insights')
      .select('id, title')
      .eq('id', insightId);
    expect((ins.data ?? []).length).toBe(1);
  });

  it('nenhum role escreve direto nas tabelas (no_dml: escrita só via RPC)', async () => {
    const adminTok = roleUsers.ADMIN!.accessToken;
    const a = asUser(adminTok);

    const insDiag = await a.from('supervisor_diagnostics').insert({
      module: 'integration',
      operation: 'hack',
      severity: 'WARNING',
      description: 'tentativa direta',
      dedup_key: `hack:${TAG}`,
    });
    expect(insDiag.error).not.toBeNull();

    const updDiag = await a
      .from('supervisor_diagnostics')
      .update({ description: 'hack' })
      .eq('id', diagId);
    expect(updDiag.error).not.toBeNull();

    const delDiag = await a.from('supervisor_diagnostics').delete().eq('id', diagId);
    expect(delDiag.error).not.toBeNull();

    const insIns = await a.from('supervisor_insights').insert({
      insight_type: 'SUGGESTION',
      severity: 'WARNING',
      title: 'tentativa direta',
      dedup_key: `hack-ins:${TAG}`,
    });
    expect(insIns.error).not.toBeNull();

    const updIns = await a.from('supervisor_insights').update({ title: 'hack' }).eq('id', insightId);
    expect(updIns.error).not.toBeNull();

    const delIns = await a.from('supervisor_insights').delete().eq('id', insightId);
    expect(delIns.error).not.toBeNull();
  });

  it('is_admin_with_permission das 2 ações novas: verdadeiro só para SUPER_ADMIN e ADMIN', async () => {
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
