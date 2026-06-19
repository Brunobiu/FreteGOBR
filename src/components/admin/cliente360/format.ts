/**
 * Helpers de formatacao compartilhados pelos blocos da Visao 360 (pt-BR).
 */

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
}
