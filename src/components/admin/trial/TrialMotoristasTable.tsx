/**
 * TrialMotoristasTable - tabela paginada do status de trial por motorista.
 *
 * Componente PURO de apresentacao (sem data fetching). A pagina (task 9.1)
 * busca via `listTrialMotoristas` e passa `rows` aqui. Para cada motorista
 * exibe: status de trial (em trial / expirado / assinante) + dias restantes,
 * alem de nome/telefone.
 *
 * Padrao visual herdado de BlacklistTable/UsersTable (tema dark do AdminShell:
 * badges coloridos por estado, estado vazio com role="status", aria-busy
 * enquanto loading, skeleton de 5 rows) com o padrao responsivo
 * desktop-table + mobile-cards de FinanceiroListPage (convencao do projeto:
 * `<768px` => lista de cards single-column).
 *
 * Acao opcional "Estender" (botao compacto `text-xs px-2.5 py-1`) acionada via
 * callback `onExtend(row)`, que a pagina conecta ao ExtendTrialModal (task 9.4).
 * O botao e desabilitado para o Master Admin imutavel (convencao da casa).
 */

import type { TrialMotoristaRow } from '../../../services/admin/trial';

interface Props {
  rows: TrialMotoristaRow[];
  /** Exibe skeleton/aria-busy enquanto a pagina carrega. */
  loading?: boolean;
  /** Quando definido, renderiza o botao compacto "Estender" por linha. */
  onExtend?: (row: TrialMotoristaRow) => void;
  /** Controla se a coluna/botao de extensao aparece (gating USER_EDIT no parent). */
  canExtend?: boolean;
}

const MASTER_ADMIN_USERNAME = 'Nexus_Vortex99';

const STATE_BADGES: Record<TrialMotoristaRow['trial_state'], { label: string; cls: string }> = {
  em_trial: {
    label: 'Em trial',
    cls: 'bg-green-500/15 text-green-300 border-green-500/30',
  },
  expirado: {
    label: 'Expirado',
    cls: 'bg-red-500/15 text-red-300 border-red-500/30',
  },
  assinante: {
    label: 'Assinante',
    cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '—';
  }
}

function formatPhone(p: string): string {
  const d = (p ?? '').replace(/\D/g, '');
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return p || '—';
}

/** Texto de dias restantes: assinante => "—"; senao "{n} dia(s)". */
function daysLeftLabel(row: TrialMotoristaRow): string {
  if (row.trial_state === 'assinante') return '—';
  return `${row.days_left} ${row.days_left === 1 ? 'dia' : 'dias'}`;
}

/** Cor do contador por urgencia (espelha conceitualmente os tiers do TrialBadge). */
function daysLeftClass(row: TrialMotoristaRow): string {
  if (row.trial_state === 'assinante') return 'text-gray-500';
  if (row.trial_state === 'expirado' || row.days_left === 0) return 'text-red-300';
  if (row.days_left <= 5) return 'text-yellow-300';
  return 'text-gray-200';
}

export default function TrialMotoristasTable({ rows, loading, onExtend, canExtend }: Props) {
  const showActions = Boolean(onExtend) && canExtend !== false;
  const colCount = showActions ? 6 : 5;

  return (
    <>
      {/* Desktop table */}
      <div
        className="hidden md:block overflow-x-auto rounded-lg border border-gray-800 bg-gray-900"
        aria-busy={loading}
      >
        <table className="min-w-full text-sm">
          <caption className="sr-only">Status de trial dos motoristas do FreteGO</caption>
          <thead className="bg-gray-800/60 text-gray-400 text-xs uppercase">
            <tr>
              <th scope="col" className="text-left px-3 py-2">
                Motorista
              </th>
              <th scope="col" className="text-left px-3 py-2">
                Telefone
              </th>
              <th scope="col" className="text-left px-3 py-2">
                Status
              </th>
              <th scope="col" className="text-left px-3 py-2">
                Dias restantes
              </th>
              <th scope="col" className="text-left px-3 py-2">
                Expira em
              </th>
              {showActions && <th scope="col" className="text-right px-3 py-2 w-24"></th>}
            </tr>
          </thead>
          <tbody>
            {loading &&
              rows.length === 0 &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-gray-800">
                  <td colSpan={colCount} className="px-3 py-3">
                    <div className="h-4 bg-gray-800 rounded animate-pulse" />
                  </td>
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-3 py-8 text-center text-gray-500"
                  role="status"
                >
                  Nenhum motorista encontrado com os filtros atuais.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const badge = STATE_BADGES[r.trial_state];
              const isMaster = r.admin_username === MASTER_ADMIN_USERNAME;

              return (
                <tr key={r.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                  <td className="px-3 py-2">
                    <div className="text-gray-100 font-medium truncate">{r.name || '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-400">{formatPhone(r.phone)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className={`px-3 py-2 font-medium ${daysLeftClass(r)}`}>
                    {daysLeftLabel(r)}
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                    {formatDate(r.trial_ends_at)}
                  </td>
                  {showActions && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onExtend?.(r)}
                        disabled={isMaster}
                        className="text-xs px-2.5 py-1 rounded border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={isMaster ? 'Master Admin é imutável' : 'Estender trial'}
                        aria-label={`Estender trial de ${r.name || 'motorista'}`}
                      >
                        Estender
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (single-column) */}
      <div className="md:hidden space-y-2" aria-busy={loading}>
        {loading &&
          rows.length === 0 &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={`sk-m-${i}`} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
              <div className="h-4 bg-gray-800 rounded animate-pulse" />
            </div>
          ))}
        {!loading && rows.length === 0 && (
          <p className="text-center text-gray-500 text-sm py-6" role="status">
            Nenhum motorista encontrado com os filtros atuais.
          </p>
        )}
        {rows.map((r) => {
          const badge = STATE_BADGES[r.trial_state];
          const isMaster = r.admin_username === MASTER_ADMIN_USERNAME;

          return (
            <div key={r.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-gray-100 font-medium truncate">{r.name || '—'}</div>
                  <div className="text-xs text-gray-500 truncate">{formatPhone(r.phone)}</div>
                </div>
                <span
                  className={`shrink-0 inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </div>
              <div className="flex items-end justify-between gap-2 mt-2">
                <div className="text-xs">
                  <span className={`font-medium ${daysLeftClass(r)}`}>{daysLeftLabel(r)}</span>
                  <span className="text-gray-600"> · expira {formatDate(r.trial_ends_at)}</span>
                </div>
                {showActions && (
                  <button
                    type="button"
                    onClick={() => onExtend?.(r)}
                    disabled={isMaster}
                    className="text-xs px-2.5 py-1 rounded border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={isMaster ? 'Master Admin é imutável' : 'Estender trial'}
                    aria-label={`Estender trial de ${r.name || 'motorista'}`}
                  >
                    Estender
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
