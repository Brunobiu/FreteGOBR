/**
 * TrialExpiredPage — Tela de bloqueio para motoristas com trial expirado.
 *
 * Componente puramente presentacional: NÃO consome `useTrialStatus`. A decisão
 * de exibir esta tela (gating) é responsabilidade de quem a renderiza
 * (TrialGate/MotoristaProtectedRoute e HomePage), implementado em tarefas
 * posteriores. Aqui apenas exibimos a mensagem de bloqueio, o botão "Assinar"
 * e os valores informativos dos planos.
 *
 * Requirements: 5.3, 5.4, 5.5, 5.9
 */

import { useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// ─── Planos informativos (somente exibição — nenhuma cobrança nesta spec) ──────

export interface PlanInfo {
  /** Identificador estável do plano (inglês para identifier). */
  id: 'mensal' | 'trimestral' | 'semestral';
  /** Nome user-facing (pt-BR). */
  name: string;
  /** Valor principal exibido (ex.: "R$ 39,00/mês" ou "R$ 87,00"). */
  priceLabel: string;
  /** Detalhe complementar (ex.: "R$ 29,00/mês, pago de uma vez"); vazio quando não há. */
  detail: string;
}

/**
 * Valores informativos dos planos (Req 5.5). Exportado para reuso e para
 * testes de presença dos valores. NENHUMA cobrança é realizada nesta spec.
 */
export const PLAN_INFO: readonly PlanInfo[] = [
  { id: 'mensal', name: 'Mensal', priceLabel: 'R$ 39,00/mês', detail: '' },
  {
    id: 'trimestral',
    name: 'Trimestral',
    priceLabel: 'R$ 87,00',
    detail: 'R$ 29,00/mês, pago de uma vez',
  },
  {
    id: 'semestral',
    name: 'Semestral',
    priceLabel: 'R$ 150,00',
    detail: 'R$ 25,00/mês, pago de uma vez',
  },
];

export default function TrialExpiredPage() {
  useDocumentTitle('Teste expirado');
  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md mx-auto text-center">
        {/* Ícone de bloqueio */}
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <svg
            className="h-7 w-7 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        {/* Mensagem exata (Req 5.3) */}
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800">
          Seu teste expirou. Assine para continuar.
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Para voltar a usar o FreteGO, escolha um dos planos abaixo.
        </p>

        {/* Botão "Assinar" → /motorista/plano (Req 5.4) */}
        <button
          type="button"
          onClick={() => navigate('/motorista/plano')}
          className="mt-6 w-full rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Assinar
        </button>

        {/* Lista informativa de planos (Req 5.5) — apenas exibição */}
        <section className="mt-8 text-left" aria-label="Planos disponíveis">
          <h2 className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">
            Planos
          </h2>
          <ul className="space-y-3">
            {PLAN_INFO.map((plan) => (
              <li
                key={plan.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4"
              >
                <span className="text-sm font-medium text-gray-800">{plan.name}</span>
                <span className="text-right">
                  <span className="block text-base font-semibold text-gray-900">
                    {plan.priceLabel}
                  </span>
                  {plan.detail && (
                    <span className="block text-[11px] text-gray-500">{plan.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-center text-[11px] text-gray-400">
            Valores informativos. A cobrança estará disponível em breve.
          </p>
        </section>
      </div>
    </main>
  );
}
