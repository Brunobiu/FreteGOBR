import { useEffect, useState } from 'react';
import type { Frete } from '../services/fretes';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { getDocumentsByUser } from '../services/documents';
import { getEmbarcadorProfile } from '../services/embarcador';
import { getOrCreateFreteConversation } from '../services/chatFrete';
import type { MotoristaCalcContext } from '../services/motorista';
import { calculateFreteFinanceiro, formatCurrencyBRL } from '../utils/calculoFrete';
import { googleMapsUrl } from '../utils/coordParser';

const REQUIRED_DOCS = [
  'cpf',
  'cnh',
  'antt',
  'vehicle_registration',
  'vehicle_insurance',
  'profile_photo',
];

interface FreteModalProps {
  frete: Frete | null;
  isOpen: boolean;
  onClose: () => void;
  embarcadorWhatsApp?: string;
  motoristaCalc?: MotoristaCalcContext;
}

const FREIGHT_TYPE_LABELS: Record<string, string> = {
  completa: 'Carga completa',
  complemento: 'Complemento',
  peso_balanca: 'Peso de balança',
  caixote_cheio: 'Caixote cheio',
};

export default function FreteModal({
  frete,
  isOpen,
  onClose,
  embarcadorWhatsApp,
  motoristaCalc,
}: FreteModalProps) {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(false);
  const [embarcadorName, setEmbarcadorName] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Verifica perfil completo quando motorista logado abre o modal
  useEffect(() => {
    if (isOpen && isAuthenticated && user?.userType === 'motorista') {
      setCheckingProfile(true);
      getDocumentsByUser(user.id)
        .then((docs) => {
          const docTypes = docs.map((d) => d.documentType);
          const allDone = REQUIRED_DOCS.every((r) =>
            docTypes.includes(r as (typeof docTypes)[number])
          );
          setProfileComplete(allDone);
        })
        .catch(() => setProfileComplete(false))
        .finally(() => setCheckingProfile(false));
    }
    if (isOpen && frete) {
      getEmbarcadorProfile(frete.embarcadorId)
        .then((p) => {
          if (p) setEmbarcadorName(p.companyName || '');
        })
        .catch(() => {});
    }
  }, [isOpen, isAuthenticated, user, frete]);

  if (!isOpen || !frete) return null;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const formatWeight = (weight: number) =>
    weight >= 1000 ? `${(weight / 1000).toFixed(2)} ton` : `${weight} kg`;

  const formatDateTime = (date: Date) =>
    new Date(date).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const handleContratar = () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (user?.userType !== 'motorista') {
      alert('Apenas motoristas podem contratar fretes');
      return;
    }
    if (profileComplete === false) {
      if (
        confirm(
          'Seu perfil precisa estar 100% completo para contratar fretes. Deseja completar agora?'
        )
      ) {
        navigate('/perfil/motorista');
      }
      return;
    }
    if (embarcadorWhatsApp) {
      const phone = embarcadorWhatsApp.replace(/\D/g, '');
      const message = encodeURIComponent(
        `Olá! Vim do FreteGO. Tenho interesse na viagem de ${frete.origin} para ${frete.destination}.\n` +
          `Meu nome é ${user?.name}. Podemos conversar?`
      );
      window.open(`https://wa.me/55${phone}?text=${message}`, '_blank');
    }
  };

  const handleOpenChat = async () => {
    if (!user || !frete) return;
    try {
      const conv = await getOrCreateFreteConversation(frete.id, user.id, frete.embarcadorId);
      onClose();
      navigate(`/mensagens?conversation=${conv.id}`);
    } catch (err) {
      console.error('Erro ao abrir chat:', err);
    }
  };

  // ── Cálculo financeiro (replica do FreteCard, exibido dentro do modal) ──
  const isMotorista = user?.userType === 'motorista';
  const hasCalcContext =
    isMotorista &&
    motoristaCalc &&
    motoristaCalc.kmPerLiter !== null &&
    motoristaCalc.kmPerLiter > 0 &&
    motoristaCalc.dieselPrice !== null &&
    motoristaCalc.dieselPrice >= 0;

  const isPerTon =
    frete.priceCalculation === 'toneladas' || frete.priceCalculation === 'quilos';
  const cap = motoristaCalc?.cargoCapacityTon ?? null;
  const effectivePerTon = isPerTon && cap !== null && cap > 0;

  const calc =
    hasCalcContext && frete.distanceKm
      ? calculateFreteFinanceiro({
          distanceKm: frete.distanceKm,
          kmPerLiter: motoristaCalc!.kmPerLiter as number,
          dieselPrice: motoristaCalc!.dieselPrice as number,
          freteValue: frete.value,
          cargoCapacityTon: effectivePerTon ? (cap as number) : 1,
          pricingMode: effectivePerTon ? 'per_ton' : 'closed',
        })
      : null;

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-75" onClick={onClose} />

      <div className="flex min-h-full items-center justify-center p-2 sm:p-4">
        <div className="relative bg-white rounded-lg max-w-2xl w-full border border-gray-200 shadow-xl">
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-700 p-1 z-10"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <div className="p-3 sm:p-4">
            <h2 className="text-sm sm:text-base font-bold text-gray-800 mb-2 pr-7">
              Detalhes do Frete
            </h2>

            {/* Origem → Destino com detalhes embutidos */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-blue-50 border border-blue-200 rounded p-2">
                <p className="text-[10px] text-blue-700 font-semibold uppercase tracking-wide mb-0.5">
                  Origem
                </p>
                <p className="text-xs font-semibold text-gray-800 break-words">{frete.origin}</p>
                {frete.originDetail && (
                  <p className="text-[11px] text-gray-700 mt-0.5 break-words">
                    📍 {frete.originDetail}
                  </p>
                )}
                {frete.originPinnedLat !== undefined &&
                  frete.originPinnedLng !== undefined && (
                    <a
                      href={googleMapsUrl({
                        latitude: frete.originPinnedLat,
                        longitude: frete.originPinnedLng,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-900 underline font-medium"
                    >
                      🗺 Abrir no Maps
                    </a>
                  )}
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded p-2">
                <p className="text-[10px] text-orange-700 font-semibold uppercase tracking-wide mb-0.5">
                  Destino
                </p>
                <p className="text-xs font-semibold text-gray-800 break-words">{frete.destination}</p>
                {frete.destinationDetail && (
                  <p className="text-[11px] text-gray-700 mt-0.5 break-words">
                    📍 {frete.destinationDetail}
                  </p>
                )}
                {frete.destinationPinnedLat !== undefined &&
                  frete.destinationPinnedLng !== undefined && (
                    <a
                      href={googleMapsUrl({
                        latitude: frete.destinationPinnedLat,
                        longitude: frete.destinationPinnedLng,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-orange-700 hover:text-orange-900 underline font-medium"
                    >
                      🗺 Abrir no Maps
                    </a>
                  )}
              </div>
            </div>

            {/* Carga */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-2">
              <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                <p className="text-[10px] text-gray-500">Tipo de Carga</p>
                <p className="text-xs text-gray-800 font-medium">{frete.cargoType || '—'}</p>
              </div>
              {frete.cargoSpecies && (
                <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                  <p className="text-[10px] text-gray-500">Espécie</p>
                  <p className="text-xs text-gray-800 font-medium">{frete.cargoSpecies}</p>
                </div>
              )}
              {frete.product && (
                <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                  <p className="text-[10px] text-gray-500">Produto</p>
                  <p className="text-xs text-gray-800 font-medium">{frete.product}</p>
                </div>
              )}
              <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                <p className="text-[10px] text-gray-500">Tipo de frete</p>
                <p className="text-xs text-gray-800 font-medium">
                  {FREIGHT_TYPE_LABELS[frete.freightType ?? 'completa'] ?? frete.freightType ?? '—'}
                </p>
              </div>
              <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                <p className="text-[10px] text-gray-500">Peso</p>
                <p className="text-xs text-gray-800 font-medium">{formatWeight(frete.weight)}</p>
              </div>
              <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                <p className="text-[10px] text-gray-500">Veículo</p>
                <p className="text-xs text-gray-800 font-medium truncate" title={frete.vehicleType}>
                  {frete.vehicleType || '—'}
                </p>
              </div>
              {frete.bodyTypes && (
                <div className="bg-gray-50 p-1.5 rounded border border-gray-200 col-span-2 sm:col-span-3">
                  <p className="text-[10px] text-gray-500">Carrocerias</p>
                  <p className="text-xs text-gray-800 font-medium">{frete.bodyTypes}</p>
                </div>
              )}
            </div>

            {/* Opções adicionais */}
            {(frete.requiresLona || frete.requiresTracker || frete.requiresInsurance) && (
              <div className="flex flex-wrap gap-1 mb-2">
                {frete.requiresLona && (
                  <span className="px-1.5 py-0.5 bg-yellow-50 border border-yellow-200 rounded text-[10px] text-yellow-800">
                    Lona obrigatória
                  </span>
                )}
                {frete.requiresTracker && (
                  <span className="px-1.5 py-0.5 bg-yellow-50 border border-yellow-200 rounded text-[10px] text-yellow-800">
                    Rastreador
                  </span>
                )}
                {frete.requiresInsurance && (
                  <span className="px-1.5 py-0.5 bg-yellow-50 border border-yellow-200 rounded text-[10px] text-yellow-800">
                    Seguro
                  </span>
                )}
              </div>
            )}

            {/* Valor + Pagamento + Adiantamento + Prazo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
              <div className="bg-green-50 p-1.5 rounded border border-green-200">
                <p className="text-[10px] text-green-700">Valor</p>
                {isAuthenticated ? (
                  <p className="text-green-700 font-bold text-xs">
                    {formatCurrency(frete.value)}
                  </p>
                ) : (
                  <button
                    onClick={() => navigate('/login')}
                    className="text-[10px] text-blue-500 hover:underline"
                  >
                    Login para ver
                  </button>
                )}
              </div>
              <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                <p className="text-[10px] text-gray-500">Prazo</p>
                <p className="text-xs text-gray-800 font-medium">
                  {new Date(frete.deadline).toLocaleDateString('pt-BR')}
                </p>
              </div>
              {frete.paymentMethods && (
                <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                  <p className="text-[10px] text-gray-500">Pagamento</p>
                  <p className="text-xs text-gray-800 font-medium truncate" title={frete.paymentMethods}>
                    {frete.paymentMethods}
                  </p>
                </div>
              )}
              {frete.advancePercentage !== undefined && frete.advancePercentage > 0 && (
                <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                  <p className="text-[10px] text-gray-500">Adiantamento</p>
                  <p className="text-xs text-gray-800 font-medium">{frete.advancePercentage}%</p>
                </div>
              )}
            </div>

            {/* Cálculo financeiro estimado (motorista) */}
            {hasCalcContext && (
              <div className="mb-2 p-2 bg-blue-50/60 border border-blue-100 rounded">
                <p className="text-[10px] text-blue-700 font-semibold uppercase tracking-wide mb-1">
                  Estimativa para sua viagem
                </p>
                {!frete.distanceKm ? (
                  <p className="text-[11px] text-gray-500">Distância não disponível</p>
                ) : calc ? (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-600">Distância</span>
                      <span className="font-medium text-gray-800">
                        {frete.distanceKm.toLocaleString('pt-BR')} km
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-600">Consumo</span>
                      <span className="font-medium text-gray-800">
                        {motoristaCalc!.kmPerLiter} km/L
                      </span>
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
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-600">
                        {effectivePerTon ? `Frete (R$/ton × ${cap}t)` : 'Valor do frete'}
                      </span>
                      <span className="font-medium text-gray-800">
                        {formatCurrencyBRL(calc.brutoRecebido)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] pt-1 border-t border-blue-100">
                      <span className="text-gray-700 font-semibold">Lucro líquido</span>
                      <span
                        className={`font-bold ${
                          calc.lucroLiquido >= 0 ? 'text-green-700' : 'text-red-600'
                        }`}
                      >
                        {formatCurrencyBRL(calc.lucroLiquido)}
                      </span>
                    </div>
                  </div>
                ) : null}
                <p className="mt-1.5 text-[10px] text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-1.5 py-1">
                  ⚠ Valor do diesel é apenas uma estimativa. Os custos reais podem variar.
                </p>
              </div>
            )}

            {/* Observações */}
            {frete.specifications && (
              <div className="mb-2">
                <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-0.5">
                  Observações
                </p>
                <div className="bg-gray-50 p-2 rounded border border-gray-200">
                  <p className="text-[11px] text-gray-700 whitespace-pre-wrap">
                    {frete.specifications}
                  </p>
                </div>
              </div>
            )}

            {/* Postado por + data/hora */}
            <div className="mb-3 text-[10px] text-gray-500 flex items-center justify-between flex-wrap gap-1">
              {embarcadorName && (
                <span>
                  Postado por <span className="text-gray-700 font-medium">{embarcadorName}</span>
                </span>
              )}
              <span>Frete postado em {formatDateTime(frete.createdAt)}</span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={onClose}
                className="px-3 py-1.5 bg-gray-200 text-gray-800 text-xs font-medium rounded hover:bg-gray-300"
              >
                Fechar
              </button>

              {!isAuthenticated && (
                <button
                  onClick={() => navigate('/login')}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700"
                >
                  Login para Contratar
                </button>
              )}

              {isAuthenticated &&
                user?.userType === 'motorista' &&
                profileComplete === false &&
                !checkingProfile && (
                  <button
                    onClick={() => navigate('/perfil/motorista')}
                    className="px-3 py-1.5 bg-yellow-500 text-white text-xs font-medium rounded hover:bg-yellow-600 flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Completar Perfil
                  </button>
                )}

              {isAuthenticated &&
                user?.userType === 'motorista' &&
                profileComplete === true &&
                embarcadorWhatsApp && (
                  <button
                    onClick={handleContratar}
                    className="px-3 py-1.5 bg-green-500 text-white text-xs font-medium rounded hover:bg-green-600 flex items-center gap-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    WhatsApp
                  </button>
                )}

              {isAuthenticated &&
                user?.userType === 'motorista' &&
                profileComplete === true && (
                  <button
                    onClick={handleOpenChat}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 flex items-center gap-1"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                      />
                    </svg>
                    Chat
                  </button>
                )}

              {isAuthenticated && user?.userType === 'motorista' && checkingProfile && (
                <button
                  disabled
                  className="px-3 py-1.5 bg-gray-300 text-gray-500 text-xs font-medium rounded cursor-not-allowed"
                >
                  Verificando...
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
