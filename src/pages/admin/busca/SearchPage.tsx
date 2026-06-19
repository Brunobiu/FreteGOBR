/**
 * SearchPage — /admin/busca. Lista completa de Search_Result para um ?q=
 * compartilhavel. Gating AdminGuard + USER_VIEW (senao Stealth_404). Sem <h1>
 * grande. Reexecuta a busca no load/reload quando ha ?q= (Req 1.9).
 *
 * Spec: .kiro/specs/admin-cliente-360 (Task 8.2).
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import DashboardBlockError from '../../../components/admin/dashboard/DashboardBlockError';
import SearchResultItem from '../../../components/admin/busca/SearchResultItem';
import { globalSearch, type SearchResult } from '../../../services/admin/cliente360';

const PAGE_LIMIT = 50;

export default function SearchPage() {
  const { allowed: canView } = useAdminPermission('USER_VIEW');
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';

  const [input, setInput] = useState(q);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback((term: string) => {
    const t = term.trim();
    if (t.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    globalSearch(t, { limit: PAGE_LIMIT })
      .then(setResults)
      .catch(() => setError('Não foi possível concluir a busca.'))
      .finally(() => setLoading(false));
  }, []);

  // Reexecuta sempre que ?q= muda (inclui load/reload) — Req 1.9.
  useEffect(() => {
    setInput(q);
    if (canView) runSearch(q);
  }, [q, canView, runSearch]);

  if (!canView) return <Stealth404 />;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams(input.trim() ? { q: input.trim() } : {});
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Buscar cliente por nome, e-mail, telefone, ID ou empresa"
          aria-label="Pesquisa global de clientes"
          className="flex-1 rounded-md bg-gray-900 border border-gray-800 px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/60"
        />
        <button
          type="submit"
          className="text-xs px-2.5 py-1.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25"
        >
          Buscar
        </button>
      </form>

      {error ? (
        <DashboardBlockError message={error} onRetry={() => runSearch(q)} />
      ) : loading ? (
        <div className="text-center text-gray-500 text-sm py-6">Buscando...</div>
      ) : q.trim().length < 2 ? (
        <div className="text-xs text-gray-500">Digite ao menos 2 caracteres para buscar.</div>
      ) : results.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Nenhum cliente encontrado.</div>
      ) : (
        <div className="rounded-md border border-gray-800 bg-gray-950 overflow-hidden">
          <div className="px-3 py-1.5 text-[11px] text-gray-500 border-b border-gray-800">
            {results.length} resultado(s)
          </div>
          {results.map((r) => (
            <SearchResultItem key={r.id} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}
