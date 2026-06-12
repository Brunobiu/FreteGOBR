import { useEffect, useState } from 'react';
import type { Frete } from '../services/fretes';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { getDocumentsByUser, resolveProfilePhotoUrl } from '../services/documents';
import { getEmbarcadorPublicCard } from '../services/embarcador';
import { formatCnpj } from '../services/cnpj';
import { listActiveCommodities } from '../services/commodities';
import { getOrCreateFreteConversation } from '../services/chatFrete';
import type { MotoristaCalcContext } from '../services/motorista';
import { calculateFreteFinanceiro, formatCurrencyBRL } from '../utils/calculoFrete';
import { buildWhatsAppDeepLink } from '../utils/communityFrete';
import { vehicleTypesCsvLabel } from '../data/vehicleTypes';
import { bodyTypesCsvLabel } from '../data/bodyTypes';
import FreteMiniMap from './FreteMiniMap';
import RotaTimeline from './RotaTimeline';
import FreteRetornoModal from './FreteRetornoModal';

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
  /**
   * Disparado quando o motorista escolhe um frete de retorno via
   * `FreteRetornoModal`. O consumidor (HomePage) deve fechar o modal
   * atual e abrir o detalhe do frete escolhido.
   */
  onSelectFreteRetorno?: (frete: Frete) => void;
  /** Identidade visual do Frete Comunidade (foto + nome da marca). */
  communityProfile?: { name: string; photoUrl: string | null } | null;
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
  onSelectFreteRetorno,
  communityProfile,
}: FreteModalProps) {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(false);
  const [returnSearchOpen, setReturnSearchOpen] = useState(false);
  /** URL da imagem sem fundo do produto (categoria), exibida no modal. */
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [embarcadorProfile, setEmbarcadorProfile] = useState<{
    companyName: string;
    companyLogoUrl: string | null;
    cnpj: string | null;
    photoUrl: string | null;
    userName: string | null;
    branchState: string | null;
    branchCity: string | null;
  } | null>(null);

  // Animação de entrada/saída. `mounted` controla a presença no DOM
  // (delayed unmount); `visible` controla a transição CSS de
  // translate/opacity. No mobile o painel sobe de baixo (translate-y-full →
  // translate-y-0); no desktop continua centralizado com leve fade/scale.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const ANIM_MS = 300;

  // Quando isOpen muda para true: monta e na próxima frame ativa visible
  // (dispara a transição CSS). Quando muda para false: desativa visible e
  // remove do DOM apenas após ANIM_MS, deixando a saída animar até o fim.
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      // requestAnimationFrame garante que o navegador aplica o estado
      // inicial (translate-y-full) antes de transicionar para visible.
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), ANIM_MS);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  // ESC fecha o modal (acessibilidade): só ativo enquanto montado e visível,
  // não interfere quando o modal está oculto.
  useEffect(() => {
    if (!mounted) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mounted, onClose]);

  useEffect(() => {
    if (mounted) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [mounted]);

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
    if (isOpen && frete && frete.source !== 'comunidade' && frete.embarcadorId) {
      const embId = frete.embarcadorId;
      getEmbarcadorPublicCard(embId)
        .then(async (p) => {
          if (!p) return;
          // Foto: prioriza a foto de perfil do embarcador; senao usa o logo
          // da empresa; senao cai na inicial (render).
          let photo: string | null = null;
          if (p.profilePhotoUrl) {
            try {
              photo = await resolveProfilePhotoUrl(p.profilePhotoUrl);
            } catch {
              photo = null;
            }
          }
          setEmbarcadorProfile({
            companyName: p.companyName || '',
            companyLogoUrl: p.companyLogoUrl,
            cnpj: p.cnpj,
            photoUrl: photo,
            userName: p.userName,
            branchState: p.branchState,
            branchCity: p.branchCity,
          });
        })
        .catch(() => {});
    }
  }, [isOpen, isAuthenticated, user, frete]);

  // Busca a imagem SEM fundo da categoria do produto (exibida à direita do
  // bloco de carga). Casa por productSlug; se não houver imagem sem fundo
  // cadastrada, fica null e nada é exibido.
  useEffect(() => {
    if (!isOpen || !frete) {
      setProductImageUrl(null);
      return;
    }
    const slug = frete.productSlug;
    if (!slug) {
      setProductImageUrl(null);
      return;
    }
    let cancelled = false;
    listActiveCommodities()
      .then((cats) => {
        if (cancelled) return;
        const match = cats.find((c) => c.slug === slug);
        setProductImageUrl(match?.imageNoBgUrl || null);
      })
      .catch(() => {
        if (!cancelled) setProductImageUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, frete]);

  if (!mounted || !frete) return null;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const formatWeight = (weight: number) =>
    weight >= 1000 ? `${(weight / 1000).toFixed(2)} ton` : `${weight} kg`;

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
    if (!user || !frete || !frete.embarcadorId) return;
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

  const isPerTon = frete.priceCalculation === 'toneladas' || frete.priceCalculation === 'quilos';
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
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[9999] overflow-hidden">
      {/* Backdrop com fade. */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black transition-opacity duration-300 ease-out ${
          visible ? 'opacity-75' : 'opacity-0'
        }`}
      />

      {/*
        Container do painel.
        - Mobile (<md): ancorado ao bottom (`items-end`); o painel anima
          translate-y (sobe de baixo) e tem cantos arredondados só em cima.
        - Desktop (md+): centralizado com fade/scale leve.
      */}
      <div className="fixed inset-0 flex items-end md:items-center justify-center pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className={`relative bg-gray-900 border border-gray-700 shadow-xl pointer-events-auto
            w-full md:max-w-2xl
            h-[90vh] md:h-[88vh]
            rounded-t-2xl md:rounded-lg
            flex flex-col overflow-hidden
            transform transition duration-300 ease-out
            ${
              visible
                ? 'translate-y-0 opacity-100 md:scale-100'
                : 'translate-y-full opacity-0 md:translate-y-4 md:scale-95'
            }`}
        >
          {/* Handle de arrasto: clicável para fechar o modal (substitui o X).
              No desktop também aparece, servindo de botão de fechar discreto. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex justify-center pt-2.5 pb-1.5 shrink-0 w-full focus:outline-none"
          >
            <span className="block h-1 w-10 rounded-full bg-gray-300" aria-hidden="true" />
          </button>

          {/* Cabecalho fixo: perfil do embarcador.
              Permanece visivel enquanto o motorista rola o miolo. */}
          <div className="relative shrink-0 bg-gray-900 px-3 sm:px-4 py-2.5">
            {frete.source === 'comunidade' ? (
              <div className="flex items-center gap-3 pr-7">
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gray-800 border border-gray-700 overflow-hidden shrink-0 flex items-center justify-center">
                  {communityProfile?.photoUrl ? (
                    <img
                      src={communityProfile.photoUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="text-xs font-semibold text-gray-400">C</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="text-xs font-semibold text-gray-100 truncate">Frete Comunidade</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    Frete sugerido pela comunidade
                  </p>
                  {frete.communityCarrierName && (
                    <p className="text-[10px] text-gray-500 truncate">
                      <span className="text-gray-400">Transportadora: </span>
                      {frete.communityCarrierName}
                    </p>
                  )}
                </div>
              </div>
            ) : embarcadorProfile ? (
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-gray-800 border border-gray-700 overflow-hidden shrink-0 flex items-center justify-center"
                  aria-hidden="true"
                >
                  {embarcadorProfile.photoUrl || embarcadorProfile.companyLogoUrl ? (
                    <img
                      src={embarcadorProfile.photoUrl ?? embarcadorProfile.companyLogoUrl ?? ''}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="text-sm font-semibold text-gray-400">
                      {(embarcadorProfile.userName || embarcadorProfile.companyName || '?')
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="text-sm font-semibold text-gray-100 truncate">
                    {embarcadorProfile.userName || embarcadorProfile.companyName || 'Embarcador'}
                  </p>
                  {embarcadorProfile.companyName && (
                    <p className="text-xs text-gray-400 truncate">
                      {embarcadorProfile.companyName}
                      {embarcadorProfile.cnpj && ` — ${formatCnpj(embarcadorProfile.cnpj)}`}
                    </p>
                  )}
                  {(embarcadorProfile.branchState || embarcadorProfile.branchCity) && (
                    <p className="text-[10px] text-gray-500 truncate">
                      <span className="text-gray-400">Filial: </span>
                      {[embarcadorProfile.branchCity, embarcadorProfile.branchState?.toUpperCase()]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>

                {/* Ícone de perfil (placeholder): futuramente abrirá o perfil
                    público do embarcador para o motorista. Sem ação por ora.
                    Estilo cartão/carteirinha, contorno, sem fundo. */}
                <svg
                  aria-hidden="true"
                  className="shrink-0 w-6 h-6 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2.5" />
                  <circle cx="9" cy="10" r="2" />
                  <path strokeLinecap="round" d="M6 15.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5" />
                  <path strokeLinecap="round" d="M15 9.5h3.5M15 12.5h3.5M15 15.5h3" />
                </svg>
              </div>
            ) : (
              <div className="text-xs font-semibold text-gray-300 pr-7">Detalhes do Frete</div>
            )}
          </div>

          {/* Miolo rolavel — toda a info do frete, mapa, calculo,
              acoes. O cabecalho acima permanece fixo. */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            <h2 className="sr-only">Detalhes do Frete</h2>

            {/* Card "tracking": o mapa preenche todo o fundo; um degradê
                (escuro→transparente da esquerda) funde o mapa com a área de
                texto, e a timeline origem→destino fica POR CIMA, à esquerda.
                Clicar no mapa (lado direito visível) expande em tela cheia.

                z-index: o mapa fica em z-0 (a classe `z-0` + position cria um
                stacking context que PRENDE as camadas internas do Leaflet —
                que têm z-index alto). Sem isso, os tiles/marcadores do Leaflet
                pintam por cima do degradê e do texto. O degradê vai em z-10 e
                a timeline em z-20. */}
            <div className="mb-3 relative w-full h-32 sm:h-36 rounded-xl overflow-hidden border border-gray-700 bg-gray-900 isolate">
              {/* Fundo: mapa sem moldura, preenchendo o card todo. */}
              <div className="absolute inset-0 z-0">
                <FreteMiniMap frete={frete} bare />
              </div>
              {/* Degradê por cima do mapa: escuro e sólido na esquerda, começa
                  a clarear só a partir do MEIO para a direita (deixa a rota
                  aparecer à direita). */}
              <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(10,15,25,0.99) 0%, rgba(10,15,25,0.98) 50%, rgba(10,15,25,0.75) 70%, rgba(10,15,25,0.2) 90%, rgba(10,15,25,0) 100%)',
                }}
              />
              {/* Timeline por cima, centralizada na vertical, à esquerda. */}
              <div className="absolute inset-y-0 left-0 z-20 w-[58%] sm:w-[54%] flex flex-col justify-center pl-3 pr-2 pointer-events-none">
                <div className="pointer-events-auto w-full">
                  <RotaTimeline
                    dark
                    origem={{
                      cidade: frete.origin,
                      local: frete.originDetail,
                      lat: frete.originPinnedLat,
                      lng: frete.originPinnedLng,
                    }}
                    destino={{
                      cidade: frete.destination,
                      local: frete.destinationDetail,
                      lat: frete.destinationPinnedLat,
                      lng: frete.destinationPinnedLng,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Cabeçalho da carga: quilometragem (esquerda) + data de
                postagem (direita), com linha clara de separação. */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs text-gray-500">
                {frete.distanceKm ? `${frete.distanceKm.toLocaleString('pt-BR')} km` : ''}
              </span>
              <span className="text-[11px] text-gray-400">
                Postado em{' '}
                {new Date(frete.createdAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div className="border-t border-gray-700 mb-3" />

            {/* Carga — label em cima, valor embaixo, sem caixas. À direita,
                quando houver, a imagem SEM fundo do produto (categoria),
                "sangrando" pela borda direita do modal. */}
            <div className="relative mb-3">
              {productImageUrl && (
                <div className="pointer-events-none absolute -right-3 sm:-right-4 top-1/2 -translate-y-1/2 w-28 sm:w-36 h-28 sm:h-36 flex items-center justify-end">
                  <img
                    src={productImageUrl}
                    alt=""
                    className="max-w-full max-h-full object-contain drop-shadow-xl translate-x-1/4"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
              <div
                className={`grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 ${
                  productImageUrl ? 'pr-24 sm:pr-28' : ''
                }`}
              >
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Tipo de Carga</p>
                  <p className="text-sm text-gray-100">{frete.cargoType || '—'}</p>
                </div>
                {frete.cargoSpecies && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Espécie</p>
                    <p className="text-sm text-gray-100">{frete.cargoSpecies}</p>
                  </div>
                )}
                {frete.product && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Produto</p>
                    <p className="text-sm text-gray-100">{frete.product}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Tipo de frete</p>
                  <p className="text-sm text-gray-100">
                    {FREIGHT_TYPE_LABELS[frete.freightType ?? 'completa'] ??
                      frete.freightType ??
                      '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Peso</p>
                  <p className="text-sm text-gray-100">{formatWeight(frete.weight)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Veículo</p>
                  <p
                    className="text-sm text-gray-100 leading-tight whitespace-normal break-words"
                    title={vehicleTypesCsvLabel(frete.vehicleType)}
                  >
                    {vehicleTypesCsvLabel(frete.vehicleType)}
                  </p>
                </div>
                {frete.bodyTypes && (
                  <div className="col-span-2 sm:col-span-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Carrocerias</p>
                    <p className="text-sm text-gray-100 leading-tight whitespace-normal break-words">
                      {bodyTypesCsvLabel(frete.bodyTypes)}
                    </p>
                  </div>
                )}
              </div>
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

            {/* Valor (destacado) + Prazo + Pagamento + Adiantamento, sem caixas. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Valor</p>
                {isAuthenticated ? (
                  <p className="text-green-400 font-semibold text-base">
                    {formatCurrency(frete.value)}
                  </p>
                ) : (
                  <button
                    onClick={() => navigate('/login')}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    Login para ver
                  </button>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Prazo</p>
                <p className="text-sm text-gray-100">
                  {new Date(frete.deadline).toLocaleDateString('pt-BR')}
                </p>
              </div>
              {frete.paymentMethods && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Pagamento</p>
                  <p className="text-sm text-gray-100 break-words" title={frete.paymentMethods}>
                    {frete.paymentMethods}
                  </p>
                </div>
              )}
              {frete.advancePercentage !== undefined && frete.advancePercentage > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Adiantamento</p>
                  <p className="text-sm text-gray-100">{frete.advancePercentage}%</p>
                </div>
              )}
            </div>

            {/* Cálculo financeiro estimado (motorista) */}
            {hasCalcContext && (
              <div className="mb-2 p-2 bg-blue-950/40 border border-blue-900/50 rounded">
                <p className="text-[10px] text-blue-300 font-semibold uppercase tracking-wide mb-1">
                  Estimativa para sua viagem
                </p>
                {!frete.distanceKm ? (
                  <p className="text-[11px] text-gray-400">Distância não disponível</p>
                ) : calc ? (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Distância</span>
                      <span className="font-medium text-gray-100">
                        {frete.distanceKm.toLocaleString('pt-BR')} km
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Consumo</span>
                      <span className="font-medium text-gray-100">
                        {motoristaCalc!.kmPerLiter} km/L
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Litros estimados</span>
                      <span className="font-medium text-gray-100">
                        {calc.litros.toLocaleString('pt-BR')} L
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">Custo de diesel</span>
                      <span className="font-medium text-gray-100">
                        {formatCurrencyBRL(calc.custoDiesel)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">
                        {effectivePerTon ? `Frete (R$/ton × ${cap}t)` : 'Valor do frete'}
                      </span>
                      <span className="font-medium text-gray-100">
                        {formatCurrencyBRL(calc.brutoRecebido)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] pt-1 border-t border-blue-900/50">
                      <span className="text-gray-200 font-semibold">Lucro líquido</span>
                      <span
                        className={`font-bold ${
                          calc.lucroLiquido >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {formatCurrencyBRL(calc.lucroLiquido)}
                      </span>
                    </div>
                  </div>
                ) : null}
                <p className="mt-1.5 text-[10px] text-yellow-300 bg-yellow-950/40 border border-yellow-900/50 rounded px-1.5 py-1">
                  ⚠ Valor do diesel é apenas uma estimativa. Os custos reais podem variar.
                </p>
              </div>
            )}

            {/* Observações */}
            {frete.specifications && (
              <div className="mb-2">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">
                  Observações
                </p>
                <div className="bg-gray-800 p-2 rounded border border-gray-700">
                  <p className="text-[11px] text-gray-200 whitespace-pre-wrap">
                    {frete.specifications}
                  </p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-gray-700">
              {/* "Frete de Retorno": primeiro botao a esquerda quando
                  motorista logado com perfil completo. Cor roxa pra
                  destacar (Chat=azul, WhatsApp=verde). */}
              {isAuthenticated && user?.userType === 'motorista' && profileComplete === true && (
                <button
                  onClick={() => setReturnSearchOpen(true)}
                  aria-label="Buscar fretes de retorno"
                  className="mr-auto px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded hover:bg-purple-700 flex items-center gap-1"
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
                      d="M3 10h10a8 8 0 018 8v2M3 10l6-6M3 10l6 6"
                    />
                  </svg>
                  <span className="hidden sm:inline">Frete e retorno</span>
                  <span className="sm:hidden">Frete e retorno</span>
                </button>
              )}

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
                profileComplete === true &&
                frete.source === 'comunidade' &&
                (() => {
                  const waLink = buildWhatsAppDeepLink(frete.communityContactPhone ?? '');
                  if (!waLink) {
                    return (
                      <span className="px-3 py-1.5 bg-gray-100 text-gray-500 text-xs font-medium rounded">
                        Contato indisponível
                      </span>
                    );
                  }
                  return (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-green-500 text-white text-xs font-medium rounded hover:bg-green-600 flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                      WhatsApp
                    </a>
                  );
                })()}

              {isAuthenticated &&
                user?.userType === 'motorista' &&
                profileComplete === true &&
                frete.source !== 'comunidade' && (
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

      {/* Modal de Frete de Retorno: busca cargas a partir do destino
          do frete atual. Quando o motorista escolhe um, delegamos
          ao consumidor (HomePage) via callback `onSelectFreteRetorno`,
          que decide como abrir o detalhe do novo frete. */}
      {frete && (
        <FreteRetornoModal
          open={returnSearchOpen}
          onClose={() => setReturnSearchOpen(false)}
          origemFrete={frete}
          onSelectRetorno={(novoFrete) => {
            setReturnSearchOpen(false);
            if (onSelectFreteRetorno) {
              onSelectFreteRetorno(novoFrete);
            }
          }}
        />
      )}
    </div>
  );
}
