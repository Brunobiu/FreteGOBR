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

      // Pre-check blacklist (timing-parity + 3s timeout fail-open)
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

  return (
    <div className="w-full max-w-md bg-white/95 md:bg-white rounded-2xl shadow-2xl p-8">
      {/* Logo */}
      <div className="text-center mb-2">
        <span className="text-3xl font-bold text-blue-500">FreteGO</span>
      </div>

      <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">Entrar na sua conta</h2>

      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl">
          <p className="text-sm text-green-700">{successMessage}</p>
        </div>
      )}

      {/* Seleção de perfil */}
      <div className="mb-6">
        <p className="text-sm text-gray-500 mb-3 text-center">Como deseja entrar?</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setSelectedProfile('embarcador')}
            className={`flex-1 py-3 px-3 rounded-xl border-2 transition-all text-center ${
              selectedProfile === 'embarcador'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
            }`}
          >
            <span className="text-2xl block mb-1">👔</span>
            <span className="text-xs font-medium">Embarcador</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedProfile('motorista')}
            className={`flex-1 py-3 px-3 rounded-xl border-2 transition-all text-center ${
              selectedProfile === 'motorista'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
            }`}
          >
            <span className="text-2xl block mb-1">🚛</span>
            <span className="text-xs font-medium">Caminhoneiro</span>
          </button>
        </div>
      </div>

      {/* Formulário só aparece após selecionar perfil */}
      {selectedProfile && (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          {/* Honeypot */}
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

          {/* Telefone */}
          <div>
            <label className="block text-sm text-gray-700 mb-1">Telefone</label>
            <input
              type="tel"
              placeholder="(00) 0 0000-0000"
              {...register('phone')}
              onChange={(e) => {
                e.target.value = formatPhone(e.target.value);
                register('phone').onChange(e);
              }}
              maxLength={17}
              disabled={isLoading}
              className={`w-full px-4 py-3 bg-white border rounded-xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${errors.phone ? 'border-red-400' : 'border-gray-300'}`}
            />
            {errors.phone && <p className="mt-1 text-sm text-red-500">{errors.phone.message}</p>}
          </div>

          {/* Senha */}
          <div>
            <label className="block text-sm text-gray-700 mb-1">Senha</label>
            <PasswordInput
              placeholder="••••••••"
              {...register('password')}
              disabled={isLoading}
              className={`w-full px-4 py-3 bg-white border rounded-xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${errors.password ? 'border-red-400' : 'border-gray-300'}`}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-500">{errors.password.message}</p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Entrando...' : 'Entrar'}
          </button>

          {onRegisterClick && (
            <div className="text-center">
              <button
                type="button"
                onClick={onRegisterClick}
                className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
              >
                Não tem conta? Cadastre-se
              </button>
            </div>
          )}
        </form>
      )}

      {/* Link cadastro quando perfil não selecionado */}
      {onRegisterClick && !selectedProfile && (
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={onRegisterClick}
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            Não tem conta? Cadastre-se
          </button>
        </div>
      )}
    </div>
  );
}
