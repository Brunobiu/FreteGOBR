/**
 * Integração — ciclo durável do Job_Worker (task 12.8).
 *
 * Exercita o motor de disparo durável (migrations 103 claim + 111 resultado/
 * recuperação) ponta a ponta contra o Supabase de teste, simulando os "ticks"
 * que a Edge Function `whatsapp-job-worker` executa (verify_jwt=false, acionada
 * por pg_cron). Todas as RPCs são SECURITY DEFINER e GRANT só a service_role.
 *
 * Cenários (design.md > "Modelo de execução do Job_Worker (tick)"):
 *   1. Criar job + recipients, reivindicar (claim), enviar 1, "reiniciar" no
 *      meio (recipient preso em SENDING) e recuperar: o órfão volta a PENDING e
 *      o que já foi SENT NÃO é reenviado (idempotência por destinatário, Req
 *      10.5/27.2). Drenar o restante ⇒ COMPLETED (Req 10.7).
 *   2. Varredura de agendado vencido: Scheduled_Dispatch com `scheduled_at` no
 *      passado e job em DRAFT ⇒ promovido a QUEUED (Req 13.3, 13.6, 27.4).
 *   3. Job inconsistente (QUEUED sem recipients) ⇒ FAILED + `JOB_FAILED`,
 *      sem abortar os demais (Req 27.6, 10.8).
 *
 * As RPCs de claim/recover/sweep são GLOBAIS; apenas este arquivo cria jobs e
 * usa o motor, e os `it` rodam em sequência — sem interferência cruzada. O seed
 * é uma instância dedicada (cleanup por CASCADE).
 *
 * Infra_Dependent: roda só com o branch Supabase efêmero + secrets
 * (`describeIntegration` faz skip caso contrário).
 *
 * Validates: Requirements 10.4, 10.5, 10.7, 13.3, 13.6, 27.2, 27.4, 27.6
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asService, describeIntegration } from '../_helpers/supabaseHarness';
import { cleanupTestInstance, seedTestInstance } from '../_helpers/whatsappHarness';

const HOOK_TIMEOUT = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface JobRow {
  id: string;
  status: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  failure_code: string | null;
}

interface RecipientRow {
  id: string;
  seq: number;
  status: string;
  provider_message_id: string | null;
}

/** Cria um job de disparo com N destinatários PENDING (via service_role). */
async function seedJob(
  svc: SupabaseClient,
  instanceId: string,
  opts: { status: string; recipientCount: number }
): Promise<string> {
  const { data: job, error: jobErr } = await svc
    .from('whatsapp_dispatch_jobs')
    .insert({
      instance_id: instanceId,
      kind: 'BULK',
      status: opts.status,
      distribution_mode: 'BLOCK',
      send_interval_sec: 1,
      total_count: opts.recipientCount,
    })
    .select('id')
    .single();
  if (jobErr || !job) throw new Error(`seedJob falhou: ${jobErr?.message}`);
  const jobId = (job as { id: string }).id;

  if (opts.recipientCount > 0) {
    const rows = Array.from({ length: opts.recipientCount }, (_, i) => ({
      instance_id: instanceId,
      dispatch_job_id: jobId,
      target_kind: 'CONTACT',
      phone: `551197000${String(i + 1).padStart(4, '0')}`,
      seq: i + 1,
      status: 'PENDING',
    }));
    const { error: recErr } = await svc.from('whatsapp_dispatch_recipients').insert(rows);
    if (recErr) throw new Error(`seedJob recipients falhou: ${recErr.message}`);
  }
  return jobId;
}

async function getJob(svc: SupabaseClient, jobId: string): Promise<JobRow> {
  const { data, error } = await svc
    .from('whatsapp_dispatch_jobs')
    .select('id, status, total_count, sent_count, failed_count, failure_code')
    .eq('id', jobId)
    .single();
  if (error || !data) throw new Error(`getJob falhou: ${error?.message}`);
  return data as JobRow;
}

async function getRecipient(svc: SupabaseClient, recId: string): Promise<RecipientRow> {
  const { data, error } = await svc
    .from('whatsapp_dispatch_recipients')
    .select('id, seq, status, provider_message_id')
    .eq('id', recId)
    .single();
  if (error || !data) throw new Error(`getRecipient falhou: ${error?.message}`);
  return data as RecipientRow;
}

describeIntegration('Integração 12.8 — ciclo durável do Job_Worker', () => {
  let instanceId: string;

  beforeAll(async () => {
    const inst = await seedTestInstance(asService(), 'worker', 90020);
    instanceId = inst.id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (instanceId) await cleanupTestInstance(asService(), instanceId);
  }, HOOK_TIMEOUT);

  it('claim → envia → reinicia no meio → recupera sem reenviar → COMPLETED', async () => {
    const svc = asService();
    const jobId = await seedJob(svc, instanceId, { status: 'QUEUED', recipientCount: 3 });

    // Tick: reivindica jobs elegíveis (QUEUED/RUNNING → RUNNING).
    await svc.rpc('whatsapp_claim_due_jobs', { p_limit: 50 });
    expect((await getJob(svc, jobId)).status).toBe('RUNNING');

    // Reivindica o 1º recipient (menor seq, PENDING → SENDING) e marca SENT.
    const claim1 = await svc.rpc('whatsapp_claim_next_recipient', { p_job_id: jobId });
    const rec1 = claim1.data as RecipientRow | null;
    expect(rec1).not.toBeNull();
    expect(rec1?.seq).toBe(1);
    await svc.rpc('whatsapp_worker_mark_sent', {
      p_recipient_id: rec1?.id,
      p_provider_message_id: 'EVT-1',
    });
    expect((await getRecipient(svc, rec1!.id)).status).toBe('SENT');
    expect((await getJob(svc, jobId)).sent_count).toBe(1);

    // "Reinício no meio": reivindica o 2º recipient (→ SENDING) e simula a morte
    // do tick ANTES de marcar o resultado (fica órfão em SENDING).
    const claim2 = await svc.rpc('whatsapp_claim_next_recipient', { p_job_id: jobId });
    const rec2 = claim2.data as RecipientRow | null;
    expect(rec2?.seq).toBe(2);
    expect((await getRecipient(svc, rec2!.id)).status).toBe('SENDING');

    // Espera passar a janela de stale (recover satura em >= 1s) e recupera.
    await sleep(1200);
    const recover = await svc.rpc('whatsapp_worker_recover', {
      p_stale_seconds: 1,
      p_limit: 500,
    });
    expect((recover.data as { recovered_recipients: number }).recovered_recipients).toBeGreaterThanOrEqual(1);

    // O órfão voltou a PENDING; o que já estava SENT NÃO foi tocado (sem reenvio).
    expect((await getRecipient(svc, rec2!.id)).status).toBe('PENDING');
    const rec1After = await getRecipient(svc, rec1!.id);
    expect(rec1After.status).toBe('SENT');
    expect(rec1After.provider_message_id).toBe('EVT-1');
    expect((await getJob(svc, jobId)).sent_count).toBe(1); // sem contagem dupla

    // Drena o restante: cada claim pega um PENDING (nunca o já SENT) e marca SENT.
    for (let i = 0; i < 5; i++) {
      const next = await svc.rpc('whatsapp_claim_next_recipient', { p_job_id: jobId });
      const rec = next.data as RecipientRow | null;
      if (!rec) break;
      expect(rec.id).not.toBe(rec1!.id); // o SENT jamais é reivindicado de novo
      await svc.rpc('whatsapp_worker_mark_sent', {
        p_recipient_id: rec.id,
        p_provider_message_id: `EVT-${rec.seq}`,
      });
    }

    // Finaliza o tick: sem PENDING/SENDING ⇒ COMPLETED.
    const finalize = await svc.rpc('whatsapp_worker_finalize_job', { p_job_id: jobId });
    expect((finalize.data as { status: string }).status).toBe('COMPLETED');

    const finalJob = await getJob(svc, jobId);
    expect(finalJob.status).toBe('COMPLETED');
    expect(finalJob.sent_count).toBe(3);
    expect(finalJob.total_count).toBe(3);
  });

  it('varredura promove Scheduled_Dispatch vencido (DRAFT → QUEUED)', async () => {
    const svc = asService();
    // Job em DRAFT (ainda não na fila) + agendamento vencido (scheduled_at no passado).
    const jobId = await seedJob(svc, instanceId, { status: 'DRAFT', recipientCount: 1 });
    const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: sched, error: schedErr } = await svc
      .from('whatsapp_scheduled_dispatches')
      .insert({ instance_id: instanceId, dispatch_job_id: jobId, scheduled_at: pastIso })
      .select('id')
      .single();
    if (schedErr || !sched) throw new Error(`seed scheduled falhou: ${schedErr?.message}`);
    const schedId = (sched as { id: string }).id;

    const sweep = await svc.rpc('whatsapp_worker_sweep_scheduled', { p_limit: 100 });
    expect((sweep.data as { promoted: number }).promoted).toBeGreaterThanOrEqual(1);

    // Job promovido a QUEUED e agendamento marcado como executado.
    expect((await getJob(svc, jobId)).status).toBe('QUEUED');
    const { data: schedAfter } = await svc
      .from('whatsapp_scheduled_dispatches')
      .select('executed_at')
      .eq('id', schedId)
      .single();
    expect((schedAfter as { executed_at: string | null }).executed_at).not.toBeNull();
  });

  it('job inconsistente (QUEUED sem recipients) ⇒ FAILED + JOB_FAILED', async () => {
    const svc = asService();
    const jobId = await seedJob(svc, instanceId, { status: 'QUEUED', recipientCount: 0 });

    const recover = await svc.rpc('whatsapp_worker_recover', { p_stale_seconds: 1, p_limit: 500 });
    expect((recover.data as { failed_jobs: number }).failed_jobs).toBeGreaterThanOrEqual(1);

    const job = await getJob(svc, jobId);
    expect(job.status).toBe('FAILED');
    expect(job.failure_code).toBe('JOB_FAILED');
  });
});
