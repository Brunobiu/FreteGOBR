/**
 * SettingField — campo de edição de uma configuração não-secreta.
 *
 * Renderiza por value_type (string/integer/money/boolean/enum). money é
 * exibido/editado em reais (2 casas) convertendo de/para centavos.
 * enum e is_readonly ficam desabilitados. Validação inline desabilita o
 * botão Salvar enquanto o valor for inválido. Captura o updated_at vigente
 * e o reenvia no salvamento (versionamento otimista).
 *
 * Spec finalizacao-lancamento.
 */

import { useState } from 'react';
import {
  centsToReais,
  reaisToCents,
  validateSettingValue,
  validateEvolutionBaseUrl,
  validateEmail,
  type SettingRecord,
  type SettingValue,
} from '../../../services/admin/settings';

interface SettingFieldProps {
  record: SettingRecord;
  canEdit: boolean;
  onSave: (value: Exclude<SettingValue, null>, expectedUpdatedAt: string) => Promise<void>;
}

export default function SettingField({ record, canEdit, onSave }: SettingFieldProps) {
  // Estado local do input (string para text/number; boolean para toggle).
  const initial = (): string => {
    if (record.value === null || record.value === undefined) return '';
    if (record.valueType === 'money' && typeof record.value === 'number') {
      return centsToReais(record.value);
    }
    return String(record.value);
  };

  const [text, setText] = useState<string>(initial);
  const [bool, setBool] = useState<boolean>(record.value === true);
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const disabled = !canEdit || record.isReadonly;
  const fieldId = `setting-${record.key}`;

  // Valida o valor atual do input; retorna o valor tipado pronto p/ enviar.
  function buildValue():
    | { ok: true; value: Exclude<SettingValue, null> }
    | { ok: false; msg: string } {
    switch (record.valueType) {
      case 'boolean':
        return { ok: true, value: bool };
      case 'integer': {
        const n = Number(text);
        if (!Number.isInteger(n)) return { ok: false, msg: 'Informe um número inteiro.' };
        const r = validateSettingValue('integer', n, { key: record.key });
        if (!r.ok) return { ok: false, msg: 'Valor fora do intervalo permitido.' };
        return { ok: true, value: n };
      }
      case 'money': {
        let cents: number;
        try {
          cents = reaisToCents(text);
        } catch {
          return { ok: false, msg: 'Informe um valor monetário válido.' };
        }
        const r = validateSettingValue('money', cents, { key: record.key });
        if (!r.ok) return { ok: false, msg: 'Valor fora do intervalo (R$ 0 a R$ 1.000.000).' };
        return { ok: true, value: cents };
      }
      case 'string': {
        // Validações específicas por key.
        if (
          record.key === 'evolution_api_base_url' &&
          !validateEvolutionBaseUrl(text) &&
          text.trim() !== ''
        ) {
          return { ok: false, msg: 'Informe uma URL https válida.' };
        }
        if (record.key === 'support_contact_email' && !validateEmail(text)) {
          return { ok: false, msg: 'Informe um e-mail válido ou deixe em branco.' };
        }
        return { ok: true, value: text };
      }
      default:
        return { ok: false, msg: 'Tipo não editável.' };
    }
  }

  const handleSave = async () => {
    const built = buildValue();
    if (!built.ok) {
      setInlineError(built.msg);
      return;
    }
    setInlineError(null);
    setSaving(true);
    try {
      await onSave(built.value, record.updatedAt);
    } finally {
      setSaving(false);
    }
  };

  // enum readonly: exibe valor atual desabilitado.
  if (record.valueType === 'enum') {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-xs font-medium text-gray-600">
          {record.label}
        </label>
        <select
          id={fieldId}
          value={String(record.value ?? '')}
          disabled
          aria-label={record.label}
          className="text-sm border border-gray-300 rounded px-2 py-1 bg-gray-50 text-gray-500 max-w-xs"
        >
          {(record.enumOptions ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (record.valueType === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={fieldId} className="text-xs font-medium text-gray-600">
          {record.label}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={fieldId}
            type="checkbox"
            checked={bool}
            disabled={disabled}
            aria-label={record.label}
            onChange={(e) => setBool(e.target.checked)}
            className="h-4 w-4"
          />
          {canEdit && !record.isReadonly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="text-xs px-2.5 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              Salvar
            </button>
          )}
        </div>
      </div>
    );
  }

  // string / integer / money
  const prefix = record.valueType === 'money' ? 'R$ ' : '';
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium text-gray-600">
        {record.label}
        {record.isReadonly && (
          <span className="ml-1 text-[10px] text-gray-400">(somente leitura)</span>
        )}
      </label>
      <div className="flex items-center gap-2">
        {prefix && <span className="text-sm text-gray-500">{prefix.trim()}</span>}
        <input
          id={fieldId}
          type={record.valueType === 'money' || record.valueType === 'integer' ? 'text' : 'text'}
          inputMode={
            record.valueType === 'money' || record.valueType === 'integer' ? 'decimal' : 'text'
          }
          value={text}
          disabled={disabled}
          aria-label={record.label}
          onChange={(e) => {
            setText(e.target.value);
            setInlineError(null);
          }}
          className="text-sm border border-gray-300 rounded px-2 py-1 flex-1 max-w-md disabled:bg-gray-50 disabled:text-gray-500"
        />
        {canEdit && !record.isReadonly && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || inlineError !== null}
            className="text-xs px-2.5 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 shrink-0"
          >
            Salvar
          </button>
        )}
      </div>
      {inlineError && <span className="text-[11px] text-red-600">{inlineError}</span>}
    </div>
  );
}
