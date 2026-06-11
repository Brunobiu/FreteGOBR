/**
 * admin/settings.ts — Módulo Configurações do painel admin
 * (spec finalizacao-lancamento, Área 1).
 *
 * Camada de serviço de `/admin/settings`. Esta primeira parte (Fase 0) contém
 * APENAS tipos públicos e helpers PUROS (sem I/O, sem Supabase) — totalmente
 * testáveis por unit/property. Os wrappers de leitura/mutação (getSettings,
 * updateSetting, setSecret, clearSecret) entram na Fase 2.
 *
 * Padrões (project-conventions.md + admin-patterns.md):
 *   - Domínios fechados (category, value_type) como union types.
 *   - Erros tipados com código + mensagem pt-BR canônica.
 *   - Segredos NUNCA expõem valor bruto: helper de masking revela só os
 *     últimos 4 caracteres (e mascara tudo quando o bruto tem <= 4 chars).
 *   - Validação por tipo espelha exatamente a RPC server-side (autoridade
 *     final é o servidor).
 *
 * Idioma: mensagens user-facing em pt-BR; identifiers/códigos em inglês.
 */

import { supabase } from '../supabase';
import { executeAdminMutation } from './audit';

// ─── Domínios fechados ──────────────────────────────────────────────────────

export type SettingCategory = 'integrations' | 'trial' | 'plans' | 'ai' | 'general';

export const SETTING_CATEGORIES: readonly SettingCategory[] = [
  'integrations',
  'trial',
  'plans',
  'ai',
  'general',
];

export type SettingValueType = 'string' | 'integer' | 'money' | 'boolean' | 'secret' | 'enum';

export type EvolutionConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export const EVOLUTION_CONNECTION_STATUSES: readonly EvolutionConnectionStatus[] = [
  'disconnected',
  'connecting',
  'connected',
  'error',
];

// ─── Modelos ────────────────────────────────────────────────────────────────

/** Valor concreto de uma configuração não-secreta. */
export type SettingValue = string | number | boolean | null;

export interface SettingRecord {
  key: string;
  category: SettingCategory;
  valueType: SettingValueType;
  /** Valor atual. SEMPRE null para `secret` (o bruto vive no Vault). */
  value: SettingValue;
  /** Opções fechadas quando `valueType === 'enum'`; caso contrário null. */
  enumOptions: string[] | null;
  isReadonly: boolean;
  isSecret: boolean;
  secretIsSet: boolean;
  /** Representação mascarada (ex.: '••••••••3f9a') ou null se não definido. */
  maskedValue: string | null;
  label: string;
  /** ISO 8601 UTC; usado no versionamento otimista. */
  updatedAt: string;
}

export type SettingsByCategory = Record<SettingCategory, SettingRecord[]>;

// ─── Payloads de mutação ────────────────────────────────────────────────────

export interface UpdateSettingPayload {
  key: string;
  value: Exclude<SettingValue, null>;
  expectedUpdatedAt: string;
}

export interface SetSecretPayload {
  key: string;
  secret: string;
  expectedUpdatedAt: string;
}

export interface ClearSecretPayload {
  key: string;
  expectedUpdatedAt: string;
}

/** Decisão de ação para um campo de segredo num salvamento. */
export type SecretAction = 'set' | 'clear' | 'preserve';

// ─── Erros ──────────────────────────────────────────────────────────────────

export type SettingsErrorCode =
  | 'PERMISSION_DENIED'
  | 'STALE_VERSION'
  | 'SETTING_NOT_FOUND'
  | 'INVALID_VALUE'
  | 'READONLY_SETTING'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export const SETTINGS_ERROR_MESSAGES: Record<SettingsErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para acessar esta área.',
  STALE_VERSION: 'Outro admin atualizou. Recarregando.',
  SETTING_NOT_FOUND: 'Configuração não encontrada.',
  INVALID_VALUE: 'Valor inválido para esta configuração.',
  READONLY_SETTING: 'Esta configuração é somente leitura.',
  NETWORK_ERROR: 'Falha de conexão. Tente novamente.',
  UNKNOWN: 'Não foi possível concluir a operação.',
};

export class SettingsServiceError extends Error {
  readonly code: SettingsErrorCode;
  constructor(code: SettingsErrorCode) {
    super(SETTINGS_ERROR_MESSAGES[code]);
    this.name = 'SettingsServiceError';
    this.code = code;
  }
}

// ─── Constantes de validação ────────────────────────────────────────────────

/** Limite superior (em centavos) para valores monetários: R$ 1.000.000,00. */
export const MONEY_MAX_CENTS = 1_000_000;
/** Intervalo válido de duração do trial, em dias. */
export const TRIAL_DURATION_MIN = 1;
export const TRIAL_DURATION_MAX = 365;
/** Tamanho máximo aceito para um segredo bruto. */
export const SECRET_MAX_LENGTH = 4096;

/** Resultado de uma validação de valor. */
export type ValidationResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_VALUE' | 'READONLY_SETTING' };

export interface ValidateOptions {
  key?: string;
  enumOptions?: string[] | null;
  isReadonly?: boolean;
}

// ─── Helpers puros: dinheiro ────────────────────────────────────────────────

/**
 * Converte reais (string "1234.56" / "1234,56" ou number) para centavos
 * inteiros. Lança SettingsServiceError('INVALID_VALUE') para entrada não
 * numérica.
 */
export function reaisToCents(reais: string | number): number {
  let n: number;
  if (typeof reais === 'number') {
    n = reais;
  } else {
    const normalized = reais.trim().replace(/\./g, '').replace(',', '.');
    // Aceita também ponto decimal puro ("1234.56").
    n = Number(reais.includes(',') ? normalized : reais.trim());
  }
  if (!Number.isFinite(n)) throw new SettingsServiceError('INVALID_VALUE');
  return Math.round(n * 100);
}

/** Converte centavos inteiros para string em reais com 2 casas ("1234.56"). */
export function centsToReais(cents: number): string {
  if (!Number.isFinite(cents)) throw new SettingsServiceError('INVALID_VALUE');
  return (Math.round(cents) / 100).toFixed(2);
}

// ─── Helpers puros: segredos ────────────────────────────────────────────────

/**
 * Mascara um segredo bruto revelando no máximo os últimos 4 caracteres.
 * Se o bruto tem <= 4 caracteres, mascara TUDO (não vaza nada).
 */
export function maskSecret(raw: string): string {
  const bullets = '••••••••';
  if (raw.length <= 4) return bullets;
  return bullets + raw.slice(-4);
}

/**
 * Decide a ação para um campo de segredo durante um salvamento.
 *  - remoção explícita ⇒ 'clear'
 *  - novo valor não vazio ⇒ 'set'
 *  - campo em branco sem remoção ⇒ 'preserve'
 */
export function decideSecretAction(input: {
  removeRequested: boolean;
  newSecret: string;
}): SecretAction {
  if (input.removeRequested) return 'clear';
  if (input.newSecret.trim().length > 0) return 'set';
  return 'preserve';
}

// ─── Helpers puros: validação de formato ────────────────────────────────────

/** URL absoluta com esquema EXATAMENTE https. */
export function validateEvolutionBaseUrl(url: string): boolean {
  if (typeof url !== 'string' || url.trim().length === 0) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** E-mail em formato válido OU string vazia (campo opcional). */
export function validateEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  if (email.trim().length === 0) return true; // vazio é permitido
  // Regex simples e segura (sem catastrophic backtracking).
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ─── Helper puro: validação por tipo (espelho da RPC) ───────────────────────

/**
 * Valida um valor contra seu Setting_Value_Type. Espelha exatamente a
 * validação server-side (a RPC é a autoridade final, mas o cliente replica
 * para feedback inline).
 */
export function validateSettingValue(
  valueType: SettingValueType,
  value: unknown,
  opts: ValidateOptions = {}
): ValidationResult {
  if (opts.isReadonly) return { ok: false, code: 'READONLY_SETTING' };

  switch (valueType) {
    case 'string':
      return typeof value === 'string' ? { ok: true } : { ok: false, code: 'INVALID_VALUE' };

    case 'boolean':
      return typeof value === 'boolean' ? { ok: true } : { ok: false, code: 'INVALID_VALUE' };

    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { ok: false, code: 'INVALID_VALUE' };
      }
      // Range específico por key (ex.: trial_duration_days 1..365).
      if (opts.key === 'trial_duration_days') {
        if (value < TRIAL_DURATION_MIN || value > TRIAL_DURATION_MAX) {
          return { ok: false, code: 'INVALID_VALUE' };
        }
      }
      return { ok: true };
    }

    case 'money': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { ok: false, code: 'INVALID_VALUE' };
      }
      if (value < 0 || value > MONEY_MAX_CENTS) return { ok: false, code: 'INVALID_VALUE' };
      return { ok: true };
    }

    case 'enum': {
      const options = opts.enumOptions ?? [];
      if (typeof value !== 'string' || !options.includes(value)) {
        return { ok: false, code: 'INVALID_VALUE' };
      }
      return { ok: true };
    }

    case 'secret':
      // Segredos não são atualizados via update normal — usar setSecret.
      return { ok: false, code: 'INVALID_VALUE' };

    default:
      return { ok: false, code: 'INVALID_VALUE' };
  }
}

// ─── Helper puro: agrupamento por categoria ─────────────────────────────────

/**
 * Agrupa registros por categoria. SEMPRE retorna as 5 categorias presentes;
 * categoria sem registros vira lista vazia. Cada registro aparece exatamente
 * uma vez na sua categoria.
 */
export function groupByCategory(records: SettingRecord[]): SettingsByCategory {
  const result = {
    integrations: [],
    trial: [],
    plans: [],
    ai: [],
    general: [],
  } as SettingsByCategory;

  for (const rec of records) {
    if (SETTING_CATEGORIES.includes(rec.category)) {
      result[rec.category].push(rec);
    }
  }
  return result;
}

// ─── Helper puro: normalização de erro ──────────────────────────────────────

/**
 * Normaliza um erro cru (do Supabase/rede) para SettingsServiceError com
 * código tipado. Nunca inclui valor bruto de segredo.
 */
export function toSettingsError(raw: unknown): SettingsServiceError {
  if (raw instanceof SettingsServiceError) return raw;

  const e = (raw ?? {}) as { code?: string; message?: string };
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = typeof e.message === 'string' ? e.message : '';
  const hay = `${code} ${msg}`.toLowerCase();

  if (code === '42501' || hay.includes('permission_denied')) {
    return new SettingsServiceError('PERMISSION_DENIED');
  }
  if (hay.includes('stale_version')) return new SettingsServiceError('STALE_VERSION');
  if (hay.includes('setting_not_found')) return new SettingsServiceError('SETTING_NOT_FOUND');
  if (hay.includes('readonly_setting')) return new SettingsServiceError('READONLY_SETTING');
  if (hay.includes('invalid_value')) return new SettingsServiceError('INVALID_VALUE');
  if (hay.includes('network') || hay.includes('fetch')) {
    return new SettingsServiceError('NETWORK_ERROR');
  }
  return new SettingsServiceError('UNKNOWN');
}

// ════════════════════════════════════════════════════════════════════════════
// WRAPPERS DE I/O (Fase 2) — leitura e mutação via RPC
// ════════════════════════════════════════════════════════════════════════════

/** Shape cru retornado pela RPC admin_settings_get (jsonb). */
interface RawSettingRow {
  key: string;
  category: SettingCategory;
  value_type: SettingValueType;
  value: SettingValue;
  enum_options: string[] | null;
  is_readonly: boolean;
  is_secret: boolean;
  secret_is_set: boolean;
  masked_value: string | null;
  label: string;
  updated_at: string;
}

/** Converte uma linha crua da RPC no modelo público SettingRecord. */
function mapRawRow(raw: RawSettingRow): SettingRecord {
  return {
    key: raw.key,
    category: raw.category,
    valueType: raw.value_type,
    value: raw.value_type === 'secret' ? null : raw.value,
    enumOptions: raw.enum_options,
    isReadonly: raw.is_readonly,
    isSecret: raw.is_secret,
    secretIsSet: raw.secret_is_set,
    maskedValue: raw.masked_value,
    label: raw.label,
    updatedAt: raw.updated_at,
  };
}

/**
 * Lê todas as configurações agrupadas por categoria. Segredos nunca trazem o
 * valor bruto (a RPC já devolve `value=null` + `masked_value`).
 */
export async function getSettings(): Promise<SettingsByCategory> {
  const { data, error } = await supabase.rpc('admin_settings_get');
  if (error) throw toSettingsError(error);

  const rows = Array.isArray(data) ? (data as RawSettingRow[]) : [];
  return groupByCategory(rows.map(mapRawRow));
}

/**
 * Atualiza um valor não-secreto. Pré-valida no cliente (autoridade final é o
 * servidor) e registra o audit via executeAdminMutation.
 */
export async function updateSetting(
  payload: UpdateSettingPayload,
  meta?: { valueType: SettingValueType; enumOptions?: string[] | null; isReadonly?: boolean }
): Promise<{ updatedAt: string }> {
  // Pré-validação client (feedback rápido; o servidor revalida).
  if (meta) {
    const r = validateSettingValue(meta.valueType, payload.value, {
      key: payload.key,
      enumOptions: meta.enumOptions,
      isReadonly: meta.isReadonly,
    });
    if (!r.ok) throw new SettingsServiceError(r.code);
  }

  return executeAdminMutation(
    {
      action: 'SETTINGS_UPDATED',
      targetType: 'platform_settings',
      targetId: payload.key,
      before: { key: payload.key },
      after: { key: payload.key, value: payload.value },
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_settings_update', {
        p_key: payload.key,
        p_value: payload.value,
        p_expected_updated_at: payload.expectedUpdatedAt,
      });
      if (error) throw toSettingsError(error);
      const result = data as { ok: boolean; updated_at: string };
      return { updatedAt: result.updated_at };
    }
  );
}

/**
 * Grava/substitui um segredo. O audit registra APENAS metadados não sensíveis
 * (`is_set` + últimos 4 chars) — nunca o valor bruto.
 */
export async function setSecret(
  payload: SetSecretPayload
): Promise<{ isSet: true; maskedValue: string; updatedAt: string }> {
  const last4 = payload.secret.slice(-4);
  return executeAdminMutation(
    {
      action: 'SETTINGS_SECRET_UPDATED',
      targetType: 'platform_settings',
      targetId: payload.key,
      before: { key: payload.key },
      after: { key: payload.key, is_set: true, last4 },
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_settings_secret_set', {
        p_key: payload.key,
        p_secret: payload.secret,
        p_expected_updated_at: payload.expectedUpdatedAt,
      });
      if (error) throw toSettingsError(error);
      const result = data as {
        ok: boolean;
        is_set: true;
        masked_value: string;
        updated_at: string;
      };
      return { isSet: true, maskedValue: result.masked_value, updatedAt: result.updated_at };
    }
  );
}

export type ClearSecretResult =
  | { ok: true; isSet: false; updatedAt: string }
  | { skipped: true; reason: 'ALREADY_CLEARED' };

/**
 * Remove um segredo. Idempotente: já-removido devolve `{ skipped, reason }`
 * (sem lançar). O audit (real ou _SKIPPED) é gravado DENTRO da RPC, portanto
 * não usamos executeAdminMutation aqui.
 */
export async function clearSecret(payload: ClearSecretPayload): Promise<ClearSecretResult> {
  const { data, error } = await supabase.rpc('admin_settings_secret_clear', {
    p_key: payload.key,
    p_expected_updated_at: payload.expectedUpdatedAt,
  });
  if (error) throw toSettingsError(error);

  const result = data as
    | { ok: true; is_set: false; updated_at: string }
    | { skipped: true; reason: 'ALREADY_CLEARED' };

  if ('skipped' in result && result.skipped) {
    return { skipped: true, reason: 'ALREADY_CLEARED' };
  }
  const ok = result as { ok: true; is_set: false; updated_at: string };
  return { ok: true, isSet: false, updatedAt: ok.updated_at };
}
