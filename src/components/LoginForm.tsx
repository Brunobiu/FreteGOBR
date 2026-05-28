import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { LoginCredentials } from '../types';
import HoneypotDetector from '../services/honeypotDetector';
import PasswordInput from './PasswordInput';
import { checkBlacklistGate, GENERIC_LOGIN_MESSAGE } from '../services/admin/blacklist';

const loginSchema = z.object({
  phone: z
    .string()
    .min(1, 'Telefone é obrigatório')
    .refine(
      (val) => /^\d{10,11}$/.test(val.replace(/\D/g, '')),
      'Telefone deve ter 10 ou 11 dígitos'
    ),
  password: z.string().min(1, 'Senha é obrigatória'),
});

interface LoginFormProps {
  onSubmit: (credentials: LoginCredentials) => Promise<void>;
  onRegisterClick?: () => void;
  successMessage?: string;
  initialPhone?: string;
}

export function LoginForm({
  onSubmit,
  onRegisterClick,
  successMessage,
  initialPhone,
}: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<'embarcador' | 'motorista' | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const honeypotRef = useRef<HTMLInputElement>(null);

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 3) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 7)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3, 7)}-${numbers.slice(7)}`;
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginCredentials>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      phone: initialPhone ? formatPhone(initialPhone) : '',
      password: '',
    },
  });

  const handleProfileSelect = (profile: 'embarcador' | 'motorista') => {
    setSelectedProfile(profile);
    setIsTransitioning(true);
    setShowForm(false);
    setTimeout(() => {
      setIsTransitioning(false);
      setShowForm(true);
    }, 1500);
  };

  const handleFormSubmit = async (data: LoginCredentials) => {
    setIsLoading(true);
    setError(null);

    const honeypotValue = honeypotRef.current?.value || '';
    if (honeypotValue) {
      await HoneypotDetector.validateField(
        honeypotValue,
        'website_url',
        'client-side',
        navigator.userAgent
      );
      setIsLoading(false);
      return;
    }

    try {
      const cleanPhone = data.phone.replace(/\D/g, '');
      const { blocked } = await checkBlacklistGate('phone', cleanPhone, 'BLACKLIST_LOGIN_BLOCKED');
      if (blocked) {
        setError(GENERIC_LOGIN_MESSAGE);
        return;
      }
      await onSubmit({ ...data, phone: cleanPhone });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setIsLoading(false);
    }
  };

  // ==================== SELECAO DE PERFIL ====================
  if (!selectedProfile && !isTransitioning) {
    return (
      <div className="w-full max-w-xs md:max-w-sm flex flex-col items-center min-h-screen md:min-h-0 justify-between md:justify-center py-6 md:py-0">
        {/* Logo no topo */}
        <img src="/logo.png" alt="FreteGO" className="w-60 h-20 md:w-52 md:h-52 object-contain mt-4 md:mt-0" />

        {/* Conteudo centralizado */}
        <div className="flex flex-col items-center flex-1 justify-center md:flex-none md:mt-4 -mt-10">
          <h1 className="text-lg md:text-2xl font-bold text-gray-800 mb-4 md:mb-6 text-center">
            Entrar no aplicativo
          </h1>

          <p className="text-sm text-gray-500 mb-4">Deseja entrar como:</p>

          <div className="flex gap-3 md:gap-4">
            <button
              type="button"
              onClick={() => handleProfileSelect('embarcador')}
              className="py-3 px-5 md:py-4 md:px-8 rounded-lg md:rounded-xl border border-gray-200 bg-white text-gray-600 hover:border-green-500 hover:text-green-600 transition-all text-center shadow-sm"
            >
              <span className="text-xl md:text-3xl block mb-1 md:mb-2">👔</span>
              <span className="text-[11px] md:text-sm font-medium">Embarcador</span>
            </button>
            <button
              type="button"
              onClick={() => handleProfileSelect('motorista')}
              className="py-3 px-5 md:py-4 md:px-8 rounded-lg md:rounded-xl border border-gray-200 bg-white text-gray-600 hover:border-green-500 hover:text-green-600 transition-all text-center shadow-sm"
            >
              <span className="text-xl md:text-3xl block mb-1 md:mb-2">🚛</span>
              <span className="text-[11px] md:text-sm font-medium">Caminhoneiro</span>
            </button>
          </div>

          {onRegisterClick && (
            <div className="mt-6 md:mt-8 w-full flex flex-col items-center">
              <div className="border-t border-gray-200 w-48 mb-4 md:mb-5" />
              <button
                type="button"
                onClick={onRegisterClick}
                className="flex items-center justify-center gap-2 text-xs md:text-sm font-semibold text-gray-500 hover:text-green-600 transition-colors"
              >
                <svg className="w-3.5 h-3.5 md:w-4 md:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                Criar uma conta
              </button>
            </div>
          )}
        </div>

        {/* Versao colada no fundo */}
        <span className="text-[10px] text-gray-400 font-mono mt-4 md:mt-6">v.1.0.1</span>
      </div>
    );
  }

  // ==================== TRANSICAO ====================
  if (isTransitioning) {
    return (
      <div className="w-full flex flex-col items-center justify-center animate-fadeIn">
        <div className="w-7 h-7 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  // ==================== FORMULARIO ====================
  return (
    <div className={`w-full md:max-w-4xl md:min-h-[480px] md:rounded-2xl md:overflow-hidden md:shadow-2xl md:border md:border-gray-200 ${showForm ? 'animate-fadeIn' : ''}`}>
      <div className={`w-full flex flex-col md:flex-row ${selectedProfile === 'motorista' ? 'md:flex-row-reverse' : ''}`}>

        {/* Lado do formulario — fundo branco/cinza claro */}
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center px-4 py-6 md:p-10 md:bg-gray-50">
          {/* Logo */}
          <img src="/logo.png" alt="FreteGO" className="w-44 h-14 md:w-36 md:h-36 object-contain mb-3 md:mb-4" />

          <h2 className="text-base md:text-lg font-bold text-gray-800 mb-1 text-center">
            Bem-vindo, {selectedProfile === 'embarcador' ? 'Embarcador' : 'Motorista'}!
          </h2>
          <p className="text-[11px] md:text-xs text-gray-400 mb-4 md:mb-5">Entre com seus dados</p>

          {successMessage && (
            <div className="w-full max-w-xs mb-3 p-2.5 bg-green-100 border border-green-300 rounded-lg md:bg-green-50">
              <p className="text-xs text-green-700">{successMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit(handleFormSubmit)} className="w-full max-w-xs space-y-3" autoComplete="off">
            <input
              ref={honeypotRef}
              type="text"
              name="website_url"
              autoComplete="off"
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: '1px', height: '1px', opacity: 0 }}
            />

            <div>
              <input
                type="tel"
                placeholder="WhatsApp..."
                autoComplete="one-time-code"
                {...register('phone')}
                onChange={(e) => { e.target.value = formatPhone(e.target.value); register('phone').onChange(e); }}
                maxLength={17}
                disabled={isLoading}
                className={`w-full px-3.5 py-3 bg-white border border-gray-200 md:border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:border-transparent focus:outline-none text-sm font-medium shadow-sm ${errors.phone ? 'ring-2 ring-red-400 border-red-300' : ''}`}
              />
              {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone.message}</p>}
            </div>

            <div>
              <PasswordInput
                placeholder="Senha"
                autoComplete="one-time-code"
                {...register('password')}
                disabled={isLoading}
                className={`w-full px-3.5 py-3 bg-white border border-gray-200 md:border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:border-transparent focus:outline-none text-sm font-medium shadow-sm ${errors.password ? 'ring-2 ring-red-400 border-red-300' : ''}`}
              />
              {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white font-bold rounded-lg transition-all disabled:opacity-50 text-sm shadow-lg shadow-green-600/20"
            >
              {isLoading ? 'Entrando...' : 'Entrar'}
            </button>

            <div className="flex items-center justify-between pt-1">
              <button type="button" className="text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors">
                Esqueci minha senha
              </button>
              {onRegisterClick && (
                <button type="button" onClick={onRegisterClick} className="text-xs font-semibold text-green-600 hover:text-green-700 transition-colors">
                  Criar conta
                </button>
              )}
            </div>
          </form>

          <button
            type="button"
            onClick={() => { setSelectedProfile(null); setShowForm(false); }}
            className="mt-4 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            ← Voltar
          </button>
        </div>

        {/* Lado da imagem (so desktop) — imagem limpa, sem blur, sem texto */}
        <div className="hidden md:block w-1/2">
          <img
            src="https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=800&q=80"
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      </div>
    </div>
  );
}
