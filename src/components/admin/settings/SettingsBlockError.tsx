/**
 * SettingsBlockError — estado de erro isolado de uma seção de configurações,
 * com botão "Tentar novamente". Permite degradação parcial: uma categoria
 * falha sem derrubar as demais. Spec finalizacao-lancamento.
 */

interface SettingsBlockErrorProps {
  message?: string;
  onRetry: () => void;
}

export default function SettingsBlockError({
  message = 'Categoria indisponível.',
  onRetry,
}: SettingsBlockErrorProps) {
  return (
    <div
      className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-4 flex items-center justify-between gap-3"
      role="alert"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs px-2.5 py-1 bg-white border border-red-300 text-red-700 rounded hover:bg-red-100 shrink-0"
      >
        Tentar novamente
      </button>
    </div>
  );
}
