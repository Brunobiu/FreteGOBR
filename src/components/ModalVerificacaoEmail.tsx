import { useState, useRef, useEffect } from 'react';
import {
  sendEmailVerificationCode,
  confirmEmailVerificationCode,
  VerificationError,
} from '../services/verification';

interface ModalVerificacaoEmailProps {
  email: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (verifiedEmail: string) => void;
}

const RESEND_COOLDOWN_SECONDS = 60;
const CODE_LENGTH = 6;

/**
 * Modal de verificação de e-mail por código de 6 dígitos.
 * Acessibilidade: foco no primeiro input ao abrir, ESC fecha,
 * devolução de foco ao elemento que abriu o modal.
 */
export function ModalVerificacaoEmail({
  email,
  isOpen,
  onClose,
  onSuccess,
}: ModalVerificacaoEmailProps) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);

  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Salva foco anterior, foca no primeiro input ao abrir
  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setTimeout(() => inputsRef.current[0]?.focus(), 0);
    setDigits(Array(CODE_LENGTH).fill(''));
    setError(null);
    setResendTimer(RESEND_COOLDOWN_SECONDS);
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  // Timer de cooldown do reenvio
  useEffect(() => {
    if (!isOpen || resendTimer <= 0) return;
    const id = window.setTimeout(() => setResendTimer((t) => t - 1), 1000);
    return () => window.clearTimeout(id);
  }, [isOpen, resendTimer]);

  // Tecla ESC fecha
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleDigitChange = (index: number, value: string) => {
    const v = value.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = v;
      return next;
    });
    if (v && index < CODE_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    const next = Array(CODE_LENGTH).fill('');
    pasted.split('').forEach((c, i) => {
      next[i] = c;
    });
    setDigits(next);
    const nextFocus = Math.min(pasted.length, CODE_LENGTH - 1);
    inputsRef.current[nextFocus]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join('');
    if (code.length !== CODE_LENGTH) {
      setError('Digite os 6 dígitos do código.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await confirmEmailVerificationCode(code);
      onSuccess(email);
    } catch (err) {
      if (err instanceof VerificationError) {
        setError(err.message);
        if (err.code === 'BLOCKED' || err.code === 'EXPIRED') {
          // Limpa para forçar reenvio
          setDigits(Array(CODE_LENGTH).fill(''));
        }
      } else {
        setError('Erro ao validar o código. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      await sendEmailVerificationCode(email);
      setResendTimer(RESEND_COOLDOWN_SECONDS);
      setDigits(Array(CODE_LENGTH).fill(''));
      inputsRef.current[0]?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao reenviar código');
    } finally {
      setResending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verif-email-title"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 id="verif-email-title" className="text-lg font-semibold text-gray-800">
              Verificar e-mail
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Enviamos um código de 6 dígitos para <strong>{email}</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex justify-center gap-2 my-6">
            {digits.map((digit, index) => (
              <input
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                key={index}
                ref={(el) => (inputsRef.current[index] = el)}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={index === 0 ? handlePaste : undefined}
                disabled={submitting}
                className="w-11 h-12 text-center text-lg font-semibold border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label={`Dígito ${index + 1} do código`}
              />
            ))}
          </div>

          {error && (
            <p className="text-sm text-red-600 text-center mb-3" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || digits.join('').length !== CODE_LENGTH}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Confirmando...' : 'Confirmar'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendTimer > 0 || resending}
            className="text-sm text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
          >
            {resending
              ? 'Reenviando...'
              : resendTimer > 0
                ? `Reenviar código em ${resendTimer}s`
                : 'Reenviar código'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalVerificacaoEmail;
