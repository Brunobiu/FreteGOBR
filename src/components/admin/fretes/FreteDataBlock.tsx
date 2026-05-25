/**
 * FreteDataBlock - dados completos do frete + botao moderar conteudo.
 */

import { SPECIFICATIONS_PLACEHOLDER, type FreteRow } from '../../../services/admin/fretes';

interface Props {
  frete: FreteRow;
  canEdit: boolean;
  onModerate: () => void;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '—';
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
}

export default function FreteDataBlock({ frete, canEdit, onModerate }: Props) {
  const isModerated = frete.specifications === SPECIFICATIONS_PLACEHOLDER;

  return (
    <section
      aria-labelledby="frete-data-title"
      className="rounded-lg border border-gray-800 bg-gray-900 p-5"
    >
      <h3 id="frete-data-title" className="text-sm font-semibold text-gray-300 mb-3">
        Dados do Frete
      </h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-gray-500 text-xs">Tipo de carga</dt>
          <dd className="text-gray-200">{frete.cargo_type}</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs">Veiculo</dt>
          <dd className="text-gray-200">{frete.vehicle_type}</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs">Peso</dt>
          <dd className="text-gray-200">{frete.weight} kg</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs">Valor</dt>
          <dd className="text-gray-200">{BRL.format(frete.value)}</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs">Prazo</dt>
          <dd className="text-gray-200">{fmtDate(frete.deadline)}</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs">Tempos</dt>
          <dd className="text-gray-200">
            Carga {frete.loading_time}min · Descarga {frete.unloading_time}min
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-1">
          <dt className="text-gray-500 text-xs">
            Especificacoes
            {isModerated && (
              <span className="ml-2 px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                Moderado
              </span>
            )}
          </dt>
          {canEdit && !isModerated && (
            <button
              type="button"
              onClick={onModerate}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              Moderar conteudo
            </button>
          )}
        </div>
        <p className="text-gray-300 text-sm whitespace-pre-wrap">{frete.specifications ?? '—'}</p>
      </div>

      {frete.cancel_reason && (
        <div className="mt-4 rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
          <strong>Motivo do cancelamento:</strong> {frete.cancel_reason}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500">
        Cadastrado em {fmtDateTime(frete.created_at)} · Atualizado em{' '}
        {fmtDateTime(frete.updated_at)}
      </div>
    </section>
  );
}
