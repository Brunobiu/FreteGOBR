/**
 * EmbarcadorPlanPage - Página "Meu Plano" para Embarcadores
 *
 * PLACEHOLDER: Esta página está preparada para futura integração de pagamentos.
 * Atualmente exibe apenas informações sobre planos futuros.
 */

import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import AppHeader from '../components/AppHeader';

// Planos disponíveis para embarcadores (placeholder)
const PLANS = [
  {
    id: 'free',
    name: 'Gratuito',
    price: 0,
    period: 'sempre',
    features: [
      'Publicar até 3 fretes por mês',
      'Visualizar motoristas interessados',
      'Chat de suporte básico',
    ],
    limitations: ['Limite de 3 fretes/mês', 'Sem destaque nos resultados'],
    current: true,
  },
  {
    id: 'business',
    name: 'Empresarial',
    price: 99.9,
    period: 'mês',
    features: [
      'Fretes ilimitados',
      'Destaque nos resultados de busca',
      'Analytics de visualizações',
      'Suporte prioritário',
      'Perfil verificado',
    ],
    limitations: [],
    recommended: true,
  },
  {
    id: 'enterprise',
    name: 'Corporativo',
    price: 299.9,
    period: 'mês',
    features: [
      'Tudo do plano Empresarial',
      'API de integração',
      'Múltiplos usuários',
      'Relatórios avançados',
      'Gerente de conta dedicado',
      'SLA garantido',
    ],
    limitations: [],
  },
];

export default function EmbarcadorPlanPage() {
  useDocumentTitle('Plano - Embarcador');
  useAuth();
  const [, setSelectedPlan] = useState<string | null>(null);

  const handleSelectPlan = (planId: string) => {
    setSelectedPlan(planId);
    // TODO: Implementar fluxo de pagamento quando disponível
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-800 mb-4">Meu Plano</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Escolha o plano ideal para expandir seu negócio e encontrar os melhores motoristas.
          </p>
        </div>

        {/* Coming Soon Banner */}
        <div className="bg-gradient-to-r from-green-900/50 to-emerald-900/50 border border-green-700/50 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-center space-x-3">
            <div className="w-12 h-12 bg-green-600/30 rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-800">Em Breve</h2>
              <p className="text-green-700 text-sm">
                Sistema de planos e pagamentos será lançado em breve. Fique atento!
              </p>
            </div>
          </div>
        </div>

        {/* Current Plan Info */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm">Plano Atual</p>
              <p className="text-2xl font-bold text-gray-800">Gratuito</p>
            </div>
            <div className="px-4 py-2 bg-green-100 border border-green-200 rounded-lg">
              <span className="text-green-700 font-medium">Ativo</span>
            </div>
          </div>
          <div className="mt-4 flex items-center space-x-4">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full" style={{ width: '33%' }} />
            </div>
            <span className="text-gray-600 text-sm">1/3 fretes usados este mês</span>
          </div>
          <p className="text-gray-500 text-sm mt-4">
            Você está usando o plano gratuito com limite de 3 fretes por mês. Faça upgrade para
            publicar fretes ilimitados.
          </p>
        </div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative bg-white border rounded-xl p-6 transition-all ${
                plan.recommended
                  ? 'border-green-500 ring-2 ring-green-500/20'
                  : plan.current
                    ? 'border-green-300'
                    : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {/* Recommended Badge */}
              {plan.recommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 bg-green-600 text-white text-xs font-medium rounded-full">
                    Mais Popular
                  </span>
                </div>
              )}

              {/* Current Badge */}
              {plan.current && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 bg-gray-500 text-white text-xs font-medium rounded-full">
                    Plano Atual
                  </span>
                </div>
              )}

              {/* Plan Header */}
              <div className="text-center mb-6 pt-2">
                <h3 className="text-xl font-bold text-gray-800 mb-2">{plan.name}</h3>
                <div className="flex items-baseline justify-center">
                  {plan.price === 0 ? (
                    <span className="text-3xl font-bold text-gray-800">Grátis</span>
                  ) : (
                    <>
                      <span className="text-gray-600 text-lg">R$</span>
                      <span className="text-3xl font-bold text-gray-800 mx-1">
                        {plan.price.toFixed(2).replace('.', ',')}
                      </span>
                      <span className="text-gray-600">/{plan.period}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-6">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start space-x-2">
                    <svg
                      className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span className="text-gray-600 text-sm">{feature}</span>
                  </li>
                ))}
                {plan.limitations.map((limitation, index) => (
                  <li key={`limit-${index}`} className="flex items-start space-x-2">
                    <svg
                      className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                    <span className="text-gray-500 text-sm">{limitation}</span>
                  </li>
                ))}
              </ul>

              {/* Action Button */}
              <button
                onClick={() => handleSelectPlan(plan.id)}
                disabled={plan.current || true} // Disabled until payments are implemented
                className={`w-full py-3 rounded-lg font-medium transition-colors ${
                  plan.current
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : plan.recommended
                      ? 'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed'
                      : 'bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {plan.current ? 'Plano Atual' : 'Em Breve'}
              </button>
            </div>
          ))}
        </div>

        {/* Benefits Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6">Por que fazer upgrade?</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg
                  className="w-6 h-6 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              </div>
              <h3 className="text-gray-800 font-medium mb-1">Mais Visibilidade</h3>
              <p className="text-gray-600 text-sm">
                Seus fretes aparecem em destaque para mais motoristas
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg
                  className="w-6 h-6 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h3 className="text-gray-800 font-medium mb-1">Analytics Detalhados</h3>
              <p className="text-gray-600 text-sm">
                Acompanhe visualizações e interesse nos seus fretes
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg
                  className="w-6 h-6 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              </div>
              <h3 className="text-gray-800 font-medium mb-1">Suporte Prioritário</h3>
              <p className="text-gray-600 text-sm">Atendimento rápido para resolver suas dúvidas</p>
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Perguntas Frequentes</h2>
          <div className="space-y-4">
            <div>
              <h3 className="text-gray-800 font-medium mb-1">
                Quando os planos pagos estarão disponíveis?
              </h3>
              <p className="text-gray-600 text-sm">
                Estamos trabalhando para lançar os planos pagos em breve. Você será notificado
                quando estiverem disponíveis.
              </p>
            </div>
            <div>
              <h3 className="text-gray-800 font-medium mb-1">Posso cancelar a qualquer momento?</h3>
              <p className="text-gray-600 text-sm">
                Sim, você poderá cancelar sua assinatura a qualquer momento sem multas ou taxas
                adicionais.
              </p>
            </div>
            <div>
              <h3 className="text-gray-800 font-medium mb-1">Emitem nota fiscal?</h3>
              <p className="text-gray-600 text-sm">
                Sim, emitimos nota fiscal para todos os planos pagos automaticamente após o
                pagamento.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
