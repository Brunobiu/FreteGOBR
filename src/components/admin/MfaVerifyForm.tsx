/**
 * MfaVerifyForm - verifica MFA na autenticacao
 *
 * UX: 6 caixas de digito (estilo codigo OTP). NAO ha botao — ao preencher o
 * 6o digito a verificacao dispara automaticamente. Tambem aceita colar um
 * codigo de 6 digitos OU um backup code (com ou sem hifen); ao colar um
 * backup code valido, verifica na hora.
 */

import { useEffect, useRef, useState } from 'react';
import { verifyMfa } from '../../services/admin/mfa';

interface Props {
  userId: string;
  onSuccess: (usedBackupCode: boolean) => void;
}

const CODE_LENGTH = 6;

export default function MfaVerifyForm({ userId, onSuccess }: Props) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  // Evita disparo duplo do auto-submit para o mesmo codigo.
  const submittingRef = useRef(false);

  // Foca o primeiro campo ao montar.
  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  async function runVerify(code: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyMfa({ userId, code });
      if (!result.ok) {
        setError(
          result.reason === 'no_secret'
            ? 'MFA não configurado para este usuário.'
            : 'Código inválido. Tente novamente.'
        );
        // Limpa e volta o foco pro inicio pra nova tentativa.
        setDigits(Array(CODE_LENGTH).fill(''));
        inputsRef.current[0]?.focus();
        return;
      }
      try {
        onSuccess(result.usedBackupCode);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[MfaVerifyForm] onSuccess falhou:', err);
        setError('Código verificado, mas a navegação falhou. Recarregue a página.');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MfaVerifyForm] verifyMfa lancou:', err);
      setError('Falha ao verificar código. Tente novamente.');
      setDigits(Array(CODE_LENGTH).fill(''));
      inputsRef.current[0]?.focus();
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }

  function handleChange(index: number, rawValue: string) {
    const value = rawValue.replace(/\D/g, '');
    if (value === '') {
      // Apagou o campo.
      setDigits((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }

    setDigits((prev) => {
      const next = [...prev];
      // Se digitou/colou multiplos numeros, distribui a partir do campo atual.
      const chars = value.split('');
      let cursor = index;
      for (const ch of chars) {
        if (cursor >= CODE_LENGTH) break;
        next[cursor] = ch;
        cursor++;
      }

      // Move o foco para o proximo campo vazio (ou o ultimo preenchido).
      const nextFocus = Math.min(cursor, CODE_LENGTH - 1);
      inputsRef.current[nextFocus]?.focus();

      // Auto-submit quando os 6 digitos estiverem preenchidos.
      const joined = next.join('');
      if (joined.length === CODE_LENGTH && !next.includes('')) {
        void runVerify(joined);
      }
      return next;
    });
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && digits[index] === '' && index > 0) {
      // Backspace em campo vazio volta pro anterior.
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').trim();
    if (!text) return;

    // Backup code colado (com/sem hifen, 10 chars uteis) -> verifica direto.
    const isBackupShape = /^[A-Z0-9-]{10,14}$/i.test(text) && text.replace(/-/g, '').length === 10;
    if (isBackupShape) {
      e.preventDefault();
      setDigits(Array(CODE_LENGTH).fill(''));
      void runVerify(text);
      return;
    }

    // Codigo TOTP de 6 digitos colado -> preenche as caixas e auto-submete.
    const onlyDigits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (onlyDigits.length > 0) {
      e.preventDefault();
      const next = Array(CODE_LENGTH).fill('');
      for (let i = 0; i < onlyDigits.length; i++) next[i] = onlyDigits[i];
      setDigits(next);
      const lastFilled = Math.min(onlyDigits.length, CODE_LENGTH) - 1;
      inputsRef.current[lastFilled]?.focus();
      if (onlyDigits.length === CODE_LENGTH) {
        void runVerify(onlyDigits);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-2 text-center">
          Digite o código de 6 dígitos
        </label>
        <div className="flex justify-center gap-2" role="group" aria-label="Código de verificação">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputsRef.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={CODE_LENGTH}
              value={digit}
              disabled={busy}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={handlePaste}
              onFocus={(e) => e.target.select()}
              aria-label={`Dígito ${i + 1}`}
              className="w-11 h-14 sm:w-12 sm:h-16 rounded-xl bg-gray-800 border border-gray-700 text-gray-100 text-2xl font-mono text-center focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 transition"
            />
          ))}
        </div>
      </div>

      {busy && <div className="text-center text-xs text-gray-500">Verificando...</div>}
      {error && <div className="text-center text-sm text-red-400">{error}</div>}

      <p className="text-center text-[11px] text-gray-600">
        Você também pode colar um backup code.
      </p>
    </div>
  );
}
