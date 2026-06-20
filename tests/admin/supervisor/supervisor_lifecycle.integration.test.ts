/**
 * Integração — ciclo de vida da IA Supervisora (migration 118): registro rolling
 * idempotente + geração/dedup/auto-dismiss de anomalias via supervisor_evaluate +
 * ack/dismiss com versionamento e idempotência, com audits de SUCESSO persistidos
 * + resumo idempotente.
 *
 * Prova (audits de caminho de sucesso PERSISTEM — não há RAISE):
 *   - supervisor_record_diagnostic é idempotente por dedup_key (occurrence_count
 *     1 → 2 em duas chamadas);
 *   - evaluate abre 1 ANOMALY (SUPERVISOR_INSIGHT_GENERATED persistido com
 *     target_id = dedup_key da anomalia); reexecutar NÃO cria 2º ativo (dedup
 *     pelo índice único parcial); quando a recorrência some, a anomalia é
 *     auto-descartada (dismissed_by NULL);
 *   - evaluate só auto-descarta ANOMALY: um SUGGESTION semeado sobrevive;
 *   - ack OPEN→ACKNOWLEDGED + SUPERVISOR_INSIGHT_ACK positivo (mesma chamada
 *     log_admin_action que a camada TS faz após o ack real); ack repetido =>
 *     _SKIPPED + SUPERVISOR_INSIGHT_ACK_SKIPPED; dismiss →DISMISSED; dismiss
 *     repetido => _SKIPPED + SUPERVISOR_INSIGHT_DISMISS_SKIPPED;
 *   - expected_updated_at divergente ⇒ STALE_VERSION; ack de DISMISSED ⇒
 *     INVALID_STATE_TRANSITION;
 *   - generate_summary é idempotente por janela (2ª chamada => skipped);
 *   - ack NÃO toca `users` (Master_Admin imutável por construção).
 *
 * Reusa expectAuditPersisted (helper canônico, testing-governance).
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 3.x, 5.x, 8.x, 9.x, 13.x, 14.x (admin-ia-supervisora)
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
let seq = 0;
const uniqueKey = (prefix: string) => `itest-sup-${prefix}-${Date.now()}-${++seq}`;

describeIntegration('Integração 118 — ciclo de vida da IA Supervisora', () => {
  let admin: SeededUser;
  const seededDiagIds: string[] = [];
  const seededInsightIds: string[] = [];

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

  /** Semeia um insight OPEN via service (contorna RLS/no_dml). */
  async function seedOpenInsight(
    suffix: string,
    type: 'ANOMALY' | 'SUGGESTION' | 'SUMMARY' | 'SECURITY' = 'SUGGESTION'
  ): Promise<{ id: string; updated_at: string }> {
    const { data, error } = await asService()
      .from('supervisor_insights')
      .insert({
        insight_type: type,
        severity: 'WARNING',
        title: 'Insight de ciclo de vida',
        dedup_key: uniqueKey(suffix),
      })
      .select('id, updated_at')
      .single();
    if (error) throw new Error(`seed insight falhou: ${error.message}`);
    const row = data as { id: string; updated_at: string };
    seededInsightIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'sup-life-admin', userType: 'embarcador' });
    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    await seedAdminRole(svc, admin.id, 'ADMIN');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const svc = asService();
    for (const id of seededInsightIds) await svc.from('supervisor_insights').delete().eq('id', id);
    for (const id of seededDiagIds) await svc.from('supervisor_diagnostics').delete().eq('id', id);
    if (admin) {
      await cleanupUserRow(svc, admin.id);
      await cleanupUser(admin.id);
    }
  }, HOOK_TIMEOUT);

  it('record_diagnostic é idempotente por dedup_key (occurrence_count 1 → 2)', async () => {
    const adminClient = asUser(admin.accessToken);
    const key = uniqueKey('rec');

    const r1 = await adminClient.rpc('supervisor_record_diagnostic', {
      p_module: 'integration',
      p_operation: 'rolling',
      p_severity: 'WARNING',
      p_error_code: null,
      p_description: 'Erro recorrente de teste',
      p_probable_cause: null,
      p_suggested_fix: null,
      p_detail: {},
      p_dedup_key: key,
    });
    expect(r1.error).toBeNull();
    expect((r1.data as { occurrence_count: number }).occurrence_count).toBe(1);

    const r2 = await adminClient.rpc('supervisor_record_diagnostic', {
      p_module: 'integration',
      p_operation: 'rolling',
      p_severity: 'WARNING',
      p_error_code: null,
      p_description: 'Erro recorrente de teste',
      p_probable_cause: null,
      p_suggested_fix: null,
      p_detail: {},
      p_dedup_key: key,
    });
    expect(r2.error).toBeNull();
    expect((r2.data as { occurrence_count: number }).occurrence_count).toBe(2);

    // rastreia para cleanup
    const row = await asService()
      .from('supervisor_diagnostics')
      .select('id')
      .eq('dedup_key', key)
      .single();
    seededDiagIds.push((row.data as { id: string }).id);
  });

  it('evaluate abre 1 ANOMALY (SUPERVISOR_INSIGHT_GENERATED), deduplica e auto-descarta', async () => {
    const svc = asService();
    const adminClient = asUser(admin.accessToken);

    // Diagnóstico recorrente (occurrence_count >= threshold, na janela).
    const diagKey = uniqueKey('anom');
    const diag = await svc
      .from('supervisor_diagnostics')
      .insert({
        module: 'integration',
        operation: 'recurring',
        severity: 'WARNING',
        description: 'Erro recorrente',
        dedup_key: diagKey,
        occurrence_count: 6,
      })
      .select('id')
      .single();
    seededDiagIds.push((diag.data as { id: string }).id);
    const anomalyKey = `ANOMALY:diagnostic:${diagKey}`;

    // 1ª avaliação: abre a anomalia.
    const ev1 = await adminClient.rpc('supervisor_evaluate', {
      p_error_threshold: 5,
      p_window_minutes: 60,
    });
    expect(ev1.error).toBeNull();

    const open1 = await svc
      .from('supervisor_insights')
      .select('id, state')
      .eq('dedup_key', anomalyKey)
      .in('state', ['OPEN', 'ACKNOWLEDGED']);
    expect((open1.data ?? []).length).toBe(1);
    const insightId = (open1.data as { id: string }[])[0].id;
    seededInsightIds.push(insightId);
    expect((open1.data as { state: string }[])[0].state).toBe('OPEN');

    // SUPERVISOR_INSIGHT_GENERATED persistido (caminho de sucesso, sem RAISE);
    // target_id = dedup_key da anomalia.
    await expectAuditPersisted(logs('SUPERVISOR_INSIGHT_GENERATED', anomalyKey), {
      action: 'SUPERVISOR_INSIGHT_GENERATED',
      targetType: 'supervisor_insights',
      targetId: anomalyKey,
    });

    // 2ª avaliação: NÃO cria 2º ativo (dedup). Continua exatamente 1 ativo.
    const ev2 = await adminClient.rpc('supervisor_evaluate', {
      p_error_threshold: 5,
      p_window_minutes: 60,
    });
    expect(ev2.error).toBeNull();
    const active = await svc
      .from('supervisor_insights')
      .select('id')
      .eq('dedup_key', anomalyKey)
      .in('state', ['OPEN', 'ACKNOWLEDGED']);
    expect((active.data ?? []).length).toBe(1);

    // Some a recorrência (occurrence_count cai abaixo do threshold) => 3ª avaliação
    // auto-descarta a anomalia (dismissed_by NULL = automático).
    await svc
      .from('supervisor_diagnostics')
      .update({ occurrence_count: 1 })
      .eq('dedup_key', diagKey);
    const ev3 = await adminClient.rpc('supervisor_evaluate', {
      p_error_threshold: 5,
      p_window_minutes: 60,
    });
    expect(ev3.error).toBeNull();
    const dismissed = await svc
      .from('supervisor_insights')
      .select('state, dismissed_by')
      .eq('id', insightId)
      .single();
    expect((dismissed.data as { state: string }).state).toBe('DISMISSED');
    expect((dismissed.data as { dismissed_by: string | null }).dismissed_by).toBeNull(); // auto
  });

  it('ack/dismiss: transições + SUPERVISOR_INSIGHT_ACK positivo + _SKIPPED persistidos', async () => {
    const svc = asService();
    const adminClient = asUser(admin.accessToken);
    // SUGGESTION sobrevive ao evaluate (que só auto-descarta ANOMALY).
    const insight = await seedOpenInsight('ackflow', 'SUGGESTION');

    // ack OPEN -> ACKNOWLEDGED
    const ack = await adminClient.rpc('supervisor_insight_acknowledge', {
      p_id: insight.id,
      p_expected_updated_at: insight.updated_at,
    });
    expect(ack.error).toBeNull();
    const ackRes = ack.data as { ok?: boolean; updated_at?: string };
    expect(ackRes.ok).toBe(true);
    const afterAck = await svc
      .from('supervisor_insights')
      .select('state')
      .eq('id', insight.id)
      .single();
    expect((afterAck.data as { state: string }).state).toBe('ACKNOWLEDGED');

    // audit positivo SUPERVISOR_INSIGHT_ACK: a camada TS chama log_admin_action após o ack real.
    await adminClient.rpc('log_admin_action', {
      p_action: 'SUPERVISOR_INSIGHT_ACK',
      p_target_type: 'supervisor_insights',
      p_target_id: insight.id,
      p_before: null,
      p_after: { state: 'ACKNOWLEDGED' },
      p_ip: null,
      p_user_agent: null,
    });
    await expectAuditPersisted(logs('SUPERVISOR_INSIGHT_ACK', insight.id), {
      action: 'SUPERVISOR_INSIGHT_ACK',
      targetType: 'supervisor_insights',
      targetId: insight.id,
    });

    // ack de novo (já ACKNOWLEDGED) => _SKIPPED + SUPERVISOR_INSIGHT_ACK_SKIPPED persistido.
    const ackAgain = await adminClient.rpc('supervisor_insight_acknowledge', {
      p_id: insight.id,
      p_expected_updated_at: ackRes.updated_at ?? insight.updated_at,
    });
    expect((ackAgain.data as { skipped?: boolean }).skipped).toBe(true);
    expect((ackAgain.data as { reason?: string }).reason).toBe('ALREADY_ACKNOWLEDGED');
    await expectAuditPersisted(logs('SUPERVISOR_INSIGHT_ACK_SKIPPED', insight.id), {
      action: 'SUPERVISOR_INSIGHT_ACK_SKIPPED',
      targetType: 'supervisor_insights',
      targetId: insight.id,
    });

    // dismiss ACKNOWLEDGED -> DISMISSED
    const dismiss = await adminClient.rpc('supervisor_insight_dismiss', {
      p_id: insight.id,
      p_expected_updated_at: ackRes.updated_at ?? insight.updated_at,
    });
    expect(dismiss.error).toBeNull();
    expect((dismiss.data as { ok?: boolean }).ok).toBe(true);

    // dismiss de novo (já DISMISSED) => _SKIPPED + SUPERVISOR_INSIGHT_DISMISS_SKIPPED persistido.
    const dismissAgain = await adminClient.rpc('supervisor_insight_dismiss', {
      p_id: insight.id,
      p_expected_updated_at: new Date().toISOString(),
    });
    expect((dismissAgain.data as { skipped?: boolean }).skipped).toBe(true);
    expect((dismissAgain.data as { reason?: string }).reason).toBe('ALREADY_DISMISSED');
    await expectAuditPersisted(logs('SUPERVISOR_INSIGHT_DISMISS_SKIPPED', insight.id), {
      action: 'SUPERVISOR_INSIGHT_DISMISS_SKIPPED',
      targetType: 'supervisor_insights',
      targetId: insight.id,
    });
  });

  it('STALE_VERSION (expected_updated_at divergente) e INVALID_STATE_TRANSITION (ack de DISMISSED)', async () => {
    const adminClient = asUser(admin.accessToken);

    // STALE: insight OPEN, ack com timestamp errado.
    const staleInsight = await seedOpenInsight('stale');
    const stale = await adminClient.rpc('supervisor_insight_acknowledge', {
      p_id: staleInsight.id,
      p_expected_updated_at: '2000-01-01T00:00:00Z',
    });
    expect(`${stale.error?.message ?? ''}`).toContain('STALE_VERSION');

    // INVALID: descarta o insight e tente reconhecê-lo (DISMISSED é terminal).
    const termInsight = await seedOpenInsight('invalid');
    await asService()
      .from('supervisor_insights')
      .update({ state: 'DISMISSED' })
      .eq('id', termInsight.id);
    const invalid = await adminClient.rpc('supervisor_insight_acknowledge', {
      p_id: termInsight.id,
      p_expected_updated_at: termInsight.updated_at,
    });
    expect(`${invalid.error?.message ?? ''}`).toContain('INVALID_STATE_TRANSITION');
  });

  it('generate_summary é idempotente por janela (2ª chamada => skipped)', async () => {
    const svc = asService();
    const adminClient = asUser(admin.accessToken);

    // Limpa qualquer resumo diário ativo desta janela para tornar a 1ª chamada determinística.
    await svc
      .from('supervisor_insights')
      .delete()
      .eq('insight_type', 'SUMMARY')
      .in('state', ['OPEN', 'ACKNOWLEDGED']);

    const gen1 = await adminClient.rpc('supervisor_generate_summary', { p_period: 'daily' });
    expect(gen1.error).toBeNull();
    const r1 = gen1.data as { id?: string; skipped?: boolean };
    expect(r1.skipped ?? false).toBe(false);
    expect(r1.id).toBeTruthy();
    if (r1.id) seededInsightIds.push(r1.id);

    const gen2 = await adminClient.rpc('supervisor_generate_summary', { p_period: 'daily' });
    expect(gen2.error).toBeNull();
    expect((gen2.data as { skipped?: boolean }).skipped).toBe(true);
  });

  it('ack NÃO toca a tabela users (Master_Admin imutável por construção)', async () => {
    const svc = asService();
    const adminClient = asUser(admin.accessToken);

    const before = await svc.from('users').select('updated_at').eq('id', admin.id).single();
    const beforeAt = (before.data as { updated_at: string }).updated_at;

    const insight = await seedOpenInsight('notouch');
    await adminClient.rpc('supervisor_insight_acknowledge', {
      p_id: insight.id,
      p_expected_updated_at: insight.updated_at,
    });

    const after = await svc.from('users').select('updated_at').eq('id', admin.id).single();
    const afterAt = (after.data as { updated_at: string }).updated_at;
    expect(afterAt).toBe(beforeAt); // ack/dismiss não mutam users
  });
});
