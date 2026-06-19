/**
 * SupportAiConfigPanel — configuração da Support_AI (gated SUPORTE_AI_CONFIG).
 *
 * Habilita/desabilita a IA, ajusta confidence_threshold (0..1) e o modelo.
 * Validação frontend de confidence_threshold ∈ [0,1] espelha o backend.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { getAiConfig, updateAiConfig, SuporteError, type SupportAiConfig } from '../../../services/admin/suporte';
import { isValidConfidenceThreshold } from '../../../services/admin/suporte/validation';
import DashboardBlockError from '../dashboard/DashboardBlockError';

export default function SupportAiConfigPanel() {
  const { allowed: canEdit } = useAdminPermission('SUPORTE_AI_CONFIG');
  const [cfg, setCfg] = useState<SupportAiConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ enabled: boolean; threshold: string; model: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getAiConfig()
      .then((c) => {
        setCfg(c);
        if (c) setDraft({ enabled: c.enabled, threshold: String(c.confidenceThreshold), model: c.supportModel });
      })
      .catch((err) => setError(err instanceof SuporteError ? err.message : 'Erro ao carregar a config.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function save() {
    if (!cfg || !draft) return;
    const threshold = Number(draft.threshold);
    if (!isValidConfidenceThreshold(threshold)) {
      setFormError('O limiar de confiança deve ser um número entre 0 e 1.');
      return;
    }
    if (draft.model.trim().length === 0) {
      setFormError('Informe o modelo da IA.');
      return;
    }
    setFormError(null);
    try {
      await updateAiConfig(
        { enabled: draft.enabled, confidenceThreshold: threshold, supportModel: draft.model.trim() },
        cfg.updatedAt
      );
      setNotice('Configuração salva.');
      load();
    } catch (err) {
      if (err instanceof SuporteError && err.code === 'STALE_VERSION') {
        setNotice('Outro admin atualizou. Recarregando.');
        load();
        return;
      }
      setFormError(err instanceof SuporteError ? err.message : 'Não foi possível salvar.');
    }
  }

  if (error) return <DashboardBlockError message={error} onRetry={load} />;
  if (loading || !draft) return <div className="text-center text-gray-500 text-sm py-6">Carregando configuração...</div>;

  return (
    <div className="max-w-lg space-y-3 rounded-lg border border-gray-800 bg-gray-900 p-4">
      {notice && (
        <div className="text-[11px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded px-2 py-1">
          {notice}
        </div>
      )}

      <label className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-200">IA de atendimento habilitada</span>
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          className="h-4 w-4 accent-cyan-500"
        />
      </label>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
          Limiar de confiança (0 a 1): {draft.threshold}
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={draft.threshold}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, threshold: e.target.value })}
          className="w-full accent-cyan-500"
        />
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Modelo da IA</label>
        <input
          value={draft.model}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100 disabled:opacity-60"
        />
      </div>

      {formError && (
        <div className="text-[11px] text-red-400" role="alert">
          {formError}
        </div>
      )}

      {canEdit ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700"
          >
            Salvar configuração
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-gray-500">Somente leitura: você não tem permissão para editar a IA.</p>
      )}
    </div>
  );
}
