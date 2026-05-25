/**
 * FreteDetailHeader - cabecalho do detalhe + botoes de acao.
 */

import type { FreteRow } from '../../../services/admin/fretes';

interface Props {
  frete: FreteRow;
  canEdit: boolean;
  canForceClose: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onForceClose: () => void;
  onCancel: () => void;
  onReactivate: () => void;
  onFlag: () => void;
  onUnflag: () => void;
  onDelete: () => void;
}

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  ativo: { label: 'Ativo', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
  encerrado: { label: 'Encerrado', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
};

export default function FreteDetailHeader({
  frete,
  canEdit,
  canForceClose,
  canDelete,
  onEdit,
  onForceClose,
  onCancel,
  onReactivate,
  onFlag,
  onUnflag,
  onDelete,
}: Props) {
  const badge = STATUS_BADGES[frete.status];
  const showEdit = canEdit && frete.status !== 'cancelado';
  const showForceClose = canForceClose && frete.status === 'ativo';
  const showCancel = canForceClose && frete.status !== 'cancelado';
  const showReactivate = canEdit && frete.status !== 'ativo';
  const showFlag = canEdit && !frete.flagged_for_review;
  const showUnflag = canEdit && frete.flagged_for_review;
  const showDelete = canDelete;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-gray-100">Frete #{frete.id.slice(0, 8)}</h2>
            <span
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${badge.cls}`}
            >
              {badge.label}
            </span>
            {frete.flagged_for_review && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                ⚑ Sob revisao
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm mt-1">
            <span className="truncate">{frete.origin}</span>
            <span className="text-gray-600 mx-2">→</span>
            <span className="truncate">{frete.destination}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {showEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700 transition"
            >
              Editar
            </button>
          )}
          {showForceClose && (
            <button
              type="button"
              onClick={onForceClose}
              className="px-3 py-1.5 rounded text-xs bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 transition"
            >
              Forcar encerramento
            </button>
          )}
          {showCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-200 hover:bg-red-500/30 transition"
            >
              Forcar cancelamento
            </button>
          )}
          {showReactivate && (
            <button
              type="button"
              onClick={onReactivate}
              className="px-3 py-1.5 rounded text-xs bg-green-500/20 text-green-200 hover:bg-green-500/30 transition"
            >
              Reativar frete
            </button>
          )}
          {showFlag && (
            <button
              type="button"
              onClick={onFlag}
              className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700 transition"
            >
              Sinalizar
            </button>
          )}
          {showUnflag && (
            <button
              type="button"
              onClick={onUnflag}
              className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700 transition"
            >
              Remover sinalizacao
            </button>
          )}
          {showDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="px-3 py-1.5 rounded text-xs bg-red-600/30 text-red-200 hover:bg-red-600/50 transition"
            >
              Excluir frete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
