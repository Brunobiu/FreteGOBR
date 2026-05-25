/**
 * BlacklistFilters - filtros compactos em popover.
 *
 * Padrão herdado de UsersFilters/FretesFilters pós-cleanup:
 *   - busca livre inline (debounce 300ms)
 *   - botão de ícone abre popover ao lado direito
 *   - popover contém Tipo / Status / Criado por (searchable)
 *     / período (from/to) / ordenar
 *   - validação de from > to inline; não dispara busca
 *   - sempre reseta page=1 ao mudar qualquer filtro
 */

import { useEffect, useRef, useState } from 'react';
import { type BlacklistFilters as BlacklistFiltersType } from '../../../services/admin/blacklist';
import { supabase } from '../../../services/supabase';

interface Props {
  filters: BlacklistFiltersType;
  onChange: (next: BlacklistFiltersType) => void;
  totalFiltered: number;
}

interface AdminOption {
  id: string;
  name: string;
  admin_username: string | null;
}

/**
 * Pequeno dropdown searchable de admins (users WHERE is_superuser=true).
 * Carrega lista inicial ao abrir e refaz consulta ao digitar (debounce 300ms).
 */
function CreatedByPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<AdminOption[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Click fora fecha
  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Quando value externo muda, busca o nome do selecionado para exibir no botão
  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setSelectedLabel(null);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, admin_username')
        .eq('id', value)
        .maybeSingle();
      if (cancelled) return;
      const row = data as AdminOption | null;
      setSelectedLabel(row?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);

  // Busca debounced de admins
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      void (async () => {
        let query = supabase
          .from('users')
          .select('id, name, admin_username')
          .eq('is_superuser', true)
          .limit(20);
        const term = q.trim();
        if (term.length > 0) {
          // ILIKE em name OU admin_username
          query = query.or(`name.ilike.%${term}%,admin_username.ilike.%${term}%`);
        }
        const { data } = await query;
        setOptions((data ?? []) as AdminOption[]);
      })();
    }, 300);
    return () => clearTimeout(id);
  }, [q, open]);

  const buttonLabel = value ? (selectedLabel ?? 'Selecionado') : 'Todos';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100 flex items-center justify-between gap-2"
      >
        <span className="truncate">{buttonLabel}</span>
        <span className="text-gray-500">▾</span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full max-h-60 overflow-y-auto rounded border border-gray-700 bg-gray-900 shadow-xl">
          <div className="p-1.5 border-b border-gray-800">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar admin..."
              className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="w-full text-left px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            Todos
          </button>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o.id);
                setSelectedLabel(o.name);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
            >
              {o.name}
              {o.admin_username && <span className="text-gray-500"> ({o.admin_username})</span>}
            </button>
          ))}
          {options.length === 0 && (
            <div className="px-2 py-2 text-xs text-gray-500">Nenhum admin encontrado.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BlacklistFiltersUI({ filters, onChange, totalFiltered }: Props) {
  const [qLocal, setQLocal] = useState(filters.q);
  const [dateError, setDateError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Debounce do campo de busca (300ms)
  useEffect(() => {
    const id = setTimeout(() => {
      if (qLocal !== filters.q) {
        onChange({ ...filters, q: qLocal, page: 1 });
      }
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);

  useEffect(() => {
    if (filters.q !== qLocal) setQLocal(filters.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  // Click fora fecha popover
  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (popRef.current && !popRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function handleDateChange(field: 'from' | 'to', value: string | null) {
    const next = { ...filters, [field]: value || null, page: 1 };
    if (next.from && next.to && next.from > next.to) {
      setDateError('Data inicial deve ser menor ou igual à final.');
      return;
    }
    setDateError(null);
    onChange(next);
  }

  const activeFilters =
    (filters.type !== 'todos' ? 1 : 0) +
    (filters.status !== 'todos' ? 1 : 0) +
    (filters.createdBy ? 1 : 0) +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.sort !== 'created_desc' ? 1 : 0);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Busca compacta */}
      <input
        type="search"
        value={qLocal}
        onChange={(e) => setQLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQLocal('');
        }}
        placeholder="Buscar..."
        aria-label="Buscar entradas da blacklist"
        className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100 focus:outline-none focus:border-cyan-500 w-44"
      />

      {/* Botão de filtros */}
      <div className="relative" ref={popRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Abrir filtros"
          aria-expanded={open}
          className={`p-1.5 rounded border text-xs transition flex items-center gap-1 ${
            activeFilters > 0
              ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
          }`}
          title="Filtros"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          {activeFilters > 0 && (
            <span className="text-[10px] font-bold px-1 rounded bg-cyan-500/30">
              {activeFilters}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 mt-1 z-30 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Tipo
              </label>
              <select
                value={filters.type}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    type: e.target.value as BlacklistFiltersType['type'],
                    page: 1,
                  })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              >
                <option value="todos">Todos</option>
                <option value="phone">Telefone</option>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="ip_address">IP</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    status: e.target.value as BlacklistFiltersType['status'],
                    page: 1,
                  })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              >
                <option value="todos">Todos</option>
                <option value="ativo">Ativos</option>
                <option value="expirado">Expirados</option>
                <option value="removido">Removidos</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Criado por
              </label>
              <CreatedByPicker
                value={filters.createdBy}
                onChange={(id) => onChange({ ...filters, createdBy: id, page: 1 })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  De
                </label>
                <input
                  type="date"
                  value={filters.from ?? ''}
                  onChange={(e) => handleDateChange('from', e.target.value || null)}
                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Até
                </label>
                <input
                  type="date"
                  value={filters.to ?? ''}
                  onChange={(e) => handleDateChange('to', e.target.value || null)}
                  className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Ordenar por
              </label>
              <select
                value={filters.sort}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    sort: e.target.value as BlacklistFiltersType['sort'],
                    page: 1,
                  })
                }
                className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
              >
                <option value="created_desc">Mais recentes</option>
                <option value="created_asc">Mais antigos</option>
                <option value="expires_asc">Expira em breve</option>
                <option value="removed_desc">Removidos recentes</option>
              </select>
            </div>

            {dateError && (
              <div className="text-[11px] text-red-400" role="alert">
                {dateError}
              </div>
            )}

            <div className="text-[11px] text-gray-500 pt-1 border-t border-gray-800">
              {totalFiltered} entradas filtradas
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
