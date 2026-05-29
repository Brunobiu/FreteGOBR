/**
 * LocationOverrideModal
 *
 * Modal pra trocar a localizacao manualmente. Usado a partir do
 * dropdown de GPS no AppHeader.
 *
 * Fluxo:
 *   1. Usuario digita cidade ou endereco (ex: "Anapolis, GO")
 *   2. Geocoding via Nominatim retorna ate 5 candidatos
 *   3. Usuario clica em um candidato
 *   4. Salvamos em localStorage via writeLocationOverride
 *   5. Disparamos evento global; AppHeader e HomePage reagem
 *
 * Sem mapa visual nesta versao — entrada por busca textual com
 * lista de resultados. Mapa de selecao fica como melhoria futura.
 */

import { useEffect, useRef, useState } from 'react';
import { geocodeAddress, type GeocodingResult } from '../services/geolocation';
import {
  clearLocationOverride,
  readLocationOverride,
  writeLocationOverride,
  type LocationOverride,
} from '../utils/locationOverride';

interface LocationOverrideModalProps {
  open: boolean;
  onClose: () => void;
  /** Callback opcional executado quando uma localizacao eh selecionada. */
  onSelected?: (override: LocationOverride) => void;
}

export default function LocationOverrideModal({
  open,
  onClose,
  onSelected,
}: LocationOverrideModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<LocationOverride | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Carrega override atual ao abrir
  useEffect(() => {
    if (!open) return;
    setCurrent(readLocationOverride());
    setQuery('');
    setResults([]);
    setError(null);
    // Foca o input apos animacao
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [open]);

  // Fecha com ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 3) {
      setError('Digite ao menos 3 caracteres.');
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const found = await geocodeAddress(q);
      if (found.length === 0) {
        setError('Nenhuma localizacao encontrada. Tente outro termo.');
      } else {
        setResults(found);
      }
    } catch {
      setError('Nao foi possivel buscar agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (r: GeocodingResult) => {
    const override: LocationOverride = {
      point: r.point,
      label: r.displayName,
      setAt: new Date().toISOString(),
    };
    writeLocationOverride(override);
    onSelected?.(override);
    onClose();
  };

  const handleClear = () => {
    clearLocationOverride();
    setCurrent(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Mudar localização</h3>
            <p className="text-xs text-gray-500 mt-0.5">Buscar fretes a partir de outra cidade</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded"
            aria-label="Fechar"
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

        {/* Aviso de override ativo */}
        {current && (
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">
                Localização atual (manual)
              </p>
              <p className="text-sm text-blue-900 truncate">{current.label}</p>
            </div>
            <button
              onClick={handleClear}
              className="text-xs px-3 py-1.5 bg-white border border-blue-200 text-blue-700 rounded hover:bg-blue-100 whitespace-nowrap"
            >
              Voltar ao GPS
            </button>
          </div>
        )}

        {/* Form de busca */}
        <form onSubmit={handleSearch} className="p-5 border-b border-gray-100">
          <label className="block text-sm font-medium text-gray-700 mb-2">Cidade ou endereço</label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ex: Anápolis, GO"
              className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              maxLength={100}
            />
            <button
              type="submit"
              disabled={loading || query.trim().length < 3}
              className="px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {loading ? '...' : 'Buscar'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          <p className="text-[11px] text-gray-500 mt-2">
            Dica: inclua a UF para resultados mais precisos.
          </p>
        </form>

        {/* Resultados */}
        <div className="flex-1 overflow-y-auto">
          {results.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {results.map((r, idx) => (
                <li key={idx}>
                  <button
                    onClick={() => handleSelect(r)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 flex items-start gap-3"
                  >
                    <svg
                      className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0"
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
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{r.displayName}</p>
                      <p className="text-xs text-gray-500 truncate">{r.address}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {results.length === 0 && !loading && !error && !current && (
            <div className="px-5 py-8 text-center text-sm text-gray-500">
              Digite uma cidade acima e toque em Buscar.
            </div>
          )}
        </div>

        {/* Rodape */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Em breve: mapa visual + frete-retorno com origem e destino customizados.
          </p>
        </div>
      </div>
    </div>
  );
}
