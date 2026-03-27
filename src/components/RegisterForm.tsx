import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { RegisterData } from '../types';

const registerSchema = z
  .object({
    phone: z
      .string()
      .min(1, 'Telefone é obrigatório')
      .regex(/^\d{10,11}$/, 'Telefone deve ter 10 ou 11 dígitos'),
    password: z
      .string()
      .min(6, 'Senha deve ter no mínimo 6 caracteres')
      .regex(/[a-zA-Z]/, 'Senha deve conter pelo menos 1 letra')
      .regex(/\d/, 'Senha deve conter pelo menos 1 número'),
    name: z.string().min(1, 'Nome é obrigatório'),
    userType: z.enum(['motorista', 'embarcador'], {
      errorMap: () => ({ message: 'Selecione o tipo de usuário' }),
    }),
    companyName: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.userType === 'embarcador') {
        return !!data.companyName && data.companyName.length > 0;
      }
      return true;
    },
    {
      message: 'Nome da empresa é obrigatório para embarcadores',
      path: ['companyName'],
    }
  );

interface RegisterFormProps {
  onSubmit: (data: RegisterData) => Promise<void>;
  onLoginClick?: () => void;
}

export function RegisterForm({ onSubmit, onLoginClick }: RegisterFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      userType: 'motorista',
    },
  });

  const userType = watch('userType');
  const password = watch('password');

  const getPasswordStrength = () => {
    if (!password) return null;

    const hasMinLength = password.length >= 6;
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /\d/.test(password);

    return { hasMinLength, hasLetter, hasNumber };
  };

  const passwordStrength = getPasswordStrength();

  const handleFormSubmit = async (data: RegisterData) => {
    setIsLoading(true);
    setError(null);

    try {
      await onSubmit(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Criar Conta no FreteGO</h2>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        {/* User Type Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Usuário</label>
          <div className="flex gap-4">
            <label className="flex items-center cursor-pointer">
              <input
                type="radio"
                value="motorista"
                {...register('userType')}
                className="mr-2"
                disabled={isLoading}
              />
              <span className="text-sm">Motorista</span>
            </label>
            <label className="flex items-center cursor-pointer">
              <input
                type="radio"
                value="embarcador"
                {...register('userType')}
                className="mr-2"
                disabled={isLoading}
              />
              <span className="text-sm">Embarcador</span>
            </label>
          </div>
          {errors.userType && (
            <p className="mt-1 text-sm text-red-600">{errors.userType.message}</p>
          )}
        </div>

        {/* Name Input */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Nome Completo
          </label>
          <input
            id="name"
            type="text"
            placeholder="João Silva"
            {...register('name')}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.name ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={isLoading}
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
        </div>

        {/* Company Name (only for embarcador) */}
        {userType === 'embarcador' && (
          <div>
            <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-1">
              Nome da Empresa
            </label>
            <input
              id="companyName"
              type="text"
              placeholder="Transportes ABC"
              {...register('companyName')}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                errors.companyName ? 'border-red-500' : 'border-gray-300'
              }`}
              disabled={isLoading}
            />
            {errors.companyName && (
              <p className="mt-1 text-sm text-red-600">{errors.companyName.message}</p>
            )}
          </div>
        )}

        {/* Phone Input */}
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Telefone
          </label>
          <input
            id="phone"
            type="tel"
            placeholder="11999999999"
            {...register('phone')}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.phone ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={isLoading}
          />
          {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>}
        </div>

        {/* Password Input */}
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Senha
          </label>
          <input
            id="password"
            type="password"
            placeholder="••••••"
            {...register('password')}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.password ? 'border-red-500' : 'border-gray-300'
            }`}
            disabled={isLoading}
          />
          {errors.password && (
            <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
          )}

          {/* Password Strength Indicator */}
          {passwordStrength && password && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <div
                  className={`h-1 w-full rounded ${
                    passwordStrength.hasMinLength ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
                <span className="text-xs text-gray-600">6+ caracteres</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className={`h-1 w-full rounded ${
                    passwordStrength.hasLetter ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
                <span className="text-xs text-gray-600">1+ letra</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className={`h-1 w-full rounded ${
                    passwordStrength.hasNumber ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
                <span className="text-xs text-gray-600">1+ número</span>
              </div>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Criando conta...' : 'Criar Conta'}
        </button>

        {/* Login Link */}
        {onLoginClick && (
          <div className="text-center mt-4">
            <button
              type="button"
              onClick={onLoginClick}
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
            >
              Já tem conta? Faça login
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
