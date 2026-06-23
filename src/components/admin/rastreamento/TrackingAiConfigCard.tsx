/**
 * TrackingAiConfigCard — configuração da personalização por IA da aba.
 *
 * GATED por `RASTREAMENTO_MANAGE` (`canManage`): oculto por completo em
 * somente-leitura (Req 12.7). Seleciona o `Active_Provider` (reusa a
 * Provider_Abstraction do admin-assistant) e registra a `AI_Api_Key` (somente no
 * Vault — NUNCA exibida/retornada). Validação no frontend bloqueia envio inválido
 * com mensagem pt-BR (a RPC revalida no backend, autoridade). `STALE_VERSION` ⇒
 * mensagem de recarregar.
 *
 * _Requirements: 12.1, 12.3, 12.4, 12.5, 12.7_
 */

import { useEffect, useState } from 'react';
import { AI_PROVIDERS, type AiProvider } from '../../../services/admin/rastreamento/domain';
import {
  validateAiConfigPatch,
  type AiConfigPatch,
  type TrackingConfigView,
} from '../../../services/admin/rastreamento';

interface Props {
  canManage: boolean;
  config: TrackingConfigView;
  onSaveConfig: (patch: AiConfigPatch, expectedUpdatedAt: string) => Promise<void>;
  onSaveKey: (provider: AiProvider, rawKey: string) => Promise<void>;
}

export default function TrackingAiConfigCard({ canManage, config, onSaveConfig, onSaveKey }: Props) {
  const [provider, setProvider] = useState<AiProvider>(config.active_provider);
  const [enabled, setEnabled] = useState(config.personalization_enabled);
  const [inactivity, setInactivity] = useState<string>(String(config.inactivity_days));
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProvider(config.active_provider);
    setEnabled(config.personalization_enabled);
    setInactivity(String(config.inactivity_days));
  }, [config]);

  // Somente-leitura: card OCULTADO por completo (Req 12.7).
  if (!canManage) return null;

  const handleSaveConfig = async () => {
    setError(null);
    setFeedback(null);
    const patch: AiConfigPatch = {
      active_provider: provider,
      personalization_enabled: enabled,
      inactivity_days: Number(inactivity),
    };
    // Validação no frontend (bloqueia envio inválido com mensagem pt-BR).
    const validationError = validateAiConfigPatch(patch);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    try {
      await onSaveConfig(patch, config.updated_at);
      setFeedback('Configuração salva.');
    } catch (e) {
      setError((e as Error)?.message ?? 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveKey = async () => {
    setError(null);
    setFeedback(null);
    if (apiKey.trim().length === 0) {
      setError('Informe a chave de IA.');
      return;
    }
    setBusy(true);
    try {
      await onSaveKey(provider, apiKey.trim());
      setApiKey(''); // nunca mantém a chave no estado após salvar
      setFeedback('Chave registrada com segurança.');
    } catch (e) {
      setError((e as Error)?.message ?? 'Não foi possível registrar a chave.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-3 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        Personalização por IA
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Provedor
          </label>
          <select
            aria-label="Provedor de IA"
            value={provider}
            onChange={(e) => setProvider(e.target.value as AiProvider)}
            className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Dias de inatividade
          </label>
          <input
            type="number"
            min={1}
            aria-label="Dias de inatividade"
            value={inactivity}
            onChange={(e) => setInactivity(e.target.value)}
            className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500"
        />
        Personalização habilitada
      </label>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
          Chave de IA (armazenada no cofre, nunca exibida)
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            aria-label="Chave de IA"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="••••••••"
            className="flex-1 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSaveKey()}
            className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40"
          >
            Registrar chave
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="text-xs text-red-300">
          {error}
        </div>
      )}
      {feedback && <div className="text-xs text-emerald-300">{feedback}</div>}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSaveConfig()}
          className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40"
        >
          Salvar configuração
        </button>
      </div>
    </section>
  );
}
