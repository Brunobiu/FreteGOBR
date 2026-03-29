import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getActiveFretes,
  incrementFreteViews,
  type Frete,
  type FreteFilters,
} from '../services/fretes';
import { supabase } from '../services/supabase';
import FreteCard from '../components/FreteCard';
import FreteModal from '../components/FreteModal';
import FreteFiltersComponent from '../components/FreteFilters';
import InteractiveMap from '../components/InteractiveMap';

export default function FretesListPage() {
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrete, setSelectedFrete] = useState<Frete | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showMap, setShowMap] = useState(false);
  const currentFiltersRef = useRef<FreteFilters>({});
  const itemsPerPage = 9;

  const loadFretes = useCallback(async (filters: FreteFilters) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getActiveFretes(filters);
      setFretes(data);
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar fretes');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFretes({});

    // Supabase Realtime: escuta novos fretes ativos
    const channel = supabase
      .channel('fretes-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'fretes', filter: 'status=eq.ativo' },
        () => {
          // Recarrega com os filtros atuais
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

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedFrete(null);
  };

  // Pagination
  const totalPages = Math.ceil(fretes.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentFretes = fretes.slice(startIndex, startIndex + itemsPerPage);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-950">
        <div className="text-white">Carregando fretes...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-950">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Fretes Disponíveis</h1>
            <p className="text-gray-400">{fretes.length} fretes encontrados</p>
          </div>
          {/* Toggle mapa/lista */}
          <button
            onClick={() => setShowMap((v) => !v)}
            className="flex items-center px-4 py-2 bg-gray-800 border border-gray-700 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
          >
            {showMap ? (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 10h16M4 14h16M4 18h16"
                  />
                </svg>
                Ver lista
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                  />
                </svg>
                Ver mapa
              </>
            )}
          </button>
        </div>

        {/* Filtros */}
        <FreteFiltersComponent onFilterChange={handleFilterChange} totalResults={fretes.length} />

        {/* Mapa */}
        {showMap && (
          <div className="mb-8">
            <InteractiveMap fretes={fretes} onFreteClick={handleFreteClick} height="450px" />
          </div>
        )}

        {fretes.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-12 text-center">
            <svg
              className="w-16 h-16 text-gray-600 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
              />
            </svg>
            <h3 className="text-xl font-semibold text-white mb-2">Nenhum frete disponível</h3>
            <p className="text-gray-400">Novos fretes aparecerão aqui quando forem publicados.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {currentFretes.map((frete) => (
                <FreteCard key={frete.id} frete={frete} onClick={() => handleFreteClick(frete)} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center items-center space-x-2">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <span className="text-gray-400">
                  Página {currentPage} de {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Próxima
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <FreteModal frete={selectedFrete} isOpen={isModalOpen} onClose={handleCloseModal} />
    </div>
  );
}
