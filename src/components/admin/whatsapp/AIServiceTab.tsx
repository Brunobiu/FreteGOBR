/**
 * AIServiceTab (task 20.8, Req 14.5, 15.1, 26.2)
 *
 * Configuração de IA da Active_Instance: AI_Api_Key (gravada no Vault, só
 * indicador de presença), AI_Prompt (persona), Knowledge_Base e Handoff_Message,
 * via `ai.ts`. Indica se a chave está configurada e a PENDÊNCIA quando ausente
 * (resposta automática desabilitada — Req 14.5). Mutações exigem `SETTINGS_EDIT`.
 *
 * A chave nunca é exibida (write-only); o serviço só expõe `hasApiKey`.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  getAiConfig,
  saveAiConfig,
  setAiApiKey,
  type AiConfig,
} from '../../../services/admin/whatsapp/ai';

interface Props {
  instanceId: string;
}

export default function AIServiceTab({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [config, setConfig] = useState<AiConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [handoffMessage, setHandoffMessage] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAiConfig(instanceId)
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setEnabled(c.enabled);
        setAiPrompt(c.aiPrompt ?? '');
        setKnowledgeBase(c.knowledgeBase ?? '');
        setHandoffMessage(c.handoffMessage ?? '');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar a configuração.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useEffect(() => load(), [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await saveAiConfig(instanceId, {
        enabled,
        aiPrompt,
        knowledgeBase: knowledgeBase.length > 0 ? knowledgeBase : null,
        handoffMessage: handoffMessage.length > 0 ? handoffMessage : null,
        expectedUpdatedAt: config?.updatedAt ?? null,
      });
      setConfig(updated);
      setNotice('Configuração salva.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível salvar.';
      setError(message === 'STALE_VERSION' ? 'Outro admin atualizou. Recarregue a página.' : message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveKey = async () => {
    setSavingKey(true);
    setError(null);
    setNotice(null);
    try {
      await setAiApiKey(instanceId, apiKeyInput);
      setApiKeyInput('');
      setNotice('Chave de API salva.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a chave.');
    } finally {
      setSavingKey(false);
    }
  };

  const hasApiKey = config?.hasApiKey ?? false;

  return (
    <div className="space-y-4">
      {/* Status da chave (Req 14.5) */}
      <div
        className={`rounded-lg border p-3 text-xs ${
          hasApiKey
            ? 'border-green-900/40 bg-green-500/10 text-green-300'
            : 'border-yellow-900/40 bg-yellow-500/10 text-yellow-300'
        }`}
      >
        {hasApiKey
          ? 'Chave de API configurada — a resposta automática pode operar.'
          : 'Chave de API não configurada — a resposta automática está desabilitada.'}
      </div>

      {error && (
        <div className="rounded border border-red-900/40 bg-red-500/10 px-2 py-1 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-green-900/40 bg-green-500/10 px-2 py-1 text-[11px] text-green-300">
          {notice}
        </div>
      )}

      {/* Chave de API (write-only) */}
      {canEdit && (
        <section className="space-y-1.5">
          <label className="block text-[10px] uppercase tracking-wider text-gray-500">
            {hasApiKey ? 'Substituir chave de API' : 'Definir chave de API'}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Cole a chave do provedor de IA"
              autoComplete="off"
              className="flex-1 rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSaveKey()}
              disabled={savingKey || apiKeyInput.trim().length === 0}
              className="rounded bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {savingKey ? 'Salvando...' : 'Salvar chave'}
            </button>
          </div>
        </section>
      )}

      {/* Configuração de IA */}
      <fieldset disabled={!canEdit || loading} className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-gray-600 bg-gray-700"
          />
          Resposta automática habilitada
        </label>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
            Prompt (persona da IA)
          </label>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={4}
            placeholder="Descreva como a IA deve atender..."
            className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
            Base de conhecimento (opcional)
          </label>
          <textarea
            value={knowledgeBase}
            onChange={(e) => setKnowledgeBase(e.target.value)}
            rows={5}
            placeholder="Informações de referência que a IA pode usar..."
            className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
            Mensagem de transferência (handoff)
          </label>
          <input
            type="text"
            value={handoffMessage}
            onChange={(e) => setHandoffMessage(e.target.value)}
            placeholder="Ex.: Vou te transferir para um atendente."
            className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
          />
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar configuração'}
          </button>
        )}
      </fieldset>
    </div>
  );
}
