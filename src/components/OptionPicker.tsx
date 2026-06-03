import { useEffect, useMemo, useRef, useState } from 'react';

export interface OptionPickerItem {
  value: string;
  label: string;
}

interface OptionPickerProps {
  open: boolean;
  onClose: () => void;
  /** Lista canonica completa (ja ordenada como deve aparecer). */
  options: OptionPickerItem[];
  /** Values atualmente selecionados. */
  selected: string[];
  /** Disparado quando a selecao confirmada muda. */
  onChange: (next: string[]) => void;
  /**
   * `single` -> escolhe um e fecha. Usado nos casos onde o usuario tem
   *           um valor unico (motorista: 1 caminhao, 1 carroceria).
   * `multi`  -> permite varios + botao "Confirmar". Usado nos casos de
   *           multi-select (embarcador: aceita varios tipos).
   */
  mode: 'single' | 'multi';
  title: string;
  searchPlaceholder?: string;
}

/**
 * Modal generico de selecao com busca, usado para Tipos de Caminhao,
 * Carrocerias e quaisquer outras listas canonicas longas.
 *
 * - Mobile-first: cobre a tela toda em telas pequenas; vira modal
 *   centralizado em desktop.
 * - Busca live por substring sem case/acento.
 * - Itens com `whitespace-normal` + `leading-tight`, garantindo que
 *   nomes longos quebram linha em vez de truncar.
 * - Trava scroll do body, fecha com Esc, foca a busca ao abrir.
 */
export default function OptionPicker({
  open,
  onClose,
  options,
  selected,
  onChange,
  mode,
  title,
  searchPlaceholder,
}: OptionPickerProps) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>(selected);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(selected);
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = normalize(query.trim());
    return options.filter((o) => normalize(o.label).includes(q));
  }, [query, options]);

  if (!open) return null;

  const toggle = (value: string) => {
    if (mode === 'single') {
      onChange([value]);
      onClose();
      return;
    }
    setDraft((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const clearAll = () => setDraft([]);
  const confirm = () => {
    onChange(draft);
    onClose();
  };

  const activeSelection = mode === 'multi' ? draft : selected;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] sm:max-h-[80vh] flex flex-col shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <h3 className="text-sm sm:text-base font-semibold text-gray-800">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1 -mr-1 text-gray-400 hover:text-gray-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Busca */}
        <div className="px-4 py-2 border-b border-gray-200 shrink-0">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder ?? 'Buscar...'}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
              />
            </svg>
          </div>
          {mode === 'multi' && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-gray-500">
                {draft.length} selecionado{draft.length !== 1 ? 's' : ''}
              </span>
              {draft.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[11px] text-blue-600 hover:underline"
                >
                  Limpar
                </button>
              )}
            </div>
          )}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">Nenhum item encontrado.</div>
          ) : (
            <ul role="listbox" aria-multiselectable={mode === 'multi'}>
              {filtered.map((o) => {
                const isSelected = activeSelection.includes(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => toggle(o.value)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-100 transition-colors ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                          isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="w-3 h-3 text-white"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </span>
                      <span
                        className={`text-sm leading-tight whitespace-normal break-words ${
                          isSelected ? 'text-blue-700 font-medium' : 'text-gray-800'
                        }`}
                      >
                        {o.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {mode === 'multi' && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 shrink-0 bg-white">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirm}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
            >
              Confirmar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
