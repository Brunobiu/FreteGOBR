/**
 * TopbarSearch — barra de Pesquisa Global na barra superior do AdminShell.
 *
 * - So renderiza com USER_VIEW (Req 1.1, 1.2).
 * - Debounce 300ms (Req 2.1); dropdown com <= 8 resultados + "Ver todos os
 *   resultados" (Req 5.2); teclado ArrowUp/Down, Enter seleciona, Esc fecha
 *   (Req 5.3); Enter no campo (sem selecao) navega a /admin/busca?q= (Req 1.8).
 *
 * Spec: .kiro/specs/admin-cliente-360 (Task 8.1).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { globalSearch, type SearchResult } from '../../../services/admin/cliente360';
import SearchResultItem from './SearchResultItem';

const DEBOUNCE_MS = 300;
const DROPDOWN_LIMIT = 8;

export default function TopbarSearch() {
  const { allowed } = useAdminPermission('USER_VIEW');
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);

  const latestQuery = useRef('');
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goToSearchPage = useCallback(
    (q: string) => {
      setOpen(false);
      navigate(`/admin/busca?q=${encodeURIComponent(q)}`);
    },
    [navigate]
  );

  useEffect(() => {
    const q = query.trim();
    latestQuery.current = q;
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      globalSearch(q, { limit: DROPDOWN_LIMIT })
        .then((rows) => {
          if (latestQuery.current !== q) return; // descarta resposta obsoleta
          setResults(rows);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => {
          if (latestQuery.current !== q) return;
          setResults([]);
        })
        .finally(() => {
          if (latestQuery.current === q) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

  if (!allowed) return null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && active < results.length) {
        setOpen(false);
        navigate(`/admin/users/${results[active].id}`);
      } else if (query.trim().length > 0) {
        goToSearchPage(query.trim());
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="flex items-center px-4 md:px-6 py-2 border-b border-gray-800/60">
      <div className="relative w-full max-w-md mx-auto">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          placeholder="Buscar cliente por nome, e-mail, telefone, ID ou empresa"
          aria-label="Pesquisa global de clientes"
          className="w-full rounded-md bg-gray-900 border border-gray-800 px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/60"
        />

        {open && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-800 bg-gray-950 shadow-xl overflow-hidden">
            {loading && results.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500">Buscando...</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500">Nenhum cliente encontrado.</div>
            ) : (
              <>
                {results.map((r, i) => (
                  <SearchResultItem
                    key={r.id}
                    result={r}
                    active={i === active}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => goToSearchPage(query.trim())}
                  className="w-full text-left px-3 py-2 text-xs text-cyan-400 hover:bg-gray-800/60 border-t border-gray-800"
                >
                  Ver todos os resultados
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
