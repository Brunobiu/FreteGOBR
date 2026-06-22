/**
 * Helpers puros de data para o chat de frete (conversa aberta).
 *
 * As funções que dependem de "hoje" recebem um `now` opcional, o que as torna
 * determinísticas e testáveis por property-based testing (sem depender do
 * relógio real). Datas são comparadas pelo dia civil local (ano/mês/dia).
 */

/** `true` se as duas datas caem no mesmo dia civil (local). */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Data no formato pt-BR `DD/MM/AAAA`. */
export function formatConversationStartDate(date: Date): string {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Rótulo do separador de dia na timeline de mensagens:
 *  - `Hoje`  quando `date` é o mesmo dia que `now`;
 *  - `Ontem` quando é o dia imediatamente anterior a `now`;
 *  - caso contrário, a data `DD/MM/AAAA`.
 */
export function daySeparatorLabel(date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) return 'Hoje';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Ontem';
  return formatConversationStartDate(date);
}
