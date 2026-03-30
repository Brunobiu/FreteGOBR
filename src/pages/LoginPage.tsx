import { useNavigate } from 'react-router-dom';
import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../hooks/useAuth';
import type { LoginCredentials } from '../types';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();

  const handleLogin = async (credentials: LoginCredentials) => {
    await login(credentials);
    // Após login, o user é atualizado no context
    // Redireciona baseado no localStorage (que já foi salvo pelo login)
    const stored = localStorage.getItem('fretego_user');
    if (stored) {
      const u = JSON.parse(stored);
      navigate(u.userType === 'embarcador' ? '/embarcador' : '/');
    } else {
      navigate('/');
    }
  };

  // Se já logado, redireciona
  if (user) {
    navigate(user.userType === 'embarcador' ? '/embarcador' : '/');
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <LoginForm onSubmit={handleLogin} onRegisterClick={() => navigate('/register')} />
    </div>
  );
}
