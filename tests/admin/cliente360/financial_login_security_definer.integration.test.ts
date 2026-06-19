/**
 * Integração — leituras financeiras/login sob SECURITY DEFINER (migration 116).
 *
 * Prova que admin_user_financial_history (FINANCEIRO_VIEW) e
 * admin_user_login_history (USER_VIEW) leem dados de tabelas com RLS estrita
 * (subscriptions select-own; login_attempts USING(false)) SEM afrouxar essa RLS
 * para os demais roles, e que um Cliente nunca obtém dados de outro:
 *   - admin lê o financeiro/login do Cliente alvo;
 *   - Cliente comum chamando as RPCs => permission_denied (gating);
 *   - Cliente comum lendo subscriptions/login_attempts de outro direto => 0/err;
 *   - isolamento: financeiro do Cliente A nunca traz dados do Cliente B.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 9.5, 12.4, 15.5, 16.8
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asService,
  asUser,
  describeIntegration,
  cleanupUser,
  seedUser,
  type SeededUser,
} from '../../_helpers/supabaseHarness';
import { ensureUserRow, seedAdminRole, cleanupUserRow } from '../../_helpers/adminSeed';

const HOOK_TIMEOUT = 30_000;

describeIntegration('Integração 116 — financeiro/login SECURITY DEFINER', () => {
  let admin: SeededUser;
  let clientA: SeededUser;
  let clientB: SeededUser;
  let subAId: string | null = null;
  let subBId: string | null = null;
  let phoneA = '';

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'c360-fin-admin', userType: 'embarcador' });
    clientA = await seedUser({ tag: 'c360-fin-clienteA', userType: 'motorista' });
    clientB = await seedUser({ tag: 'c360-fin-clienteB', userType: 'motorista' });

    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    const rowA = await ensureUserRow(svc, { id: clientA.id, userType: 'motorista' });
    await ensureUserRow(svc, { id: clientB.id, userType: 'motorista' });
    phoneA = rowA.phone;

    await seedAdminRole(svc, admin.id, 'ADMIN'); // ADMIN => FINANCEIRO_VIEW + USER_VIEW

    // Assinatura do Cliente A e B (valores distintos para checar isolamento).
    const insA = await svc
      .from('subscriptions')
      .insert({ user_id: clientA.id, plan: 'mensal', payment_method: 'pix', status: 'active' })
      .select('id')
      .maybeSingle();
    subAId = (insA.data as { id?: string } | null)?.id ?? null;
    const insB = await svc
      .from('subscriptions')
      .insert({ user_id: clientB.id, plan: 'trimestral', payment_method: 'pix', status: 'active' })
      .select('id')
      .maybeSingle();
    subBId = (insB.data as { id?: string } | null)?.id ?? null;

    // Tentativa de login do Cliente A (correlação por telefone).
    await svc.from('login_attempts').insert({ phone: phoneA, success: true, ip_address: '10.0.0.1' });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    if (subAId) await svc.from('subscriptions').delete().eq('id', subAId);
    if (subBId) await svc.from('subscriptions').delete().eq('id', subBId);
    if (phoneA) await svc.from('login_attempts').delete().eq('phone', phoneA);
    for (const u of [admin, clientA, clientB]) {
      if (u) {
        await cleanupUserRow(svc, u.id);
        await cleanupUser(u.id);
      }
    }
  }, HOOK_TIMEOUT);

  it('admin lê o financeiro do Cliente A (plano mensal) e só o dele', async () => {
    const { data, error } = await asUser(admin.accessToken).rpc('admin_user_financial_history', {
      p_user_id: clientA.id,
      p_limit: 50,
    });
    expect(error).toBeNull();
    const res = data as { plan?: { plan?: string } | null } | null;
    expect(res?.plan?.plan).toBe('mensal'); // do Cliente A, não 'trimestral' (B)
  });

  it('admin lê o histórico de login do Cliente A (correlação por telefone)', async () => {
    const { data, error } = await asUser(admin.accessToken).rpc('admin_user_login_history', {
      p_user_id: clientA.id,
      p_limit: 50,
    });
    expect(error).toBeNull();
    const res = data as { has_phone?: boolean; attempts?: unknown[] } | null;
    expect(res?.has_phone).toBe(true);
    expect((res?.attempts ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('Cliente comum chamando as RPCs => permission_denied', async () => {
    const fin = await asUser(clientA.accessToken).rpc('admin_user_financial_history', {
      p_user_id: clientB.id,
      p_limit: 50,
    });
    expect(`${fin.error?.code ?? ''}${fin.error?.message ?? ''}`).toContain('42501');

    const log = await asUser(clientA.accessToken).rpc('admin_user_login_history', {
      p_user_id: clientB.id,
      p_limit: 50,
    });
    expect(`${log.error?.code ?? ''}${log.error?.message ?? ''}`).toContain('42501');
  });

  it('RLS de subscriptions/login_attempts NÃO foi afrouxada para o Cliente comum', async () => {
    // Cliente A não lê a assinatura do Cliente B (select-own).
    const { data: subs } = await asUser(clientA.accessToken)
      .from('subscriptions')
      .select('id')
      .eq('user_id', clientB.id);
    expect((subs ?? []).length).toBe(0);

    // login_attempts é service-role only (USING false) — zero linhas via user.
    const { data: la } = await asUser(clientA.accessToken)
      .from('login_attempts')
      .select('id')
      .eq('phone', phoneA);
    expect((la ?? []).length).toBe(0);
  });
});
