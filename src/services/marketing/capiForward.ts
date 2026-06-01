/**
 * marketing/capiForward.ts
 *
 * Cliente do disparo server-side (Meta Conversions API) dos Tracked_Events de
 * negocio do FreteGO (admin-marketing 048, Epico 7 — task 7.5). Encaminha a
 * ocorrencia a Edge `meta-capi-forward` via `supabase.functions.invoke`,
 * carregando o MESMO `event_id` ja usado pelo disparo do Pixel no browser, para
 * que a Meta faca a deduplicacao (CP-4).
 *
 * Responsabilidades e invariantes:
 *   - Propaga o `event_id` compartilhado + `event_name` (dominio fechado
 *     Tracked_Event) + a PII disponivel (email/telefone/user_id/visitor_id) em
 *     TEXTO CLARO ou ja-hash. A Edge normaliza e hasheia a PII em SHA-256
 *     (CP-6) e le o Meta_Access_Token EXCLUSIVAMENTE do Vault (CP-7); o token
 *     NUNCA trafega pelo cliente.
 *   - Fire-and-forget: NUNCA lanca. O rastreamento e best-effort e jamais pode
 *     quebrar o fluxo do usuario (conclusao de cadastro / publicacao de frete).
 *     Falhas (rede, 4xx/5xx da Edge) sao apenas logadas como warning.
 *   - Independente do Consent_State do navegador (Req 9.3): o canal server-side
 *     continua enviando os eventos originados pelo sistema; a deduplicacao por
 *     `event_id` evita contagem dupla com o Pixel.
 *
 * NOTA DE AUTENTICACAO (deploy): a Edge `meta-capi-forward` foi desenhada com
 * `verify_jwt: false` e valida um Bearer service-role (padrao
 * `send-push-notification`). Uma invocacao a partir do browser carrega o JWT do
 * usuario/anon — portanto, em producao, o caminho autoritativo do CAPI deve ser
 * disparado server-side (trigger/pg_net) com a service-role. Este modulo
 * estabelece o PONTO DE FIACAO e o `event_id` compartilhado (CP-4) no ponto de
 * origem do evento; por ser fire-and-forget, uma eventual rejeicao de auth da
 * Edge degrada de forma segura sem afetar o usuario.
 */

import { supabase } from '../supabase';
import type { TrackedEvent } from '../admin/marketing';

/**
 * Entrada do encaminhamento CAPI. `event_name` e `event_id` sao obrigatorios; a
 * PII e opcional e pode chegar em texto claro ou ja-hash (a Edge decide se
 * hasheia — CP-6). NUNCA inclui o Meta_Access_Token (lido do Vault na Edge).
 */
export interface CapiForwardInput {
  /** Tracked_Event de negocio (dominio fechado). */
  eventName: TrackedEvent;
  /** Event_Id (UUID v4) compartilhado com o disparo do Pixel (CP-4). */
  eventId: string;
  /** E-mail do usuario (texto claro ou ja-hash); opcional. */
  email?: string | null;
  /** Telefone do usuario (texto claro ou ja-hash); opcional. */
  phone?: string | null;
  /** ID do usuario autenticado; opcional. */
  userId?: string | null;
  /** ID do visitante anonimo; opcional. */
  visitorId?: string | null;
  /** URL de origem do evento; default = `window.location.href` quando houver. */
  eventSourceUrl?: string | null;
}

/** URL de origem default (browser): a pagina atual, quando ha `window`. */
function defaultEventSourceUrl(): string | null {
  return typeof window !== 'undefined' && window.location ? window.location.href : null;
}

/**
 * Encaminha um Tracked_Event de negocio a Edge `meta-capi-forward` (server-side
 * CAPI), com o `event_id` compartilhado (CP-4) e a PII disponivel. Fire-and-
 * forget: resolve sempre (nunca rejeita), logando apenas um warning em falha.
 *
 * @param input event_name + event_id compartilhado + PII opcional.
 */
export async function forwardCapiEvent(input: CapiForwardInput): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('meta-capi-forward', {
      body: {
        event_name: input.eventName,
        event_id: input.eventId,
        email: input.email ?? null,
        phone: input.phone ?? null,
        user_id: input.userId ?? null,
        visitor_id: input.visitorId ?? null,
        event_source_url: input.eventSourceUrl ?? defaultEventSourceUrl(),
      },
    });
    if (error) {
      // Best-effort: nao propaga. Apenas sinaliza para observabilidade, sem
      // expor PII nem segredos (so o event_name/event_id, nao sensiveis).
      console.warn(
        `[capi-forward] falha ao encaminhar evento ${input.eventName} (event_id=${input.eventId})`
      );
    }
  } catch {
    // Erro de rede/invocacao: degradacao segura, o fluxo do usuario nao quebra.
    console.warn(
      `[capi-forward] erro de rede ao encaminhar evento ${input.eventName} (event_id=${input.eventId})`
    );
  }
}
