/**
 * FretesBulkBar - barra de acoes em massa.
 */

interface Props {
  selectedCount: number;
  onClose: () => void;
  onCancel: () => void;
  onClear: () => void;
  inProgress?: { current: number; total: number } | null;
}

const BULK_LIMIT = 200;

export default function FretesBulkBar({
  selectedCount,
  onClose,
  onCancel,
  onClear,
  inProgress,
}: Props) {
  if (selectedCount === 0 && !inProgress) return null;

  const overLimit = selectedCount > BULK_LIMIT;

  return (
    <div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-cyan-500/15 border-y border-cyan-500/30 backdrop-blur">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-cyan-200">
          {inProgress ? (
            <span>
              Processando {inProgress.current} de {inProgress.total}...
            </span>
          ) : (
            <>
              <span className="font-semibold">{selectedCount}</span> selecionados
              {overLimit && (
                <span className="ml-2 text-red-300 text-xs">
                  Maximo de {BULK_LIMIT} por operacao.
                </span>
              )}
            </>
          )}
        </div>
        {!inProgress && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={overLimit}
              className="px-3 py-1.5 rounded text-xs bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Encerrar selecionados
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={overLimit}
              className="px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Cancelar selecionados
            </button>
            <button
              type="button"
              onClick={onClear}
              className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white transition"
            >
              Limpar selecao
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
