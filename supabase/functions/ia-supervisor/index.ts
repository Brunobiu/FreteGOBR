// ============================================================================
// Edge Function: ia-supervisor
// ============================================================================
// Spec: .kiro/specs/admin-ia-supervisora/{requirements,design,tasks}.md (Task 6).
//
// Painel Inteligente (Supervisor_Chat) — READ-ONLY. Fluxo:
//   1. Recebe POST { question, intents } com o JWT do admin (frontend via
//      supabase.functions.invoke). Gating SUPERVISOR_VIEW pelo CONTEXTO DO CALLER.
//   2. supervisor_chat_context(intents) (RPC gated) => agregados NÃO sensíveis
//      (sem PII). É a fonte do contexto enviado ao provider.
//   3. Active_Provider/model de assistant_config; chave do Vault (service-role,
//      nunca no frontend). Provider_Abstraction (_shared/aiProvider.ts).
//   4. Invoca o provider com system pt-BR (read-only) + contexto JSON + pergunta.
//      Falha/sem-provider => degradação controlada { answer:'IA indisponível...',
//      degraded:true } (NUNCA 500 por falta de IA).
//   5. Loga SUPERVISOR_CHAT_QUERY (metadados: intents/degraded — SEM o texto cru
//      da pergunta, que pode conter PII).
//
// A IA NUNCA executa ação de negócio nem recebe PII (o contexto é só agregado).
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injetados).
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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const UNAVAILABLE = 'IA indisponível no momento. Tente novamente em instantes.';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });

interface Payload {
  question?: string;
  intents?: string[];
}

// ── Config (provider + model), via service-role ──
async function readProviderConfig(
  sb: SupabaseClient
): Promise<{ provider: AiProvider; model: string }> {
  let provider: AiProvider = 'claude';
  let model = DEFAULT_CLAUDE_MODEL;
  try {
    const { data } = await sb
      .from('assistant_config')
      .select('active_provider, model')
      .eq('id', true)
      .maybeSingle();
    if (isValidProvider(data?.active_provider)) provider = data?.active_provider as AiProvider;
    if (typeof data?.model === 'string' && data.model.length > 0) model = data.model;
  } catch {
    // defaults seguros
  }
  return { provider, model };
}

// ── Chave no Vault (server-side only) ──
async function readProviderKeyFromVault(
  sb: SupabaseClient,
  provider: AiProvider
): Promise<string | null> {
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

const SYSTEM_PROMPT = [
  'Você é a IA Supervisora do FreteGO: uma assistente interna READ-ONLY que ajuda',
  'o administrador a entender a saúde e a operação do sistema.',
  'Responda à pergunta do administrador em pt-BR, de forma clara e objetiva,',
  'USANDO SOMENTE os dados do Contexto (agregados) abaixo. NUNCA invente números.',
  'Se o Contexto não tiver a informação, diga que não há dado disponível no momento.',
  'Você NÃO executa ações: apenas observa, responde e, quando útil, sugere uma ação',
  'para o administrador decidir.',
].join(' ');

// ── Log best-effort de SUPERVISOR_CHAT_QUERY (metadados, sem o texto cru) ──
async function logQuery(
  sbUser: SupabaseClient,
  meta: { intents: string[]; degraded: boolean }
): Promise<void> {
  try {
    await sbUser.rpc('log_admin_action', {
      p_action: 'SUPERVISOR_CHAT_QUERY',
      p_target_type: null,
      p_target_id: null,
      p_before: null,
      p_after: { intents: meta.intents, degraded: meta.degraded },
      p_ip: null,
      p_user_agent: null,
    });
  } catch {
    // best-effort — não bloqueia a resposta
  }
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ answer: UNAVAILABLE, degraded: true }, 200);
  }

  // Exige o JWT do admin (frontend). Sem auth => 401.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const question = typeof payload.question === 'string' ? payload.question.trim() : '';
  const intents = Array.isArray(payload.intents)
    ? payload.intents.filter((i): i is string => typeof i === 'string')
    : [];
  if (!question) return json({ error: 'question ausente' }, 400);

  // Cliente no CONTEXTO DO CALLER (RLS + is_admin_with_permission por auth.uid()).
  const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // 1. Gating + contexto agregado (sem PII). Falha de permissão => 403.
  let context: unknown;
  try {
    const { data, error } = await sbUser.rpc('supervisor_chat_context', {
      p_intents: intents.length ? intents : null,
    });
    if (error) {
      const code = `${(error as { code?: string }).code ?? ''}${(error as { message?: string }).message ?? ''}`;
      if (code.includes('42501') || code.includes('permission_denied')) {
        return json({ error: 'permission_denied' }, 403);
      }
      // outras falhas: degrada (mas sem contexto a IA não responde bem)
      return json({ answer: UNAVAILABLE, degraded: true }, 200);
    }
    context = data;
  } catch {
    return json({ answer: UNAVAILABLE, degraded: true }, 200);
  }

  // 2. Provider + chave (service-role; chave nunca no frontend).
  const sbService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { provider, model } = await readProviderConfig(sbService);
  const client = selectProviderClient(provider, pickModelForProvider(provider, model));

  let apiKey = '';
  if (client.requiresApiKey) {
    const key = await readProviderKeyFromVault(sbService, provider);
    if (!key) {
      await logQuery(sbUser, { intents, degraded: true });
      return json({ answer: UNAVAILABLE, degraded: true }, 200);
    }
    apiKey = key;
  }

  // 3. Invoca o provider (contexto = agregados, sem PII).
  const ctxText = `## Contexto (agregados do sistema, sem dados pessoais)\n${JSON.stringify(context)}`;
  const result = await client.invoke(
    { context: `${SYSTEM_PROMPT}\n\n${ctxText}`, messages: [{ role: 'user', content: question }] },
    apiKey
  );

  if (!result.ok) {
    console.warn(`[ia-supervisor] provider error=${result.error} provider=${result.provider}`);
    await logQuery(sbUser, { intents, degraded: true });
    return json({ answer: UNAVAILABLE, degraded: true }, 200);
  }

  const answer = result.content.trim() || UNAVAILABLE;
  await logQuery(sbUser, { intents, degraded: false });
  return json({ answer, degraded: false }, 200);
});
