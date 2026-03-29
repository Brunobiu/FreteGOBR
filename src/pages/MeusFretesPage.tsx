import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  getFretesByEmbarcador,
  deleteFrete,
  getFreteAnalytics,
  type Frete,
} from '../services/fretes';
import FreteCard from '../components/FreteCard';
import FreteModal from '../components/FreteModal';
import { getEmbarcadorProfile } from '../services/embarcador';

export default function MeusFretesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrete, setSelectedFrete] = useState<Frete | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [whatsapp, setWhatsapp] = useState<string>('');

  useEffect(() => {
    if (user) {
      loadFretes();
      loadEmbarcadorData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadEmbarcadorData = async () => {
    if (!user) return;
    try {
      const profile = await getEmbarcadorProfile(user.id);
      if (profile) {
        setWhatsapp(profile.whatsapp || '');
      }
    } catch (err) {
      console.error('Erro ao carregar dados do embarcador:', err);
    }
  };

  const loadFretes = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);
      const data = await getFretesByEmbarcador(user.id);
      setFretes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar fretes');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFreteClick = async (frete: Frete) => {
    setSelectedFrete(frete);
    setIsModalOpen(true);

    // Load fresh analytics
    try {
      const analytics = await getFreteAnalytics(frete.id);
      setFretes((prev) =>
        prev.map((f) =>
          f.id === frete.id
            ? { ...f, viewsCount: analytics.viewsCount, clicksCount: analytics.clicksCount }
            : f
        )
      );
    } catch (err) {
      console.error('Erro ao carregar analytics:', err);
    }
  };

  const handleDeleteFrete = async (freteId: string) => {
    if (!confirm('Tem certeza que deseja excluir este frete?')) {
      return;
    }

    try {
      await deleteFrete(freteId);
      setFretes((prev) => prev.filter((f) => f.id !== freteId));
      alert('Frete excluído com sucesso!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao excluir frete');
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedFrete(null);
  };

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

  const fretesAtivos = fretes.filter((f) => f.status === 'ativo');
  const fretesEncerrados = fretes.filter((f) => f.status === 'encerrado');
  const fretesCancelados = fretes.filter((f) => f.status === 'cancelado');

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Meus Fretes</h1>
            <p className="text-gray-400">{fretes.length} fretes cadastrados</p>
          </div>
          <button
            onClick={() => navigate('/embarcador/postar-frete')}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 flex items-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Novo Frete
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400 mb-1">Ativos</p>
                <p className="text-3xl font-bold text-green-400">{fretesAtivos.length}</p>
              </div>
              <div className="w-12 h-12 bg-green-900/30 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400 mb-1">Encerrados</p>
                <p className="text-3xl font-bold text-gray-400">{fretesEncerrados.length}</p>
              </div>
              <div className="w-12 h-12 bg-gray-700/30 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400 mb-1">Cancelados</p>
                <p className="text-3xl font-bold text-red-400">{fretesCancelados.length}</p>
              </div>
              <div className="w-12 h-12 bg-red-900/30 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

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
            <h3 className="text-xl font-semibold text-white mb-2">Nenhum frete cadastrado</h3>
            <p className="text-gray-400 mb-6">Comece publicando seu primeiro frete.</p>
            <button
              onClick={() => navigate('/embarcador/postar-frete')}
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
            >
              Postar Frete
            </button>
          </div>
        ) : (
          <>
            {/* Fretes Ativos */}
            {fretesAtivos.length > 0 && (
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-4">Ativos</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {fretesAtivos.map((frete) => (
                    <div key={frete.id} className="relative">
                      <FreteCard frete={frete} onClick={() => handleFreteClick(frete)} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFrete(frete.id);
                        }}
                        className="absolute top-4 right-4 p-2 bg-red-600 hover:bg-red-700 rounded-lg text-white"
                        title="Excluir frete"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fretes Encerrados */}
            {fretesEncerrados.length > 0 && (
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-4">Encerrados</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {fretesEncerrados.map((frete) => (
                    <FreteCard
                      key={frete.id}
                      frete={frete}
                      onClick={() => handleFreteClick(frete)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Fretes Cancelados */}
            {fretesCancelados.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-white mb-4">Cancelados</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {fretesCancelados.map((frete) => (
                    <FreteCard
                      key={frete.id}
                      frete={frete}
                      onClick={() => handleFreteClick(frete)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal */}
      <FreteModal
        frete={selectedFrete}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        embarcadorWhatsApp={whatsapp}
      />
    </div>
  );
}
