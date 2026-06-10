/**
 * components/OtpInput.tsx
 *
 * Campo de código de verificação em N quadradinhos (default 6). Recursos:
 *   - Auto-avança para o próximo quadradinho ao digitar.
 *   - Backspace volta ao anterior quando vazio.
 *   - Colar (paste) distribui os dígitos.
 *   - Quando todos os dígitos são preenchidos, chama `onComplete(code)`.
 *   - `errorShake` dispara a animação de tremida e limpa os campos.
 */

import { useEffect, useRef } from 'react';

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (code: string) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  error?: boolean;
  /** Incrementa este número para disparar a tremida (ex: a cada erro). */
  shakeKey?: number;
}

export default function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  error = false,
  shakeKey = 0,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const digits = value.split('').slice(0, length);
  while (digits.length < length) digits.push('');

  // Foco inicial no primeiro quadradinho.
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  // Dispara a tremida e reposiciona o foco quando shakeKey muda.
  useEffect(() => {
    if (shakeKey > 0 && containerRef.current) {
      const el = containerRef.current;
      el.classList.remove('animate-otp-shake');
      // Reflow para reiniciar a animação.
      void el.offsetWidth;
      el.classList.add('animate-otp-shake');
      refs.current[0]?.focus();
    }
  }, [shakeKey]);

  const setDigit = (index: number, digit: string) => {
    const arr = value.split('').slice(0, length);
    while (arr.length < length) arr.push('');
    arr[index] = digit;
    const next = arr.join('').replace(/\D/g, '');
    onChange(next);
    return next;
  };

  const handleChange = (index: number, raw: string) => {
    const d = raw.replace(/\D/g, '');
    if (!d) {
      setDigit(index, '');
      return;
    }
    // Se colou vários dígitos, distribui a partir do índice atual.
    if (d.length > 1) {
      const arr = value.split('').slice(0, length);
      while (arr.length < length) arr.push('');
      let i = index;
      for (const ch of d.split('')) {
        if (i >= length) break;
        arr[i] = ch;
        i++;
      }
      const next = arr.join('').slice(0, length).replace(/\D/g, '');
      onChange(next);
      const focusIdx = Math.min(i, length - 1);
      refs.current[focusIdx]?.focus();
      if (next.length === length) onComplete(next);
      return;
    }
    const next = setDigit(index, d.charAt(0));
    if (index < length - 1) {
      refs.current[index + 1]?.focus();
    }
    if (next.length === length) {
      onComplete(next);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        setDigit(index, '');
      } else if (index > 0) {
        refs.current[index - 1]?.focus();
        setDigit(index - 1, '');
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  return (
    <div ref={containerRef} className="flex justify-center gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={d}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          aria-label={`Dígito ${i + 1}`}
          className={`h-12 w-10 sm:w-11 rounded-lg border bg-white text-center text-lg font-bold text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 ${
            error ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-300'
          }`}
        />
      ))}
    </div>
  );
}
