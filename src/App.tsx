import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import HomePage from './pages/HomePage';
import MotoristaPerfilPage from './pages/MotoristaPerfilPage';
import EmbarcadorPage from './pages/EmbarcadorPage';
import EmbarcadorPerfilPage from './pages/EmbarcadorPerfilPage';
import AdminPage from './pages/AdminPage';
import ChatWidget from './components/ChatWidget';

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
              <MotoristaPerfilPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/embarcador"
          element={
            <ProtectedRoute>
              <EmbarcadorPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/perfil/embarcador"
          element={
            <ProtectedRoute>
              <EmbarcadorPerfilPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminPage />
            </ProtectedRoute>
          }
        />
      </Routes>
      <ChatWidget />
    </BrowserRouter>
  );
}

export default App;
