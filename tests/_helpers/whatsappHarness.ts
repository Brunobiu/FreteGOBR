/**
 * WhatsApp Test Harness — spec `whatsapp-automation` (Fase 2, integração).
 *
 * Helpers de seed/cleanup para os testes de integração do WhatsApp_Module
 * (tasks 1.10, 12.8, 16.4). Todos operam via service_role (contorna a RLS) e
 * criam uma WhatsApp_Instance DEDICADA por arquivo de teste: como toda tabela
 * `whatsapp_*` referencia `whatsapp_instances(id)` com ON DELETE CASCADE
 * (migration 092), apagar a instância limpa TODOS os filhos (jobs, recipients,
 * messages, conversations, scheduled...) — cleanup trivial e isolado.
 *
 * Infra_Dependent: usado apenas dentro de `describeIntegration` (skip quando o
 * branch Supabase efêmero + secrets não estão provisionados). Credenciais
 * SEMPRE via env (ver `supabaseHarness.ts`); nada hardcoded.
 *
 * Convenção de `display_order`: cada arquivo usa um offset alto e único (>= 90000)
 * para não colidir com o seed inicial (1..5) nem entre arquivos rodando em
 * paralelo no CI. O nome Evolution é determinístico (`frego_wa_test_<tag>`),
 * permitindo um cleanup-first idempotente por nome.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Instância de teste criada via service_role. */
export interface TestInstance {
  id: string;
  evolutionInstanceName: string;
}

interface InsertedInstanceRow {
  id: string;
  evolution_instance_name: string;
}

/**
 * Cria uma WhatsApp_Instance dedicada de teste. Idempotente: remove antes
 * qualquer resíduo com o mesmo nome (CASCADE limpa filhos), depois insere uma
 * linha nova e habilitada. Lança se o ambiente não persistir a linha.
 *
 * @param svc          cliente service_role (de `asService()`)
 * @param tag          sufixo determinístico do nome (ex.: 'webhook', 'rls_a')
 * @param displayOrder offset único e alto (>= 90000) para evitar colisão UNIQUE
 */
export async function seedTestInstance(
  svc: SupabaseClient,
  tag: string,
  displayOrder: number
): Promise<TestInstance> {
  const evolutionInstanceName = `frego_wa_test_${tag}`;

  // cleanup-first: remove resíduo de uma execução anterior (CASCADE nos filhos).
  await svc.from('whatsapp_instances').delete().eq('evolution_instance_name', evolutionInstanceName);

  const { data, error } = await svc
    .from('whatsapp_instances')
    .insert({
      label: `Test ${tag}`,
      display_order: displayOrder,
      enabled: true,
      evolution_instance_name: evolutionInstanceName,
    })
    .select('id, evolution_instance_name')
    .single();

  if (error || !data) {
    throw new Error(`seedTestInstance(${tag}) falhou: ${error?.message ?? 'sem linha retornada'}`);
  }

  const row = data as InsertedInstanceRow;
  return { id: row.id, evolutionInstanceName: row.evolution_instance_name };
}

/**
 * Remove a instância de teste (idempotente). O ON DELETE CASCADE da 092 limpa
 * todos os registros `whatsapp_*` filhos da instância.
 */
export async function cleanupTestInstance(svc: SupabaseClient, instanceId: string): Promise<void> {
  await svc.from('whatsapp_instances').delete().eq('id', instanceId);
}
