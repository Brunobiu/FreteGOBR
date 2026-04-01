import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import HomePage from './pages/HomePage';
import ChatWidget from './components/ChatWidget';

// Lazy load pages
const MotoristaPerfilPage = lazy(() => import('./pages/MotoristaPerfilPage'));
const EmbarcadorPage = lazy(() => import('./pages/EmbarcadorPage'));
const EmbarcadorPerfilPage = lazy(() => import('./pages/EmbarcadorPerfilPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ConfiguracoesPage = lazy(() => import('./pages/ConfiguracoesPage'));

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
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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
          path="/admin"
          element={
            <ProtectedRoute>
              <LazyRoute>
                <AdminPage />
              </LazyRoute>
            </ProtectedRoute>
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
      </Routes>
      <ChatWidget />
    </BrowserRouter>
  );
}

export default App;
