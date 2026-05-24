/**
 * MfaVerifyForm - verifica MFA na autenticacao
 *
 * Aceita TOTP de 6 digitos OU backup code (com ou sem hifen).
 */

import { useState } from 'react';
import { verifyMfa } from '../../services/admin/mfa';

interface Props {
  userId: string;
  onSuccess: (usedBackupCode: boolean) => void;
}

export default function MfaVerifyForm({ userId, onSuccess }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await verifyMfa({ userId, code });
      if (!result.ok) {
        setError(
          result.reason === 'no_secret'
            ? 'MFA nao configurado para este usuario'
            : 'Codigo invalido'
        );
        return;
      }
      onSuccess(result.usedBackupCode);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Codigo do app ou backup code</label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 font-mono text-center focus:outline-none focus:border-cyan-500"
          placeholder="000000 ou XXXX-XXXX-XX"
          required
          autoComplete="one-time-code"
        />
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <button
        type="submit"
        disabled={busy || code.length < 6}
        className="w-full px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition"
      >
        {busy ? 'Verificando...' : 'Verificar'}
      </button>
    </form>
  );
}
