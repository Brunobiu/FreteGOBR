/**
 * UserFretesBlock - lista de fretes (embarcador) ou cliques (motorista).
 */

import type { UserFreteRow, UserType } from '../../../services/admin/users';

interface Props {
  userType: UserType;
  fretes: UserFreteRow[];
  total: number;
  error?: string;
}

export default function UserFretesBlock({ userType, fretes, total, error }: Props) {
  const title = userType === 'embarcador' ? 'Fretes publicados' : 'Fretes clicados';

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        {title} ({total})
      </h3>
      {error && <div className="text-xs text-red-400 mb-2">Falha ao carregar fretes.</div>}
      {fretes.length === 0 && !error && (
        <div className="text-xs text-gray-500">Nenhum frete encontrado.</div>
      )}
      <ul className="space-y-2 text-sm">
        {fretes.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between gap-3 py-1 border-b border-gray-800/40 last:border-0"
          >
            <div className="min-w-0">
              <div className="text-gray-200 truncate">
                {f.origin} → {f.destination}
              </div>
              <div className="text-xs text-gray-500">
                {new Date(f.clicked_at ?? f.created_at).toLocaleDateString('pt-BR')}
              </div>
            </div>
            <span className="text-xs text-gray-400 capitalize shrink-0">{f.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
