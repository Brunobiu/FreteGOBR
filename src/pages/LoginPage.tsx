import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import type { LoginCredentials } from '../types';

export function LoginPage() {
  useDocumentTitle('Login');
  const navigate = useNavigate();
  const location = useLocation();
  const { login, user } = useAuth();

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
    <div className="min-h-screen bg-gray-100 relative flex items-center justify-center p-4">
      {/* Conteudo centralizado */}
      <LoginForm
        onSubmit={handleLogin}
        onRegisterClick={() => navigate('/register')}
        successMessage={state?.successMessage}
        initialPhone={state?.phone}
      />
    </div>
  );
}
