import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../hooks/useAuth';
import type { LoginCredentials } from '../types';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();

  // Se já logado, redireciona (no useEffect pra evitar warning)
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

  return <LoginForm onSubmit={handleLogin} onRegisterClick={() => navigate('/register')} />;
}
