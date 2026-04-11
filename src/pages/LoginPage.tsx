import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../hooks/useAuth';
import type { LoginCredentials } from '../types';

// Imagem de fundo - caminhão em estrada (Unsplash)
const BG_IMAGE = 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1920&q=80';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (user) {
      navigate(user.userType === 'embarcador' ? '/embarcador' : '/');
    }
  }, [user, navigate]);

  const handleLogin = async (credentials: LoginCredentials) => {
    await login(credentials);
    const stored = localStorage.getItem('fretego_user');
    if (stored) {
      const u = JSON.parse(stored);
      navigate(u.userType === 'embarcador' ? '/embarcador' : '/');
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen relative">
      {/* Imagem de fundo */}
      {!imageError ? (
        <img
          src={BG_IMAGE}
          alt=""
          role="presentation"
          onError={() => setImageError(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900 to-gray-900" />
      )}

      {/* Overlay escuro */}
      <div className="absolute inset-0 bg-black/55" />

      {/* Conteúdo centralizado */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <LoginForm
          onSubmit={handleLogin}
          onRegisterClick={() => navigate('/register')}
        />
      </div>
    </div>
  );
}
