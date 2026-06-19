/**
 * Integração — isolamento RLS + gating da Central de Suporte Inteligente (115).
 *
 * Prova de forma honesta (semeia via service_role, que contorna RLS) que:
 *   - support_kb_entries só é legível por admin com FAQ_VIEW; anon e usuário
 *     comum recebem 0 linhas embora a linha exista.
 *   - support_ai_config (singleton) só é legível por admin com SUPORTE_VIEW.
 *   - usuário comum não consegue INSERT direto em support_kb_entries.
 *   - support_admin_list_tickets nega caller sem SUPORTE_VIEW com
 *     permission_denied E grava SUPORTE_VIEW_DENIED em admin_audit_logs
 *     (precedência + log negativo persistido — testing-governance).
 *
 * Infra_Dependent: roda só com branch Supabase efêmero + secrets
 * (describeIntegration faz skip caso contrário).
 *
 * Validates: Requirements 4.7, 4.8, 11.1, 11.2, 11.5
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
} from '../_helpers/supabaseHarness';

const HOOK_TIMEOUT = 30_000;

describeIntegration('Integração 115 — RLS + gating da Central de Suporte', () => {
  let kbId: string;
  let nonAdmin: SeededUser;

  beforeAll(async () => {
    const svc = asService();
    const { data: kb, error } = await svc
      .from('support_kb_entries')
      .insert({
        question: 'Pergunta de teste de RLS?',
        answer: 'Resposta de teste.',
        category: 'geral',
        publication_state: 'rascunho',
      })
      .select('id')
      .single();
    if (error || !kb) throw new Error(`seed FAQ falhou: ${error?.message}`);
    kbId = (kb as { id: string }).id;

    nonAdmin = await seedUser({ tag: 'suporte-rls-driver', userType: 'motorista' });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (kbId) await asService().from('support_kb_entries').delete().eq('id', kbId);
    if (nonAdmin) await cleanupUser(nonAdmin.id);
  }, HOOK_TIMEOUT);

  it('service_role enxerga a FAQ semeada e o singleton de config (vazios depois são significativos)', async () => {
    const svc = asService();
    const { data: kb } = await svc.from('support_kb_entries').select('id').eq('id', kbId);
    expect((kb ?? []).length).toBe(1);
    const { data: cfg } = await svc.from('support_ai_config').select('id');
    expect((cfg ?? []).length).toBe(1); // singleton seedado pela migration 115
  });

  it('anônimo não lê support_kb_entries nem support_ai_config', async () => {
    const anon = asAnon();
    const { data: kb } = await anon.from('support_kb_entries').select('id').eq('id', kbId);
    expect((kb ?? []).length).toBe(0);
    const { data: cfg } = await anon.from('support_ai_config').select('id');
    expect((cfg ?? []).length).toBe(0);
  });

  it('usuário comum (motorista) não lê a FAQ nem a config, embora existam', async () => {
    const user = asUser(nonAdmin.accessToken);
    const { data: kb } = await user.from('support_kb_entries').select('id').eq('id', kbId);
    expect((kb ?? []).length).toBe(0);
    const { data: cfg } = await user.from('support_ai_config').select('id');
    expect((cfg ?? []).length).toBe(0);
  });

  it('usuário comum não consegue INSERIR FAQ direto (escrita só via RPC FAQ_EDIT)', async () => {
    const user = asUser(nonAdmin.accessToken);
    const { error } = await user
      .from('support_kb_entries')
      .insert({ question: 'intrusa?', answer: 'x', category: 'geral' });
    expect(error).not.toBeNull();
  });

  it('support_admin_list_tickets nega não-admin com permission_denied e grava SUPORTE_VIEW_DENIED', async () => {
    const user = asUser(nonAdmin.accessToken);
    const { error } = await user.rpc('support_admin_list_tickets', {
      p_filters: {},
      p_limit: 10,
      p_offset: 0,
    });
    expect(error).not.toBeNull();
    expect(`${error?.code ?? ''}${error?.message ?? ''}`).toContain('42501');

    // Log negativo PERSISTIDO (a RPC grava antes de abortar).
    const { data: logs } = await asService()
      .from('admin_audit_logs')
      .select('action, after_data')
      .eq('action', 'SUPORTE_VIEW_DENIED')
      .eq('admin_id', nonAdmin.id);
    expect((logs ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
