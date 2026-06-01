/**
 * errorCapture.ts
 *
 * Global_Error_Capture (pilar transversal do modulo Assistente).
 *
 * Este arquivo entrega o NUCLEO da captura global de erros do frontend:
 *  - Tipos do dominio fechado (ErrorType) e formatos de draft/config.
 *  - buildErrorDraft(): normaliza qualquer entrada num Error_Log draft seguro,
 *    sem falhar quando nao ha sessao (affectedUserId nulo).
 *  - captureError(): enfileira o draft com cap anti-flood (maxQueue), nunca
 *    lança à aplicação e respeita um guard global de reentrancia para impedir
 *    laços de recursao (Req 3.8).
 *
 * O cabeamento completo (task 2.2, neste mesmo modulo):
 *  - installGlobalErrorCapture(): instala o AppErrorBoundary (componente .tsx
 *    separado, ver nota abaixo), os handlers de window (error /
 *    unhandledrejection), o intercept de console.error e o wrapper de
 *    window.fetch, alem de iniciar o flush por timer. Retorna um teardown que
 *    remove TODOS os handlers/wrappers e limpa o timer.
 *  - ingestErrorLogs(): envia um lote para a Error_Ingest_RPC
 *    (rpc_assistant_ingest_errors) usando o client unico do projeto.
 *
 * Nota sobre o AppErrorBoundary: como este arquivo e .ts (sem JSX), o
 * componente React fica em `src/components/admin/assistant/AppErrorBoundary.tsx`
 * (superset de `src/components/ErrorBoundary.tsx`) e chama captureError aqui em
 * componentDidCatch. Mantemos a fronteira de captura centralizada neste modulo.
 *
 * Modulo singleton (estado em memoria). Funcoes puras onde possivel para
 * facilitar testes de propriedade (CP-3/CP-4/CP-5).
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */

import { supabase } from '../supabase';

/** Dominio fechado do tipo de erro capturado (espelha CHECK em error_logs). */
export type ErrorType =
  | 'react_render'
  | 'window_error'
  | 'unhandled_rejection'
  | 'console_error'
  | 'request_failure';

/** Conjunto canonico dos ErrorType validos, usado para validacao de dominio. */
export const ERROR_TYPES: readonly ErrorType[] = [
  'react_render',
  'window_error',
  'unhandled_rejection',
  'console_error',
  'request_failure',
] as const;

/** Error_Log normalizado, pronto para envio em lote. */
export interface ErrorLogDraft {
  errorType: ErrorType;
  route: string; // location.pathname no momento da captura
  message: string;
  stack: string | null;
  affectedUserId: string | null; // null quando nao ha sessao
  occurredAt: string; // timestamp ISO
}

/** Entrada bruta aceita por buildErrorDraft. Campos opcionais sao normalizados. */
export interface ErrorDraftInput {
  errorType: ErrorType;
  message?: string | null;
  stack?: string | null;
  route?: string | null;
  affectedUserId?: string | null;
  occurredAt?: string | Date | null;
}

/** Parametros anti-flood do pipeline de captura. */
export interface CaptureConfig {
  maxBatchSize: number; // tamanho maximo de cada lote enviado, ex.: 20
  flushIntervalMs: number; // intervalo minimo entre flushes, ex.: 5000
  maxQueue: number; // cap rigido da fila em memoria, ex.: 200
}

/** Configuracao padrao (valores de referencia do design). */
export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  maxBatchSize: 20,
  flushIntervalMs: 5000,
  maxQueue: 200,
};

/** Chave global do guard de reentrancia (impede laço de recursao na captura). */
const REENTRANT_KEY = '__assistantCaptureReentrant';

// --- Estado do singleton (em memoria) ---------------------------------------

/** Configuracao ativa; mesclada com defaults em installGlobalErrorCapture. */
let config: CaptureConfig = { ...DEFAULT_CAPTURE_CONFIG };

/** Fila de drafts pendentes de envio. Drenada pelo flush (task 2.2). */
const queue: ErrorLogDraft[] = [];

// --- Guard de reentrancia ----------------------------------------------------

/** Verdadeiro se ja estamos dentro do caminho de captura/envio. */
function isReentrant(): boolean {
  return (globalThis as Record<string, unknown>)[REENTRANT_KEY] === true;
}

/** Define o estado do guard de reentrancia global. */
function setReentrant(value: boolean): void {
  (globalThis as Record<string, unknown>)[REENTRANT_KEY] = value;
}

// --- Normalizadores puros (alvo do CP-3) ------------------------------------

/** Le location.pathname de forma segura (ambiente sem window retorna ''). */
function readPathname(): string {
  try {
    const loc = (globalThis as { location?: { pathname?: unknown } }).location;
    if (loc && typeof loc.pathname === 'string') return loc.pathname;
  } catch {
    // Ambiente sem DOM ou acesso bloqueado: cai no fallback.
  }
  return '';
}

/** Garante uma rota string; usa a entrada quando fornecida, senao deriva. */
function normalizeRoute(route?: string | null): string {
  return typeof route === 'string' ? route : readPathname();
}

/** Garante uma mensagem string (entrada ausente vira string vazia). */
function normalizeMessage(message?: string | null): string {
  return typeof message === 'string' ? message : '';
}

/** stack: string quando fornecida, senao null. */
function normalizeStack(stack?: string | null): string | null {
  return typeof stack === 'string' ? stack : null;
}

/** affectedUserId: string quando ha sessao, senao null (nunca falha). */
function normalizeUserId(userId?: string | null): string | null {
  return typeof userId === 'string' ? userId : null;
}

/** Resolve occurredAt sempre como timestamp ISO valido, sem nunca lançar. */
function resolveOccurredAt(value?: string | Date | null): string {
  try {
    if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) return value.toISOString();
    } else if (typeof value === 'string' && value.length > 0) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  } catch {
    // Valor invalido: cai no fallback de "agora".
  }
  return new Date().toISOString();
}

/**
 * Produz um Error_Log draft normalizado a partir de uma entrada bruta.
 *
 * Garante: occurredAt ISO, errorType no dominio fechado, route string,
 * stack string|null e affectedUserId string|null. Nao falha quando nao ha
 * sessao (affectedUserId vira null). Funcao pura (Req 3.5, 3.6).
 */
export function buildErrorDraft(input: ErrorDraftInput): ErrorLogDraft {
  return {
    errorType: input.errorType,
    route: normalizeRoute(input.route),
    message: normalizeMessage(input.message),
    stack: normalizeStack(input.stack),
    affectedUserId: normalizeUserId(input.affectedUserId),
    occurredAt: resolveOccurredAt(input.occurredAt),
  };
}

// --- Fila e captura ----------------------------------------------------------

/** Enfileira respeitando o cap; excedente e descartado em silencio. */
function enqueue(draft: ErrorLogDraft): void {
  // Cap rigido anti-flood: a fila nunca retem mais que maxQueue itens.
  // Excedente e descartado silenciosamente (Req 3.7).
  if (queue.length >= config.maxQueue) return;
  queue.push(draft);
}

/**
 * Enfileira um draft para envio posterior.
 *
 * Nunca lança à aplicação: todo o caminho e try/catch mudo (Req 3.8). Respeita
 * o guard global de reentrancia: se ja estamos dentro de uma captura/envio
 * (ex.: o proprio sink logou um erro), descarta em silencio para impedir laço
 * de recursao.
 */
export function captureError(draft: ErrorLogDraft): void {
  // Se ja estamos dentro do caminho de captura/envio, nao reentrar.
  if (isReentrant()) return;
  try {
    enqueue(draft);
  } catch {
    // Falha na propria captura e descartada sem relançar (Req 3.8).
  }
}

// --- Envio em lote (Error_Ingest_RPC) ---------------------------------------

/** Nome da Error_Ingest_RPC; tambem usado para excluir o endpoint do wrapper. */
export const ERROR_INGEST_RPC = 'rpc_assistant_ingest_errors';

/** Item do lote no formato esperado pela RPC (colunas snake_case de error_logs). */
interface ErrorIngestRow {
  error_type: ErrorType;
  route: string;
  message: string;
  stack: string | null;
  affected_user_id: string | null;
  occurred_at: string;
}

/** Converte um draft (camelCase) na linha snake_case aceita pela RPC. */
function toIngestRow(draft: ErrorLogDraft): ErrorIngestRow {
  return {
    error_type: draft.errorType,
    route: draft.route,
    message: draft.message,
    stack: draft.stack,
    // affected_user_id e resolvido server-side a partir de auth.uid() na RPC;
    // o frontend envia o que tiver (em geral null) sem nunca falhar (Req 3.6).
    affected_user_id: draft.affectedUserId,
    occurred_at: draft.occurredAt,
  };
}

/**
 * Envia um lote de Error_Log para a Error_Ingest_RPC.
 *
 * Usa o client unico do projeto (src/services/supabase.ts). Se a RPC ainda nao
 * estiver implantada (task 1.4) ou a rede falhar, a chamada lança/retorna erro;
 * o chamador (flush) engole tudo silenciosamente (Req 3.8). Nao reenfileira o
 * lote para evitar retry infinito de envios que sempre falham.
 */
export async function ingestErrorLogs(batch: ErrorLogDraft[]): Promise<void> {
  if (batch.length === 0) return;
  const p_batch = batch.map(toIngestRow);
  const { error } = await supabase.rpc(ERROR_INGEST_RPC, { p_batch });
  if (error) throw error;
}

// --- Flush por timer (throttle) ---------------------------------------------

/** Verdadeiro enquanto um flush assincrono esta em andamento (evita overlap). */
let flushing = false;

/** Remove e retorna ate maxBatchSize itens do inicio da fila. */
function dequeueBatch(): ErrorLogDraft[] {
  if (queue.length === 0) return [];
  return queue.splice(0, config.maxBatchSize);
}

/**
 * Drena um unico lote (ate maxBatchSize) e o envia. Chamado pelo timer no
 * maximo a cada flushIntervalMs, garantindo o throttle (Req 3.7).
 *
 * Todo o caminho e mudo (Req 3.8): qualquer falha de envio e descartada sem
 * relançar. O guard de reentrancia fica ativo durante o envio para que erros
 * gerados pelo proprio sink (ex.: console.error de uma falha de rede) nao
 * reentrem na captura e gerem laço de recursao.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  const batch = dequeueBatch();
  if (batch.length === 0) return;
  flushing = true;
  setReentrant(true);
  try {
    await ingestErrorLogs(batch);
  } catch {
    // Falha de envio descartada silenciosamente; lote nao e reenfileirado.
  } finally {
    setReentrant(false);
    flushing = false;
  }
}

// --- Wiring de handlers/wrappers (instalado em installGlobalErrorCapture) ----

/** Extrai um stack string|null de um valor desconhecido sem nunca lançar. */
function stackOf(value: unknown): string | null {
  try {
    if (value instanceof Error) return value.stack ?? null;
  } catch {
    // Acesso a .stack pode lançar em objetos exoticos: ignora.
  }
  return null;
}

/** Extrai uma mensagem legivel de um valor desconhecido sem nunca lançar. */
function messageOf(value: unknown): string {
  try {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    if (value == null) return '';
    return String(value);
  } catch {
    // String(value) pode lançar (Symbol/toString hostil): cai no fallback.
    return '';
  }
}

/** Atalho: normaliza a entrada e enfileira em um unico passo. */
function captureFrom(input: ErrorDraftInput): void {
  captureError(buildErrorDraft(input));
}

/** Verdadeiro se a URL aponta para a propria Error_Ingest_RPC (excluida). */
function isIngestEndpoint(url: string): boolean {
  return url.includes(ERROR_INGEST_RPC);
}

/** Extrai a URL de um RequestInfo/URL sem nunca lançar. */
function urlOf(input: unknown): string {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (input instanceof Request) return input.url;
    if (input && typeof (input as { url?: unknown }).url === 'string') {
      return (input as { url: string }).url;
    }
  } catch {
    // Entrada exotica: trata como URL vazia (nao sera excluida do wrapper).
  }
  return '';
}

// Estado do wiring para permitir teardown idempotente e completo.
let flushTimer: ReturnType<typeof setInterval> | null = null;
let onWindowError: ((event: ErrorEvent) => void) | null = null;
let onUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;
let originalConsoleError: typeof console.error | null = null;
let originalFetch: typeof window.fetch | null = null;
/** Teardown da instalacao anterior; permite reinstalar de forma idempotente. */
let activeTeardown: (() => void) | null = null;

/** Le o objeto window de forma segura (ambientes sem DOM retornam undefined). */
function getWindow(): (Window & typeof globalThis) | undefined {
  try {
    return (globalThis as { window?: Window & typeof globalThis }).window;
  } catch {
    // Acesso a window bloqueado: trata como ambiente sem DOM.
    return undefined;
  }
}

/** Instala os handlers de window.error e window.unhandledrejection. */
function installWindowHandlers(win: Window & typeof globalThis): void {
  onWindowError = (event: ErrorEvent): void => {
    captureFrom({
      errorType: 'window_error',
      message: messageOf(event.error) || event.message,
      stack: stackOf(event.error),
    });
  };
  onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    captureFrom({
      errorType: 'unhandled_rejection',
      message: messageOf(event.reason),
      stack: stackOf(event.reason),
    });
  };
  win.addEventListener('error', onWindowError);
  win.addEventListener('unhandledrejection', onUnhandledRejection);
}

/** Intercepta console.error: chama o original e enfileira um console_error. */
function installConsoleIntercept(): void {
  originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    // Sempre preserva o comportamento original primeiro.
    try {
      originalConsoleError?.(...args);
    } catch {
      // Falha do console original e ignorada: nao pode quebrar a aplicacao.
    }
    // O guard de reentrancia em captureError impede laço caso o proprio envio
    // venha a logar via console.error.
    const first = args.find((a) => a instanceof Error);
    captureFrom({
      errorType: 'console_error',
      message: args.map(messageOf).filter(Boolean).join(' '),
      stack: stackOf(first),
    });
  };
}

/** Embrulha window.fetch para capturar falhas de requisicao (request_failure). */
function installFetchWrapper(win: Window & typeof globalThis): void {
  originalFetch = win.fetch.bind(win);
  const wrapped: typeof window.fetch = async (input, init) => {
    const url = urlOf(input);
    // O endpoint da propria Error_Ingest_RPC e excluido para nao realimentar
    // o laço de captura -> envio -> captura.
    const excluded = isIngestEndpoint(url);
    try {
      const response = await originalFetch!(input, init);
      if (!excluded && !response.ok) {
        captureFrom({
          errorType: 'request_failure',
          message: `HTTP ${response.status} ${response.statusText} em ${url}`.trim(),
          stack: null,
        });
      }
      return response;
    } catch (err) {
      if (!excluded) {
        captureFrom({
          errorType: 'request_failure',
          message: messageOf(err) || `Falha de rede em ${url}`.trim(),
          stack: stackOf(err),
        });
      }
      // Repropaga: o wrapper observa, mas nao altera o contrato do fetch.
      throw err;
    }
  };
  win.fetch = wrapped;
}

// --- Instalacao / configuracao ----------------------------------------------

/** Mescla a configuracao informada com os defaults. */
function configure(cfg?: Partial<CaptureConfig>): void {
  config = { ...DEFAULT_CAPTURE_CONFIG, ...(cfg ?? {}) };
}

/** Esvazia a fila e zera o guard. Usado no teardown e em testes. */
function resetCapture(): void {
  queue.length = 0;
  flushing = false;
  setReentrant(false);
}

/**
 * Instala a captura global de erros e retorna uma funcao de teardown.
 *
 * Cabeamento completo (task 2.2):
 *  - handlers de window (`error` -> window_error, `unhandledrejection` ->
 *    unhandled_rejection);
 *  - intercept de `console.error` (chama o original + enfileira console_error);
 *  - wrapper de `window.fetch` (respostas `!ok`/rejeicoes -> request_failure,
 *    excluindo o endpoint da Error_Ingest_RPC);
 *  - flush por timer (throttle de flushIntervalMs, lotes de ate maxBatchSize).
 *
 * O AppErrorBoundary (componente React, .tsx separado) chama captureError com
 * errorType 'react_render' em componentDidCatch (Req 3.1).
 *
 * Idempotente: uma instalacao previa e desfeita antes de reinstalar. O teardown
 * retornado remove todos os handlers/wrappers, limpa o timer e reseta o estado.
 */
export function installGlobalErrorCapture(cfg?: Partial<CaptureConfig>): () => void {
  // Reinstalacao idempotente: desfaz o wiring anterior antes de reaplicar.
  if (activeTeardown) {
    activeTeardown();
  }
  configure(cfg);

  const win = getWindow();
  if (win) {
    installWindowHandlers(win);
    installFetchWrapper(win);
  }
  installConsoleIntercept();

  // Flush por timer: no maximo um lote a cada flushIntervalMs (Req 3.7).
  flushTimer = setInterval(() => {
    void flush();
  }, config.flushIntervalMs);

  const teardown = (): void => {
    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (win && onWindowError) {
      win.removeEventListener('error', onWindowError);
      onWindowError = null;
    }
    if (win && onUnhandledRejection) {
      win.removeEventListener('unhandledrejection', onUnhandledRejection);
      onUnhandledRejection = null;
    }
    if (originalConsoleError) {
      console.error = originalConsoleError;
      originalConsoleError = null;
    }
    if (win && originalFetch) {
      win.fetch = originalFetch;
      originalFetch = null;
    }
    resetCapture();
    activeTeardown = null;
  };

  activeTeardown = teardown;
  return teardown;
}
