import { useNavigate } from 'react-router-dom';
import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../hooks/useAuth';
import type { LoginCredentials } from '../types';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleLogin = async (credentials: LoginCredentials) => {
    await login(credentials);
    navigate('/dashboard');
  };

  const handleRegisterClick = () => {
    navigate('/register');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <LoginForm onSubmit={handleLogin} onRegisterClick={handleRegisterClick} />
    </div>
  );
}
