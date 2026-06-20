/**
 * Integração — schema/efeitos da migration 118 (supervisor_diagnostics +
 * supervisor_insights).
 *
 * A reaplicação 2x sem erro é garantida estruturalmente pela própria migration
 * (CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF
 * EXISTS, DROP TRIGGER IF EXISTS) e exercitada pelo runner de migrations do CI.
 * Aqui provamos os efeitos observáveis:
 *   - supervisor_diagnostics existe; CHECK de severity é aplicado; UNIQUE
 *     (dedup_key) impede 2ª linha com a mesma chave (registro rolling);
 *   - supervisor_insights existe; CHECK de insight_type/severity/state aplicados;
 *   - índice único PARCIAL uq_supervisor_insights_active_dedup garante <= 1
 *     insight ATIVO por dedup_key (CP3), mas permite reabrir após DISMISSED
 *     (fora do índice parcial);
 *   - RLS habilitada bloqueia anon nas duas tabelas;
 *   - trigger supervisor_touch_updated_at toca updated_at em UPDATE.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 3.x, 5.4, 11.x (admin-ia-supervisora)
 */

import { afterAll, expect, it } from 'vitest';
import { asAnon, asService, describeIntegration } from '../../_helpers/supabaseHarness';

const HOOK_TIMEOUT = 30_000;
const TAG = `itest-mig118-${Date.now()}`;

function baseDiag(over: Record<string, unknown> = {}) {
  return {
    module: 'integration',
    operation: 'schema_probe',
    severity: 'WARNING',
    description: 'Diagnóstico de teste',
    dedup_key: `diag:${TAG}`,
    ...over,
  };
}

function baseInsight(over: Record<string, unknown> = {}) {
  return {
    insight_type: 'SUGGESTION',
    severity: 'WARNING',
    title: 'Insight de teste',
    dedup_key: `insight:${TAG}`,
    ...over,
  };
}

describeIntegration('Integração 118 — schema de supervisor_diagnostics/insights', () => {
  const diagIds: string[] = [];
  const insightIds: string[] = [];

  afterAll(async () => {
    const svc = asService();
    for (const id of diagIds) await svc.from('supervisor_diagnostics').delete().eq('id', id);
    for (const id of insightIds) await svc.from('supervisor_insights').delete().eq('id', id);
  }, HOOK_TIMEOUT);

  it('aceita um diagnóstico válido com defaults (occurrence_count=1)', async () => {
    const { data, error } = await asService()
      .from('supervisor_diagnostics')
      .insert(baseDiag())
      .select('id, occurrence_count')
      .single();
    expect(error).toBeNull();
    const row = data as { id: string; occurrence_count: number };
    diagIds.push(row.id);
    expect(row.id).toBeTruthy();
    expect(row.occurrence_count).toBe(1); // default
  });

  it('rejeita severity de diagnóstico fora do domínio (CHECK)', async () => {
    const { error } = await asService()
      .from('supervisor_diagnostics')
      .insert(baseDiag({ severity: 'NOPE', dedup_key: `diag-bad:${TAG}` }));
    expect(error).not.toBeNull();
  });

  it('UNIQUE(dedup_key): 2º diagnóstico com a mesma chave é rejeitado (rolling)', async () => {
    const svc = asService();
    const key = `diag-uniq:${TAG}`;
    const first = await svc
      .from('supervisor_diagnostics')
      .insert(baseDiag({ dedup_key: key }))
      .select('id')
      .single();
    expect(first.error).toBeNull();
    diagIds.push((first.data as { id: string }).id);

    const dup = await svc.from('supervisor_diagnostics').insert(baseDiag({ dedup_key: key }));
    expect(dup.error).not.toBeNull();
  });

  it('aceita um insight válido (state default OPEN)', async () => {
    const { data, error } = await asService()
      .from('supervisor_insights')
      .insert(baseInsight())
      .select('id, state')
      .single();
    expect(error).toBeNull();
    const row = data as { id: string; state: string };
    insightIds.push(row.id);
    expect(row.state).toBe('OPEN'); // default
  });

  it('rejeita insight_type fora do domínio (CHECK)', async () => {
    const { error } = await asService()
      .from('supervisor_insights')
      .insert(baseInsight({ insight_type: 'NOT_A_TYPE', dedup_key: `insight-t:${TAG}` }));
    expect(error).not.toBeNull();
  });

  it('rejeita severity de insight fora do domínio (CHECK)', async () => {
    const { error } = await asService()
      .from('supervisor_insights')
      .insert(baseInsight({ severity: 'NOPE', dedup_key: `insight-s:${TAG}` }));
    expect(error).not.toBeNull();
  });

  it('rejeita state de insight fora do domínio (CHECK)', async () => {
    const { error } = await asService()
      .from('supervisor_insights')
      .insert(baseInsight({ state: 'NOPE', dedup_key: `insight-st:${TAG}` }));
    expect(error).not.toBeNull();
  });

  it('índice único parcial: 2º ativo com o mesmo dedup_key é rejeitado; reabre após DISMISSED', async () => {
    const svc = asService();
    const key = `insight-active:${TAG}`;
    const first = await svc
      .from('supervisor_insights')
      .insert(baseInsight({ insight_type: 'ANOMALY', severity: 'CRITICAL', dedup_key: key }))
      .select('id')
      .single();
    expect(first.error).toBeNull();
    const firstId = (first.data as { id: string }).id;
    insightIds.push(firstId);

    // 2º OPEN com o mesmo dedup_key => violação do índice único parcial.
    const dup = await svc
      .from('supervisor_insights')
      .insert(baseInsight({ insight_type: 'ANOMALY', severity: 'CRITICAL', dedup_key: key }));
    expect(dup.error).not.toBeNull();

    // Descarta o primeiro (sai do índice parcial WHERE state IN OPEN/ACKNOWLEDGED).
    await svc.from('supervisor_insights').update({ state: 'DISMISSED' }).eq('id', firstId);

    // Agora um novo OPEN com o mesmo dedup_key é permitido.
    const reopened = await svc
      .from('supervisor_insights')
      .insert(baseInsight({ insight_type: 'ANOMALY', severity: 'CRITICAL', dedup_key: key }))
      .select('id')
      .single();
    expect(reopened.error).toBeNull();
    insightIds.push((reopened.data as { id: string }).id);
  });

  it('RLS habilitada bloqueia anon nas duas tabelas (0 linhas)', async () => {
    const diag = await asAnon().from('supervisor_diagnostics').select('id').limit(5);
    expect((diag.data ?? []).length).toBe(0);
    const ins = await asAnon().from('supervisor_insights').select('id').limit(5);
    expect((ins.data ?? []).length).toBe(0);
  });

  it('trigger supervisor_touch_updated_at toca updated_at em UPDATE', async () => {
    const svc = asService();
    const ins = await svc
      .from('supervisor_diagnostics')
      .insert(baseDiag({ dedup_key: `diag-touch:${TAG}` }))
      .select('id, updated_at')
      .single();
    const row = ins.data as { id: string; updated_at: string };
    diagIds.push(row.id);

    await new Promise((r) => setTimeout(r, 1100));
    await svc
      .from('supervisor_diagnostics')
      .update({ description: 'Diagnóstico de teste (editado)' })
      .eq('id', row.id);

    const after = await svc
      .from('supervisor_diagnostics')
      .select('updated_at')
      .eq('id', row.id)
      .single();
    const afterAt = (after.data as { updated_at: string }).updated_at;
    expect(new Date(afterAt).getTime()).toBeGreaterThan(new Date(row.updated_at).getTime());
  });
});
