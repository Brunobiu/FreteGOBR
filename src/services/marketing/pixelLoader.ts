/**
 * marketing/pixelLoader.ts
 *
 * Pixel_Loader do site publico do FreteGO (admin-marketing 048, Epico 7).
 * Responsavel por injetar o script do Meta Pixel, inicializar `fbq` e disparar
 * os Tracked_Event via Pixel (browser) — sempre respeitando o consentimento de
 * cookies (LGPD). E um modulo PUBLICO: NAO e gated por permissoes admin
 * (Req 8.8). O `pixel_id` vem de `marketing_config` via `getPixelId()`, nunca
 * hardcoded (Req 8.7).
 *
 * Invariantes de correcao (CP-5 — Porta de consentimento do Pixel):
 *   - Enquanto `consent === 'denied'`: NUNCA injeta o script, NUNCA inicializa
 *     `fbq` e NUNCA dispara evento `fbq` — mesmo se previamente inicializado e
 *     independentemente de `consent_required` (Req 8.1, 8.4, 8.6).
 *   - Na transicao para `granted`: injeta o script NO MAXIMO uma vez (flag
 *     idempotente interna) (Req 8.2).
 *
 * Invariante CP-4 (deduplicacao por event_id):
 *   - `track` so dispara `fbq` quando inicializado E com consentimento
 *     `granted`; e SEMPRE inclui `{ eventID: eventId }` no payload do Pixel,
 *     compartilhando o mesmo `event_id` com o disparo server-side (CAPI) para
 *     que a Meta deduplique (Req 8.3).
 *
 * O mapeamento Tracked_Event -> evento da Meta reusa `META_EVENT_MAP` de
 * `src/services/admin/marketing.ts` (Req 8.5), sem redefinir.
 *
 * Testabilidade (property tests CP-5/CP-4): `injectScript`, `getConsent` e
 * `getPixelId` sao injetados via `deps`, permitindo que os testes mockem a
 * injecao (spy exposto em `(globalThis as Record<string, unknown>).__injectSpy`)
 * e controlem o consentimento/pixel_id. Os disparos de `fbq` vao para o `fbq`
 * global (definido pelo script injetado), permitindo que os testes observem as
 * chamadas via um spy global.
 */

import { META_EVENT_MAP, type TrackedEvent } from '../admin/marketing';

// ===================== Tipos publicos =====================

/**
 * Estado de consentimento de cookies do visitante (LGPD). Dominio fechado.
 *  - granted: visitante consentiu ⇒ Pixel pode ser injetado/disparado.
 *  - denied: sem consentimento ⇒ Pixel totalmente bloqueado (CP-5).
 */
export type ConsentState = 'granted' | 'denied';

/**
 * Dependencias injetadas em `createPixelLoader`. Tudo o que o loader precisa do
 * mundo externo entra por aqui, mantendo o nucleo puro/testavel.
 *
 *  - getConsent: le o Consent_State vigente do visitante (fonte de verdade da
 *    porta de consentimento; consultado em tempo de disparo — CP-5).
 *  - getPixelId: le o `pixel_id` de `marketing_config` (Req 8.7); null quando
 *    a integracao ainda nao foi configurada (nesse caso nada e injetado).
 *  - injectScript: injeta o script real do Pixel (opcional). Quando ausente,
 *    usa o bootstrap padrao do Meta Pixel. Mockavel em teste.
 */
export interface PixelLoaderDeps {
  getConsent: () => ConsentState;
  getPixelId: () => string | null;
  injectScript?: (pixelId: string) => void;
}

/**
 * Contrato publico do Pixel_Loader.
 *
 *  - syncConsent: notifica o loader de uma transicao de consentimento; em
 *    `granted`, injeta o script no maximo uma vez (idempotente — CP-5).
 *  - track: dispara um Tracked_Event via `fbq` (so quando inicializado E
 *    `granted`), sempre com `{ eventID: eventId }` (CP-4).
 *  - isInitialized: indica se o Pixel ja foi inicializado.
 */
export interface PixelLoader {
  syncConsent(state: ConsentState): void;
  track(event: TrackedEvent, eventId: string, params?: Record<string, unknown>): void;
  isInitialized(): boolean;
}

// ===================== fbq global (Meta Pixel) =====================

/** Assinatura da funcao global `fbq` do Meta Pixel. */
type FbqFn = (...args: unknown[]) => void;

/**
 * Stub do `fbq` criado pelo bootstrap padrao enquanto o script externo
 * (`fbevents.js`) carrega: enfileira as chamadas para serem reprocessadas pela
 * implementacao real apos o load. Espelha a estrutura do snippet oficial.
 */
interface FbqStub {
  (...args: unknown[]): void;
  queue: unknown[];
  loaded: boolean;
  version: string;
}

/** URL do script de eventos do Meta Pixel (bootstrap padrao). */
const FB_EVENTS_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

/**
 * Le o `fbq` global de forma defensiva. Retorna `undefined` quando o script do
 * Pixel ainda nao definiu o stub (ex.: consentimento nunca concedido), evitando
 * lancar ao tentar disparar antes da inicializacao.
 */
function getFbq(): FbqFn | undefined {
  const g = globalThis as Record<string, unknown>;
  return typeof g.fbq === 'function' ? (g.fbq as FbqFn) : undefined;
}

/**
 * Encaminha uma chamada ao `fbq` global, se disponivel. Centraliza o acesso ao
 * `fbq` para que init e track compartilhem o mesmo caminho observavel.
 */
function callFbq(...args: unknown[]): void {
  const fbq = getFbq();
  if (!fbq) return;
  fbq(...args);
}

/**
 * Bootstrap padrao do Meta Pixel quando nenhum `injectScript` e fornecido via
 * `deps`. Define o stub `fbq` (idempotente: nao sobrescreve um `fbq` existente)
 * e carrega o script externo `fbevents.js` quando ha DOM disponivel. O
 * `pixel_id` e aplicado depois, via `fbq('init', pixelId)` (ver
 * `ensureInitialized`), por isso esta funcao nao recebe o id.
 */
function defaultInjectScript(): void {
  const g = globalThis as typeof globalThis & { fbq?: FbqStub; _fbq?: FbqStub };
  // Idempotente: se ja existe um fbq (snippet anterior), nao redefine.
  if (typeof g.fbq === 'function') return;

  const queue: unknown[] = [];
  const stub = Object.assign(
    function fbqStub(...args: unknown[]): void {
      queue.push(args);
    },
    { queue, loaded: true, version: '2.0' }
  );
  g.fbq = stub;
  g._fbq = stub;

  // Carrega o script externo de eventos da Meta apenas se houver DOM.
  if (typeof document !== 'undefined') {
    const script = document.createElement('script');
    script.async = true;
    script.src = FB_EVENTS_SRC;
    const first = document.getElementsByTagName('script')[0];
    first?.parentNode?.insertBefore(script, first);
  }
}

// ===================== Factory =====================

/**
 * Cria um Pixel_Loader com consentimento gated (CP-5) e deduplicacao por
 * `event_id` (CP-4). Veja o cabecalho do arquivo e o contrato `PixelLoader`.
 *
 * @param deps Dependencias injetadas (consentimento, pixel_id, injecao).
 * @returns Um `PixelLoader` com estado encapsulado (flags de injecao/init).
 */
export function createPixelLoader(deps: PixelLoaderDeps): PixelLoader {
  // Flag idempotente: garante que o script seja injetado no maximo uma vez
  // (CP-5). Distinta de `initialized` para deixar a intencao explicita.
  let scriptInjected = false;
  // Indica se o Pixel ja foi inicializado (`fbq('init', pixelId)` disparado).
  let initialized = false;

  /** Injeta o script do Pixel (dep mockavel) ou usa o bootstrap padrao. */
  function inject(pixelId: string): void {
    if (deps.injectScript) deps.injectScript(pixelId);
    else defaultInjectScript();
  }

  /**
   * Injeta + inicializa o Pixel uma unica vez (idempotente — CP-5). So e
   * chamada a partir de uma transicao de consentimento para `granted`
   * (`syncConsent`), onde a propria transicao e a autoridade do consentimento
   * — por isso nao reconsulta `getConsent()` aqui (a porta de disparo em
   * `track` ja revalida o consentimento vigente). Sem efeito quando o script
   * ja foi injetado ou quando o `pixel_id` ainda nao esta configurado
   * (Req 8.7); nesse ultimo caso, uma futura transicao para `granted` com
   * `pixel_id` presente podera injetar (ainda no maximo uma vez).
   */
  function ensureInitialized(): void {
    // Idempotente: injeta o script no maximo uma vez (CP-5).
    if (scriptInjected) return;
    const pixelId = deps.getPixelId();
    if (!pixelId) return;
    scriptInjected = true;
    inject(pixelId);
    callFbq('init', pixelId);
    initialized = true;
  }

  return {
    syncConsent(state: ConsentState): void {
      // CP-5: somente a transicao para 'granted' dispara a injecao idempotente.
      // 'denied' NUNCA injeta nem inicializa, e nao desfaz uma inicializacao
      // previa: a porta em `track` (que revalida getConsent()) ja bloqueia
      // qualquer disparo enquanto o consentimento vigente for 'denied'.
      if (state === 'granted') ensureInitialized();
    },

    track(event: TrackedEvent, eventId: string, params?: Record<string, unknown>): void {
      // Porta de consentimento (CP-5): consulta o consentimento VIGENTE no
      // momento do disparo. Assim, mesmo previamente inicializado, nada e
      // disparado enquanto o consentimento for 'denied'.
      if (deps.getConsent() !== 'granted') return;
      // So dispara quando o Pixel ja foi inicializado.
      if (!initialized) return;
      const metaEvent = META_EVENT_MAP[event];
      // CP-4: o payload do Pixel SEMPRE inclui { eventID: eventId }, o mesmo
      // event_id compartilhado com o disparo server-side (CAPI) para dedup.
      callFbq('track', metaEvent, params ?? {}, { eventID: eventId });
    },

    isInitialized(): boolean {
      return initialized;
    },
  };
}
