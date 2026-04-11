import { useEffect, useState } from 'react';
import type { Frete } from '../services/fretes';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { getDocumentsByUser } from '../services/documents';
import RatingDisplay from './RatingDisplay';
import { getEmbarcadorProfile } from '../services/embarcador';
import { getOrCreateFreteConversation } from '../services/chatFrete';

const ACTIVE_CHAT_KEY = 'fretego-active-chat';

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
}

export default function FreteModal({
  frete,
  isOpen,
  onClose,
  embarcadorWhatsApp,
}: FreteModalProps) {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(false);
  const [embarcadorRating, setEmbarcadorRating] = useState(0);
  const [embarcadorTotalRatings, setEmbarcadorTotalRatings] = useState(0);

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
    // Carrega rating do embarcador
    if (isOpen && frete) {
      getEmbarcadorProfile(frete.embarcadorId)
        .then((p) => {
          if (p) {
            setEmbarcadorRating(p.rating);
            setEmbarcadorTotalRatings(p.totalRatings);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, isAuthenticated, user, frete]);

  if (!isOpen || !frete) return null;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatWeight = (weight: number) => {
    if (weight >= 1000) {
      return `${(weight / 1000).toFixed(2)} toneladas`;
    }
    return `${weight} kg`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

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
      if (confirm('Seu perfil precisa estar 100% completo para contratar fretes. Deseja completar agora?')) {
        navigate('/perfil/motorista');
      }
      return;
    }

    // Abre WhatsApp com mensagem automática
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
      localStorage.setItem(ACTIVE_CHAT_KEY, conv.id);
      onClose();
      // Dispara evento para o FreteChatWidget abrir
      window.dispatchEvent(new CustomEvent('fretego-open-chat', { detail: { conversationId: conv.id } }));
    } catch (err) {
      console.error('Erro ao abrir chat:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-75" onClick={onClose} />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg max-w-3xl w-full border border-gray-200 shadow-xl">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
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

          {/* Content */}
          <div className="p-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Detalhes do Frete</h2>

            {/* Route */}
            <div className="mb-6">
              <div className="flex items-center space-x-4">
                <div className="flex-1">
                  <p className="text-sm text-gray-500 mb-1">Origem</p>
                  <p className="text-lg font-semibold text-gray-800">{frete.origin}</p>
                </div>
                <svg
                  className="w-8 h-8 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
                <div className="flex-1">
                  <p className="text-sm text-gray-500 mb-1">Destino</p>
                  <p className="text-lg font-semibold text-gray-800">{frete.destination}</p>
                </div>
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <p className="text-sm text-gray-500 mb-1">Tipo de Carga</p>
                <p className="text-gray-800 font-medium capitalize">{frete.cargoType}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <p className="text-sm text-gray-500 mb-1">Tipo de Veículo</p>
                <p className="text-gray-800 font-medium capitalize">{frete.vehicleType}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <p className="text-sm text-gray-500 mb-1">Peso</p>
                <p className="text-gray-800 font-medium">{formatWeight(frete.weight)}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <p className="text-sm text-gray-500 mb-1">Valor</p>
                {isAuthenticated ? (
                  <p className="text-green-600 font-bold text-lg">{formatCurrency(frete.value)}</p>
                ) : (
                  <div>
                    <p className="text-gray-400 text-sm">••••••</p>
                    <button
                      onClick={() => navigate('/login')}
                      className="text-xs text-blue-500 hover:underline mt-1"
                    >
                      Faça login para ver
                    </button>
                  </div>
                )}
              </div>
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <p className="text-sm text-gray-500 mb-1">Prazo de Entrega</p>
                <p className="text-gray-800 font-medium">{formatDate(frete.deadline)}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <p className="text-sm text-gray-500 mb-1">Tempo de Carga/Descarga</p>
                <p className="text-gray-800 font-medium">
                  {frete.loadingTime}min / {frete.unloadingTime}min
                </p>
              </div>
            </div>

            {/* Specifications */}
            {frete.specifications && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">Especificações</h3>
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <p className="text-gray-700">{frete.specifications}</p>
                </div>
              </div>
            )}

            {/* Analytics */}
            <div className="flex items-center space-x-6 mb-6 text-sm text-gray-500">
              <span className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path
                    fillRule="evenodd"
                    d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                    clipRule="evenodd"
                  />
                </svg>
                {frete.viewsCount} visualizações
              </span>
              <span className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                </svg>
                {frete.clicksCount} cliques
              </span>
            </div>

            {/* Avaliações do Embarcador */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Avaliações do Embarcador</h3>
              <RatingDisplay
                embarcadorId={frete.embarcadorId}
                rating={embarcadorRating}
                totalRatings={embarcadorTotalRatings}
              />
            </div>

            {/* Action Button */}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                onClick={onClose}
                className="px-6 py-3 bg-gray-200 text-gray-800 font-medium rounded-lg hover:bg-gray-300"
              >
                Fechar
              </button>

              {/* Visitante: botão de login */}
              {!isAuthenticated && (
                <button
                  onClick={() => navigate('/login')}
                  className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
                >
                  Fazer Login para Contratar
                </button>
              )}

              {/* Motorista com perfil incompleto */}
              {isAuthenticated && user?.userType === 'motorista' && profileComplete === false && !checkingProfile && (
                <button
                  onClick={() => navigate('/perfil/motorista')}
                  className="px-6 py-3 bg-yellow-500 text-white font-medium rounded-lg hover:bg-yellow-600 flex items-center"
                >
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Completar Perfil para Contratar
                </button>
              )}

              {/* Motorista com perfil completo: botão WhatsApp */}
              {isAuthenticated && user?.userType === 'motorista' && profileComplete === true && embarcadorWhatsApp && (
                <button
                  onClick={handleContratar}
                  className="px-6 py-3 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 flex items-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Contratar via WhatsApp
                </button>
              )}

              {/* Motorista com perfil completo: botão Chat */}
              {isAuthenticated && user?.userType === 'motorista' && profileComplete === true && (
                <button
                  onClick={handleOpenChat}
                  className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 flex items-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  Chat
                </button>
              )}

              {/* Verificando perfil */}
              {isAuthenticated && user?.userType === 'motorista' && checkingProfile && (
                <button disabled className="px-6 py-3 bg-gray-300 text-gray-500 font-medium rounded-lg cursor-not-allowed">
                  Verificando perfil...
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
