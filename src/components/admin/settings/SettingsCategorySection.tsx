/**
 * SettingsCategorySection — renderiza uma categoria de configurações com
 * título identificável e os campos (SettingField / SecretField).
 *
 * Avisos informativos:
 *   - integrations: Evolution API ainda não ativa (valores só armazenados).
 *   - ai: configurações serão detalhadas em entrega futura (estado vazio OK).
 *
 * Integra skeleton (carregando) e error (falha isolada da categoria).
 * Spec finalizacao-lancamento.
 */

import type {
  SettingCategory,
  SettingRecord,
  SettingValue,
} from '../../../services/admin/settings';
import SettingField from './SettingField';
import SecretField from './SecretField';
import SettingsBlockSkeleton from './SettingsBlockSkeleton';
import SettingsBlockError from './SettingsBlockError';

const CATEGORY_LABELS: Record<SettingCategory, string> = {
  integrations: 'Integrações',
  trial: 'Trial',
  plans: 'Planos',
  ai: 'IA',
  general: 'Geral',
};

const CATEGORY_NOTICES: Partial<Record<SettingCategory, string>> = {
  integrations:
    'A integração Evolution API ainda não está ativa. Os valores são apenas armazenados para uso futuro.',
  ai: 'As configurações de IA serão detalhadas em uma entrega futura.',
};

interface SettingsCategorySectionProps {
  category: SettingCategory;
  records: SettingRecord[];
  canEdit: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry: () => void;
  onSave: (
    key: string,
    value: Exclude<SettingValue, null>,
    expectedUpdatedAt: string
  ) => Promise<void>;
  onSetSecret: (key: string, secret: string, expectedUpdatedAt: string) => Promise<void>;
  onClearSecret: (key: string, expectedUpdatedAt: string) => Promise<void>;
}

export default function SettingsCategorySection({
  category,
  records,
  canEdit,
  loading = false,
  error = null,
  onRetry,
  onSave,
  onSetSecret,
  onClearSecret,
}: SettingsCategorySectionProps) {
  const notice = CATEGORY_NOTICES[category];

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-800">{CATEGORY_LABELS[category]}</h2>

      {notice && (
        <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
          {notice}
        </p>
      )}

      {loading ? (
        <SettingsBlockSkeleton />
      ) : error ? (
        <SettingsBlockError message={error} onRetry={onRetry} />
      ) : records.length === 0 ? (
        <p className="text-xs text-gray-400 italic py-2">Nenhuma configuração nesta seção.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded p-4 space-y-4">
          {records.map((rec) =>
            rec.valueType === 'secret' ? (
              <SecretField
                key={rec.key}
                record={rec}
                canEdit={canEdit}
                onSetSecret={(secret, uat) => onSetSecret(rec.key, secret, uat)}
                onClearSecret={(uat) => onClearSecret(rec.key, uat)}
              />
            ) : (
              <SettingField
                key={rec.key}
                record={rec}
                canEdit={canEdit}
                onSave={(value, uat) => onSave(rec.key, value, uat)}
              />
            )
          )}
        </div>
      )}
    </section>
  );
}
