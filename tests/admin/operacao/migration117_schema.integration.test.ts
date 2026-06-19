/**
 * Integração — schema/efeitos da migration 117 (system_alerts).
 *
 * A reaplicação 2x sem erro é garantida estruturalmente pela própria migration
 * (CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF
 * EXISTS, DROP TRIGGER IF EXISTS) e exercitada pelo runner de migrations do CI.
 * Aqui provamos os efeitos observáveis:
 *   - system_alerts existe; CHECK de alert_type/severity/state são aplicados;
 *   - índice único PARCIAL garante <= 1 alerta ativo por dedup_key (CP4), mas
 *     permite reabrir após RESOLVED (fora do índice parcial);
 *   - RLS habilitada bloqueia anon;
 *   - trigger operacao_touch_updated_at toca updated_at em UPDATE.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.5, 6.6
 */

import { afterAll, expect, it } from 'vitest';
import { asAnon, asService, describeIntegration } from '../../_helpers/supabaseHarness';

const HOOK_TIMEOUT = 30_000;
const TAG = `itest-mig117-${Date.now()}`;

function baseAlert(over: Record<string, unknown> = {}) {
  return {
    alert_type: 'CAMPAIGN_PAUSED',
    severity: 'WARNING',
    source_type: 'dispatch_job',
    source_id: TAG,
    dedup_key: `CAMPAIGN_PAUSED:dispatch_job:${TAG}`,
    title: 'Campanha pausada',
    ...over,
  };
}

describeIntegration('Integração 117 — schema de system_alerts', () => {
  const created: string[] = [];

  afterAll(async () => {
    const svc = asService();
    await svc.from('system_alerts').delete().eq('dedup_key', `CAMPAIGN_PAUSED:dispatch_job:${TAG}`);
    for (const id of created) await svc.from('system_alerts').delete().eq('id', id);
  }, HOOK_TIMEOUT);

  it('aceita um alerta válido e devolve id/updated_at', async () => {
    const { data, error } = await asService()
      .from('system_alerts')
      .insert(baseAlert())
      .select('id, state, updated_at')
      .single();
    expect(error).toBeNull();
    const row = data as { id: string; state: string; updated_at: string };
    created.push(row.id);
    expect(row.id).toBeTruthy();
    expect(row.state).toBe('OPEN'); // default
  });

  it('rejeita alert_type fora do domínio (CHECK)', async () => {
    const { error } = await asService()
      .from('system_alerts')
      .insert(baseAlert({ alert_type: 'NOT_A_TYPE', dedup_key: `x:${TAG}` }));
    expect(error).not.toBeNull();
  });

  it('rejeita severity fora do domínio (CHECK)', async () => {
    const { error } = await asService()
      .from('system_alerts')
      .insert(baseAlert({ severity: 'NOPE', dedup_key: `x2:${TAG}` }));
    expect(error).not.toBeNull();
  });

  it('rejeita state fora do domínio (CHECK)', async () => {
    const { error } = await asService()
      .from('system_alerts')
      .insert(baseAlert({ state: 'NOPE', dedup_key: `x3:${TAG}` }));
    expect(error).not.toBeNull();
  });

  it('índice único parcial: 2º ativo com o mesmo dedup_key é rejeitado; reabre após RESOLVED', async () => {
    const svc = asService();
    const key = `CAMPAIGN_ERROR:dispatch_job:${TAG}`;
    const first = await svc
      .from('system_alerts')
      .insert(baseAlert({ alert_type: 'CAMPAIGN_ERROR', severity: 'CRITICAL', dedup_key: key }))
      .select('id')
      .single();
    expect(first.error).toBeNull();
    const firstId = (first.data as { id: string }).id;
    created.push(firstId);

    // 2º OPEN com o mesmo dedup_key => violação do índice único parcial.
    const dup = await svc
      .from('system_alerts')
      .insert(baseAlert({ alert_type: 'CAMPAIGN_ERROR', severity: 'CRITICAL', dedup_key: key }));
    expect(dup.error).not.toBeNull();

    // Resolve o primeiro (sai do índice parcial WHERE state IN OPEN/ACKNOWLEDGED).
    await svc.from('system_alerts').update({ state: 'RESOLVED' }).eq('id', firstId);

    // Agora um novo OPEN com o mesmo dedup_key é permitido.
    const reopened = await svc
      .from('system_alerts')
      .insert(baseAlert({ alert_type: 'CAMPAIGN_ERROR', severity: 'CRITICAL', dedup_key: key }))
      .select('id')
      .single();
    expect(reopened.error).toBeNull();
    created.push((reopened.data as { id: string }).id);
  });

  it('RLS habilitada bloqueia anon (0 linhas)', async () => {
    const { data } = await asAnon().from('system_alerts').select('id').limit(5);
    expect((data ?? []).length).toBe(0);
  });

  it('trigger operacao_touch_updated_at toca updated_at em UPDATE', async () => {
    const svc = asService();
    const ins = await svc
      .from('system_alerts')
      .insert(baseAlert({ dedup_key: `touch:${TAG}` }))
      .select('id, updated_at')
      .single();
    const row = ins.data as { id: string; updated_at: string };
    created.push(row.id);

    await new Promise((r) => setTimeout(r, 1100));
    await svc.from('system_alerts').update({ title: 'Campanha pausada (editado)' }).eq('id', row.id);

    const after = await svc
      .from('system_alerts')
      .select('updated_at')
      .eq('id', row.id)
      .single();
    const afterAt = (after.data as { updated_at: string }).updated_at;
    expect(new Date(afterAt).getTime()).toBeGreaterThan(new Date(row.updated_at).getTime());
  });
});
