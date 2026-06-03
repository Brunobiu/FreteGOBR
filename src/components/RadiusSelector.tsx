/**
 * RadiusSelector — dropdown de seleção de raio compartilhado.
 *
 * Extraído da `MapaToolbar` para ser reutilizado na linha de cabeçalho
 * "Fretes Disponíveis" da `HomePage`. Visual compacto para encaixar
 * ao lado do botão de filtro.
 *
 * Persistência fica a cargo do caller — o componente recebe `radiusKm`
 * controlado e dispara `onRadiusChange`. Quem grava em
 * `localStorage[RADIUS_STORAGE_KEY]` é o consumidor.
 */

import { useEffect, useRef, useState } from 'react';
import { RADIUS_OPTIONS_KM, type RadiusOption } from '../utils/geoDistance';

interface RadiusSelectorProps {
  radiusKm: RadiusOption;
  onRadiusChange: (next: RadiusOption) => void;
  /** Visual compacto no estilo da linha de filtros. */
  compact?: boolean;
}

export default function RadiusSelector({
  radiusKm,
  onRadiusChange,
  compact = false,
}: RadiusSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const node = containerRef.current;
      if (node && !node.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 ${
          compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
        } bg-white border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 shadow-sm whitespace-nowrap`}
        aria-label="Selecionar raio de busca"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <svg
          className="w-3.5 h-3.5 text-green-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <span>{radiusKm} km</span>
        <span className="text-gray-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute top-full mt-1 right-0 z-30 flex flex-col bg-white border border-gray-300 rounded-lg shadow-md overflow-hidden min-w-[88px]"
        >
          {RADIUS_OPTIONS_KM.map((r) => (
            <button
              key={r}
              type="button"
              role="option"
              aria-selected={r === radiusKm}
              onClick={() => {
                onRadiusChange(r);
                setOpen(false);
              }}
              className={`px-3 py-1.5 text-xs text-left whitespace-nowrap ${
                r === radiusKm ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {r} km
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
