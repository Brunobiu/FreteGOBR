import { useState, useEffect, useRef, useCallback } from 'react';
import { updateDieselPrice } from '../services/motorista';

interface DieselDashboardInputProps {
  userId: string;
  initialValue: number | null;
  onSaved: (newValue: number) => void;
  onError?: (msg: string) => void;
}

const DEBOUNCE_MS = 600;

/**
 * Hook utilitário interno: chama `fn` apenas após `delay` ms de
 * inatividade. Cancela a chamada anterior se uma nova for agendada.
 * Limpa o timer no unmount para não disparar request órfão.
 */
function useDebouncedCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay: number
) {
  const timer = useRef<number | null>(null);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  return useCallback(
    (...args: TArgs) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        fnRef.current(...args);
      }, delay);
    },
    [delay]
  );
}

/**
 * Input do valor do diesel exibido em destaque no centro do header
 * do dashboard do motorista. Persistência é debounced em 600 ms.
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
  const [value, setValue] = useState<string>(initialValue !== null ? initialValue.toFixed(2) : '');

  // Token monotônico para descartar respostas de requests antigos
  // que retornaram depois de um request mais recente (anti-race).
  const lastReqRef = useRef(0);

  // Último valor confirmado pelo servidor — usado para reverter o
  // input em caso de erro.
  const lastSavedRef = useRef<number | null>(initialValue);

  // Sincroniza quando initialValue muda externamente (ex: outra
  // página atualizou o diesel e o pai propaga o novo valor).
  useEffect(() => {
    setValue(initialValue !== null ? initialValue.toFixed(2) : '');
    lastSavedRef.current = initialValue;
  }, [initialValue]);

  const persist = useCallback(
    async (priceStr: string) => {
      const num = parseFloat(priceStr);
      if (Number.isNaN(num) || num < 1.0 || num > 20.0) {
        // Range inválido: reverte e avisa.
        if (lastSavedRef.current !== null) {
          setValue(lastSavedRef.current.toFixed(2));
        } else {
          setValue('');
        }
        onError?.('Valor do diesel deve estar entre R$ 1,00 e R$ 20,00');
        return;
      }

      const myReq = ++lastReqRef.current;
      try {
        await updateDieselPrice(userId, num);
        // Descarta resposta velha sobreposta por uma mais recente.
        if (myReq !== lastReqRef.current) return;
        lastSavedRef.current = num;
        onSaved(num);
      } catch (err) {
        if (myReq !== lastReqRef.current) return;
        // Reverte o display para o último valor válido.
        if (lastSavedRef.current !== null) {
          setValue(lastSavedRef.current.toFixed(2));
        } else {
          setValue('');
        }
        const msg =
          err instanceof Error ? err.message : 'Não foi possível salvar o valor do diesel';
        onError?.(msg);
      }
    },
    [userId, onSaved, onError]
  );

  const debouncedPersist = useDebouncedCallback(persist, DEBOUNCE_MS);

  const handleChange = (raw: string) => {
    // Aceita apenas dígitos e ponto (separador decimal de input HTML).
    // Vírgula é permitida e convertida para ponto (UX brasileira).
    const cleaned = raw.replace(/[^0-9.,]/g, '').replace(',', '.');
    setValue(cleaned);
    debouncedPersist(cleaned);
  };

  return (
    <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
      <span className="text-xs text-gray-500 font-medium">Diesel hoje</span>
      <span className="text-xs text-gray-400">R$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="0,00"
        aria-label="Valor do diesel por litro na sua região"
        className="w-16 text-sm font-semibold text-gray-800 bg-transparent border-0 focus:outline-none focus:ring-0 text-center"
      />
      <span className="text-xs text-gray-400">/L</span>
    </div>
  );
}
