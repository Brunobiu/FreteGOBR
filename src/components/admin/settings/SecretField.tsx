/**
 * SecretField — campo de gerenciamento de um Secret_Setting.
 *
 *  - is_set=false  ⇒ campo vazio com rótulo "Não configurado".
 *  - is_set=true   ⇒ exibe o masked_value + controles Substituir / Remover.
 *  - salvar com o campo em branco (sem remoção) preserva o valor existente.
 *
 * O valor bruto NUNCA é exibido (só o masked_value vindo do servidor).
 * Spec finalizacao-lancamento.
 */

import { useState } from 'react';
import type { SettingRecord } from '../../../services/admin/settings';

interface SecretFieldProps {
  record: SettingRecord;
  canEdit: boolean;
  onSetSecret: (secret: string, expectedUpdatedAt: string) => Promise<void>;
  onClearSecret: (expectedUpdatedAt: string) => Promise<void>;
}

export default function SecretField({
  record,
  canEdit,
  onSetSecret,
  onClearSecret,
}: SecretFieldProps) {
  const [editing, setEditing] = useState(false);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldId = `secret-${record.key}`;

  const handleSave = async () => {
    if (secret.trim() === '') {
      // Em branco sem remoção: preserva. Apenas fecha o modo de edição.
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSetSecret(secret, record.updatedAt);
      setSecret('');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      await onClearSecret(record.updatedAt);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium text-gray-600">
        {record.label}
      </label>

      {!editing ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700 font-mono">
            {record.secretIsSet ? (record.maskedValue ?? '••••••••') : 'Não configurado'}
          </span>
          {canEdit && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {record.secretIsSet ? 'Substituir' : 'Definir'}
              </button>
              {record.secretIsSet && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={busy}
                  aria-label={`Remover ${record.label}`}
                  className="text-xs px-2.5 py-1 bg-white border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                >
                  Remover
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            id={fieldId}
            type="password"
            value={secret}
            autoComplete="new-password"
            aria-label={`Novo valor de ${record.label}`}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Cole o novo segredo"
            className="text-sm border border-gray-300 rounded px-2 py-1 flex-1 max-w-md"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="text-xs px-2.5 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 shrink-0"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={() => {
              setSecret('');
              setEditing(false);
            }}
            className="text-xs px-2.5 py-1 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 shrink-0"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
