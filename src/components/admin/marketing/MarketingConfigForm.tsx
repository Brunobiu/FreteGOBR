/**
 * MarketingConfigForm - formulário de configuração da integração Meta
 * (/admin/marketing/configuracoes), módulo admin-marketing (048).
 *
 * Componente AUTOSSUFICIENTE: lê a configuração vigente via `getConfig()` e
 * salva diretamente pelos wrappers de service `updateConfig`/`setToken`/
 * `clearToken` (src/services/admin/marketing.ts). NUNCA chama RPCs do Supabase
 * direto — toda a I/O passa pelos wrappers (audit-by-construction + mapeamento
 * de erro canônico já vivem lá).
 *
 * Campos renderizados (Req 3.1):
 *   - Access Token (segredo, Masked_Token): mostra apenas `token_is_set` + os
 *     últimos 4 chars (`token_last4`). O valor bruto NUNCA chega ao frontend
 *     (CP-7) — o input (mascarado, type=password) serve só para DEFINIR um novo
 *     token, jamais para exibir o atual.
 *   - Ad Account ID (`act_<digits>`), Pixel ID (somente dígitos).
 *   - Período default (domínio fechado MetricPeriod: today/7d/30d, inicial 7d
 *     — Req 3.12).
 *   - Toggle "Exigir consentimento" (LGPD).
 *
 * Comportamento:
 *   - Validação inline de Ad Account ID (`act_<digits>`) e Pixel ID (numérico),
 *     com o botão Salvar DESABILITADO enquanto houver erro (Req 3.9).
 *   - Read-only quando o usuário NÃO tem `MARKETING_EDIT`: campos desabilitados
 *     e botões de ação ocultos (admin-patterns.md §2 — ocultar, não apenas
 *     desabilitar ações mutadoras).
 *   - No sucesso de qualquer operação: toast `Configuração salva.` com
 *     `role="status"` (Req 3.13, 14.3) e refetch da config vigente.
 *   - STALE_VERSION (versionamento otimista): toast informativo + refetch
 *     (admin-patterns.md §3), sem tratar como erro de formulário.
 *
 * Versionamento otimista (admin-patterns.md §3): a config é lida antes da edição
 * e o `updated_at` vigente é reenviado como `expected_updated_at` em cada
 * salvamento. Config e token são operações SEPARADAS (ações de audit distintas:
 * MARKETING_CONFIG_UPDATED vs MARKETING_TOKEN_UPDATED/CLEARED); cada uma é
 * seguida de refetch — o novo `updated_at` alimenta a operação seguinte e evita
 * colisão de versão entre elas.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  clearToken,
  getConfig,
  MARKETING_ERROR_MESSAGES,
  MarketingError,
  setToken,
  updateConfig,
  type MarketingConfig,
  type MetricPeriod,
  type UpdateMarketingConfigPayload,
} from '../../../services/admin/marketing';

/** Opções do seletor de período default (pt-BR), domínio fechado MetricPeriod. */
const PERIOD_OPTIONS: ReadonlyArray<{ value: MetricPeriod; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

/** Formato válido de Ad Account ID: `act_` seguido de 1+ dígitos (Req 3.9). */
const AD_ACCOUNT_REGEX = /^act_\d+$/;
/** Pixel ID válido: somente dígitos (Req 3.10). */
const PIXEL_REGEX = /^\d+$/;

/** Tom visual do toast (sucesso vs informativo, ex.: STALE_VERSION). */
type ToastTone = 'success' | 'info';
interface ToastState {
  msg: string;
  tone: ToastTone;
}

export interface MarketingConfigFormProps {
  /**
   * Disparado após cada operação bem-sucedida (depois do refetch interno).
   * A página pode usá-lo para reagir (ex.: re-derivar o período default do
   * painel). Opcional — o componente já recarrega a própria config.
   */
  onSaved?: () => void;
  /** Classe utilitária extra aplicada ao container raiz. Opcional. */
  className?: string;
}

/** Traduz um erro arbitrário em mensagem pt-BR canônica para exibição inline. */
function errorMessage(err: unknown): string {
  if (err instanceof MarketingError) return MARKETING_ERROR_MESSAGES[err.code];
  return MARKETING_ERROR_MESSAGES.UNKNOWN;
}

export default function MarketingConfigForm({ onSaved, className }: MarketingConfigFormProps) {
  const { allowed: canEdit } = useAdminPermission('MARKETING_EDIT');

  // Prefixo único para ids (htmlFor/aria) — acessibilidade (Req 14.1).
  const uid = useId();
  const adAccountInputId = `${uid}-ad-account`;
  const pixelInputId = `${uid}-pixel`;
  const periodId = `${uid}-period`;
  const consentId = `${uid}-consent`;
  const tokenId = `${uid}-token`;

  // Config vigente (fonte do versionamento otimista via updated_at).
  const [config, setConfig] = useState<MarketingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Estado controlado dos campos da config.
  const [adAccount, setAdAccount] = useState('');
  const [pixel, setPixel] = useState('');
  const [period, setPeriod] = useState<MetricPeriod>('7d');
  const [consentRequired, setConsentRequired] = useState(true);

  // Campo de NOVO token (nunca pré-preenchido — CP-7).
  const [tokenInput, setTokenInput] = useState('');

  // UI state das mutações.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Timer do toast (limpo a cada novo toast e no unmount).
  const toastTimer = useRef<number | null>(null);

  /** Semeia os campos controlados a partir de uma config vigente. */
  const seedFields = useCallback((c: MarketingConfig) => {
    setAdAccount(c.ad_account_id ?? '');
    setPixel(c.pixel_id ?? '');
    setPeriod(c.default_period);
    setConsentRequired(c.consent_required);
    setTokenInput('');
  }, []);

  /**
   * Lê (ou recarrega) a config vigente via getConfig e re-semeia os campos.
   * Usado no mount e como refetch após cada operação (Req 3.13) e em
   * STALE_VERSION (admin-patterns.md §3).
   */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const c = await getConfig();
      setConfig(c);
      seedFields(c);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [seedFields]);

  useEffect(() => {
    void load();
  }, [load]);

  // Limpa o timer do toast ao desmontar.
  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // ---- Validação inline (Req 3.9) ----
  const adAccountError = useMemo(() => {
    const trimmed = adAccount.trim();
    if (trimmed === '') return null; // vazio limpa o campo (null) — permitido.
    return AD_ACCOUNT_REGEX.test(trimmed) ? null : MARKETING_ERROR_MESSAGES.INVALID_AD_ACCOUNT_ID;
  }, [adAccount]);

  const pixelError = useMemo(() => {
    const trimmed = pixel.trim();
    if (trimmed === '') return null; // vazio limpa o campo (null) — permitido.
    return PIXEL_REGEX.test(trimmed) ? null : MARKETING_ERROR_MESSAGES.INVALID_PIXEL_ID;
  }, [pixel]);

  const hasValidationError = adAccountError !== null || pixelError !== null;
  const saveDisabled = !canEdit || busy || loading || config === null || hasValidationError;

  function showToast(msg: string, tone: ToastTone) {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ msg, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  /** Sucesso comum: toast canônico + refetch + onSaved (Req 3.13). */
  function handleSuccess() {
    showToast('Configuração salva.', 'success');
    void load();
    onSaved?.();
  }

  /**
   * Trata a falha de uma mutação. STALE_VERSION ⇒ toast informativo + refetch
   * (admin-patterns.md §3); demais ⇒ erro inline canônico.
   */
  function handleMutationError(err: unknown) {
    if (err instanceof MarketingError && err.code === 'STALE_VERSION') {
      showToast(MARKETING_ERROR_MESSAGES.STALE_VERSION, 'info');
      void load();
      return;
    }
    setError(errorMessage(err));
  }

  async function handleSaveConfig() {
    if (saveDisabled || config === null) return;
    setError(null);
    setBusy(true);
    try {
      const payload: UpdateMarketingConfigPayload = {
        ad_account_id: adAccount.trim() === '' ? null : adAccount.trim(),
        pixel_id: pixel.trim() === '' ? null : pixel.trim(),
        default_period: period,
        consent_required: consentRequired,
      };
      await updateConfig(payload, config.updated_at);
      handleSuccess();
    } catch (err) {
      handleMutationError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveToken() {
    if (!canEdit || busy || config === null || tokenInput.trim() === '') return;
    setError(null);
    setBusy(true);
    try {
      // Token bruto trafega apenas até o Vault (server-side) — CP-7.
      await setToken(tokenInput, config.updated_at);
      handleSuccess();
    } catch (err) {
      handleMutationError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleClearToken() {
    if (!canEdit || busy || config === null) return;
    setError(null);
    setBusy(true);
    try {
      await clearToken(config.updated_at);
      handleSuccess();
    } catch (err) {
      handleMutationError(err);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100 disabled:opacity-50';
  const inputErrorClass =
    'w-full px-3 py-2 rounded bg-gray-800 border border-red-600 text-sm text-gray-100 disabled:opacity-50';
  const toastClass =
    toast?.tone === 'info'
      ? 'fixed top-4 right-4 z-50 bg-gray-800 text-amber-200 text-sm px-4 py-2 rounded shadow-lg border border-amber-700'
      : 'fixed top-4 right-4 z-50 bg-gray-800 text-green-200 text-sm px-4 py-2 rounded shadow-lg border border-green-700';

  const rootClass = `space-y-5 max-w-xl${className ? ` ${className}` : ''}`;

  // Estado de carregamento inicial (acessível — Req 14.3).
  if (loading && config === null) {
    return (
      <div className={rootClass}>
        <p className="text-xs text-gray-500" role="status" aria-live="polite">
          Carregando configuração…
        </p>
      </div>
    );
  }

  // Falha ao carregar a config (com opção de tentar novamente).
  if (config === null) {
    return (
      <div className={rootClass}>
        <div className="text-sm text-red-400" role="alert">
          {loadError ?? MARKETING_ERROR_MESSAGES.UNKNOWN}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs px-2.5 py-1 rounded bg-gray-700 text-gray-100 hover:bg-gray-600"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      {/* Toast (Req 3.13 / 14.3): role=status + aria-live polite. */}
      {toast && (
        <div role="status" aria-live="polite" className={toastClass}>
          {toast.msg}
        </div>
      )}

      {!canEdit && (
        <p className="text-xs text-gray-500" role="note">
          Você tem acesso somente leitura a esta configuração.
        </p>
      )}

      {/* ----- Access Token (segredo, Masked_Token — CP-7) ----- */}
      <section className="space-y-2 rounded border border-gray-800 bg-gray-900/40 p-3">
        <div className="flex items-center justify-between">
          <label htmlFor={tokenId} className="block text-xs text-gray-400">
            Access Token
          </label>
          <span className="text-[10px]" aria-live="polite">
            {config.token_is_set ? (
              <span className="text-green-300">
                Configurado (final {config.token_last4 ?? '••••'})
              </span>
            ) : (
              <span className="text-gray-400">Não configurado</span>
            )}
          </span>
        </div>
        <input
          id={tokenId}
          type="password"
          autoComplete="off"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          disabled={!canEdit || busy}
          className={inputClass}
          placeholder={
            config.token_is_set ? 'Digite para substituir o token' : 'Cole o Access Token da Meta'
          }
          aria-describedby={`${tokenId}-help`}
        />
        <p id={`${tokenId}-help`} className="text-[10px] text-gray-500">
          O token é armazenado com segurança no servidor; somente os últimos 4 caracteres ficam
          visíveis. Deixe em branco ao salvar a configuração para preservar o token atual.
        </p>
        {canEdit && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveToken}
              disabled={busy || tokenInput.trim() === ''}
              className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              Salvar token
            </button>
            {config.token_is_set && (
              <button
                type="button"
                onClick={handleClearToken}
                disabled={busy}
                className="text-xs px-2.5 py-1 rounded bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-50"
              >
                Remover token
              </button>
            )}
          </div>
        )}
      </section>

      {/* ----- Ad Account ID ----- */}
      <div>
        <label htmlFor={adAccountInputId} className="block text-xs text-gray-400 mb-1">
          Ad Account ID
        </label>
        <input
          id={adAccountInputId}
          type="text"
          inputMode="text"
          value={adAccount}
          onChange={(e) => setAdAccount(e.target.value)}
          disabled={!canEdit || busy}
          className={adAccountError ? inputErrorClass : inputClass}
          placeholder="act_1234567890"
          aria-invalid={adAccountError !== null}
          aria-describedby={adAccountError ? `${adAccountInputId}-error` : undefined}
        />
        {adAccountError && (
          <p id={`${adAccountInputId}-error`} className="mt-1 text-xs text-red-400" role="alert">
            {adAccountError}
          </p>
        )}
      </div>

      {/* ----- Pixel ID ----- */}
      <div>
        <label htmlFor={pixelInputId} className="block text-xs text-gray-400 mb-1">
          Pixel ID
        </label>
        <input
          id={pixelInputId}
          type="text"
          inputMode="numeric"
          value={pixel}
          onChange={(e) => setPixel(e.target.value)}
          disabled={!canEdit || busy}
          className={pixelError ? inputErrorClass : inputClass}
          placeholder="987654321"
          aria-invalid={pixelError !== null}
          aria-describedby={pixelError ? `${pixelInputId}-error` : undefined}
        />
        {pixelError && (
          <p id={`${pixelInputId}-error`} className="mt-1 text-xs text-red-400" role="alert">
            {pixelError}
          </p>
        )}
      </div>

      {/* ----- Período default ----- */}
      <div>
        <label htmlFor={periodId} className="block text-xs text-gray-400 mb-1">
          Período default
        </label>
        <select
          id={periodId}
          value={period}
          onChange={(e) => setPeriod(e.target.value as MetricPeriod)}
          disabled={!canEdit || busy}
          className={inputClass}
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* ----- Exigir consentimento (toggle) ----- */}
      <div>
        <label htmlFor={consentId} className="flex items-center gap-2 text-xs text-gray-300">
          <input
            id={consentId}
            type="checkbox"
            checked={consentRequired}
            onChange={(e) => setConsentRequired(e.target.checked)}
            disabled={!canEdit || busy}
            className="accent-cyan-500"
          />
          Exigir consentimento para o Pixel
        </label>
      </div>

      {/* Erro de operação (inline). */}
      {error && (
        <div className="text-sm text-red-400" role="alert">
          {error}
        </div>
      )}

      {/* Salvar config (Req 3.9: desabilitado em erro de validação). */}
      {canEdit && (
        <button
          type="button"
          onClick={handleSaveConfig}
          disabled={saveDisabled}
          className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      )}
    </div>
  );
}
