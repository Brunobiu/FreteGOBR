import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { MotoristaProtectedRoute } from './components/MotoristaProtectedRoute';
import HomePage from './pages/HomePage';
import LandingPage from './pages/LandingPage';
import NotFoundPage from './pages/NotFoundPage';
import NotificationToast from './components/NotificationToast';
import NativeBackButton from './components/NativeBackButton';
import NativePushBootstrap from './components/NativePushBootstrap';
import { PixelProvider } from './components/marketing/PixelProvider';
import { CookieConsentProvider } from './components/cookies/CookieConsentProvider';
import CookieBanner from './components/cookies/CookieBanner';
import DocRevalidationModal from './components/DocRevalidationModal';
import { useAuth } from './hooks/useAuth';

// Widget flutuante global: não é crítico para o primeiro paint, então
// carrega depois (defer) para não pesar o bundle inicial.
const FreteChatWidget = lazy(() => import('./components/FreteChatWidget'));

// Lazy load pages
const MotoristaPerfilPage = lazy(() => import('./pages/MotoristaPerfilPage'));
const MotoristaMenuPage = lazy(() => import('./pages/MotoristaMenuPage'));
const MotoristaPerfilDadosPage = lazy(() => import('./pages/MotoristaPerfilDadosPage'));
const MotoristaVeiculoPage = lazy(() => import('./pages/MotoristaVeiculoPage'));
const MotoristaTracaoPage = lazy(() => import('./pages/MotoristaTracaoPage'));
const MotoristaCarroceriaPage = lazy(() => import('./pages/MotoristaCarroceriaPage'));
const MotoristaComplementoPage = lazy(() => import('./pages/MotoristaComplementoPage'));
const MotoristaReferenciasPage = lazy(() => import('./pages/MotoristaReferenciasPage'));
const MotoristaContratoPage = lazy(() => import('./pages/MotoristaContratoPage'));
const MotoristaPlanPage = lazy(() => import('./pages/MotoristaPlanPage'));
const EmbarcadorPage = lazy(() => import('./pages/EmbarcadorPage'));
const EmbarcadorPerfilPage = lazy(() => import('./pages/EmbarcadorPerfilPage'));
const EmbarcadorPlanPage = lazy(() => import('./pages/EmbarcadorPlanPage'));
const ConfiguracoesPage = lazy(() => import('./pages/ConfiguracoesPage'));
const MensagensPage = lazy(() => import('./pages/MensagensPage'));
const NotificacoesPage = lazy(() => import('./pages/NotificacoesPage'));
const AssistentePage = lazy(() => import('./pages/AssistantePage'));
const PublicTicketPage = lazy(() => import('./pages/PublicTicketPage'));
const TermosPage = lazy(() => import('./pages/TermosPage'));
const PrivacidadePage = lazy(() => import('./pages/PrivacidadePage'));
const RedefinirSenhaPage = lazy(() => import('./pages/RedefinirSenhaPage'));
const MyTicketsPage = lazy(() => import('./pages/MyTicketsPage'));
const NewTicketPage = lazy(() => import('./pages/NewTicketPage'));
const MyTicketDetailPage = lazy(() => import('./pages/MyTicketDetailPage'));
const SupportChatPage = lazy(() => import('./pages/SupportChatPage'));
const TutorialPage = lazy(() => import('./pages/TutorialPage'));

// Honeypot pages - rotas armadilha para detectar bots
const HoneypotPage = lazy(() => import('./pages/HoneypotPage'));

// Painel administrativo (admin-foundation)
const AdminLayoutRoute = lazy(() => import('./components/admin/AdminLayoutRoute'));

// Mapa fullscreen do motorista (rota dedicada)
const MotoristaMapaPage = lazy(() => import('./pages/MotoristaMapaPage'));

function LazyRoute({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 flex items-center justify-center">
          <div className="text-gray-400">Carregando...</div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * RootRoute — decide o que renderizar em `/`:
 *  - Visitante não logado: LandingPage (página de entrada).
 *  - Usuário logado: HomePage (lista de fretes).
 * A lista pública de fretes também fica acessível em `/fretes` para o
 * visitante explorar antes de criar conta.
 */
function RootRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-400">Carregando...</div>
      </div>
    );
  }

  return isAuthenticated ? <HomePage /> : <LandingPage />;
}

function App() {
  return (
    <BrowserRouter>
      <CookieConsentProvider>
        <PixelProvider>
          <NativeBackButton />
          <NativePushBootstrap />
          <NotificationToast />
          <Suspense fallback={null}>
            <FreteChatWidget />
          </Suspense>
          <Routes>
            <Route path="/" element={<RootRoute />} />
            <Route path="/fretes" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/redefinir-senha"
              element={
                <LazyRoute>
                  <RedefinirSenhaPage />
                </LazyRoute>
              }
            />
            <Route
              path="/contato"
              element={
                <LazyRoute>
                  <PublicTicketPage />
                </LazyRoute>
              }
            />
            <Route
              path="/termos"
              element={
                <LazyRoute>
                  <TermosPage />
                </LazyRoute>
              }
            />
            <Route
              path="/privacidade"
              element={
                <LazyRoute>
                  <PrivacidadePage />
                </LazyRoute>
              }
            />
            <Route
              path="/perfil/motorista"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <MotoristaPerfilPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/motorista/menu"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MotoristaMenuPage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/motorista/perfil"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MotoristaPerfilDadosPage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/motorista/veiculo"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MotoristaVeiculoPage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/motorista/tracao"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MotoristaTracaoPage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/motorista/carroceria"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MotoristaCarroceriaPage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/motorista/complemento"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MotoristaComplementoPage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/motorista/referencias"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MotoristaReferenciasPage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/motorista/contrato"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MotoristaContratoPage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/motorista/plano"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <MotoristaPlanPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/motorista/mapa"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MotoristaMapaPage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/embarcador"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <EmbarcadorPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/perfil/embarcador"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <EmbarcadorPerfilPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/embarcador/plano"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <EmbarcadorPlanPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/*"
              element={
                <LazyRoute>
                  <AdminLayoutRoute />
                </LazyRoute>
              }
            />
            <Route
              path="/configuracoes"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <ConfiguracoesPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/mensagens"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <MensagensPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/notificacoes"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <NotificacoesPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/assistente"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <AssistentePage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/tickets"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <MyTicketsPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/tickets/novo"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <NewTicketPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/tickets/:id"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <MyTicketDetailPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/suporte/chat"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <SupportChatPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/tutorial"
              element={
                <ProtectedRoute>
                  <LazyRoute>
                    <TutorialPage />
                  </LazyRoute>
                </ProtectedRoute>
              }
            />

            {/* Honeypot routes - armadilhas para detectar scanners */}
            <Route
              path="/admin-legacy"
              element={
                <LazyRoute>
                  <HoneypotPage />
                </LazyRoute>
              }
            />
            <Route
              path="/wp-admin"
              element={
                <LazyRoute>
                  <HoneypotPage />
                </LazyRoute>
              }
            />
            <Route
              path="/administrator"
              element={
                <LazyRoute>
                  <HoneypotPage />
                </LazyRoute>
              }
            />

            {/* Catch-all global: 404 padrao do app */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          <CookieBanner />
          <DocRevalidationModal />
        </PixelProvider>
      </CookieConsentProvider>
    </BrowserRouter>
  );
}

export default App;
