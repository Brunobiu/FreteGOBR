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

  // Função para formatar telefone: (62) 9 9475-7240
  const formatPhone = (value: string) => {
    // Remove tudo que não é número
    const numbers = value.replace(/\D/g, '');

    // Limita a 11 dígitos
    const limited = numbers.slice(0, 11);

    // Aplica a máscara
    if (limited.length <= 2) {
      return limited;
    } else if (limited.length <= 3) {
      return `(${limited.slice(0, 2)}) ${limited.slice(2)}`;
    } else if (limited.length <= 7) {
      return `(${limited.slice(0, 2)}) ${limited.slice(2, 3)} ${limited.slice(3)}`;
    } else {
      return `(${limited.slice(0, 2)}) ${limited.slice(2, 3)} ${limited.slice(3, 7)}-${limited.slice(7)}`;
    }
  };

  // Handler para o input de telefone
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    e.target.value = formatted;
  };

  const handleFormSubmit = async (data: LoginCredentials) => {
    setIsLoading(true);
    setError(null);

    try {
      // Remove formatação do telefone antes de enviar
      const cleanPhone = data.phone.replace(/\D/g, '');
      await onSubmit({ ...data, phone: cleanPhone });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-8 bg-gray-900 rounded-xl shadow-2xl border border-gray-700">
      <h2 className="text-3xl font-bold text-white mb-8 text-center">Entrar no FreteGO</h2>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
        {/* Phone Input */}
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-300 mb-2">
            Telefone
          </label>
          <input
            id="phone"
            type="tel"
            placeholder="(00) 0 0000-0000"
            {...register('phone')}
            onChange={(e) => {
              handlePhoneChange(e);
              register('phone').onChange(e);
            }}
            maxLength={17}
            className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
              errors.phone ? 'border-red-500' : 'border-gray-700'
            }`}
            disabled={isLoading}
          />
          {errors.phone && <p className="mt-1 text-sm text-red-400">{errors.phone.message}</p>}
        </div>

        {/* Password Input */}
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
            Senha
          </label>
          <input
            id="password"
            type="password"
            placeholder="••••••"
            {...register('password')}
            className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
              errors.password ? 'border-red-500' : 'border-gray-700'
            }`}
            disabled={isLoading}
          />
          {errors.password && (
            <p className="mt-1 text-sm text-red-400">{errors.password.message}</p>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
        >
          {isLoading ? 'Entrando...' : 'Entrar'}
        </button>

        {/* Register Link */}
        {onRegisterClick && (
          <div className="text-center mt-6">
            <button
              type="button"
              onClick={onRegisterClick}
              className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
            >
              Não tem conta? Cadastre-se
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
