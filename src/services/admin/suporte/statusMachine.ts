/**
 * statusMachine.ts — Status_Transition + Status_Display_Map (suporte-inteligente).
 *
 * Máquina de estados determinística dos cinco status de atendimento. Função
 * pura, sem I/O — espelhada no backend (RPC `support_change_status`, migration
 * 115b) e alvo do property test CP2.
 *
 * Validates: Requirements 3.1, 3.3, 3.4, 3.5
 */

export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';

/** Domínio fechado dos cinco status (ordem canônica). */
export const TICKET_STATUSES: readonly TicketStatus[] = [
  'open',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
] as const;

/**
 * Tabela de transições válidas (Req 3.4, 3.5). `closed` é terminal (conjunto
 * vazio). Nenhum estado lista a si mesmo: `from === to` NÃO é transição válida.
 */
export const STATUS_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ['in_progress', 'waiting_customer', 'resolved', 'closed'],
  in_progress: ['waiting_customer', 'resolved', 'closed'],
  waiting_customer: ['in_progress', 'resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [], // terminal
};

/**
 * true se e somente se `to ∈ STATUS_TRANSITIONS[from]`. Como nenhum conjunto
 * inclui o próprio estado de origem, `from === to` retorna false; e `from`
 * terminal (`closed`) retorna sempre false.
 */
export function isValidTransition(from: TicketStatus, to: TicketStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** Mapeamento determinístico status → rótulo pt-BR + marcador visual (Req 3.3). */
export const STATUS_DISPLAY_MAP: Readonly<
  Record<TicketStatus, { label: string; marker: string }>
> = {
  open: { label: 'Novo', marker: '🟢' },
  in_progress: { label: 'Em andamento', marker: '🟡' },
  waiting_customer: { label: 'Aguardando cliente', marker: '🔵' },
  resolved: { label: 'Resolvido', marker: '⚪' },
  closed: { label: 'Fechado', marker: '🔴' },
};

/** Helper de render: "🟢 Novo". Total sobre o domínio fechado. */
export function renderStatus(status: TicketStatus): string {
  const { label, marker } = STATUS_DISPLAY_MAP[status];
  return `${marker} ${label}`;
}

/** Type guard do domínio fechado de status. */
export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}
