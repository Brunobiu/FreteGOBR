import { useState, useEffect, useCallback } from 'react';
import {
  getActiveFretes,
  incrementFreteViews,
  type Frete,
  type FreteFilters,
} from '../services/fretes';
import FreteCard from '../components/FreteCard';
import FreteModal from '../components/FreteModal';
import FreteFilters from '../components/FreteFilters';

export default function FretesListPage() {
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrete, setSelectedFrete] = useState<Frete | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 9;

  useEffect(() => {
    loadFretes({});
  }, []);

  const loadFretes = async (filters: FreteFilters) => {
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
  };

  const handleFilterChange = useCallback((filters: FreteFilters) => {
    setActiveFilters(filters);
    loadFretes(filters);
  }, []);

  const handleFreteClick = async (frete: Frete) => {
    setSelectedFrete(frete);
    setIsModalOpen(true);

    // Increment views
    try {
      await incrementFreteViews(frete.id);
      // Update local state
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
  const endIndex = startIndex + itemsPerPage;
  const currentFretes = fretes.slice(startIndex, endIndex);

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
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Fretes Disponíveis</h1>
            <p className="text-gray-400">{fretes.length} fretes encontrados</p>
          </div>
        </div>

        <FreteFilters onFilterChange={handleFilterChange} totalResults={fretes.length} />

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
            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {currentFretes.map((frete) => (
                <FreteCard key={frete.id} frete={frete} onClick={() => handleFreteClick(frete)} />
              ))}
            </div>

            {/* Pagination */}
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

      {/* Modal */}
      <FreteModal frete={selectedFrete} isOpen={isModalOpen} onClose={handleCloseModal} />
    </div>
  );
}
