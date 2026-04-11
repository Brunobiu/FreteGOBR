import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  getFretesByEmbarcador,
  deleteFrete,
  createFrete,
  type Frete,
  type CreateFreteData,
} from '../services/fretes';
import AppHeader from '../components/AppHeader';
import FreteCard from '../components/FreteCard';
import FreteModal from '../components/FreteModal';
import FreteForm from '../components/FreteForm';
import FreteTable from '../components/FreteTable';
import ViewToggle from '../components/ViewToggle';
import { useViewPreference } from '../hooks/useViewPreference';
import { useIsMobile } from '../hooks/useIsMobile';
import { getEmbarcadorProfile } from '../services/embarcador';

export default function EmbarcadorPage() {
  const { user } = useAuth();
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrete, setSelectedFrete] = useState<Frete | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');
  const [viewMode, setViewMode] = useViewPreference('fretego-view-embarcador', 'cards');
  const isMobile = useIsMobile();
  const effectiveView = isMobile ? 'cards' : viewMode;

  useEffect(() => {
    if (user) {
      loadFretes();
      loadProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;
    try {
      const profile = await getEmbarcadorProfile(user.id);
      if (profile) setWhatsapp(profile.whatsapp || '');
    } catch {
      /* ignore */
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

  const handleCreateFrete = async (data: CreateFreteData) => {
    await createFrete(data);
    setIsFormOpen(false);
    await loadFretes();
  };

  const handleDeleteFrete = async (freteId: string) => {
    if (!confirm('Excluir este frete?')) return;
    try {
      await deleteFrete(freteId);
      setFretes((prev) => prev.filter((f) => f.id !== freteId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao excluir');
    }
  };

  const fretesAtivos = fretes.filter((f) => f.status === 'ativo');
  const fretesEncerrados = fretes.filter((f) => f.status !== 'ativo');

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Header com botões */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Meus Fretes</h1>
            <p className="text-sm text-gray-500">
              {fretes.length} frete{fretes.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {!isMobile && (
              <ViewToggle currentView={viewMode} onViewChange={setViewMode} />
            )}
            <button
              onClick={() => setIsFormOpen(true)}
              className="flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Postar Frete
            </button>
          </div>
        </div>

        {/* Stats rápidos */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-green-600">{fretesAtivos.length}</p>
            <p className="text-xs text-gray-500">Ativos</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-gray-500">{fretesEncerrados.length}</p>
            <p className="text-xs text-gray-500">Encerrados/Cancelados</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 text-center hidden md:block shadow-sm">
            <p className="text-2xl font-bold text-blue-500">
              {fretes.reduce((s, f) => s + f.viewsCount, 0)}
            </p>
            <p className="text-xs text-gray-500">Visualizações total</p>
          </div>
        </div>

        {/* Lista de fretes */}
        {isLoading ? (
          <div className="flex justify-center py-20 text-gray-400">Carregando...</div>
        ) : error ? (
          <div className="flex justify-center py-20 text-red-400">{error}</div>
        ) : fretes.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center shadow-sm">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Nenhum frete cadastrado</h3>
            <p className="text-gray-500 mb-4">Comece publicando seu primeiro frete.</p>
            <button
              onClick={() => setIsFormOpen(true)}
              className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Postar Frete
            </button>
          </div>
        ) : effectiveView === 'table' ? (
          <FreteTable
            fretes={fretes}
            onFreteClick={(frete) => { setSelectedFrete(frete); setIsDetailOpen(true); }}
            onDelete={handleDeleteFrete}
            showActions={true}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {fretes.map((frete) => (
              <div key={frete.id} className="relative">
                <FreteCard
                  frete={frete}
                  onClick={() => {
                    setSelectedFrete(frete);
                    setIsDetailOpen(true);
                  }}
                />
                {frete.status === 'ativo' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFrete(frete.id);
                    }}
                    className="absolute top-3 right-3 p-1.5 bg-red-600 hover:bg-red-700 rounded text-white"
                    title="Excluir"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal: Detalhes do frete */}
      <FreteModal
        frete={selectedFrete}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedFrete(null);
        }}
        embarcadorWhatsApp={whatsapp}
      />

      {/* Modal: Postar frete */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-75"
            onClick={() => setIsFormOpen(false)}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-lg max-w-4xl w-full border border-gray-200 shadow-xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">Postar Novo Frete</h2>
                <button
                  onClick={() => setIsFormOpen(false)}
                  className="text-gray-400 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <FreteForm
                embarcadorId={user?.id || ''}
                onSubmit={handleCreateFrete}
                onCancel={() => setIsFormOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
