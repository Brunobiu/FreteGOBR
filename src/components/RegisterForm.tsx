import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { RegisterData } from '../types';
import HoneypotDetector from '../services/honeypotDetector';

const registerSchema = z
  .object({
    phone: z
      .string()
      .min(1, 'Telefone é obrigatório')
      .refine(
        (val) => /^\d{10,11}$/.test(val.replace(/\D/g, '')),
        'Telefone deve ter 10 ou 11 dígitos'
      ),
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
    confirmPassword: z.string().min(1, 'Confirme sua senha'),
    name: z.string().min(1, 'Nome é obrigatório'),
    userType: z.enum(['motorista', 'embarcador'], {
      message: 'Selecione o tipo de usuário',
    }),
    companyName: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não coincidem',
    path: ['confirmPassword'],
  })
  .refine(
    (data) => {
      if (data.userType === 'embarcador') return !!data.companyName && data.companyName.length > 0;
      return true;
    },
    { message: 'Nome da empresa é obrigatório para embarcadores', path: ['companyName'] }
  );

type RegisterFormData = z.infer<typeof registerSchema>;

interface RegisterFormProps {
  onSubmit: (data: RegisterData) => Promise<void>;
  onLoginClick?: () => void;
}

export function RegisterForm({ onSubmit, onLoginClick }: RegisterFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const userType = watch('userType');
  const hasSelectedType = userType === 'motorista' || userType === 'embarcador';

  const selectUserType = (type: 'embarcador' | 'motorista') => {
    reset({ userType: type, name: '', phone: '', password: '', confirmPassword: '', companyName: '' });
  };

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 3) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3, 7)}-${numbers.slice(7)}`;
  };

  const handleFormSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setError(null);
    const honeypotValue = honeypotRef.current?.value || '';
    if (honeypotValue) {
      await HoneypotDetector.validateField(honeypotValue, 'fax_number', 'client-side', navigator.userAgent);
      setIsLoading(false);
      return;
    }
    try {
      await onSubmit({
        phone: data.phone.replace(/\D/g, ''),
        password: data.password,
        name: data.name,
        userType: data.userType,
        companyName: data.companyName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white/95 md:bg-white rounded-2xl shadow-2xl p-8 max-h-[90vh] overflow-y-auto">
      <div className="text-center mb-2">
        <span className="text-3xl font-bold text-blue-500">FreteGO</span>
      </div>
      <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">Criar Conta</h2>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        {/* Honeypot */}
        <input
          ref={honeypotRef}
          type="text"
          name="fax_number"
          autoComplete="off"
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: '1px', height: '1px', opacity: 0 }}
        />

        {/* Seleção de perfil */}
        <div>
          <p className="text-sm text-gray-500 mb-3 text-center">Selecione seu perfil</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => selectUserType('embarcador')}
              className={`flex-1 py-3 px-3 rounded-xl border-2 transition-all text-center ${
                userType === 'embarcador'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
              }`}
            >
              <span className="text-2xl block mb-1">👔</span>
              <span className="text-xs font-medium">Sou Embarcador</span>
            </button>
            <button
              type="button"
              onClick={() => selectUserType('motorista')}
              className={`flex-1 py-3 px-3 rounded-xl border-2 transition-all text-center ${
                userType === 'motorista'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
              }`}
            >
              <span className="text-2xl block mb-1">🚛</span>
              <span className="text-xs font-medium">Sou Caminhoneiro</span>
            </button>
          </div>
          <input type="hidden" {...register('userType')} />
          {errors.userType && <p className="mt-2 text-sm text-red-500 text-center">{errors.userType.message}</p>}
        </div>

        {/* Campos só aparecem após selecionar tipo */}
        {hasSelectedType && (
          <>
            <div>
              <label className="block text-sm text-gray-700 mb-1">Nome</label>
              <input
                type="text"
                placeholder="Ex: Carlos Almeida"
                {...register('name')}
                disabled={isLoading}
                className={`w-full px-4 py-3 bg-white border rounded-xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${errors.name ? 'border-red-400' : 'border-gray-300'}`}
              />
              {errors.name && <p className="mt-1 text-sm text-red-500">{errors.name.message}</p>}
            </div>

            {userType === 'embarcador' && (
              <div>
                <label className="block text-sm text-gray-700 mb-1">Nome da Empresa</label>
                <input
                  type="text"
                  placeholder="Transportes ABC"
                  {...register('companyName')}
                  disabled={isLoading}
                  className={`w-full px-4 py-3 bg-white border rounded-xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${errors.companyName ? 'border-red-400' : 'border-gray-300'}`}
                />
                {errors.companyName && <p className="mt-1 text-sm text-red-500">{errors.companyName.message}</p>}
              </div>
            )}

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

            <div>
              <label className="block text-sm text-gray-700 mb-1">Senha</label>
              <input
                type="password"
                placeholder="Mínimo 8 caracteres"
                {...register('password')}
                disabled={isLoading}
                className={`w-full px-4 py-3 bg-white border rounded-xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${errors.password ? 'border-red-400' : 'border-gray-300'}`}
              />
              {errors.password && <p className="mt-1 text-sm text-red-500">{errors.password.message}</p>}
            </div>

            <div>
              <label className="block text-sm text-gray-700 mb-1">Confirmar Senha</label>
              <input
                type="password"
                placeholder="Repita a senha"
                {...register('confirmPassword')}
                disabled={isLoading}
                className={`w-full px-4 py-3 bg-white border rounded-xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${errors.confirmPassword ? 'border-red-400' : 'border-gray-300'}`}
              />
              {errors.confirmPassword && <p className="mt-1 text-sm text-red-500">{errors.confirmPassword.message}</p>}
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
              {isLoading ? 'Criando conta...' : 'Transporte conosco'}
            </button>
          </>
        )}

        {onLoginClick && (
          <div className="text-center">
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
