/**
 * Integração — ciclo de vida de alertas (migration 117): geração/dedup/auto-
 * resolução via admin_alerts_evaluate + ack/resolve com versionamento e
 * idempotência, com audits de SUCESSO persistidos.
 *
 * Prova (audits de caminho de sucesso PERSISTEM — não há RAISE):
 *   - evaluate abre 1 alerta SUBSCRIPTION_EXPIRING (ALERT_GENERATED persistido);
 *     reexecutar NÃO cria 2º ativo (dedup pelo índice único parcial); quando a
 *     situação some, o alerta é auto-resolvido (resolved_by NULL);
 *   - ack OPEN→ACKNOWLEDGED e resolve →RESOLVED; ack/resolve repetidos retornam
 *     _SKIPPED e gravam ALERT_ACK_SKIPPED/ALERT_RESOLVE_SKIPPED (persistidos);
 *   - audit positivo ALERT_ACK persiste (mesma chamada log_admin_action que a
 *     camada TS faz após o ack real);
 *   - expected_updated_at divergente ⇒ STALE_VERSION; ack de RESOLVED ⇒
 *     INVALID_STATE_TRANSITION;
 *   - ack/resolve NÃO tocam `users` (Master_Admin imutável por construção).
 *
 * Reusa expectAuditPersisted (helper canônico, Req 15.5).
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 7.2, 7.3, 7.4, 7.5, 9.3-9.8, 13.6, 14.3
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
import {
  expectAuditPersisted,
  type AuditLogRowLike,
} from '../../../src/__tests__/_helpers/auditAssertions';

const HOOK_TIMEOUT = 30_000;

describeIntegration('Integração 117 — ciclo de vida de alertas', () => {
  let admin: SeededUser;
  let clientSub: SeededUser;
  let subId: string | null = null;
  const seededAlertIds: string[] = [];

  /** Fetcher de audit por action+target_id (helper canônico expectAuditPersisted). */
  function logs(action: string, targetId: string) {
    return async (): Promise<AuditLogRowLike[]> => {
      const { data } = await asService()
        .from('admin_audit_logs')
        .select('action, target_type, target_id, before_data, after_data')
        .eq('action', action)
        .eq('target_id', targetId)
        .limit(20);
      return (data ?? []) as AuditLogRowLike[];
    };
  }

  async function seedOpenAlert(suffix: string): Promise<{ id: string; updated_at: string }> {
    const key = `CAMPAIGN_PAUSED:dispatch_job:itest-life-${suffix}-${Date.now()}`;
    const { data, error } = await asService()
      .from('system_alerts')
      .insert({
        alert_type: 'CAMPAIGN_PAUSED',
        severity: 'WARNING',
        source_type: 'dispatch_job',
        source_id: `itest-life-${suffix}`,
        dedup_key: key,
        title: 'Campanha pausada',
      })
      .select('id, updated_at')
      .single();
    if (error) throw new Error(`seed alerta falhou: ${error.message}`);
    const row = data as { id: string; updated_at: string };
    seededAlertIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'op-life-admin', userType: 'embarcador' });
    clientSub = await seedUser({ tag: 'op-life-sub', userType: 'motorista' });
    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    await ensureUserRow(svc, { id: clientSub.id, userType: 'motorista' });
    await seedAdminRole(svc, admin.id, 'ADMIN');

    // Assinatura ativa vencendo em 1 dia (dentro da janela default de 3).
    const nextCharge = new Date(Date.now() + 86_400_000).toISOString();
    const ins = await svc
      .from('subscriptions')
      .insert({
        user_id: clientSub.id,
        plan: 'mensal',
        payment_method: 'pix',
        status: 'active',
        next_charge_at: nextCharge,
      })
      .select('id')
      .maybeSingle();
    subId = (ins.data as { id?: string } | null)?.id ?? null;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    if (clientSub) await svc.from('system_alerts').delete().eq('source_id', clientSub.id);
    for (const id of seededAlertIds) await svc.from('system_alerts').delete().eq('id', id);
    if (subId) await svc.from('subscriptions').delete().eq('id', subId);
    for (const u of [admin, clientSub]) {
      if (u) {
        await cleanupUserRow(svc, u.id);
        await cleanupUser(u.id);
      }
    }
  }, HOOK_TIMEOUT);

  it('evaluate abre 1 alerta (ALERT_GENERATED), deduplica e auto-resolve', async () => {
    const svc = asService();
    const adminClient = asUser(admin.accessToken);
    const dedup = `SUBSCRIPTION_EXPIRING:subscription:${clientSub.id}`;

    // 1ª avaliação: abre o alerta.
    const ev1 = await adminClient.rpc('admin_alerts_evaluate', {
      p_expiring_window_days: 3,
      p_awaiting_threshold_min: 30,
    });
    expect(ev1.error).toBeNull();

    const open1 = await svc.from('system_alerts').select('id, state').eq('dedup_key', dedup);
    expect((open1.data ?? []).length).toBe(1);
    const alertId = (open1.data as { id: string }[])[0].id;
    seededAlertIds.push(alertId);
    expect((open1.data as { state: string }[])[0].state).toBe('OPEN');

    // ALERT_GENERATED persistido (caminho de sucesso, sem RAISE).
    await expectAuditPersisted(logs('ALERT_GENERATED', clientSub.id), {
      action: 'ALERT_GENERATED',
      targetType: 'system_alerts',
      targetId: clientSub.id,
    });

    // 2ª avaliação: NÃO cria 2º ativo (dedup). Continua exatamente 1 ativo.
    const ev2 = await adminClient.rpc('admin_alerts_evaluate', {
      p_expiring_window_days: 3,
      p_awaiting_threshold_min: 30,
    });
    expect(ev2.error).toBeNull();
    const active = await svc
      .from('system_alerts')
      .select('id')
      .eq('dedup_key', dedup)
      .in('state', ['OPEN', 'ACKNOWLEDGED']);
    expect((active.data ?? []).length).toBe(1);

    // Some a situação (cancela a assinatura) ⇒ 3ª avaliação auto-resolve.
    if (subId) await svc.from('subscriptions').update({ status: 'canceled' }).eq('id', subId);
    const ev3 = await adminClient.rpc('admin_alerts_evaluate', {
      p_expiring_window_days: 3,
      p_awaiting_threshold_min: 30,
    });
    expect(ev3.error).toBeNull();
    const resolved = await svc
      .from('system_alerts')
      .select('state, resolved_by')
      .eq('id', alertId)
      .single();
    expect((resolved.data as { state: string }).state).toBe('RESOLVED');
    expect((resolved.data as { resolved_by: string | null }).resolved_by).toBeNull(); // auto
  });

  it('ack/resolve: transições + ALERT_ACK positivo + _SKIPPED persistidos', async () => {
    const svc = asService();
    const adminClient = asUser(admin.accessToken);
    const alert = await seedOpenAlert('ackflow');

    // ack OPEN -> ACKNOWLEDGED
    const ack = await adminClient.rpc('admin_alert_acknowledge', {
      p_id: alert.id,
      p_expected_updated_at: alert.updated_at,
    });
    expect(ack.error).toBeNull();
    const ackRes = ack.data as { ok?: boolean; updated_at?: string };
    expect(ackRes.ok).toBe(true);
    const afterAckState = await svc.from('system_alerts').select('state').eq('id', alert.id).single();
    expect((afterAckState.data as { state: string }).state).toBe('ACKNOWLEDGED');

    // audit positivo ALERT_ACK: a camada TS chama log_admin_action após o ack real.
    await adminClient.rpc('log_admin_action', {
      p_action: 'ALERT_ACK',
      p_target_type: 'system_alerts',
      p_target_id: alert.id,
      p_before: { state: 'OPEN' },
      p_after: { state: 'ACKNOWLEDGED' },
      p_ip: null,
      p_user_agent: null,
    });
    await expectAuditPersisted(logs('ALERT_ACK', alert.id), {
      action: 'ALERT_ACK',
      targetType: 'system_alerts',
      targetId: alert.id,
    });

    // ack de novo (já ACKNOWLEDGED) => _SKIPPED + ALERT_ACK_SKIPPED persistido.
    const ackAgain = await adminClient.rpc('admin_alert_acknowledge', {
      p_id: alert.id,
      p_expected_updated_at: ackRes.updated_at ?? alert.updated_at,
    });
    expect((ackAgain.data as { skipped?: boolean }).skipped).toBe(true);
    expect((ackAgain.data as { reason?: string }).reason).toBe('ALREADY_ACKNOWLEDGED');
    await expectAuditPersisted(logs('ALERT_ACK_SKIPPED', alert.id), {
      action: 'ALERT_ACK_SKIPPED',
      targetType: 'system_alerts',
      targetId: alert.id,
    });

    // resolve ACKNOWLEDGED -> RESOLVED
    const resolve = await adminClient.rpc('admin_alert_resolve', {
      p_id: alert.id,
      p_expected_updated_at: ackRes.updated_at ?? alert.updated_at,
    });
    expect(resolve.error).toBeNull();
    expect((resolve.data as { ok?: boolean }).ok).toBe(true);

    // resolve de novo (já RESOLVED) => _SKIPPED + ALERT_RESOLVE_SKIPPED persistido.
    const resolveAgain = await adminClient.rpc('admin_alert_resolve', {
      p_id: alert.id,
      p_expected_updated_at: new Date().toISOString(),
    });
    expect((resolveAgain.data as { skipped?: boolean }).skipped).toBe(true);
    expect((resolveAgain.data as { reason?: string }).reason).toBe('ALREADY_RESOLVED');
    await expectAuditPersisted(logs('ALERT_RESOLVE_SKIPPED', alert.id), {
      action: 'ALERT_RESOLVE_SKIPPED',
      targetType: 'system_alerts',
      targetId: alert.id,
    });
  });

  it('STALE_VERSION (expected_updated_at divergente) e INVALID_STATE_TRANSITION (ack de RESOLVED)', async () => {
    const adminClient = asUser(admin.accessToken);

    // STALE: alerta OPEN, ack com timestamp errado.
    const staleAlert = await seedOpenAlert('stale');
    const stale = await adminClient.rpc('admin_alert_acknowledge', {
      p_id: staleAlert.id,
      p_expected_updated_at: '2000-01-01T00:00:00Z',
    });
    expect(`${stale.error?.message ?? ''}`).toContain('STALE_VERSION');

    // INVALID: resolve o alerta e tente reconhecê-lo (RESOLVED é terminal).
    const termAlert = await seedOpenAlert('invalid');
    await asService().from('system_alerts').update({ state: 'RESOLVED' }).eq('id', termAlert.id);
    const invalid = await adminClient.rpc('admin_alert_acknowledge', {
      p_id: termAlert.id,
      p_expected_updated_at: termAlert.updated_at,
    });
    expect(`${invalid.error?.message ?? ''}`).toContain('INVALID_STATE_TRANSITION');
  });

  it('ack NÃO toca a tabela users (Master_Admin imutável por construção)', async () => {
    const svc = asService();
    const adminClient = asUser(admin.accessToken);

    const before = await svc.from('users').select('updated_at').eq('id', admin.id).single();
    const beforeAt = (before.data as { updated_at: string }).updated_at;

    const alert = await seedOpenAlert('notouch');
    await adminClient.rpc('admin_alert_acknowledge', {
      p_id: alert.id,
      p_expected_updated_at: alert.updated_at,
    });

    const after = await svc.from('users').select('updated_at').eq('id', admin.id).single();
    const afterAt = (after.data as { updated_at: string }).updated_at;
    expect(afterAt).toBe(beforeAt); // ack/resolve não mutam users
  });
});
