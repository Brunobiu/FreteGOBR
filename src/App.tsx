import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { MotoristaProtectedRoute } from './components/MotoristaProtectedRoute';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import NotificationToast from './components/NotificationToast';
import FreteChatWidget from './components/FreteChatWidget';
import NativeBackButton from './components/NativeBackButton';
import NativePushBootstrap from './components/NativePushBootstrap';

// Lazy load pages
const MotoristaPerfilPage = lazy(() => import('./pages/MotoristaPerfilPage'));
const MotoristaPlanPage = lazy(() => import('./pages/MotoristaPlanPage'));
const EmbarcadorPage = lazy(() => import('./pages/EmbarcadorPage'));
const EmbarcadorPerfilPage = lazy(() => import('./pages/EmbarcadorPerfilPage'));
const EmbarcadorPlanPage = lazy(() => import('./pages/EmbarcadorPlanPage'));
const ConfiguracoesPage = lazy(() => import('./pages/ConfiguracoesPage'));
const MensagensPage = lazy(() => import('./pages/MensagensPage'));
const NotificacoesPage = lazy(() => import('./pages/NotificacoesPage'));
const AssistentePage = lazy(() => import('./pages/AssistantePage'));
const PublicTicketPage = lazy(() => import('./pages/PublicTicketPage'));
const MyTicketsPage = lazy(() => import('./pages/MyTicketsPage'));
const NewTicketPage = lazy(() => import('./pages/NewTicketPage'));
const MyTicketDetailPage = lazy(() => import('./pages/MyTicketDetailPage'));
const SupportChatPage = lazy(() => import('./pages/SupportChatPage'));

// Honeypot pages - rotas armadilha para detectar bots
const HoneypotPage = lazy(() => import('./pages/HoneypotPage'));

// Painel administrativo (admin-foundation)
const AdminLayoutRoute = lazy(() => import('./components/admin/AdminLayoutRoute'));

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

function App() {
  return (
    <BrowserRouter>
      <NativeBackButton />
      <NativePushBootstrap />
      <NotificationToast />
      <FreteChatWidget />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/contato"
          element={
            <LazyRoute>
              <PublicTicketPage />
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
    </BrowserRouter>
  );
}

export default App;
