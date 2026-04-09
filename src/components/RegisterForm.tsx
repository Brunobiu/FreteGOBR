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
  
  // Honeypot field ref - campo invisível para detectar bots
  const honeypotRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { userType: 'motorista' },
  });

  const userType = watch('userType');

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 3) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 7)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3, 7)}-${numbers.slice(7)}`;
  };

  const handleFormSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setError(null);
    
    // Verificar honeypot - se preenchido, é um bot
    const honeypotValue = honeypotRef.current?.value || '';
    if (honeypotValue) {
      // Registrar tentativa de bot silenciosamente
      await HoneypotDetector.validateField(
        honeypotValue,
        'fax_number',
        'client-side',
        navigator.userAgent
      );
      // Simular sucesso para não alertar o bot
      setIsLoading(false);
      return;
    }
    
    try {
      const cleanPhone = data.phone.replace(/\D/g, '');
      await onSubmit({
        phone: cleanPhone,
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
    <div className="min-h-screen bg-gray-950 flex">
      {/* Lado esquerdo - Marketing */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16">
        <h1 className="text-4xl font-bold text-white leading-tight mb-6">
          FreteGO e sua transportadora,
          <br />
          juntos em todas as etapas do frete
        </h1>
        <p className="text-lg text-gray-400 leading-relaxed">
          Sua operação logística completa está aqui: desde a busca pelo caminhoneiro autônomo até o
          fechamento seguro da carga.
        </p>
      </div>

      {/* Lado direito - Formulário */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md bg-gray-900 rounded-xl p-8 border border-gray-800">
          <h2 className="text-2xl font-bold text-white mb-6">Criar Conta</h2>

          <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
            {/* Honeypot field - invisível para usuários, visível para bots */}
            <input
              ref={honeypotRef}
              type="text"
              name="fax_number"
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
                overflow: 'hidden',
              }}
            />
            
            {/* Tipo de usuário */}
            <div className="flex gap-4">
              <label className="flex items-center cursor-pointer px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors flex-1 justify-center">
                <input
                  type="radio"
                  value="embarcador"
                  {...register('userType')}
                  className="mr-2 accent-blue-500"
                  disabled={isLoading}
                />
                <span className="text-sm text-gray-200">Sou Empresa</span>
              </label>
              <label className="flex items-center cursor-pointer px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors flex-1 justify-center">
                <input
                  type="radio"
                  value="motorista"
                  {...register('userType')}
                  className="mr-2 accent-blue-500"
                  disabled={isLoading}
                />
                <span className="text-sm text-gray-200">Sou Caminhoneiro</span>
              </label>
            </div>
            {errors.userType && <p className="text-sm text-red-400">{errors.userType.message}</p>}

            {/* Nome */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Nome</label>
              <input
                type="text"
                placeholder="Ex: Carlos Almeida"
                {...register('name')}
                disabled={isLoading}
                className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.name ? 'border-red-500' : 'border-gray-700'}`}
              />
              {errors.name && <p className="mt-1 text-sm text-red-400">{errors.name.message}</p>}
            </div>

            {/* Empresa (só embarcador) */}
            {userType === 'embarcador' && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Nome da Empresa</label>
                <input
                  type="text"
                  placeholder="Transportes ABC"
                  {...register('companyName')}
                  disabled={isLoading}
                  className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.companyName ? 'border-red-500' : 'border-gray-700'}`}
                />
                {errors.companyName && (
                  <p className="mt-1 text-sm text-red-400">{errors.companyName.message}</p>
                )}
              </div>
            )}

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
                placeholder="Mínimo 6 caracteres"
                {...register('password')}
                disabled={isLoading}
                className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.password ? 'border-red-500' : 'border-gray-700'}`}
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-400">{errors.password.message}</p>
              )}
            </div>

            {/* Confirmar senha */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Confirmar Senha</label>
              <input
                type="password"
                placeholder="Repita a senha"
                {...register('confirmPassword')}
                disabled={isLoading}
                className={`w-full px-4 py-3 bg-gray-800 border rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.confirmPassword ? 'border-red-500' : 'border-gray-700'}`}
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-400">{errors.confirmPassword.message}</p>
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
              {isLoading ? 'Criando conta...' : 'Transporte conosco'}
            </button>

            {onLoginClick && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={onLoginClick}
                  className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
                >
                  Já tem conta? Faça login
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
