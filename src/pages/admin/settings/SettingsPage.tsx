/**
 * SettingsPage — /admin/settings (módulo Configurações).
 *
 * Gating: SETTINGS_VIEW negado ⇒ Stealth_404. canEdit por SETTINGS_EDIT
 * controla a visibilidade dos controles de edição.
 *
 * Sem <h1> grande (Compact_Layout_Pattern). 5 seções (Integrações, Trial,
 * Planos, IA, Geral) em coluna única <768px. Toasts canônicos: sucesso
 * "Configuração salva." (status); STALE_VERSION "Outro admin atualizou.
 * Recarregando." + refetch; erro (alert).
 *
 * Spec finalizacao-lancamento.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import SettingsCategorySection from '../../../components/admin/settings/SettingsCategorySection';
import SettingsBlockSkeleton from '../../../components/admin/settings/SettingsBlockSkeleton';
import {
  getSettings,
  updateSetting,
  setSecret,
  clearSecret,
  SettingsServiceError,
  SETTING_CATEGORIES,
  type SettingsByCategory,
  type SettingValue,
} from '../../../services/admin/settings';

type Toast = { kind: 'success' | 'error'; msg: string } | null;

const EMPTY: SettingsByCategory = {
  integrations: [],
  trial: [],
  plans: [],
  ai: [],
  general: [],
};

export default function SettingsPage() {
  const { allowed: canView } = useAdminPermission('SETTINGS_VIEW');
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [data, setData] = useState<SettingsByCategory>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (t) setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getSettings();
      setData(result);
    } catch (err) {
      const msg =
        err instanceof SettingsServiceError
          ? err.message
          : 'Não foi possível carregar as configurações.';
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    void load();
  }, [canView, load]);

  // Tratamento comum de erro de mutação: STALE_VERSION recarrega.
  const handleMutationError = useCallback(
    (err: unknown) => {
      if (err instanceof SettingsServiceError && err.code === 'STALE_VERSION') {
        showToast({ kind: 'error', msg: 'Outro admin atualizou. Recarregando.' });
        void load();
        return;
      }
      const msg =
        err instanceof SettingsServiceError ? err.message : 'Não foi possível concluir a operação.';
      showToast({ kind: 'error', msg });
    },
    [load, showToast]
  );

  const onSave = useCallback(
    async (key: string, value: Exclude<SettingValue, null>, expectedUpdatedAt: string) => {
      try {
        await updateSetting({ key, value, expectedUpdatedAt });
        showToast({ kind: 'success', msg: 'Configuração salva.' });
        await load();
      } catch (err) {
        handleMutationError(err);
      }
    },
    [handleMutationError, load, showToast]
  );

  const onSetSecret = useCallback(
    async (key: string, secret: string, expectedUpdatedAt: string) => {
      try {
        await setSecret({ key, secret, expectedUpdatedAt });
        showToast({ kind: 'success', msg: 'Configuração salva.' });
        await load();
      } catch (err) {
        handleMutationError(err);
      }
    },
    [handleMutationError, load, showToast]
  );

  const onClearSecret = useCallback(
    async (key: string, expectedUpdatedAt: string) => {
      try {
        const r = await clearSecret({ key, expectedUpdatedAt });
        if ('skipped' in r) {
          showToast({ kind: 'success', msg: 'Este segredo já estava removido.' });
        } else {
          showToast({ kind: 'success', msg: 'Configuração salva.' });
        }
        await load();
      } catch (err) {
        handleMutationError(err);
      }
    },
    [handleMutationError, load, showToast]
  );

  if (!canView) return <Stealth404 />;

  return (
    <div className="p-3 sm:p-5 max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Configurações da plataforma</span>
        {!canEdit && (
          <span className="text-[10px] uppercase tracking-wider text-gray-400">
            Somente leitura
          </span>
        )}
      </div>

      {toast && (
        <div
          role={toast.kind === 'success' ? 'status' : 'alert'}
          className={
            toast.kind === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700 text-sm rounded p-3'
              : 'bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3'
          }
        >
          {toast.msg}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <SettingsBlockSkeleton />
          <SettingsBlockSkeleton />
        </div>
      ) : (
        SETTING_CATEGORIES.map((cat) => (
          <SettingsCategorySection
            key={cat}
            category={cat}
            records={data[cat]}
            canEdit={canEdit}
            error={loadError}
            onRetry={load}
            onSave={onSave}
            onSetSecret={onSetSecret}
            onClearSecret={onClearSecret}
          />
        ))
      )}
    </div>
  );
}
