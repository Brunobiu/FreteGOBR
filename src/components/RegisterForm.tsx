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
      .refine(
        (val) => /^\d{10,11}$/.test(val.replace(/\D/g, '')),
        'Telefone deve ter 10 ou 11 dígitos'
      ),
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
      // Remove formatação do telefone antes de enviar
      const cleanPhone = data.phone.replace(/\D/g, '');
      await onSubmit({ ...data, phone: cleanPhone });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-8 bg-gray-900 rounded-xl shadow-2xl border border-gray-700">
      <h2 className="text-3xl font-bold text-white mb-8 text-center">Criar Conta no FreteGO</h2>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
        {/* User Type Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">Tipo de Usuário</label>
          <div className="flex gap-4">
            <label className="flex items-center cursor-pointer px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
              <input
                type="radio"
                value="motorista"
                {...register('userType')}
                className="mr-2 accent-blue-500"
                disabled={isLoading}
              />
              <span className="text-sm text-gray-200">Motorista</span>
            </label>
            <label className="flex items-center cursor-pointer px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
              <input
                type="radio"
                value="embarcador"
                {...register('userType')}
                className="mr-2 accent-blue-500"
                disabled={isLoading}
              />
              <span className="text-sm text-gray-200">Embarcador</span>
            </label>
          </div>
          {errors.userType && (
            <p className="mt-1 text-sm text-red-400">{errors.userType.message}</p>
          )}
        </div>

        {/* Name Input */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
            Nome Completo
          </label>
          <input
            id="name"
            type="text"
            placeholder="João Silva"
            {...register('name')}
            className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
              errors.name ? 'border-red-500' : 'border-gray-700'
            }`}
            disabled={isLoading}
          />
          {errors.name && <p className="mt-1 text-sm text-red-400">{errors.name.message}</p>}
        </div>

        {/* Company Name (only for embarcador) */}
        {userType === 'embarcador' && (
          <div>
            <label htmlFor="companyName" className="block text-sm font-medium text-gray-300 mb-2">
              Nome da Empresa
            </label>
            <input
              id="companyName"
              type="text"
              placeholder="Transportes ABC"
              {...register('companyName')}
              className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                errors.companyName ? 'border-red-500' : 'border-gray-700'
              }`}
              disabled={isLoading}
            />
            {errors.companyName && (
              <p className="mt-1 text-sm text-red-400">{errors.companyName.message}</p>
            )}
          </div>
        )}

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

          {/* Password Strength Indicator */}
          {passwordStrength && password && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-3">
                <div
                  className={`h-1.5 flex-1 rounded-full transition-all ${
                    passwordStrength.hasMinLength ? 'bg-green-500' : 'bg-gray-700'
                  }`}
                />
                <span className="text-xs text-gray-400 w-24">6+ caracteres</span>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className={`h-1.5 flex-1 rounded-full transition-all ${
                    passwordStrength.hasLetter ? 'bg-green-500' : 'bg-gray-700'
                  }`}
                />
                <span className="text-xs text-gray-400 w-24">1+ letra</span>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className={`h-1.5 flex-1 rounded-full transition-all ${
                    passwordStrength.hasNumber ? 'bg-green-500' : 'bg-gray-700'
                  }`}
                />
                <span className="text-xs text-gray-400 w-24">1+ número</span>
              </div>
            </div>
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
          {isLoading ? 'Criando conta...' : 'Criar Conta'}
        </button>

        {/* Login Link */}
        {onLoginClick && (
          <div className="text-center mt-6">
            <button
              type="button"
              onClick={onLoginClick}
              className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
            >
              Já tem conta? Faça login
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
