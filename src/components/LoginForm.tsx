import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { LoginCredentials } from '../types';

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
}

export function LoginForm({ onSubmit, onRegisterClick }: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginCredentials>({
    resolver: zodResolver(loginSchema),
  });

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 3) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 7)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3, 7)}-${numbers.slice(7)}`;
  };

  const handleFormSubmit = async (data: LoginCredentials) => {
    setIsLoading(true);
    setError(null);
    try {
      const cleanPhone = data.phone.replace(/\D/g, '');
      await onSubmit({ ...data, phone: cleanPhone });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex">
      {/* Lado esquerdo - Marketing */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16">
        <h1 className="text-4xl font-bold text-white leading-tight mb-6">
          Encontre o motorista certo
          <br />
          para sua carga em todo Brasil
        </h1>
        <p className="text-lg text-gray-400 leading-relaxed">
          Conectamos embarcadores e caminhoneiros de forma rápida e segura. Acesse sua conta e
          comece a transportar.
        </p>
      </div>

      {/* Lado direito - Formulário */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md bg-gray-900 rounded-xl p-8 border border-gray-800">
          <h2 className="text-2xl font-bold text-white mb-6">Entrar</h2>

          <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
            {/* Telefone */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Telefone</label>
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
                className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.phone ? 'border-red-500' : 'border-gray-700'}`}
              />
              {errors.phone && <p className="mt-1 text-sm text-red-400">{errors.phone.message}</p>}
            </div>

            {/* Senha */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Senha</label>
              <input
                type="password"
                placeholder="••••••"
                {...register('password')}
                disabled={isLoading}
                className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.password ? 'border-red-500' : 'border-gray-700'}`}
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-400">{errors.password.message}</p>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:bg-gray-700 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Entrando...' : 'Entrar'}
            </button>

            {onRegisterClick && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={onRegisterClick}
                  className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
                >
                  Não tem conta? Cadastre-se
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
