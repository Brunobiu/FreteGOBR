/**
 * MotoristaMapaPage — pagina dedicada `/motorista/mapa`.
 *
 * Renderiza o `MotoristaMapaFullscreen` em tela cheia, sem
 * `AppHeader` nem `MotoristaBottomNav`. Header proprio compacto
 * (48px) com botao Voltar + titulo "Mapa de fretes".
 *
 * Guards:
 *   - `isLoading` (auth)        → skeleton
 *   - `!isAuthenticated`         → redirect /login
 *   - userType !== 'motorista'   → redirect /
 *
 * `MotoristaMapaFullscreen` e carregado lazy para nao arrastar
 * Leaflet pro entry chunk.
 */

import { lazy, Suspense } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useTabSlideClass } from '../hooks/useTabTransition';

const MotoristaMapaFullscreen = lazy(() => import('../components/mapa/MotoristaMapaFullscreen'));

function MapaSkeleton() {
  return (
    <div className="flex-1 bg-gray-100 animate-pulse flex items-center justify-center text-gray-400 text-sm">
      Carregando mapa...
    </div>
  );
}

function MapaTopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="sticky top-0 z-30 bg-white border-b border-gray-200 h-12 flex items-center px-3 sm:px-4 gap-3 shrink-0">
      <button
        type="button"
        onClick={onBack}
        aria-label="Voltar"
        className="-ml-1 p-1.5 text-gray-600 hover:text-gray-900 rounded-md hover:bg-gray-100"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h1 className="text-sm sm:text-base font-semibold text-gray-800 flex-1">Mapa de fretes</h1>
    </div>
  );
}

export default function MotoristaMapaPage() {
  useDocumentTitle('Mapa de fretes');
  const { user, isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const slideClass = useTabSlideClass();

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-gray-100">
        <MapaTopBar onBack={handleBack} />
        <MapaSkeleton />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.userType !== 'motorista') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={`flex flex-col h-[100dvh] w-screen overflow-hidden bg-gray-100 ${slideClass}`}>
      <MapaTopBar onBack={handleBack} />
      <Suspense fallback={<MapaSkeleton />}>
        <MotoristaMapaFullscreen className="flex-1" />
      </Suspense>
    </div>
  );
}
