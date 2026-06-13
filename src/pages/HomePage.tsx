import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  getActiveFretes,
  incrementFreteViews,
  invalidateActiveFretesCache,
  type Frete,
  type FreteFilters,
} from '../services/fretes';
import { supabase } from '../services/supabase';
import AppHeader from '../components/AppHeader';
import TrialExpiredPage from './TrialExpiredPage';
import MotoristaBottomNav from '../components/MotoristaBottomNav';
import FreteCard from '../components/FreteCard';
import FreteModal from '../components/FreteModal';
import FreteFiltersComponent from '../components/FreteFilters';
import RadiusSelector from '../components/RadiusSelector';
import FreteTable from '../components/FreteTable';
import ViewToggle from '../components/ViewToggle';
import DieselDashboardInput from '../components/DieselDashboardInput';
import { useViewPreference } from '../hooks/useViewPreference';
import { useIsMobile } from '../hooks/useIsMobile';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuth } from '../hooks/useAuth';
import { useTrialStatus } from '../hooks/useTrialStatus';
import { useEffectiveLocation } from '../hooks/useEffectiveLocation';
import { useTabSlideClass } from '../hooks/useTabTransition';
import { getMotoristaCalcContext, type MotoristaCalcContext } from '../services/motorista';
import { getLikedFreteIds } from '../services/likes';
import {
  getCommunityPublicProfile,
  type CommunityPublicProfile,
} from '../services/communityPublic';
import FreteListSkeleton from '../components/FreteListSkeleton';
import AiFab from '../components/AiFab';
import AnunciosCarousel from '../components/AnunciosCarousel';
import CommoditiesCarousel from '../components/CommoditiesCarousel';
import LocationHintBalloon from '../components/LocationHintBalloon';
import {
  RADIUS_DEFAULT_KM,
  RADIUS_STORAGE_KEY,
  filterFretesByRadius,
  readStoredRadius,
  writeStoredRadius,
  type RadiusOption,
} from '../utils/geoDistance';

// Lazy import: leaflet + react-leaflet só caem no chunk quando o embarcador/
// visitante abre o mapa ("Ver mapa"). Mantém o leaflet fora do bundle inicial.
import MapaToolbar from '../components/MapaToolbar';

// Lazy: InteractiveMap puxa leaflet/react-leaflet. Só carrega quando showMap
// fica true (botão "Ver mapa" do embarcador). O motorista usa MapaToolbar,
// que já lazy-carrega o próprio mapa.
const InteractiveMap = lazy(() => import('../components/InteractiveMap'));

export default function HomePage() {
  const { user } = useAuth();
  useDocumentTitle(user?.userType === 'motorista' ? 'Motorista' : null);
  const slideClass = useTabSlideClass();
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrete, setSelectedFrete] = useState<Frete | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Pilha de fretes em visualizacao. Cada vez que o motorista entra
  // num "Frete e retorno", o frete original eh empilhado e o novo
  // vira o `selectedFrete`. Ao fechar o modal, fazemos pop: se ha
  // alguem na pilha, volta pro frete anterior; senao, fecha de vez.
  // Isso preserva o contexto de navegacao por retornos encadeados.
  const [, setFreteStack] = useState<Frete[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const listTopRef = useRef<HTMLDivElement>(null);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(page);
    // Espera o DOM aplicar a mudança de página antes de calcular a posição.
    // Dois rAFs garantem que o paint depois do re-render já aconteceu.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = listTopRef.current;
        if (!el) return;
        const headerOffset = window.innerWidth >= 640 ? 112 : 96;
        const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      });
    });
  }, []);
  const [showMap, setShowMap] = useState(false);
  const currentFiltersRef = useRef<FreteFilters>({});
  const itemsPerPage = 9;
  const [viewMode, setViewMode] = useViewPreference('fretego-view-home', 'cards');
  const isMobile = useIsMobile();
  // Motorista sempre vê cards. Apenas embarcador/visitante alternam entre cards/tabela no desktop.
  const effectiveView = isMobile || user?.userType === 'motorista' ? 'cards' : viewMode;

  // Contexto de cálculo financeiro do motorista (km/l + diesel).
  // Carregado apenas no ramo motorista; nulo até carregar.
  const [motoristaCalc, setMotoristaCalc] = useState<MotoristaCalcContext | null>(null);
  const [calcLoaded, setCalcLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [communityProfile, setCommunityProfile] = useState<CommunityPublicProfile | null>(null);

  useEffect(() => {
    void getCommunityPublicProfile()
      .then(setCommunityProfile)
      .catch(() => {});
  }, []);

  // Conjunto de fretes que o motorista já curtiu — hidrata os corações.
  const [likedFreteIds, setLikedFreteIds] = useState<Set<string>>(new Set());

  // Balao flutuante de localizacao (motorista sem GPS). Comeca como `true`
  // e auto-some apos 10s ou quando o motorista clica no X. NAO persiste
  // dismiss — a cada refresh volta a aparecer enquanto a localizacao
  // continuar indisponivel. O sistema so funciona bem com GPS, entao a
  // UI insiste nesse aviso ate o motorista resolver.
  const [locationHintVisible, setLocationHintVisible] = useState(true);

  const isMotorista = user?.userType === 'motorista';

  // Bloqueio de trial (Req 5.6): motorista com trial expirado e sem assinatura
  // tem o feed de fretes substituído pela TrialExpiredPage. A autoridade do
  // estado é o servidor (RLS); aqui é apenas a UX imediata, usando a MESMA
  // fonte do hook (useAuth) já consumida por useTrialStatus.
  const { isExpired, status: subscriptionStatus } = useTrialStatus();
  // Suspenso/cancelado: vê o feed, mas não interage (banner de aviso + CTA).
  // 'blocked' é o status cru de suspensão por assinatura (migration 058).
  const isMotoristaSuspenso =
    isMotorista && (subscriptionStatus === 'blocked' || subscriptionStatus === 'canceled');
  const isMotoristaBloqueado = isMotorista && isExpired;

  // Geolocalizacao do motorista. Antes haviam DUAS instancias do hook
  // useGeolocation (uma direta + outra dentro de useEffectiveLocation),
  // cada uma com estado proprio. So a externa recebia requestLocation;
  // a interna ficava em 'idle' e o `effectiveLoc.point` saia null,
  // fazendo filterFretesByRadius retornar a lista inteira sem filtrar
  // pelo raio escolhido. Agora usamos APENAS useEffectiveLocation e
  // disparamos o requestLocation dele — assim o ponto efetivo (override
  // manual ou GPS) sempre fica em sincronia com o estado do filtro.
  const effectiveLoc = useEffectiveLocation();

  // Dispara request de localização uma vez quando o usuário é motorista.
  useEffect(() => {
    if (!isMotorista) return;
    effectiveLoc.requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMotorista]);

  // Estado de raio com hidratação de localStorage
  const [radiusKm, setRadiusKm] = useState<RadiusOption>(() => {
    if (typeof window === 'undefined') return RADIUS_DEFAULT_KM;
    return readStoredRadius(window.localStorage.getItem(RADIUS_STORAGE_KEY));
  });
  const handleRadiusChange = useCallback((next: RadiusOption) => {
    setRadiusKm(next);
    writeStoredRadius(next);
  }, []);

  // Paralelização de fetches independentes (Req 4.1-4.4, 3.5, 3.6):
  // Os fetches de Secondary_Data já são paralelos POR CONSTRUÇÃO — cada um
  // roda no seu próprio useEffect, disparado no mesmo ciclo de render, sem
  // dependência entre si. `getMotoristaCalcContext` e `getLikedFreteIds`
  // (ambos deps [isMotorista, user]) iniciam concorrentemente e cada um
  // atualiza seu próprio estado assim que resolve, de forma independente.
  // Decisão de não-regressão: NÃO agrupá-los via `aggregateSettled`. O
  // agregador aguarda `Promise.allSettled`, o que ACOPLARIA os updates —
  // o fetch mais rápido só refletiria na UI após o mais lento concluir,
  // atrasando o paint de uma região por causa da outra (contraria Req 3.5
  // e 9.4) sem nenhum ganho de paralelismo (já existe). `aggregateSettled`
  // é a ferramenta certa quando um ÚNICO consumidor precisa agregar vários
  // datasets juntos; aqui cada dataset alimenta uma região/estado separado.
  // Falhas parciais já não bloqueiam sucessos: cada effect tem seu próprio
  // tratamento de erro (calc cai em fallback, likes mantém estado anterior).
  useEffect(() => {
    if (!isMotorista || !user) {
      setMotoristaCalc(null);
      setCalcLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getMotoristaCalcContext(user.id);
        if (!cancelled) {
          setMotoristaCalc(ctx);
          setCalcLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setMotoristaCalc({ kmPerLiter: null, dieselPrice: null, cargoCapacityTon: null });
          setCalcLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMotorista, user]);

  // Hidrata os IDs dos fretes que o motorista já curtiu.
  useEffect(() => {
    if (!isMotorista || !user) {
      setLikedFreteIds(new Set());
      return;
    }
    let cancelled = false;
    getLikedFreteIds(user.id).then((set) => {
      if (!cancelled) setLikedFreteIds(set);
    });
    return () => {
      cancelled = true;
    };
  }, [isMotorista, user]);

  const handleLikeToggle = useCallback((freteId: string, liked: boolean) => {
    setLikedFreteIds((prev) => {
      const next = new Set(prev);
      if (liked) next.add(freteId);
      else next.delete(freteId);
      return next;
    });
  }, []);

  const showCalcBanner =
    isMotorista &&
    calcLoaded &&
    motoristaCalc !== null &&
    (motoristaCalc.kmPerLiter === null || motoristaCalc.dieselPrice === null);

  // Categoria de commodity selecionada pelo motorista no carrossel.
  // Quando preenchida, os fretes sao re-fetched com filtro `productSlug`
  // (Migration 050). Toggle: clicar de novo na mesma desmarca.
  const [selectedCommoditySlug, setSelectedCommoditySlug] = useState<string | null>(null);
  const [selectedCommodityName, setSelectedCommodityName] = useState<string | null>(null);

  const handleCommoditySelect = useCallback((commodity: { slug: string; name: string }) => {
    setSelectedCommoditySlug((prev) => (prev === commodity.slug ? null : commodity.slug));
    setSelectedCommodityName((prev) => (prev === commodity.name ? null : commodity.name));
  }, []);

  const loadFretes = useCallback(async (filters: FreteFilters, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) setIsLoading(true);
      setError(null);
      const data = await getActiveFretes(filters);
      setFretes(data);
      if (!silent) setCurrentPage(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // Erros de conexão/rede: mostrar mensagem amigável
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('lock')) {
        console.warn('[HOME] Erro de conexão com Supabase:', msg);
        if (!silent) setFretes([]);
        setError(null); // Não mostrar erro, só lista vazia
      } else if (!silent) {
        setError('Erro ao carregar fretes. Tente novamente.');
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Motorista bloqueado (trial expirado): NÃO dispara o fetch do feed.
    // A TrialExpiredPage é renderizada no lugar do feed (Req 5.6).
    if (isMotoristaBloqueado) return;
    loadFretes({ productSlug: selectedCommoditySlug ?? undefined });

    // Realtime com:
    //  1) Refetch silencioso (sem `setIsLoading(true)`) — evita o blink
    //     do "Carregando..." na tela do motorista a cada save de outro
    //     embarcador. Considerando que pode haver 500 embarcadores
    //     atualizando, o blink original tornava a UI inutilizavel.
    //  2) Debounce de 500ms — agrega rajadas de eventos num unico
    //     refetch. Se chegarem 30 INSERT/UPDATE em 1s, fazemos so 1
    //     fetch ao final dos 500ms, em vez de 30.
    //  3) Filtro de relevancia — so dispara refetch quando o evento
    //     toca um frete que importa pra esse motorista:
    //      - status do registro novo OU antigo eh 'ativo' (motorista
    //        nao se importa com fretes encerrados/cancelados);
    //      - se ele esta com filtro de categoria selecionado, so
    //        refetch quando o product_slug do registro casa.
    type FretePayload = {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      new?: { status?: string; product_slug?: string | null } | null;
      old?: { status?: string; product_slug?: string | null } | null;
    };

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSilentRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Realtime sinalizou mudança no feed. Invalida o namespace
        // 'fretes:active' ANTES do refetch silencioso para que
        // getActiveFretes busque dado fresco da fonte em vez de servir
        // um Cache_Entry ainda dentro do TTL (30s), que seria obsoleto
        // em relação ao evento recém-recebido (Req 6.6, 7.4). O debounce
        // de 500ms e o filtro de relevância permanecem intactos.
        invalidateActiveFretesCache();
        loadFretes(
          {
            ...currentFiltersRef.current,
            productSlug: selectedCommoditySlug ?? undefined,
          },
          { silent: true }
        );
      }, 500);
    };

    const isRelevant = (payload: FretePayload): boolean => {
      const newRow = payload.new ?? null;
      const oldRow = payload.old ?? null;
      const newActive = newRow?.status === 'ativo';
      const oldActive = oldRow?.status === 'ativo';

      // Se nem o "antes" nem o "depois" eh ativo, ignora.
      if (!newActive && !oldActive) return false;

      // Se o motorista escolheu uma categoria, so importa quando o
      // frete tocado tem (ou tinha) esse slug.
      if (selectedCommoditySlug) {
        const newSlug = newRow?.product_slug ?? null;
        const oldSlug = oldRow?.product_slug ?? null;
        if (newSlug !== selectedCommoditySlug && oldSlug !== selectedCommoditySlug) {
          return false;
        }
      }
      return true;
    };

    const channel = supabase
      .channel('fretes-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fretes' }, (payload) => {
        if (isRelevant(payload as unknown as FretePayload)) scheduleSilentRefetch();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fretes' }, (payload) => {
        if (isRelevant(payload as unknown as FretePayload)) scheduleSilentRefetch();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'fretes' }, (payload) => {
        if (isRelevant(payload as unknown as FretePayload)) scheduleSilentRefetch();
      })
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [loadFretes, isMotoristaBloqueado, selectedCommoditySlug]);

  // Abre modal de um frete específico se o assistente IA tiver pedido.
  useEffect(() => {
    if (fretes.length === 0) return;
    const id = localStorage.getItem('fretego-open-frete');
    if (!id) return;
    localStorage.removeItem('fretego-open-frete');
    const target = fretes.find((f) => f.id === id);
    if (target) {
      setSelectedFrete(target);
      setIsModalOpen(true);
    }
  }, [fretes]);

  const handleFilterChange = useCallback(
    (filters: FreteFilters) => {
      currentFiltersRef.current = filters;
      loadFretes({ ...filters, productSlug: selectedCommoditySlug ?? undefined });
    },
    [loadFretes, selectedCommoditySlug]
  );

  const handleFreteClick = async (frete: Frete) => {
    setSelectedFrete(frete);
    setIsModalOpen(true);
    try {
      await incrementFreteViews(frete.id);
      setFretes((prev) =>
        prev.map((f) => (f.id === frete.id ? { ...f, viewsCount: f.viewsCount + 1 } : f))
      );
    } catch (err) {
      console.error('Erro ao incrementar visualizações:', err);
    }
  };

  // Ponto do motorista (override manual sobrepoe GPS).
  const motoristaPoint = effectiveLoc.point;

  // Lista filtrada por raio para o ramo motorista; intacta caso contrário.
  // Se motorista nao tem GPS (motoristaPoint null), mostra todos os fretes
  // em vez de retornar lista vazia.
  const visibleFretes = useMemo(
    () =>
      isMotorista && motoristaPoint
        ? filterFretesByRadius(fretes, motoristaPoint, radiusKm)
        : fretes,
    [isMotorista, fretes, motoristaPoint, radiusKm]
  );

  const totalPages = Math.ceil(visibleFretes.length / itemsPerPage);
  const currentFretes = visibleFretes.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Bloqueio de trial (Req 5.6): substitui o feed pela TrialExpiredPage.
  // Posicionado após todos os hooks (regras de hooks) e antes do render do
  // feed. O fetch de fretes já foi short-circuitado no useEffect acima, então
  // getActiveFretes nunca é chamado neste caminho.
  if (isMotoristaBloqueado) {
    return <TrialExpiredPage />;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />

      {/* Balao flutuante de localizacao (motorista sem GPS).
          Aparece logo apos o header, ancorado no canto superior direito
          com setinha apontando pro pill de localizacao. Nao bloqueia
          interacao (overlay com pointer-events: none). */}
      {isMotorista && !isMotoristaBloqueado && !motoristaPoint && (
        <LocationHintBalloon
          visible={locationHintVisible}
          onDismiss={() => setLocationHintVisible(false)}
        />
      )}

      <main
        className={`max-w-7xl md:max-w-2xl mx-auto px-3 sm:px-4 pb-24 md:pb-4 ${slideClass} ${
          isMotorista ? 'pt-1 sm:pt-2' : 'py-3 sm:py-4'
        }`}
      >
        {/* Header (apenas para embarcador/desktop) */}
        {!isMotorista && (
          <div className="flex items-center mb-3 gap-2 flex-wrap">
            <h1 className="text-base sm:text-lg font-semibold text-gray-800">Fretes Disponíveis</h1>
            <span className="text-xs text-gray-500">({visibleFretes.length})</span>
            <div className="flex items-center gap-2 ml-auto">
              {!isMobile && <ViewToggle currentView={viewMode} onViewChange={setViewMode} />}
              <button
                onClick={() => setShowMap((v) => !v)}
                className="px-2 py-1 bg-white border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-100"
              >
                {showMap ? 'Ver lista' : 'Ver mapa'}
              </button>
            </div>
          </div>
        )}

        {/* Toolbar do mapa para motorista (mapa abre em modal) */}
        {isMotorista && (
          <MapaToolbar
            fretes={visibleFretes}
            motoristaPoint={motoristaPoint}
            radiusKm={radiusKm}
            onRadiusChange={handleRadiusChange}
            onFreteClick={handleFreteClick}
            geolocationStatus={effectiveLoc.geoStatus}
            onRequestLocation={effectiveLoc.requestLocation}
            middleSlot={null}
          />
        )}

        {isMotoristaSuspenso && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Sua assinatura está suspensa. Você pode ver os fretes, mas não pode interagir.
            </span>
            <Link
              to="/motorista/plano"
              className="inline-flex items-center justify-center rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-greenDark whitespace-nowrap"
            >
              Reativar plano
            </Link>
          </div>
        )}

        {showCalcBanner && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            Configure seu veículo para ver os cálculos.{' '}
            <Link to="/perfil/motorista" className="underline font-medium">
              Ir para o perfil
            </Link>
          </div>
        )}

        {toast && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {toast}
          </div>
        )}

        {isMotorista ? (
          <>
            {/* Carrossel de anuncios entre mapa e header */}
            <AnunciosCarousel />

            {/* Carrossel de categorias de commodities (gerenciado pelo admin) */}
            <CommoditiesCarousel
              selectedSlug={selectedCommoditySlug}
              onSelect={handleCommoditySelect}
            />

            {/* Header do motorista: Fretes (qtd) + Raio + Diesel */}
            <div className="flex items-center mb-3 gap-2">
              <h1 className="text-base font-semibold text-gray-800">Fretes</h1>
              <span className="text-xs text-gray-500">({visibleFretes.length})</span>
              <div className="ml-auto flex items-center gap-2">
                <RadiusSelector radiusKm={radiusKm} onRadiusChange={handleRadiusChange} compact />
                {user && calcLoaded && (
                  <DieselDashboardInput
                    userId={user.id}
                    initialValue={motoristaCalc?.dieselPrice ?? null}
                    onSaved={(p) =>
                      setMotoristaCalc((prev) =>
                        prev
                          ? { ...prev, dieselPrice: p }
                          : { kmPerLiter: null, dieselPrice: p, cargoCapacityTon: null }
                      )
                    }
                    onError={(msg) => {
                      setToast(msg);
                      setTimeout(() => setToast(null), 3000);
                    }}
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <FreteFiltersComponent
            onFilterChange={handleFilterChange}
            totalResults={visibleFretes.length}
          />
        )}

        {showMap && !isMotorista && (
          <div className="mb-6">
            <Suspense
              fallback={
                <div
                  className="flex items-center justify-center bg-white border border-gray-200 rounded-lg text-sm text-gray-400"
                  style={{ height: '400px' }}
                >
                  Carregando mapa...
                </div>
              }
            >
              <InteractiveMap fretes={fretes} onFreteClick={handleFreteClick} height="400px" />
            </Suspense>
          </div>
        )}

        {isLoading ? (
          <FreteListSkeleton count={itemsPerPage} showCalcBlock={isMotorista} />
        ) : error ? (
          <div className="flex justify-center py-20">
            <div className="text-red-400">{error}</div>
          </div>
        ) : visibleFretes.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center shadow-sm">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">
              {isMotorista && selectedCommodityName
                ? `Sem cargas de ${selectedCommodityName} no momento`
                : 'Nenhum frete disponível'}
            </h3>
            <p className="text-gray-500">
              {isMotorista && selectedCommodityName && motoristaPoint
                ? `Não temos cargas de ${selectedCommodityName} num raio de ${radiusKm} km. Tente aumentar o raio acima ou escolher outra categoria.`
                : isMotorista && selectedCommodityName
                  ? `Não temos cargas de ${selectedCommodityName} disponíveis agora. Volte mais tarde ou escolha outra categoria.`
                  : isMotorista && motoristaPoint
                    ? `Nenhum frete encontrado num raio de ${radiusKm} km. Tente aumentar o raio.`
                    : 'Novos fretes aparecerão aqui quando forem publicados.'}
            </p>
            {isMotorista && selectedCommoditySlug && (
              <button
                type="button"
                onClick={() => {
                  setSelectedCommoditySlug(null);
                  setSelectedCommodityName(null);
                }}
                className="mt-4 inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-800 font-medium underline"
              >
                Limpar filtro de categoria
              </button>
            )}
          </div>
        ) : effectiveView === 'table' ? (
          <FreteTable fretes={visibleFretes} onFreteClick={handleFreteClick} showActions={false} />
        ) : (
          <>
            <div
              ref={listTopRef}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6 scroll-mt-24 sm:scroll-mt-28"
            >
              {currentFretes.map((frete) => (
                <FreteCard
                  key={frete.id}
                  frete={frete}
                  onClick={() => handleFreteClick(frete)}
                  motoristaCalc={isMotorista && motoristaCalc ? motoristaCalc : undefined}
                  showLikeButton={isMotorista}
                  initialLiked={likedFreteIds.has(frete.id)}
                  onLikeToggle={handleLikeToggle}
                  onLikeBlocked={(msg) => {
                    setToast(msg);
                    setTimeout(() => setToast(null), 4000);
                  }}
                  hideStatus
                  communityProfile={communityProfile}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex justify-center items-center space-x-2">
                <button
                  onClick={() => goToPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                >
                  Anterior
                </button>
                <span className="text-gray-600">
                  Página {currentPage} de {totalPages}
                </span>
                <button
                  onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                >
                  Próxima
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <FreteModal
        frete={selectedFrete}
        isOpen={isModalOpen}
        communityProfile={communityProfile}
        onClose={() => {
          // Se o motorista chegou aqui via "Frete e retorno", volta
          // pro frete anterior em vez de fechar de vez. Stack vazia
          // = fecha tudo.
          setFreteStack((prev) => {
            if (prev.length > 0) {
              const restoreFrete = prev[prev.length - 1];
              const next = prev.slice(0, -1);
              // Aguarda animacao de fade do modal atual antes de
              // restaurar o anterior, evita flicker.
              requestAnimationFrame(() => {
                setSelectedFrete(restoreFrete);
                setIsModalOpen(true);
              });
              return next;
            }
            // Stack vazia: fecha de vez.
            setIsModalOpen(false);
            setSelectedFrete(null);
            return prev;
          });
        }}
        motoristaCalc={isMotorista && motoristaCalc ? motoristaCalc : undefined}
        onSelectFreteRetorno={
          isMotorista
            ? (novoFrete) => {
                // Empilha o frete atual antes de abrir o retorno —
                // assim o motorista volta pra ele ao fechar.
                setFreteStack((prev) => (selectedFrete ? [...prev, selectedFrete] : prev));
                setIsModalOpen(false);
                setSelectedFrete(null);
                requestAnimationFrame(() => {
                  setSelectedFrete(novoFrete);
                  setIsModalOpen(true);
                });
                incrementFreteViews(novoFrete.id).catch(() => {
                  /* silencioso */
                });
              }
            : undefined
        }
      />

      {/* Barra inferior de navegacao - apenas motorista */}
      {isMotorista && <MotoristaBottomNav />}

      {/* FAB IA - botão flutuante para acessar o assistente */}
      {isMotorista && !isMotoristaBloqueado && <AiFab />}
    </div>
  );
}
