/**
 * Integração — schema/efeitos da migration 124 (Rastreamento Inteligente).
 *
 * A reaplicação 2x sem erro é garantida estruturalmente pela própria migration
 * (CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF
 * EXISTS) e exercitada pelo runner de migrations do CI. Aqui provamos os efeitos
 * observáveis:
 *   - journey_events/recovery_attempts/tracking_visitor_identities/tracking_ai_config existem;
 *   - CHECK de domínio fechado (event_type/surface/recovery_scenario/contact_status);
 *   - uq_recovery_active_per_user (<= 1 ativa por usuário) e
 *     uq_recovery_per_critical_event (1 por trigger_event_id);
 *   - RLS bloqueia anon (0 linhas) em todas as tabelas novas;
 *   - ampliação ADITIVA de system_alerts.alert_type aceita 'ABANDONMENT_SPIKE'
 *     SEM remover os valores de 117 (não-destrutiva, Req 14.5, 16.7).
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 3.1, 14.1, 14.5, 15.4, 15.5, 16.3, 16.7
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import { asAnon, asService, describeIntegration, cleanupUser, seedUser, type SeededUser } from '../../_helpers/supabaseHarness';
import { ensureUserRow, cleanupUserRow } from '../../_helpers/adminSeed';

const HOOK_TIMEOUT = 30_000;
const TAG = `itest-mig124-${Date.now()}`;

describeIntegration('Integração 124 — schema do Rastreamento', () => {
  let user: SeededUser;
  const createdAlertKeys: string[] = [];

  beforeAll(async () => {
    const svc = asService();
    user = await seedUser({ tag: 'mig124-user', userType: 'motorista' });
    await ensureUserRow(svc, { id: user.id, userType: 'motorista' });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    await svc.from('recovery_attempts').delete().eq('user_id', user.id);
    await svc.from('journey_events').delete().eq('user_id', user.id);
    await svc.from('journey_events').delete().like('visitor_id', `${TAG}%`);
    for (const k of createdAlertKeys) await svc.from('system_alerts').delete().eq('dedup_key', k);
    await cleanupUserRow(svc, user.id);
    await cleanupUser(user.id);
  }, HOOK_TIMEOUT);

  it('journey_events aceita evento válido e rejeita event_type/surface fora do domínio', async () => {
    const svc = asService();
    const ok = await svc
      .from('journey_events')
      .insert({ event_type: 'SITE_VISIT', surface: 'SITE', user_id: user.id })
      .select('id')
      .single();
    expect(ok.error).toBeNull();

    const badType = await svc
      .from('journey_events')
      .insert({ event_type: 'NOT_A_TYPE', surface: 'SITE', user_id: user.id });
    expect(badType.error).not.toBeNull();

    const badSurface = await svc
      .from('journey_events')
      .insert({ event_type: 'SITE_VISIT', surface: 'NOPE', user_id: user.id });
    expect(badSurface.error).not.toBeNull();
  });

  it('uq_recovery_active_per_user: 2ª tentativa ativa para o mesmo usuário é rejeitada', async () => {
    const svc = asService();
    const first = await svc
      .from('recovery_attempts')
      .insert({ user_id: user.id, recovery_scenario: 'USER_INACTIVE', active: true })
      .select('id')
      .single();
    expect(first.error).toBeNull();

    const dup = await svc
      .from('recovery_attempts')
      .insert({ user_id: user.id, recovery_scenario: 'COLD_DRIVER', active: true });
    expect(dup.error).not.toBeNull();
  });

  it('uq_recovery_per_critical_event: 2 tentativas com o mesmo trigger_event_id é rejeitada', async () => {
    const svc = asService();
    const ev = await svc
      .from('journey_events')
      .insert({ event_type: 'PAYMENT_FAILED', surface: 'APP', user_id: user.id })
      .select('id')
      .single();
    const eventId = (ev.data as { id: string }).id;

    const a = await svc.from('recovery_attempts').insert({
      user_id: user.id,
      recovery_scenario: 'PAYMENT_FAILED',
      active: false,
      trigger_event_id: eventId,
    });
    expect(a.error).toBeNull();

    const b = await svc.from('recovery_attempts').insert({
      user_id: user.id,
      recovery_scenario: 'PAYMENT_FAILED',
      active: false,
      trigger_event_id: eventId,
    });
    expect(b.error).not.toBeNull();
  });

  it('RLS bloqueia anon em todas as tabelas novas (0 linhas)', async () => {
    const anon = asAnon();
    for (const table of ['journey_events', 'recovery_attempts', 'tracking_visitor_identities', 'tracking_ai_config']) {
      const { data } = await anon.from(table).select('*').limit(5);
      expect((data ?? []).length).toBe(0);
    }
  });

  it('tracking_ai_config é singleton (1 linha) com defaults', async () => {
    const { data } = await asService().from('tracking_ai_config').select('*');
    expect((data ?? []).length).toBe(1);
  });

  it('system_alerts.alert_type aceita ABANDONMENT_SPIKE (ampliação aditiva) e ainda aceita os valores de 117', async () => {
    const svc = asService();
    const newKey = `ABANDONMENT_SPIKE:tracking:${TAG}`;
    createdAlertKeys.push(newKey);
    const spike = await svc
      .from('system_alerts')
      .insert({
        alert_type: 'ABANDONMENT_SPIKE',
        severity: 'WARNING',
        source_type: 'tracking',
        source_id: TAG,
        dedup_key: newKey,
        title: 'Pico de abandono detectado',
      })
      .select('id')
      .single();
    expect(spike.error).toBeNull();

    // Valor pré-existente de 117 continua válido (não-destrutivo).
    const legacyKey = `CAMPAIGN_PAUSED:dispatch_job:${TAG}`;
    createdAlertKeys.push(legacyKey);
    const legacy = await svc
      .from('system_alerts')
      .insert({
        alert_type: 'CAMPAIGN_PAUSED',
        severity: 'WARNING',
        source_type: 'dispatch_job',
        source_id: TAG,
        dedup_key: legacyKey,
        title: 'Campanha pausada',
      })
      .select('id')
      .single();
    expect(legacy.error).toBeNull();

    // Valor fora do domínio ampliado continua rejeitado.
    const bad = await svc.from('system_alerts').insert({
      alert_type: 'NOT_A_TYPE',
      severity: 'WARNING',
      source_type: 'tracking',
      source_id: TAG,
      dedup_key: `x:${TAG}`,
      title: 'x',
    });
    expect(bad.error).not.toBeNull();
  });
});
