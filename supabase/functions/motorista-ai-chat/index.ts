// ============================================================================
// Edge Function: motorista-ai-chat
// ============================================================================
// Proxy de IA para o assistente do motorista (caminhoneiro). Recebe uma
// mensagem do motorista, monta contexto de fretes baseado na localizacao,
// e chama o provider de IA configurado (OpenAI/Claude/Gemini) para gerar
// uma resposta sobre fretes disponiveis.
//
// Deploy: supabase functions deploy motorista-ai-chat
// (verify_jwt = true — exige JWT de usuario autenticado)
//
// Env vars (auto-injetadas pelo Supabase):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS_HEADERS, handlePreflight } from '../_shared/cors.ts';
import { buildFreightContext } from './freightContext.ts';
import { buildSystemPrompt } from './systemPrompt.ts';
import { callProvider, type AiProvider } from './providers.ts';

// ===================== Env + helpers ========================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const VALID_PROVIDERS: readonly string[] = ['openai', 'claude', 'gemini', 'grok', 'llama'];

function isValidProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && VALID_PROVIDERS.includes(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ===================== Handler principal ====================================

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight CORS
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  // Apenas POST
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  try {
    // 1. Verificar JWT — extrair user do Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ ok: false, error: 'missing_auth_token' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');

    // Criar cliente com o JWT do usuario para verificar identidade
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }

    const userId = user.id;

    // 2. Parse body
    const body = await req.json();
    const conversationId: string | undefined = body?.conversationId;
    const message: string | undefined = body?.message;

    if (!conversationId || typeof conversationId !== 'string') {
      return jsonResponse({ ok: false, error: 'missing_conversation_id' }, 400);
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return jsonResponse({ ok: false, error: 'missing_message' }, 400);
    }

    // Cliente admin (service-role) para operações internas
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 3. Ler assistant_config para active_provider e model
    const { data: config } = await adminClient
      .from('assistant_config')
      .select('active_provider, model')
      .limit(1)
      .maybeSingle();

    const activeProvider: AiProvider = isValidProvider(config?.active_provider)
      ? (config.active_provider as AiProvider)
      : 'openai';

    const configModel: string =
      typeof config?.model === 'string' && config.model.length > 0 ? config.model : '';

    // 4. Build freight context
    const freightContext = await buildFreightContext({
      sb: adminClient,
      userId,
      locationOverride: body?.location ?? null,
    });

    // 5. Build system prompt
    const systemPrompt = buildSystemPrompt(freightContext);

    // 6. Ler últimas 10 mensagens da conversa para histórico
    const { data: historyRows } = await adminClient
      .from('motorista_ai_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(10);

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (historyRows && historyRows.length > 0) {
      for (const row of historyRows) {
        if (row.role === 'user' || row.role === 'assistant') {
          history.push({ role: row.role, content: row.content });
        }
      }
    }

    // Adicionar a mensagem atual ao histórico
    history.push({ role: 'user', content: message.trim() });

    // 7. Ler API key do Vault
    const secretName = `assistant_provider_key_${activeProvider}`;

    const { data: vaultData } = await adminClient
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', secretName)
      .limit(1)
      .maybeSingle();

    // Fallback: tentar via schema vault
    let apiKey: string | null = null;
    if (vaultData && typeof vaultData.decrypted_secret === 'string') {
      apiKey = vaultData.decrypted_secret;
    } else {
      // Tentar leitura via vault schema diretamente
      try {
        const { data: vaultSchemaData } = await adminClient
          .schema('vault')
          .from('decrypted_secrets')
          .select('decrypted_secret')
          .eq('name', secretName)
          .limit(1)
          .maybeSingle();

        if (vaultSchemaData && typeof vaultSchemaData.decrypted_secret === 'string') {
          apiKey = vaultSchemaData.decrypted_secret;
        }
      } catch {
        // Schema vault nao exposto — segue sem key
      }
    }

    if (!apiKey) {
      return jsonResponse({ ok: false, error: 'missing_api_key' }, 500);
    }

    // 8. Chamar provider de IA
    const result = await callProvider(
      activeProvider,
      {
        systemPrompt,
        messages: history,
        model: configModel,
      },
      apiKey
    );

    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error ?? 'provider_error' }, 502);
    }

    // 9. Retornar resposta
    return jsonResponse({
      ok: true,
      content: result.content,
      model: result.model ?? configModel,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'internal_error';
    return jsonResponse({ ok: false, error: detail }, 500);
  }
});
