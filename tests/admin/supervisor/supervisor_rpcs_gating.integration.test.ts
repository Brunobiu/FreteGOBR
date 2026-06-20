/**
 * Integração — gating das RPCs da IA Supervisora (migration 118) e isolamento.
 *
 * Prova que admin (ADMIN) lê supervisor_diagnostics_list/supervisor_insights_list/
 * supervisor_chat_context, enquanto um Cliente comum recebe permission_denied
 * (42501) em TODAS as 8 RPCs (leitura, mutação, avaliação e resumo) e nunca
 * obtém linhas de supervisor_diagnostics/insights (isolamento).
 *
 * NOTA (Postgres): o log negativo `SUPERVISOR_VIEW_DENIED` é gravado e então a
 * RPC faz `RAISE`, o que reverte o INSERT na mesma transação (PostgREST = 1
 * transação por chamada). Por isso asserimos o ERRO `permission_denied` (42501)
 * — não a persistência do log negativo (que não sobrevive ao rollback). Os
 * audits de caminho de SUCESSO persistem e são verificados em
 * supervisor_lifecycle.integration.test.ts.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 2.x, 10.x, 12.x, 13.x (admin-ia-supervisora)
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

const HOOK_TIMEOUT = 30_000;
const FAKE_ID = '11111111-1111-4111-8111-111111111111';

function deniedCode(res: { error: { code?: string; message?: string } | null }): string {
  return `${res.error?.code ?? ''}${res.error?.message ?? ''}`;
}

describeIntegration('Integração 118 — gating das RPCs da IA Supervisora', () => {
  let admin: SeededUser;
  let client: SeededUser;

  beforeAll(async () => {
    const svc = asService();
    admin = await seedUser({ tag: 'sup-gate-admin', userType: 'embarcador' });
    client = await seedUser({ tag: 'sup-gate-client', userType: 'motorista' });
    await ensureUserRow(svc, { id: admin.id, userType: 'embarcador' });
    await ensureUserRow(svc, { id: client.id, userType: 'motorista' });
    await seedAdminRole(svc, admin.id, 'ADMIN'); // SUPERVISOR_VIEW + SUPERVISOR_MANAGE
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

  it('admin lê supervisor_diagnostics_list ({items,total})', async () => {
    const { data, error } = await asUser(admin.accessToken).rpc('supervisor_diagnostics_list', {
      p_module: null,
      p_severity: null,
      p_from: null,
      p_to: null,
      p_limit: 10,
      p_offset: 0,
    });
    expect(error).toBeNull();
    const res = data as { items?: unknown[]; total?: number };
    expect(Array.isArray(res.items)).toBe(true);
    expect(typeof res.total).toBe('number');
  });

  it('admin lê supervisor_insights_list ({items,total})', async () => {
    const { data, error } = await asUser(admin.accessToken).rpc('supervisor_insights_list', {
      p_type: null,
      p_severity: null,
      p_state: null,
      p_limit: 10,
      p_offset: 0,
    });
    expect(error).toBeNull();
    const res = data as { items?: unknown[]; total?: number };
    expect(Array.isArray(res.items)).toBe(true);
    expect(typeof res.total).toBe('number');
  });

  it('admin lê supervisor_chat_context (agregados, sem PII)', async () => {
    const { data, error } = await asUser(admin.accessToken).rpc('supervisor_chat_context', {
      p_intents: null,
    });
    expect(error).toBeNull();
    const ctx = data as Record<string, unknown>;
    expect(ctx).toHaveProperty('metrics');
    expect(ctx).toHaveProperty('generated_at');
    // Sem PII: o contexto carrega apenas contagens/agregados.
    expect(ctx).toHaveProperty('alerts_open');
    expect(ctx).toHaveProperty('insights_open');
  });

  it('Cliente comum => permission_denied (42501) em TODAS as 8 RPCs', async () => {
    const c = asUser(client.accessToken);

    expect(
      deniedCode(
        await c.rpc('supervisor_record_diagnostic', {
          p_module: 'x',
          p_operation: 'y',
          p_severity: 'WARNING',
          p_error_code: null,
          p_description: '',
          p_probable_cause: null,
          p_suggested_fix: null,
          p_detail: {},
          p_dedup_key: null,
        })
      )
    ).toContain('42501');

    expect(
      deniedCode(
        await c.rpc('supervisor_diagnostics_list', {
          p_module: null,
          p_severity: null,
          p_from: null,
          p_to: null,
          p_limit: 10,
          p_offset: 0,
        })
      )
    ).toContain('42501');

    expect(
      deniedCode(
        await c.rpc('supervisor_insights_list', {
          p_type: null,
          p_severity: null,
          p_state: null,
          p_limit: 10,
          p_offset: 0,
        })
      )
    ).toContain('42501');

    expect(deniedCode(await c.rpc('supervisor_chat_context', { p_intents: null }))).toContain(
      '42501'
    );

    expect(
      deniedCode(
        await c.rpc('supervisor_evaluate', { p_error_threshold: 5, p_window_minutes: 60 })
      )
    ).toContain('42501');

    expect(
      deniedCode(await c.rpc('supervisor_generate_summary', { p_period: 'daily' }))
    ).toContain('42501');

    expect(
      deniedCode(
        await c.rpc('supervisor_insight_acknowledge', {
          p_id: FAKE_ID,
          p_expected_updated_at: new Date().toISOString(),
        })
      )
    ).toContain('42501');

    expect(
      deniedCode(
        await c.rpc('supervisor_insight_dismiss', {
          p_id: FAKE_ID,
          p_expected_updated_at: new Date().toISOString(),
        })
      )
    ).toContain('42501');
  });

  it('isolamento: Cliente comum não lê supervisor_* direto', async () => {
    const c = asUser(client.accessToken);
    const diag = await c.from('supervisor_diagnostics').select('id').limit(5);
    expect((diag.data ?? []).length).toBe(0);
    const ins = await c.from('supervisor_insights').select('id').limit(5);
    expect((ins.data ?? []).length).toBe(0);
  });
});
