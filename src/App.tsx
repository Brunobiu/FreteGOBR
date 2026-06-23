import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Suspense } from 'react';
import { ProtectedRoute } from './components/ProtectedRoute';
import { MotoristaProtectedRoute } from './components/MotoristaProtectedRoute';
import NotificationToast from './components/NotificationToast';
import NativeBackButton from './components/NativeBackButton';
import ScrollManager from './components/ScrollManager';
import NativePushBootstrap from './components/NativePushBootstrap';
import { PixelProvider } from './components/marketing/PixelProvider';
import { CookieConsentProvider } from './components/cookies/CookieConsentProvider';
import { AccessChoiceProvider } from './components/public/AccessChoice';
import CookieBanner from './components/cookies/CookieBanner';
import DocRevalidationModal from './components/DocRevalidationModal';
import { useAuth } from './hooks/useAuth';
import { lazyWithRetry, LazyBoundary } from './utils/lazyWithRetry';

// Widget flutuante global: não é crítico para o primeiro paint, então
// carrega depois (defer) para não pesar o bundle inicial.
const FreteChatWidget = lazyWithRetry(() => import('./components/FreteChatWidget'));

// Splash de abertura (animação Lottie em public/splash-animation.json).
// TEMPORARIAMENTE DESATIVADA a pedido — o componente src/components/WelcomeSplash
// e o JSON continuam no projeto. Pra religar: reponha o import lazy de
// WelcomeSplash, a função WelcomeSplashGate e o <WelcomeSplashGate /> dentro
// do <BrowserRouter>.

// Páginas de entrada / fluxo de autenticação — convertidas de eager para lazy
// com retry de chunk (Req 5.1, 5.2, 5.5). LoginPage e RegisterPage são named
// exports, por isso o adaptador `.then(m => ({ default: m.X }))`.
const HomePage = lazyWithRetry(() => import('./pages/HomePage'));
const LandingPage = lazyWithRetry(() => import('./pages/LandingPage'));
const NotFoundPage = lazyWithRetry(() => import('./pages/NotFoundPage'));
const LoginPage = lazyWithRetry(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage }))
);
const RegisterPage = lazyWithRetry(() =>
  import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage }))
);

// Lazy load pages
const MotoristaPerfilPage = lazyWithRetry(() => import('./pages/MotoristaPerfilPage'));
const MotoristaMenuPage = lazyWithRetry(() => import('./pages/MotoristaMenuPage'));
const MotoristaPerfilDadosPage = lazyWithRetry(() => import('./pages/MotoristaPerfilDadosPage'));
const MotoristaVeiculoPage = lazyWithRetry(() => import('./pages/MotoristaVeiculoPage'));
const MotoristaTracaoPage = lazyWithRetry(() => import('./pages/MotoristaTracaoPage'));
const MotoristaCarroceriaPage = lazyWithRetry(() => import('./pages/MotoristaCarroceriaPage'));
const MotoristaComplementoPage = lazyWithRetry(() => import('./pages/MotoristaComplementoPage'));
const MotoristaReferenciasPage = lazyWithRetry(() => import('./pages/MotoristaReferenciasPage'));
const MotoristaContratoPage = lazyWithRetry(() => import('./pages/MotoristaContratoPage'));
const MotoristaPlanPage = lazyWithRetry(() => import('./pages/MotoristaPlanPage'));
const EmbarcadorPage = lazyWithRetry(() => import('./pages/EmbarcadorPage'));
const EmbarcadorPerfilPage = lazyWithRetry(() => import('./pages/EmbarcadorPerfilPage'));
const EmbarcadorPlanPage = lazyWithRetry(() => import('./pages/EmbarcadorPlanPage'));
const ConfiguracoesPage = lazyWithRetry(() => import('./pages/ConfiguracoesPage'));
const MensagensPage = lazyWithRetry(() => import('./pages/MensagensPage'));
const NotificacoesPage = lazyWithRetry(() => import('./pages/NotificacoesPage'));
const AssistentePage = lazyWithRetry(() => import('./pages/AssistantePage'));
const PublicTicketPage = lazyWithRetry(() => import('./pages/PublicTicketPage'));
const TermosPage = lazyWithRetry(() => import('./pages/TermosPage'));
const PrivacidadePage = lazyWithRetry(() => import('./pages/PrivacidadePage'));
const AudienceLandingPage = lazyWithRetry(() => import('./pages/AudienceLandingPage'));
const SaibaMaisPage = lazyWithRetry(() => import('./pages/SaibaMaisPage'));
const IaLandingPage = lazyWithRetry(() => import('./pages/IaLandingPage'));
const FretesAoVivoPage = lazyWithRetry(() => import('./pages/FretesAoVivoPage'));
const RedefinirSenhaPage = lazyWithRetry(() => import('./pages/RedefinirSenhaPage'));
const MyTicketsPage = lazyWithRetry(() => import('./pages/MyTicketsPage'));
const NewTicketPage = lazyWithRetry(() => import('./pages/NewTicketPage'));
const MyTicketDetailPage = lazyWithRetry(() => import('./pages/MyTicketDetailPage'));
const SupportChatPage = lazyWithRetry(() => import('./pages/SupportChatPage'));
const TutorialPage = lazyWithRetry(() => import('./pages/TutorialPage'));
const MarketplacePage = lazyWithRetry(() => import('./pages/MarketplacePage'));
const MarketplacePostDetailPage = lazyWithRetry(() => import('./pages/MarketplacePostDetailPage'));

// Honeypot pages - rotas armadilha para detectar bots
const HoneypotPage = lazyWithRetry(() => import('./pages/HoneypotPage'));

// Painel administrativo (admin-foundation)
const AdminLayoutRoute = lazyWithRetry(() => import('./components/admin/AdminLayoutRoute'));

// Mapa fullscreen do motorista (rota dedicada)
const MotoristaMapaPage = lazyWithRetry(() => import('./pages/MotoristaMapaPage'));

function LazyRoute({ children }: { children: React.ReactNode }) {
  return (
    <LazyBoundary>
      <Suspense
        fallback={
          <div className="min-h-screen bg-gray-100 flex items-center justify-center">
            <div className="text-gray-400">Carregando...</div>
          </div>
        }
      >
        {children}
      </Suspense>
    </LazyBoundary>
  );
}

/**
 * RootRoute — decide o que renderizar em `/`:
 *  - Visitante não logado: LandingPage (página de entrada).
 *  - Usuário logado: HomePage (lista de fretes).
 * A lista pública de fretes também fica acessível em `/fretes` para o
 * visitante explorar antes de criar conta.
 *
 * HomePage e LandingPage agora são lazy, então o resultado é envolvido em
 * `LazyRoute` (Suspense + boundary) para exibir o fallback de Shell enquanto o
 * chunk carrega, sem quebrar a navegação.
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

  if (isAuthenticated) {
    return (
      <LazyRoute>
        <HomePage />
      </LazyRoute>
    );
  }

  // No app nativo (Capacitor) o usuário já baixou o app — não faz sentido cair
  // na landing de marketing. Vai direto pro login. No navegador, mantém a
  // LandingPage como porta de entrada.
  if (Capacitor.isNativePlatform()) {
    return <Navigate to="/login" replace />;
  }

  return (
    <LazyRoute>
      <LandingPage />
    </LazyRoute>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ScrollManager />
      <AccessChoiceProvider>
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
            <Route
              path="/fretes"
              element={
                <LazyRoute>
                  <HomePage />
                </LazyRoute>
              }
            />
            <Route
              path="/login"
              element={
                <LazyRoute>
                  <LoginPage />
                </LazyRoute>
              }
            />
            <Route
              path="/register"
              element={
                <LazyRoute>
                  <RegisterPage />
                </LazyRoute>
              }
            />
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
              path="/para-embarcadores"
              element={
                <LazyRoute>
                  <AudienceLandingPage audience="embarcador" />
                </LazyRoute>
              }
            />
            <Route
              path="/para-caminhoneiros"
              element={
                <LazyRoute>
                  <AudienceLandingPage audience="motorista" />
                </LazyRoute>
              }
            />
            <Route
              path="/saiba/:slug"
              element={
                <LazyRoute>
                  <SaibaMaisPage />
                </LazyRoute>
              }
            />
            <Route
              path="/ia"
              element={
                <LazyRoute>
                  <IaLandingPage />
                </LazyRoute>
              }
            />
            <Route
              path="/fretes-ao-vivo"
              element={
                <LazyRoute>
                  <FretesAoVivoPage />
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
              path="/motorista/marketplace"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MarketplacePage />
                  </LazyRoute>
                </MotoristaProtectedRoute>
              }
            />
            <Route
              path="/motorista/marketplace/:id"
              element={
                <MotoristaProtectedRoute>
                  <LazyRoute>
                    <MarketplacePostDetailPage />
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
            <Route
              path="*"
              element={
                <LazyRoute>
                  <NotFoundPage />
                </LazyRoute>
              }
            />
          </Routes>
          <CookieBanner />
          <DocRevalidationModal />
        </PixelProvider>
      </CookieConsentProvider>
      </AccessChoiceProvider>
    </BrowserRouter>
  );
}

export default App;
