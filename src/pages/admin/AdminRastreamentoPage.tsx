/**
 * AdminRastreamentoPage — aba /admin/rastreamento (Rastreamento Inteligente / PatGo).
 *
 * Gating em duas camadas: `useAdminPermission('RASTREAMENTO_VIEW')` ⇒ Stealth_404
 * quando negado (a RPC revalida server-side). Padrão compacto: SEM `<h1>` grande;
 * filtros em popover; paginação `10/50/100`; KPIs compactos; gráficos SVG inline;
 * multi-coluna em `≥768px`. Ações de recuperação e config de IA gated por
 * `RASTREAMENTO_MANAGE` (ocultas em somente-leitura).
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.5, 1.9, 1.10, 2.5_
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminPermission } from '../../hooks/useAdminPermission';
import Stealth404 from '../../components/admin/Stealth404';
import {
  getFunnel,
  getRecoveryPerformance,
  getTimeline,
  getTrackingConfig,
  listAtRisk,
  markContacted,
  setTrackingAiKey,
  triggerRecovery,
  updateAiConfig,
  type AiConfigPatch,
  type AtRiskPage,
  type FunnelBundle,
  type RecoveryBundle,
  type TimelineBundle,
  type TrackingConfigView,
} from '../../services/admin/rastreamento';
import {
  DEFAULT_PAGE_SIZE,
  type AiProvider,
  type PageSize,
  type RiskCategory,
  type RecoveryScenario,
  type TimeWindow,
} from '../../services/admin/rastreamento/domain';
import {
  filterAndSortAtRisk,
  type AtRiskRow,
  type TrackingFilterInput,
} from '../../services/admin/rastreamento/atRiskList';
import { exportAtRiskCsv } from '../../services/admin/rastreamento/csvExport';
import { DEFAULT_TEMPLATES } from '../../services/admin/rastreamento/messageTemplates';
import KpiCard from '../../components/admin/rastreamento/KpiCard';
import AtRiskTable from '../../components/admin/rastreamento/AtRiskTable';
import UserJourneyTimeline from '../../components/admin/rastreamento/UserJourneyTimeline';
import ConversionFunnelChart from '../../components/admin/rastreamento/ConversionFunnelChart';
import RecoveryPerformanceChart from '../../components/admin/rastreamento/RecoveryPerformanceChart';
import TrackingFilterPopover from '../../components/admin/rastreamento/TrackingFilterPopover';
import TrackingAiConfigCard from '../../components/admin/rastreamento/TrackingAiConfigCard';

/** Mapeia a Risk_Category ao cenário cujo template é copiado como "mensagem pronta". */
const CATEGORY_SCENARIO: Record<RiskCategory, RecoveryScenario> = {
  SIGNUP_ABANDONED: 'SIGNUP_ABANDONED',
  PAYMENT_PENDING: 'PAYMENT_FAILED',
  INACTIVE: 'USER_INACTIVE',
  COLD_DRIVER: 'COLD_DRIVER',
  RECURRING_ERROR: 'USER_INACTIVE',
};

function triggerDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminRastreamentoPage() {
  const { allowed } = useAdminPermission('RASTREAMENTO_VIEW');
  const { allowed: canManage } = useAdminPermission('RASTREAMENTO_MANAGE');
  const navigate = useNavigate();

  const [filter, setFilter] = useState<TrackingFilterInput>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [list, setList] = useState<AtRiskPage>({ rows: [], total: 0, page: 0, page_size: DEFAULT_PAGE_SIZE });
  const [funnel, setFunnel] = useState<FunnelBundle | null>(null);
  const [recovery, setRecovery] = useState<RecoveryBundle | null>(null);
  const [config, setConfig] = useState<TrackingConfigView | null>(null);
  const [funnelWindow, setFunnelWindow] = useState<TimeWindow>('7d');
  const [recoveryWindow, setRecoveryWindow] = useState<TimeWindow>('7d');
  const [selected, setSelected] = useState<{ row: AtRiskRow; timeline: TimelineBundle | null; loading: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const loadList = useCallback(async () => {
    try {
      const res = await listAtRisk(filter, page, pageSize);
      setList(res);
    } catch {
      setList({ rows: [], total: 0, page, page_size: pageSize });
    }
  }, [filter, page, pageSize]);

  const loadFunnel = useCallback(async () => {
    setFunnel(await getFunnel(funnelWindow));
  }, [funnelWindow]);

  const loadRecovery = useCallback(async () => {
    setRecovery(await getRecoveryPerformance(recoveryWindow));
  }, [recoveryWindow]);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await getTrackingConfig());
    } catch {
      /* permission_denied já barrado pelo gating da página */
    }
  }, []);

  useEffect(() => {
    if (allowed) void loadList();
  }, [allowed, loadList]);
  useEffect(() => {
    if (allowed) void loadFunnel();
  }, [allowed, loadFunnel]);
  useEffect(() => {
    if (allowed) void loadRecovery();
  }, [allowed, loadRecovery]);
  useEffect(() => {
    if (allowed) void loadConfig();
  }, [allowed, loadConfig]);

  // Gating camada 1: rota não revelada a quem não tem RASTREAMENTO_VIEW.
  if (!allowed) return <Stealth404 />;

  const onSelectUser = async (row: AtRiskRow) => {
    setSelected({ row, timeline: null, loading: true });
    const bundle = await getTimeline(row.user_id);
    setSelected({ row, timeline: bundle, loading: false });
  };

  const onMarkContacted = async (row: AtRiskRow) => {
    try {
      const res = await markContacted(row.user_id, new Date(row.last_activity_at).toISOString());
      flash('skipped' in res ? 'Este usuário já estava contatado.' : 'Marcado como contatado.');
      void loadList();
      void loadRecovery();
    } catch (e) {
      flash((e as Error)?.message ?? 'Não foi possível concluir.');
    }
  };

  const onTriggerRecovery = async (row: AtRiskRow) => {
    try {
      const res = await triggerRecovery(row.user_id, { kind: 'RISK' });
      flash('skipped' in res ? `Recuperação suprimida (${res.reason}).` : 'Recuperação acionada.');
      void loadList();
      void loadRecovery();
    } catch (e) {
      flash((e as Error)?.message ?? 'Não foi possível concluir.');
    }
  };

  const onCopyPhone = (row: AtRiskRow) => {
    void navigator.clipboard?.writeText(row.phone_masked);
    flash('Telefone copiado.');
  };

  const onCopyMessage = (row: AtRiskRow) => {
    const scenario = CATEGORY_SCENARIO[row.risk_category] ?? 'USER_INACTIVE';
    void navigator.clipboard?.writeText(DEFAULT_TEMPLATES[scenario]);
    flash('Mensagem copiada.');
  };

  const onOpenWhatsapp = (_row: AtRiskRow) => {
    navigate('/admin/whatsapp');
  };

  const onViewHistory = (row: AtRiskRow) => {
    navigate(`/admin/users/${row.user_id}`);
  };

  const onExportCsv = async () => {
    // Exporta o conjunto filtrado completo (paginando em lotes de 100, cap 10000).
    const all: AtRiskRow[] = [];
    for (let p = 0; p < 100 && all.length < 10000; p += 1) {
      const res = await listAtRisk(filter, p, 100);
      all.push(...res.rows);
      if (res.rows.length < 100 || all.length >= res.total) break;
    }
    // Reforça a ordenação determinística (espelho do servidor) antes de exportar.
    const { csv, filename } = exportAtRiskCsv(filterAndSortAtRisk(all, {}));
    triggerDownload(filename, csv);
  };

  const onSaveConfig = async (patch: AiConfigPatch, expectedUpdatedAt: string) => {
    await updateAiConfig(patch, expectedUpdatedAt);
    await loadConfig();
  };

  const onSaveKey = async (provider: AiProvider, rawKey: string) => {
    await setTrackingAiKey(provider, rawKey);
  };

  const recoveryRatePct = recovery ? `${Math.round(recovery.recovery_rate * 100)}%` : '—';

  return (
    <div className="space-y-4 p-3 sm:p-4">
      {/* Padrão compacto: sem <h1> grande (a sidebar identifica a aba). */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-200">Rastreamento Inteligente</div>
        <TrackingFilterPopover
          applied={filter}
          onApply={(next) => {
            setPage(0);
            setFilter(next);
          }}
        />
      </div>

      {/* KPIs compactos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiCard label="Usuários em risco" value={list.total} />
        <KpiCard label="Contatados" value={recovery?.counts.CONTACTED ?? 0} />
        <KpiCard label="Converteram" value={recovery?.counts.CONVERTED ?? 0} />
        <KpiCard label="Taxa de recuperação" value={recoveryRatePct} />
      </div>

      {/* Gráficos SVG (multi-coluna em ≥768px) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {funnel && (
          <ConversionFunnelChart
            bundle={funnel}
            onWindowChange={(w) => setFunnelWindow(w)}
            onRetry={() => void loadFunnel()}
          />
        )}
        {recovery && (
          <RecoveryPerformanceChart
            bundle={recovery}
            onWindowChange={(w) => setRecoveryWindow(w)}
            onRetry={() => void loadRecovery()}
          />
        )}
      </div>

      {/* Lista + jornada (multi-coluna em ≥768px) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <AtRiskTable
            rows={list.rows}
            total={list.total}
            page={page}
            pageSize={pageSize}
            canManage={canManage}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPage(0);
              setPageSize(s);
            }}
            onExportCsv={() => void onExportCsv()}
            onSelectUser={(row) => void onSelectUser(row)}
            onOpenWhatsapp={onOpenWhatsapp}
            onCopyPhone={onCopyPhone}
            onCopyMessage={onCopyMessage}
            onMarkContacted={(row) => void onMarkContacted(row)}
            onTriggerRecovery={(row) => void onTriggerRecovery(row)}
            onViewHistory={onViewHistory}
          />
        </div>
        <div className="space-y-3">
          {selected && (
            <UserJourneyTimeline
              userId={selected.row.user_id}
              userName={selected.row.name}
              events={selected.timeline?.events ?? []}
              currentStage={selected.timeline?.current_stage ?? 'VISITOR'}
              loading={selected.loading}
              error={selected.timeline?.errors.timeline}
              onRetry={() => void onSelectUser(selected.row)}
            />
          )}
          {canManage && config && (
            <TrackingAiConfigCard
              canManage={canManage}
              config={config}
              onSaveConfig={onSaveConfig}
              onSaveKey={onSaveKey}
            />
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-xs text-gray-100 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
