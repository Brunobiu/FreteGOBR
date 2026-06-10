/**
 * components/ForgotPasswordModal.tsx
 *
 * Modal de "Esqueci minha senha": pede o e-mail e dispara o reset nativo do
 * Supabase (link por e-mail). Mensagem de sucesso é anti-enumeração — não
 * revela se o e-mail tem conta.
 */

import { useEffect, useRef, useState } from 'react';
import { requestPasswordReset } from '../services/auth';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GENERIC_RESET_MESSAGE =
  'Se houver uma conta com este e-mail, enviaremos um link para redefinir a senha. Verifique sua caixa de entrada e o spam.';

export default function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isLoading) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, isLoading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setError('Informe um e-mail válido.');
      return;
    }
    setIsLoading(true);
    try {
      await requestPasswordReset(trimmed);
      setSent(true);
    } catch {
      // Anti-enumeração: mesmo em erro, mostramos a mensagem genérica de sucesso.
      setSent(true);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
      role="presentation"
      onClick={() => !isLoading && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="forgot-pw-title"
        tabIndex={-1}
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="forgot-pw-title" className="text-base font-semibold text-gray-900">
          Redefinir senha
        </h2>

        {sent ? (
          <>
            <p className="mt-3 text-xs leading-relaxed text-gray-600">{GENERIC_RESET_MESSAGE}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700"
            >
              Entendi
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="mt-1 text-xs text-gray-500">
              Informe o e-mail cadastrado. Enviaremos um link para você criar uma nova senha.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              disabled={isLoading}
              className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="rounded-md px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isLoading ? 'Enviando...' : 'Enviar link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
