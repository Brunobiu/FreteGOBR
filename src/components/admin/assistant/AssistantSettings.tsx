/**
 * AssistantSettings.tsx
 *
 * Secao de Configuracoes do modulo Assistente. Permite ao Master_Admin com
 * ASSISTANT_EDIT: escolher o Active_Provider, gerenciar a chave de API de
 * cada provedor (exibindo apenas is_set + mascara — nunca o valor bruto),
 * ajustar os Critical_Threshold, o intervalo do Cron_Job e o WhatsApp_Toggle.
 * Exibe ainda o LGPD_Notice.
 *
 * Gating em duas camadas (Req 7.8): sem ASSISTANT_EDIT a UI renderiza tudo em
 * modo somente-leitura e OCULTA o botao Salvar e os controles de edicao de
 * segredo/toggle. O servidor (RPC SECURITY DEFINER) e a fonte de verdade.
 *
 * Requisitos: 7.1, 7.2, 7.3, 7.8, 7.9, 10.4, 13.1, 13.2, 13.5, 16.1, 16.4.
 *
 * - Chave de API: nunca recebe nem exibe o valor bruto; apenas is_set+mascara
 *   (Req 7.3/7.4). Controles "Substituir"/"Remover" gravam/limpam via Vault.
 * - WhatsApp_Toggle: entregue inativo; exibe aviso de canal inativo (Req 13.2).
 * - Acessibilidade: todos os controles rotulados (Req 16.1); erros com
 *   role="alert" (Req 16.4).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  clearProviderKey,
  getConfig,
  setProviderKey,
  updateConfig,
  type AiProvider,
  type AssistantConfigView,
  type AssistantThresholds,
  type ConfigPatch,
} from '../../../services/admin/assistant';

/** Provedores no dominio fechado (Req 7.1) com rotulos pt-BR. */
const PROVIDERS: ReadonlyArray<{ value: AiProvider; label: string; functional: boolean }> = [
  { value: 'claude', label: 'Claude (Anthropic)', functional: true },
  { value: 'gemini', label: 'Gemini (Google)', functional: true },
  { value: 'openai', label: 'OpenAI (GPT)', functional: true },
  { value: 'grok', label: 'Grok (xAI)', functional: false },
  { value: 'llama', label: 'Llama (Meta)', functional: false },
];

/** Rotulos pt-BR dos thresholds configuraveis. */
const THRESHOLD_LABELS: Record<keyof AssistantThresholds, string> = {
  page_error_rate: 'Taxa de erros de página',
  request_failure_rate: 'Taxa de falhas de requisição',
  failed_login_burst: 'Rajada de falhas de login (por IP)',
};

const THRESHOLD_KEYS: ReadonlyArray<keyof AssistantThresholds> = [
  'page_error_rate',
  'request_failure_rate',
  'failed_login_burst',
];

export default function AssistantSettings() {
  const { allowed: canEdit } = useAdminPermission('ASSISTANT_EDIT');

  const [config, setConfig] = useState<AssistantConfigView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  // Estado editavel (espelha o config carregado; aplicado no Salvar).
  const [activeProvider, setActiveProvider] = useState<AiProvider>('claude');
  const [thresholds, setThresholds] = useState<AssistantThresholds>({
    page_error_rate: 1,
    request_failure_rate: 1,
    failed_login_burst: 1,
  });
  const [cronInterval, setCronInterval] = useState(1);
  const [whatsappToggle, setWhatsappToggle] = useState(false);

  // Edicao de chave por provedor (campo de texto bruto, enviado ao Vault).
  const [keyDraftProvider, setKeyDraftProvider] = useState<AiProvider | null>(null);
  const [keyDraftValue, setKeyDraftValue] = useState('');

  const hydrate = useCallback((cfg: AssistantConfigView) => {
    setConfig(cfg);
    setActiveProvider(cfg.activeProvider);
    setThresholds(cfg.thresholds);
    setCronInterval(cfg.cronIntervalMinutes);
    setWhatsappToggle(cfg.whatsappToggle);
  }, []);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const cfg = await getConfig();
      hydrate(cfg);
    } catch {
      setLoadError(true);
      setConfig(null);
    }
  }, [hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!config || saving) return;
    setSaving(true);
    setFeedback(null);

    const patch: ConfigPatch = {
      activeProvider,
      thresholds,
      cronIntervalMinutes: cronInterval,
      whatsappToggle,
    };

    const result = await updateConfig(patch, config.updatedAt);
    if (result.ok) {
      setFeedback({ kind: 'ok', message: 'Configurações salvas.' });
      await load();
    } else {
      const messages: Record<string, string> = {
        STALE_VERSION: 'Outro administrador atualizou as configurações. Recarregando.',
        INVALID_THRESHOLD: 'Os limites devem ser inteiros maiores ou iguais a 1.',
        INVALID_CRON_INTERVAL: 'O intervalo do monitor deve ser de 1 a 5 minutos.',
        PERMISSION_DENIED: 'Você não tem permissão para alterar as configurações.',
        UNKNOWN: 'Não foi possível salvar as configurações.',
      };
      setFeedback({ kind: 'error', message: messages[result.code] ?? messages.UNKNOWN });
      if (result.code === 'STALE_VERSION') await load();
    }
    setSaving(false);
  }, [config, saving, activeProvider, thresholds, cronInterval, whatsappToggle, load]);

  const handleSaveKey = useCallback(
    async (provider: AiProvider) => {
      const raw = keyDraftValue.trim();
      if (raw.length === 0) return;
      setFeedback(null);
      try {
        await setProviderKey(provider, raw);
        setKeyDraftProvider(null);
        setKeyDraftValue('');
        setFeedback({ kind: 'ok', message: 'Chave de API salva com segurança.' });
        await load();
      } catch {
        setFeedback({ kind: 'error', message: 'Não foi possível salvar a chave de API.' });
      }
    },
    [keyDraftValue, load]
  );

  const handleClearKey = useCallback(
    async (provider: AiProvider) => {
      setFeedback(null);
      try {
        await clearProviderKey(provider);
        setFeedback({ kind: 'ok', message: 'Chave de API removida.' });
        await load();
      } catch {
        setFeedback({ kind: 'error', message: 'Não foi possível remover a chave de API.' });
      }
    },
    [load]
  );

  if (loadError) {
    return (
      <section
        data-block="assistant_settings"
        aria-label="Configurações do assistente"
        className="rounded-lg border border-gray-800 bg-gray-900 p-3"
      >
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Configurações</h3>
        <div role="alert" className="text-xs text-red-300 py-2">
          Não foi possível carregar as configurações.
        </div>
      </section>
    );
  }

  if (!config) {
    return (
      <section
        data-block="assistant_settings"
        aria-label="Configurações do assistente"
        className="rounded-lg border border-gray-800 bg-gray-900 p-3"
      >
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Configurações</h3>
        <div role="status" className="text-xs text-gray-500 py-2">
          Carregando configurações…
        </div>
      </section>
    );
  }

  const inputCls =
    'rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-60';

  return (
    <section
      data-block="assistant_settings"
      aria-label="Configurações do assistente"
      className="rounded-lg border border-gray-800 bg-gray-900 p-3 space-y-4"
    >
      <h3 className="text-xs font-semibold text-gray-300">Configurações</h3>

      {feedback && (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`rounded border px-2.5 py-1.5 text-[11px] ${
            feedback.kind === 'error'
              ? 'border-red-500/30 bg-red-500/10 text-red-300'
              : 'border-green-500/30 bg-green-500/10 text-green-300'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Active_Provider (Req 7.1) */}
      <div className="space-y-1">
        <label
          htmlFor="assistant-provider"
          className="block text-[10px] uppercase tracking-wider text-gray-500"
        >
          Provedor de IA ativo
        </label>
        <select
          id="assistant-provider"
          value={activeProvider}
          disabled={!canEdit}
          onChange={(e) => setActiveProvider(e.target.value as AiProvider)}
          className={inputCls}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
              {p.functional ? '' : ' — em breve'}
            </option>
          ))}
        </select>
      </div>

      {/* Chaves de API por provedor — apenas is_set + mascara (Req 7.3, 7.4) */}
      <div className="space-y-2">
        <span className="block text-[10px] uppercase tracking-wider text-gray-500">
          Chaves de API
        </span>
        <ul className="space-y-1.5">
          {PROVIDERS.map((p) => {
            const state = config.providerKeys[p.value] ?? { isSet: false, mask: '' };
            const editingThis = keyDraftProvider === p.value;
            return (
              <li
                key={p.value}
                className="rounded border border-gray-800 bg-gray-950/60 px-2 py-1.5"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-300 flex-1 min-w-0 truncate">{p.label}</span>
                  {state.isSet ? (
                    <span
                      className="text-[11px] text-gray-400 font-mono"
                      aria-label="Chave configurada (mascarada)"
                    >
                      {state.mask}
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/40 text-gray-400">
                      Não configurada
                    </span>
                  )}
                  {canEdit && !editingThis && (
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setKeyDraftProvider(p.value);
                          setKeyDraftValue('');
                        }}
                        className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
                      >
                        {state.isSet ? 'Substituir' : 'Configurar'}
                      </button>
                      {state.isSet && (
                        <button
                          type="button"
                          onClick={() => void handleClearKey(p.value)}
                          className="text-xs px-2.5 py-1 rounded bg-red-500/20 text-red-200 hover:bg-red-500/30"
                        >
                          Remover
                        </button>
                      )}
                    </span>
                  )}
                </div>

                {canEdit && editingThis && (
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <label htmlFor={`assistant-key-${p.value}`} className="sr-only">
                      Nova chave de API para {p.label}
                    </label>
                    <input
                      id={`assistant-key-${p.value}`}
                      type="password"
                      autoComplete="off"
                      value={keyDraftValue}
                      onChange={(e) => setKeyDraftValue(e.target.value)}
                      placeholder="Cole a chave de API"
                      className={`${inputCls} flex-1 min-w-[12rem] font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveKey(p.value)}
                      disabled={keyDraftValue.trim().length === 0}
                      className="text-xs px-2.5 py-1 rounded bg-green-500/20 text-green-200 hover:bg-green-500/30 disabled:opacity-50"
                    >
                      Salvar chave
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setKeyDraftProvider(null);
                        setKeyDraftValue('');
                      }}
                      className="text-xs px-2.5 py-1 rounded bg-gray-700/40 text-gray-300 hover:bg-gray-700/60"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Critical_Threshold (Req 10.4) */}
      <div className="space-y-2">
        <span className="block text-[10px] uppercase tracking-wider text-gray-500">
          Limites de eventos críticos
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {THRESHOLD_KEYS.map((key) => (
            <div key={key} className="space-y-1">
              <label
                htmlFor={`assistant-threshold-${key}`}
                className="block text-[11px] text-gray-400"
              >
                {THRESHOLD_LABELS[key]}
              </label>
              <input
                id={`assistant-threshold-${key}`}
                type="number"
                min={1}
                step={1}
                value={thresholds[key]}
                disabled={!canEdit}
                onChange={(e) =>
                  setThresholds((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                }
                className={`${inputCls} w-full`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Intervalo do Cron_Job (Req 10.6) */}
      <div className="space-y-1">
        <label
          htmlFor="assistant-cron"
          className="block text-[10px] uppercase tracking-wider text-gray-500"
        >
          Intervalo do monitor (minutos, 1–5)
        </label>
        <input
          id="assistant-cron"
          type="number"
          min={1}
          max={5}
          step={1}
          value={cronInterval}
          disabled={!canEdit}
          onChange={(e) => setCronInterval(Number(e.target.value))}
          className={`${inputCls} w-24`}
        />
      </div>

      {/* WhatsApp_Toggle (Req 13.1, 13.2) */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <input
            id="assistant-whatsapp"
            type="checkbox"
            checked={whatsappToggle}
            disabled={!canEdit}
            onChange={(e) => setWhatsappToggle(e.target.checked)}
            className="h-4 w-4 rounded border-gray-700 bg-gray-950 text-cyan-500 focus:ring-cyan-500/50"
          />
          <label htmlFor="assistant-whatsapp" className="text-xs text-gray-300">
            Alertas por WhatsApp
          </label>
        </div>
        <p className="text-[11px] text-amber-300">
          Canal de WhatsApp inativo nesta versão: nenhum envio real ocorre, mesmo com a opção
          ligada.
        </p>
      </div>

      {/* LGPD_Notice (Req 7.9) */}
      <div
        aria-label="Aviso de privacidade"
        className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200 leading-snug"
      >
        <strong className="font-semibold">Aviso de privacidade (LGPD):</strong> dados reais da
        plataforma, incluindo dados pessoais (PII) e de pagamento, são enviados sem mascaramento a
        um provedor de IA externo, por decisão consciente do dono do sistema, para que o assistente
        responda com precisão. As chaves de API permanecem criptografadas no servidor e nunca são
        expostas a este painel.
      </div>

      {/* Salvar — oculto sem ASSISTANT_EDIT (Req 7.8) */}
      {canEdit ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-gray-500">
          Visualização somente leitura. Você não tem permissão para alterar estas configurações.
        </p>
      )}
    </section>
  );
}
