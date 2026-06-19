import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import SiteFooter from '../components/SiteFooter';
import AppMiniFooter from '../components/AppMiniFooter';
import type { LoginCredentials } from '../types';

export function LoginPage() {
  useDocumentTitle('Login');
  const navigate = useNavigate();
  const location = useLocation();
  const { login, user } = useAuth();

  // App nativo (Android/iOS): rodape minimo e profissional.
  // Web: mantem o SiteFooter completo, sem alteracao.
  const isApp = Capacitor.isNativePlatform();

  const state = (location.state ?? null) as { successMessage?: string; phone?: string } | null;

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
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Conteudo centralizado (form fica no centro da area livre) */}
      <div className="flex-1 flex items-center justify-center p-4">
        <LoginForm
          onSubmit={handleLogin}
          onRegisterClick={() => navigate('/register')}
          successMessage={state?.successMessage}
          initialPhone={state?.phone}
        />
      </div>

      {isApp ? (
        // App: rodape minimo (Termos de Uso + versao), bem discreto.
        <AppMiniFooter />
      ) : (
        // Web: rodape completo, inalterado.
        <SiteFooter />
      )}
    </div>
  );
}
