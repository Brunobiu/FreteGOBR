/**
 * Integração — exclusão mútua IA×humano server-side (CP1) + idempotência.
 *
 * Exercita o fluxo de IA pelas RPCs service-role (claim/insert_ai/handoff),
 * provando o invariante de CP1 diretamente no banco (FOR UPDATE + recheck):
 *   - claim idempotente (2º claim mesmo idempotency_key ⇒ DUPLICATE).
 *   - insert_ai_reply sob modo 'ai' persiste e resolve.
 *   - sob modo 'human', insert_ai_reply ⇒ AI_LOCKED e NADA é persistido.
 *   - handoff repetido ⇒ _SKIPPED ALREADY_HUMAN.
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 7.5, 8.2, 8.3, 8.5, 9.4
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import { asService, describeIntegration } from '../_helpers/supabaseHarness';

const HOOK_TIMEOUT = 30_000;

async function aiMessageCount(ticketId: string): Promise<number> {
  const { data } = await asService()
    .from('support_ticket_messages')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('author_kind', 'ai');
  return (data ?? []).length;
}

describeIntegration('Integração 115b — exclusão mútua IA×humano (CP1)', () => {
  let ticketId: string;

  beforeAll(async () => {
    const svc = asService();
    const { data, error } = await svc
      .from('support_tickets')
      .insert({
        guest_name: 'Visitante IA',
        guest_email: 'visitante-ia@teste.com',
        subject: 'Atendimento automático de teste',
        status: 'open',
        responder_mode: 'ai',
        priority_level: 1,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seed ticket falhou: ${error?.message}`);
    ticketId = (data as { id: string }).id;
    // Mensagem inicial do cliente.
    await svc.from('support_ticket_messages').insert({
      ticket_id: ticketId,
      body: 'Olá, preciso de ajuda.',
      is_admin: false,
      author_kind: 'user',
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (ticketId) await asService().from('support_tickets').delete().eq('id', ticketId);
  }, HOOK_TIMEOUT);

  it('claim é idempotente: 1º ALLOW, 2º mesmo idempotency_key ⇒ DUPLICATE', async () => {
    const svc = asService();
    const { data: first } = await svc.rpc('support_claim_ai_reply', {
      p_ticket_id: ticketId,
      p_idempotency_key: 'k-cp1-1',
    });
    expect((first as { decision?: string } | null)?.decision).toBe('ALLOW');

    const { data: second } = await svc.rpc('support_claim_ai_reply', {
      p_ticket_id: ticketId,
      p_idempotency_key: 'k-cp1-1',
    });
    expect((second as { decision?: string } | null)?.decision).toBe('DUPLICATE');
  });

  it('insert_ai_reply sob modo ai persiste a resposta e resolve o atendimento', async () => {
    const svc = asService();
    const before = await aiMessageCount(ticketId);
    const { data, error } = await svc.rpc('support_insert_ai_reply', {
      p_ticket_id: ticketId,
      p_body: 'Resposta automática fundamentada na Base.',
      p_expected_updated_at: null,
    });
    expect(error).toBeNull();
    expect((data as { ok?: boolean } | null)?.ok).toBe(true);
    expect(await aiMessageCount(ticketId)).toBe(before + 1);

    const { data: t } = await svc.from('support_tickets').select('status').eq('id', ticketId).single();
    expect((t as { status: string }).status).toBe('resolved');
  });

  it('sob modo human, insert_ai_reply ⇒ AI_LOCKED e NÃO persiste mensagem (invariante CP1)', async () => {
    const svc = asService();
    await svc.from('support_tickets').update({ responder_mode: 'human' }).eq('id', ticketId);
    const before = await aiMessageCount(ticketId);

    const { error } = await svc.rpc('support_insert_ai_reply', {
      p_ticket_id: ticketId,
      p_body: 'Tentativa de resposta da IA sob modo humano.',
      p_expected_updated_at: null,
    });
    expect(error).not.toBeNull();
    expect(`${error?.message ?? ''}`).toContain('AI_LOCKED');
    expect(await aiMessageCount(ticketId)).toBe(before); // nada persistido
  });

  it('handoff repetido sob modo human ⇒ _SKIPPED ALREADY_HUMAN', async () => {
    const svc = asService();
    const { data } = await svc.rpc('support_handoff_to_human', {
      p_ticket_id: ticketId,
      p_expected_updated_at: null,
    });
    const res = data as { skipped?: boolean; reason?: string } | null;
    expect(res?.skipped).toBe(true);
    expect(res?.reason).toBe('ALREADY_HUMAN');
  });
});
