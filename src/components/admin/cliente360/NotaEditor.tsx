/**
 * NotaEditor — formulario de criar/editar Internal_Note.
 *
 * Validacao frontend espelhando o backend (validateNoteBody): o envio efetivo
 * (onSubmit) e BLOQUEADO enquanto o body for invalido E uma mensagem de erro em
 * pt-BR e exibida (ambos — regra testing-governance). O backend revalida na RPC
 * (defesa em profundidade). Req 14.1, 14.3, 17.1, 17.2.
 */

import { useState } from 'react';
import { validateNoteBody, NOTE_BODY_MAX } from '../../../services/admin/cliente360';

interface Props {
  initialBody?: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}

export default function NotaEditor({
  initialBody = '',
  submitLabel,
  busy = false,
  onSubmit,
  onCancel,
}: Props) {
  const [body, setBody] = useState(initialBody);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateNoteBody(body);
    if (err) {
      setError(err); // bloqueia o envio E exibe a mensagem
      return;
    }
    setError(null);
    onSubmit(body);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          if (error) setError(null);
        }}
        rows={3}
        maxLength={NOTE_BODY_MAX + 100}
        aria-label="Observação interna"
        placeholder="Observação interna (não visível ao cliente)"
        className="w-full rounded-md bg-gray-950 border border-gray-800 px-2.5 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/60"
      />
      {error && (
        <div role="alert" className="text-xs text-red-400">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="text-xs px-2.5 py-1 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          {busy ? 'Salvando...' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
          >
            Cancelar
          </button>
        )}
        <span className="ml-auto text-[10px] text-gray-600">
          {body.trim().length}/{NOTE_BODY_MAX}
        </span>
      </div>
    </form>
  );
}
