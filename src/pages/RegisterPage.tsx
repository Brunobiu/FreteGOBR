import { useNavigate } from 'react-router-dom';
import { RegisterForm } from '../components/RegisterForm';
import { useAuth } from '../hooks/useAuth';
import type { RegisterData } from '../types';

export function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const handleRegister = async (data: RegisterData) => {
    await register(data);
    const stored = localStorage.getItem('fretego_user');
    if (stored) {
      const u = JSON.parse(stored);
      navigate(u.userType === 'embarcador' ? '/embarcador' : '/');
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <RegisterForm onSubmit={handleRegister} onLoginClick={() => navigate('/login')} />
    </div>
  );
}
