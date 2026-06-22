import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import AuthShell, { type AuthAudience } from '../components/public/AuthShell';
import type { LoginCredentials } from '../types';

export function LoginPage() {
  useDocumentTitle('Login');
  const navigate = useNavigate();
  const location = useLocation();
  const { login, user } = useAuth();
  // Público escolhido — só troca a foto à direita no desktop. Vem da seleção
  // nativa "Deseja entrar como" do próprio LoginForm (sem toggle duplicado).
  const [audience, setAudience] = useState<AuthAudience>(null);

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
    <AuthShell audience={audience}>
      <LoginForm
        onSubmit={handleLogin}
        onRegisterClick={() => navigate('/register')}
        successMessage={state?.successMessage}
        initialPhone={state?.phone}
        onProfileChange={setAudience}
        onBack={() => navigate('/')}
      />
    </AuthShell>
  );
}