/**
 * SupervisorInsightsPage (/admin/supervisor/insights) — Insights (anomalias/
 * sugestões/segurança). Lista ordenada (compareInsights), filtros em popover,
 * paginação. Reconhecer/Descartar gated (SUPERVISOR_MANAGE) com versionamento
 * otimista (_SKIPPED neutro; STALE_VERSION refetch). Botão "Avaliar agora".
 *
 * Gating: SUPERVISOR_VIEW ⇒ senão Stealth_404. Compacto.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import DashboardBlockError from '../../../components/admin/dashboard/DashboardBlockError';
import SupervisorNav from '../../../components/admin/supervisor/SupervisorNav';
import InsightsFiltersPopover from '../../../components/admin/supervisor/InsightsFiltersPopover';
import InsightActionsCell from '../../../components/admin/supervisor/InsightActionsCell';
import {
  InsightSeverityBadge,
  InsightStateBadge,
} from '../../../components/admin/supervisor/SupervisorBadges';
import { INSIGHT_TYPE_LABEL } from '../../../components/admin/supervisor/labels';
import {
  listInsights,
  acknowledgeInsight,
  dismissInsight,
  triggerEvaluate,
  SupervisorError,
  SUPERVISOR_ERROR_MESSAGES,
  type InsightFilters,
  type SupervisorInsight,
  type MutationResult,
  type PageSize,
} from '../../../services/admin/supervisor';
import { compareInsights } from '../../../services/admin/supervisor/ordering';

interface Feedback {
  kind: 'info' | 'error';
  text: string;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function sortInsights(items: SupervisorInsight[]): SupervisorInsight[] {
  return [...items].sort((a, b) =>
    compareInsights(
      { id: a.id, severity: a.severity, createdAt: a.created_at },
      { id: b.id, severity: b.severity, createdAt: b.created_at }
    )
  );
}

export default function SupervisorInsightsPage() {
  const { allowed: canView } = useAdminPermission('SUPERVISOR_VIEW');

  const [filters, setFilters] = useState<InsightFilters>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [data, setData] = useState<{ items: SupervisorInsight[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listInsights(filters, page, pageSize)
      .then((d) => setData({ items: sortInsights(d.items), total: d.total }))
      .catch((e) =>
        setError(e instanceof SupervisorError ? e.message : 'Não foi possível carregar os insights.')
      )
      .finally(() => setLoading(false));
  }, [filters, page, pageSize]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  const runMutation = useCallback(
    async (
      insight: SupervisorInsight,
      fn: (id: string, expectedUpdatedAt: string) => Promise<MutationResult>,
      successText: string,
      skipText: string
    ) => {
      setBusyId(insight.id);
      setFeedback(null);
      try {
        const res = await fn(insight.id, insight.updated_at);
        setFeedback({ kind: 'info', text: 'skipped' in res ? skipText : successText });
        load();
      } catch (err) {
        const e = err instanceof SupervisorError ? err : null;
        if (e?.code === 'STALE_VERSION') {
          setFeedback({ kind: 'info', text: SUPERVISOR_ERROR_MESSAGES.STALE_VERSION });
          load();
        } else {
          setFeedback({ kind: 'error', text: e?.message ?? 'Não foi possível concluir a operação.' });
        }
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const onAck = useCallback(
    (i: SupervisorInsight) =>
      runMutation(i, acknowledgeInsight, 'Insight reconhecido.', 'Este insight já estava reconhecido.'),
    [runMutation]
  );
  const onDismiss = useCallback(
    (i: SupervisorInsight) =>
      runMutation(i, dismissInsight, 'Insight descartado.', 'Este insight já estava descartado.'),
    [runMutation]
  );

  const onEvaluate = useCallback(async () => {
    setEvaluating(true);
    setFeedback(null);
    try {
      const r = await triggerEvaluate();
      setFeedback({
        kind: 'info',
        text: `Avaliação concluída: ${r.opened} aberto(s), ${r.touched} atualizado(s), ${r.dismissed} encerrado(s).`,
      });
      load();
    } catch (err) {
      const e = err instanceof SupervisorError ? err : null;
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
      <SupervisorNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-500">
          {total > 0 ? `Exibindo ${pageStart}–${pageEnd} de ${total}` : 'Nenhum insight'}
        </div>
        <div className="flex items-center gap-1.5">
          <InsightsFiltersPopover
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
            title="Reavaliar as fontes e reconciliar os insights"
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
        <div className="text-center text-gray-500 text-sm py-6">Carregando insights...</div>
      ) : (
        <>
          <div className="hidden md:block rounded border border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Severidade</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Insight</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Estado</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Quando</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {items.map((i) => (
                  <tr key={i.id} className="hover:bg-gray-900/60">
                    <td className="px-3 py-2">
                      <InsightSeverityBadge severity={i.severity} />
                    </td>
                    <td className="px-3 py-2 text-gray-200">
                      <div className="font-medium">{i.title}</div>
                      <div className="text-[10px] text-gray-500">{INSIGHT_TYPE_LABEL[i.insight_type]}</div>
                    </td>
                    <td className="px-3 py-2">
                      <InsightStateBadge state={i.state} />
                    </td>
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {formatDateTime(i.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <InsightActionsCell
                        insight={i}
                        busy={busyId === i.id}
                        onAck={onAck}
                        onDismiss={onDismiss}
                      />
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      Nenhum insight encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2">
            {items.map((i) => (
              <div key={i.id} className="rounded border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <InsightSeverityBadge severity={i.severity} />
                  <InsightStateBadge state={i.state} />
                </div>
                <p className="text-sm text-gray-100">{i.title}</p>
                <p className="text-[10px] text-gray-500">
                  {INSIGHT_TYPE_LABEL[i.insight_type]} · {formatDateTime(i.created_at)}
                </p>
                <div className="mt-2">
                  <InsightActionsCell
                    insight={i}
                    busy={busyId === i.id}
                    onAck={onAck}
                    onDismiss={onDismiss}
                  />
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-center text-gray-500 text-sm py-6">Nenhum insight encontrado.</p>
            )}
          </div>

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
