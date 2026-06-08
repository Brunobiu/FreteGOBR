/**
 * MotoristaPlanPage — /motorista/plano
 *
 * Tela de assinatura do motorista (spec assinaturas-pagamento, Fase 5).
 * Tudo dentro do app, com a identidade da marca (sem sair para o Asaas):
 *   - 3 planos reais (semestral em destaque), preço/mês + total.
 *   - Escolha de forma de pagamento (PIX, boleto, cartão).
 *   - PIX/boleto: mostra o checkout (QR/link) na própria tela.
 *   - Cartão: recorrência automática (formulário simples).
 *   - Histórico de cobranças do próprio motorista.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useTrialStatus } from '../hooks/useTrialStatus';
import {
  PLANS,
  computePlanTotal,
  formatPlanBRL,
  type Plan,
  type PlanId,
} from '../utils/subscriptionPlans';
import {
  createSubscription,
  listMyCharges,
  SubscriptionError,
  SUBSCRIPTION_ERROR_MESSAGES,
  type ChargeRow,
  type CreateSubscriptionResult,
  type PaymentMethod,
} from '../services/subscriptions';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'PIX',
  boleto: 'Boleto',
  credit_card: 'Cartão de crédito',
};

const CHARGE_STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando',
  paid: 'Pago',
  failed: 'Falhou',
  refunded: 'Estornado',
};

const CHARGE_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-600',
};

function formatChargeDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function MotoristaPlanPage() {
  useDocumentTitle('Planos');
  const navigate = useNavigate();
  const { isSubscribed, daysLeft, isExpired } = useTrialStatus();

  const [selectedPlan, setSelectedPlan] = useState<PlanId>('semestral');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CreateSubscriptionResult | null>(null);

  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [loadingCharges, setLoadingCharges] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listMyCharges()
      .then((rows) => {
        if (!cancelled) setCharges(rows);
      })
      .catch(() => {
        if (!cancelled) setCharges([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingCharges(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubscribe = async () => {
    setError(null);
    const onlyDigits = cpfCnpj.replace(/\D/g, '');
    if (onlyDigits.length < 11) {
      setError('Informe um CPF válido para emitir a cobrança.');
      return;
    }
    if (method === 'credit_card') {
      // O cartão com tokenização será adicionado em etapa dedicada; por ora
      // orientamos PIX/boleto, que rodam 100% dentro do app.
      setError('Pagamento com cartão estará disponível em breve. Use PIX ou boleto por enquanto.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createSubscription({
        plan: selectedPlan,
        payment_method: method,
        cpfCnpj: onlyDigits,
      });
      setCheckout(result);
    } catch (err) {
      const code = err instanceof SubscriptionError ? err.code : 'UNKNOWN';
      setError(SUBSCRIPTION_ERROR_MESSAGES[code] ?? SUBSCRIPTION_ERROR_MESSAGES.UNKNOWN);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />

      <main className="max-w-3xl mx-auto px-4 py-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md"
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

        {/* Cabeçalho de status */}
        {isSubscribed ? (
          <div className="rounded-xl border border-brand-green/30 bg-brand-green/10 p-4 mb-5">
            <p className="text-sm font-semibold text-brand-green">Você é assinante PRO 🎉</p>
            <p className="text-xs text-gray-600 mt-0.5">
              Sua assinatura está ativa. Obrigado por apoiar o FreteGO.
            </p>
          </div>
        ) : (
          <div className="mb-5">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Escolha seu plano</h1>
            <p className="text-sm text-gray-600 mt-1">
              {isExpired
                ? 'Seu período gratuito acabou. Assine para voltar a interagir com os fretes.'
                : `Você tem ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'} de teste grátis. Garanta o melhor preço assinando agora.`}
            </p>
          </div>
        )}

        {!isSubscribed && !checkout && (
          <>
            {/* Cards de planos */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PLANS.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  selected={selectedPlan === plan.id}
                  onSelect={() => setSelectedPlan(plan.id)}
                />
              ))}
            </div>

            {/* Forma de pagamento */}
            <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Forma de pagamento</h2>
              <div className="flex flex-wrap gap-2">
                {(['pix', 'boleto', 'credit_card'] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      method === m
                        ? 'border-brand-green bg-brand-green/10 text-brand-green font-semibold'
                        : 'border-gray-300 text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <label className="block text-xs text-gray-600 mb-1">CPF do titular</label>
                <input
                  inputMode="numeric"
                  value={cpfCnpj}
                  onChange={(e) => setCpfCnpj(e.target.value)}
                  placeholder="000.000.000-00"
                  className="w-full sm:w-64 text-sm border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              {error && (
                <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={handleSubscribe}
                disabled={submitting}
                className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-semibold bg-brand-green text-white rounded-xl hover:bg-brand-greenDark transition-colors disabled:opacity-50"
              >
                {submitting
                  ? 'Gerando cobrança...'
                  : `Assinar ${formatPlanBRL(computePlanTotal(PLANS.find((p) => p.id === selectedPlan)!))}`}
              </button>
            </div>
          </>
        )}

        {/* Checkout (PIX/boleto) na própria tela */}
        {checkout && (
          <CheckoutBlock checkout={checkout} method={method} onBack={() => setCheckout(null)} />
        )}

        {/* Histórico de cobranças */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">Histórico de cobranças</h2>
          {loadingCharges ? (
            <p className="text-sm text-gray-500">Carregando...</p>
          ) : charges.length === 0 ? (
            <p className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-4">
              Você ainda não tem cobranças. Elas aparecerão aqui após sua primeira assinatura.
            </p>
          ) : (
            <ul className="space-y-2">
              {charges.map((c) => (
                <li
                  key={c.id}
                  className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">{formatPlanBRL(c.amount)}</p>
                    <p className="text-xs text-gray-500">
                      {METHOD_LABEL[c.payment_method]} · {formatChargeDate(c.created_at)}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${CHARGE_STATUS_BADGE[c.status] ?? 'bg-gray-100 text-gray-600'}`}
                  >
                    {CHARGE_STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

// ─── PlanCard ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
}) {
  const total = computePlanTotal(plan);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative text-left rounded-xl border p-4 transition-all ${
        selected
          ? 'border-brand-green ring-2 ring-brand-green/20 bg-white'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      {plan.recommended && (
        <span className="absolute -top-2 right-3 rounded-full bg-brand-green px-2 py-0.5 text-[10px] font-semibold text-white">
          Melhor preço
        </span>
      )}
      <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">
        {formatPlanBRL(plan.monthlyPrice)}
        <span className="text-sm font-normal text-gray-500">/mês</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {plan.months === 1
          ? 'Cobrado mensalmente'
          : `${formatPlanBRL(total)} a cada ${plan.months} meses`}
      </p>
    </button>
  );
}

// ─── CheckoutBlock (PIX/boleto na própria tela) ────────────────────────────────

function CheckoutBlock({
  checkout,
  method,
  onBack,
}: {
  checkout: CreateSubscriptionResult;
  method: PaymentMethod;
  onBack: () => void;
}) {
  const { invoiceUrl, bankSlipUrl } = checkout.checkout;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/10">
        <svg
          className="h-6 w-6 text-brand-green"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-gray-900">Cobrança gerada!</h2>
      <p className="text-sm text-gray-600 mt-1">
        {method === 'pix'
          ? 'Pague via PIX para ativar sua assinatura. A confirmação é automática.'
          : 'Seu boleto foi gerado. Após o pagamento, a assinatura é ativada automaticamente.'}
      </p>
      <p className="text-lg font-bold text-gray-900 mt-3">{formatPlanBRL(checkout.total)}</p>

      <div className="mt-4 flex flex-col gap-2">
        {invoiceUrl && (
          <a
            href={invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 text-sm font-semibold bg-brand-green text-white rounded-lg hover:bg-brand-greenDark"
          >
            {method === 'pix' ? 'Abrir PIX para pagar' : 'Abrir cobrança'}
          </a>
        )}
        {bankSlipUrl && (
          <a
            href={bankSlipUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Ver boleto
          </a>
        )}
      </div>

      <button type="button" onClick={onBack} className="mt-4 text-xs text-gray-500 hover:underline">
        Escolher outro plano
      </button>
    </div>
  );
}
