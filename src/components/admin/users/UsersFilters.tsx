/**
 * UsersFilters - dropdowns de tipo, status, ordenacao + busca com debounce 300ms
 */

import { useEffect, useState } from 'react';
import type { UsersFilters } from '../../../services/admin/users';

interface Props {
  filters: UsersFilters;
  onChange: (next: UsersFilters) => void;
  totalFiltered: number;
}

export default function UsersFilters({ filters, onChange, totalFiltered }: Props) {
  const [qLocal, setQLocal] = useState(filters.q);

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

  // Mantem campo local em sincronia caso filters.q mude por fora
  useEffect(() => {
    if (filters.q !== qLocal) setQLocal(filters.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        Total: <span className="text-gray-300 font-medium">{totalFiltered}</span> usuarios
        (filtrados)
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label htmlFor="users-type-filter" className="sr-only">
            Tipo de usuario
          </label>
          <select
            id="users-type-filter"
            value={filters.type}
            onChange={(e) =>
              onChange({
                ...filters,
                type: e.target.value as UsersFilters['type'],
                page: 1,
              })
            }
            className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:outline-none focus:border-cyan-500"
          >
            <option value="todos">Todos os tipos</option>
            <option value="motorista">Motoristas</option>
            <option value="embarcador">Embarcadores</option>
          </select>
        </div>

        <div>
          <label htmlFor="users-status-filter" className="sr-only">
            Status
          </label>
          <select
            id="users-status-filter"
            value={filters.status}
            onChange={(e) =>
              onChange({
                ...filters,
                status: e.target.value as UsersFilters['status'],
                page: 1,
              })
            }
            className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:outline-none focus:border-cyan-500"
          >
            <option value="todos">Todos os status</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
            <option value="banido">Banidos</option>
          </select>
        </div>

        <div>
          <label htmlFor="users-sort" className="sr-only">
            Ordenar
          </label>
          <select
            id="users-sort"
            value={filters.sort}
            onChange={(e) =>
              onChange({
                ...filters,
                sort: e.target.value as UsersFilters['sort'],
                page: 1,
              })
            }
            className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:outline-none focus:border-cyan-500"
          >
            <option value="created_desc">Mais recentes</option>
            <option value="created_asc">Mais antigos</option>
            <option value="activity_desc">Atividade recente</option>
            <option value="activity_asc">Atividade antiga</option>
          </select>
        </div>

        <div>
          <label htmlFor="users-search" className="sr-only">
            Buscar usuario
          </label>
          <input
            id="users-search"
            type="search"
            value={qLocal}
            onChange={(e) => setQLocal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQLocal('');
            }}
            placeholder="Buscar por nome, email, telefone, CPF..."
            className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>
    </div>
  );
}
