/**
 * components/marketing/pixelContext.ts
 *
 * Contexto React do Pixel do site publico e hook de acesso (admin-marketing
 * 048, Epico 7 — task 7.4). Separado do `PixelProvider.tsx` para que o arquivo
 * do componente exporte SOMENTE o componente (compatibilidade com react-refresh
 * / Fast Refresh).
 */

import { createContext, useContext } from 'react';
import { generateEventId, type TrackedEvent } from '../../services/admin/marketing';

/**
 * PII e contexto opcionais de uma ocorrencia de Tracked_Event de negocio,
 * propagados ao disparo server-side (CAPI). Em texto claro ou ja-hash — a Edge
 * `meta-capi-forward` normaliza e hasheia (SHA-256) antes de enviar/persistir
 * (CP-6). NUNCA inclui o Meta_Access_Token (lido do Vault na Edge — CP-7).
 */
export interface TrackBusinessEventOptions {
  /** E-mail do usuario; opcional. */
  email?: string | null;
  /** Telefone do usuario; opcional. */
  phone?: string | null;
  /** ID do usuario autenticado; opcional. */
  userId?: string | null;
  /** ID do visitante anonimo; opcional. */
  visitorId?: string | null;
  /** Parametros customizados repassados ao Pixel (browser). */
  params?: Record<string, unknown>;
}

/** API exposta pelo contexto do Pixel para componentes do site publico. */
export interface PixelContextValue {
  /**
   * Dispara um Tracked_Event no Pixel (browser). Gera o `event_id` (UUID v4)
   * uma unica vez para a ocorrencia e o retorna, para que o mesmo id possa ser
   * propagado ao disparo server-side (CAPI) quando aplicavel (CP-4). O disparo
   * so ocorre quando ha consentimento `granted` e o Pixel esta inicializado
   * (porta de consentimento aplicada dentro do loader — CP-5).
   */
  trackEvent: (event: TrackedEvent, params?: Record<string, unknown>) => string;
  /**
   * Dispara um Tracked_Event de NEGOCIO (cadastro de motorista/embarcador,
   * publicacao de frete) em AMBOS os canais com o MESMO `event_id` (CP-4):
   *   1. o Pixel no browser (`loader.track`), gated por consentimento (CP-5);
   *   2. a Edge `meta-capi-forward` (CAPI server-side), com a PII disponivel.
   *
   * O `event_id` (UUID v4) e gerado UMA UNICA vez para a ocorrencia e retornado.
   * O envio ao CAPI e fire-and-forget (nunca lanca, nao bloqueia o fluxo do
   * usuario) e independente do Consent_State (Req 9.3) — a deduplicacao por
   * `event_id` evita contagem dupla com o Pixel.
   */
  trackBusinessEvent: (event: TrackedEvent, options?: TrackBusinessEventOptions) => string;
}

export const PixelContext = createContext<PixelContextValue | null>(null);

/**
 * Hook de acesso ao contexto do Pixel. Fora do `PixelProvider`, retorna um
 * fallback no-op seguro (gera um `event_id` mas nao dispara nada), evitando
 * quebrar partes do app que nao estejam sob o provider.
 */
export function usePixel(): PixelContextValue {
  const ctx = useContext(PixelContext);
  if (ctx) return ctx;
  return {
    trackEvent: () => generateEventId(),
    trackBusinessEvent: () => generateEventId(),
  };
}
