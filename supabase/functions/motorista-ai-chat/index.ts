// ============================================================================
// Edge Function: motorista-ai-chat
// ============================================================================
// Proxy de IA para o assistente do motorista. Recebe uma mensagem, monta o
// contexto de fretes (via RPC motorista_ai_freight_context que extrai coords
// do PostGIS), calcula lucratividade e chama o provider de IA configurado.
//
// Tudo consolidado neste arquivo (sem imports relativos) por causa do
// bundler do deploy. Provider key lida do Vault server-side.
// ============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

type AiProvider = 'openai' | 'claude' | 'gemini' | 'grok' | 'llama';
interface AiProviderInput {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model: string;
}
interface AiProviderResult {
  ok: boolean;
  content?: string;
  model?: string;
  error?: string;
}
interface FreightContextItem {
  id: string;
  origin: string;
  destination: string;
  distanceKm: number;
  distanceToOriginKm: number | null;
  value: number;
  lucroLiquido: number | null;
  lucroPorKm: number | null;
  product: string | null;
  weight: number | null;
}
interface FreightContextResult {
  items: FreightContextItem[];
  calcIncomplete: boolean;
  locationAvailable: boolean;
  radiusUsedKm: number;
  expandedSearch: boolean;
}

interface RpcFrete {
  id: string;
  origin: string | null;
  destination: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  distance_km: number | null;
  value: number | null;
  product: string | null;
  weight: number | null;
}

interface ProviderTextBlock {
  type?: string;
  text?: string;
}

const DEFAULT_RADIUS_KM = 200;
const EXPANDED_RADIUS_KM = 500;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// deno-lint-ignore no-explicit-any
async function buildFreightContext(
  sb: SupabaseClient,
  userId: string,
  locationOverride: { lat: number; lng: number } | null,
  radiusKm: number | null
): Promise<FreightContextResult> {
  const { data, error } = await sb.rpc('motorista_ai_freight_context', { p_user_id: userId });
  const defaultRadius = radiusKm ?? DEFAULT_RADIUS_KM;
  if (error || !data) {
    return {
      items: [],
      calcIncomplete: true,
      locationAvailable: false,
      radiusUsedKm: defaultRadius,
      expandedSearch: false,
    };
  }

  const motorista = data.motorista ?? null;
  const fretes: RpcFrete[] = Array.isArray(data.fretes) ? data.fretes : [];
  const lat: number | null = locationOverride?.lat ?? motorista?.lat ?? null;
  const lng: number | null = locationOverride?.lng ?? motorista?.lng ?? null;
  const locationAvailable = lat !== null && lng !== null;
  const kmPerLiter = motorista?.km_per_liter ?? null;
  const dieselPrice = motorista?.diesel_price ?? null;
  const calcIncomplete = kmPerLiter === null || dieselPrice === null;

  if (fretes.length === 0) {
    return {
      items: [],
      calcIncomplete,
      locationAvailable,
      radiusUsedKm: defaultRadius,
      expandedSearch: false,
    };
  }

  let radiusUsedKm = defaultRadius;
  let expandedSearch = false;
  let filtered = fretes;
  if (locationAvailable && lat !== null && lng !== null) {
    filtered = fretes.filter(
      (f: RpcFrete) =>
        f.origin_lat != null &&
        f.origin_lng != null &&
        haversineKm(lat, lng, f.origin_lat, f.origin_lng) <= defaultRadius
    );
    if (filtered.length === 0) {
      radiusUsedKm = EXPANDED_RADIUS_KM;
      expandedSearch = true;
      filtered = fretes.filter(
        (f: RpcFrete) =>
          f.origin_lat != null &&
          f.origin_lng != null &&
          haversineKm(lat, lng, f.origin_lat, f.origin_lng) <= EXPANDED_RADIUS_KM
      );
    }
  }

  const items: FreightContextItem[] = filtered.map((f: RpcFrete) => {
    let distanceToOriginKm: number | null = null;
    if (
      locationAvailable &&
      lat !== null &&
      lng !== null &&
      f.origin_lat != null &&
      f.origin_lng != null
    ) {
      distanceToOriginKm = Math.round(haversineKm(lat, lng, f.origin_lat, f.origin_lng));
    }
    let distanceKm: number = f.distance_km ?? 0;
    if (
      !distanceKm &&
      f.origin_lat != null &&
      f.origin_lng != null &&
      f.destination_lat != null &&
      f.destination_lng != null
    ) {
      distanceKm = Math.round(
        haversineKm(f.origin_lat, f.origin_lng, f.destination_lat, f.destination_lng)
      );
    }
    let lucroLiquido: number | null = null;
    let lucroPorKm: number | null = null;
    const value = f.value ?? 0;
    if (!calcIncomplete && distanceKm > 0 && kmPerLiter !== null && dieselPrice !== null) {
      const custoDiesel = (distanceKm / kmPerLiter) * dieselPrice;
      lucroLiquido = Math.round((value - custoDiesel) * 100) / 100;
      lucroPorKm = Math.round((lucroLiquido / distanceKm) * 100) / 100;
    }
    return {
      id: f.id,
      origin: f.origin ?? '',
      destination: f.destination ?? '',
      distanceKm,
      distanceToOriginKm,
      value,
      lucroLiquido,
      lucroPorKm,
      product: f.product ?? null,
      weight: f.weight ?? null,
    };
  });

  items.sort((a, b) => {
    if (a.lucroPorKm === null && b.lucroPorKm === null) return 0;
    if (a.lucroPorKm === null) return 1;
    if (b.lucroPorKm === null) return -1;
    return b.lucroPorKm - a.lucroPorKm;
  });

  return {
    items: items.slice(0, 20),
    calcIncomplete,
    locationAvailable,
    radiusUsedKm,
    expandedSearch,
  };
}

function buildSystemPrompt(ctx: FreightContextResult): string {
  const sections: string[] = [];
  sections.push(`Voce e o FreteGO IA, assistente virtual para motoristas de carga (caminhoneiros).
Responda SEMPRE em pt-BR. Use linguagem amigavel, direta e profissional.

## Suas regras:
- Voce so pode falar sobre fretes disponiveis, rotas, rentabilidade e assuntos de transporte de carga.
- Se perguntarem outro assunto, redirecione: "Sou especialista em fretes! Posso te ajudar a achar uma carga boa pra sua regiao. Pra onde voce quer ir?"
- Mostre NO MAXIMO 2 a 3 fretes por resposta. Nunca despeje todos.
- Seja PROATIVO: sugira fretes, pergunte "Esse te interessa?", "Pra qual regiao quer ir?".
- Se mencionar cidade/regiao de DESTINO, priorize fretes para aquela area. Se ORIGEM, priorize fretes daquela area.
- Sempre mostre: origem -> destino, distancia (km), valor (R$), lucro estimado (quando disponivel).
- Se nao houver lucro estimado, peca para configurar o perfil (km/litro e diesel).
- Use emojis com moderacao.`);
  if (!ctx.locationAvailable)
    sections.push(
      `\n## Localizacao indisponivel\nSem localizacao registrada. Sugira atualizar no app.`
    );
  if (ctx.expandedSearch)
    sections.push(
      `\n## Busca expandida\nNada no raio padrao; expandi para ${ctx.radiusUsedKm}km. Avise de forma natural.`
    );
  if (ctx.calcIncomplete)
    sections.push(
      `\n## Perfil incompleto\nSem km/litro e/ou diesel. Avise educadamente que precisa configurar pra ver lucro.`
    );
  if (ctx.items.length === 0) {
    sections.push(
      `\n## Fretes disponiveis\nNenhum frete ativo no raio (${ctx.radiusUsedKm}km). Informe e sugira ampliar ou voltar depois.`
    );
  } else {
    const lines = ctx.items.map((f, i) => {
      const p: string[] = [];
      p.push(`${i + 1}. [${f.id}]`);
      p.push(`   ${f.origin} -> ${f.destination}`);
      p.push(`   Dist: ${f.distanceKm}km | Valor: R$${f.value.toFixed(2)}`);
      if (f.distanceToOriginKm !== null) p.push(`   Dist ate origem: ${f.distanceToOriginKm}km`);
      if (f.lucroLiquido !== null)
        p.push(`   Lucro: R$${f.lucroLiquido.toFixed(2)} | R$${(f.lucroPorKm ?? 0).toFixed(2)}/km`);
      if (f.product) p.push(`   Produto: ${f.product}`);
      if (f.weight !== null) p.push(`   Peso: ${f.weight}t`);
      return p.join('\n');
    });
    sections.push(
      `\n## Fretes disponiveis (${ctx.items.length} no raio de ${ctx.radiusUsedKm}km)\nMostre apenas 2-3 por vez. Priorize maior lucro/km. Apresente conversacional, NAO copie este formato.\n\n${lines.join('\n\n')}`
    );
  }
  return sections.join('\n');
}

async function callOpenAI(input: AiProviderInput, apiKey: string): Promise<AiProviderResult> {
  try {
    const model = input.model || 'gpt-4o-mini';
    const messages = [{ role: 'system' as const, content: input.systemPrompt }, ...input.messages];
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: 1024, temperature: 0.7 }),
    });
    if (!r.ok) return { ok: false, error: `openai_http_${r.status}` };
    const d = await r.json();
    const content = d?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { ok: false, error: 'openai_unexpected_response' };
    return { ok: true, content, model: d?.model ?? model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'openai_unknown_error' };
  }
}

async function callClaude(input: AiProviderInput, apiKey: string): Promise<AiProviderResult> {
  try {
    const model = input.model || 'claude-3-5-sonnet-latest';
    const messages = input.messages.map((m) => ({ role: m.role, content: m.content }));
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 1024, system: input.systemPrompt, messages }),
    });
    if (!r.ok) return { ok: false, error: `claude_http_${r.status}` };
    const d = await r.json();
    const blocks = d?.content;
    if (!Array.isArray(blocks)) return { ok: false, error: 'claude_unexpected_response' };
    // deno-lint-ignore no-explicit-any
    const content = blocks
      .filter((b: ProviderTextBlock) => b.type === 'text')
      .map((b: ProviderTextBlock) => b.text ?? '')
      .join('');
    if (!content) return { ok: false, error: 'claude_unexpected_response' };
    return { ok: true, content, model: d?.model ?? model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'claude_unknown_error' };
  }
}

async function callGemini(input: AiProviderInput, apiKey: string): Promise<AiProviderResult> {
  try {
    const model = input.model || 'gemini-pro';
    const contents = input.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        generationConfig: { maxOutputTokens: 1024 },
      }),
    });
    if (!r.ok) return { ok: false, error: `gemini_http_${r.status}` };
    const d = await r.json();
    const parts = d?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return { ok: false, error: 'gemini_unexpected_response' };
    // deno-lint-ignore no-explicit-any
    const content = parts
      .filter((p: ProviderTextBlock) => typeof p.text === 'string')
      .map((p: ProviderTextBlock) => p.text ?? '')
      .join('');
    if (!content) return { ok: false, error: 'gemini_unexpected_response' };
    return { ok: true, content, model: d?.modelVersion ?? model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'gemini_unknown_error' };
  }
}

async function callProvider(
  provider: AiProvider,
  input: AiProviderInput,
  apiKey: string
): Promise<AiProviderResult> {
  switch (provider) {
    case 'openai':
      return callOpenAI(input, apiKey);
    case 'claude':
      return callClaude(input, apiKey);
    case 'gemini':
      return callGemini(input, apiKey);
    default:
      return { ok: false, error: 'provider_not_implemented' };
  }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VALID_PROVIDERS = ['openai', 'claude', 'gemini', 'grok', 'llama'];

function isValidProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && VALID_PROVIDERS.includes(v);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return jsonResponse({ ok: false, error: 'missing_auth_token' }, 401);
    const token = authHeader.replace('Bearer ', '');

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token);
    if (authError || !user) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    const userId = user.id;

    const body = await req.json();
    const conversationId = body?.conversationId;
    const message = body?.message;
    if (!conversationId || typeof conversationId !== 'string')
      return jsonResponse({ ok: false, error: 'missing_conversation_id' }, 400);
    if (!message || typeof message !== 'string' || message.trim().length === 0)
      return jsonResponse({ ok: false, error: 'missing_message' }, 400);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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

    const freightContext = await buildFreightContext(
      adminClient,
      userId,
      body?.location ?? null,
      body?.radiusKm ?? null
    );
    const systemPrompt = buildSystemPrompt(freightContext);

    const { data: historyRows } = await adminClient
      .from('motorista_ai_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(10);
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (historyRows) {
      for (const row of historyRows) {
        if (row.role === 'user' || row.role === 'assistant')
          history.push({ role: row.role, content: row.content });
      }
    }
    history.push({ role: 'user', content: message.trim() });

    const secretName = `assistant_provider_key_${activeProvider}`;
    let apiKey: string | null = null;
    try {
      const { data: keyData } = await adminClient.rpc('rpc_assistant_read_provider_key', {
        p_provider: activeProvider,
      });
      if (typeof keyData === 'string' && keyData.length > 0) apiKey = keyData;
    } catch {
      /* fallback */
    }
    if (!apiKey) {
      try {
        const { data: vaultData } = await adminClient
          .schema('vault')
          .from('decrypted_secrets')
          .select('decrypted_secret')
          .eq('name', secretName)
          .limit(1)
          .maybeSingle();
        if (vaultData && typeof vaultData.decrypted_secret === 'string')
          apiKey = vaultData.decrypted_secret;
      } catch {
        /* sem vault */
      }
    }
    if (!apiKey) return jsonResponse({ ok: false, error: 'missing_api_key' }, 500);

    const result = await callProvider(
      activeProvider,
      { systemPrompt, messages: history, model: configModel },
      apiKey
    );
    if (!result.ok)
      return jsonResponse({ ok: false, error: result.error ?? 'provider_error' }, 502);

    return jsonResponse({ ok: true, content: result.content, model: result.model ?? configModel });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'internal_error';
    return jsonResponse({ ok: false, error: detail }, 500);
  }
});
