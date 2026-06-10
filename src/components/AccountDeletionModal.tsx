/**
 * components/AccountDeletionModal.tsx
 *
 * Modal de confirmação destrutiva da exclusão IMEDIATA da conta (Feature 4 —
 * legal-exclusao-dados). Explica o escopo e a irreversibilidade, exige
 * confirmação explícita (digitar EXCLUIR) e chama `deleteMyAccount()`.
 *
 * Decisões oficiais refletidas na UI:
 *   - Exclusão imediata e irreversível (sem janela de cancelamento).
 *   - Após excluir, o usuário não consegue recriar conta com o mesmo
 *     CPF/telefone (anti-reuso) — informado no texto.
 */

import { useEffect, useRef, useState } from 'react';
import { deleteMyAccount, DataDeletionError } from '../services/dataDeletion';

const CONFIRM_WORD = 'EXCLUIR';

interface AccountDeletionModalProps {
  onClose: () => void;
  /** Chamado após exclusão concluída com sucesso (a sessão já foi encerrada). */
  onDeleted: () => void;
}

export default function AccountDeletionModal({ onClose, onDeleted }: AccountDeletionModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isDeleting) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, isDeleting]);

  const canConfirm = confirmText.trim().toUpperCase() === CONFIRM_WORD && !isDeleting;

  async function handleDelete() {
    if (!canConfirm) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteMyAccount();
      onDeleted();
    } catch (err) {
      const msg =
        err instanceof DataDeletionError
          ? err.message
          : 'Não foi possível excluir a conta. Tente novamente.';
      setError(msg);
      setIsDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
      role="presentation"
      onClick={() => !isDeleting && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-deletion-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="account-deletion-title" className="text-base font-semibold text-red-700">
          Excluir minha conta e meus dados
        </h2>

        <div className="mt-3 space-y-2 text-xs leading-relaxed text-gray-600">
          <p>
            Esta ação é <strong>imediata e irreversível</strong>. Serão removidos seus dados
            pessoais, documentos enviados, fretes, mensagens e demais informações associadas à sua
            conta.
          </p>
          <p>
            Por segurança, após a exclusão{' '}
            <strong>não será possível criar uma nova conta com o mesmo CPF ou telefone</strong>. Se
            precisar voltar, fale com o suporte.
          </p>
          <p className="text-gray-500">
            Para confirmar, digite <strong>{CONFIRM_WORD}</strong> no campo abaixo.
          </p>
        </div>

        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          disabled={isDeleting}
          placeholder={CONFIRM_WORD}
          aria-label={`Digite ${CONFIRM_WORD} para confirmar`}
          className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
        />

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? 'Excluindo...' : 'Excluir definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}
