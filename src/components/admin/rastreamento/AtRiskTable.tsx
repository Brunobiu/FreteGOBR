/**
 * AtRiskTable — lista de usuários em risco (At_Risk_List) no padrão compacto.
 *
 * Exibe por linha: identificação, Risk_Score + Risk_Band (pt-BR), Abandonment_Cause
 * (coluna "CAUSA PROVÁVEL DA PERDA"), Contact_Status e ações de recuperação
 * (gated `RASTREAMENTO_MANAGE`). Paginação `10/50/100` (default 10). Em `<768px`
 * a tabela vira lista de cards single-column. Estado vazio
 * `Nenhum usuário encontrado.`. Exportação CSV no padrão herdado.
 *
 * _Requirements: 1.7, 1.8, 6.8, 7.2, 7.6, 7.10, 7.11_
 */

import type { AtRiskRow } from '../../../services/admin/rastreamento/atRiskList';
import { RISK_BAND_LABELS } from '../../../services/admin/rastreamento/riskScore';
import { PAGE_SIZES, type PageSize } from '../../../services/admin/rastreamento/domain';
import {
  ABANDONMENT_CAUSE_LABELS,
  CONTACT_STATUS_LABELS,
  RISK_BAND_BADGE,
  RISK_CATEGORY_LABELS,
} from './labels';
import RecoveryActionsMenu from './RecoveryActionsMenu';

interface Props {
  rows: AtRiskRow[];
  total: number;
  page: number;
  pageSize: PageSize;
  canManage: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  onExportCsv: () => void;
  onSelectUser: (row: AtRiskRow) => void;
  onOpenWhatsapp: (row: AtRiskRow) => void;
  onCopyPhone: (row: AtRiskRow) => void;
  onCopyMessage: (row: AtRiskRow) => void;
  onMarkContacted: (row: AtRiskRow) => void;
  onTriggerRecovery: (row: AtRiskRow) => void;
  onViewHistory: (row: AtRiskRow) => void;
}

function RiskBadge({ band }: { band: AtRiskRow['risk_band'] }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${RISK_BAND_BADGE[band] ?? ''}`}>
      {RISK_BAND_LABELS[band]}
    </span>
  );
}

export default function AtRiskTable(props: Props) {
  const { rows, total, page, pageSize, canManage } = props;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-center text-sm text-gray-400">
        Nenhum usuário encontrado.
      </div>
    );
  }

  const actions = (row: AtRiskRow) => (
    <RecoveryActionsMenu
      canManage={canManage}
      row={row}
      onOpenWhatsapp={props.onOpenWhatsapp}
      onCopyPhone={props.onCopyPhone}
      onCopyMessage={props.onCopyMessage}
      onMarkContacted={props.onMarkContacted}
      onTriggerRecovery={props.onTriggerRecovery}
      onViewHistory={props.onViewHistory}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={props.onExportCsv}
          className="text-xs px-2.5 py-1 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
        >
          Exportar CSV
        </button>
      </div>

      {/* Desktop: tabela (≥768px) */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-900/60">
              <th className="text-left px-3 py-2">Usuário</th>
              <th className="text-left px-3 py-2">Score</th>
              <th className="text-left px-3 py-2">Causa provável da perda</th>
              <th className="text-left px-3 py-2">Categoria</th>
              <th className="text-left px-3 py-2">Contato</th>
              <th className="text-right px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user_id} className="border-t border-gray-800 hover:bg-gray-800/40">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => props.onSelectUser(row)}
                    className="text-left text-cyan-300 hover:underline"
                  >
                    {row.name || '—'}
                  </button>
                  <div className="text-[11px] text-gray-500">{row.phone_masked}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-100 font-semibold">{row.risk_score}</span>
                    <RiskBadge band={row.risk_band} />
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-300">
                  {ABANDONMENT_CAUSE_LABELS[row.abandonment_cause]}
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {RISK_CATEGORY_LABELS[row.risk_category]}
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {CONTACT_STATUS_LABELS[row.contact_status]}
                </td>
                <td className="px-3 py-2 text-right">{actions(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: lista de cards single-column (<768px) */}
      <ul className="md:hidden space-y-2">
        {rows.map((row) => (
          <li key={row.user_id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => props.onSelectUser(row)}
                className="text-left text-cyan-300 hover:underline font-medium"
              >
                {row.name || '—'}
              </button>
              <RiskBadge band={row.risk_band} />
            </div>
            <div className="text-[11px] text-gray-500">{row.phone_masked}</div>
            <div className="mt-1 text-xs text-gray-300">
              Score <span className="font-semibold">{row.risk_score}</span> ·{' '}
              {ABANDONMENT_CAUSE_LABELS[row.abandonment_cause]}
            </div>
            <div className="text-[11px] text-gray-500">
              {RISK_CATEGORY_LABELS[row.risk_category]} ·{' '}
              {CONTACT_STATUS_LABELS[row.contact_status]}
            </div>
            <div className="mt-2 flex justify-end">{actions(row)}</div>
          </li>
        ))}
      </ul>

      {/* Paginação 10/50/100 (default 10) */}
      <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <span>Por página</span>
          <select
            aria-label="Itens por página"
            value={pageSize}
            onChange={(e) => props.onPageSizeChange(Number(e.target.value) as PageSize)}
            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-100"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => props.onPageChange(page - 1)}
            className="px-2 py-1 rounded border border-gray-700 bg-gray-800 disabled:opacity-40"
          >
            Anterior
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page + 1 >= totalPages}
            onClick={() => props.onPageChange(page + 1)}
            className="px-2 py-1 rounded border border-gray-700 bg-gray-800 disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
