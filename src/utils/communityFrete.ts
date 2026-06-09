/**
 * Núcleo puro do contato WhatsApp do Frete Comunidade (FreteGO) —
 * spec frete-comunidade (Req 10.7/10.8).
 *
 * Gera o deep-link do WhatsApp com mensagem pré-preenchida que inclui o
 * domínio do FreteGO (isca para o anunciante conhecer a plataforma).
 */

import { sanitizePhone, isValidPhoneBR } from './phoneFormat';

/** Domínio público do FreteGO incluído na mensagem (Req 10.7). */
export const FRETEGO_DOMAIN = 'https://www.fretegobr.com.br';

/** DDI do Brasil para o link wa.me. */
const BR_DDI = '55';

/**
 * Mensagem fixa enviada ao abrir o WhatsApp de um Frete_Comunidade. Inclui o
 * FRETEGO_DOMAIN. Texto canônico definido com o dono.
 */
export function buildCommunityWhatsAppMessage(): string {
  return `Olá, vim pelo FreteGO (${FRETEGO_DOMAIN}). Seu frete foi sugerido pela comunidade, gostaria de mais informações.`;
}

/**
 * Constrói o WhatsApp_Deep_Link `https://wa.me/55<digits>?text=<encoded>`.
 * Retorna `null` quando o telefone normalizado não é BR válido (10/11 dígitos),
 * sinalizando à UI para ocultar o botão (Req 10.8).
 */
export function buildWhatsAppDeepLink(contactPhone: string): string | null {
  const digits = sanitizePhone(contactPhone ?? '');
  if (!isValidPhoneBR(digits)) return null;
  const text = encodeURIComponent(buildCommunityWhatsAppMessage());
  return `https://wa.me/${BR_DDI}${digits}?text=${text}`;
}
