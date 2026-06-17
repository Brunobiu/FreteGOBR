/**
 * Integração — replay idempotente do webhook por `provider_event_id` (task 16.4).
 *
 * O endpoint `whatsapp-webhook` (Edge Function, verify_jwt=false) trata o corpo
 * da Evolution como dado não confiável e delega a INGESTÃO idempotente à RPC
 * `whatsapp_ingest_inbound_message` (migration 098, SECURITY DEFINER, só
 * service_role), que faz o `INSERT ... ON CONFLICT(instance_id,
 * provider_event_id) DO NOTHING`. A garantia de idempotência (Req 16.6, 31.12 —
 * Property P9: <= 1 mensagem por evento) vive nessa RPC + na UNIQUE
 * (instance_id, provider_event_id) de `whatsapp_messages`.
 *
 * Este teste exercita exatamente esse caminho contra o Supabase de teste:
 * reentregar o MESMO `provider_event_id` é no-op (nenhuma mensagem duplicada),
 * enquanto um evento novo do mesmo contato reusa a conversa. Reproduz o cenário
 * de "replay" que a Evolution provoca ao reentregar webhooks.
 *
 * Infra_Dependent: roda só com o branch Supabase efêmero + secrets
 * (`describeIntegration` faz skip caso contrário). Não atrasa o commit local.
 *
 * Validates: Requirements 16.6, 31.12
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  asService,
  describeIntegration,
} from '../_helpers/supabaseHarness';
import { cleanupTestInstance, seedTestInstance } from '../_helpers/whatsappHarness';

interface IngestResult {
  inserted: boolean;
  duplicate: boolean;
  conversation_id: string;
  mode: string;
  message_id: string | null;
}

/** Conta as mensagens persistidas de um `provider_event_id` na instância. */
async function countMessages(instanceId: string, providerEventId: string): Promise<number> {
  const svc = asService();
  const { count, error } = await svc
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('instance_id', instanceId)
    .eq('provider_event_id', providerEventId);
  if (error) throw new Error(`countMessages falhou: ${error.message}`);
  return count ?? 0;
}

describeIntegration('Integração 16.4 — replay idempotente do webhook (provider_event_id)', () => {
  const CONTACT = '5511988887777';
  let instanceId: string;

  beforeAll(async () => {
    const inst = await seedTestInstance(asService(), 'webhook', 90010);
    instanceId = inst.id;
  });

  afterAll(async () => {
    if (instanceId) await cleanupTestInstance(asService(), instanceId);
  });

  it('primeira ingestão cria a conversa em AI_MODE e persiste a mensagem', async () => {
    const { data, error } = await asService().rpc('whatsapp_ingest_inbound_message', {
      p_instance_id: instanceId,
      p_contact_phone: CONTACT,
      p_provider_event_id: 'evt-replay-001',
      p_body: 'Olá, tudo bem?',
      p_preview: null,
    });

    expect(error).toBeNull();
    const r = data as IngestResult;
    expect(r.inserted).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(r.mode).toBe('AI_MODE');
    expect(r.conversation_id).toBeTruthy();
    expect(await countMessages(instanceId, 'evt-replay-001')).toBe(1);
  });

  it('reentregar o MESMO provider_event_id é no-op (sem mensagem duplicada)', async () => {
    // Replay idêntico ao evento já ingerido acima.
    const { data, error } = await asService().rpc('whatsapp_ingest_inbound_message', {
      p_instance_id: instanceId,
      p_contact_phone: CONTACT,
      p_provider_event_id: 'evt-replay-001',
      p_body: 'Olá, tudo bem?',
      p_preview: null,
    });

    expect(error).toBeNull();
    const r = data as IngestResult;
    expect(r.inserted).toBe(false);
    expect(r.duplicate).toBe(true);
    // Continua existindo exatamente UMA mensagem para o evento (P9).
    expect(await countMessages(instanceId, 'evt-replay-001')).toBe(1);
  });

  it('múltiplos replays concorrentes do mesmo evento inserem no máximo uma vez', async () => {
    const fire = () =>
      asService().rpc('whatsapp_ingest_inbound_message', {
        p_instance_id: instanceId,
        p_contact_phone: CONTACT,
        p_provider_event_id: 'evt-replay-concurrent',
        p_body: 'corrida',
        p_preview: null,
      });

    const results = await Promise.all([fire(), fire(), fire(), fire(), fire()]);
    const insertedCount = results.filter((res) => (res.data as IngestResult | null)?.inserted).length;

    expect(insertedCount).toBe(1);
    expect(await countMessages(instanceId, 'evt-replay-concurrent')).toBe(1);
  });

  it('evento novo do mesmo contato reusa a conversa e persiste outra mensagem', async () => {
    const { data, error } = await asService().rpc('whatsapp_ingest_inbound_message', {
      p_instance_id: instanceId,
      p_contact_phone: CONTACT,
      p_provider_event_id: 'evt-replay-002',
      p_body: 'Quero um orçamento',
      p_preview: null,
    });

    expect(error).toBeNull();
    const r = data as IngestResult;
    expect(r.inserted).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(await countMessages(instanceId, 'evt-replay-002')).toBe(1);

    // Mesma conversa do contato (1 conversa por instance_id + contact_phone).
    const { count } = await asService()
      .from('whatsapp_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('instance_id', instanceId)
      .eq('contact_phone', CONTACT);
    expect(count).toBe(1);
  });

  it('instância inexistente ⇒ WHATSAPP_NOT_FOUND (salvaguarda anti-enumeração)', async () => {
    const { error } = await asService().rpc('whatsapp_ingest_inbound_message', {
      p_instance_id: '00000000-0000-0000-0000-000000000000',
      p_contact_phone: CONTACT,
      p_provider_event_id: 'evt-replay-x',
      p_body: 'oi',
      p_preview: null,
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? '').toContain('WHATSAPP_NOT_FOUND');
  });
});
