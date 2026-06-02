import type { Frete } from '../services/fretes';
import type { MotoristaCalcContext } from '../services/motorista';
import { useAuth } from '../hooks/useAuth';
import { Link } from 'react-router-dom';
import { calculateFreteFinanceiro, formatCurrencyBRL } from '../utils/calculoFrete';
import LikeButton from './LikeButton';

interface FreteCardProps {
  frete: Frete;
  onClick: () => void;
  hidePhone?: boolean;
  /**
   * Contexto de cálculo financeiro do motorista. Quando presente,
   * o card exibe um bloco com litros, custo de diesel, pedágio
   * (placeholder) e lucro líquido estimado. Sem essa prop, o card
   * renderiza exatamente como antes (não-regressão para visitantes
   * e embarcadores).
   */
  motoristaCalc?: MotoristaCalcContext;
  /** Mostra o coração no canto superior direito (apenas motorista). */
  showLikeButton?: boolean;
  /** Estado inicial do coração — vem do hidrato global. */
  initialLiked?: boolean;
  /** Callback chamado quando o motorista alterna o coração. */
  onLikeToggle?: (freteId: string, liked: boolean) => void;
  /**
   * Oculta o badge de status (ativo/encerrado/cancelado). Usado no feed do
   * motorista, onde só fretes ativos aparecem — exibir "Ativo" e redundante
   * (Req visual: solicitado pelo cliente para a versão mobile do motorista).
   * Embarcador (default false) continua vendo os 3 status.
   */
  hideStatus?: boolean;
}

export default function FreteCard({
  frete,
  onClick,
  motoristaCalc,
  showLikeButton,
  initialLiked,
  onLikeToggle,
  hideStatus,
}: FreteCardProps) {
  const { isAuthenticated } = useAuth();

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const formatDate = (date: Date) =>
    new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  // "Postado em DD/MM HH:MM" — usado na linha do valor, alinhado à direita.
  // Compacto para caber no card sem quebrar em telas estreitas.
  const formatPostedAt = (date: Date) => {
    const d = new Date(date);
    const dia = formatDate(d);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `Postado em ${dia} ${hora}`;
  };

  const statusStyles: Record<string, string> = {
    ativo: 'bg-green-100 text-green-700',
    encerrado: 'bg-gray-100 text-gray-600',
    cancelado: 'bg-red-100 text-red-700',
  };
  const statusLabels: Record<string, string> = {
    ativo: 'Ativo',
    encerrado: 'Encerrado',
    cancelado: 'Cancelado',
  };

  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-lg p-3 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer shadow-sm"
    >
      {/* Header: rota + (status condicional) + coração */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-800 truncate flex-1">
          {frete.origin} → {frete.destination}
        </h3>
        <div className="flex items-center gap-1 shrink-0">
          {!hideStatus && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                statusStyles[frete.status] || 'bg-gray-100 text-gray-600'
              }`}
            >
              {statusLabels[frete.status] || frete.status}
            </span>
          )}
          {showLikeButton && (
            <LikeButton
              freteId={frete.id}
              initialLiked={initialLiked}
              size="sm"
              onToggled={(liked) => onLikeToggle?.(frete.id, liked)}
            />
          )}
        </div>
      </div>

      {/* Produto (linha própria) + Tipo de carreta com km à direita */}
      <div className="space-y-1 mb-2">
        {frete.product && (
          <p className="text-xs text-gray-700">
            <span className="text-gray-400">Produto:</span>{' '}
            <span className="font-medium">{frete.product}</span>
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-gray-500 truncate flex-1" title={frete.vehicleType}>
            {frete.vehicleType}
          </p>
          {frete.distanceKm ? (
            <span className="text-[11px] text-gray-500 shrink-0">
              {frete.distanceKm.toLocaleString('pt-BR')} km
            </span>
          ) : null}
        </div>
      </div>

      {/* Linha de baixo: valor à esquerda, "Postado em DD/MM HH:MM" à direita */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <div className="flex-1 min-w-0">
          {isAuthenticated ? (
            <p className="text-sm font-semibold text-green-600">{formatCurrency(frete.value)}</p>
          ) : (
            <Link
              to="/login"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] text-blue-500 hover:text-blue-600 underline"
            >
              Login para ver
            </Link>
          )}
        </div>
        <span className="text-[11px] text-gray-400 shrink-0">
          {formatPostedAt(frete.createdAt)}
        </span>
      </div>

      {/* Bloco de cálculo financeiro — só renderiza quando motoristaCalc
          é fornecido. Sem a prop, o card permanece idêntico ao
          comportamento anterior (embarcador/visitante).

          IMPORTANTE: oculto no mobile (`<768px`). A "estimativa de viagem"
          fica reservada para a visualização detalhada (FreteModal). No mobile
          o card lista apenas os dados essenciais; ao tocar abre o modal e o
          motorista vê o cálculo lá dentro. */}
      <div className="hidden md:block">
        {motoristaCalc &&
          isAuthenticated &&
          (() => {
            const hasContext =
              motoristaCalc.kmPerLiter !== null &&
              motoristaCalc.kmPerLiter > 0 &&
              motoristaCalc.dieselPrice !== null &&
              motoristaCalc.dieselPrice >= 0;

            // Sem dados de cálculo no perfil → CTA pra completar.
            if (!hasContext) {
              return (
                <div className="mt-2 p-1.5 bg-yellow-50 border border-yellow-200 rounded text-center">
                  <Link
                    to="/perfil/motorista"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] text-yellow-800 font-medium underline"
                  >
                    Configure seu veículo para ver os cálculos
                  </Link>
                </div>
              );
            }

            // Sem distância → exibe aviso curto sem travar o card.
            if (!frete.distanceKm) {
              return (
                <div className="mt-2 p-1.5 bg-gray-50 border border-gray-200 rounded text-center">
                  <span className="text-[10px] text-gray-500">Distância não disponível</span>
                </div>
              );
            }

            // Detecta modo de pagamento do frete:
            //   - 'toneladas' / 'quilos' → bruto = valor × capacidade.
            //   - 'total' ou ausente → bruto = valor (frete fechado).
            const isPerTon =
              frete.priceCalculation === 'toneladas' || frete.priceCalculation === 'quilos';
            const cap = motoristaCalc.cargoCapacityTon ?? null;
            // Se o motorista não cadastrou capacidade, não dá pra estimar
            // por tonelada; cai pra modo fechado pra não esconder o card.
            const effectivePerTon = isPerTon && cap !== null && cap > 0;

            const calc = calculateFreteFinanceiro({
              distanceKm: frete.distanceKm,
              kmPerLiter: motoristaCalc.kmPerLiter as number,
              dieselPrice: motoristaCalc.dieselPrice as number,
              freteValue: frete.value,
              cargoCapacityTon: effectivePerTon ? (cap as number) : 1,
              pricingMode: effectivePerTon ? 'per_ton' : 'closed',
            });

            const lucroColor = calc.lucroLiquido >= 0 ? 'text-green-700' : 'text-red-600';

            return (
              <div className="mt-2 p-2 bg-blue-50/60 border border-blue-100 rounded space-y-0.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-600">Consumo</span>
                  <span className="font-medium text-gray-800">{motoristaCalc.kmPerLiter} km/L</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-600">Litros estimados</span>
                  <span className="font-medium text-gray-800">
                    {calc.litros.toLocaleString('pt-BR')} L
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-600">Custo de diesel</span>
                  <span className="font-medium text-gray-800">
                    {formatCurrencyBRL(calc.custoDiesel)}
                  </span>
                </div>
                {effectivePerTon ? (
                  <>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-600">Frete (R$/ton × {cap}t)</span>
                      <span className="font-medium text-gray-800">
                        {formatCurrencyBRL(calc.brutoRecebido)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-600">Valor do frete</span>
                    <span className="font-medium text-gray-800">
                      {formatCurrencyBRL(calc.brutoRecebido)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-[11px] pt-1 border-t border-blue-100">
                  <span className="text-gray-700 font-semibold">Lucro líquido</span>
                  <span className={`font-bold ${lucroColor}`}>
                    {formatCurrencyBRL(calc.lucroLiquido)}
                  </span>
                </div>
              </div>
            );
          })()}
      </div>

      {/* Banner para visitantes */}
      {!isAuthenticated && (
        <div className="mt-2 p-1.5 bg-blue-50 border border-blue-100 rounded text-center">
          <p className="text-[10px] text-blue-600">
            <Link
              to="/login"
              onClick={(e) => e.stopPropagation()}
              className="font-medium underline"
            >
              Crie uma conta grátis
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
