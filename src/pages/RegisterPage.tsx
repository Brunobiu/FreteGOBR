import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RegisterForm } from '../components/RegisterForm';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { usePixel } from '../components/marketing/pixelContext';
import AuthShell, { type AuthAudience } from '../components/public/AuthShell';
import { supabase } from '../services/supabase';
import type { RegisterData } from '../types';

export function RegisterPage() {
  useDocumentTitle('Criar Conta');
  const navigate = useNavigate();
  const { register } = useAuth();
  const { trackBusinessEvent } = usePixel();
  const [audience, setAudience] = useState<AuthAudience>(null);

  const handleRegister = async (data: RegisterData) => {
    await register(data);

    // Tracked_Event de negocio (CP-4): cadastro concluido. Gera o event_id uma
    // unica vez e propaga o MESMO id ao Pixel (browser) e ao CAPI (server). O
    // motorista emite `motorista_registration`; o embarcador,
    // `embarcador_registration` (Req 10.4, 10.5). Telefone como PII (a Edge
    // hasheia — CP-6); o e-mail nao e enviado por ser sintetico no Auth.
    const eventName =
      data.userType === 'motorista' ? 'motorista_registration' : 'embarcador_registration';
    trackBusinessEvent(eventName, { phone: data.phone });

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
    <AuthShell audience={audience} context="register">
      <RegisterForm
        onSubmit={handleRegister}
        onLoginClick={() => navigate('/login')}
        onUserTypeChange={setAudience}
      />
    </AuthShell>
  );
}
