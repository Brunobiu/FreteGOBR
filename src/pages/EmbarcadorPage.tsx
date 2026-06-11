import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import MotoristaInteressadoModal from '../components/MotoristaInteressadoModal';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  getEmbarcadorProfile,
  getEmbarcadorOnboardingProgress,
  type EmbarcadorOnboardingProgress,
} from '../services/embarcador';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { usePixel } from '../components/marketing/pixelContext';

export default function EmbarcadorPage() {
  useDocumentTitle('Embarcador');
  const { user } = useAuth();
  const { trackBusinessEvent } = usePixel();
  const [fretes, setFretes] = useState<Frete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrete, setSelectedFrete] = useState<Frete | null>(null);
  const [editingFrete, setEditingFrete] = useState<Frete | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');
  const [progress, setProgress] = useState<EmbarcadorOnboardingProgress | null>(null);
  const isMobile = useIsMobile();

  // Modal "Motorista interessado" (vem de notificação ?frete=X&motorista=Y)
  const [searchParams, setSearchParams] = useSearchParams();
  const interesseFreteId = searchParams.get('frete');
  const interesseMotoristaId = searchParams.get('motorista');
  const interesseAberto = !!interesseFreteId;

  const closeInteresseModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('frete');
    next.delete('motorista');
    setSearchParams(next, { replace: true });
  };

  const canPostFrete = !!progress && progress.percent >= 100;

  useEffect(() => {
    if (user) {
      loadFretes();
      loadProfile();
      loadProgress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadProgress = async () => {
    if (!user) return;
    try {
      const p = await getEmbarcadorOnboardingProgress(user.id);
      setProgress(p);
    } catch {
      /* ignore */
    }
  };

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

    // Tracked_Event de negocio (CP-4): frete publicado com sucesso. So chega
    // aqui no caminho de SUCESSO — se `createFrete` lanca, o await rejeita e o
    // disparo nunca ocorre. `trackBusinessEvent` gera o event_id UMA unica vez
    // e propaga o MESMO id ao Pixel (browser, gated por consentimento — CP-5) e
    // a Edge meta-capi-forward (server, fire-and-forget) (Req 10.6, 10.7). A PII
    // disponivel do embarcador autenticado (email/telefone/user_id) vai SOMENTE
    // ao canal CAPI — a Edge hasheia em SHA-256 (CP-6); nada de PII em claro no
    // Pixel.
    trackBusinessEvent('frete_published', {
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      userId: user?.id ?? null,
    });

    setIsFormOpen(false);
    await loadFretes();
  };

  /**
   * Atualiza um frete existente. O `data` vem do FreteForm em modo edição
   * com o `id` injetado no payload.
   */
  const handleUpdateFrete = async (data: CreateFreteData & Record<string, unknown>) => {
    const freteId = data.id as string | undefined;
    if (!freteId) return;
    const { updateFrete } = await import('../services/fretes');
    // Repassa o payload inteiro do formulário. `updateFrete` só lê as chaves
    // conhecidas (ignora `id`/`embarcadorId`), então não há risco em mandar
    // tudo — e isso garante PARIDADE com a criação: nenhum campo fica de fora
    // da edição por esquecimento. (Bug histórico: local de carregamento/entrega
    // e pins do mapa não salvavam ao editar porque eram listados na mão.)
    await updateFrete(freteId, data as Parameters<typeof updateFrete>[1]);
    setIsFormOpen(false);
    setEditingFrete(null);
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

  /**
   * Atualiza apenas o valor do frete inline na tabela.
   */
  const handleValueChange = async (freteId: string, newValue: number) => {
    try {
      const { updateFrete } = await import('../services/fretes');
      await updateFrete(freteId, { value: newValue });
      setFretes((prev) => prev.map((f) => (f.id === freteId ? { ...f, value: newValue } : f)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao atualizar valor');
    }
  };

  /**
   * Alterna o status entre 'ativo' e 'encerrado'.
   * Quando encerrado, o frete some da listagem dos motoristas.
   */
  const handleToggleStatus = async (frete: Frete) => {
    const newStatus = frete.status === 'ativo' ? 'encerrado' : 'ativo';
    try {
      const { updateFrete } = await import('../services/fretes');
      await updateFrete(frete.id, { status: newStatus });
      setFretes((prev) => prev.map((f) => (f.id === frete.id ? { ...f, status: newStatus } : f)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao atualizar status');
    }
  };

  const fretesAtivos = fretes.filter((f) => f.status === 'ativo');
  const fretesEncerrados = fretes.filter((f) => f.status !== 'ativo');

  type FreteFilter = 'ativos' | 'encerrados';
  const [filterMode, setFilterMode] = useState<FreteFilter>('ativos');

  const fretesVisiveis = filterMode === 'ativos' ? fretesAtivos : fretesEncerrados;

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Header com botões */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Meus Fretes</h1>
            <p className="text-sm text-gray-500">
              {fretesVisiveis.length} frete{fretesVisiveis.length !== 1 ? 's' : ''}
              {filterMode === 'encerrados' ? ' encerrado(s)' : ' ativo(s)'}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsFormOpen(true)}
              disabled={!canPostFrete}
              title={
                canPostFrete ? 'Postar novo frete' : 'Complete seu cadastro para postar fretes'
              }
              aria-label="Postar novo frete"
              className="flex items-center justify-center w-9 h-9 bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Banner: cadastro incompleto */}
        {progress && progress.percent < 100 && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-yellow-800">
                Complete seu cadastro para postar fretes
              </p>
              {progress.missing.length > 0 && (
                <p className="text-xs text-yellow-700 mt-1">
                  Falta: {progress.missing.join(', ')}.
                </p>
              )}
            </div>
            <Link
              to="/perfil/embarcador"
              className="inline-flex items-center justify-center px-4 py-1.5 bg-yellow-600 text-white text-sm rounded-lg hover:bg-yellow-700 whitespace-nowrap"
            >
              Completar cadastro →
            </Link>
          </div>
        )}

        {/* Stats rápidos (clicáveis = filtros) */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-4">
          <button
            type="button"
            onClick={() => setFilterMode('ativos')}
            className={`bg-white border rounded-lg px-3 py-2 text-center shadow-sm transition-colors ${
              filterMode === 'ativos'
                ? 'border-green-500 ring-2 ring-green-500/30'
                : 'border-gray-200 hover:border-green-300'
            }`}
          >
            <p className="text-lg font-bold text-green-600 leading-tight">{fretesAtivos.length}</p>
            <p className="text-[11px] text-gray-500">Ativos</p>
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('encerrados')}
            className={`bg-white border rounded-lg px-3 py-2 text-center shadow-sm transition-colors ${
              filterMode === 'encerrados'
                ? 'border-gray-500 ring-2 ring-gray-400/40'
                : 'border-gray-200 hover:border-gray-400'
            }`}
          >
            <p className="text-lg font-bold text-gray-500 leading-tight">
              {fretesEncerrados.length}
            </p>
            <p className="text-[11px] text-gray-500">Encerrados/Cancelados</p>
          </button>
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-center hidden md:block shadow-sm">
            <p className="text-lg font-bold text-blue-500 leading-tight">
              {fretes.reduce((s, f) => s + f.viewsCount, 0)}
            </p>
            <p className="text-[11px] text-gray-500">Visualizações total</p>
          </div>
        </div>

        {/* Lista de fretes */}
        {isLoading ? (
          <div className="flex justify-center py-20 text-gray-400">Carregando...</div>
        ) : error ? (
          <div className="flex justify-center py-20 text-red-400">{error}</div>
        ) : fretesVisiveis.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center shadow-sm">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">
              {filterMode === 'ativos' ? 'Nenhum frete ativo' : 'Nenhum frete encerrado'}
            </h3>
            {filterMode === 'ativos' && (
              <>
                <p className="text-gray-500 mb-4">Comece publicando seu primeiro frete.</p>
                <button
                  onClick={() => setIsFormOpen(true)}
                  disabled={!canPostFrete}
                  title={
                    canPostFrete ? 'Postar novo frete' : 'Complete seu cadastro para postar fretes'
                  }
                  className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Postar Frete
                </button>
              </>
            )}
          </div>
        ) : isMobile ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fretesVisiveis.map((frete) => (
              <div key={frete.id} className="relative">
                <FreteCard
                  frete={frete}
                  onClick={() => {
                    setEditingFrete(frete);
                    setIsFormOpen(true);
                  }}
                />
                {frete.status === 'ativo' && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          confirm(
                            'Tem certeza que deseja encerrar este frete? Ele sairá da listagem dos motoristas.'
                          )
                        ) {
                          handleToggleStatus(frete);
                        }
                      }}
                      title="Encerrar"
                      aria-label="Encerrar frete"
                      className="absolute top-2 right-10 p-1 bg-orange-500/90 hover:bg-orange-600 rounded text-white"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="9"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <line x1="6" y1="6" x2="18" y2="18" strokeWidth={2} strokeLinecap="round" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFrete(frete.id);
                      }}
                      title="Excluir"
                      className="absolute top-2 right-2 p-1 bg-red-500/90 hover:bg-red-600 rounded text-white"
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <FreteTable
            fretes={fretesVisiveis}
            onFreteClick={(frete) => {
              setSelectedFrete(frete);
              setIsDetailOpen(true);
            }}
            onEdit={(frete) => {
              setEditingFrete(frete);
              setIsFormOpen(true);
            }}
            onDelete={handleDeleteFrete}
            onToggleStatus={handleToggleStatus}
            onValueChange={handleValueChange}
            showActions={true}
          />
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

      {/* Modal: Motorista interessado (clicado via notificação) */}
      <MotoristaInteressadoModal
        freteId={interesseFreteId}
        motoristaId={interesseMotoristaId}
        isOpen={interesseAberto}
        onClose={closeInteresseModal}
      />

      {/* Modal: Postar/Editar frete */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-75"
            onClick={() => {
              setIsFormOpen(false);
              setEditingFrete(null);
            }}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-lg max-w-4xl w-full border border-gray-200 shadow-xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">
                  {editingFrete ? 'Editar Frete' : 'Postar Novo Frete'}
                </h2>
                <button
                  onClick={() => {
                    setIsFormOpen(false);
                    setEditingFrete(null);
                  }}
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
                initialFrete={editingFrete ?? undefined}
                onSubmit={editingFrete ? handleUpdateFrete : handleCreateFrete}
                onCancel={() => {
                  setIsFormOpen(false);
                  setEditingFrete(null);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
