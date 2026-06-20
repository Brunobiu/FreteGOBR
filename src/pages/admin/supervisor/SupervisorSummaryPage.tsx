/**
 * SupervisorSummaryPage (/admin/supervisor/resumo) — Resumo inteligente.
 *
 * Mostra os últimos Periodic_Summary (insights tipo SUMMARY) e permite gerar o
 * resumo do dia sob demanda ("Gerar agora", idempotente por janela).
 *
 * Gating: SUPERVISOR_VIEW ⇒ senão Stealth_404. Compacto.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import DashboardBlockError from '../../../components/admin/dashboard/DashboardBlockError';
import SupervisorNav from '../../../components/admin/supervisor/SupervisorNav';
import {
  listInsights,
  generateSummary,
  SupervisorError,
  type SupervisorInsight,
} from '../../../services/admin/supervisor';

interface Feedback {
  kind: 'info' | 'error';
  text: string;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function SupervisorSummaryPage() {
  const { allowed: canView } = useAdminPermission('SUPERVISOR_VIEW');
  const [items, setItems] = useState<SupervisorInsight[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listInsights({ type: 'SUMMARY' }, 0, 10)
      .then((d) => setItems(d.items))
      .catch((e) =>
        setError(e instanceof SupervisorError ? e.message : 'Não foi possível carregar os resumos.')
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  const onGenerate = useCallback(async () => {
    setGenerating(true);
    setFeedback(null);
    try {
      const r = await generateSummary('daily');
      setFeedback({
        kind: 'info',
        text: 'skipped' in r ? 'O resumo de hoje já havia sido gerado.' : 'Resumo do dia gerado.',
      });
      load();
    } catch (err) {
      const e = err instanceof SupervisorError ? err : null;
      setFeedback({ kind: 'error', text: e?.message ?? 'Não foi possível gerar o resumo.' });
    } finally {
      setGenerating(false);
    }
  }, [load]);

  if (!canView) return <Stealth404 />;

  const list = items ?? [];

  return (
    <div className="space-y-3">
      <SupervisorNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-500">Resumos periódicos da operação.</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {generating ? 'Gerando...' : 'Gerar agora'}
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
      ) : loading && !items ? (
        <div className="text-center text-gray-500 text-sm py-6">Carregando resumos...</div>
      ) : list.length === 0 ? (
        <p className="text-center text-gray-500 text-sm py-6">
          Nenhum resumo gerado ainda. Use &ldquo;Gerar agora&rdquo;.
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((s) => (
            <div key={s.id} className="rounded border border-gray-800 bg-gray-900 p-3">
              <div className="text-[10px] text-gray-500 mb-1">{formatDateTime(s.created_at)}</div>
              <p className="text-sm text-gray-100">{s.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
