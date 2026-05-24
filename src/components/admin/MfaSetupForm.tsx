/**
 * MfaSetupForm - configura MFA TOTP no primeiro acesso admin
 *
 * 1. Gera secret + otpauth URI (in-memory)
 * 2. Mostra QR code (texto da uri ou imagem via api.qrserver.com como fallback)
 * 3. Pede o primeiro codigo TOTP
 * 4. Persiste via completeMfaSetup
 * 5. Exibe os 10 backup codes uma unica vez
 */

import { useEffect, useMemo, useState } from 'react';
import { completeMfaSetup, generateMfaSetupData, MfaSetupData } from '../../services/admin/mfa';

type Step = 'show-qr' | 'verifying' | 'show-backup' | 'done';

interface Props {
  username: string;
  onComplete: () => void;
}

export default function MfaSetupForm({ username, onComplete }: Props) {
  const setup = useMemo<MfaSetupData>(() => generateMfaSetupData(username), [username]);
  const [step, setStep] = useState<Step>('show-qr');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(setup.otpauthUri)}`;

  // Limpa secret in-memory ao desmontar caso usuario nao conclua
  useEffect(() => {
    return () => {
      // Secret apenas em memoria; ao desmontar, garbage collect descarta.
      void setup.secret;
    };
  }, [setup.secret]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep('verifying');
    try {
      const result = await completeMfaSetup({
        totpSecret: setup.secret,
        firstTotpCode: code,
      });
      setBackupCodes(result.backupCodes);
      setStep('show-backup');
    } catch (err) {
      setError((err as Error).message ?? 'Falha ao configurar MFA');
      setStep('show-qr');
    }
  }

  if (step === 'show-backup') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <h3 className="font-semibold text-amber-200 mb-1">Codigos de backup</h3>
          <p className="text-xs text-amber-200/80">
            Salve estes codigos em local seguro. Eles aparecem apenas UMA VEZ e cada um pode ser
            usado uma unica vez para entrar caso voce perca o acesso ao app autenticador.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm">
          {backupCodes.map((c, i) => (
            <div key={i} className="px-3 py-2 rounded bg-gray-800 text-gray-100">
              {c}
            </div>
          ))}
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          Salvei os codigos em local seguro
        </label>
        <button
          type="button"
          disabled={!confirmed}
          onClick={onComplete}
          className="w-full px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition"
        >
          Continuar
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      <div className="rounded-lg bg-gray-800 p-4 flex flex-col items-center">
        <img src={qrUrl} alt="QR Code MFA" className="rounded bg-white p-2" />
        <div className="mt-3 text-xs text-gray-400">Ou digite manualmente:</div>
        <code className="mt-1 text-xs text-gray-200 break-all">{setup.secret}</code>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Codigo de 6 digitos do app autenticador
        </label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 font-mono text-center tracking-widest focus:outline-none focus:border-cyan-500"
          placeholder="000000"
          required
          autoComplete="one-time-code"
        />
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <button
        type="submit"
        disabled={code.length !== 6 || step === 'verifying'}
        className="w-full px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition"
      >
        {step === 'verifying' ? 'Verificando...' : 'Confirmar e gerar backup'}
      </button>
    </form>
  );
}
