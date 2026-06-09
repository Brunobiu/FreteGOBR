/**
 * CommunityCityAutocomplete — resolve uma cidade (texto livre, possivelmente
 * abreviado) em coordenadas, reusando IBGE (estados/cidades) + geocoding
 * (Nominatim), igual ao fluxo do FreteForm do embarcador.
 *
 * spec frete-comunidade (Fase 5, task 17 / Req 15.4/15.5). Quando o admin
 * seleciona uma sugestão, dispara `onResolved` com o nome canônico + coords.
 */

import { useEffect, useRef, useState } from 'react';
import { geocodeAddress, type GeocodingResult } from '../../../services/geolocation';

interface Props {
  value: string;
  resolved: boolean;
  onChange: (text: string) => void;
  onResolved: (canonical: string, lat: number, lng: number) => void;
  placeholder?: string;
}

export default function CommunityCityAutocomplete({
  value,
  resolved,
  onChange,
  onResolved,
  placeholder,
}: Props) {
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleInput = (text: string) => {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      void geocodeAddress(text)
        .then((results) => {
          setSuggestions(results);
          setOpen(results.length > 0);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 450);
  };

  const handlePick = (s: GeocodingResult) => {
    onResolved(s.displayName, s.point.latitude, s.point.longitude);
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => handleInput(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded border px-2 py-1 text-xs ${
          resolved ? 'border-green-400 bg-green-50' : 'border-amber-400 bg-amber-50'
        }`}
      />
      {!resolved && (
        <span className="absolute right-1 top-1 text-[10px] text-amber-600">pendente</span>
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-0.5 max-h-44 w-full overflow-auto rounded border border-gray-200 bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => handlePick(s)}
                className="block w-full px-2 py-1 text-left text-xs hover:bg-gray-100"
              >
                {s.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {loading && <span className="absolute right-1 top-1 text-[10px] text-gray-400">...</span>}
    </div>
  );
}
