/**
 * admin/assistant.ts
 *
 * Service do modulo Assistente (admin-assistant, migration 047), o
 * assistente de IA pessoal do Master_Admin em /admin/assistant. Cobre
 * as tres partes da pagina (Mural de Destaques, Chat e Configuracoes) e
 * a orquestracao server-side (captura de erros, contexto, eventos
 * criticos, provedor de IA).
 *
 * Esta e a parte 1 do arquivo (task 3.1):
 *   - Dominios fechados (tipos literais) do modulo.
 *   - Interfaces publicas de view/patch/resultado consumidas pela UI e
 *     pelos wrappers de RPC/Edge.
 *
 * As partes seguintes virao em (mesmo arquivo, append):
 *   - 3.2: validadores de dominio fechado (isValidChatRole,
 *          assertChatRole, isValidProvider, isValidErrorType,
 *          isValidThreshold, isValidCronInterval).
 *   - 3.3: helpers de segredo/config (maskApiKey, getConfigView,
 *          buildConfigAudit, computeActive).
 *   - 3.4: helpers de highlight/historico/ingestao (summarizeHighlight,
 *          sortHighlights, normalizeHistory, partitionErrorBatch).
 *   - 3.5: helpers de evento critico (buildCriticalMessage,
 *          dedupNewEvents, whatsappDispatch).
 *   - 7.1-7.2: wrappers de RPC/Edge (getConfig, updateConfig,
 *          setProviderKey, clearProviderKey, getStatus,
 *          listConversations, loadConversation, sendMessage,
 *          listHighlights).
 *
 * Padroes herdados (ver project-conventions.md e admin-patterns.md):
 *   - Audit-by-construction via executeAdminMutation (mutacoes de config,
 *     chave, toggle e envio de mensagem).
 *   - Versionamento otimista via updated_at + STALE_VERSION (update de
 *     assistant_config).
 *   - Owner_Only_Gate (SUPER_ADMIN) em UI + RPC + RLS.
 *   - Segredos apenas no Vault + Edge Function; nunca no frontend nem em
 *     colunas legiveis (apenas is_set + mascara sao expostos).
 *   - Identifiers, action codes e error codes em ingles; comentarios e
 *     textos user-facing em pt-BR.
 */

import { supabase } from '../supabase';
import { executeAdminMutation, logAdminAction } from './audit';

// ===================== Dominios fechados =====================

/**
 * Provedor externo de IA. Dominio fechado. Apenas `claude` e funcional
 * nesta entrega; os demais sao estruturais (Provider_Abstraction plugavel).
 */
export type AiProvider = 'claude' | 'gemini' | 'grok' | 'llama';

/**
 * Papel de uma mensagem de chat. Dominio fechado validado em
 * persistencia (assertChatRole rejeita papeis fora deste conjunto).
 */
export type ChatRole = 'user' | 'assistant' | 'system';

/**
 * Tipos de evento critico monitorados pelo Event_Classifier. Eventos
 * comuns (novos cadastros, fretes postados) nao pertencem a este dominio
 * e nunca disparam mensagens nem consomem creditos de IA.
 */
export type CriticalEventType =
  | 'page_error_rate'
  | 'request_failure_rate'
  | 'unauthorized_access_attempt'
  | 'failed_login_burst'
  | 'payment_failure'
  | 'db_performance_drop';

/**
 * Severidade de um evento/destaque. Dominio fechado.
 */
export type Severity = 'info' | 'warning' | 'critical';

/**
 * Tipo de erro de frontend capturado globalmente. Dominio fechado.
 *
 * NOTA: a fonte canonica deste tipo e `./errorCapture` (task 2.1). Enquanto
 * esse modulo nao existe, a definicao e replicada aqui para manter o build
 * verde. Quando errorCapture.ts estiver disponivel, substituir este bloco por:
 *   `import type { ErrorType } from './errorCapture';`
 */
export type ErrorType =
  | 'react_render'
  | 'window_error'
  | 'unhandled_rejection'
  | 'console_error'
  | 'request_failure';

// ===================== Interfaces de configuracao =====================

/**
 * Limites configuraveis (Critical_Threshold) por tipo de evento baseado
 * em contagem. Cada valor e um inteiro >= 1. Espelha as colunas
 * threshold_* de assistant_config e o ThresholdConfig do classificador.
 */
export interface AssistantThresholds {
  page_error_rate: number;
  request_failure_rate: number;
  failed_login_burst: number;
}

/**
 * Estado da chave de API de um provedor, conforme exposto ao frontend.
 * Nunca contem o valor bruto: apenas indica se a chave esta definida no
 * Vault (`isSet`) e uma mascara para exibicao (`mask`).
 */
export interface ProviderKeyState {
  isSet: boolean;
  mask: string | null;
}

/**
 * Visao de leitura da Assistant_Config retornada por getConfig().
 * Reflete assistant_config sem expor segredos: as chaves de provedor
 * aparecem apenas como ProviderKeyState (is_set + mascara). `updatedAt`
 * e usado para versionamento otimista no updateConfig.
 */
export interface AssistantConfigView {
  activeProvider: AiProvider;
  model: string;
  thresholds: AssistantThresholds;
  cronIntervalMinutes: number;
  whatsappToggle: boolean;
  providerKeys: Record<AiProvider, ProviderKeyState>;
  updatedAt: string; // ISO timestamp
}

/**
 * Patch parcial de configuracao aceito por updateConfig(). Todos os
 * campos sao opcionais; cada mutacao mapeia para uma `action` de audit
 * (ASSISTANT_CONFIG_UPDATED / ASSISTANT_WHATSAPP_TOGGLED). Thresholds
 * podem ser atualizados parcialmente.
 */
export interface ConfigPatch {
  activeProvider?: AiProvider;
  thresholds?: Partial<AssistantThresholds>;
  cronIntervalMinutes?: number;
  whatsappToggle?: boolean;
}

/**
 * Codigo canonico de falha de updateConfig. Mapeia para mensagem
 * user-facing pt-BR na UI.
 */
export type ConfigErrorCode =
  | 'PERMISSION_DENIED'
  | 'STALE_VERSION'
  | 'INVALID_THRESHOLD'
  | 'INVALID_CRON_INTERVAL'
  | 'UNKNOWN';

/**
 * Resultado de updateConfig. Em sucesso retorna o novo `updatedAt` (para
 * o proximo ciclo de versionamento otimista); em falha retorna um codigo
 * tipado (ex.: STALE_VERSION quando outro admin atualizou).
 */
export type ConfigResult = { ok: true; updatedAt: string } | { ok: false; code: ConfigErrorCode };

/**
 * Visao de status em tempo real do assistente (Assistant_Status). O
 * assistente esta `active` somente quando a chave do `activeProvider`
 * esta definida (is_set). Inclui os ultimos eventos criticos detectados.
 */
export interface AssistantStatus {
  active: boolean;
  activeProvider: AiProvider;
  model: string;
  providerKeySet: boolean; // is_set do provedor ativo
  recentCriticalEvents: CriticalEvent[];
}

// ===================== Interfaces de chat/mural =====================

/**
 * Sumario de uma Chat_Conversation (assistant_conversations), usado na
 * listagem em ordem cronologica decrescente por `updatedAt`.
 */
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mensagem persistida de uma Chat_Conversation (assistant_messages).
 * Carregada em ordem cronologica crescente por `createdAt`.
 */
export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

/**
 * Item do Highlights_Feed (Mural de Destaques), derivado de um
 * Critical_Event ou marco de conversa. Somente-leitura. Quando a conversa
 * referenciada nao existe mais, `conversationId` e null e a view nao
 * possui link de navegacao (Req 6.5).
 */
export interface Highlight {
  id: string;
  category: string; // categoria glanceavel (ex.: tipo de evento)
  summary: string;
  severity: Severity;
  timestamp: string; // ISO, origem do evento
  conversationId: string | null; // null => sem link de navegacao
}

/**
 * Evento critico persistido (assistant_critical_events). `dedupKey`
 * garante deduplicacao idempotente na janela de avaliacao; `notifiedAt`
 * marca quando a mensagem automatica foi publicada.
 */
export interface CriticalEvent {
  id: string;
  eventType: CriticalEventType;
  severity: Severity;
  summary: string;
  scope: string; // ex.: ip:1.2.3.4 ou global
  dedupKey: string;
  conversationId: string | null;
  detectedAt: string;
  notifiedAt: string | null;
}

/**
 * Razao tipada de falha de envio de mensagem ao provedor de IA. Espelha
 * os codigos de erro da AI_Edge_Function (assistant-ai).
 */
export type SendErrorReason =
  | 'provider_unavailable'
  | 'provider_call_failed'
  | 'provider_not_implemented'
  | 'missing_api_key'
  | 'permission_denied'
  | 'unknown';

/**
 * Resultado de sendMessage().
 *
 * - Sucesso: a mensagem do usuario foi persistida e o provedor respondeu.
 *   `assistantMessage` e null quando a persistencia da resposta falhou por
 *   indisponibilidade temporaria do banco (Req 5.4): a resposta ainda e
 *   entregue via `assistantContent`, sem nova tentativa automatica.
 * - Falha: o provedor retornou erro/indisponibilidade; a mensagem do
 *   usuario ja persistida e preservada em `userMessage` (Req 5.6).
 */
export type SendResult =
  | {
      ok: true;
      conversationId: string;
      userMessage: ChatMessage;
      assistantContent: string;
      assistantMessage: ChatMessage | null;
      persistedAssistant: boolean;
    }
  | {
      ok: false;
      conversationId: string | null;
      userMessage: ChatMessage | null;
      error: SendErrorReason;
    };

// ===================== Interfaces do classificador =====================

/**
 * Evento detectado pelo Event_Classifier (logica pura deterministica).
 * Fonte canonica deste tipo: reutilizado pelo modulo assistantClassifier.ts
 * (task 4.1) e pela Edge assistant-monitor. Cada evento carrega tipo no
 * dominio fechado, severidade, resumo e escopo (ex.: ip:<addr> ou global).
 */
export interface DetectedEvent {
  type: CriticalEventType;
  severity: Severity;
  summary: string;
  scope: string;
}

// ===================== Validadores de dominio fechado =====================
//
// Parte 2 do arquivo (task 3.2). Validadores puros e deterministicos dos
// dominios fechados do modulo. Sao a fonte canonica de validacao reusada
// pelos wrappers de RPC/Edge e espelham os CHECKs/validacoes server-side da
// migration 047. Alvos dos property tests CP-9, CP-13, CP-21 e CP-22.
//
// Convencao: funcoes puras, sem efeitos colaterais; type guards quando o
// retorno estreita o tipo de entrada.

/** Conjunto canonico dos papeis de chat (dominio fechado de ChatRole). */
const CHAT_ROLES = ['user', 'assistant', 'system'] as const;

/** Conjunto canonico dos provedores de IA (dominio fechado de AiProvider). */
const AI_PROVIDERS = ['claude', 'gemini', 'grok', 'llama'] as const;

/** Conjunto canonico dos tipos de erro capturado (dominio fechado de ErrorType). */
const ERROR_TYPES = [
  'react_render',
  'window_error',
  'unhandled_rejection',
  'console_error',
  'request_failure',
] as const;

/**
 * Type guard de ChatRole. Verdadeiro se e somente se `role` pertence ao
 * dominio fechado `{user, assistant, system}` (Req 5.5).
 */
export function isValidChatRole(role: string): role is ChatRole {
  return (CHAT_ROLES as readonly string[]).includes(role);
}

/**
 * Retorna o ChatRole para valores dentro do dominio fechado e LANCA para
 * qualquer valor fora dele (Req 5.5). Espelha a validacao de `role` da RPC
 * `rpc_assistant_post_message` (CHECK `role IN (...)`); papeis fora do
 * dominio nunca sao persistidos.
 */
export function assertChatRole(role: string): ChatRole {
  if (isValidChatRole(role)) {
    return role;
  }
  throw new Error(`INVALID_CHAT_ROLE: ${role}`);
}

/**
 * Type guard de AiProvider. Verdadeiro se e somente se `s` pertence ao
 * dominio fechado `{claude, gemini, grok, llama}` (Req 7.1).
 */
export function isValidProvider(s: string): s is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(s);
}

/**
 * Type guard de ErrorType. Verdadeiro se e somente se `t` pertence ao
 * dominio fechado de ErrorType (Req 3.10). Usado na particao do lote de
 * ingestao de erros (partitionErrorBatch, task 3.4).
 */
export function isValidErrorType(t: string): t is ErrorType {
  return (ERROR_TYPES as readonly string[]).includes(t);
}

/**
 * Valida um Critical_Threshold. Verdadeiro se e somente se `n` e um inteiro
 * maior ou igual a 1 (Req 10.5). Rejeita nao-numeros, NaN, Infinity, valores
 * fracionarios e inteiros < 1.
 */
export function isValidThreshold(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1;
}

/**
 * Valida o intervalo do Cron_Job em minutos. Verdadeiro se e somente se `n`
 * e um inteiro no intervalo fechado [1, 5] (Req 10.6). Espelha o CHECK
 * `cron_interval_minutes BETWEEN 1 AND 5` da migration 047.
 */
export function isValidCronInterval(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
}

// ===================== Helpers de segredo/config =====================
//
// Parte 3 do arquivo (task 3.3). Helpers puros e deterministicos de
// segredo/configuracao. Sao a fonte canonica de mascaramento e de
// montagem da view de configuracao expostas ao frontend, garantindo que
// o valor BRUTO de uma chave de API nunca vaze em saidas legiveis nem no
// audit log (Owner_Only_Gate + segredos apenas no Vault). Alvos dos
// property tests CP-11 (nao-vazamento de segredo) e CP-12 (atividade
// depende da chave).
//
// Convencao: funcoes puras, sem efeitos colaterais nem I/O. O caminho
// real de leitura/gravacao de segredo ocorre server-side (Vault + Edge),
// nunca aqui.

/** Caractere de mascara usado na exibicao de chaves (bullet U+2022). */
const MASK_BULLET = '\u2022';

/** Quantidade de caracteres finais revelados na mascara de uma chave. */
const MASK_REVEAL_TAIL = 4;

/**
 * Tamanho minimo de chave para revelar o sufixo `MASK_REVEAL_TAIL`. Chaves
 * mais curtas que isto sao mascaradas integralmente, pois revelar os
 * ultimos 4 chars de uma chave curta exporia parte relevante do segredo.
 */
const MASK_MIN_LEN_TO_REVEAL = 8;

/**
 * Representacao crua (server-side) da Assistant_Config, antes do
 * mascaramento. Inclui os valores BRUTOS das chaves por provedor apenas
 * como entrada do helper de montagem; esses brutos NUNCA aparecem na
 * AssistantConfigView resultante (apenas is_set + mascara). Provedores
 * ausentes ou com valor vazio/nulo sao tratados como sem chave definida.
 */
export interface RawAssistantConfig {
  activeProvider: AiProvider;
  model: string;
  thresholds: AssistantThresholds;
  cronIntervalMinutes: number;
  whatsappToggle: boolean;
  updatedAt: string;
  /** Valores BRUTOS por provedor (somente entrada; nunca propagados). */
  providerKeys: Partial<Record<AiProvider, string | null>>;
}

/**
 * Objeto de auditoria before/after de uma alteracao de Assistant_Config.
 * Ambos os snapshots omitem valores brutos de segredo (Req 14.5): apenas
 * campos nao sensiveis do patch sao refletidos. `before` e null quando o
 * snapshot anterior nao e fornecido.
 */
export interface ConfigAudit {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

/**
 * Mascara uma chave de API bruta para exibicao (Req 7.4, 7.5, 14.5).
 *
 * Garantias (Property 11 / CP-11):
 *   - Nunca retorna o valor bruto: `maskApiKey(raw) !== raw` para qualquer
 *     `raw` nao vazio.
 *   - Nao contem o bruto como substring para chaves de tamanho relevante:
 *     no maximo os ultimos `MASK_REVEAL_TAIL` caracteres sao revelados, e
 *     apenas quando a chave tem tamanho >= `MASK_MIN_LEN_TO_REVEAL`.
 *
 * Padrao do design: bullets + ultimos 4 chars (chaves curtas sao
 * mascaradas integralmente).
 */
export function maskApiKey(raw: string): string {
  if (raw.length === 0) {
    return '';
  }
  // Chave curta: mascara integral (nao revela nenhum caractere do bruto).
  if (raw.length < MASK_MIN_LEN_TO_REVEAL) {
    return MASK_BULLET.repeat(raw.length);
  }
  const tail = raw.slice(-MASK_REVEAL_TAIL);
  return MASK_BULLET.repeat(raw.length - MASK_REVEAL_TAIL) + tail;
}

/**
 * Deriva o ProviderKeyState (is_set + mascara) de um valor bruto de chave.
 * `isSet` e verdadeiro somente quando ha uma string nao vazia; a mascara e
 * derivada via maskApiKey e o valor bruto NUNCA e propagado.
 */
function deriveProviderKeyState(raw: string | null | undefined): ProviderKeyState {
  if (typeof raw === 'string' && raw.length > 0) {
    return { isSet: true, mask: maskApiKey(raw) };
  }
  return { isSet: false, mask: null };
}

/**
 * Monta a AssistantConfigView a partir dos dados crus da Assistant_Config
 * (Req 7.4, 7.5, 14.5). Para cada AiProvider do dominio fechado, expoe
 * apenas `is_set` + mascara; o valor bruto da chave nunca aparece na view
 * retornada (nem como campo, nem embutido na mascara para tamanhos
 * relevantes). Funcao pura: nao realiza I/O nem toca o Vault.
 */
export function getConfigView(raw: RawAssistantConfig): AssistantConfigView {
  const providerKeys = {} as Record<AiProvider, ProviderKeyState>;
  for (const provider of AI_PROVIDERS) {
    providerKeys[provider] = deriveProviderKeyState(raw.providerKeys[provider]);
  }
  return {
    activeProvider: raw.activeProvider,
    model: raw.model,
    thresholds: { ...raw.thresholds },
    cronIntervalMinutes: raw.cronIntervalMinutes,
    whatsappToggle: raw.whatsappToggle,
    providerKeys,
    updatedAt: raw.updatedAt,
  };
}

/**
 * Produz o objeto de auditoria before/after de uma alteracao de
 * Assistant_Config (Req 14.5), refletindo apenas os campos presentes no
 * `patch` e OMITINDO qualquer valor bruto de segredo. O `ConfigPatch` nao
 * carrega chaves de API (segredos seguem por setProviderKey/clearProviderKey
 * via Vault), portanto o audit resultante e inerentemente livre de segredo.
 *
 * Quando `before` e fornecido, o snapshot anterior espelha exatamente os
 * mesmos campos alterados pelo patch (e tambem nao inclui segredos). Sem
 * `before`, o snapshot anterior e null.
 */
export function buildConfigAudit(patch: ConfigPatch, before?: AssistantConfigView): ConfigAudit {
  const after: Record<string, unknown> = {};
  if (patch.activeProvider !== undefined) {
    after.activeProvider = patch.activeProvider;
  }
  if (patch.thresholds !== undefined) {
    after.thresholds = { ...patch.thresholds };
  }
  if (patch.cronIntervalMinutes !== undefined) {
    after.cronIntervalMinutes = patch.cronIntervalMinutes;
  }
  if (patch.whatsappToggle !== undefined) {
    after.whatsappToggle = patch.whatsappToggle;
  }

  let beforeSnapshot: Record<string, unknown> | null = null;
  if (before) {
    beforeSnapshot = {};
    if (patch.activeProvider !== undefined) {
      beforeSnapshot.activeProvider = before.activeProvider;
    }
    if (patch.thresholds !== undefined) {
      beforeSnapshot.thresholds = { ...before.thresholds };
    }
    if (patch.cronIntervalMinutes !== undefined) {
      beforeSnapshot.cronIntervalMinutes = before.cronIntervalMinutes;
    }
    if (patch.whatsappToggle !== undefined) {
      beforeSnapshot.whatsappToggle = before.whatsappToggle;
    }
  }

  return { before: beforeSnapshot, after };
}

/**
 * Determina se o assistente esta ativo (Req 7.7). Verdadeiro se e somente
 * se a chave do `activeProvider` esta definida (`is_set`). Sem chave para o
 * provedor ativo, o assistente e considerado inativo (Assistant_Status
 * indica inativo e a pagina orienta a configurar a chave). Funcao pura.
 */
export function computeActive(config: AssistantConfigView): boolean {
  return config.providerKeys[config.activeProvider]?.isSet === true;
}

// ===================== Helpers de highlight/historico/ingestao =====================
//
// Parte 4 do arquivo (task 3.4). Helpers puros e deterministicos que
// sustentam o Mural de Destaques (Highlights_Feed), o carregamento de
// historico do Chat e a particao do lote de ingestao de erros. Sao a fonte
// canonica reusada pelos wrappers (listHighlights/loadConversation) e
// espelham a validacao server-side da Error_Ingest_RPC. Alvos dos property
// tests CP-6 (particao por dominio), CP-7 (highlights DESC), CP-8 (derivacao
// de Highlight) e CP-10 (historico ASC).
//
// Convencao: funcoes puras, sem efeitos colaterais nem I/O. As ordenacoes
// sao totais e estaveis (empates preservam a ordem de entrada via indice),
// e nao mutam o array recebido (operam sobre copia).

/**
 * Rotulos pt-BR glanceaveis por Critical_Event_Type, usados como
 * `category` do Highlight no Mural. Fonte canonica de exibicao; mantem a
 * categoria sempre nao vazia mesmo para o tipo cru (fallback no derivador).
 */
const CRITICAL_CATEGORY_LABELS: Record<CriticalEventType, string> = {
  page_error_rate: 'Erros de pagina',
  request_failure_rate: 'Falhas de requisicao',
  unauthorized_access_attempt: 'Acesso nao autorizado',
  failed_login_burst: 'Rajada de falhas de login',
  payment_failure: 'Falha de pagamento',
  db_performance_drop: 'Queda de desempenho do banco',
};

/**
 * Timestamp de fallback (epoch UTC) usado apenas quando um Critical_Event
 * chega sem `detectedAt`/`notifiedAt` legivel. Garante que o Highlight
 * derivado sempre tenha `timestamp` nao vazio (Req 4.4) de forma pura e
 * deterministica, sem recorrer a relogio do sistema.
 */
const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z';

/**
 * Retorna o primeiro valor que, apos `trim`, e uma string nao vazia. Usado
 * para derivar campos nao vazios do Highlight a partir do Critical_Event,
 * com fallback deterministico. Retorna `null` quando nenhum candidato serve.
 */
function firstNonEmpty(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

/**
 * Item generico de um lote de ingestao de Error_Log, conforme recebido do
 * frontend (Global_Error_Capture) e validado pela Error_Ingest_RPC. O
 * unico campo exigido pela particao e `error_type`; demais campos do item
 * sao preservados intactos na saida.
 */
export interface ErrorBatchItem {
  error_type: string;
}

/**
 * Resultado da particao de um lote de ingestao (partitionErrorBatch).
 * `valid` contem os itens cujo `error_type` pertence ao dominio fechado de
 * Error_Type; `rejected` contem os demais. Sempre vale
 * `valid.length + rejected.length === total` (Property 6 / CP-6).
 */
export interface ErrorBatchPartition<T extends ErrorBatchItem> {
  valid: T[];
  rejected: T[];
}

/**
 * Deriva um Highlight (item do Mural) a partir de um Critical_Event
 * (Req 4.4, 6.5; Property 8 / CP-8).
 *
 * Garantias:
 *   - `category`, `summary`, `severity` e `timestamp` sempre nao vazios,
 *     com fallback deterministico quando o evento de origem traz campos
 *     vazios (categoria via rotulo do tipo; resumo via tipo+escopo;
 *     timestamp via detectedAt -> notifiedAt -> epoch).
 *   - Quando a conversa referenciada nao existe (`conversationId` nulo ou
 *     vazio), a view resultante nao possui link de navegacao
 *     (`conversationId === null`).
 *   - Pura e total: nunca lanca para qualquer Critical_Event.
 */
export function summarizeHighlight(ev: CriticalEvent): Highlight {
  const categoryLabel = CRITICAL_CATEGORY_LABELS[ev.eventType];
  const category = firstNonEmpty(categoryLabel, ev.eventType) ?? 'Evento critico';

  const scope = firstNonEmpty(ev.scope) ?? 'global';
  const summary = firstNonEmpty(ev.summary) ?? `${category} detectado em ${scope}`;

  const severity: Severity = ev.severity ?? 'info';

  const timestamp = firstNonEmpty(ev.detectedAt, ev.notifiedAt) ?? FALLBACK_TIMESTAMP;

  const id = firstNonEmpty(ev.id, ev.dedupKey, `${ev.eventType}:${scope}`) ?? 'highlight';

  // Conversa ausente/vazia => sem link de navegacao (Req 6.5).
  const conversationId = firstNonEmpty(ev.conversationId);

  return { id, category, summary, severity, timestamp, conversationId };
}

/**
 * Converte um timestamp em uma chave numerica de ordenacao (epoch ms).
 * Timestamps nao parseaveis recebem `Number.NEGATIVE_INFINITY`, ordenando
 * para o fim em ordem decrescente e para o inicio em crescente, de forma
 * deterministica. Mantem a ordenacao total para qualquer string.
 */
function timestampKey(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Ordena os Highlight em ordem cronologica DECRESCENTE por `timestamp`
 * (nao-crescente), produzindo uma permutacao da entrada (Req 4.1;
 * Property 7 / CP-7).
 *
 * A ordenacao e total e estavel: empates de timestamp preservam a ordem
 * original (desempate por indice). Nao muta o array recebido.
 */
export function sortHighlights(list: Highlight[]): Highlight[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = timestampKey(b.item.timestamp) - timestampKey(a.item.timestamp);
      // Desempate estavel por indice de entrada (ordem original preservada).
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * Normaliza o historico de uma Chat_Conversation em ordem cronologica
 * CRESCENTE por `createdAt` (nao-decrescente) (Req 5.7; Property 10 / CP-10).
 *
 * A ordenacao e total e estavel: empates de `createdAt` preservam a ordem
 * original (desempate por indice). Nao muta o array recebido.
 */
export function normalizeHistory(msgs: ChatMessage[]): ChatMessage[] {
  return msgs
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = timestampKey(a.item.createdAt) - timestampKey(b.item.createdAt);
      // Desempate estavel por indice de entrada (ordem original preservada).
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * Particiona um lote de itens de ingestao de Error_Log pelo dominio fechado
 * de Error_Type (Req 3.9, 3.10; Property 6 / CP-6). Itens cujo `error_type`
 * pertence ao dominio fechado vao para `valid`; os demais para `rejected`.
 *
 * Garantias:
 *   - `valid.length + rejected.length === items.length` (nenhum item perdido
 *     ou duplicado).
 *   - Nenhum item de tipo invalido aparece em `valid`.
 *   - Pura: nao muta os itens nem o array recebido.
 *
 * Espelha a validacao item-a-item da Error_Ingest_RPC
 * (rpc_assistant_ingest_errors), que rejeita o item invalido sem abortar a
 * transacao.
 */
export function partitionErrorBatch<T extends ErrorBatchItem>(items: T[]): ErrorBatchPartition<T> {
  const valid: T[] = [];
  const rejected: T[] = [];
  for (const item of items) {
    if (isValidErrorType(item.error_type)) {
      valid.push(item);
    } else {
      rejected.push(item);
    }
  }
  return { valid, rejected };
}

// ===================== Helpers de evento critico =====================
//
// Parte 5 do arquivo (task 3.5). Helpers puros e deterministicos que
// sustentam a publicacao automatica de Critical_Event pelo monitor: a
// montagem da mensagem `assistant` (o que / onde / sugestao), a deduplicacao
// idempotente por dedup_key e o seam de despacho de WhatsApp (no-op enquanto
// o toggle esta desligado). Sao a FONTE CANONICA TypeScript exercitada pelos
// property tests CP-23 (mensagem critica), CP-24 (dedup idempotente) e CP-25
// (WhatsApp no-op).
//
// DUPLICACAO INTENCIONAL: a Edge Function `assistant-monitor` (Deno) ESPELHA
// 1:1 estas tres funcoes (buildCriticalMessage / dedupNewEvents /
// whatsappDispatch) junto de CRITICAL_CATEGORY_LABELS e CRITICAL_SUGGESTIONS.
// Como as Edge Functions rodam em Deno e os testes em Node, para evitar um
// passo de build cross-runtime a especificacao deterministica e copiada nos
// dois lados; qualquer mudanca na regra deve ser refletida em ambos.
//
// Convencao: funcoes puras, sem efeitos colaterais nem I/O. O monitor apenas
// SUGERE correcoes — NUNCA aplica remediacao automatica (Req 12.4).

/**
 * Sugestao de correcao (apenas ORIENTACAO; NUNCA remediacao automatica —
 * Req 12.4) por Critical_Event_Type. Texto pt-BR, deterministico. Espelha o
 * CRITICAL_SUGGESTIONS da Edge `assistant-monitor`; mantem os dois lados em
 * sincronia.
 */
const CRITICAL_SUGGESTIONS: Record<CriticalEventType, string> = {
  page_error_rate:
    'Investigue os Error_Log recentes (boundary/window/console) na rota afetada e priorize a correcao do erro de maior recorrencia.',
  request_failure_rate:
    'Verifique a saude das APIs/RPCs e a conectividade do Supabase; analise os request_failure recentes para identificar o endpoint problematico.',
  unauthorized_access_attempt:
    'Revise os logs de acesso e as policies/guards das rotas protegidas; confirme se houve tentativa de bypass de autorizacao.',
  failed_login_burst:
    'Avalie bloquear temporariamente o IP de origem e reforcar o rate limiting; confirme se nao e um ataque de brute force.',
  payment_failure:
    'Verifique a integracao de pagamento e os repasses recentes; reconcilie as transacoes com falha antes de novas cobrancas.',
  db_performance_drop:
    'Inspecione queries lentas, locks e uso de conexoes; considere indices ausentes e a carga atual do banco.',
};

/**
 * Monta a mensagem automatica `assistant` de um Critical_Event (Req 12.4;
 * Property 23 / CP-23).
 *
 * Garantias:
 *   - PURA e SEM remediacao: descreve O QUE aconteceu (resumo/categoria),
 *     ONDE ocorreu (`scope`) e uma SUGESTAO de correcao (apenas orientacao).
 *     Nunca aplica nem executa qualquer correcao.
 *   - Todos os tres componentes (o que / onde / sugestao) sempre presentes,
 *     com fallback deterministico quando o evento traz campos vazios.
 *
 * Espelho de `buildCriticalMessage` da Edge `assistant-monitor`.
 */
export function buildCriticalMessage(event: DetectedEvent): string {
  const category = CRITICAL_CATEGORY_LABELS[event.type] ?? 'Evento critico';
  const scope = event.scope && event.scope.trim().length > 0 ? event.scope : 'global';
  const summary =
    event.summary && event.summary.trim().length > 0
      ? event.summary
      : `${category} detectado em ${scope}`;
  const suggestion =
    CRITICAL_SUGGESTIONS[event.type] ?? 'Investigue o evento e avalie a correcao adequada.';

  return [
    `[${category}] Evento critico detectado.`,
    `O que aconteceu: ${summary}`,
    `Onde: ${scope}`,
    `Sugestao: ${suggestion}`,
  ].join('\n');
}

/**
 * Item de um lote de eventos detectados, emparelhado com sua `dedupKey`
 * estavel (formato `type:scope:timeBucket`, construida server-side pelo
 * monitor). E a unidade de deduplicacao consumida por dedupNewEvents.
 */
export interface DedupCandidate {
  event: DetectedEvent;
  dedupKey: string;
}

/**
 * Filtra os eventos ainda NAO notificados, comparando `dedupKey` contra o
 * conjunto ja conhecido (Req 12.7; Property 24 / CP-24).
 *
 * Garantias:
 *   - Nunca retorna um item cuja `dedupKey` ja esteja em `already`.
 *   - Deduplica colisoes DENTRO do proprio lote (a primeira ocorrencia de
 *     cada `dedupKey` e mantida; as repetidas sao descartadas).
 *   - Idempotente: `dedupNewEvents(already, dedupNewEvents(already, batch))`
 *     produz o mesmo resultado de `dedupNewEvents(already, batch)`.
 *   - Pura: nao muta `already` nem `batch` (opera sobre copia do Set).
 *
 * Espelho de `dedupNewEvents` da Edge `assistant-monitor`.
 */
export function dedupNewEvents(already: Set<string>, batch: DedupCandidate[]): DedupCandidate[] {
  const seen = new Set<string>(already);
  const result: DedupCandidate[] = [];
  for (const item of batch) {
    if (!seen.has(item.dedupKey)) {
      seen.add(item.dedupKey);
      result.push(item);
    }
  }
  return result;
}

/**
 * Resultado tipado de um despacho de WhatsApp. Nesta entrega o canal e
 * sempre no-op: `sent` e sempre false e `reason` indica o motivo
 * (`toggle_off` quando desligado; `not_implemented` quando ligado, pois o
 * canal real — Evolution API — ainda nao existe).
 */
export type WhatsappDispatchResult = { sent: false; reason: 'toggle_off' | 'not_implemented' };

/**
 * WhatsApp_Dispatcher (seam) — NO-OP enquanto o toggle esta desligado
 * (Req 13.3/13.4; Property 25 / CP-25).
 *
 * Esta entrega NUNCA envia nada:
 *   - `whatsappToggle === false` => `{ sent: false, reason: 'toggle_off' }`
 *     (nenhum envio ocorre, nenhum efeito colateral).
 *   - `whatsappToggle === true`  => `{ sent: false, reason: 'not_implemented' }`
 *     (o canal real, Evolution API — Req 13.6, ainda nao esta implementado).
 *
 * O seam fica pronto para a spec futura conectar o envio real sem alterar o
 * fluxo de deteccao. Espelho de `whatsappDispatch` da Edge `assistant-monitor`.
 * Pura: o `event` nao e tocado nesta entrega (no-op).
 */
export function whatsappDispatch(
  _event: DetectedEvent,
  opts: { whatsappToggle: boolean }
): WhatsappDispatchResult {
  if (!opts.whatsappToggle) {
    return { sent: false, reason: 'toggle_off' };
  }
  // TODO(spec futura Evolution API — Req 13.6): conectar o envio real aqui.
  // Nenhum envio ocorre nesta entrega.
  return { sent: false, reason: 'not_implemented' };
}

// ===================== Wrappers de RPC/Edge =====================
//
// Partes 7.1 (config/segredo/status) e 7.2 (chat/mural) do arquivo. Camada
// fina que envolve as RPCs `SECURITY DEFINER` da migration 047 e a Edge
// Function `assistant-ai`, mapeando os contratos JSON snake_case do banco
// para as interfaces camelCase consumidas pela UI. Reusa os helpers puros
// definidos acima (getConfigView shape, normalizeHistory, summarizeHighlight,
// sortHighlights, isValidThreshold, isValidCronInterval, isValidChatRole) e os
// padroes herdados (executeAdminMutation, versionamento otimista STALE_VERSION).
//
// Segredos: o valor BRUTO de uma chave NUNCA transita por estes wrappers em
// saidas legiveis nem no audit (apenas is_set + mascara/last4). A leitura do
// segredo decriptado ocorre exclusivamente server-side (Edge + Vault).

// --------------------- Helpers de coercao de leitura ---------------------

/** Coerce defensivo para string (vazia quando ausente/nao-string). */
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** Coerce defensivo para inteiro >= 1, com fallback quando invalido. */
function asThreshold(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fallback;
}

/** Coerce defensivo de role do DB; fallback 'system' para nunca lancar em leitura. */
function toChatRole(r: unknown): ChatRole {
  return typeof r === 'string' && isValidChatRole(r) ? r : 'system';
}

/** Coerce defensivo de AiProvider; fallback 'claude' quando fora do dominio. */
function toProvider(p: unknown): AiProvider {
  return typeof p === 'string' && isValidProvider(p) ? p : 'claude';
}

/** Coerce defensivo de Severity; fallback 'info' quando fora do dominio. */
function toSeverity(s: unknown): Severity {
  return s === 'info' || s === 'warning' || s === 'critical' ? s : 'info';
}

/**
 * Mapeia o JSON snake_case de rpc_assistant_get_config para AssistantConfigView
 * (mesma forma produzida por getConfigView). Cada provedor do dominio fechado
 * recebe is_set + mascara; o valor bruto nunca aparece (a RPC ja entrega
 * apenas is_set + mask derivados do Vault).
 */
function mapConfigView(raw: unknown): AssistantConfigView {
  const r = (raw ?? {}) as Record<string, unknown>;
  const thr = (r.thresholds ?? {}) as Record<string, unknown>;
  const rawKeys = (r.provider_keys ?? {}) as Record<string, unknown>;

  const providerKeys = {} as Record<AiProvider, ProviderKeyState>;
  for (const provider of AI_PROVIDERS) {
    const entry = (rawKeys[provider] ?? {}) as { is_set?: unknown; mask?: unknown };
    providerKeys[provider] = {
      isSet: entry.is_set === true,
      mask: typeof entry.mask === 'string' ? entry.mask : null,
    };
  }

  return {
    activeProvider: toProvider(r.active_provider),
    model: asString(r.model, 'claude-3-5-sonnet-latest'),
    thresholds: {
      page_error_rate: asThreshold(thr.page_error_rate, 10),
      request_failure_rate: asThreshold(thr.request_failure_rate, 10),
      failed_login_burst: asThreshold(thr.failed_login_burst, 5),
    },
    cronIntervalMinutes: asThreshold(r.cron_interval_minutes, 1),
    whatsappToggle: r.whatsapp_toggle === true,
    providerKeys,
    updatedAt: asString(r.updated_at),
  };
}

/** Mapeia uma linha de critical event (snake_case) para CriticalEvent. */
function mapCriticalEvent(raw: unknown): CriticalEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: asString(r.id),
    eventType: (typeof r.event_type === 'string'
      ? r.event_type
      : 'page_error_rate') as CriticalEventType,
    severity: toSeverity(r.severity),
    summary: asString(r.summary),
    scope: asString(r.scope, 'global'),
    dedupKey: asString(r.dedup_key),
    conversationId: typeof r.conversation_id === 'string' ? r.conversation_id : null,
    detectedAt: asString(r.detected_at),
    notifiedAt: typeof r.notified_at === 'string' ? r.notified_at : null,
  };
}

/** Mapeia o JSON snake_case de rpc_assistant_get_status para AssistantStatus. */
function mapStatus(raw: unknown): AssistantStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const recent = Array.isArray(r.recent_critical_events) ? r.recent_critical_events : [];
  return {
    active: r.active === true,
    activeProvider: toProvider(r.active_provider),
    model: asString(r.model, 'claude-3-5-sonnet-latest'),
    providerKeySet: r.provider_key_set === true,
    recentCriticalEvents: recent.map(mapCriticalEvent),
  };
}

/** Mapeia uma linha de assistant_messages (snake_case) para ChatMessage. */
function mapChatMessage(raw: unknown): ChatMessage {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: asString(r.id),
    conversationId: asString(r.conversation_id),
    role: toChatRole(r.role),
    content: asString(r.content),
    createdAt: asString(r.created_at),
  };
}

/** Mapeia uma linha de assistant_conversations (snake_case) para ConversationSummary. */
function mapConversationSummary(raw: unknown): ConversationSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: asString(r.id),
    title: asString(r.title, 'Conversa'),
    createdAt: asString(r.created_at),
    updatedAt: asString(r.updated_at),
  };
}

/**
 * Mapeia um erro de rpc_assistant_update_config para o ConfigErrorCode tipado.
 * STALE_VERSION (versionamento otimista) e o caso central; provedor/threshold/
 * cron invalidos sao defesa adicional (a pre-validacao TS ja barra a maioria).
 */
function mapConfigErrorCode(err: unknown): ConfigErrorCode {
  const e = (err ?? {}) as { code?: string; message?: string };
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = typeof e.message === 'string' ? e.message : '';
  if (code === '42501' || msg.toLowerCase().includes('permission_denied')) {
    return 'PERMISSION_DENIED';
  }
  if (msg.includes('STALE_VERSION')) return 'STALE_VERSION';
  if (msg.includes('INVALID_THRESHOLD')) return 'INVALID_THRESHOLD';
  if (msg.includes('INVALID_CRON_INTERVAL')) return 'INVALID_CRON_INTERVAL';
  return 'UNKNOWN';
}

/** Mapeia uma falha de persistencia da mensagem do usuario para SendErrorReason. */
function mapUserPersistError(err: unknown): SendErrorReason {
  const e = (err ?? {}) as { code?: string; message?: string };
  const msg = (typeof e.message === 'string' ? e.message : '').toLowerCase();
  if (e.code === '42501' || msg.includes('permission_denied')) return 'permission_denied';
  return 'unknown';
}

/** Mapeia o `error` tipado da Edge assistant-ai para SendErrorReason. */
function mapProviderErrorReason(s: unknown): SendErrorReason {
  switch (s) {
    case 'provider_not_implemented':
      return 'provider_not_implemented';
    case 'provider_call_failed':
      return 'provider_call_failed';
    case 'missing_api_key':
      return 'missing_api_key';
    case 'permission_denied':
      return 'permission_denied';
    default:
      return 'unknown';
  }
}

// --------------------- 7.1 Config / segredo / status ---------------------

/**
 * Le a Assistant_Config (Req 7.4, 7.6) via rpc_assistant_get_config e mapeia o
 * contrato JSON snake_case para AssistantConfigView. Cada provedor aparece
 * apenas como is_set + mascara; o valor bruto da chave nunca e retornado
 * (lido apenas server-side pela Edge a partir do Vault). Lanca em falha da RPC
 * (a Assistant_Page isola a falha por secao via Promise.allSettled).
 */
export async function getConfig(): Promise<AssistantConfigView> {
  const { data, error } = await supabase.rpc('rpc_assistant_get_config');
  if (error) throw error;
  return mapConfigView(data);
}

/**
 * Aplica um patch parcial a Assistant_Config (Req 7.2, 10.4, 13.5) com
 * versionamento otimista (`expectedUpdatedAt`).
 *
 * - Pre-valida thresholds (inteiro >= 1, isValidThreshold) e cron (1..5,
 *   isValidCronInterval) ANTES de qualquer efeito; invalido => resultado
 *   tipado, sem chamar a RPC.
 * - Envolve a RPC via executeAdminMutation (audit-by-construction). A `action`
 *   e ASSISTANT_WHATSAPP_TOGGLED quando o patch e exclusivamente o toggle de
 *   WhatsApp; caso contrario ASSISTANT_CONFIG_UPDATED. before/after omitem
 *   valores brutos de segredo (buildConfigAudit; o patch sequer carrega chaves).
 * - STALE_VERSION (outro admin atualizou) => { ok: false, code: 'STALE_VERSION' }.
 */
export async function updateConfig(
  patch: ConfigPatch,
  expectedUpdatedAt: string
): Promise<ConfigResult> {
  // Pre-validacao de thresholds (cada valor presente deve ser inteiro >= 1).
  if (patch.thresholds) {
    for (const value of Object.values(patch.thresholds)) {
      if (value !== undefined && !isValidThreshold(value)) {
        return { ok: false, code: 'INVALID_THRESHOLD' };
      }
    }
  }
  // Pre-validacao do intervalo do cron (inteiro 1..5).
  if (patch.cronIntervalMinutes !== undefined && !isValidCronInterval(patch.cronIntervalMinutes)) {
    return { ok: false, code: 'INVALID_CRON_INTERVAL' };
  }

  // Patch exclusivamente de toggle de WhatsApp => action dedicada (Req 13.5).
  const isWhatsappOnly =
    patch.whatsappToggle !== undefined &&
    patch.activeProvider === undefined &&
    patch.thresholds === undefined &&
    patch.cronIntervalMinutes === undefined;
  const action = isWhatsappOnly ? 'ASSISTANT_WHATSAPP_TOGGLED' : 'ASSISTANT_CONFIG_UPDATED';
  const audit = buildConfigAudit(patch);

  try {
    const updatedAt = await executeAdminMutation(
      {
        action,
        targetType: 'assistant_config',
        targetId: 'singleton',
        before: audit.before,
        after: audit.after,
      },
      async () => {
        const { data, error } = await supabase.rpc('rpc_assistant_update_config', {
          p_patch: patch,
          p_expected_updated_at: expectedUpdatedAt,
        });
        if (error) throw error;
        const row = (data ?? {}) as { updated_at?: unknown };
        return asString(row.updated_at);
      }
    );
    return { ok: true, updatedAt };
  } catch (err) {
    return { ok: false, code: mapConfigErrorCode(err) };
  }
}

/**
 * Grava (cria/atualiza) a chave de API de um provedor no Vault (Req 7.3, 14.6)
 * via rpc_assistant_set_secret. O valor bruto NUNCA e auditado: o snapshot
 * `after` registra apenas is_set + os ultimos 4 caracteres (apenas para chaves
 * com tamanho relevante; chaves curtas nao revelam nada). Audit
 * ASSISTANT_PROVIDER_KEY_UPDATED via executeAdminMutation.
 */
export async function setProviderKey(provider: AiProvider, rawKey: string): Promise<{ ok: true }> {
  // last4 apenas para chaves longas o suficiente (mesma politica de maskApiKey).
  const last4 = rawKey.length >= MASK_MIN_LEN_TO_REVEAL ? rawKey.slice(-MASK_REVEAL_TAIL) : null;
  await executeAdminMutation(
    {
      action: 'ASSISTANT_PROVIDER_KEY_UPDATED',
      targetType: 'assistant_config',
      targetId: provider,
      // NUNCA o valor bruto: apenas metadados nao sensiveis (Req 14.6).
      after: { provider, is_set: true, last4 },
    },
    async () => {
      const { error } = await supabase.rpc('rpc_assistant_set_secret', {
        p_provider: provider,
        p_raw: rawKey,
      });
      if (error) throw error;
    }
  );
  return { ok: true };
}

/**
 * Apaga a chave de API de um provedor do Vault (Req 7.3, 14.6) via
 * rpc_assistant_clear_secret (idempotente). Audit ASSISTANT_PROVIDER_KEY_CLEARED
 * via executeAdminMutation; nenhum valor bruto transita.
 */
export async function clearProviderKey(provider: AiProvider): Promise<{ ok: true }> {
  await executeAdminMutation(
    {
      action: 'ASSISTANT_PROVIDER_KEY_CLEARED',
      targetType: 'assistant_config',
      targetId: provider,
      after: { provider, is_set: false },
    },
    async () => {
      const { error } = await supabase.rpc('rpc_assistant_clear_secret', {
        p_provider: provider,
      });
      if (error) throw error;
    }
  );
  return { ok: true };
}

/**
 * Le o Assistant_Status em tempo real (Req 7.6, 7.7) via rpc_assistant_get_status
 * e mapeia para AssistantStatus: ativo/inativo (derivado de is_set do provedor
 * ativo), provedor + modelo e ultimos Critical_Event detectados. Lanca em falha
 * da RPC (a pagina isola a falha por secao).
 */
export async function getStatus(): Promise<AssistantStatus> {
  const { data, error } = await supabase.rpc('rpc_assistant_get_status');
  if (error) throw error;
  return mapStatus(data);
}

// --------------------- 7.2 Chat / mural ---------------------

/**
 * Lista os sumarios de Chat_Conversation (Req 6.1) via
 * rpc_assistant_list_conversations, ja em ordem DESC por updated_at (a RPC
 * ordena server-side). Lanca em falha da RPC.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc('rpc_assistant_list_conversations');
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows.map(mapConversationSummary);
}

/**
 * Carrega o historico de uma Chat_Conversation (Req 5.7) via
 * rpc_assistant_load_conversation e normaliza em ordem cronologica CRESCENTE
 * por createdAt (normalizeHistory) — defesa adicional ao ORDER BY ASC da RPC.
 * Lanca em falha da RPC.
 */
export async function loadConversation(id: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase.rpc('rpc_assistant_load_conversation', { p_id: id });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return normalizeHistory(rows.map(mapChatMessage));
}

/**
 * Envia uma mensagem do usuario ao assistente (Req 5.1, 5.3, 5.4, 5.6, 5.8).
 *
 * Fluxo:
 *   1. Persiste a Chat_Message `user` via rpc_assistant_post_message (cria a
 *      conversa quando `conversationId` e nulo). Falha aqui => SendResult de
 *      falha com userMessage nulo (nada mais e tentado).
 *   2. Registra ASSISTANT_MESSAGE_SENT no audit SEM conteudo bruto de PII
 *      (apenas conversationId, messageId e tamanho do texto — Req 5.8).
 *   3. Invoca a Edge `assistant-ai` (Context_Builder + provedor). Erro de
 *      transporte ou `{ ok: false }` do provedor => SendResult de falha
 *      PRESERVANDO a mensagem do usuario ja persistida (Req 5.6); a conversa
 *      em curso nao e perdida.
 *   4. Em sucesso, persiste a resposta `assistant` em BEST-EFFORT (Req 5.4):
 *      se a persistencia falhar (indisponibilidade temporaria do banco), a
 *      resposta ainda e entregue via `assistantContent` com
 *      `persistedAssistant: false`, SEM nova tentativa automatica.
 */
export async function sendMessage(
  conversationId: string | null,
  text: string
): Promise<SendResult> {
  // 1. Persiste a mensagem do usuario (cria a conversa se necessario).
  let userMessage: ChatMessage;
  let convId: string;
  try {
    const { data, error } = await supabase.rpc('rpc_assistant_post_message', {
      p_conversation_id: conversationId,
      p_role: 'user',
      p_content: text,
    });
    if (error) throw error;
    userMessage = mapChatMessage(data);
    convId = userMessage.conversationId;
  } catch (err) {
    return { ok: false, conversationId, userMessage: null, error: mapUserPersistError(err) };
  }

  // 2. Audit ASSISTANT_MESSAGE_SENT sem PII bruta (Req 5.8).
  await logAdminAction({
    action: 'ASSISTANT_MESSAGE_SENT',
    targetType: 'assistant_conversations',
    targetId: convId,
    after: { conversationId: convId, messageId: userMessage.id, contentLength: text.length },
  });

  // 3. Invoca a Edge assistant-ai (provedor via Context_Builder server-side).
  let assistantContent: string;
  try {
    const { data, error } = await supabase.functions.invoke('assistant-ai', {
      body: { conversationId: convId, userMessage: text },
    });
    if (error) {
      // Indisponibilidade de transporte/Edge: preserva a mensagem do usuario.
      return { ok: false, conversationId: convId, userMessage, error: 'provider_unavailable' };
    }
    const res = (data ?? {}) as { ok?: unknown; content?: unknown; error?: unknown };
    if (res.ok !== true || typeof res.content !== 'string') {
      return {
        ok: false,
        conversationId: convId,
        userMessage,
        error: mapProviderErrorReason(res.error),
      };
    }
    assistantContent = res.content;
  } catch {
    return { ok: false, conversationId: convId, userMessage, error: 'provider_unavailable' };
  }

  // 4. Persiste a resposta `assistant` em best-effort, sem retry (Req 5.4).
  let assistantMessage: ChatMessage | null = null;
  let persistedAssistant = false;
  try {
    const { data, error } = await supabase.rpc('rpc_assistant_post_message', {
      p_conversation_id: convId,
      p_role: 'assistant',
      p_content: assistantContent,
    });
    if (!error && data) {
      assistantMessage = mapChatMessage(data);
      persistedAssistant = true;
    }
  } catch {
    // Best-effort: indisponibilidade temporaria do banco nao perde a resposta
    // (entregue via assistantContent) nem dispara nova tentativa (Req 5.4).
  }

  return {
    ok: true,
    conversationId: convId,
    userMessage,
    assistantContent,
    assistantMessage,
    persistedAssistant,
  };
}

/**
 * Deriva os Highlight do Mural (Req 4.1) a partir dos ultimos Critical_Event
 * expostos por rpc_assistant_get_status (nao ha tabela propria de highlights;
 * o Mural e read-time sobre os eventos criticos). Cada evento vira um Highlight
 * via summarizeHighlight e a lista e ordenada DESC por timestamp via
 * sortHighlights. Lanca em falha da RPC subjacente.
 */
export async function listHighlights(): Promise<Highlight[]> {
  const status = await getStatus();
  const highlights = status.recentCriticalEvents.map(summarizeHighlight);
  return sortHighlights(highlights);
}
