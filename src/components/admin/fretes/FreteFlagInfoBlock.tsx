/**
 * FreteFlagInfoBlock - exibido apenas se frete.flagged_for_review = true.
 */

import type { FreteRow } from '../../../services/admin/fretes';

interface Props {
  frete: FreteRow;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
}

export default function FreteFlagInfoBlock({ frete }: Props) {
  if (!frete.flagged_for_review) return null;

  return (
    <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
      <h3 className="text-sm font-semibold text-amber-300 mb-3">⚑ Sob revisao</h3>
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="text-gray-500 text-xs">Motivo</dt>
          <dd className="text-gray-200">{frete.flagged_reason ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs">Sinalizado em</dt>
          <dd className="text-gray-300">{fmtDateTime(frete.flagged_at)}</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs">Por</dt>
          <dd className="text-gray-300 font-mono text-xs">
            {frete.flagged_by ? frete.flagged_by.slice(0, 8) : '—'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
