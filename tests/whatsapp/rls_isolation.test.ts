/**
 * Integração — isolamento RLS do WhatsApp_Module (task 1.10, reforça P1).
 *
 * Property P1 (testing-governance): as APIs impedem qualquer acesso cruzado —
 * sem a permissão de admin correta, nenhum dado do módulo é legível/mutável.
 * Toda tabela `whatsapp_*` (migration 092, SEÇÃO 9) tem RLS que delega ao RBAC
 * do painel: SELECT exige `is_admin_with_permission('SETTINGS_VIEW')` e mutação
 * exige `SETTINGS_EDIT`. Não há posse por linha — o gate é a permissão de admin.
 *
 * Este teste prova o isolamento de forma honesta: semeia dados reais via
 * service_role (que contorna a RLS) e verifica que um cliente ANÔNIMO e um
 * usuário AUTENTICADO COMUM (motorista, sem permissão de admin) não conseguem
 * lê-los nem mutá-los — embora as linhas existam de fato. O service_role
 * enxerga as mesmas linhas, tornando os resultados vazios significativos (não é
 * "tabela vazia").
 *
 * O escopo por `instance_id` entre admins (acesso cruzado entre instâncias) é
 * garantido na camada de RPC (`whatsapp_assert_instance` + anti-enumeração) e
 * coberto pelos testes unitários de serviço; aqui focamos a postura de RLS que
 * fundamenta P1.
 *
 * Infra_Dependent: roda só com o branch Supabase efêmero + secrets
 * (`describeIntegration` faz skip caso contrário).
 *
 * Validates: Requirements 1.1, 1.2, 1.3 (P1)
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
import { cleanupTestInstance, seedTestInstance } from '../_helpers/whatsappHarness';

const HOOK_TIMEOUT = 30_000;

describeIntegration('Integração 1.10 — isolamento RLS do WhatsApp_Module (P1)', () => {
  let instanceId: string;
  let listId: string;
  let nonAdmin: SeededUser;

  beforeAll(async () => {
    const svc = asService();
    const inst = await seedTestInstance(svc, 'rls', 90030);
    instanceId = inst.id;

    // Semeia dados filhos reais (via service_role) para serem invisíveis ao não-admin.
    const { data: list, error: listErr } = await svc
      .from('whatsapp_contact_lists')
      .insert({ instance_id: instanceId, name: 'Lista RLS' })
      .select('id')
      .single();
    if (listErr || !list) throw new Error(`seed lista falhou: ${listErr?.message}`);
    listId = (list as { id: string }).id;

    const { error: convErr } = await svc
      .from('whatsapp_conversations')
      .insert({ instance_id: instanceId, contact_phone: '5511970001122', mode: 'AI_MODE' });
    if (convErr) throw new Error(`seed conversa falhou: ${convErr.message}`);

    // Usuário autenticado COMUM (sem permissão de admin).
    nonAdmin = await seedUser({ tag: 'wa-rls-driver', userType: 'motorista' });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (instanceId) await cleanupTestInstance(asService(), instanceId);
    if (nonAdmin) await cleanupUser(nonAdmin.id);
  }, HOOK_TIMEOUT);

  it('service_role enxerga as linhas semeadas (resultados vazios depois são significativos)', async () => {
    const svc = asService();
    const { data: insts } = await svc
      .from('whatsapp_instances')
      .select('id')
      .eq('id', instanceId);
    expect((insts ?? []).length).toBe(1);

    const { data: lists } = await svc
      .from('whatsapp_contact_lists')
      .select('id')
      .eq('instance_id', instanceId);
    expect((lists ?? []).length).toBe(1);
  });

  it('cliente anônimo não lê nenhuma tabela whatsapp_*', async () => {
    const anon = asAnon();
    for (const table of ['whatsapp_instances', 'whatsapp_contact_lists', 'whatsapp_conversations']) {
      const { data } = await anon.from(table).select('id').eq('instance_id', instanceId);
      // RLS filtra todas as linhas (sem permissão de admin) ⇒ vazio/sem acesso.
      expect((data ?? []).length).toBe(0);
    }
  });

  it('usuário autenticado comum (motorista) não lê dados do módulo, embora existam', async () => {
    const user = asUser(nonAdmin.accessToken);

    const { data: insts } = await user.from('whatsapp_instances').select('id').eq('id', instanceId);
    expect((insts ?? []).length).toBe(0);

    const { data: lists } = await user
      .from('whatsapp_contact_lists')
      .select('id')
      .eq('instance_id', instanceId);
    expect((lists ?? []).length).toBe(0);

    const { data: convs } = await user
      .from('whatsapp_conversations')
      .select('id')
      .eq('instance_id', instanceId);
    expect((convs ?? []).length).toBe(0);
  });

  it('usuário comum não consegue INSERIR (WITH CHECK exige SETTINGS_EDIT)', async () => {
    const user = asUser(nonAdmin.accessToken);
    const { error } = await user
      .from('whatsapp_contact_lists')
      .insert({ instance_id: instanceId, name: 'tentativa intrusa' });
    // RLS rejeita a inserção (nova linha viola a policy) — mutação negada.
    expect(error).not.toBeNull();
  });

  it('usuário comum não consegue ATUALIZAR nem APAGAR linhas existentes', async () => {
    const user = asUser(nonAdmin.accessToken);

    // UPDATE/DELETE sob RLS: a linha é invisível ao usuário ⇒ 0 linhas afetadas
    // (ou erro). Em nenhum caso a linha real é alterada.
    await user.from('whatsapp_contact_lists').update({ name: 'hackeado' }).eq('id', listId);
    await user.from('whatsapp_contact_lists').delete().eq('id', listId);

    // service_role confirma que a linha continua intacta.
    const { data } = await asService()
      .from('whatsapp_contact_lists')
      .select('id, name')
      .eq('id', listId)
      .single();
    expect(data).not.toBeNull();
    expect((data as { name: string }).name).toBe('Lista RLS');
  });
});
