import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import type { RegisterData } from '../types';
import HoneypotDetector from '../services/honeypotDetector';
import { capitalizeName } from '../utils/textCase';
import PasswordInput from './PasswordInput';
import OtpInput from './OtpInput';
import { checkBlacklistGate, GENERIC_SIGNUP_MESSAGE } from '../services/admin/blacklist';
import { LEGAL_DOCS, currentLegalVersion } from '../data/legal';
import {
  requestSignupEmailCode,
  confirmSignupEmailCode,
  isIdentifierAvailable,
  isIdentifierBlocked,
  SignupVerificationError,
} from '../services/signupVerification';

/**
 * RegisterForm — cadastro multi-step (3 etapas), igual para motorista e
 * embarcador (muda só o tipo escolhido no início):
 *   1. Dados: nome, telefone, e-mail + confirmação de e-mail → envia código.
 *   2. Código: confirma o código de 6 dígitos enviado ao e-mail.
 *   3. Senha: senha + confirmação + aceite dos Termos → cria a conta.
 *
 * UX:
 *   - Nome capitalizado em tempo real (inicial maiúscula).
 *   - Erros de campo (telefone/e-mail já existe, formato) → borda vermelha +
 *     mensagem curta abaixo do campo.
 *   - Falhas de envio/sistema → toast no canto inferior (não empurra o form).
 *   - Checagem de duplicidade na etapa 1 (antes de enviar o código).
 */

type UserKind = 'embarcador' | 'motorista';
type Step = 'dados' | 'codigo' | 'senha';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface RegisterFormProps {
  onSubmit: (data: RegisterData) => Promise<void>;
  onLoginClick?: () => void;
  /** Avisa quem renderiza o form qual perfil foi escolhido (ex.: troca a
   * imagem ao lado no layout web de 2 colunas). null = ainda na seleção. */
  onUserTypeChange?: (type: UserKind | null) => void;
}

const baseInput =
  'w-full px-3 py-2.5 bg-white border rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm shadow-sm transition-colors';
const okBorder = 'border-gray-300';
const errBorder = 'border-red-400 ring-1 ring-red-300';

export function RegisterForm({ onSubmit, onLoginClick, onUserTypeChange }: RegisterFormProps) {
  const navigate = useNavigate();
  const honeypotRef = useRef<HTMLInputElement>(null);

  const [userType, setUserType] = useState<UserKind | null>(null);
  const [step, setStep] = useState<Step>('dados');
  const [isLoading, setIsLoading] = useState(false);

  // Toast no canto (não empurra o formulário). Some sozinho em ~10s.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 10000);
  };
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  // Dados (step 1)
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');

  // Código (step 2)
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);

  // Senha (step 3)
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showSupport, setShowSupport] = useState(false);

  // Erros por campo (borda vermelha + mensagem abaixo).
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = (field: string) =>
    setFieldErrors((p) => {
      if (!p[field]) return p;
      const next = { ...p };
      delete next[field];
      return next;
    });

  const resetAll = () => {
    setStep('dados');
    setFieldErrors({});
    setToast(null);
    setShowSupport(false);
    setName('');
    setCompanyName('');
    setPhone('');
    setEmail('');
    setConfirmEmail('');
    setCode('');
    setCodeError(null);
    setVerificationToken(null);
    setPassword('');
    setConfirmPassword('');
    setAcceptTerms(false);
  };

  const selectUserType = (type: UserKind) => {
    setUserType(type);
    resetAll();
  };
  // Espelha o perfil escolhido pra quem renderiza o form (troca a imagem ao
  // lado no layout web). Cobre escolha, "voltar" (reset p/ null) etc.
  useEffect(() => {
    onUserTypeChange?.(userType);
  }, [userType, onUserTypeChange]);

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 3) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 7)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3, 7)}-${numbers.slice(7)}`;
  };

  // ───────── Step 1: validar dados + duplicidade → enviar código ─────────
  const handleSubmitDados = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const honeypotValue = honeypotRef.current?.value || '';
    if (honeypotValue) {
      await HoneypotDetector.validateField(
        honeypotValue,
        'fax_number',
        'client-side',
        navigator.userAgent
      );
      return;
    }

    // Validação local (campo a campo).
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Informe seu nome completo';
    if (userType === 'embarcador' && !companyName.trim())
      errs.companyName = 'Informe o nome da empresa';
    const cleanPhone = phone.replace(/\D/g, '');
    if (!/^\d{10,11}$/.test(cleanPhone)) errs.phone = 'Telefone deve ter 10 ou 11 dígitos';
    const normEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normEmail)) errs.email = 'Informe um e-mail válido';
    if (normEmail !== confirmEmail.trim().toLowerCase())
      errs.confirmEmail = 'Os e-mails não coincidem';
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setIsLoading(true);
    try {
      // Blacklist (telefone) — falha silenciosa via toast neutro.
      const { blocked } = await checkBlacklistGate('phone', cleanPhone, 'BLACKLIST_SIGNUP_BLOCKED');
      if (blocked) {
        showToast(GENERIC_SIGNUP_MESSAGE);
        return;
      }

      // Duplicidade / bloqueio anti-reuso → erro no campo certo.
      const [phoneFree, emailFree, phoneBlocked] = await Promise.all([
        isIdentifierAvailable('phone', cleanPhone),
        isIdentifierAvailable('email', normEmail),
        isIdentifierBlocked('phone', cleanPhone),
      ]);
      const dupErrs: Record<string, string> = {};
      if (!phoneFree) dupErrs.phone = 'Este telefone já está cadastrado.';
      if (phoneBlocked) dupErrs.phone = 'Não foi possível usar este telefone. Fale com o suporte.';
      if (!emailFree) dupErrs.email = 'Este e-mail já está cadastrado.';
      if (Object.keys(dupErrs).length > 0) {
        setFieldErrors(dupErrs);
        return;
      }

      await requestSignupEmailCode(normEmail);
      setStep('codigo');
    } catch (err) {
      // Erro de sistema/envio → toast no canto (não no formulário).
      showToast(
        err instanceof SignupVerificationError ? err.message : 'Não foi possível enviar o código.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // ───────── Step 2: confirmar código → senha ─────────
  // Chamado automaticamente quando os 6 dígitos são preenchidos.
  const verifyCode = async (fullCode: string) => {
    const normalized = fullCode.replace(/\D/g, '');
    if (normalized.length !== 6 || isLoading) return;
    setCodeError(null);
    setIsLoading(true);
    try {
      const { status, token } = await confirmSignupEmailCode(email.trim(), normalized);
      if (status === 'OK' && token) {
        setVerificationToken(token);
        setStep('senha');
      } else {
        // Erro: tremida + toast + limpa os campos.
        const msg =
          status === 'EXPIRED'
            ? 'Código expirado. Solicite um novo código.'
            : status === 'BLOCKED'
              ? 'Muitas tentativas. Solicite um novo código.'
              : 'Código incorreto. Tente novamente.';
        setCodeError(msg);
        showToast(msg);
        setShakeKey((k) => k + 1);
        setCode('');
      }
    } catch (err) {
      const msg =
        err instanceof SignupVerificationError ? err.message : 'Não foi possível validar o código.';
      showToast(msg);
      setShakeKey((k) => k + 1);
      setCode('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setCodeError(null);
    setIsLoading(true);
    try {
      await requestSignupEmailCode(email.trim());
      showToast('Enviamos um novo código para o seu e-mail.');
    } catch (err) {
      showToast(
        err instanceof SignupVerificationError ? err.message : 'Não foi possível reenviar o código.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // ───────── Step 3: senha → criar conta ─────────
  const handleSubmitSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowSupport(false);
    setFieldErrors({});

    const parsed = z
      .object({
        password: z.string().min(6),
        confirmPassword: z.string().min(1),
        acceptTerms: z.literal(true),
      })
      .safeParse({ password, confirmPassword, acceptTerms });

    const errs: Record<string, string> = {};
    if (password.length < 6) errs.password = 'Senha deve ter no mínimo 6 caracteres';
    if (password !== confirmPassword) errs.confirmPassword = 'As senhas não coincidem';
    if (!acceptTerms)
      errs.acceptTerms = 'Você precisa aceitar os Termos e a Política de Privacidade.';
    if (!parsed.success || Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    if (!verificationToken || !userType) {
      showToast('Sessão de verificação expirada. Recomece o cadastro.');
      return;
    }

    setIsLoading(true);
    try {
      await onSubmit({
        phone: phone.replace(/\D/g, ''),
        password,
        name: capitalizeName(name),
        userType,
        companyName: companyName ? capitalizeName(companyName) : undefined,
        email: email.trim().toLowerCase(),
        emailVerificationToken: verificationToken,
        acceptedVersion: currentLegalVersion(),
      });
    } catch (err) {
      const errCode = (err as { code?: string } | null)?.code;
      if (errCode === 'ACCOUNT_BLOCKED') {
        setShowSupport(true);
        showToast('Não foi possível criar a conta. Fale com o suporte.');
      } else if (errCode === 'DUPLICATE_IDENTIFIER') {
        // Voltar ao passo 1 destacando o campo provável.
        showToast('Este CPF/telefone/e-mail já está cadastrado.');
      } else {
        showToast(err instanceof Error ? err.message : 'Erro ao criar conta.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ==================== SELEÇÃO DE PERFIL ====================
  if (!userType) {
    return (
      <div className="w-full max-w-sm flex flex-col items-center">
        <img
          src="/logo.png"
          alt="FreteGO"
          className="w-52 h-16 md:w-64 md:h-20 object-contain mb-3"
        />
        <h2 className="text-base md:text-xl font-bold text-gray-800 mb-3 text-center">
          Criar Conta
        </h2>
        <p className="text-xs text-gray-500 mb-2 text-center">Selecione seu perfil</p>
        <div className="flex gap-2 w-full">
          <button
            type="button"
            onClick={() => selectUserType('embarcador')}
            className="flex-1 py-2.5 px-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-green-500 transition-all text-center"
          >
            <span className="text-lg block mb-0.5">{'\u{1F454}'}</span>
            <span className="text-[10px] font-medium">Embarcador</span>
          </button>
          <button
            type="button"
            onClick={() => selectUserType('motorista')}
            className="flex-1 py-2.5 px-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-green-500 transition-all text-center"
          >
            <span className="text-lg block mb-0.5">{'\u{1F69B}'}</span>
            <span className="text-[10px] font-medium">Caminhoneiro</span>
          </button>
        </div>
        {onLoginClick && (
          <div className="pt-4 w-full">
            <div className="border-t border-gray-200 mb-3" />
            <button
              type="button"
              onClick={onLoginClick}
              className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-gray-500 hover:text-green-600 transition-colors"
            >
              Já tem conta? Entrar
            </button>
          </div>
        )}
      </div>
    );
  }

  const stepLabel =
    step === 'dados' ? 'Etapa 1 de 3' : step === 'codigo' ? 'Etapa 2 de 3' : 'Etapa 3 de 3';

  return (
    <>
      <div className="w-full max-w-sm flex flex-col items-center">
        <img
          src="/logo.png"
          alt="FreteGO"
          className="w-52 h-16 md:w-64 md:h-20 object-contain mb-3"
        />
        <h2 className="text-base md:text-xl font-bold text-gray-800 mb-0.5 text-center">
          Criar Conta
        </h2>
        <p className="text-[11px] text-gray-400 mb-3">{stepLabel}</p>

        {/* Honeypot */}
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
          }}
        />

        {/* ===== STEP 1: DADOS ===== */}
        {step === 'dados' && (
          <form
            onSubmit={handleSubmitDados}
            className="w-full space-y-2.5"
            autoComplete="off"
            noValidate
          >
            <div>
              <input
                type="text"
                placeholder="Seu nome completo"
                value={name}
                onChange={(e) => {
                  setName(capitalizeName(e.target.value));
                  clearFieldError('name');
                }}
                disabled={isLoading}
                className={`${baseInput} ${fieldErrors.name ? errBorder : okBorder}`}
              />
              {fieldErrors.name && (
                <p className="mt-0.5 text-[11px] text-red-500">{fieldErrors.name}</p>
              )}
            </div>

            {userType === 'embarcador' && (
              <div>
                <input
                  type="text"
                  placeholder="Nome da empresa"
                  value={companyName}
                  onChange={(e) => {
                    setCompanyName(capitalizeName(e.target.value));
                    clearFieldError('companyName');
                  }}
                  disabled={isLoading}
                  className={`${baseInput} ${fieldErrors.companyName ? errBorder : okBorder}`}
                />
                {fieldErrors.companyName && (
                  <p className="mt-0.5 text-[11px] text-red-500">{fieldErrors.companyName}</p>
                )}
              </div>
            )}

            <div>
              <input
                type="tel"
                placeholder="WhatsApp..."
                value={phone}
                onChange={(e) => {
                  setPhone(formatPhone(e.target.value));
                  clearFieldError('phone');
                }}
                maxLength={17}
                disabled={isLoading}
                className={`${baseInput} ${fieldErrors.phone ? errBorder : okBorder}`}
              />
              {fieldErrors.phone && (
                <p className="mt-0.5 text-[11px] text-red-500">{fieldErrors.phone}</p>
              )}
            </div>

            <div>
              <input
                type="email"
                placeholder="Seu melhor e-mail"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError('email');
                }}
                disabled={isLoading}
                autoComplete="email"
                className={`${baseInput} ${fieldErrors.email ? errBorder : okBorder}`}
              />
              {fieldErrors.email && (
                <p className="mt-0.5 text-[11px] text-red-500">{fieldErrors.email}</p>
              )}
            </div>

            <div>
              <input
                type="email"
                placeholder="Confirme o e-mail"
                value={confirmEmail}
                onChange={(e) => {
                  setConfirmEmail(e.target.value);
                  clearFieldError('confirmEmail');
                }}
                onPaste={(e) => e.preventDefault()}
                disabled={isLoading}
                autoComplete="off"
                className={`${baseInput} ${fieldErrors.confirmEmail ? errBorder : okBorder}`}
              />
              {fieldErrors.confirmEmail && (
                <p className="mt-0.5 text-[11px] text-red-500">{fieldErrors.confirmEmail}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white font-bold rounded-lg transition-all disabled:opacity-50 text-sm shadow-lg shadow-green-600/20"
            >
              {isLoading ? 'Enviando código...' : 'Criar conta'}
            </button>
            <button
              type="button"
              onClick={() => setUserType(null)}
              className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              ← Voltar
            </button>
          </form>
        )}

        {/* ===== STEP 2: CÓDIGO ===== */}
        {step === 'codigo' && (
          <div className="w-full space-y-4">
            <p className="text-xs text-gray-500 text-center">
              Enviamos um código de 6 dígitos para <strong>{email.trim()}</strong>. Digite-o abaixo.
            </p>

            <OtpInput
              value={code}
              onChange={(c) => {
                setCode(c);
                setCodeError(null);
              }}
              onComplete={(c) => void verifyCode(c)}
              disabled={isLoading}
              error={!!codeError}
              shakeKey={shakeKey}
            />

            {isLoading && <p className="text-[11px] text-gray-400 text-center">Confirmando...</p>}
            {codeError && !isLoading && (
              <p className="text-[11px] text-red-500 text-center">{codeError}</p>
            )}

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStep('dados');
                  setCode('');
                  setCodeError(null);
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                ← Corrigir e-mail
              </button>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={isLoading}
                className="text-xs font-semibold text-green-600 hover:text-green-700 disabled:opacity-50"
              >
                Reenviar código
              </button>
            </div>
          </div>
        )}

        {/* ===== STEP 3: SENHA ===== */}
        {step === 'senha' && (
          <form
            onSubmit={handleSubmitSenha}
            className="w-full space-y-2.5"
            autoComplete="off"
            noValidate
          >
            <p className="text-xs text-green-600 text-center font-medium">
              ✓ E-mail verificado. Agora defina sua senha.
            </p>
            <div>
              <PasswordInput
                placeholder="Senha (mín. 6 caracteres)"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearFieldError('password');
                }}
                disabled={isLoading}
                className={`${baseInput} ${fieldErrors.password ? errBorder : okBorder}`}
              />
              {fieldErrors.password && (
                <p className="mt-0.5 text-[11px] text-red-500">{fieldErrors.password}</p>
              )}
            </div>

            <div>
              <PasswordInput
                placeholder="Confirmar senha"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  clearFieldError('confirmPassword');
                }}
                disabled={isLoading}
                className={`${baseInput} ${fieldErrors.confirmPassword ? errBorder : okBorder}`}
              />
              {fieldErrors.confirmPassword && (
                <p className="mt-0.5 text-[11px] text-red-500">{fieldErrors.confirmPassword}</p>
              )}
            </div>

            <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => {
                  setAcceptTerms(e.target.checked);
                  clearFieldError('acceptTerms');
                }}
                disabled={isLoading}
                className="mt-0.5 h-4 w-4 shrink-0 accent-green-600"
              />
              <span className="text-[11px] leading-snug text-gray-600">
                Li e aceito os{' '}
                <a
                  href={LEGAL_DOCS.terms.route}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-green-600 hover:underline"
                >
                  Termos de Uso
                </a>{' '}
                e a{' '}
                <a
                  href={LEGAL_DOCS.privacy.route}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-green-600 hover:underline"
                >
                  Política de Privacidade
                </a>
                .
              </span>
            </label>
            {fieldErrors.acceptTerms && (
              <p className="text-[11px] text-red-500">{fieldErrors.acceptTerms}</p>
            )}

            {showSupport && (
              <button
                type="button"
                onClick={() => navigate('/contato')}
                className="inline-flex items-center justify-center gap-1.5 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Falar com o suporte
              </button>
            )}

            <button
              type="submit"
              disabled={isLoading || !acceptTerms}
              className="w-full py-2.5 bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-lg shadow-green-600/20"
            >
              {isLoading ? 'Criando conta...' : 'Criar conta'}
            </button>
          </form>
        )}
      </div>

      {/* Toast no canto inferior — não empurra o formulário; some em ~10s. */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg bg-gray-900 text-white text-sm px-4 py-3 shadow-lg animate-[fadeIn_0.2s_ease-out]"
        >
          {toast}
        </div>
      )}
    </>
  );
}
