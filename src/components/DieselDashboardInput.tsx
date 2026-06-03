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
 * Input do valor do diesel exibido em destaque no centro do header
 * do dashboard do motorista. Persistência manual via botão "OK"
 * ou tecla Enter — sem auto-save por debounce.
 *
 * Em caso de erro de rede, reverte para o último valor confirmado
 * e dispara `onError` para a UI mostrar um toast.
 */
export default function DieselDashboardInput({
  userId,
  initialValue,
  onSaved,
  onError,
}: DieselDashboardInputProps) {
  const [value, setValue] = useState<string>(numberToMasked(initialValue, 2));
  const [isSaving, setIsSaving] = useState(false);

  // Token monotônico para descartar respostas de requests antigos
  // que retornaram depois de um request mais recente (anti-race).
  const lastReqRef = useRef(0);

  // Último valor confirmado pelo servidor — usado para reverter o
  // input em caso de erro.
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

    // Já está no valor salvo? Não dispara request.
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
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      persist();
    }
  };

  // Indica se há mudança não-salva
  const currentNum = maskedToNumber(value, 2);
  const isDirty =
    value.trim() !== '' &&
    !Number.isNaN(currentNum) &&
    (lastSavedRef.current === null || Math.abs(currentNum - lastSavedRef.current) >= 0.005);

  // Chamariz visual: a cada montagem do componente, se o motorista
  // ainda nao tem valor de diesel salvo, expande o label de "Diesel"
  // para "Adicione o valor do diesel" por 4 segundos. Depois retrai
  // suavemente. Se ele clicar/digitar antes, retrai imediatamente —
  // ele ja viu a mensagem.
  const [hintExpanded, setHintExpanded] = useState<boolean>(() => initialValue === null);
  const hintDismissedRef = useRef(false);

  useEffect(() => {
    if (initialValue !== null) {
      // Ja tem valor salvo, nao precisa do chamariz.
      setHintExpanded(false);
      return;
    }
    if (hintDismissedRef.current) return;
    setHintExpanded(true);
    const t = window.setTimeout(() => setHintExpanded(false), 4000);
    return () => window.clearTimeout(t);
  }, [initialValue]);

  const dismissHint = () => {
    hintDismissedRef.current = true;
    setHintExpanded(false);
  };

  return (
    <div className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded px-2 py-0.5 shadow-sm">
      <span
        className={`text-[10px] text-gray-500 font-medium overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-500 ease-in-out ${
          hintExpanded ? 'max-w-[180px] opacity-100 text-blue-600' : 'max-w-[44px] opacity-100'
        }`}
        aria-live="polite"
      >
        {hintExpanded ? 'Adicione o valor do diesel' : 'Diesel'}
      </span>
      <span className="text-[10px] text-gray-400">R$</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          handleChange(e.target.value);
          if (hintExpanded) dismissHint();
        }}
        onFocus={() => {
          if (hintExpanded) dismissHint();
        }}
        onKeyDown={handleKeyDown}
        placeholder="0,00"
        aria-label="Valor do diesel por litro na sua região"
        className="w-12 text-xs font-semibold text-gray-800 bg-transparent border-0 focus:outline-none focus:ring-0 text-center"
      />
      <span className="text-[10px] text-gray-400">/L</span>
      <button
        type="button"
        onClick={persist}
        disabled={isSaving || !isDirty}
        className="ml-0.5 px-1.5 py-0.5 bg-blue-600 text-white text-[10px] font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving ? '...' : 'OK'}
      </button>
    </div>
  );
}
