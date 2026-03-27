import { useNavigate } from 'react-router-dom';
import { RegisterForm } from '../components/RegisterForm';
import { useAuth } from '../hooks/useAuth';
import type { RegisterData } from '../types';

export function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const handleRegister = async (data: RegisterData) => {
    await register(data);
    navigate('/dashboard');
  };

  const handleLoginClick = () => {
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <RegisterForm onSubmit={handleRegister} onLoginClick={handleLoginClick} />
    </div>
  );
}
