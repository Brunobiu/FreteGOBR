import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import MotoristaDashboardPage from './pages/MotoristaDashboardPage';
import MotoristaHomePage from './pages/MotoristaHomePage';
import MotoristaProfilePage from './pages/MotoristaProfilePage';
import MotoristaDocumentsPage from './pages/MotoristaDocumentsPage';
import EmbarcadorDashboardPage from './pages/EmbarcadorDashboardPage';
import EmbarcadorHomePage from './pages/EmbarcadorHomePage';
import EmbarcadorProfilePage from './pages/EmbarcadorProfilePage';
import EmbarcadorPublicProfilePage from './pages/EmbarcadorPublicProfilePage';
import FretesListPage from './pages/FretesListPage';
import PostarFretePage from './pages/PostarFretePage';
import MeusFretesPage from './pages/MeusFretesPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Motorista Routes */}
        <Route
          path="/motorista"
          element={
            <ProtectedRoute>
              <MotoristaDashboardPage />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/motorista/dashboard" replace />} />
          <Route path="dashboard" element={<MotoristaHomePage />} />
          <Route path="perfil" element={<MotoristaProfilePage />} />
          <Route path="documentos" element={<MotoristaDocumentsPage />} />
          <Route path="fretes" element={<FretesListPage />} />
          <Route
            path="calculadora"
            element={<div className="p-8 text-white">Calculadora - Em breve</div>}
          />
        </Route>

        {/* Embarcador Routes */}
        <Route
          path="/embarcador"
          element={
            <ProtectedRoute>
              <EmbarcadorDashboardPage />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/embarcador/dashboard" replace />} />
          <Route path="dashboard" element={<EmbarcadorHomePage />} />
          <Route path="perfil" element={<EmbarcadorProfilePage />} />
          <Route path="meus-fretes" element={<MeusFretesPage />} />
          <Route path="postar-frete" element={<PostarFretePage />} />
        </Route>

        {/* Public Routes */}
        <Route path="/fretes" element={<FretesListPage />} />
        <Route path="/embarcador/:embarcadorId/perfil" element={<EmbarcadorPublicProfilePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
