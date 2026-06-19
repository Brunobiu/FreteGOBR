/**
 * OperacaoAlertasPage (/admin/operacao/alertas) — Sistema de Alertas.
 *
 * Lista ordenada (compareAlerts: severidade ↑, last_seen_at ↓, id), filtros em
 * popover (estado/tipo/severidade), paginação 10/50/100. Botão "Avaliar agora"
 * (reconciliação sob demanda). Ações Reconhecer/Resolver com gating de UI e
 * versionamento otimista (envia updated_at): _SKIPPED ⇒ toast neutro;
 * STALE_VERSION ⇒ aviso + refetch.
 *
 * Gating: ALERT_VIEW ⇒ senão Stealth_404 (Req 1.4, 1.5). Padrão compacto.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import DashboardBlockError from '../../../components/admin/dashboard/DashboardBlockError';
import OperacaoNav from '../../../components/admin/operacao/OperacaoNav';
import AlertsFiltersPopover from '../../../components/admin/operacao/AlertsFiltersPopover';
import AlertActionsCell from '../../../components/admin/operacao/AlertActionsCell';
import {
  AlertSeverityBadge,
  AlertStateBadge,
} from '../../../components/admin/operacao/OperacaoBadges';
import { ALERT_TYPE_LABEL } from '../../../components/admin/operacao/labels';
import {
  listAlerts,
  acknowledgeAlert,
  resolveAlert,
  triggerEvaluate,
  OperacaoError,
  OPERACAO_ERROR_MESSAGES,
  type AlertFilters,
  type SystemAlert,
  type MutationResult,
  type PageSize,
} from '../../../services/admin/operacao';
import { compareAlerts } from '../../../services/admin/operacao/ordering';

interface Feedback {
  kind: 'info' | 'error';
  text: string;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function sortAlerts(items: SystemAlert[]): SystemAlert[] {
  return [...items].sort((a, b) =>
    compareAlerts(
      { id: a.id, severity: a.severity, lastSeenAt: a.last_seen_at },
      { id: b.id, severity: b.severity, lastSeenAt: b.last_seen_at }
    )
  );
}

export default function OperacaoAlertasPage() {
  const { allowed: canView } = useAdminPermission('ALERT_VIEW');

  const [filters, setFilters] = useState<AlertFilters>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [data, setData] = useState<{ items: SystemAlert[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listAlerts(filters, page, pageSize)
      .then((d) => setData({ items: sortAlerts(d.items), total: d.total }))
      .catch((e) =>
        setError(e instanceof OperacaoError ? e.message : 'Não foi possível carregar os alertas.')
      )
      .finally(() => setLoading(false));
  }, [filters, page, pageSize]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  const runMutation = useCallback(
    async (
      alert: SystemAlert,
      fn: (id: string, expectedUpdatedAt: string) => Promise<MutationResult>,
      successText: string,
      skipText: string
    ) => {
      setBusyId(alert.id);
      setFeedback(null);
      try {
        const res = await fn(alert.id, alert.updated_at);
        setFeedback({ kind: 'info', text: 'skipped' in res ? skipText : successText });
        load();
      } catch (err) {
        const e = err instanceof OperacaoError ? err : null;
        if (e?.code === 'STALE_VERSION') {
          setFeedback({ kind: 'info', text: OPERACAO_ERROR_MESSAGES.STALE_VERSION });
          load();
        } else {
          setFeedback({
            kind: 'error',
            text: e?.message ?? 'Não foi possível concluir a operação.',
          });
        }
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const onAck = useCallback(
    (a: SystemAlert) =>
      runMutation(a, acknowledgeAlert, 'Alerta reconhecido.', 'Este alerta já estava reconhecido.'),
    [runMutation]
  );
  const onResolve = useCallback(
    (a: SystemAlert) =>
      runMutation(a, resolveAlert, 'Alerta resolvido.', 'Este alerta já estava resolvido.'),
    [runMutation]
  );

  const onEvaluate = useCallback(async () => {
    setEvaluating(true);
    setFeedback(null);
    try {
      const r = await triggerEvaluate();
      setFeedback({
        kind: 'info',
        text: `Avaliação concluída: ${r.opened} aberto(s), ${r.touched} atualizado(s), ${r.resolved} resolvido(s).`,
      });
      load();
    } catch (err) {
      const e = err instanceof OperacaoError ? err : null;
      setFeedback({ kind: 'error', text: e?.message ?? 'Não foi possível avaliar agora.' });
    } finally {
      setEvaluating(false);
    }
  }, [load]);

  if (!canView) return <Stealth404 />;

  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : page * pageSize + 1;
  const pageEnd = Math.min(page * pageSize + pageSize, total);
  const items = data?.items ?? [];

  return (
    <div className="space-y-3">
      <OperacaoNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-500">
          {total > 0 ? `Exibindo ${pageStart}–${pageEnd} de ${total}` : 'Nenhum alerta'}
        </div>
        <div className="flex items-center gap-1.5">
          <AlertsFiltersPopover
            filters={filters}
            onApply={(next) => {
              setPage(0);
              setFilters(next);
            }}
          />
          <button
            type="button"
            onClick={onEvaluate}
            disabled={evaluating}
            className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
            title="Reavaliar as fontes e reconciliar os alertas"
          >
            {evaluating ? 'Avaliando...' : 'Avaliar agora'}
          </button>
          <button
            type="button"
            onClick={load}
            className="text-xs px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700"
            title="Atualizar"
          >
            {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="alert"
          className={`text-xs rounded border px-3 py-2 ${
            feedback.kind === 'error'
              ? 'border-red-900/40 bg-red-500/10 text-red-300'
              : 'border-cyan-900/40 bg-cyan-500/10 text-cyan-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {error ? (
        <DashboardBlockError message={error} onRetry={load} />
      ) : loading && !data ? (
        <div className="text-center text-gray-500 text-sm py-6">Carregando alertas...</div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block rounded border border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Severidade</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Alerta</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Estado</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Última ocorrência</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {items.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-900/60">
                    <td className="px-3 py-2">
                      <AlertSeverityBadge severity={a.severity} />
                    </td>
                    <td className="px-3 py-2 text-gray-200">
                      <div className="font-medium">{a.title || ALERT_TYPE_LABEL[a.alert_type]}</div>
                      <div className="text-[10px] text-gray-500">
                        {ALERT_TYPE_LABEL[a.alert_type]} · {a.source_type}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <AlertStateBadge state={a.state} />
                    </td>
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {formatDateTime(a.last_seen_at)}
                    </td>
                    <td className="px-3 py-2">
                      <AlertActionsCell
                        alert={a}
                        busy={busyId === a.id}
                        onAck={onAck}
                        onResolve={onResolve}
                      />
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      Nenhum alerta encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {items.map((a) => (
              <div key={a.id} className="rounded border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <AlertSeverityBadge severity={a.severity} />
                  <AlertStateBadge state={a.state} />
                </div>
                <p className="text-sm text-gray-100">{a.title || ALERT_TYPE_LABEL[a.alert_type]}</p>
                <p className="text-[11px] text-gray-500">
                  {ALERT_TYPE_LABEL[a.alert_type]} · {a.source_type}
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">{formatDateTime(a.last_seen_at)}</p>
                <div className="mt-2">
                  <AlertActionsCell
                    alert={a}
                    busy={busyId === a.id}
                    onAck={onAck}
                    onResolve={onResolve}
                  />
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-center text-gray-500 text-sm py-6">Nenhum alerta encontrado.</p>
            )}
          </div>

          {/* Paginação */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <select
              value={pageSize}
              onChange={(e) => {
                setPage(0);
                setPageSize(Number(e.target.value) as PageSize);
              }}
              className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-gray-200"
            >
              <option value={10}>10</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={pageEnd >= total}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
