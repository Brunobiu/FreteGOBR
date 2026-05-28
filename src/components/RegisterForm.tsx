import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { RegisterData } from '../types';
import HoneypotDetector from '../services/honeypotDetector';
import { capitalizeName } from '../utils/textCase';
import PasswordInput from './PasswordInput';
import { checkBlacklistGate, GENERIC_SIGNUP_MESSAGE } from '../services/admin/blacklist';

const registerSchema = z
  .object({
    phone: z
      .string()
      .min(1, 'Telefone obrigatorio')
      .refine(
        (val) => /^\d{10,11}$/.test(val.replace(/\D/g, '')),
        'Telefone deve ter 10 ou 11 digitos'
      ),
    password: z.string().min(6, 'Senha deve ter no minimo 6 caracteres'),
    confirmPassword: z.string().min(1, 'Confirme sua senha'),
    name: z.string().min(1, 'Nome obrigatorio'),
    userType: z.enum(['motorista', 'embarcador'], {
      message: 'Selecione o tipo de usuario',
    }),
    companyName: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas nao coincidem',
    path: ['confirmPassword'],
  })
  .refine(
    (data) => {
      if (data.userType === 'embarcador') return !!data.companyName && data.companyName.length > 0;
      return true;
    },
    { message: 'Nome da empresa obrigatorio para embarcadores', path: ['companyName'] }
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

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<RegisterFormData>({
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
    if (numbers.length <= 7)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3)}`;
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
      const cleanPhone = data.phone.replace(/\D/g, '');
      const { blocked } = await checkBlacklistGate('phone', cleanPhone, 'BLACKLIST_SIGNUP_BLOCKED');
      if (blocked) { setError(GENERIC_SIGNUP_MESSAGE); return; }
      await onSubmit({
        phone: cleanPhone,
        password: data.password,
        name: capitalizeName(data.name),
        userType: data.userType,
        companyName: data.companyName ? capitalizeName(data.companyName) : data.companyName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm flex flex-col items-center">
      <img src="/logo.png" alt="FreteGO" className="w-52 h-16 md:w-64 md:h-20 object-contain mb-3" />
      <h2 className="text-base md:text-xl font-bold text-gray-800 mb-3 text-center">Criar Conta</h2>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="w-full space-y-3" autoComplete="off">
        <input ref={honeypotRef} type="text" name="fax_number" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: '1px', height: '1px', opacity: 0 }} />

        <div>
          <p className="text-xs text-gray-500 mb-2 text-center">Selecione seu perfil</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => selectUserType('embarcador')} className={`flex-1 py-2.5 px-2 rounded-lg border transition-all text-center ${userType === 'embarcador' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-green-500'}`}>
              <span className="text-lg block mb-0.5">{'\u{1F454}'}</span>
              <span className="text-[10px] font-medium">Embarcador</span>
            </button>
            <button type="button" onClick={() => selectUserType('motorista')} className={`flex-1 py-2.5 px-2 rounded-lg border transition-all text-center ${userType === 'motorista' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-green-500'}`}>
              <span className="text-lg block mb-0.5">{'\u{1F69B}'}</span>
              <span className="text-[10px] font-medium">Caminhoneiro</span>
            </button>
          </div>
          <input type="hidden" {...register('userType')} />
          {errors.userType && <p className="mt-1 text-[11px] text-red-500 text-center">{errors.userType.message}</p>}
        </div>

        {hasSelectedType && (
          <div className="space-y-2.5 animate-fadeIn">
            <input type="text" placeholder="Seu nome completo" {...register('name')} disabled={isLoading} className={`w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm shadow-sm ${errors.name ? 'ring-2 ring-red-400 border-red-300' : ''}`} />
            {errors.name && <p className="text-[11px] text-red-500">{errors.name.message}</p>}

            {userType === 'embarcador' && (
              <>
                <input type="text" placeholder="Nome da empresa" {...register('companyName')} disabled={isLoading} className={`w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm shadow-sm ${errors.companyName ? 'ring-2 ring-red-400 border-red-300' : ''}`} />
                {errors.companyName && <p className="text-[11px] text-red-500">{errors.companyName.message}</p>}
              </>
            )}

            <input type="tel" placeholder="WhatsApp..." autoComplete="one-time-code" {...register('phone')} onChange={(e) => { e.target.value = formatPhone(e.target.value); register('phone').onChange(e); }} maxLength={17} disabled={isLoading} className={`w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm shadow-sm ${errors.phone ? 'ring-2 ring-red-400 border-red-300' : ''}`} />
            {errors.phone && <p className="text-[11px] text-red-500">{errors.phone.message}</p>}

            <PasswordInput placeholder="Senha (min. 6 caracteres)" autoComplete="one-time-code" {...register('password')} disabled={isLoading} className={`w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm shadow-sm ${errors.password ? 'ring-2 ring-red-400 border-red-300' : ''}`} />
            {errors.password && <p className="text-[11px] text-red-500">{errors.password.message}</p>}

            <PasswordInput placeholder="Confirmar senha" autoComplete="one-time-code" {...register('confirmPassword')} disabled={isLoading} className={`w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm shadow-sm ${errors.confirmPassword ? 'ring-2 ring-red-400 border-red-300' : ''}`} />
            {errors.confirmPassword && <p className="text-[11px] text-red-500">{errors.confirmPassword.message}</p>}

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            <button type="submit" disabled={isLoading} className="w-full py-2.5 bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white font-bold rounded-lg transition-all disabled:opacity-50 text-sm shadow-lg shadow-green-600/20">
              {isLoading ? 'Criando conta...' : 'Criar conta'}
            </button>
          </div>
        )}

        {onLoginClick && (
          <div className="pt-3">
            <div className="border-t border-gray-200 mb-3" />
            <button type="button" onClick={onLoginClick} className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-gray-500 hover:text-green-600 transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
              Ja tem conta? Entrar
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
