// Feature: admin-marketing, Property 4: Invariante de deduplicação por event_id
/**
 * CP-4 — Invariante de deduplicação por event_id (obrigatório).
 *
 * Spec:
 *   - design.md §Correctness Properties — Property 4 (CP-4):
 *     "Para toda ocorrência de Tracked_Event, o Event_Id é um UUID v4 válido,
 *      gerado uma única vez, e o payload entregue ao Pixel (browser) e o payload
 *      entregue ao CAPI (server) compartilham exatamente o mesmo Event_Id
 *      estável para aquela ocorrência."
 *   - requirements.md §Padrões de Sucesso (CP-4); Reqs 8.3, 9.2, 10.2, 10.3, 10.7
 *
 * Funções/módulos sob teste:
 *   - generateEventId()        (src/services/admin/marketing.ts): UUID v4 via
 *     crypto.randomUUID().
 *   - META_EVENT_MAP           (src/services/admin/marketing.ts): mapeamento
 *     Tracked_Event → evento Meta (Req 10.7).
 *   - createPixelLoader(...).track(event, eventId)
 *     (src/services/marketing/pixelLoader.ts): SEMPRE inclui { eventID: eventId }
 *     como último argumento de fbq('track', ...) (Req 8.3, CP-4).
 *
 * Modelagem do payload CAPI:
 *   A Edge `meta-capi-forward` (Deno) ainda não expõe um builder importável em
 *   TS. Para asserir a invariante de id COMPARTILHADO, este teste constrói um
 *   builder mínimo do payload CAPI (buildCapiPayload) que espelha o contrato
 *   documentado (event_name = META_EVENT_MAP[event], event_id = <id gerado>).
 *   A invariante central: o MESMO event_id, gerado uma única vez, é entregue ao
 *   Pixel (capturado via fbq spy) e ao CAPI (campo event_id do payload) — ambos
 *   exatamente iguais ao id de origem.
 *
 * Captura do payload do Pixel:
 *   O Pixel_Loader lê `globalThis.fbq` em tempo de disparo. Instalamos um spy
 *   global (`globalThis.fbq`) que registra as chamadas; injectScript é mockado
 *   (spy exposto em globalThis.__cp4InjectSpy) para que o bootstrap padrão do
 *   Pixel não rode. Consentimento = 'granted' + getPixelId não-nulo garantem a
 *   inicialização antes do track (a porta de consentimento — CP-5 — não é o
 *   objeto deste teste, apenas pré-condição para o disparo).
 *
 * Sem mocks de módulo: generateEventId/META_EVENT_MAP/pixelLoader são puros/
 * determinísticos quanto à propagação de id; o único "mundo externo" é o `fbq`
 * global e o injectScript injetado.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fc from 'fast-check';

import {
  generateEventId,
  META_EVENT_MAP,
  type TrackedEvent,
} from '../../../services/admin/marketing';
import { createPixelLoader } from '../../../services/marketing/pixelLoader';

// ----- Spy global do fbq (Meta Pixel) -----
// O Pixel_Loader lê globalThis.fbq em tempo de disparo (getFbq); registramos as
// chamadas aqui. Exposto também em __cp4FbqSpy por convenção do projeto.
const fbqSpy = vi.fn();
(globalThis as Record<string, unknown>).fbq = fbqSpy;
(globalThis as Record<string, unknown>).__cp4FbqSpy = fbqSpy;

// Spy de injeção do script — impede que defaultInjectScript rode (e sobrescreva
// o nosso fbq global). Exposto via globalThis conforme convenção de PBT.
const injectSpy = vi.fn();
(globalThis as Record<string, unknown>).__cp4InjectSpy = injectSpy;

// Pixel_Id fixo válido (somente dígitos), nunca hardcoded no loader (vem daqui).
const PIXEL_ID = '1234567890';

/** Regex canônica de UUID v4 (versão 4, variante RFC 4122 — 8/9/a/b). */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Domínio fechado de Tracked_Event (convenção: fc.constantFrom de templates fixos).
const eventGen = fc.constantFrom<TrackedEvent>(
  'page_view',
  'lead',
  'motorista_registration',
  'embarcador_registration',
  'frete_published'
);

/**
 * Builder mínimo do payload CAPI (server-side), espelhando o contrato
 * documentado da Edge `meta-capi-forward`: o MESMO event_id de origem é gravado
 * em `event_id`, e o evento Meta vem de META_EVENT_MAP (Req 9.2, 10.7).
 */
function buildCapiPayload(
  event: TrackedEvent,
  eventId: string,
  customData: Record<string, unknown> = {}
): { event_name: string; event_id: string; custom_data: Record<string, unknown> } {
  return {
    event_name: META_EVENT_MAP[event],
    event_id: eventId,
    custom_data: customData,
  };
}

/**
 * Cria um Pixel_Loader já inicializado (consentimento 'granted' + pixel_id
 * presente) e dispara o Tracked_Event, retornando o `eventID` capturado no
 * último argumento da chamada `fbq('track', metaEvent, params, { eventID })`
 * e o `metaEvent` (segundo argumento). Retorna o índice da chamada de track.
 */
function trackAndCapturePixel(
  event: TrackedEvent,
  eventId: string
): { pixelEventId: unknown; pixelMetaEvent: unknown } {
  const loader = createPixelLoader({
    getConsent: () => 'granted',
    getPixelId: () => PIXEL_ID,
    injectScript: (id: string) => injectSpy(id),
  });
  loader.syncConsent('granted');
  expect(loader.isInitialized()).toBe(true);

  loader.track(event, eventId);

  // Localiza a chamada fbq('track', metaEvent, params, { eventID }).
  const trackCall = fbqSpy.mock.calls.find((args) => args[0] === 'track');
  expect(trackCall).toBeDefined();
  const args = trackCall as unknown[];
  const lastArg = args[args.length - 1] as { eventID?: unknown };
  return { pixelEventId: lastArg?.eventID, pixelMetaEvent: args[1] };
}

describe('CP-4: deduplicação por event_id — UUID v4 válido + id compartilhado Pixel/CAPI', () => {
  beforeEach(() => {
    fbqSpy.mockClear();
    injectSpy.mockClear();
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).fbq;
    delete (globalThis as Record<string, unknown>).__cp4FbqSpy;
    delete (globalThis as Record<string, unknown>).__cp4InjectSpy;
  });

  // Facet 1: generateEventId() produz sempre UUID v4 válido (Req 10.2, 10.3).
  it('generateEventId() retorna um UUID v4 válido para toda ocorrência', () => {
    fc.assert(
      fc.property(eventGen, () => {
        const eventId = generateEventId();
        expect(eventId).toMatch(UUID_V4_REGEX);
      }),
      { numRuns: 100 }
    );
  });

  // Facet 2 (núcleo): o eventID entregue ao Pixel é EXATAMENTE o mesmo event_id
  // entregue ao payload CAPI — e ambos iguais ao id gerado na origem (Req 8.3,
  // 9.2, 10.2, 10.3).
  it('o eventID do Pixel == o event_id do CAPI == o id gerado (uma única geração)', () => {
    fc.assert(
      fc.property(eventGen, (event) => {
        fbqSpy.mockClear();
        injectSpy.mockClear();

        // event_id gerado UMA ÚNICA vez na origem, propagado a ambos os canais.
        const eventId = generateEventId();
        expect(eventId).toMatch(UUID_V4_REGEX);

        // Browser (Pixel): captura o { eventID } do payload.
        const { pixelEventId } = trackAndCapturePixel(event, eventId);

        // Server (CAPI): builder recebe o MESMO event_id.
        const capiPayload = buildCapiPayload(event, eventId);

        // Invariante de id compartilhado: Pixel == CAPI == origem.
        expect(pixelEventId).toBe(eventId);
        expect(capiPayload.event_id).toBe(eventId);
        expect(pixelEventId).toBe(capiPayload.event_id);
      }),
      { numRuns: 100 }
    );
  });

  // Facet 3: o evento Meta mapeado é o mesmo nos dois canais (META_EVENT_MAP —
  // Req 10.7), reforçando que Pixel e CAPI descrevem a MESMA ocorrência.
  it('o evento Meta mapeado é idêntico no Pixel e no CAPI (META_EVENT_MAP)', () => {
    fc.assert(
      fc.property(eventGen, (event) => {
        fbqSpy.mockClear();
        injectSpy.mockClear();

        const eventId = generateEventId();
        const { pixelMetaEvent } = trackAndCapturePixel(event, eventId);
        const capiPayload = buildCapiPayload(event, eventId);

        expect(pixelMetaEvent).toBe(META_EVENT_MAP[event]);
        expect(capiPayload.event_name).toBe(META_EVENT_MAP[event]);
        expect(pixelMetaEvent).toBe(capiPayload.event_name);
      }),
      { numRuns: 100 }
    );
  });
});
