// ============================================================================
// Edge Function: whatsapp-webhook
// ============================================================================
// Spec: .kiro/specs/whatsapp-automation/{requirements,design,tasks}.md
//   Task 16.1 — Ingestao idempotente de mensagens inbound da Evolution API.
//   Task 16.2 — Caminho de auto-reply sob lock (NAO implementado aqui; ha um
//               EXTENSION POINT preparado ao final do fluxo de ingestao).
//
// Este endpoint e chamado pela PROPRIA Evolution API (webhook externo), nao
// pelo browser nem por um Admin_User logado. Por isso:
//   * verify_jwt = FALSE (nao ha JWT de admin/supabase). Deploy:
//       supabase functions deploy whatsapp-webhook --no-verify-jwt
//   * a autenticidade e garantida validando o TOKEN configurado na Evolution
//     API (Req: design "Security Posture"): o token esperado vem do env
//     `WHATSAPP_WEBHOOK_TOKEN` ou do Vault (`whatsapp_webhook_token`). Token
//     ausente/invalido => 401, SEM efeito (nunca revela detalhe do segredo).
//   * TODO o corpo recebido e tratado como DADO NAO CONFIAVEL: parsing
//     defensivo, nenhuma suposicao de formato, nenhum segredo ecoado em
//     resposta/log.
//
// Responsabilidade desta function (APENAS ingestao — task 16.1):
//   1. Valida o token Evolution (401 se invalido).
//   2. Parseia o evento defensivamente. So processa eventos de mensagem inbound
//      (`messages.upsert`) de chats individuais; demais eventos => 200 no-op.
//   3. Resolve o `instance_id` pelo nome da instancia Evolution do payload
//      (`whatsapp_instances.evolution_instance_name`, escopo por instancia —
//      Req 16.1, 26.4). Instancia desconhecida => 200 no-op (NAO vaza se a
//      instancia existe ou nao — anti-enumeracao).
//   4. Chama a RPC `whatsapp_ingest_inbound_message` (SECURITY DEFINER, so
//      service_role) que faz, de forma atomica e idempotente:
//        - upsert da Conversation (cria em AI_MODE se nova — Req 31.3);
//        - INSERT da mensagem ON CONFLICT(instance_id, provider_event_id)
//          DO NOTHING (idempotencia por evento — Req 16.6, 31.12).
//   5. >>> EXTENSION POINT (task 16.2): com o resultado da ingestao
//      (`conversation_id`, `mode`, `inserted`) o caminho de auto-reply sob lock
//      sera plugado aqui — sem reescrever a ingestao.
//
// Contrato de resposta (JSON) — sempre 200 para eventos validos (o webhook nao
// deve re-tentar em loop por no-ops), 401 so para token invalido:
//   token invalido:            401 { ok: false, error: 'unauthorized' }
//   metodo != POST:            405 { ok: false, error: 'method_not_allowed' }
//   JSON invalido:             400 { ok: false, error: 'invalid_json' }
//   evento ignorado:           200 { ok: true, ignored: '<motivo>' }
//   mensagem nova:             200 { ok: true, inserted: true,  duplicate: false }
//   evento ja processado:      200 { ok: true, inserted: false, duplicate: true }
//
// Env vars:
//   SUPABASE_URL               (auto-injetado)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injetado) — resolve instancia + chama RPC
//   WHATSAPP_WEBHOOK_TOKEN     (opcional) — token esperado da Evolution; se
//                              ausente, cai no segredo de Vault `whatsapp_webhook_token`.
// ============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ===================== Env ==================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_TOKEN_ENV = Deno.env.get('WHATSAPP_WEBHOOK_TOKEN') ?? '';

// --- Auto-reply (task 16.2) ---------------------------------------------------
// Base URL da Evolution API para enviar a resposta automatica pela sessao da
// PROPRIA instancia (Req 16.2). Env tem prioridade; fallback no Vault global
// `whatsapp_evolution_url` (mesma convencao do whatsapp-evolution-proxy).
const EVOLUTION_API_URL_ENV = Deno.env.get('EVOLUTION_API_URL') ?? '';
// Modelo do provedor de IA (OpenAI-compativel). Configuravel por env; default
// alinhado ao restante do projeto (motorista-ai-chat usa gpt-4o-mini).
const AI_MODEL = (Deno.env.get('WHATSAPP_AI_MODEL') ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini';
// Quantas mensagens recentes da conversa enviar como historico ao provedor.
const AI_HISTORY_LIMIT = 20;

// ===================== Helpers de I/O =======================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Comparacao de strings em tempo constante (evita timing-attack na validacao do
 * token). Difere imediatamente apenas no tamanho — o segredo nunca e logado.
 */
function safeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ===================== Token esperado (env -> Vault) ========================

// Cache em memoria do token esperado (resolvido uma vez por cold start). Evita
// um roundtrip ao Vault a cada evento. `null` = ainda nao resolvido.
let cachedExpectedToken: string | null = null;

/**
 * Resolve o token esperado da Evolution: env `WHATSAPP_WEBHOOK_TOKEN` tem
 * prioridade; fallback no segredo global de Vault `whatsapp_webhook_token`
 * (lido via service-role). Retorna string vazia quando nenhum esta configurado
 * (nesse caso a validacao SEMPRE falha => 401, fail-closed). O valor nunca e
 * logado nem retornado ao chamador.
 */
async function resolveExpectedToken(sb: SupabaseClient): Promise<string> {
  if (cachedExpectedToken !== null) return cachedExpectedToken;

  let token = WEBHOOK_TOKEN_ENV.trim();
  if (!token) {
    try {
      const { data } = await sb
        .schema('vault')
        .from('decrypted_secrets')
        .select('decrypted_secret')
        .eq('name', 'whatsapp_webhook_token')
        .limit(1)
        .maybeSingle();
      const secret = (data as { decrypted_secret?: unknown } | null)?.decrypted_secret;
      if (typeof secret === 'string') token = secret.trim();
    } catch {
      // sem vault exposto / segredo ausente => token vazio (fail-closed)
    }
  }
  cachedExpectedToken = token;
  return token;
}

/**
 * Extrai o token apresentado pelo webhook. A Evolution pode enviar o segredo de
 * formas diferentes conforme a versao/config; aceitamos os portadores comuns
 * (header `apikey`, header dedicado `x-webhook-token`/`x-evolution-token`, ou
 * `Authorization: Bearer <token>`). Todo header e dado nao confiavel.
 */
function extractPresentedToken(req: Request): string {
  const apikey = req.headers.get('apikey');
  if (apikey) return apikey.trim();

  const dedicated = req.headers.get('x-webhook-token') ?? req.headers.get('x-evolution-token');
  if (dedicated) return dedicated.trim();

  const auth = req.headers.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
    return auth.trim();
  }
  return '';
}

// ===================== Parsing defensivo do payload =========================

/** Dados minimos extraidos de um evento inbound (tudo opcional/defensivo). */
interface InboundEvent {
  instanceName: string;
  contactPhone: string;
  providerEventId: string;
  body: string;
}

/**
 * Extrai o nome da instancia Evolution de um payload nao confiavel. Cobre o
 * campo comum `instance` (string) e variacoes aninhadas. Retorna '' se ausente.
 */
function extractInstanceName(payload: Record<string, unknown>): string {
  const top = payload.instance ?? payload.instanceName;
  if (typeof top === 'string' && top.length > 0) return top;
  // Algumas versoes aninham em `sender`/`instance: { instanceName }`.
  const inst = payload.instance;
  if (typeof inst === 'object' && inst !== null) {
    const nested =
      (inst as Record<string, unknown>).instanceName ?? (inst as Record<string, unknown>).name;
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  return '';
}

/**
 * Extrai o texto da mensagem de um payload nao confiavel da Evolution. Cobre as
 * formas comuns: `message.conversation` e `message.extendedTextMessage.text`.
 * Outras formas (midia sem legenda etc.) retornam '' (corpo vazio e valido —
 * a mensagem ainda e registrada por completude do historico).
 */
function extractMessageBody(data: Record<string, unknown>): string {
  const message = data.message;
  if (typeof message !== 'object' || message === null) return '';
  const obj = message as Record<string, unknown>;

  const conv = obj.conversation;
  if (typeof conv === 'string') return conv;

  const ext = obj.extendedTextMessage;
  if (typeof ext === 'object' && ext !== null) {
    const text = (ext as Record<string, unknown>).text;
    if (typeof text === 'string') return text;
  }

  // Legenda de midia (imageMessage/videoMessage/documentMessage.caption).
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const node = obj[key];
    if (typeof node === 'object' && node !== null) {
      const caption = (node as Record<string, unknown>).caption;
      if (typeof caption === 'string') return caption;
    }
  }
  return '';
}

/**
 * Normaliza um JID/numero em um Contact_Number (apenas digitos). Aceita
 * `<phone>@s.whatsapp.net` / `@c.us`. Retorna '' para JIDs de grupo (`@g.us`)
 * ou entradas sem digitos.
 */
function jidToPhone(jid: unknown): string {
  if (typeof jid !== 'string') return '';
  if (jid.endsWith('@g.us')) return ''; // grupo: fora do escopo de Conversation
  const local = jid.split('@')[0] ?? '';
  return local.replace(/\D+/g, '');
}

/**
 * Parseia um evento `messages.upsert` inbound. Retorna `null` quando o payload
 * NAO e um evento de mensagem inbound processavel (evento de outro tipo,
 * mensagem enviada por nos `fromMe`, grupo, ou faltando chave de idempotencia).
 * Nunca lanca: qualquer formato inesperado vira `null`.
 */
function parseInboundEvent(payload: Record<string, unknown>): InboundEvent | null {
  // So tratamos eventos de mensagem recebida.
  const event = typeof payload.event === 'string' ? payload.event.toLowerCase() : '';
  if (event && event !== 'messages.upsert' && event !== 'messages.update') {
    return null;
  }

  // `data` pode ser um objeto unico ou um array (lote). Pegamos o 1o objeto.
  let data: unknown = payload.data;
  if (Array.isArray(data)) data = data[0];
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  const key = d.key;
  if (typeof key !== 'object' || key === null) return null;
  const k = key as Record<string, unknown>;

  // Mensagens enviadas por nos (fromMe) nao sao inbound do cliente.
  if (k.fromMe === true) return null;

  const contactPhone = jidToPhone(k.remoteJid);
  if (!contactPhone) return null; // grupo ou JID invalido

  // provider_event_id e a chave de idempotencia (Req 16.6, 31.12). Sem ela,
  // nao ha como deduplicar => ignoramos com seguranca.
  const rawId = k.id;
  const providerEventId = typeof rawId === 'string' ? rawId.trim() : '';
  if (!providerEventId) return null;

  const instanceName = extractInstanceName(payload);
  if (!instanceName) return null;

  const body = extractMessageBody(d);

  return { instanceName, contactPhone, providerEventId, body };
}

// ===================== Resolucao de instancia ===============================

/**
 * Resolve o `instance_id` pelo nome da instancia Evolution
 * (`whatsapp_instances.evolution_instance_name`), restrito a instancias
 * habilitadas. Service-role contorna a RLS (chamada server-to-server). Retorna
 * `null` quando o nome nao corresponde a nenhuma instancia habilitada — a borda
 * trata como no-op SEM vazar a existencia/ausencia (anti-enumeracao).
 */
async function resolveInstanceId(sb: SupabaseClient, instanceName: string): Promise<string | null> {
  try {
    const { data, error } = await sb
      .from('whatsapp_instances')
      .select('id')
      .eq('evolution_instance_name', instanceName)
      .eq('enabled', true)
      .maybeSingle();
    if (error || !data) return null;
    const id = (data as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

// ===================== Auto-reply (task 16.2) ===============================
//
// Caminho de auto-resposta sob lock. Acionado SOMENTE quando a ingestao
// inseriu uma mensagem NOVA (`inserted === true`). Eventos duplicados nunca
// auto-respondem de novo — a unicidade de whatsapp_ai_replies(instance_id,
// provider_event_id) ja garante <= 1 resposta por evento (P9), reforcado pela
// decisao 'DUPLICATE' da RPC de claim.
//
// Sequencia (design "Caminho de auto-reply"):
//   1. claim sob lock (whatsapp_claim_ai_reply): reserva o evento (UNIQUE) e le
//      o Conversation_Mode com SELECT ... FOR UPDATE. Decide ALLOW/BLOCKED/
//      DUPLICATE usando o modo + IA habilitada + has_api_key da PROPRIA
//      instancia. BLOCKED/DUPLICATE ja sao terminais no banco — nada a enviar.
//   2. Em ALLOW: le a AI_Api_Key e a base/chave da Evolution do Vault (escopo
//      por instancia; segredos NUNCA logados/expostos), monta prompt+KB+
//      historico, chama o provedor de IA e envia pela sessao da instancia.
//   3. Finaliza (whatsapp_finalize_ai_reply): sucesso => SENT (persiste o
//      OUTBOUND no historico); erro do provedor ou falha de envio => sem
//      resposta entregue => AI_PROVIDER_ERROR (Req 16.4).
//
// Toda falha aqui e contida: NUNCA altera o contrato de resposta do webhook
// (sempre 200 inserted/duplicate) e nenhum segredo e ecoado/logado.

/** Le um segredo do Vault pelo nome (service-role). Retorna '' quando ausente. */
async function readVaultSecret(sb: SupabaseClient, name: string): Promise<string> {
  try {
    const { data, error } = await sb
      .schema('vault')
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', name)
      .limit(1)
      .maybeSingle();
    if (error) return '';
    const secret = (data as { decrypted_secret?: unknown } | null)?.decrypted_secret;
    return typeof secret === 'string' ? secret : '';
  } catch {
    return '';
  }
}

/**
 * Resolve a base URL da Evolution API: env `EVOLUTION_API_URL` tem prioridade;
 * fallback no segredo global de Vault `whatsapp_evolution_url`. Sem base URL o
 * envio e impossivel. Retorna sem barra final, ou '' quando ausente.
 */
async function resolveEvolutionBaseUrl(sb: SupabaseClient): Promise<string> {
  let base = EVOLUTION_API_URL_ENV.trim();
  if (!base) base = (await readVaultSecret(sb, 'whatsapp_evolution_url')).trim();
  return base ? base.replace(/\/+$/, '') : '';
}

/** Mensagem do historico mapeada para o formato do provedor. */
interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Le as ultimas mensagens da conversa (cronologico ASC) para dar contexto ao
 * provedor (Req 31.8 — continuidade com o historico preservado). INBOUND =>
 * user; OUTBOUND => assistant. Mensagens sem corpo sao ignoradas.
 */
async function readConversationHistory(
  sb: SupabaseClient,
  conversationId: string
): Promise<HistoryMessage[]> {
  try {
    const { data, error } = await sb
      .from('whatsapp_messages')
      .select('direction, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(AI_HISTORY_LIMIT);
    if (error || !Array.isArray(data)) return [];
    const rows = (data as Array<{ direction?: unknown; body?: unknown }>).slice().reverse();
    const out: HistoryMessage[] = [];
    for (const row of rows) {
      const body = typeof row.body === 'string' ? row.body : '';
      if (body.length === 0) continue;
      out.push({ role: row.direction === 'OUTBOUND' ? 'assistant' : 'user', content: body });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Monta o system prompt a partir do AI_Prompt (persona) e da Knowledge_Base da
 * instancia (Req 16.1). A KB entra como material de referencia.
 */
function buildSystemPrompt(aiPrompt: string, knowledgeBase: string): string {
  const persona = aiPrompt.trim();
  const kb = knowledgeBase.trim();
  if (!kb) return persona;
  return `${persona}\n\n--- Base de conhecimento (referencia) ---\n${kb}`;
}

/**
 * Chama o provedor de IA (OpenAI-compativel: chat/completions) com a chave da
 * PROPRIA instancia. Trata qualquer resposta como dado nao confiavel e nunca
 * loga a chave. Retorna o texto da resposta ou `null` em qualquer erro/
 * indisponibilidade (=> AI_PROVIDER_ERROR no chamador, Req 16.4).
 */
async function generateAiReply(
  systemPrompt: string,
  history: HistoryMessage[],
  apiKey: string
): Promise<string | null> {
  try {
    const messages = [{ role: 'system' as const, content: systemPrompt }, ...history];
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: 1024, temperature: 0.7 }),
    });
    if (!resp.ok) return null;
    let data: unknown = null;
    try {
      data = await resp.json();
    } catch {
      return null;
    }
    const content = (data as { choices?: Array<{ message?: { content?: unknown } }> } | null)
      ?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Envia a resposta automatica pela sessao da PROPRIA instancia via Evolution
 * (Req 16.2). Endpoint sendText. A chave da Evolution vai no header `apikey` e
 * nunca e logada. Retorna true sse o envio foi aceito.
 */
async function sendEvolutionReply(
  baseUrl: string,
  instanceName: string,
  apiKey: string,
  phone: string,
  text: string
): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number: phone, text }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Orquestra o caminho de auto-reply para uma mensagem inbound NOVA. Idempotente
 * e seguro: toda decisao e estado vivem no banco (claim/finalize sob lock);
 * falhas sao contidas e nunca alteram a resposta do webhook nem vazam segredos.
 */
async function runAutoReply(
  sb: SupabaseClient,
  instanceId: string,
  instanceName: string,
  contactPhone: string,
  providerEventId: string,
  conversationId: string
): Promise<void> {
  // 1. Claim sob lock: reserva o evento (UNIQUE) + le o modo (FOR UPDATE) e
  //    decide. BLOCKED/DUPLICATE ja sao terminais no banco.
  let claim: {
    decision?: string;
    ai_prompt?: string | null;
    knowledge_base?: string | null;
  } | null = null;
  try {
    const { data, error } = await sb.rpc('whatsapp_claim_ai_reply', {
      p_instance_id: instanceId,
      p_provider_event_id: providerEventId,
      p_conversation_id: conversationId,
    });
    if (error) {
      console.error('[whatsapp-webhook] claim failed', { code: (error as { code?: string }).code });
      return;
    }
    claim = (data ?? null) as typeof claim;
  } catch (err) {
    console.error(
      '[whatsapp-webhook] claim exception',
      err instanceof Error ? err.name : 'unknown'
    );
    return;
  }

  // So o caminho ALLOW gera/envia. BLOCKED (Req 16.5/16.7/31.5/31.11) e
  // DUPLICATE (Req 16.6/31.12) nao enviam nada.
  if (!claim || claim.decision !== 'ALLOW') return;

  // Finaliza marcando AI_PROVIDER_ERROR (sem resposta entregue). Idempotente.
  const finalizeError = async (): Promise<void> => {
    try {
      await sb.rpc('whatsapp_finalize_ai_reply', {
        p_instance_id: instanceId,
        p_provider_event_id: providerEventId,
        p_status: 'AI_PROVIDER_ERROR',
        p_reply_body: null,
      });
    } catch {
      // best-effort: a reserva permanece PENDING (nenhuma resposta enviada).
    }
  };

  // 2. Segredos da PROPRIA instancia (Vault). NUNCA logados/expostos.
  const aiKey = (await readVaultSecret(sb, `whatsapp_ai_key_${instanceId}`)).trim();
  const evoKey = (await readVaultSecret(sb, `whatsapp_evolution_key_${instanceId}`)).trim();
  const baseUrl = await resolveEvolutionBaseUrl(sb);
  // Sem chave de IA, sem chave/base da Evolution => nao ha como gerar/enviar:
  // tratamos como falha do caminho automatico (sem resposta, Req 16.4).
  if (!aiKey || !evoKey || !baseUrl) {
    await finalizeError();
    return;
  }

  // 3. Geracao: prompt (persona) + Knowledge_Base + historico da MESMA instancia.
  const systemPrompt = buildSystemPrompt(claim.ai_prompt ?? '', claim.knowledge_base ?? '');
  const history = await readConversationHistory(sb, conversationId);
  const reply = await generateAiReply(systemPrompt, history, aiKey);
  if (reply === null) {
    // Erro/indisponibilidade do provedor de IA => AI_PROVIDER_ERROR (Req 16.4).
    await finalizeError();
    return;
  }

  // 4. Envio pela sessao da instancia. Falha de envio => sem resposta entregue.
  const sent = await sendEvolutionReply(baseUrl, instanceName, evoKey, contactPhone, reply);
  if (!sent) {
    await finalizeError();
    return;
  }

  // 5. Sucesso => SENT + persiste o OUTBOUND no historico (Req 16.2).
  try {
    await sb.rpc('whatsapp_finalize_ai_reply', {
      p_instance_id: instanceId,
      p_provider_event_id: providerEventId,
      p_status: 'SENT',
      p_reply_body: reply,
    });
  } catch {
    // best-effort: a resposta ja foi enviada; a reserva permanece PENDING ate
    // uma eventual reconciliacao (nunca reenvia — UNIQUE garante).
  }
}

// ===================== Handler ==============================================

Deno.serve(async (req: Request): Promise<Response> => {
  // A Evolution entrega via POST. Outros metodos => 405 (sem efeito).
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Autenticidade: token da Evolution. Falha => 401, sem efeito. Nunca
  //    revelamos por que falhou nem ecoamos o segredo.
  const expectedToken = await resolveExpectedToken(sb);
  const presentedToken = extractPresentedToken(req);
  if (!expectedToken || !safeEq(presentedToken, expectedToken)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  // 2. Corpo: dado NAO confiavel. JSON invalido => 400.
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }
  if (typeof payload !== 'object' || payload === null) {
    return jsonResponse({ ok: true, ignored: 'empty_payload' });
  }

  // 3. Parsing defensivo: so seguimos com eventos de mensagem inbound validos.
  const evt = parseInboundEvent(payload);
  if (!evt) {
    return jsonResponse({ ok: true, ignored: 'not_inbound_message' });
  }

  // 4. Resolve a instancia pelo nome Evolution. Desconhecida => no-op silencioso
  //    (anti-enumeracao: nao revelamos se a instancia existe).
  const instanceId = await resolveInstanceId(sb, evt.instanceName);
  if (!instanceId) {
    return jsonResponse({ ok: true, ignored: 'unknown_instance' });
  }

  // 5. Ingestao idempotente via RPC SECURITY DEFINER (service_role). A RPC faz
  //    o upsert da conversa (AI_MODE se nova) e o INSERT ON CONFLICT DO NOTHING.
  let ingest: {
    inserted?: boolean;
    duplicate?: boolean;
    conversation_id?: string;
    mode?: string;
    message_id?: string | null;
  } | null = null;
  try {
    const { data, error } = await sb.rpc('whatsapp_ingest_inbound_message', {
      p_instance_id: instanceId,
      p_contact_phone: evt.contactPhone,
      p_provider_event_id: evt.providerEventId,
      p_body: evt.body,
      p_preview: null,
    });
    if (error) {
      // WHATSAPP_NOT_FOUND (instancia sumiu entre o resolve e a RPC) => no-op.
      if (typeof error.message === 'string' && error.message.includes('WHATSAPP_NOT_FOUND')) {
        return jsonResponse({ ok: true, ignored: 'unknown_instance' });
      }
      // Falha de persistencia: 200 para o webhook NAO re-tentar em loop; a
      // reconciliacao fica para o operador. Log sem segredos nem corpo bruto.
      console.error('[whatsapp-webhook] ingest failed', {
        code: (error as { code?: string }).code,
      });
      return jsonResponse({ ok: true, inserted: false, persisted: false });
    }
    ingest = (data ?? null) as typeof ingest;
  } catch (err) {
    console.error(
      '[whatsapp-webhook] ingest exception',
      err instanceof Error ? err.name : 'unknown'
    );
    return jsonResponse({ ok: true, inserted: false, persisted: false });
  }

  const inserted = ingest?.inserted === true;

  // ==========================================================================
  // >>> AUTO-REPLY (task 16.2 — caminho sob lock) <<<
  // ==========================================================================
  // So uma mensagem NOVA pode disparar auto-reply. Evento duplicado
  // (`inserted === false`) NUNCA auto-responde de novo (P9): a idempotencia ja
  // foi resolvida na ingestao e e reforcada pela unicidade de whatsapp_ai_replies.
  // A decisao real (modo AI-allowed + IA habilitada + has_api_key) e tomada sob
  // lock dentro de whatsapp_claim_ai_reply; aqui apenas orquestramos geracao/
  // envio quando a RPC autoriza. Qualquer falha e contida (nao altera a resposta
  // do webhook) e nenhum segredo e logado/exposto.
  if (
    inserted &&
    typeof ingest?.conversation_id === 'string' &&
    ingest.conversation_id.length > 0
  ) {
    await runAutoReply(
      sb,
      instanceId,
      evt.instanceName,
      evt.contactPhone,
      evt.providerEventId,
      ingest.conversation_id
    );
  }

  return jsonResponse({ ok: true, inserted, duplicate: !inserted });
});
