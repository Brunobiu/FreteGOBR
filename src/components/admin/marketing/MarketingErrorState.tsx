/**
 * MarketingErrorState - estado de erro do painel quando a Meta esta
 * indisponivel e nao ha snapshot em cache para fallback (`META_API_UNAVAILABLE`).
 *
 * Espelha o padrao de `DashboardBlockError` (admin-patterns §6): bloco vermelho
 * com `role="alert"` (Req 14.3) e botao "Tentar novamente" que dispara
 * `onRetry`, sem quebrar a pagina (Req 5.12 / 7.4).
 *
 * Mensagem default vem da tabela canonica `MARKETING_ERROR_MESSAGES`
 * (`META_API_UNAVAILABLE`).
 *
 * _Requirements: 5.12, 7.4, 14.3_
 */

import { MARKETING_ERROR_MESSAGES } from '../../../services/admin/marketing';

interface Props {
  /** Callback de re-busca das metricas. */
  onRetry: () => void;
  /** Mensagem de erro. Default: mensagem canonica de META_API_UNAVAILABLE. */
  message?: string;
  className?: string;
}

export default function MarketingErrorState({
  onRetry,
  message = MARKETING_ERROR_MESSAGES.META_API_UNAVAILABLE,
  className = '',
}: Props) {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-900/40 bg-red-500/10 p-4 flex flex-col items-start justify-center gap-2 ${className}`}
    >
      <div className="text-xs text-red-300">⚠ {message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs px-2.5 py-1 rounded bg-red-500/20 text-red-200 hover:bg-red-500/30 transition focus:outline-none focus:ring-2 focus:ring-red-700"
      >
        Tentar novamente
      </button>
    </div>
  );
}
