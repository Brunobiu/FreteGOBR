/**
 * UserRatingsBlock - avaliacoes recebidas pelo usuario.
 */

import type { UserRatingRow } from '../../../services/admin/users';

interface Props {
  ratings: UserRatingRow[];
  error?: string;
}

export default function UserRatingsBlock({ ratings, error }: Props) {
  const avg = ratings.length > 0 ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : 0;

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Avaliacoes recebidas{' '}
        {ratings.length > 0 && (
          <span className="text-amber-300 font-normal">
            ({avg.toFixed(1)} ★ · {ratings.length})
          </span>
        )}
      </h3>
      {error && <div className="text-xs text-red-400 mb-2">Falha ao carregar avaliacoes.</div>}
      {ratings.length === 0 && !error && (
        <div className="text-xs text-gray-500">Nenhuma avaliacao recebida.</div>
      )}
      <ul className="space-y-3 text-sm">
        {ratings.map((r) => (
          <li key={r.id} className="border-b border-gray-800/40 pb-2 last:border-0">
            <div className="flex items-center justify-between">
              <span className="text-amber-300">
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(r.created_at).toLocaleDateString('pt-BR')}
              </span>
            </div>
            {r.comment && <p className="text-gray-300 text-sm mt-1">{r.comment}</p>}
            <p className="text-xs text-gray-500 mt-0.5">— {r.rater_name}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
