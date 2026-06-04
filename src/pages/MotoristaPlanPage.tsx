/**
 * MotoristaPlanPage - Página "Meu Plano" para Motoristas
 *
 * PLACEHOLDER: Esta página está preparada para futura integração de pagamentos.
 * Atualmente exibe apenas informações sobre planos futuros.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import AppHeader from '../components/AppHeader';

// Planos disponíveis (placeholder)
const PLANS = [
  {
    id: 'free',
    name: 'Gratuito',
    price: 0,
    period: 'sempre',
    features: ['Visualizar fretes disponíveis', 'Calculadora de frete básica', 'Suporte por chat'],
    limitations: ['Anúncios na plataforma', 'Limite de 10 contatos por dia'],
    current: true,
  },
  {
    id: 'pro',
    name: 'Profissional',
    price: 29.9,
    period: 'mês',
    features: [
      'Tudo do plano Gratuito',
      'Sem anúncios',
      'Contatos ilimitados',
      'Calculadora avançada',
      'Sugestões personalizadas',
      'Suporte prioritário',
    ],
    limitations: [],
    recommended: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 49.9,
    period: 'mês',
    features: [
      'Tudo do plano Profissional',
      'Destaque nos resultados',
      'Relatórios de performance',
      'API de integração',
      'Gerente de conta dedicado',
    ],
    limitations: [],
  },
];

export default function MotoristaPlanPage() {
  useDocumentTitle('Plano - Motorista');
  useAuth();
  const navigate = useNavigate();
  const [, setSelectedPlan] = useState<string | null>(null);

  const handleSelectPlan = (planId: string) => {
    setSelectedPlan(planId);
    // TODO: Implementar fluxo de pagamento quando disponível
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Botao Voltar */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md"
          aria-label="Voltar"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Voltar
        </button>

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-800 mb-4">Meu Plano</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Escolha o plano ideal para impulsionar sua carreira como motorista de frete.
          </p>
        </div>

        {/* Coming Soon Banner */}
        <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border border-blue-700/50 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-center space-x-3">
            <div className="w-12 h-12 bg-blue-600/30 rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-blue-400"
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
              <p className="text-blue-700 text-sm">
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
          <p className="text-gray-500 text-sm mt-4">
            Você está usando o plano gratuito. Quando os planos pagos estiverem disponíveis, você
            poderá fazer upgrade para desbloquear mais recursos.
          </p>
        </div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative bg-white border rounded-xl p-6 transition-all ${
                plan.recommended
                  ? 'border-blue-500 ring-2 ring-blue-500/20'
                  : plan.current
                    ? 'border-green-300'
                    : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {/* Recommended Badge */}
              {plan.recommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded-full">
                    Recomendado
                  </span>
                </div>
              )}

              {/* Current Badge */}
              {plan.current && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 bg-green-600 text-white text-xs font-medium rounded-full">
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
                      ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
                      : 'bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {plan.current ? 'Plano Atual' : 'Em Breve'}
              </button>
            </div>
          ))}
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
              <h3 className="text-gray-800 font-medium mb-1">
                Quais formas de pagamento serão aceitas?
              </h3>
              <p className="text-gray-600 text-sm">
                Aceitaremos cartão de crédito, débito, PIX e boleto bancário.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
