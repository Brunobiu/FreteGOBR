/**
 * DocRevalidationModal
 *
 * Modal central exibido ao motorista quando algum grupo de documentos venceu
 * o prazo de 30 dias. Um único botão ("Sim, continua tudo igual") confirma
 * TODOS os grupos de uma vez (+30 dias) — não é preciso reenviar documento.
 *
 * Enquanto não confirma, o motorista NÃO vê os fretes (o servidor bloqueia via
 * motorista_can_interact; aqui é a UX). O modal lista os grupos vencidos e
 * permite revisar cada um pelo menu.
 *
 * Montado globalmente no App; só aparece para motorista com pendência.
 */

import { useNavigate } from 'react-router-dom';
import { useDocRevalidation } from '../hooks/useDocRevalidation';
import { REVALIDATION_GROUP_LABELS } from '../utils/docRevalidation';

export default function DocRevalidationModal() {
  const navigate = useNavigate();
  const { loading, needsRevalidation, expiredGroups, confirm, confirming } = useDocRevalidation();

  if (loading || !needsRevalidation) return null;

  const handleConfirm = async () => {
    try {
      await confirm();
    } catch {
      // Erro de rede: mantém o modal aberto; o motorista pode tentar de novo.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reval-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
          <svg
            className="h-6 w-6 text-yellow-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>

        <h2 id="reval-title" className="text-center text-lg font-semibold text-gray-900">
          Confirme seus documentos
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Já faz 30 dias. Para continuar vendo os fretes, confirme que você permanece com os mesmos
          documentos e veículo.
        </p>

        {expiredGroups.length > 0 && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Precisam de confirmação
            </p>
            <div className="flex flex-wrap gap-1.5">
              {expiredGroups.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800"
                >
                  {REVALIDATION_GROUP_LABELS[g]}
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          className="mt-5 w-full rounded-xl bg-brand-green py-3 text-sm font-semibold text-white hover:bg-brand-greenDark disabled:opacity-60"
        >
          {confirming ? 'Confirmando...' : 'Sim, continua tudo igual'}
        </button>

        <button
          type="button"
          onClick={() => navigate('/motorista/menu')}
          disabled={confirming}
          className="mt-2 w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
        >
          Revisar documentos
        </button>
      </div>
    </div>
  );
}
