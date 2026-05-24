/**
 * UsersBulkBar - barra de acoes em massa.
 */

interface Props {
  selectedCount: number;
  onActivate: () => void;
  onDeactivate: () => void;
  onClear: () => void;
  inProgress?: { current: number; total: number } | null;
}

const BULK_LIMIT = 200;

export default function UsersBulkBar({
  selectedCount,
  onActivate,
  onDeactivate,
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
              onClick={onActivate}
              disabled={overLimit}
              className="px-3 py-1.5 rounded text-xs bg-green-500/20 text-green-200 hover:bg-green-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Ativar selecionados
            </button>
            <button
              type="button"
              onClick={onDeactivate}
              disabled={overLimit}
              className="px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Desativar selecionados
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
