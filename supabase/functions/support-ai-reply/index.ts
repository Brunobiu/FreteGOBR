// ============================================================================
// Edge Function: support-ai-reply
// ============================================================================
// Spec: .kiro/specs/suporte-inteligente/{requirements,design,tasks}.md (Task 5).
//
// Fluxo de auto-resposta da Support_AI (a ÚNICA camada que toca a chave do
// provedor no suporte — Req 6.3):
//   1. Recebe POST { ticketId, idempotencyKey } (service-role; server-to-server).
//   2. support_claim_ai_reply (sob lock): DUPLICATE => no-op; BLOCKED
//      (modo human / IA off) => support_handoff_to_human e encerra; ALLOW => segue.
//   3. Context_Builder: support_kb_entries WHERE publication_state='publicada'
//      + histórico do atendimento (Req 6.2).
//   4. Active_Provider de assistant_config; support_model/confidence_threshold
//      de support_ai_config; chave do Vault (assistant_provider_key_<provider>).
//   5. Invoca o provider (Provider_Abstraction). Resposta estruturada
//      { answer, confidence, grounded }.
//   6. Answerable = confidence >= threshold && grounded => support_insert_ai_reply
//      (status->resolved, priority=1). Senão => support_handoff_to_human.
//   7. Degradação (Req 6.9, 12.4): provider não-implementado / falha / sem chave
//      / parsing inválido => handoff humano + log estruturado SEM segredos.
//
// Deploy: service-role apenas (server-to-server). O gatilho (trigger pg_net /
// backend) invoca esta função com Bearer SERVICE_ROLE_KEY quando o cliente
// envia mensagem em um atendimento com responder_mode='ai'.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetados).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { CORS_HEADERS, handlePreflight } from '../_shared/cors.ts';
import {
  selectProviderClient,
  pickModelForProvider,
  isValidProvider,
  DEFAULT_CLAUDE_MODEL,
  type AiProvider,
} from '../_shared/aiProvider.ts';

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

const FAQ_LIMIT = 100;
const HISTORY_LIMIT = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });

interface Payload {
  ticketId?: string;
  idempotencyKey?: string;
}

// ===================== Config (provider + model + threshold) =====================

async function readSupportConfig(
  sb: SupabaseClient
): Promise<{ provider: AiProvider; model: string; threshold: number }> {
  let provider: AiProvider = 'claude';
  let model = DEFAULT_CLAUDE_MODEL;
  let threshold = 0.7;
  try {
    const { data } = await sb.from('assistant_config').select('active_provider, model').eq('id', true).maybeSingle();
    if (isValidProvider(data?.active_provider)) provider = data?.active_provider as AiProvider;
    if (typeof data?.model === 'string' && data.model.length > 0) model = data.model;
  } catch {
    // defaults seguros
  }
  try {
    const { data } = await sb
      .from('support_ai_config')
      .select('support_model, confidence_threshold')
      .eq('id', true)
      .maybeSingle();
    if (typeof data?.support_model === 'string' && data.support_model.length > 0) model = data.support_model;
    if (typeof data?.confidence_threshold === 'number') threshold = data.confidence_threshold;
    else if (typeof data?.confidence_threshold === 'string') threshold = Number(data.confidence_threshold);
  } catch {
    // mantém threshold default
  }
  return { provider, model, threshold };
}

// ===================== Chave no Vault (server-side only) =====================

async function readProviderKeyFromVault(sb: SupabaseClient, provider: AiProvider): Promise<string | null> {
  const secretName = `assistant_provider_key_${provider}`;
  try {
    const { data, error } = await sb
      .schema('vault')
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', secretName)
      .limit(1)
      .maybeSingle();
    if (!error) {
      const secret = (data as { decrypted_secret?: unknown } | null)?.decrypted_secret;
      if (typeof secret === 'string' && secret.length > 0) return secret;
    }
  } catch {
    // fallback por RPC
  }
  try {
    const { data, error } = await sb.rpc('rpc_assistant_read_provider_key', { p_provider: provider });
    if (error) return null;
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

// ===================== Context_Builder (espelha knowledgeBase.ts) =====================

function buildSupportContext(publishedFaqs: { question: string; answer: string; category: string }[]): string {
  const header = [
    'Você é o atendimento automático do FreteGO, falando diretamente com o cliente em pt-BR.',
    'Responda à última mensagem do cliente USANDO SOMENTE a Base de Conhecimento abaixo.',
    'Se a Base não cobre a dúvida com segurança, NÃO invente: marque grounded=false.',
    '',
    'Responda EXCLUSIVAMENTE com um JSON válido, sem texto fora dele, no formato:',
    '{"answer": "<resposta em pt-BR>", "confidence": <número entre 0 e 1>, "grounded": <true|false>}',
    '',
    '## Base de Conhecimento (somente entradas publicadas)',
  ];
  const body =
    publishedFaqs.length === 0
      ? ['- (Base de Conhecimento vazia)']
      : publishedFaqs.map((f, i) => `${i + 1}. [${f.category}] P: ${f.question}\n   R: ${f.answer}`);
  return [...header, ...body].join('\n');
}

interface StructuredReply {
  answer: string;
  confidence: number;
  grounded: boolean;
}

/** Extrai { answer, confidence, grounded } do texto do modelo (tolera cercas ```json). */
function parseStructuredReply(text: string): StructuredReply | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    if (
      typeof obj.answer === 'string' &&
      typeof obj.confidence === 'number' &&
      typeof obj.grounded === 'boolean'
    ) {
      return { answer: obj.answer, confidence: obj.confidence, grounded: obj.grounded };
    }
    return null;
  } catch {
    return null;
  }
}

/** Handoff best-effort: nunca lança; degradação controlada (Req 6.9). */
async function handoff(sb: SupabaseClient, ticketId: string, reason: string): Promise<Response> {
  try {
    await sb.rpc('support_handoff_to_human', { p_ticket_id: ticketId, p_expected_updated_at: null });
  } catch (err) {
    console.warn(`[support-ai-reply] handoff failed ticket=${ticketId} detail=${err instanceof Error ? err.message : 'unknown'}`);
  }
  return json({ ok: true, decision: 'HANDOFF', reason }, 200);
}

// ===================== Handler =====================

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Server-to-server apenas: exige Bearer SERVICE_ROLE_KEY.
  const auth = req.headers.get('Authorization') ?? '';
  if (SERVICE_ROLE_KEY === '' || auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const ticketId = payload.ticketId;
  const idempotencyKey = payload.idempotencyKey;
  if (typeof ticketId !== 'string' || ticketId.length === 0) {
    return json({ error: 'ticketId ausente ou invalido' }, 400);
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return json({ error: 'idempotencyKey ausente ou invalido' }, 400);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'server_misconfigured' }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Claim idempotente + decisão sob lock.
  let decision = 'BLOCKED';
  try {
    const { data, error } = await sb.rpc('support_claim_ai_reply', {
      p_ticket_id: ticketId,
      p_idempotency_key: idempotencyKey,
    });
    if (error) return json({ ok: false, error: 'claim_failed' }, 200);
    decision = (data as { decision?: string } | null)?.decision ?? 'BLOCKED';
  } catch {
    return json({ ok: false, error: 'claim_failed' }, 200);
  }

  if (decision === 'DUPLICATE') return json({ ok: true, decision: 'DUPLICATE' }, 200);
  if (decision === 'BLOCKED') return handoff(sb, ticketId, 'blocked');

  // 2. Config (provider/model/threshold).
  const { provider, model, threshold } = await readSupportConfig(sb);

  // 3. Context_Builder: FAQ publicada + histórico do atendimento.
  let faqs: { question: string; answer: string; category: string }[] = [];
  let history: { author_kind: string; body: string }[] = [];
  try {
    const [faqRes, histRes] = await Promise.all([
      sb
        .from('support_kb_entries')
        .select('question, answer, category')
        .eq('publication_state', 'publicada')
        .order('created_at', { ascending: false })
        .limit(FAQ_LIMIT),
      sb
        .from('support_ticket_messages')
        .select('author_kind, body, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true })
        .limit(HISTORY_LIMIT),
    ]);
    faqs = Array.isArray(faqRes.data)
      ? (faqRes.data as { question: string; answer: string; category: string }[])
      : [];
    history = Array.isArray(histRes.data)
      ? (histRes.data as { author_kind: string; body: string }[])
      : [];
  } catch {
    return handoff(sb, ticketId, 'context_failed');
  }

  const context = buildSupportContext(faqs);
  const messages = history.map((m) => ({
    role: m.author_kind === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.body,
  }));
  if (messages.length === 0) return handoff(sb, ticketId, 'empty_history');

  // 4. Provider + chave do Vault.
  const client = selectProviderClient(provider, pickModelForProvider(provider, model));
  let apiKey = '';
  if (client.requiresApiKey) {
    const key = await readProviderKeyFromVault(sb, provider);
    if (!key) return handoff(sb, ticketId, 'missing_api_key');
    apiKey = key;
  }

  // 5. Invoca o provider.
  const result = await client.invoke({ context, messages }, apiKey);
  if (!result.ok) {
    console.warn(`[support-ai-reply] provider error=${result.error} provider=${result.provider} detail=${result.detail ?? 'none'}`);
    return handoff(sb, ticketId, result.error);
  }

  // 6. Parse estruturado + Answerable_Signal.
  const parsed = parseStructuredReply(result.content);
  if (!parsed) return handoff(sb, ticketId, 'parse_failed');

  const answerable = Number.isFinite(parsed.confidence) && parsed.confidence >= threshold && parsed.grounded;
  if (!answerable) return handoff(sb, ticketId, 'low_confidence');

  // 7. Insere a resposta da IA (reconfere modo='ai' sob lock => AI_LOCKED).
  try {
    const { error } = await sb.rpc('support_insert_ai_reply', {
      p_ticket_id: ticketId,
      p_body: parsed.answer,
      p_expected_updated_at: null,
    });
    if (error) {
      // Humano assumiu entre o claim e o insert (AI_LOCKED) ou outro erro:
      // não força handoff (humano já está no controle); registra e encerra.
      console.warn(`[support-ai-reply] insert blocked ticket=${ticketId} detail=${error.message ?? 'unknown'}`);
      return json({ ok: true, decision: 'SKIPPED', reason: 'insert_blocked' }, 200);
    }
  } catch {
    return handoff(sb, ticketId, 'insert_failed');
  }

  return json({ ok: true, decision: 'REPLIED' }, 200);
});
