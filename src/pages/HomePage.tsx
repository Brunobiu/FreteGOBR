import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  getActiveFretes,
  incrementFreteViews,
  type Frete,
  type FreteFilters,
} from '../services/fretes';
import { supabase } from '../services/supabase';
import AppHeader from '../components/AppHeader';
import FreteCard from '../components/FreteCard';
import FreteModal from '../components/FreteModal';
import FreteFiltersComponent from '../components/FreteFilters';
import InteractiveMap from '../components/InteractiveMap';
import FreteTable from '../components/FreteTable';
import ViewToggle from '../components/ViewToggle';
import DieselDashboardInput from '../components/DieselDashboardInput';
import { useViewPreference } from '../hooks/useViewPreference';
import { useIsMobile } from '../hooks/useIsMobile';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuth } from '../hooks/useAuth';
import { useGeolocation } from '../hooks/useGeolocation';
import { getMotoristaCalcContext, type MotoristaCalcContext } from '../services/motorista';
import { getLikedFreteIds } from '../services/likes';
import WelcomeLoading from '../components/WelcomeLoading';
import AnunciosCarousel from '../components/AnunciosCarousel';
import {
  RADIUS_DEFAULT_KM,
  RADIUS_STORAGE_KEY,
  filterFretesByRadius,
  readStoredRadius,
  writeStoredRadius,
  type RadiusOption,
} from '../utils/geoDistance';

// Lazy import: leaflet + react-leaflet só caem no chunk dos motoristas.
const MapaFretes = lazy(() => import('../components/MapaFretes'));
import MapaFretesBoundary from '../components/MapaFretesBoundary';

function MapaSkeleton() {
  return <div className="w-full h-[90px] md:h-[110px] rounded-md bg-gray-100 animate-pulse mb-3" />;
}

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useDocumentTitle(user?.userType === 'motorista' ? 'Motorista' : null);
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrete, setSelectedFrete] = useState<Frete | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
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

  // Conjunto de fretes que o motorista já curtiu — hidrata os corações.
  const [likedFreteIds, setLikedFreteIds] = useState<Set<string>>(new Set());

  const isMotorista = user?.userType === 'motorista';

  // Geolocalização (apenas usada no ramo motorista, mas chamamos
  // sempre — useGeolocation começa em 'idle' até requestLocation()).
  const geo = useGeolocation();

  // Dispara request de localização uma vez quando o usuário é motorista.
  useEffect(() => {
    if (!isMotorista) return;
    geo.requestLocation();
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

  const loadFretes = useCallback(async (filters: FreteFilters) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getActiveFretes(filters);
      setFretes(data);
      setCurrentPage(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // Erros de conexão/rede: mostrar mensagem amigável
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('lock')) {
        console.warn('[HOME] Erro de conexão com Supabase:', msg);
        setFretes([]);
        setError(null); // Não mostrar erro, só lista vazia
      } else {
        setError('Erro ao carregar fretes. Tente novamente.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFretes({});
    const channel = supabase
      .channel('fretes-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fretes' }, () => {
        loadFretes(currentFiltersRef.current);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fretes' }, () => {
        loadFretes(currentFiltersRef.current);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'fretes' }, () => {
        loadFretes(currentFiltersRef.current);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadFretes]);

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
      loadFretes(filters);
    },
    [loadFretes]
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

  // Ponto do motorista (apenas quando geolocalização sucesso)
  const motoristaPoint = geo.status === 'success' && geo.point ? geo.point : null;

  // Lista filtrada por raio para o ramo motorista; intacta caso contrário.
  const visibleFretes = useMemo(
    () => (isMotorista ? filterFretesByRadius(fretes, motoristaPoint, radiusKm) : fretes),
    [isMotorista, fretes, motoristaPoint, radiusKm]
  );

  const totalPages = Math.ceil(visibleFretes.length / itemsPerPage);
  const currentFretes = visibleFretes.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
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

        {/* Mapa fixo para motorista (lazy) */}
        {isMotorista && (
          <MapaFretesBoundary>
            <Suspense fallback={<MapaSkeleton />}>
              <MapaFretes
                fretes={visibleFretes}
                motoristaPoint={motoristaPoint}
                radiusKm={radiusKm}
                onRadiusChange={handleRadiusChange}
                onFreteClick={handleFreteClick}
                geolocationStatus={geo.status}
                onRequestLocation={geo.requestLocation}
              />
            </Suspense>
          </MapaFretesBoundary>
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

            {/* Filtro desativado por enquanto - sera reativado em versao futura
            <div className="sticky top-12 sm:top-14 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 mb-3 bg-gray-100/90 backdrop-blur-sm">
              <FreteFiltersComponent
                onFilterChange={handleFilterChange}
                totalResults={visibleFretes.length}
                compact
              />
            </div>
            */}

            {/* Header do motorista: Fretes Disponiveis + Diesel */}
            <div className="flex items-center mb-3 gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-semibold text-gray-800">Fretes Disponíveis</h1>
              <span className="text-xs text-gray-500">({visibleFretes.length})</span>
              {user && calcLoaded && (
                <div className="ml-auto">
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
                </div>
              )}
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
            <InteractiveMap fretes={fretes} onFreteClick={handleFreteClick} height="400px" />
          </div>
        )}

        {isLoading ? (
          <WelcomeLoading isMotorista={isMotorista} userName={user?.name} />
        ) : error ? (
          <div className="flex justify-center py-20">
            <div className="text-red-400">{error}</div>
          </div>
        ) : visibleFretes.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center shadow-sm">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Nenhum frete disponível</h3>
            <p className="text-gray-500">
              {isMotorista && motoristaPoint
                ? 'Nenhum frete encontrado nesse raio. Tente aumentar para 200 ou 500 km.'
                : 'Novos fretes aparecerão aqui quando forem publicados.'}
            </p>
          </div>
        ) : effectiveView === 'table' ? (
          <FreteTable fretes={visibleFretes} onFreteClick={handleFreteClick} showActions={false} />
        ) : (
          <>
            <div
              ref={listTopRef}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6 scroll-mt-24 sm:scroll-mt-28"
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
        onClose={() => {
          setIsModalOpen(false);
          setSelectedFrete(null);
        }}
        motoristaCalc={isMotorista && motoristaCalc ? motoristaCalc : undefined}
      />

      {/* FAB Pergunte a Iara - desativado por enquanto, sera reativado em versao futura
      {isMotorista && (
        <button
          type="button"
          onClick={() => navigate('/assistente?new=1')}
          title="Pergunte à Iara"
          aria-label="Pergunte à Iara"
          className="fixed bottom-5 left-5 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-400 shadow-lg shadow-purple-500/30 hover:scale-110 active:scale-95 transition-transform flex items-center justify-center"
        >
          <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2l1.6 4.5L18 8l-4.4 1.5L12 14l-1.6-4.5L6 8l4.4-1.5L12 2z" />
            <path d="M19 13l.9 2.4L22 16l-2.1.6L19 19l-.9-2.4L16 16l2.1-.6L19 13z" />
            <path d="M6 14l.7 1.8L8 16l-1.3.5L6 18l-.7-1.5L4 16l1.3-.2L6 14z" />
          </svg>
        </button>
      )}
      */}
    </div>
  );
}
