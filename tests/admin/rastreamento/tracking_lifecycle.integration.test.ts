/**
 * Integração — ciclo de vida do Rastreamento (migration 124).
 *
 * Cobre o comportamento server-side ponta a ponta:
 *   - ingestão anônima WRITE-ONLY: evento válido persiste (visitor_id); evento
 *     fora do domínio é rejeitado SEM persistir (INVALID_EVENT_TYPE), e a porta
 *     anônima nunca devolve jornada (anti-enumeração);
 *   - mark_contacted idempotente: 2ª marca ⇒ _SKIPPED ALREADY_CONTACTED, com
 *     TRACKING_CONTACT_MARK_SKIPPED PERSISTIDO em admin_audit_logs;
 *   - Master imutável: mark_contacted no Master_Admin ⇒ permission_denied;
 *   - trigger_recovery em cooldown ⇒ SUPPRESS WITHIN_COOLDOWN (+ RECOVERY_TRIGGER_SKIPPED
 *     persistido); estado limpo ⇒ DISPATCH;
 *   - publish_alert ⇒ ABANDONMENT_SPIKE persistido em system_alerts (compõe 117).
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 3.3, 3.5, 3.6, 7.9, 9.5, 9.10, 14.1, 15.3, 15.7, 15.8
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
const TAG = `itest-rastr-life-${Date.now()}`;

function deniedCode(res: { error: { code?: string; message?: string } | null }): string {
  return `${res.error?.code ?? ''}${res.error?.message ?? ''}`;
}

describeIntegration('Integração 124 — ciclo de vida do Rastreamento', () => {
  let admin: SeededUser;
  let target: SeededUser;
  let master: SeededUser;
  const alertKeys: string[] = [];

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'rastr-life-admin', userType: 'embarcador' });
    target = await seedUser({ tag: 'rastr-life-target', userType: 'motorista' });
    master = await seedUser({ tag: 'rastr-life-master', userType: 'embarcador' });
    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    await ensureUserRow(svc, { id: target.id, userType: 'motorista' });
    await ensureUserRow(svc, { id: master.id, userType: 'embarcador', adminUsername: 'Nexus_Vortex99' });
    await seedAdminRole(svc, admin.id, 'ADMIN');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    await svc.from('journey_events').delete().like('visitor_id', `${TAG}%`);
    for (const u of [admin, target, master]) {
      if (u) {
        await svc.from('recovery_attempts').delete().eq('user_id', u.id);
        await svc.from('journey_events').delete().eq('user_id', u.id);
        await cleanupUserRow(svc, u.id);
        await cleanupUser(u.id);
      }
    }
    for (const k of alertKeys) await svc.from('system_alerts').delete().eq('dedup_key', k);
  }, HOOK_TIMEOUT);

  it('ingestão anônima: evento válido persiste, inválido é rejeitado sem persistir', async () => {
    const visitor = `${TAG}-v1`;
    const anon = asAnon();
    const res = await anon.rpc('rpc_tracking_ingest_event', {
      p_events: [
        { event_type: 'SITE_VISIT', surface: 'SITE', visitor_id: visitor },
        { event_type: 'NOT_A_TYPE', surface: 'SITE', visitor_id: visitor },
      ],
    });
    expect(res.error).toBeNull();
    const counts = res.data as { inserted: number; rejected: number };
    expect(counts.inserted).toBe(1);
    expect(counts.rejected).toBe(1);

    // Apenas o evento válido persistiu (o inválido NÃO).
    const { data } = await asService().from('journey_events').select('event_type').eq('visitor_id', visitor);
    const types = (data ?? []).map((r) => (r as { event_type: string }).event_type);
    expect(types).toEqual(['SITE_VISIT']);

    // Anti-enumeração: a porta anônima não devolve jornada/existência.
    expect(counts).not.toHaveProperty('items');
    // E anon não lê journey_events direto (RLS).
    expect(((await anon.from('journey_events').select('id').limit(5)).data ?? []).length).toBe(0);
  });

  it('mark_contacted idempotente ⇒ _SKIPPED ALREADY_CONTACTED + audit persistido', async () => {
    const a = asUser(admin.accessToken);
    const svc = asService();

    // 1ª marca: não há tentativa ⇒ cria CONTACTED.
    const first = await a.rpc('rpc_tracking_mark_contacted', {
      p_user_id: target.id,
      p_expected_updated_at: new Date().toISOString(),
    });
    expect(first.error).toBeNull();

    // 2ª marca: já CONTACTED ⇒ _SKIPPED ALREADY_CONTACTED.
    const second = await a.rpc('rpc_tracking_mark_contacted', {
      p_user_id: target.id,
      p_expected_updated_at: new Date().toISOString(),
    });
    expect(second.error).toBeNull();
    expect(second.data as { skipped?: boolean; reason?: string }).toMatchObject({
      skipped: true,
      reason: 'ALREADY_CONTACTED',
    });

    // O log SKIPPED é PERSISTIDO (retorno normal, sem RAISE).
    const { data } = await svc
      .from('admin_audit_logs')
      .select('action')
      .eq('action', 'TRACKING_CONTACT_MARK_SKIPPED')
      .eq('target_id', target.id)
      .limit(1);
    expect((data ?? []).length).toBe(1);
  });

  it('Master imutável: mark_contacted no Master_Admin ⇒ permission_denied', async () => {
    const res = await asUser(admin.accessToken).rpc('rpc_tracking_mark_contacted', {
      p_user_id: master.id,
      p_expected_updated_at: new Date().toISOString(),
    });
    expect(deniedCode(res)).toContain('42501');
  });

  it('trigger_recovery: estado limpo ⇒ DISPATCH; com disparo recente ⇒ SUPPRESS WITHIN_COOLDOWN', async () => {
    const a = asUser(admin.accessToken);
    const svc = asService();

    // Usuário novo, sem tentativas ⇒ DISPATCH.
    const fresh = await seedUser({ tag: 'rastr-life-fresh', userType: 'motorista' });
    await ensureUserRow(svc, { id: fresh.id, userType: 'motorista' });
    try {
      const dispatch = await a.rpc('rpc_tracking_trigger_recovery', {
        p_user_id: fresh.id,
        p_trigger: { kind: 'RISK' },
      });
      expect(dispatch.error).toBeNull();
      expect((dispatch.data as { decision?: string }).decision).toBe('DISPATCH');

      // Simula um disparo recente (inativo, dentro do cooldown de 72h).
      await svc.from('recovery_attempts').insert({
        user_id: fresh.id,
        recovery_scenario: 'USER_INACTIVE',
        active: false,
        contact_status: 'CONTACTED',
      });

      const suppressed = await a.rpc('rpc_tracking_trigger_recovery', {
        p_user_id: fresh.id,
        p_trigger: { kind: 'RISK' },
      });
      expect(suppressed.error).toBeNull();
      expect(suppressed.data as { skipped?: boolean; reason?: string }).toMatchObject({
        skipped: true,
        reason: 'WITHIN_COOLDOWN',
      });

      // RECOVERY_TRIGGER_SKIPPED persistido.
      const { data } = await svc
        .from('admin_audit_logs')
        .select('action')
        .eq('action', 'RECOVERY_TRIGGER_SKIPPED')
        .eq('target_id', fresh.id)
        .limit(1);
      expect((data ?? []).length).toBe(1);
    } finally {
      await svc.from('recovery_attempts').delete().eq('user_id', fresh.id);
      await cleanupUserRow(svc, fresh.id);
      await cleanupUser(fresh.id);
    }
  });

  it('publish_alert ⇒ ABANDONMENT_SPIKE persistido em system_alerts (compõe 117)', async () => {
    const dedup = `${TAG}-spike`;
    alertKeys.push(`ABANDONMENT_SPIKE:tracking:${dedup}`);
    const res = await asUser(admin.accessToken).rpc('rpc_tracking_publish_alert', {
      p_dedup_key: dedup,
      p_detail: { stage: 'SIGNUP_COMPLETED' },
    });
    expect(res.error).toBeNull();

    const { data } = await asService()
      .from('system_alerts')
      .select('alert_type, source_id')
      .eq('alert_type', 'ABANDONMENT_SPIKE')
      .eq('source_id', dedup)
      .limit(1);
    expect((data ?? []).length).toBe(1);
  });
});
