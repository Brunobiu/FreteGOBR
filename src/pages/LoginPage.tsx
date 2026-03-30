import { useNavigate } from 'react-router-dom';
import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../hooks/useAuth';
import type { LoginCredentials } from '../types';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();

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

  if (user) {
    navigate(user.userType === 'embarcador' ? '/embarcador' : '/');
  }

  return <LoginForm onSubmit={handleLogin} onRegisterClick={() => navigate('/register')} />;
}
