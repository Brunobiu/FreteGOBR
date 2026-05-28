import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RegisterForm } from '../components/RegisterForm';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { supabase } from '../services/supabase';
import type { RegisterData } from '../types';

export function RegisterPage() {
  useDocumentTitle('Criar Conta');
  const navigate = useNavigate();
  const { register } = useAuth();
  const [_imageError] = useState(false);

  const handleRegister = async (data: RegisterData) => {
    await register(data);
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    localStorage.removeItem('fretego_access_token');
    localStorage.removeItem('fretego_refresh_token');
    localStorage.removeItem('fretego_user');
    navigate('/login', {
      state: {
        successMessage: 'Conta criada com sucesso. Faça login para continuar.',
        phone: data.phone,
      },
    });
  };

  return (
    <div className="min-h-screen bg-gray-100 relative flex items-start md:items-center justify-center p-4 pt-6 md:py-8">
      <RegisterForm onSubmit={handleRegister} onLoginClick={() => navigate('/login')} />
    </div>
  );
}
