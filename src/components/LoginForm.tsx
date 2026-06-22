import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { LoginCredentials } from '../types';
import HoneypotDetector from '../services/honeypotDetector';
import PasswordInput from './PasswordInput';
import ForgotPasswordModal from './ForgotPasswordModal';
import { checkBlacklistGate, GENERIC_LOGIN_MESSAGE } from '../services/admin/blacklist';

const loginSchema = z.object({
  phone: z
    .string()
    .min(1, 'Informe seu e-mail ou telefone')
    .refine((val) => {
      const v = val.trim();
      if (v.includes('@')) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
      return /^\d{10,11}$/.test(v.replace(/\D/g, ''));
    }, 'Informe um e-mail ou telefone válido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

interface LoginFormProps {
  onSubmit: (credentials: LoginCredentials) => Promise<void>;
  onRegisterClick?: () => void;
  successMessage?: string;
  initialPhone?: string;
  /** Avisa quem renderiza o form qual perfil foi escolhido na seleção
   * "Deseja entrar como" (ex.: troca a foto ao lado no layout web de 2
   * colunas). null = ainda na seleção. */
  onProfileChange?: (profile: 'embarcador' | 'motorista' | null) => void;
  /** Voltar a partir da tela de seleção (ex.: para a landing). */
  onBack?: () => void;
}

export function LoginForm({
  onSubmit,
  onRegisterClick,
  successMessage,
  initialPhone,
  onProfileChange,
  onBack,
}: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<'embarcador' | 'motorista' | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

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

  // Espelha o perfil escolhido pra quem renderiza o form (troca a foto ao lado
  // no layout web). Cobre seleção e eventual reset pra null.
  useEffect(() => {
    onProfileChange?.(selectedProfile);
  }, [selectedProfile, onProfileChange]);

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
      const raw = data.phone.trim();
      const isEmail = raw.includes('@');
      // Só aplica o gate de blacklist por telefone quando o identificador é
      // telefone. Para e-mail, o gate por e-mail acontece no servidor.
      if (!isEmail) {
        const cleanPhone = raw.replace(/\D/g, '');
        const { blocked } = await checkBlacklistGate(
          'phone',
          cleanPhone,
          'BLACKLIST_LOGIN_BLOCKED'
        );
        if (blocked) {
          setError(GENERIC_LOGIN_MESSAGE);
          return;
        }
        await onSubmit({ ...data, phone: cleanPhone });
      } else {
        await onSubmit({ ...data, phone: raw.toLowerCase() });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setIsLoading(false);
    }
  };

  // ==================== SELECAO DE PERFIL ====================
  if (!selectedProfile && !isTransitioning) {
    return (
      <div className="relative flex h-full min-h-screen w-full max-w-sm flex-col items-center py-6 md:min-h-full md:py-8">
        {/* Voltar para o início (tela anterior) */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="absolute left-0 top-2 inline-flex items-center gap-1 text-xs font-medium text-gray-400 transition-colors hover:text-gray-600"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
            Voltar
          </button>
        )}
        {/* Logo (topo) */}
        <img src="/logo.png" alt="FreteGO" className="h-20 w-auto object-contain md:h-24" />

        {/* Conteúdo centralizado (do título até "Criar uma conta") */}
        <div className="flex flex-1 flex-col items-center justify-center">
          <h1 className="mb-4 text-center text-xl font-bold text-gray-800 md:mb-6 md:text-2xl">
            Entrar
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
                <svg
                  className="w-3.5 h-3.5 md:w-4 md:h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                Criar uma conta
              </button>
            </div>
          )}
        </div>

        {/* Rodapé fixo embaixo: Fale conosco + versão */}
        <div className="flex flex-col items-center gap-1 pt-4">
          <Link
            to="/contato"
            className="text-[11px] md:text-xs text-gray-400 hover:text-green-600 transition-colors"
          >
            Fale conosco
          </Link>
          <span className="text-[10px] text-gray-400 font-mono">v.1.0.1</span>
        </div>
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
    <>
      <div
        className={`flex h-full min-h-screen w-full max-w-sm flex-col items-center py-6 md:min-h-full md:py-8 ${showForm ? 'animate-fadeIn' : ''}`}
      >
        {/* Logo (topo) */}
        <img src="/logo.png" alt="FreteGO" className="h-16 w-auto object-contain md:h-24" />

        {/* Conteúdo centralizado */}
        <div className="flex w-full flex-1 flex-col items-center justify-center">
          <h2 className="text-base md:text-xl font-bold text-gray-800 mb-0.5 text-center">
            Bem-vindo, {selectedProfile === 'embarcador' ? 'Embarcador' : 'Motorista'}!
          </h2>
        <p className="text-[11px] text-gray-400 mb-4">Entre com seus dados</p>

        {successMessage && (
          <div className="w-full mb-3 p-2.5 bg-green-50 border border-green-300 rounded-lg">
            <p className="text-xs text-green-700">{successMessage}</p>
          </div>
        )}

        <form
          onSubmit={handleSubmit(handleFormSubmit)}
          className="w-full space-y-2.5"
          autoComplete="off"
        >
          <input
            ref={honeypotRef}
            type="text"
            name="website_url"
            autoComplete="off"
            tabIndex={-1}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '-9999px',
              top: '-9999px',
              width: '1px',
              height: '1px',
              opacity: 0,
            }}
          />

          <div>
            <input
              type="text"
              placeholder="E-mail ou WhatsApp"
              autoComplete="username"
              {...register('phone')}
              onChange={(e) => {
                // Só aplica máscara de telefone quando NÃO há letras (parece
                // telefone). Se tiver qualquer letra, é e-mail: não formata.
                if (!/[a-zA-Z@]/.test(e.target.value)) {
                  e.target.value = formatPhone(e.target.value);
                }
                register('phone').onChange(e);
              }}
              maxLength={60}
              disabled={isLoading}
              className={`w-full px-3 py-2.5 bg-white border rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm shadow-sm ${errors.phone ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-300'}`}
            />
            {errors.phone && (
              <p className="mt-0.5 text-[11px] text-red-500">{errors.phone.message}</p>
            )}
          </div>

          <div>
            <PasswordInput
              placeholder="Senha"
              autoComplete="one-time-code"
              {...register('password')}
              disabled={isLoading}
              className={`w-full px-3 py-2.5 bg-white border rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm shadow-sm ${errors.password ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-300'}`}
            />
            {errors.password && (
              <p className="mt-0.5 text-[11px] text-red-500">{errors.password.message}</p>
            )}
          </div>

          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white font-bold rounded-lg transition-all disabled:opacity-50 text-sm shadow-lg shadow-green-600/20"
          >
            {isLoading ? 'Entrando...' : 'Entrar'}
          </button>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors"
            >
              Esqueci minha senha
            </button>
            {onRegisterClick && (
              <button
                type="button"
                onClick={onRegisterClick}
                className="text-xs font-semibold text-green-600 hover:text-green-700 transition-colors"
              >
                Criar conta
              </button>
            )}
          </div>
        </form>

        <button
          type="button"
          onClick={() => {
            setSelectedProfile(null);
            setShowForm(false);
          }}
          className="mt-4 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          ← Voltar
        </button>
        </div>

        {/* Rodapé fixo embaixo */}
        <Link
          to="/contato"
          className="pt-4 text-[11px] md:text-xs text-gray-400 hover:text-green-600 transition-colors"
        >
          Fale conosco
        </Link>
      </div>
      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
    </>
  );
}
