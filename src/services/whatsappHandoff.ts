/**
 * Camada pura do "handoff" para o WhatsApp dentro da conversa de frete.
 *
 * Regras de negócio (sem I/O, testáveis por property-based testing):
 *  - O botão de WhatsApp só libera depois que AMBOS os lados trocaram um número
 *    mínimo de mensagens (`WHATSAPP_UNLOCK_THRESHOLD`). A intenção é manter a
 *    negociação inicial dentro do app antes de expor o contato direto.
 *  - O número é normalizado para o formato `wa.me` (com DDI 55 do Brasil).
 *  - A mensagem pré-preenchida cita a rota do frete (origem → destino) e muda
 *    conforme quem inicia o contato (motorista interessado x embarcador).
 *
 * A contagem de mensagens e a revelação do telefone são reconfirmadas no
 * servidor (RPC `get_conversation_chat_state`, SECURITY DEFINER) — estas
 * funções derivam apenas a UI a partir dos números já validados.
 */

import { sanitizePhone } from '../utils/phoneFormat';

/** Mínimo de mensagens, por lado, para liberar o botão de WhatsApp. */
export const WHATSAPP_UNLOCK_THRESHOLD = 3;

export interface WhatsappGateState {
  /** `true` quando os dois lados atingiram o limiar. */
  unlocked: boolean;
  /** Quantas mensagens ainda faltam o próprio usuário enviar (>= 0). */
  remainingSelf: number;
  /** Quantas mensagens ainda faltam o outro lado enviar (>= 0). */
  remainingPeer: number;
}

/**
 * Decide o estado do botão de WhatsApp a partir da contagem de mensagens de
 * cada lado. Entradas inválidas (NaN, negativas, fracionárias) são saneadas
 * para inteiros não-negativos — a função NUNCA lança e é determinística.
 */
export function whatsappGate(
  msgsSelf: number,
  msgsPeer: number,
  threshold: number = WHATSAPP_UNLOCK_THRESHOLD
): WhatsappGateState {
  const norm = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  const self = norm(msgsSelf);
  const peer = norm(msgsPeer);
  const t = norm(threshold);
  return {
    unlocked: self >= t && peer >= t,
    remainingSelf: Math.max(0, t - self),
    remainingPeer: Math.max(0, t - peer),
  };
}

/**
 * Converte um telefone BR em número no formato aceito pelo `wa.me`
 * (somente dígitos, com DDI `55`). Retorna `null` quando o número não tem um
 * comprimento plausível — assim o chamador evita montar um link quebrado.
 *
 *  - 10 ou 11 dígitos (DDD + número) ⇒ prefixa `55`.
 *  - 12 ou 13 dígitos já iniciados por `55` ⇒ mantém.
 *  - qualquer outro caso ⇒ `null`.
 */
export function toWhatsappNumber(phone: string | null | undefined): string | null {
  const d = sanitizePhone(phone ?? '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

/**
 * Monta a URL `https://wa.me/<numero>?text=<mensagem>` com a mensagem
 * devidamente codificada. Retorna `null` quando o telefone é inválido.
 */
export function buildWhatsappLink(
  phone: string | null | undefined,
  message: string
): string | null {
  const num = toWhatsappNumber(phone);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

/**
 * Mensagem pré-preenchida do primeiro contato no WhatsApp. Cita a rota do
 * frete quando origem e destino estão disponíveis e adapta o texto conforme
 * quem está iniciando (motorista interessado x embarcador).
 */
export function buildFreteInterestMessage(args: {
  origin?: string | null;
  destination?: string | null;
  asMotorista: boolean;
}): string {
  const origin = (args.origin ?? '').trim();
  const destination = (args.destination ?? '').trim();
  const rota = origin && destination ? ` de ${origin} para ${destination}` : '';
  return args.asMotorista
    ? `Olá! Tenho interesse no frete${rota}. Podemos conversar?`
    : `Olá! Sobre o frete${rota}, podemos conversar?`;
}
