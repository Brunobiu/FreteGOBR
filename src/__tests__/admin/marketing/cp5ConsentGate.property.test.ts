// Feature: admin-marketing, Property 5: Porta de consentimento do Pixel
/**
 * CP-5 — Porta de consentimento do Pixel (obrigatório).
 *
 * Spec:
 *   - design.md §Correctness Properties — Property 5
 *   - requirements.md §Padrões de Sucesso (CP-5) e Requirement 8 (8.1, 8.2, 8.4, 8.6)
 *
 * Função sob teste:
 *   createPixelLoader(deps).syncConsent / track / isInitialized
 *   (src/services/marketing/pixelLoader.ts)
 *
 * Invariantes verificadas para SEQUÊNCIAS ARBITRÁRIAS de transições de
 * consentimento (`granted`/`denied`), com chamadas de `track` intercaladas:
 *
 *   1. Enquanto `consent === 'denied'` (Req 8.1, 8.4, 8.6):
 *        - ZERO injeções de script (`syncConsent('denied')` nunca injeta);
 *        - ZERO inicializações/chamadas a `fbq` (nem `init`, nem `track`);
 *        - ZERO eventos disparados — mesmo se o Pixel já fora inicializado antes
 *          e independentemente de `consent_required` (a porta em `track`
 *          reconsulta o consentimento VIGENTE via `getConsent()`).
 *   2. Na transição para `granted` (Req 8.2):
 *        - o script é injetado NO MÁXIMO uma vez ao longo de toda a sequência
 *          (idempotente); transições `granted` repetidas não reinjetam.
 *        - a injeção usa o `pixel_id` vindo de `getPixelId()` (de marketing_config).
 *
 * Convenções de PBT do projeto:
 *   - `injectScript` é mockado via `(globalThis as Record<string, unknown>).__injectSpy`
 *     (spy de injeção exposto no global, em vez de variável capturada por factory).
 *   - As chamadas a `fbq` são observadas por um spy `fbq` global, instalado pela
 *     própria injeção mockada — exatamente como o script real (`fbevents.js`)
 *     definiria `window.fbq` ao carregar.
 *   - Domínios fechados via `fc.constantFrom(...)` (consentimento e Tracked_Event);
 *     sem `fc.stringOf`.
 *
 * Lógica determinística (sem Supabase, sem Vault, sem rede). Ambiente jsdom.
 *
 * Validates: Requirements 8.1, 8.2, 8.4, 8.6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

import {
  createPixelLoader,
  type ConsentState,
  type PixelLoader,
} from '../../../services/marketing/pixelLoader';
import { META_EVENT_MAP, type TrackedEvent } from '../../../services/admin/marketing';

// Acesso tipado ao escopo global para expor/observar os spies (convenção do projeto).
const G = globalThis as Record<string, unknown>;

/** Pixel_Id numérico válido vindo de marketing_config (nunca hardcoded no loader). */
const PIXEL_ID = '987654321';

// ----- Geradores (domínios fechados) -----

const consentArb = fc.constantFrom<ConsentState>('granted', 'denied');

const eventArb = fc.constantFrom<TrackedEvent>(
  'page_view',
  'lead',
  'motorista_registration',
  'embarcador_registration',
  'frete_published'
);

/**
 * Um passo da sequência: uma transição de consentimento seguida de zero ou mais
 * tentativas de `track`. As tentativas de track exercitam a porta de disparo em
 * cada estado de consentimento.
 */
const stepArb = fc.record({
  consent: consentArb,
  tracks: fc.array(fc.record({ event: eventArb, eventId: fc.uuid() }), { maxLength: 3 }),
});

/** Sequência arbitrária (não vazia) de transições de consentimento. */
const sequenceArb = fc.array(stepArb, { minLength: 1, maxLength: 20 });

// ----- Harness de spies (recriado a cada execução do predicado) -----

interface PixelHarness {
  loader: PixelLoader;
  setConsent: (c: ConsentState) => void;
  injectCount: () => number;
  injectedPixelIds: string[];
  fbqCalls: () => unknown[][];
}

/**
 * Monta um Pixel_Loader fresco com spies isolados:
 *   - `__injectSpy` (global): conta as injeções e instala o `fbq` global (como
 *     o script real faria), permitindo observar `init`/`track`.
 *   - `fbq` (global): registra todas as chamadas (`['init', id]`, `['track', ...]`).
 * `getConsent` lê uma variável VIVA, para que `track` reflita o consentimento
 * vigente no momento do disparo (não um snapshot do último `syncConsent`).
 */
function makeHarness(pixelId: string | null): PixelHarness {
  let injectCount = 0;
  const injectedPixelIds: string[] = [];
  const fbqCalls: unknown[][] = [];

  // Garante que não há `fbq` remanescente de uma execução anterior.
  delete G.fbq;

  // Spy de injeção exposto no global (convenção do projeto). Emula o script
  // real definindo `window.fbq` ao "carregar".
  G.__injectSpy = (pid: string): void => {
    injectCount += 1;
    injectedPixelIds.push(pid);
    G.fbq = (...args: unknown[]): void => {
      fbqCalls.push(args);
    };
  };

  let liveConsent: ConsentState = 'denied';

  const loader = createPixelLoader({
    getConsent: () => liveConsent,
    getPixelId: () => pixelId,
    injectScript: (pid: string) => (G.__injectSpy as (p: string) => void)(pid),
  });

  return {
    loader,
    setConsent: (c) => {
      liveConsent = c;
    },
    injectCount: () => injectCount,
    injectedPixelIds,
    fbqCalls: () => fbqCalls,
  };
}

beforeEach(() => {
  delete G.fbq;
  delete G.__injectSpy;
});

afterEach(() => {
  delete G.fbq;
  delete G.__injectSpy;
});

describe('CP-5: Pixel_Loader — porta de consentimento (injeção/fbq/eventos)', () => {
  it('denied ⇒ zero injeções, zero fbq, zero eventos; granted ⇒ injeção única idempotente', () => {
    fc.assert(
      fc.property(sequenceArb, (sequence) => {
        const h = makeHarness(PIXEL_ID);
        let everGranted = false;

        for (const step of sequence) {
          const injectBeforeStep = h.injectCount();
          const fbqBeforeStep = h.fbqCalls().length;

          // Transição de consentimento: getConsent passa a refletir o estado vivo.
          h.setConsent(step.consent);
          h.loader.syncConsent(step.consent);

          if (step.consent === 'denied') {
            // (1) denied: syncConsent NUNCA injeta nem chama fbq — mesmo se já
            // inicializado antes (não desfaz, mas a porta de track bloqueia).
            expect(h.injectCount()).toBe(injectBeforeStep);
            expect(h.fbqCalls().length).toBe(fbqBeforeStep);
          } else {
            everGranted = true;
          }

          // Tentativas de track no estado de consentimento corrente.
          for (const t of step.tracks) {
            const injectBeforeTrack = h.injectCount();
            const fbqBeforeTrack = h.fbqCalls().length;

            h.loader.track(t.event, t.eventId);

            // track NUNCA injeta script, em qualquer estado.
            expect(h.injectCount()).toBe(injectBeforeTrack);

            if (step.consent === 'denied') {
              // (1) denied: ZERO eventos disparados.
              expect(h.fbqCalls().length).toBe(fbqBeforeTrack);
            } else if (h.loader.isInitialized()) {
              // granted + inicializado: o evento dispara exatamente uma vez,
              // com o evento Meta mapeado e o { eventID } da ocorrência.
              expect(h.fbqCalls().length).toBe(fbqBeforeTrack + 1);
              const call = h.fbqCalls()[h.fbqCalls().length - 1];
              expect(call[0]).toBe('track');
              expect(call[1]).toBe(META_EVENT_MAP[t.event]);
              expect(call[3]).toEqual({ eventID: t.eventId });
            }
          }

          // (2) Invariante global: injeção no máximo uma vez ao longo da sequência.
          expect(h.injectCount()).toBeLessThanOrEqual(1);
        }

        // Estado terminal coerente com a presença (ou não) de uma transição granted.
        if (everGranted) {
          // Injetado exatamente uma vez, com o pixel_id configurado, e inicializado.
          expect(h.injectCount()).toBe(1);
          expect(h.injectedPixelIds).toEqual([PIXEL_ID]);
          expect(h.loader.isInitialized()).toBe(true);
        } else {
          // Nunca houve granted ⇒ nada foi injetado/inicializado/disparado.
          expect(h.injectCount()).toBe(0);
          expect(h.loader.isInitialized()).toBe(false);
          expect(h.fbqCalls().length).toBe(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('granted com pixel_id ausente (null) ⇒ nunca injeta nem dispara (Req 8.7)', () => {
    // Mesmo concedendo consentimento, sem pixel_id configurado o loader não pode
    // injetar; a porta permanece fechada e nenhum evento é disparado.
    fc.assert(
      fc.property(sequenceArb, (sequence) => {
        const h = makeHarness(null);

        for (const step of sequence) {
          h.setConsent(step.consent);
          h.loader.syncConsent(step.consent);
          for (const t of step.tracks) {
            h.loader.track(t.event, t.eventId);
          }
        }

        expect(h.injectCount()).toBe(0);
        expect(h.loader.isInitialized()).toBe(false);
        expect(h.fbqCalls().length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('denied após granted ⇒ Pixel já inicializado, mas track não dispara (Req 8.4)', () => {
    // Caso dirigido reforçando a invariante "previamente inicializado, depois
    // denied" como parte da sequência arbitrária acima.
    fc.assert(
      fc.property(
        fc.array(fc.record({ event: eventArb, eventId: fc.uuid() }), {
          minLength: 1,
          maxLength: 5,
        }),
        (tracks) => {
          const h = makeHarness(PIXEL_ID);

          // 1) Concede consentimento: injeta e inicializa.
          h.setConsent('granted');
          h.loader.syncConsent('granted');
          expect(h.loader.isInitialized()).toBe(true);
          expect(h.injectCount()).toBe(1);

          // 2) Revoga consentimento: continua inicializado, mas a porta fecha.
          h.setConsent('denied');
          h.loader.syncConsent('denied');
          const fbqAfterRevoke = h.fbqCalls().length;

          // 3) Nenhum track dispara fbq enquanto denied, apesar de inicializado.
          for (const t of tracks) {
            h.loader.track(t.event, t.eventId);
          }
          expect(h.fbqCalls().length).toBe(fbqAfterRevoke);
          // Nenhuma reinjeção ocorreu.
          expect(h.injectCount()).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
