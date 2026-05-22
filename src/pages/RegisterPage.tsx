import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RegisterForm } from '../components/RegisterForm';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../services/supabase';
import type { RegisterData } from '../types';

const BG_IMAGE = 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1920&q=80';

export function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [imageError, setImageError] = useState(false);

  const handleRegister = async (data: RegisterData) => {
    await register(data);
    // Encerra a sessão criada automaticamente pelo Supabase Auth.signUp
    // para que o usuário precise fazer login manualmente.
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore — best effort
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
    <div className="min-h-screen relative">
      {/* Imagem de fundo */}
      {!imageError ? (
        <img
          src={BG_IMAGE}
          alt=""
          role="presentation"
          onError={() => setImageError(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900 to-gray-900" />
      )}

      {/* Overlay escuro */}
      <div className="absolute inset-0 bg-black/55" />

      {/* Conteúdo centralizado */}
      <div className="relative min-h-screen flex items-center justify-center p-4 py-8">
        <RegisterForm onSubmit={handleRegister} onLoginClick={() => navigate('/login')} />
      </div>
    </div>
  );
}
