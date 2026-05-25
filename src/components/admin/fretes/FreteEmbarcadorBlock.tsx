/**
 * FreteEmbarcadorBlock - dados do embarcador.
 */

import { Link } from 'react-router-dom';
import type { FreteEmbarcadorSnapshot } from '../../../services/admin/fretes';

interface Props {
  embarcador: FreteEmbarcadorSnapshot | null;
  canViewUser: boolean;
  error?: string;
}

export default function FreteEmbarcadorBlock({ embarcador, canViewUser, error }: Props) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Embarcador</h3>
      {error && <div className="text-xs text-red-400 mb-2">Falha ao carregar embarcador.</div>}
      {!embarcador && !error && (
        <div className="text-xs text-gray-500">Embarcador nao encontrado.</div>
      )}
      {embarcador && (
        <dl className="space-y-1.5 text-sm">
          <div>
            <dt className="text-gray-500 text-xs">Nome / Empresa</dt>
            <dd className="text-gray-200">
              {embarcador.company_name ?? embarcador.name}
              {!embarcador.is_active && (
                <span className="ml-2 px-1.5 py-0.5 text-[9px] uppercase rounded bg-red-500/15 text-red-300 border border-red-500/30">
                  Inativo
                </span>
              )}
              {embarcador.ban_reason && (
                <span className="ml-2 px-1.5 py-0.5 text-[9px] uppercase rounded bg-red-500/15 text-red-300 border border-red-500/30">
                  Banido
                </span>
              )}
            </dd>
          </div>
          {embarcador.cnpj && (
            <div>
              <dt className="text-gray-500 text-xs">CNPJ</dt>
              <dd className="text-gray-200">{embarcador.cnpj}</dd>
            </div>
          )}
          {(embarcador.branch_city || embarcador.branch_state) && (
            <div>
              <dt className="text-gray-500 text-xs">Filial</dt>
              <dd className="text-gray-200">
                {[embarcador.branch_city, embarcador.branch_state].filter(Boolean).join(', ') ||
                  '—'}
              </dd>
            </div>
          )}
          {embarcador.email && (
            <div>
              <dt className="text-gray-500 text-xs">Email</dt>
              <dd className="text-gray-200">{embarcador.email}</dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500 text-xs">Telefone</dt>
            <dd className="text-gray-200">{embarcador.phone}</dd>
          </div>
          {canViewUser && (
            <Link
              to={`/admin/users/${embarcador.id}`}
              className="inline-block mt-2 text-xs text-cyan-400 hover:text-cyan-300"
            >
              Ver perfil completo →
            </Link>
          )}
        </dl>
      )}
    </section>
  );
}
