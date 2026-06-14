/**
 * greeting.ts — Saudação contextual por período do dia.
 *
 * Usado pelo AssistantePage para exibir "Bom dia, Bruno 👋" etc.
 */

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening';

/**
 * Determina o período do dia a partir da hora (0–23).
 *  - 05–11 → morning
 *  - 12–17 → afternoon
 *  - 18–04 → evening
 */
export function getGreetingPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 17) return 'afternoon';
  return 'evening';
}

/**
 * Retorna a saudação formatada com emoji de mãozinha.
 * Se firstName for vazio/null/undefined, retorna sem o nome.
 */
export function getGreeting(hour: number, firstName?: string | null): string {
  const period = getGreetingPeriod(hour);
  const labels: Record<GreetingPeriod, string> = {
    morning: 'Bom dia',
    afternoon: 'Boa tarde',
    evening: 'Boa noite',
  };
  const base = labels[period];
  const name = firstName?.trim();
  return name ? `${base}, ${name} 👋` : `${base} 👋`;
}
