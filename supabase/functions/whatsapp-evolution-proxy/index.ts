// ============================================================================
// Edge Function: whatsapp-evolution-proxy
// ============================================================================
// Spec: .kiro/specs/whatsapp-automation/{requirements,design,tasks}.md
//   Task 7.1 — Proxy autenticado de CONEXAO para a Evolution API
//              (connect / QR / status / logout) por instancia.
//   Task 7.2 — Listagem de grupos/participantes da Evolution
//              (listGroups / listParticipants) com cache em `whatsapp_groups`
//              e processamento em lotes para grupos grandes. Sao LEITURAS
//              (SETTINGS_VIEW) que exigem a Sessao da instancia CONNECTED.
//
// Responsabilidade desta function (a UNICA camada do modulo de conexao que
// toca a Evolution_Api_Key — Req 3.7 / 18.7):
//   1. Recebe POST { action, instanceId } do browser (JWT do admin via
//      supabase.functions.invoke). verify_jwt = TRUE: o gateway valida o JWT;
//      esta function AINDA reconfirma a permissao server-side (Req 1.x):
//        - connect / logout  => SETTINGS_EDIT
//        - status  / qr      => SETTINGS_VIEW
//   2. Valida que a instancia existe/esta habilitada (anti-enumeracao,
//      Req 2.8 / 30.8). Deriva o nome da instancia na Evolution de forma
//      deterministica: `frego_wa_<instance_id>` (Req 4.6 / 10.9).
//   3. Le a Evolution_Api_Key EXCLUSIVAMENTE do Vault, escopada por instancia
//      (`whatsapp_evolution_key_<instance_id>`), via service-role. A chave
//      NUNCA trafega ao browser (Req 3.7 / 18.7).
//   4. Faz o proxy da acao para a Evolution API e persiste a transicao de
//      status da Sessao (DISCONNECTED/CONNECTING/QR_PENDING/CONNECTED) em
//      `whatsapp_sessions`, conforme a maquina de estados do design
//      ("Sessao unica por instancia").
//   5. Em erro/indisponibilidade da Evolution, retorna a Canonical_Message
//      `Nao foi possivel conectar o WhatsApp.` e MANTEM a sessao DISCONNECTED
//      (Req 3.5). Todo corpo externo e tratado como DADO NAO CONFIAVEL e
//      nenhum segredo e ecoado.
//
// Contrato de requisicao (POST, JSON):
//   { "action": "connect" | "qr" | "status" | "logout", "instanceId": "<uuid>" }
//   task 7.2:
//   { "action": "listGroups", "instanceId": "<uuid>" }
//   { "action": "listParticipants", "instanceId": "<uuid>", "groupJids": ["<jid@g.us>", ...] }
//
// Contrato de resposta (JSON):
//   sucesso:  { ok: true,  status: SessionStatus, qr?: string }
//   listGroups: { ok: true, status: "CONNECTED",
//                 groups: [{ group_jid, name, participant_count, fetched_at }] }
//   listParticipants: { ok: true, status: "CONNECTED",
//                       participants: string[], failedGroups: string[] }
//   sessao nao conectada (Req 4.5):
//             { ok: false, code: "SESSION_NOT_CONNECTED",
//               message: "Conecte o WhatsApp antes de iniciar o disparo.", status: SessionStatus }
//   evolution indisponivel/erro:
//             { ok: false, code: "EVOLUTION_UNAVAILABLE",
//               message: "Nao foi possivel conectar o WhatsApp.", status: "DISCONNECTED" }
//   instancia inexistente/cruzada (anti-enumeracao):
//             { ok: false, code: "NOT_FOUND",
//               message: "Nao foi possivel concluir a operacao." }
//
// Deploy (verify_jwt = TRUE — exige JWT de admin; NAO usar --no-verify-jwt):
//   supabase functions deploy whatsapp-evolution-proxy
//
// Env vars necessarias:
//   SUPABASE_URL               (auto-injetado)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injetado) — le Vault + persiste sessao
//   SUPABASE_ANON_KEY          (auto-injetado) — reconfirma permissao via REST
//   EVOLUTION_API_URL          (opcional) — base URL da Evolution API; se
//                              ausente, cai no segredo de Vault `whatsapp_evolution_url`.
// ============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { CORS_HEADERS, handlePreflight } from '../_shared/cors.ts';

// ===================== Dominios fechados ====================================

/** Estados de sessao (espelho do dominio `session_status` da migration 092). */
type SessionStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_PENDING' | 'CONNECTED' | 'EXPIRED';

/**
 * Acoes suportadas por este proxy.
 *   - task 7.1: conexao (connect / qr / status / logout)
 *   - task 7.2: listagem de grupos/participantes (listGroups / listParticipants)
 */
type ProxyAction = 'connect' | 'qr' | 'status' | 'logout' | 'listGroups' | 'listParticipants';

const PROXY_ACTIONS: readonly ProxyAction[] = [
  'connect',
  'qr',
  'status',
  'logout',
  'listGroups',
  'listParticipants',
];

/**
 * Acoes que mutam o estado da CONEXAO => exigem SETTINGS_EDIT. As demais
 * (status / qr / listGroups / listParticipants) sao leituras => SETTINGS_VIEW.
 * Obs.: `listGroups` faz upsert no cache `whatsapp_groups`, mas e uma leitura
 * de dados da Evolution do ponto de vista do dominio (Req 12.1 / 17.1) — o
 * cache e detalhe de implementacao server-side, nao uma mutacao admin gated.
 */
const EDIT_ACTIONS: readonly ProxyAction[] = ['connect', 'logout'];

// ===================== Mensagens canonicas (pt-BR) ==========================
//
// User-facing em pt-BR; codigos em ingles (project-conventions). A mensagem de
// falha de conexao e fixa por requisito (Req 3.5).

const MSG_EVOLUTION_UNAVAILABLE = 'Nao foi possivel conectar o WhatsApp.';
const MSG_OPERATION_FAILED = 'Nao foi possivel concluir a operacao.';
// Sessao precisa estar CONNECTED para listar grupos/participantes (Req 4.5).
const MSG_NOT_CONNECTED = 'Conecte o WhatsApp antes de iniciar o disparo.';

// ===================== Env ==================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const EVOLUTION_API_URL_ENV = Deno.env.get('EVOLUTION_API_URL') ?? '';

// ===================== Helpers de I/O =======================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Resposta canonica de indisponibilidade/erro da Evolution (Req 3.5). */
function evolutionUnavailable(): Response {
  return jsonResponse(
    {
      ok: false,
      code: 'EVOLUTION_UNAVAILABLE',
      message: MSG_EVOLUTION_UNAVAILABLE,
      status: 'DISCONNECTED' as SessionStatus,
    },
    200
  );
}

/** Resposta canonica anti-enumeracao (instancia inexistente/cruzada). */
function notFound(): Response {
  return jsonResponse({ ok: false, code: 'NOT_FOUND', message: MSG_OPERATION_FAILED }, 404);
}

/**
 * Resposta canonica quando a Sessao da instancia NAO esta `CONNECTED` ao
 * tentar uma leitura que depende da conexao (listGroups / listParticipants).
 * Devolve o status corrente (best-effort) para a UI reagir (Req 4.5).
 */
function sessionNotConnected(status: SessionStatus): Response {
  return jsonResponse(
    { ok: false, code: 'SESSION_NOT_CONNECTED', message: MSG_NOT_CONNECTED, status },
    200
  );
}

function isProxyAction(v: unknown): v is ProxyAction {
  return typeof v === 'string' && (PROXY_ACTIONS as readonly string[]).includes(v);
}

/** UUID v1-v5 simples (formato), suficiente para validar `instanceId`. */
function isUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

// ===================== RBAC server-side (Req 1.x) ===========================

/**
 * Reconfirma, com o MESMO JWT do caller, que ele tem a permissao admin
 * exigida, consultando `is_admin_with_permission` via REST (gating em duas
 * camadas — admin-patterns SECTION 2/10). O gateway ja validou o JWT
 * (verify_jwt=true); aqui decidimos server-side. Qualquer falha => false
 * (deny-by-default).
 */
async function callerHasPermission(authHeader: string, action: string): Promise<boolean> {
  if (!SUPABASE_URL || !ANON_KEY) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin_with_permission`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_action: action }),
    });
    if (!resp.ok) return false;
    const allowed = await resp.json();
    return allowed === true;
  } catch {
    return false;
  }
}

// ===================== Instancia + Vault ====================================

/**
 * Carrega a instancia habilitada e o nome canonico da Evolution. Retorna
 * `null` quando a instancia nao existe ou esta desabilitada (anti-enumeracao).
 * O nome e SEMPRE derivado deterministicamente (`frego_wa_<id>`); a coluna
 * persistida e usada apenas como confirmacao/coerencia.
 */
async function loadInstance(
  sb: SupabaseClient,
  instanceId: string
): Promise<{ evolutionInstanceName: string } | null> {
  try {
    const { data, error } = await sb
      .from('whatsapp_instances')
      .select('id, enabled, evolution_instance_name')
      .eq('id', instanceId)
      .eq('enabled', true)
      .maybeSingle();
    if (error || !data) return null;
    // Derivacao deterministica (Req 4.6); a coluna so confirma.
    const derived = `frego_wa_${instanceId}`;
    const stored =
      typeof data.evolution_instance_name === 'string' && data.evolution_instance_name.length > 0
        ? data.evolution_instance_name
        : derived;
    return { evolutionInstanceName: stored || derived };
  } catch {
    return null;
  }
}

/**
 * Le a Evolution_Api_Key do Vault, escopada por instancia
 * (`whatsapp_evolution_key_<instance_id>`), via service-role. Caminho 1:
 * leitura direta de `vault.decrypted_secrets` (schema exposto). A chave NUNCA
 * e logada nem retornada ao browser. Retorna `null` quando ausente.
 */
async function readEvolutionKey(sb: SupabaseClient, instanceId: string): Promise<string | null> {
  const secretName = `whatsapp_evolution_key_${instanceId}`;
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
    // sem vault exposto / segredo ausente => null
  }
  return null;
}

/**
 * Resolve a base URL da Evolution API: env `EVOLUTION_API_URL` tem prioridade;
 * fallback no segredo global de Vault `whatsapp_evolution_url`. Sem base URL a
 * conexao e impossivel (=> indisponivel). Retorna sem barra final.
 */
async function resolveEvolutionBaseUrl(sb: SupabaseClient): Promise<string | null> {
  let base = EVOLUTION_API_URL_ENV;
  if (!base) {
    try {
      const { data } = await sb
        .schema('vault')
        .from('decrypted_secrets')
        .select('decrypted_secret')
        .eq('name', 'whatsapp_evolution_url')
        .limit(1)
        .maybeSingle();
      const secret = (data as { decrypted_secret?: unknown } | null)?.decrypted_secret;
      if (typeof secret === 'string') base = secret;
    } catch {
      // sem vault => sem base
    }
  }
  base = (base ?? '').trim();
  if (!base) return null;
  return base.replace(/\/+$/, '');
}

// ===================== Sessao (persistencia de estado) ======================

/**
 * Persiste a transicao de status da Sessao da instancia em `whatsapp_sessions`
 * (upsert por `instance_id`, respeitando UNIQUE(instance_id) — no maximo 1
 * sessao). Em `CONNECTED` limpa o QR e marca `last_connected_at`; em
 * `DISCONNECTED`/`EXPIRED` limpa o QR. `qr` so e gravado em `QR_PENDING`.
 * Falha de persistencia NAO derruba a operacao (best-effort, server-side).
 */
async function setSessionStatus(
  sb: SupabaseClient,
  instanceId: string,
  status: SessionStatus,
  qr?: string | null
): Promise<void> {
  const row: Record<string, unknown> = {
    instance_id: instanceId,
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === 'CONNECTED') {
    row.qr_code = null;
    row.last_connected_at = new Date().toISOString();
  } else if (status === 'QR_PENDING') {
    row.qr_code = typeof qr === 'string' && qr.length > 0 ? qr : null;
  } else {
    // DISCONNECTED / CONNECTING / EXPIRED => QR transitorio limpo.
    row.qr_code = null;
  }
  try {
    await sb.from('whatsapp_sessions').upsert(row, { onConflict: 'instance_id' });
  } catch {
    // best-effort: a verdade de estado e reconciliada na proxima leitura/status
  }
}

/**
 * Le o status corrente da Sessao da instancia em `whatsapp_sessions`. Usado
 * pelas leituras dependentes de conexao (listGroups / listParticipants) para
 * exigir `CONNECTED` (Req 4.5). Ausencia de linha / erro => `DISCONNECTED`.
 */
async function readSessionStatus(sb: SupabaseClient, instanceId: string): Promise<SessionStatus> {
  try {
    const { data, error } = await sb
      .from('whatsapp_sessions')
      .select('status')
      .eq('instance_id', instanceId)
      .maybeSingle();
    if (error || !data) return 'DISCONNECTED';
    const status = (data as { status?: unknown }).status;
    switch (status) {
      case 'CONNECTING':
      case 'QR_PENDING':
      case 'CONNECTED':
      case 'EXPIRED':
        return status;
      default:
        return 'DISCONNECTED';
    }
  } catch {
    return 'DISCONNECTED';
  }
}

// ===================== Cliente da Evolution API =============================

interface EvolutionResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * Chamada generica a Evolution API com a `apikey` no header. Trata QUALQUER
 * resposta como dado nao confiavel: nunca lanca por payload inesperado, apenas
 * sinaliza `ok=false` em erro de rede/timeout. A chave nunca e logada.
 */
async function evolutionFetch(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  apiKey: string
): Promise<EvolutionResult> {
  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
    });
    let data: unknown = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * Extrai o QR (data URL base64) de um payload nao confiavel da Evolution.
 * Cobre as formas comuns (`base64`, `qrcode.base64`, `qr.base64`). Retorna
 * `null` se ausente.
 */
function extractQr(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  const direct = obj.base64;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  for (const key of ['qrcode', 'qr', 'instance']) {
    const nested = obj[key];
    if (typeof nested === 'object' && nested !== null) {
      const b64 = (nested as Record<string, unknown>).base64;
      if (typeof b64 === 'string' && b64.length > 0) return b64;
    }
  }
  return null;
}

/**
 * Mapeia o `state` de connectionState da Evolution (`open`/`connecting`/
 * `close`) para o dominio `session_status`. Payload nao confiavel => trata
 * faltante como DISCONNECTED.
 */
function mapConnectionState(data: unknown): SessionStatus {
  let state: unknown;
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    const instance = obj.instance;
    if (typeof instance === 'object' && instance !== null) {
      state = (instance as Record<string, unknown>).state;
    }
    if (state === undefined) state = obj.state;
  }
  switch (state) {
    case 'open':
      return 'CONNECTED';
    case 'connecting':
      return 'CONNECTING';
    default:
      return 'DISCONNECTED';
  }
}

// ===================== Acoes do proxy =======================================

/**
 * connect (SETTINGS_EDIT): inicia a conexao na Evolution e obtem o QR. Fluxo
 * da maquina de estados: DISCONNECTED -> CONNECTING -> QR_PENDING (QR recebido)
 * ou CONNECTED (ja pareado). Em erro => Canonical_Message + DISCONNECTED.
 */
async function actionConnect(
  sb: SupabaseClient,
  instanceId: string,
  name: string,
  baseUrl: string,
  apiKey: string
): Promise<Response> {
  await setSessionStatus(sb, instanceId, 'CONNECTING');

  const res = await evolutionFetch(
    baseUrl,
    `/instance/connect/${encodeURIComponent(name)}`,
    'GET',
    apiKey
  );
  if (!res.ok) {
    await setSessionStatus(sb, instanceId, 'DISCONNECTED');
    return evolutionUnavailable();
  }

  const qr = extractQr(res.data);
  if (qr) {
    await setSessionStatus(sb, instanceId, 'QR_PENDING', qr);
    return jsonResponse({ ok: true, status: 'QR_PENDING' as SessionStatus, qr });
  }

  // Sem QR no payload: pode ja estar pareado. Confirma via connectionState.
  const mapped = mapConnectionState(res.data);
  if (mapped === 'CONNECTED') {
    await setSessionStatus(sb, instanceId, 'CONNECTED');
    return jsonResponse({ ok: true, status: 'CONNECTED' as SessionStatus });
  }

  // Nem QR nem conexao confirmada => indisponivel, mantem DISCONNECTED.
  await setSessionStatus(sb, instanceId, 'DISCONNECTED');
  return evolutionUnavailable();
}

/**
 * qr (SETTINGS_VIEW): re-obtem o QR atual (ou confirma conexao). Nao altera
 * para CONNECTING (apenas leitura do pareamento em andamento).
 */
async function actionQr(
  sb: SupabaseClient,
  instanceId: string,
  name: string,
  baseUrl: string,
  apiKey: string
): Promise<Response> {
  const res = await evolutionFetch(
    baseUrl,
    `/instance/connect/${encodeURIComponent(name)}`,
    'GET',
    apiKey
  );
  if (!res.ok) {
    await setSessionStatus(sb, instanceId, 'DISCONNECTED');
    return evolutionUnavailable();
  }

  const qr = extractQr(res.data);
  if (qr) {
    await setSessionStatus(sb, instanceId, 'QR_PENDING', qr);
    return jsonResponse({ ok: true, status: 'QR_PENDING' as SessionStatus, qr });
  }

  const mapped = mapConnectionState(res.data);
  if (mapped === 'CONNECTED') {
    await setSessionStatus(sb, instanceId, 'CONNECTED');
    return jsonResponse({ ok: true, status: 'CONNECTED' as SessionStatus });
  }

  await setSessionStatus(sb, instanceId, 'DISCONNECTED');
  return evolutionUnavailable();
}

/**
 * status (SETTINGS_VIEW): consulta o estado da conexao e persiste o mapeamento.
 */
async function actionStatus(
  sb: SupabaseClient,
  instanceId: string,
  name: string,
  baseUrl: string,
  apiKey: string
): Promise<Response> {
  const res = await evolutionFetch(
    baseUrl,
    `/instance/connectionState/${encodeURIComponent(name)}`,
    'GET',
    apiKey
  );
  if (!res.ok) {
    await setSessionStatus(sb, instanceId, 'DISCONNECTED');
    return evolutionUnavailable();
  }
  const mapped = mapConnectionState(res.data);
  await setSessionStatus(sb, instanceId, mapped);
  return jsonResponse({ ok: true, status: mapped });
}

/**
 * logout (SETTINGS_EDIT): encerra a sessao na Evolution e marca DISCONNECTED.
 * Idempotente do ponto de vista do estado local: sempre termina em
 * DISCONNECTED, mesmo que a Evolution responda erro (a sessao local nao deve
 * permanecer "conectada").
 */
async function actionLogout(
  sb: SupabaseClient,
  instanceId: string,
  name: string,
  baseUrl: string,
  apiKey: string
): Promise<Response> {
  const res = await evolutionFetch(
    baseUrl,
    `/instance/logout/${encodeURIComponent(name)}`,
    'DELETE',
    apiKey
  );
  // Independente do resultado externo, a sessao local vira DISCONNECTED.
  await setSessionStatus(sb, instanceId, 'DISCONNECTED');
  if (!res.ok) {
    return evolutionUnavailable();
  }
  return jsonResponse({ ok: true, status: 'DISCONNECTED' as SessionStatus });
}

// ============================================================================
// >>> EXTENSION POINT (task 7.2 — listagem de grupos/participantes) <<<
// ============================================================================
// Acoes de leitura (SETTINGS_VIEW) que exigem a Sessao da instancia CONNECTED:
//   - listGroups       => busca os grupos do WhatsApp conectado na Evolution,
//                         faz upsert em `whatsapp_groups` (cache; UNIQUE(
//                         instance_id, group_jid)) e retorna a lista cacheada
//                         (Req 12.1 selecao de grupos; 17.1 extracao).
//   - listParticipants => busca os participantes de 1+ group_jids, processando
//                         em LOTES para manter a memoria limitada em grupos
//                         grandes (Req 17.14), com degradacao parcial (Req
//                         17.12), retornando a lista deduplicada de telefones
//                         (consumida pelo Contact_Extractor — task 18.x).
// Toda resposta da Evolution e DADO NAO CONFIAVEL; nenhum segredo e ecoado.
// ============================================================================

/** Tamanho do lote de grupos processados por vez em `listParticipants` (Req 17.14). */
const PARTICIPANTS_BATCH_SIZE = 5;
/** Teto defensivo de group_jids aceitos numa unica chamada (memoria limitada). */
const MAX_GROUP_JIDS = 500;

/** Grupo normalizado a partir de um payload nao confiavel da Evolution. */
interface ParsedGroup {
  groupJid: string;
  name: string | null;
  participantCount: number | null;
}

/**
 * Extrai a lista de grupos de um payload nao confiavel. Cobre o formato comum
 * (array de grupos na raiz) e variacoes aninhadas (`groups`/`data`). Cada item
 * deve ter um `id` string terminando em `@g.us` (JID de grupo); itens fora do
 * formato sao ignorados (nunca lanca).
 */
function extractGroups(data: unknown): ParsedGroup[] {
  let arr: unknown = data;
  if (!Array.isArray(arr) && typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const key of ['groups', 'data', 'response']) {
      if (Array.isArray(obj[key])) {
        arr = obj[key];
        break;
      }
    }
  }
  if (!Array.isArray(arr)) return [];

  const out: ParsedGroup[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const jid = obj.id ?? obj.jid ?? obj.groupJid;
    if (typeof jid !== 'string' || !jid.endsWith('@g.us')) continue;

    const rawName = obj.subject ?? obj.name;
    const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : null;

    let participantCount: number | null = null;
    const size = obj.size ?? obj.participantsCount ?? obj.participant_count;
    if (typeof size === 'number' && Number.isFinite(size)) {
      participantCount = Math.max(0, Math.trunc(size));
    } else if (Array.isArray(obj.participants)) {
      participantCount = obj.participants.length;
    }

    out.push({ groupJid: jid, name, participantCount });
  }
  return out;
}

/**
 * Extrai os Contact_Numbers (telefones) dos participantes de um payload nao
 * confiavel da Evolution. Aceita `{ participants: [...] }` ou array direto.
 * O telefone e a parte local do JID (`<phone>@s.whatsapp.net`/`@c.us`),
 * mantendo apenas digitos. Itens fora do formato sao ignorados.
 */
function extractParticipants(data: unknown): string[] {
  let arr: unknown = data;
  if (!Array.isArray(arr) && typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const key of ['participants', 'data', 'response']) {
      if (Array.isArray(obj[key])) {
        arr = obj[key];
        break;
      }
    }
  }
  if (!Array.isArray(arr)) return [];

  const phones: string[] = [];
  for (const item of arr) {
    let jid: unknown;
    if (typeof item === 'string') {
      jid = item;
    } else if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      jid = obj.id ?? obj.jid ?? obj.number;
    }
    if (typeof jid !== 'string') continue;
    const local = jid.split('@')[0] ?? '';
    const digits = local.replace(/\D+/g, '');
    if (digits.length > 0) phones.push(digits);
  }
  return phones;
}

/**
 * Faz upsert do cache de grupos em `whatsapp_groups` (UNIQUE(instance_id,
 * group_jid)) atualizando name/participant_count/fetched_at. Best-effort por
 * grupo: falha de persistencia nao derruba a listagem.
 */
async function cacheGroups(
  sb: SupabaseClient,
  instanceId: string,
  groups: ParsedGroup[]
): Promise<void> {
  if (groups.length === 0) return;
  const fetchedAt = new Date().toISOString();
  const rows = groups.map((g) => ({
    instance_id: instanceId,
    group_jid: g.groupJid,
    name: g.name,
    participant_count: g.participantCount,
    fetched_at: fetchedAt,
    updated_at: fetchedAt,
  }));
  try {
    await sb.from('whatsapp_groups').upsert(rows, { onConflict: 'instance_id,group_jid' });
  } catch {
    // best-effort: o cache e reconciliado na proxima listagem
  }
}

/**
 * listGroups (SETTINGS_VIEW): exige Sessao `CONNECTED`. Busca os grupos da
 * instancia na Evolution, faz upsert no cache `whatsapp_groups` e retorna a
 * lista cacheada (Req 12.1 / 17.1). Evolution indisponivel => Canonical_Message.
 */
async function actionListGroups(
  sb: SupabaseClient,
  instanceId: string,
  name: string,
  baseUrl: string,
  apiKey: string
): Promise<Response> {
  const sessionStatus = await readSessionStatus(sb, instanceId);
  if (sessionStatus !== 'CONNECTED') {
    return sessionNotConnected(sessionStatus);
  }

  const res = await evolutionFetch(
    baseUrl,
    `/group/fetchAllGroups/${encodeURIComponent(name)}?getParticipants=false`,
    'GET',
    apiKey
  );
  if (!res.ok) {
    return evolutionUnavailable();
  }

  const groups = extractGroups(res.data);
  await cacheGroups(sb, instanceId, groups);

  // Retorna a lista CACHEADA (fonte de verdade do dominio) escopada a instancia.
  try {
    const { data, error } = await sb
      .from('whatsapp_groups')
      .select('group_jid, name, participant_count, fetched_at')
      .eq('instance_id', instanceId)
      .order('name', { ascending: true, nullsFirst: false });
    if (error) {
      return evolutionUnavailable();
    }
    const cached = (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        group_jid: r.group_jid,
        name: r.name ?? null,
        participant_count: typeof r.participant_count === 'number' ? r.participant_count : null,
        fetched_at: r.fetched_at ?? null,
      };
    });
    return jsonResponse({ ok: true, status: 'CONNECTED' as SessionStatus, groups: cached });
  } catch {
    return evolutionUnavailable();
  }
}

/**
 * listParticipants (SETTINGS_VIEW): exige Sessao `CONNECTED`. Busca os
 * participantes de 1+ group_jids processando em LOTES (Req 17.14) para manter a
 * memoria limitada em grupos grandes, deduplicando os telefones. Degradacao
 * parcial (Req 17.12): grupos que falham sao sinalizados em `failedGroups` sem
 * abortar; se TODOS falharem (e havia grupos) => Canonical_Message (Req 17.13).
 */
async function actionListParticipants(
  sb: SupabaseClient,
  instanceId: string,
  name: string,
  baseUrl: string,
  apiKey: string,
  groupJids: string[]
): Promise<Response> {
  const sessionStatus = await readSessionStatus(sb, instanceId);
  if (sessionStatus !== 'CONNECTED') {
    return sessionNotConnected(sessionStatus);
  }

  // Higieniza/limita os JIDs solicitados (dado vindo do browser).
  const jids = Array.from(
    new Set(groupJids.filter((j): j is string => typeof j === 'string' && j.endsWith('@g.us')))
  ).slice(0, MAX_GROUP_JIDS);

  if (jids.length === 0) {
    return jsonResponse({
      ok: true,
      status: 'CONNECTED' as SessionStatus,
      participants: [],
      failedGroups: [],
    });
  }

  // Set deduplica telefones com memoria limitada (nao acumula respostas brutas).
  const phones = new Set<string>();
  const failedGroups: string[] = [];

  // Processa em lotes sequenciais: cada lote resolve em paralelo e e descartado
  // antes do proximo (limite de concorrencia = PARTICIPANTS_BATCH_SIZE).
  for (let i = 0; i < jids.length; i += PARTICIPANTS_BATCH_SIZE) {
    const batch = jids.slice(i, i + PARTICIPANTS_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (jid) => {
        const res = await evolutionFetch(
          baseUrl,
          `/group/participants/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(jid)}`,
          'GET',
          apiKey
        );
        return { jid, res };
      })
    );
    for (const { jid, res } of results) {
      if (!res.ok) {
        failedGroups.push(jid);
        continue;
      }
      for (const phone of extractParticipants(res.data)) {
        phones.add(phone);
      }
    }
  }

  // Indisponibilidade TOTAL (todos os grupos falharam) => Canonical_Message.
  if (failedGroups.length === jids.length) {
    return evolutionUnavailable();
  }

  return jsonResponse({
    ok: true,
    status: 'CONNECTED' as SessionStatus,
    participants: Array.from(phones),
    failedGroups,
  });
}

// ===================== Handler =============================================

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  // verify_jwt=true: o gateway ja validou o JWT. Reconfirmamos a permissao
  // server-side abaixo (deny-by-default).
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED' }, 401);
  }

  // Parse + validacao do contrato { action, instanceId, groupJids? }.
  let body: { action?: unknown; instanceId?: unknown; groupJids?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, code: 'INVALID_JSON' }, 400);
  }
  const action = body.action;
  const instanceId = body.instanceId;
  if (!isProxyAction(action)) {
    return jsonResponse({ ok: false, code: 'INVALID_ACTION' }, 400);
  }
  if (!isUuid(instanceId)) {
    // instanceId malformado: trata como anti-enumeracao (nao revela formato).
    return notFound();
  }
  // `groupJids` so e relevante para listParticipants; normaliza para string[].
  const groupJids: string[] = Array.isArray(body.groupJids)
    ? body.groupJids.filter((j): j is string => typeof j === 'string')
    : [];

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, code: 'SERVER_MISCONFIGURED' }, 500);
  }

  // RBAC: connect/logout => SETTINGS_EDIT; status/qr => SETTINGS_VIEW.
  const requiredPermission = (EDIT_ACTIONS as readonly string[]).includes(action)
    ? 'SETTINGS_EDIT'
    : 'SETTINGS_VIEW';
  const permitted = await callerHasPermission(authHeader, requiredPermission);
  if (!permitted) {
    return jsonResponse({ ok: false, code: 'PERMISSION_DENIED' }, 403);
  }

  // Service-role: le Vault + persiste sessao server-side (a chave nunca vai ao
  // browser). Auth/autorizacao do caller ja foram decididas acima.
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Anti-enumeracao: instancia precisa existir e estar habilitada.
  const instance = await loadInstance(sb, instanceId);
  if (!instance) {
    return notFound();
  }
  const name = instance.evolutionInstanceName;

  // Pre-condicoes de conexao: chave por instancia + base URL da Evolution.
  // Faltando qualquer uma => indisponivel (Canonical_Message + DISCONNECTED).
  const apiKey = await readEvolutionKey(sb, instanceId);
  const baseUrl = await resolveEvolutionBaseUrl(sb);
  if (!apiKey || !baseUrl) {
    await setSessionStatus(sb, instanceId, 'DISCONNECTED');
    return evolutionUnavailable();
  }

  try {
    switch (action) {
      case 'connect':
        return await actionConnect(sb, instanceId, name, baseUrl, apiKey);
      case 'qr':
        return await actionQr(sb, instanceId, name, baseUrl, apiKey);
      case 'status':
        return await actionStatus(sb, instanceId, name, baseUrl, apiKey);
      case 'logout':
        return await actionLogout(sb, instanceId, name, baseUrl, apiKey);
      case 'listGroups':
        return await actionListGroups(sb, instanceId, name, baseUrl, apiKey);
      case 'listParticipants':
        return await actionListParticipants(sb, instanceId, name, baseUrl, apiKey, groupJids);
      default: {
        // Exaustividade: novo ProxyAction sem caso aqui quebra o type-check.
        const exhaustiveCheck: never = action;
        return jsonResponse({ ok: false, code: 'INVALID_ACTION', detail: exhaustiveCheck }, 400);
      }
    }
  } catch {
    // Falha inesperada no proxy => mantem DISCONNECTED, Canonical_Message.
    await setSessionStatus(sb, instanceId, 'DISCONNECTED');
    return evolutionUnavailable();
  }
});
