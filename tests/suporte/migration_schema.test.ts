/**
 * Integração — schema da migration 115 (amplificação compatível + objetos novos).
 *
 * Prova que a migration 115:
 *   - ampliou support_tickets.status para os 5 estados (aceita waiting_customer
 *     e closed; rejeita valor fora do domínio) sem invalidar os legados.
 *   - adicionou as colunas responder_mode / priority_level (lidas de volta).
 *   - criou support_kb_entries e support_ai_config (singleton seedado, 1 linha).
 *
 * Infra_Dependent: skip sem branch Supabase efêmero.
 *
 * Validates: Requirements 3.1, 3.2, 5.1, 6.8, 13.1, 13.2, 13.3, 13.4
 */

import { afterAll, expect, it } from 'vitest';
import { asService, describeIntegration } from '../_helpers/supabaseHarness';

const created: string[] = [];

async function seedTicket(status: string, suffix: string) {
  const svc = asService();
  return svc
    .from('support_tickets')
    .insert({
      guest_name: `Visitante ${suffix}`,
      guest_email: `visitante-${suffix}@teste.com`,
      subject: `Ticket de schema ${suffix}`,
      status,
      responder_mode: 'ai',
      priority_level: 2,
    })
    .select('id, status, responder_mode, priority_level')
    .single();
}

describeIntegration('Integração 115 — schema (status 3→5, colunas novas, singletons)', () => {
  afterAll(async () => {
    if (created.length > 0) await asService().from('support_tickets').delete().in('id', created);
  }, 30_000);

  it('aceita os estados novos (waiting_customer, closed) e os legados', async () => {
    for (const [status, sfx] of [
      ['open', 'open'],
      ['in_progress', 'inprog'],
      ['waiting_customer', 'waiting'],
      ['resolved', 'resolved'],
      ['closed', 'closed'],
    ] as const) {
      const { data, error } = await seedTicket(status, sfx);
      expect(error).toBeNull();
      const row = data as { id: string; status: string; responder_mode: string; priority_level: number };
      created.push(row.id);
      expect(row.status).toBe(status);
      // Colunas novas lidas de volta.
      expect(row.responder_mode).toBe('ai');
      expect(row.priority_level).toBe(2);
    }
  });

  it('rejeita status fora do domínio fechado', async () => {
    const { error } = await seedTicket('estado_invalido', 'bogus');
    expect(error).not.toBeNull();
  });

  it('support_ai_config é singleton (exatamente 1 linha seedada)', async () => {
    const { data, error } = await asService().from('support_ai_config').select('id, enabled, confidence_threshold');
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  it('support_kb_entries existe e aceita leitura via service_role', async () => {
    const { error } = await asService().from('support_kb_entries').select('id').limit(1);
    expect(error).toBeNull();
  });
});
