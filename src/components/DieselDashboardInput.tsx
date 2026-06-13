import { useState, useEffect, useRef, useCallback } from 'react';
import { updateDieselPrice } from '../services/motorista';
import { maskDecimal, maskedToNumber, numberToMasked } from '../utils/numberMask';

interface DieselDashboardInputProps {
  userId: string;
  initialValue: number | null;
  onSaved: (newValue: number) => void;
  onError?: (msg: string) => void;
}

/**
 * Input do valor do diesel exibido no header do dashboard do motorista.
 * Persistência manual via botão "OK" ou tecla Enter.
 *
 * Ao montar, exibe um balãozinho de notificação ("Atualize o diesel!")
 * por 5 segundos apontando para o input. Ao interagir, o balão some.
 */
export default function DieselDashboardInput({
  userId,
  initialValue,
  onSaved,
  onError,
}: DieselDashboardInputProps) {
  const [value, setValue] = useState<string>(numberToMasked(initialValue, 2));
  const [isSaving, setIsSaving] = useState(false);

  const lastReqRef = useRef(0);
  const lastSavedRef = useRef<number | null>(initialValue);

  // Sincroniza quando initialValue muda externamente.
  useEffect(() => {
    setValue(numberToMasked(initialValue, 2));
    lastSavedRef.current = initialValue;
  }, [initialValue]);

  const persist = useCallback(async () => {
    if (value.trim() === '') {
      onError?.('Informe o valor do diesel.');
      return;
    }

    const num = maskedToNumber(value, 2);
    if (Number.isNaN(num) || num < 1.0 || num > 20.0) {
      onError?.('Valor do diesel deve estar entre R$ 1,00 e R$ 20,00');
      return;
    }

    if (lastSavedRef.current !== null && Math.abs(num - lastSavedRef.current) < 0.005) {
      return;
    }

    const myReq = ++lastReqRef.current;
    setIsSaving(true);
    try {
      await updateDieselPrice(userId, num);
      if (myReq !== lastReqRef.current) return;
      lastSavedRef.current = num;
      setValue(numberToMasked(num, 2));
      onSaved(num);
    } catch (err) {
      if (myReq !== lastReqRef.current) return;
      setValue(numberToMasked(lastSavedRef.current, 2));
      const msg = err instanceof Error ? err.message : 'Não foi possível salvar o valor do diesel';
      onError?.(msg);
    } finally {
      if (myReq === lastReqRef.current) setIsSaving(false);
    }
  }, [value, userId, onSaved, onError]);

  const handleChange = (raw: string) => {
    setValue(maskDecimal(raw, 2));
    if (showBalloon) setShowBalloon(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      persist();
    }
  };

  const currentNum = maskedToNumber(value, 2);
  const isDirty =
    value.trim() !== '' &&
    !Number.isNaN(currentNum) &&
    (lastSavedRef.current === null || Math.abs(currentNum - lastSavedRef.current) >= 0.005);

  // Balãozinho de notificação — aparece por 5s no mount, some ao interagir.
  const [showBalloon, setShowBalloon] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setShowBalloon(false), 5000);
    return () => window.clearTimeout(t);
  }, []);

  const dismissBalloon = () => setShowBalloon(false);

  return (
    <div className="relative inline-flex items-center gap-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-0.5 shadow-sm">
      {/* Balãozinho de notificação */}
      {showBalloon && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap z-20 animate-[fadeIn_0.3s_ease-out]">
          <div className="bg-blue-600 text-white text-[10px] font-medium px-2.5 py-1 rounded-lg shadow-lg">
            Atualize o diesel!
          </div>
          {/* Setinha apontando para baixo */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-blue-600 rotate-45" />
        </div>
      )}

      <span className="text-[10px] font-medium text-gray-300">Diesel</span>
      <span className="text-[10px] text-gray-400">R$</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={dismissBalloon}
        onKeyDown={handleKeyDown}
        placeholder="0,00"
        aria-label="Valor do diesel por litro na sua região"
        className="w-12 text-xs font-semibold text-white bg-transparent border-0 focus:outline-none focus:ring-0 text-center"
      />
      <span className="text-[10px] text-gray-400">/L</span>
      <button
        type="button"
        onClick={persist}
        disabled={isSaving || !isDirty}
        className="ml-0.5 px-1.5 py-0.5 bg-green-500 text-white text-[10px] font-semibold rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving ? '...' : 'OK'}
      </button>
    </div>
  );
}
