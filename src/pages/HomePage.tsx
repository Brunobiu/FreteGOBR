import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
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
import { getMotoristaCalcContext, type MotoristaCalcContext } from '../services/motorista';

export default function HomePage() {
  const { user } = useAuth();
  useDocumentTitle(user?.userType === 'motorista' ? 'Motorista' : null);
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrete, setSelectedFrete] = useState<Frete | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showMap, setShowMap] = useState(false);
  const currentFiltersRef = useRef<FreteFilters>({});
  const itemsPerPage = 9;
  const [viewMode, setViewMode] = useViewPreference('fretego-view-home', 'cards');
  const isMobile = useIsMobile();
  const effectiveView = isMobile ? 'cards' : viewMode;

  // Contexto de cálculo financeiro do motorista (km/l + diesel).
  // Carregado apenas no ramo motorista; nulo até carregar.
  const [motoristaCalc, setMotoristaCalc] = useState<MotoristaCalcContext | null>(null);
  const [calcLoaded, setCalcLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const isMotorista = user?.userType === 'motorista';

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
          setMotoristaCalc({ kmPerLiter: null, dieselPrice: null });
          setCalcLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMotorista, user]);

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
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'fretes', filter: 'status=eq.ativo' },
        () => {
          loadFretes(currentFiltersRef.current);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadFretes]);

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

  const totalPages = Math.ceil(fretes.length / itemsPerPage);
  const currentFretes = fretes.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Fretes Disponíveis</h1>
            <p className="text-sm text-gray-500">
              {fretes.length} frete{fretes.length !== 1 ? 's' : ''}
            </p>
          </div>
          {isMotorista && user && calcLoaded && (
            <div className="flex-1 flex justify-center min-w-[180px]">
              <DieselDashboardInput
                userId={user.id}
                initialValue={motoristaCalc?.dieselPrice ?? null}
                onSaved={(p) =>
                  setMotoristaCalc((prev) =>
                    prev ? { ...prev, dieselPrice: p } : { kmPerLiter: null, dieselPrice: p }
                  )
                }
                onError={(msg) => {
                  setToast(msg);
                  setTimeout(() => setToast(null), 3000);
                }}
              />
            </div>
          )}
          <div className="flex items-center space-x-2">
            {!isMobile && <ViewToggle currentView={viewMode} onViewChange={setViewMode} />}
            <button
              onClick={() => setShowMap((v) => !v)}
              className="flex items-center px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm"
            >
              {showMap ? 'Ver lista' : 'Ver mapa'}
            </button>
          </div>
        </div>

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

        <FreteFiltersComponent onFilterChange={handleFilterChange} totalResults={fretes.length} />

        {showMap && (
          <div className="mb-6">
            <InteractiveMap fretes={fretes} onFreteClick={handleFreteClick} height="400px" />
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="text-gray-500">Carregando fretes...</div>
          </div>
        ) : error ? (
          <div className="flex justify-center py-20">
            <div className="text-red-400">{error}</div>
          </div>
        ) : fretes.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center shadow-sm">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Nenhum frete disponível</h3>
            <p className="text-gray-500">Novos fretes aparecerão aqui quando forem publicados.</p>
          </div>
        ) : effectiveView === 'table' ? (
          <FreteTable fretes={fretes} onFreteClick={handleFreteClick} showActions={false} />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
              {currentFretes.map((frete) => (
                <FreteCard
                  key={frete.id}
                  frete={frete}
                  onClick={() => handleFreteClick(frete)}
                  motoristaCalc={isMotorista && motoristaCalc ? motoristaCalc : undefined}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex justify-center items-center space-x-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                >
                  Anterior
                </button>
                <span className="text-gray-600">
                  Página {currentPage} de {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
      />
    </div>
  );
}
