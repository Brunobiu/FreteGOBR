import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import HomePage from './pages/HomePage';
import MotoristaPerfilPage from './pages/MotoristaPerfilPage';
import EmbarcadorPage from './pages/EmbarcadorPage';
import EmbarcadorPerfilPage from './pages/EmbarcadorPerfilPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Página principal: listagem de fretes (pública) */}
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Perfil do motorista (protegida) */}
        <Route
          path="/perfil/motorista"
          element={
            <ProtectedRoute>
              <MotoristaPerfilPage />
            </ProtectedRoute>
          }
        />

        {/* Página principal do embarcador (protegida) */}
        <Route
          path="/embarcador"
          element={
            <ProtectedRoute>
              <EmbarcadorPage />
            </ProtectedRoute>
          }
        />

        {/* Perfil do embarcador (protegida) */}
        <Route
          path="/perfil/embarcador"
          element={
            <ProtectedRoute>
              <EmbarcadorPerfilPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
