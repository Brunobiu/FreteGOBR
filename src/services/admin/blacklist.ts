/**
 * admin/blacklist.ts
 *
 * Service de gestao da blacklist do painel admin.
 * Identificadores bloqueados (phone, cpf, cnpj, email, ip_address)
 * usados como barreira em login/signup/verificacao de email.
 *
 * Toda mutacao passa por executeAdminMutation (audit-by-construction).
 * Nenhuma chamada direta a .update/.delete/.insert sem o wrapper.
 *
 * Esta e a parte 1 do arquivo (tasks 2.2 / 2.3 / 2.4 / 2.5):
 *   - Tipos publicos exportados
 *   - Helpers puros (normalize, validate, mask, classify, isUuid, timing parity)
 *   - CSV (export, import template, import parser, import report)
 *   - URL <-> filtros round-trip
 *
 * Listagem, detalhe e mutacoes vao em epics seguintes (3, 4, 5).
 *
 * Dependencias: admin-foundation (Permission_Matrix, executeAdminMutation,
 * is_admin_with_permission RPC), admin-blacklist migration 035 (admin_blacklist
 * + RPCs admin_blacklist_*, is_blacklisted, log_blacklist_block,
 * blacklist_normalize, blacklist_validate).
 *
 * Paridade SQL <-> TS:
 *   - blacklistNormalize TS espelha blacklist_normalize SQL (035, secao 4)
 *   - blacklistValidate TS espelha blacklist_validate SQL (035, secao 5)
 *   - classifyEntryStatus TS espelha derivacao em is_blacklisted SQL (035, secao 7)
 */

import { supabase } from '../supabase';
import { executeAdminMutation, logAdminAction } from './audit';

// ===================== Tipos publicos =====================

export type BlacklistType = 'phone' | 'cpf' | 'cnpj' | 'email' | 'ip_address';
export type BlacklistTypeFilter = BlacklistType | 'todos';
export type BlacklistStatus = 'ativo' | 'expirado' | 'removido';
export type BlacklistStatusFilter = BlacklistStatus | 'todos';
export type BlacklistSort = 'created_desc' | 'created_asc' | 'expires_asc' | 'removed_desc';

export interface BlacklistFilters {
  type: BlacklistTypeFilter;
  status: BlacklistStatusFilter;
  createdBy: string | null;
  from: string | null;
  to: string | null;
  q: string;
  sort: BlacklistSort;
  page: number;
  pageSize: number;
  sourceUserId: string | null;
}

export const DEFAULT_BLACKLIST_FILTERS: BlacklistFilters = {
  type: 'todos',
  status: 'todos',
  createdBy: null,
  from: null,
  to: null,
  q: '',
  sort: 'created_desc',
  page: 1,
  pageSize: 10,
  sourceUserId: null,
};

/**
 * Linha de admin_blacklist enriquecida com nomes resolvidos via JOIN com users
 * (created_by_name, removed_by_name).
 */
export interface BlacklistEntry {
  id: string;
  type: BlacklistType;
  value: string;
  reason: string;
  expires_at: string | null;
  source_user_id: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
  removed_by: string | null;
  removed_by_name: string | null;
  removed_reason: string | null;
}

export interface BlacklistListResult {
  rows: BlacklistEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BlacklistSourceUser {
  id: string;
  name: string;
  type: 'motorista' | 'embarcador';
  is_active: boolean;
  banned_at: string | null;
}

export interface BlacklistAttempt {
  id: string;
  created_at: string;
  action: 'BLACKLIST_LOGIN_BLOCKED' | 'BLACKLIST_SIGNUP_BLOCKED' | 'BLACKLIST_EMAIL_BLOCKED';
  ip: string | null;
  user_agent: string | null;
}

export interface BlacklistAuditEntry {
  id: string;
  admin_id: string | null;
  admin_name: string | null;
  action: string;
  created_at: string;
  before_data: unknown;
  after_data: unknown;
}

export interface BlacklistDetailBundle {
  entry: BlacklistEntry;
  status: BlacklistStatus;
  sourceUser: BlacklistSourceUser | null;
  attempts: BlacklistAttempt[];
  attemptsTotal: number;
  attemptsPage: number;
  attemptsPageSize: number;
  history: BlacklistAuditEntry[];
  errors: Partial<Record<'sourceUser' | 'attempts' | 'history', string>>;
}

// ===================== Payloads =====================

export interface BlacklistAddPayload {
  type: BlacklistType;
  valueRaw: string;
  reason: string;
  expiresAt: string | null;
  sourceUserId: string | null;
}

export interface BlacklistUpdatePayload {
  reason: string;
  expiresAt: string | null;
}

export interface BlacklistRemoveOptions {
  reason?: string;
}

export interface BulkRemoveResult {
  success: string[];
  skipped: { id: string; reason: 'ALREADY_REMOVED' }[];
  failed: { id: string; reason: string }[];
}

export interface BulkImportRow {
  lineNumber: number;
  raw: { type: string; value: string; reason: string; expires_at: string | null };
  normalized: { type: BlacklistType; value: string } | null;
  validation: { ok: true } | { ok: false; detail: string };
  result?:
    | { status: 'inserted'; id: string }
    | { status: 'skipped'; reason: 'ALREADY_BLACKLISTED' | 'MASTER_PROTECTED'; existingId?: string }
    | { status: 'failed'; detail: string };
}

export interface BulkImportResult {
  total: number;
  valid: number;
  invalid: number;
  inserted: number;
  skipped: number;
  failed: number;
  rows: BulkImportRow[];
}

// ===================== Erros =====================

export type BlacklistErrorCode =
  | 'INVALID_INPUT'
  | 'ALREADY_BLACKLISTED'
  | 'MASTER_PROTECTED'
  | 'STALE_VERSION'
  | 'NOT_FOUND'
  | 'ALREADY_REMOVED'
  | 'PERMISSION_DENIED'
  | 'BULK_LIMIT_EXCEEDED'
  | 'BLACKLISTED'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'CSV_PARSE_ERROR'
  | 'HEADER_MISMATCH'
  | 'FILE_TOO_LARGE';

export class BlacklistServiceError extends Error {
  constructor(
    public code: BlacklistErrorCode,
    message?: string,
    public cause?: unknown,
    public extra?: Record<string, unknown>
  ) {
    super(message ?? code);
    this.name = 'BlacklistServiceError';
  }
}

export const BLACKLIST_ERROR_MESSAGES: Record<BlacklistErrorCode, string> = {
  INVALID_INPUT: 'Dados inválidos.',
  ALREADY_BLACKLISTED: 'Identificador já está na blacklist.',
  MASTER_PROTECTED: 'Este identificador pertence ao administrador master e não pode ser bloqueado.',
  STALE_VERSION: 'Os dados foram alterados por outro admin. Recarregue antes de salvar.',
  NOT_FOUND: 'Entrada não encontrada.',
  ALREADY_REMOVED: 'Esta entrada já está removida.',
  PERMISSION_DENIED: 'Operação não permitida.',
  BULK_LIMIT_EXCEEDED: 'Limite de itens excedido para esta operação.',
  BLACKLISTED: 'Identificador bloqueado.',
  TIMEOUT: 'Tempo esgotado. Tente novamente.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde alguns segundos.',
  CSV_PARSE_ERROR: 'Não foi possível processar o arquivo CSV.',
  HEADER_MISMATCH: 'O cabeçalho do CSV não bate com o esperado.',
  FILE_TOO_LARGE: 'Arquivo excede o tamanho máximo permitido.',
};

/**
 * Constantes anti-enumeration usadas pelos hooks de bloqueio user-facing.
 * Mensagens IDENTICAS as exibidas em falhas genericas (credencial invalida, etc),
 * para nao distinguir blacklist de outros caminhos de erro.
 */
export const GENERIC_LOGIN_MESSAGE = 'Não foi possível autenticar.';
export const GENERIC_SIGNUP_MESSAGE = 'Não foi possível concluir o cadastro.';
export const GENERIC_EMAIL_MESSAGE = 'Não foi possível enviar o código.';

// ===================== Helpers puros =====================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * UUID v1-v5 (RFC 4122).
 */
export function isUuid(s: string): boolean {
  return UUID_REGEX.test(s);
}

/**
 * Normaliza identificador para forma canonica.
 * Paridade EXATA com SQL blacklist_normalize (035, secao 4).
 *   - phone: digits-only; remove DDI 55 quando o resultado tem 12 ou 13 digitos
 *   - cpf:   digits-only
 *   - cnpj:  digits-only
 *   - email: lower(trim(...))
 *   - ip:    trim(...)
 */
export function blacklistNormalize(type: BlacklistType, raw: string): string {
  if (raw == null) return '';
  switch (type) {
    case 'phone': {
      let digits = raw.replace(/\D/g, '');
      if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        digits = digits.slice(2);
      }
      return digits;
    }
    case 'cpf':
      return raw.replace(/\D/g, '');
    case 'cnpj':
      return raw.replace(/\D/g, '');
    case 'email':
      return raw.trim().toLowerCase();
    case 'ip_address':
      return raw.trim();
  }
}

/**
 * Valida formato do identificador apos normalizacao.
 * Paridade com SQL blacklist_validate (035, secao 5):
 *   - phone: 10 ou 11 digitos
 *   - cpf:   11 digitos + DV modulo 11 + rejeita repetidas
 *   - cnpj:  14 digitos + DV modulo 11 + rejeita repetidas
 *   - email: regex + max 320 chars
 *   - ip:    IPv4 octetos 0..255 ou IPv6 hex+`:` com 2..8 grupos
 */
export function blacklistValidate(
  type: BlacklistType,
  normalized: string
): { ok: true } | { ok: false; reason: 'INVALID_INPUT'; detail: string } {
  if (!normalized || normalized.length === 0) {
    return { ok: false, reason: 'INVALID_INPUT', detail: 'Valor vazio.' };
  }

  switch (type) {
    case 'phone': {
      if (!/^\d+$/.test(normalized) || (normalized.length !== 10 && normalized.length !== 11)) {
        return {
          ok: false,
          reason: 'INVALID_INPUT',
          detail: 'Telefone deve ter 10 ou 11 dígitos.',
        };
      }
      return { ok: true };
    }
    case 'cpf': {
      if (!/^\d+$/.test(normalized) || normalized.length !== 11) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'CPF inválido.' };
      }
      if (/^(\d)\1{10}$/.test(normalized)) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'CPF inválido.' };
      }
      // DV 1
      let sum = 0;
      for (let i = 0; i < 9; i++) {
        sum += parseInt(normalized[i], 10) * (10 - i);
      }
      let d1 = (sum * 10) % 11;
      if (d1 === 10) d1 = 0;
      if (d1 !== parseInt(normalized[9], 10)) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'CPF inválido.' };
      }
      // DV 2
      sum = 0;
      for (let i = 0; i < 10; i++) {
        sum += parseInt(normalized[i], 10) * (11 - i);
      }
      let d2 = (sum * 10) % 11;
      if (d2 === 10) d2 = 0;
      if (d2 !== parseInt(normalized[10], 10)) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'CPF inválido.' };
      }
      return { ok: true };
    }
    case 'cnpj': {
      if (!/^\d+$/.test(normalized) || normalized.length !== 14) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'CNPJ inválido.' };
      }
      if (/^(\d)\1{13}$/.test(normalized)) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'CNPJ inválido.' };
      }
      // DV 1: pesos [5,4,3,2,9,8,7,6,5,4,3,2]
      const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        sum += parseInt(normalized[i], 10) * w1[i];
      }
      let n = sum % 11;
      const d1 = n < 2 ? 0 : 11 - n;
      if (d1 !== parseInt(normalized[12], 10)) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'CNPJ inválido.' };
      }
      // DV 2: pesos [6,5,4,3,2,9,8,7,6,5,4,3,2]
      const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      sum = 0;
      for (let i = 0; i < 13; i++) {
        sum += parseInt(normalized[i], 10) * w2[i];
      }
      n = sum % 11;
      const d2 = n < 2 ? 0 : 11 - n;
      if (d2 !== parseInt(normalized[13], 10)) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'CNPJ inválido.' };
      }
      return { ok: true };
    }
    case 'email': {
      if (normalized.length > 320) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'E-mail inválido.' };
      }
      if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(normalized)) {
        return { ok: false, reason: 'INVALID_INPUT', detail: 'E-mail inválido.' };
      }
      return { ok: true };
    }
    case 'ip_address': {
      // IPv4: 4 octetos 0..255
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(normalized)) {
        const parts = normalized.split('.');
        for (const p of parts) {
          const n = parseInt(p, 10);
          if (Number.isNaN(n) || n < 0 || n > 255) {
            return { ok: false, reason: 'INVALID_INPUT', detail: 'IP inválido.' };
          }
        }
        return { ok: true };
      }
      // IPv6: hex + ':', 2..8 grupos
      if (/^[0-9a-fA-F:]+$/.test(normalized)) {
        const groups = normalized.split(':').length;
        if (groups >= 2 && groups <= 8) {
          return { ok: true };
        }
      }
      return { ok: false, reason: 'INVALID_INPUT', detail: 'IP inválido.' };
    }
  }
}

/**
 * Mascaramento de valor para listagem (LGPD/PII).
 *   - phone (11 digitos): (XX) XXXXX-XXXX
 *   - phone (10 digitos): (XX) XXXX-XXXX
 *   - cpf:                ***.***.***-XX  (apenas 2 ultimos digitos)
 *   - cnpj:               **.***.***\/****-XX (apenas 2 ultimos digitos)
 *   - email/ip:           integral
 *
 * Para valores fora do shape canonico, retorna o valor original.
 */
export function maskValueForList(type: BlacklistType, normalized: string): string {
  switch (type) {
    case 'phone': {
      if (normalized.length === 11) {
        return `(${normalized.slice(0, 2)}) ${normalized.slice(2, 7)}-${normalized.slice(7)}`;
      }
      if (normalized.length === 10) {
        return `(${normalized.slice(0, 2)}) ${normalized.slice(2, 6)}-${normalized.slice(6)}`;
      }
      return normalized;
    }
    case 'cpf': {
      if (normalized.length === 11) {
        return `***.***.***-${normalized.slice(9, 11)}`;
      }
      return normalized;
    }
    case 'cnpj': {
      if (normalized.length === 14) {
        return `**.***.***/****-${normalized.slice(12, 14)}`;
      }
      return normalized;
    }
    case 'email':
    case 'ip_address':
      return normalized;
  }
}

/**
 * Deriva status da entrada em runtime.
 * Paridade com a logica de is_blacklisted SQL (035, secao 7):
 *   - removed_at IS NOT NULL                 ⇒ 'removido'
 *   - expires_at IS NOT NULL && <= now       ⇒ 'expirado'
 *   - caso contrario                         ⇒ 'ativo'
 */
export function classifyEntryStatus(
  entry: Pick<BlacklistEntry, 'removed_at' | 'expires_at'>,
  now: Date = new Date()
): BlacklistStatus {
  if (entry.removed_at != null) return 'removido';
  if (entry.expires_at != null) {
    const exp = new Date(entry.expires_at);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() <= now.getTime()) {
      return 'expirado';
    }
  }
  return 'ativo';
}

/**
 * Inteiro aleatorio em [300, 600] inclusive (anti-enumeration timing).
 */
export function randomBlacklistDelayMs(): number {
  return 300 + Math.floor(Math.random() * 301);
}

/**
 * Garante que a duracao total da chamada (sucesso ou falha) seja >= delay
 * aleatorio em [300, 600]ms. Usado nos hooks user-facing para que
 * acerto/falha de blacklist nao sejam distinguiveis por timing.
 */
export async function withTimingParity<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const minMs = randomBlacklistDelayMs();
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    if (elapsed < minMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, minMs - elapsed));
    }
    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    if (elapsed < minMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, minMs - elapsed));
    }
    throw err;
  }
}

// ===================== CSV =====================

/**
 * Escape RFC 4180: campos com separador, " \n \r ficam entre aspas duplas
 * e aspas internas sao duplicadas.
 */
function csvField(v: unknown, sep: string): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  const needsQuoting = s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(sep);
  if (needsQuoting) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const BLACKLIST_CSV_HEADER = [
  'id',
  'type',
  'value',
  'reason',
  'status',
  'created_by_name',
  'created_at',
  'expires_at',
  'removed_by_name',
  'removed_at',
  'source_user_id',
] as const;

/**
 * Gera CSV de export da listagem com BOM UTF-8, separador ';' e RFC 4180.
 * Status e calculado em runtime via classifyEntryStatus.
 * Linhas separadas por '\r\n' (compatibilidade Excel).
 */
export function exportEntriesToCsvString(rows: BlacklistEntry[]): string {
  const sep = ';';
  const bom = '\uFEFF';
  const header = BLACKLIST_CSV_HEADER.join(sep);
  const body = rows
    .map((r) => {
      const status = classifyEntryStatus(r);
      return [
        r.id,
        r.type,
        r.value,
        r.reason,
        status,
        r.created_by_name,
        r.created_at,
        r.expires_at,
        r.removed_by_name,
        r.removed_at,
        r.source_user_id,
      ]
        .map((v) => csvField(v, sep))
        .join(sep);
    })
    .join('\r\n');
  return bom + (rows.length > 0 ? `${header}\r\n${body}` : header);
}

export const BLACKLIST_IMPORT_HEADER = ['type', 'value', 'reason', 'expires_at'] as const;

/**
 * Gera o CSV modelo para download. Cabecalho fixo + 3 linhas de exemplo
 * (uma de cada tipo phone/cpf/email) + 1 linha comentada com '#' para
 * documentar o uso de comentarios.
 */
export function buildImportTemplateCsv(): string {
  const sep = ';';
  const bom = '\uFEFF';
  const header = BLACKLIST_IMPORT_HEADER.join(sep);
  const examples: string[] = [
    ['phone', '64999999999', 'Numero usado em fraude reportada', ''].join(sep),
    ['cpf', '12345678909', 'CPF usado em conta banida', ''].join(sep),
    ['email', 'fraude@exemplo.com', 'E-mail recorrente em tentativas suspeitas', '2026-12-31'].join(
      sep
    ),
    '# Linhas comecadas com # sao ignoradas pelo parser. Use para anotacoes.',
  ];
  return `${bom}${header}\r\n${examples.join('\r\n')}`;
}

/**
 * Faz parse RFC 4180 simplificado de uma unica linha CSV com separador.
 * Suporta aspas duplas, escape de aspas internas (""), e tolera CR final.
 */
function parseCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === sep) {
      out.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  out.push(cur);
  return out;
}

const VALID_BLACKLIST_TYPES: ReadonlySet<string> = new Set([
  'phone',
  'cpf',
  'cnpj',
  'email',
  'ip_address',
]);

/**
 * Faz parse do CSV de import:
 *   - aceita BOM UTF-8 inicial (remove se presente)
 *   - separador ';'
 *   - aceita CRLF ou LF
 *   - linhas comecadas com '#' (apos trim) sao ignoradas
 *   - cabecalho exato 'type;value;reason;expires_at' (ordem fixa)
 *   - aplica blacklistNormalize quando o type e valido, depois blacklistValidate
 *   - expires_at vazio ou whitespace ⇒ null
 *   - type fora do enum ⇒ validation.ok = false
 */
export function parseImportCsv(text: string): {
  rows: BulkImportRow[];
  headerOk: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const rows: BulkImportRow[] = [];

  if (text == null || text.length === 0) {
    return { rows, headerOk: false, errors: ['Arquivo vazio.'] };
  }

  // Remove BOM UTF-8 inicial se presente
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) {
    body = body.slice(1);
  }

  // Normaliza CRLF -> LF para split simples
  const lines = body.split(/\r?\n/);
  if (lines.length === 0) {
    return { rows, headerOk: false, errors: ['Arquivo vazio.'] };
  }

  // Encontra cabecalho (primeira linha nao-comentario, nao-vazia)
  let headerLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) continue;
    headerLineIndex = i;
    break;
  }

  if (headerLineIndex === -1) {
    return { rows, headerOk: false, errors: ['Cabeçalho não encontrado.'] };
  }

  const headerCells = parseCsvLine(lines[headerLineIndex], ';').map((c) => c.trim());
  const expected = BLACKLIST_IMPORT_HEADER;
  const headerOk =
    headerCells.length === expected.length &&
    expected.every((col, idx) => headerCells[idx] === col);

  if (!headerOk) {
    errors.push(
      `Cabeçalho inválido. Esperado: '${expected.join(';')}'. Recebido: '${headerCells.join(';')}'.`
    );
    return { rows, headerOk: false, errors };
  }

  // Processa linhas de dados (apos o cabecalho)
  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) continue;

    const lineNumber = i + 1; // 1-based para apresentacao
    const cells = parseCsvLine(rawLine, ';').map((c) => c.trim());

    const typeCell = cells[0] ?? '';
    const valueCell = cells[1] ?? '';
    const reasonCell = cells[2] ?? '';
    const expiresAtCell = (cells[3] ?? '').trim();
    const expiresAt = expiresAtCell.length === 0 ? null : expiresAtCell;

    const raw = {
      type: typeCell,
      value: valueCell,
      reason: reasonCell,
      expires_at: expiresAt,
    };

    if (!VALID_BLACKLIST_TYPES.has(typeCell)) {
      rows.push({
        lineNumber,
        raw,
        normalized: null,
        validation: {
          ok: false,
          detail: `Tipo inválido: '${typeCell}'. Use phone, cpf, cnpj, email ou ip_address.`,
        },
      });
      continue;
    }

    const type = typeCell as BlacklistType;
    const normalized = blacklistNormalize(type, valueCell);
    const validation = blacklistValidate(type, normalized);

    if (!validation.ok) {
      rows.push({
        lineNumber,
        raw,
        normalized: { type, value: normalized },
        validation: { ok: false, detail: validation.detail },
      });
      continue;
    }

    rows.push({
      lineNumber,
      raw,
      normalized: { type, value: normalized },
      validation: { ok: true },
    });
  }

  return { rows, headerOk: true, errors };
}

/**
 * Gera CSV de relatorio pos-execucao do bulk import.
 * Cabecalho fixo: linha;type;value;reason;expires_at;resultado;detalhe
 *   - resultado: 'inserido' / 'pulado' / 'falhou' / 'invalido'
 *   - detalhe:
 *       - existingId quando skipped (ALREADY_BLACKLISTED)
 *       - reason text quando failed/invalid
 */
export function buildImportReportCsv(rows: BulkImportRow[]): string {
  const sep = ';';
  const bom = '\uFEFF';
  const header = ['linha', 'type', 'value', 'reason', 'expires_at', 'resultado', 'detalhe'].join(
    sep
  );

  const body = rows
    .map((r) => {
      let resultado: string;
      let detalhe = '';
      if (!r.validation.ok) {
        resultado = 'invalido';
        detalhe = r.validation.detail;
      } else if (r.result) {
        if (r.result.status === 'inserted') {
          resultado = 'inserido';
          detalhe = r.result.id;
        } else if (r.result.status === 'skipped') {
          resultado = 'pulado';
          detalhe = r.result.existingId ?? r.result.reason;
        } else {
          resultado = 'falhou';
          detalhe = r.result.detail;
        }
      } else {
        // Linha valida mas sem resultado registrado (operacao nao chegou ao item).
        resultado = 'falhou';
        detalhe = 'Não processado.';
      }

      return [
        r.lineNumber,
        r.raw.type,
        r.raw.value,
        r.raw.reason,
        r.raw.expires_at ?? '',
        resultado,
        detalhe,
      ]
        .map((v) => csvField(v, sep))
        .join(sep);
    })
    .join('\r\n');

  return bom + (rows.length > 0 ? `${header}\r\n${body}` : header);
}

// ===================== URL <-> filtros =====================

const VALID_TYPES_FILTER: ReadonlySet<BlacklistTypeFilter> = new Set<BlacklistTypeFilter>([
  'todos',
  'phone',
  'cpf',
  'cnpj',
  'email',
  'ip_address',
]);

const VALID_STATUS_FILTER: ReadonlySet<BlacklistStatusFilter> = new Set<BlacklistStatusFilter>([
  'todos',
  'ativo',
  'expirado',
  'removido',
]);

const VALID_SORTS: ReadonlySet<BlacklistSort> = new Set<BlacklistSort>([
  'created_desc',
  'created_asc',
  'expires_asc',
  'removed_desc',
]);

const VALID_PAGE_SIZES: ReadonlyArray<number> = [10, 50, 100];

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(s: string | null): string | null {
  if (s == null || !ISO_DATE_REGEX.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/**
 * Le filtros da URL com defaults seguros para valores ausentes/invalidos.
 * Valida dominio fechado de type/status/sort.
 * Valida from/to como ISO date 'YYYY-MM-DD'.
 * pageSize aceita apenas 10/50/100 (defaults pra 10).
 * createdBy/sourceUserId apenas se UUID valido.
 */
export function parseBlacklistFiltersFromQuery(qs: URLSearchParams | string): BlacklistFilters {
  const sp = typeof qs === 'string' ? new URLSearchParams(qs) : qs;

  const type = sp.get('type') as BlacklistTypeFilter | null;
  const status = sp.get('status') as BlacklistStatusFilter | null;
  const sort = sp.get('sort') as BlacklistSort | null;

  const createdByRaw = sp.get('createdBy');
  const createdBy = createdByRaw && isUuid(createdByRaw) ? createdByRaw : null;

  const sourceUserIdRaw = sp.get('sourceUserId');
  const sourceUserId = sourceUserIdRaw && isUuid(sourceUserIdRaw) ? sourceUserIdRaw : null;

  const page = parseInt(sp.get('page') ?? '', 10);
  const pageSizeRaw = parseInt(sp.get('pageSize') ?? '', 10);
  const pageSize = VALID_PAGE_SIZES.includes(pageSizeRaw)
    ? pageSizeRaw
    : DEFAULT_BLACKLIST_FILTERS.pageSize;

  return {
    type: type && VALID_TYPES_FILTER.has(type) ? type : DEFAULT_BLACKLIST_FILTERS.type,
    status: status && VALID_STATUS_FILTER.has(status) ? status : DEFAULT_BLACKLIST_FILTERS.status,
    createdBy,
    from: parseIsoDate(sp.get('from')),
    to: parseIsoDate(sp.get('to')),
    q: sp.get('q') ?? DEFAULT_BLACKLIST_FILTERS.q,
    sort: sort && VALID_SORTS.has(sort) ? sort : DEFAULT_BLACKLIST_FILTERS.sort,
    page: Number.isFinite(page) && page >= 1 ? page : DEFAULT_BLACKLIST_FILTERS.page,
    pageSize,
    sourceUserId,
  };
}

/**
 * Serializa filtros para URLSearchParams. Omite valores default
 * para manter a URL limpa.
 */
export function serializeBlacklistFiltersToQuery(f: BlacklistFilters): URLSearchParams {
  const sp = new URLSearchParams();
  const d = DEFAULT_BLACKLIST_FILTERS;

  if (f.type !== d.type) sp.set('type', f.type);
  if (f.status !== d.status) sp.set('status', f.status);
  if (f.createdBy) sp.set('createdBy', f.createdBy);
  if (f.from) sp.set('from', f.from);
  if (f.to) sp.set('to', f.to);
  if (f.q && f.q !== d.q) sp.set('q', f.q);
  if (f.sort !== d.sort) sp.set('sort', f.sort);
  if (f.page !== d.page) sp.set('page', String(f.page));
  if (f.pageSize !== d.pageSize) sp.set('pageSize', String(f.pageSize));
  if (f.sourceUserId) sp.set('sourceUserId', f.sourceUserId);

  return sp;
}

// ===================== Constantes internas =====================

/**
 * SELECT com JOIN explicito das duas FKs para users (PostgREST exige
 * desambiguacao porque ha mais de uma FK admin_blacklist -> users).
 */
const BLACKLIST_SELECT_COLS = `
  id, type, value, reason, expires_at, source_user_id,
  created_by, created_at, updated_at,
  removed_at, removed_by, removed_reason,
  created_by_user:users!admin_blacklist_created_by_fkey(name),
  removed_by_user:users!admin_blacklist_removed_by_fkey(name)
`;

const ATTEMPTS_PAGE_SIZE = 10;

const ATTEMPTS_ACTIONS: ReadonlyArray<BlacklistAttempt['action']> = [
  'BLACKLIST_LOGIN_BLOCKED',
  'BLACKLIST_SIGNUP_BLOCKED',
  'BLACKLIST_EMAIL_BLOCKED',
];

const HISTORY_ACTIONS: ReadonlyArray<string> = [
  'BLACKLIST_CREATED',
  'BLACKLIST_CREATED_SKIPPED',
  'BLACKLIST_UPDATED',
  'BLACKLIST_UPDATE_STALE_VERSION',
  'BLACKLIST_REMOVED',
  'BLACKLIST_REMOVED_SKIPPED',
  'BLACKLIST_REACTIVATED',
];

const HISTORY_LIMIT = 50;

/**
 * Escape de virgulas e percent em filtros .or() do PostgREST
 * (no estilo do fretes.ts::escapeOr).
 */
function escapeOr(s: string): string {
  return s.replace(/,/g, '\\,').replace(/%/g, '\\%');
}

// ===================== Mapeamento DB -> Entry =====================

interface BlacklistDbRow {
  id: string;
  type: string;
  value: string;
  reason: string;
  expires_at: string | null;
  source_user_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
  removed_by: string | null;
  removed_reason: string | null;
  created_by_user: { name: string | null } | { name: string | null }[] | null;
  removed_by_user: { name: string | null } | { name: string | null }[] | null;
}

function pickUserName(
  rel: { name: string | null } | { name: string | null }[] | null | undefined
): string | null {
  if (!rel) return null;
  const obj = Array.isArray(rel) ? rel[0] : rel;
  return obj?.name ?? null;
}

function dbRowToBlacklistEntry(r: BlacklistDbRow): BlacklistEntry {
  return {
    id: r.id,
    type: r.type as BlacklistType,
    value: r.value,
    reason: r.reason,
    expires_at: r.expires_at,
    source_user_id: r.source_user_id,
    created_by: r.created_by,
    created_by_name: pickUserName(r.created_by_user),
    created_at: r.created_at,
    updated_at: r.updated_at,
    removed_at: r.removed_at,
    removed_by: r.removed_by,
    removed_by_name: pickUserName(r.removed_by_user),
    removed_reason: r.removed_reason,
  };
}

// ===================== 3.1 Listagem =====================

/**
 * Lista entradas da blacklist com filtros, busca, ordenacao e paginacao.
 *
 * Filtros:
 *  - type: igualdade direta quando nao 'todos'
 *  - status: derivado a partir de removed_at + expires_at + NOW()
 *  - createdBy: igualdade
 *  - from / to: faixa em created_at (UTC, dia inteiro)
 *  - q: ILIKE em value e reason; quando q normalizado para digitos tem
 *    length >= 8, OR adicional contra value (digits-only)
 *  - sourceUserId: igualdade (usado pelo fluxo de unban)
 *
 * Ordenacao:
 *  - created_desc | created_asc
 *  - expires_asc (nullsFirst: false)
 *  - removed_desc (nullsFirst: false)
 *
 * Total via count: 'exact'. RLS filtra silenciosamente quando o admin
 * nao tem BLACKLIST_VIEW.
 */
export async function listEntries(filters: BlacklistFilters): Promise<BlacklistListResult> {
  let query = supabase.from('admin_blacklist').select(BLACKLIST_SELECT_COLS, { count: 'exact' });

  // type
  if (filters.type !== 'todos') {
    query = query.eq('type', filters.type);
  }

  // status (derivado em runtime via SQL)
  const nowIso = new Date().toISOString();
  switch (filters.status) {
    case 'ativo':
      query = query.is('removed_at', null).or(`expires_at.is.null,expires_at.gt.${nowIso}`);
      break;
    case 'expirado':
      query = query.is('removed_at', null).not('expires_at', 'is', null).lte('expires_at', nowIso);
      break;
    case 'removido':
      query = query.not('removed_at', 'is', null);
      break;
    case 'todos':
    default:
      break;
  }

  // createdBy
  if (filters.createdBy) {
    query = query.eq('created_by', filters.createdBy);
  }

  // periodo
  if (filters.from) {
    query = query.gte('created_at', `${filters.from}T00:00:00Z`);
  }
  if (filters.to) {
    query = query.lte('created_at', `${filters.to}T23:59:59Z`);
  }

  // sourceUserId
  if (filters.sourceUserId) {
    query = query.eq('source_user_id', filters.sourceUserId);
  }

  // busca livre
  const qTrim = filters.q.trim();
  if (qTrim.length > 0) {
    const e = escapeOr(qTrim);
    const orParts = [`value.ilike.%${e}%`, `reason.ilike.%${e}%`];
    const digitsOnly = qTrim.replace(/\D/g, '');
    if (digitsOnly.length >= 8) {
      orParts.push(`value.ilike.%${escapeOr(digitsOnly)}%`);
    }
    query = query.or(orParts.join(','));
  }

  // ordenacao
  switch (filters.sort) {
    case 'created_desc':
      query = query.order('created_at', { ascending: false });
      break;
    case 'created_asc':
      query = query.order('created_at', { ascending: true });
      break;
    case 'expires_asc':
      query = query.order('expires_at', { ascending: true, nullsFirst: false });
      break;
    case 'removed_desc':
      query = query.order('removed_at', { ascending: false, nullsFirst: false });
      break;
  }

  // paginacao
  const fromIdx = (filters.page - 1) * filters.pageSize;
  query = query.range(fromIdx, fromIdx + filters.pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as unknown as BlacklistDbRow[]).map(dbRowToBlacklistEntry);
  return {
    rows,
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

// ===================== 3.2 Detalhe =====================

interface AttemptDbRow {
  id: string;
  action: string;
  created_at: string;
  ip: string | null;
  user_agent: string | null;
}

interface HistoryDbRow {
  id: string;
  admin_id: string | null;
  action: string;
  created_at: string;
  before_data: unknown;
  after_data: unknown;
  users: { name: string | null } | { name: string | null }[] | null;
}

interface SourceUserDbRow {
  id: string;
  name: string;
  user_type: string;
  is_active: boolean;
  banned_at: string | null;
}

/**
 * Carrega bundle agregado da entrada, com degradacao parcial:
 *   - falha na entrada principal       -> throw NOT_FOUND
 *   - falha em sourceUser/attempts/history -> entry continua, errors[bloco] preenchido
 *
 * UUID invalido: throw NOT_FOUND sem chamar o banco.
 *
 * Tentativas paginadas em 10 por pagina, ordenadas por created_at DESC.
 * Historico limitado a 50 itens, com JOIN users:admin_id(name) para nome do admin.
 */
export async function getBlacklistDetail(
  id: string,
  attemptsPage: number = 1
): Promise<BlacklistDetailBundle> {
  if (!isUuid(id)) {
    throw new BlacklistServiceError('NOT_FOUND');
  }

  // 1) Entrada principal (fonte da verdade)
  const { data: entryData, error: entryErr } = await supabase
    .from('admin_blacklist')
    .select(BLACKLIST_SELECT_COLS)
    .eq('id', id)
    .maybeSingle();

  if (entryErr || !entryData) {
    throw new BlacklistServiceError('NOT_FOUND', undefined, entryErr);
  }

  const entry = dbRowToBlacklistEntry(entryData as unknown as BlacklistDbRow);

  // 2) Demais blocos em paralelo
  const attemptsFrom = (attemptsPage - 1) * ATTEMPTS_PAGE_SIZE;

  const [sourceUserRes, attemptsRes, historyRes] = await Promise.allSettled([
    entry.source_user_id
      ? supabase
          .from('users')
          .select('id, name, user_type, is_active, banned_at')
          .eq('id', entry.source_user_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('admin_audit_logs')
      .select('id, action, created_at, ip, user_agent', { count: 'exact' })
      .eq('target_type', 'admin_blacklist')
      .eq('target_id', id)
      .in('action', ATTEMPTS_ACTIONS as unknown as string[])
      .order('created_at', { ascending: false })
      .range(attemptsFrom, attemptsFrom + ATTEMPTS_PAGE_SIZE - 1),
    supabase
      .from('admin_audit_logs')
      .select('id, admin_id, action, created_at, before_data, after_data, users:admin_id(name)')
      .eq('target_type', 'admin_blacklist')
      .eq('target_id', id)
      .in('action', HISTORY_ACTIONS as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);

  const errors: BlacklistDetailBundle['errors'] = {};

  // sourceUser
  let sourceUser: BlacklistSourceUser | null = null;
  if (sourceUserRes.status === 'fulfilled') {
    const res = sourceUserRes.value;
    if (!res.error && res.data) {
      const u = res.data as unknown as SourceUserDbRow;
      if (u.user_type === 'motorista' || u.user_type === 'embarcador') {
        sourceUser = {
          id: u.id,
          name: u.name,
          type: u.user_type,
          is_active: u.is_active,
          banned_at: u.banned_at,
        };
      }
    } else if (res.error) {
      errors.sourceUser = String(res.error.message ?? res.error);
    }
  } else {
    errors.sourceUser = String(sourceUserRes.reason);
  }

  // attempts
  let attempts: BlacklistAttempt[] = [];
  let attemptsTotal = 0;
  if (attemptsRes.status === 'fulfilled' && !attemptsRes.value.error) {
    attemptsTotal = attemptsRes.value.count ?? 0;
    const rows = (attemptsRes.value.data ?? []) as unknown as AttemptDbRow[];
    attempts = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      action: r.action as BlacklistAttempt['action'],
      ip: r.ip,
      user_agent: r.user_agent,
    }));
  } else if (attemptsRes.status === 'rejected') {
    errors.attempts = String(attemptsRes.reason);
  } else if (attemptsRes.value.error) {
    errors.attempts = String(attemptsRes.value.error.message ?? attemptsRes.value.error);
  }

  // history
  let history: BlacklistAuditEntry[] = [];
  if (historyRes.status === 'fulfilled' && !historyRes.value.error) {
    const rows = (historyRes.value.data ?? []) as unknown as HistoryDbRow[];
    history = rows.map((h) => ({
      id: h.id,
      admin_id: h.admin_id,
      admin_name: pickUserName(h.users),
      action: h.action,
      created_at: h.created_at,
      before_data: h.before_data,
      after_data: h.after_data,
    }));
  } else if (historyRes.status === 'rejected') {
    errors.history = String(historyRes.reason);
  } else if (historyRes.value.error) {
    errors.history = String(historyRes.value.error.message ?? historyRes.value.error);
  }

  return {
    entry,
    status: classifyEntryStatus(entry),
    sourceUser,
    attempts,
    attemptsTotal,
    attemptsPage,
    attemptsPageSize: ATTEMPTS_PAGE_SIZE,
    history,
    errors,
  };
}

// ===================== 3.3 Wrapper user-facing: is_blacklisted =====================

/**
 * Consulta a RPC is_blacklisted (SECURITY DEFINER, GRANT anon+authenticated).
 *
 * Sem timeout interno: o caller (LoginForm/RegisterForm/ModalVerificacaoEmail)
 * controla via Promise.race com 3s e degradacao fail-open documentada
 * (defesa em profundidade no trigger BEFORE INSERT cobre o bypass).
 *
 * Normalizacao acontece no servidor (blacklist_normalize), nao chamamos
 * blacklistNormalize TS aqui para garantir paridade exata.
 */
export async function isBlacklisted(type: BlacklistType, valueRaw: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_blacklisted', {
    p_type: type,
    p_value: valueRaw,
  });
  if (error) throw error;
  return Boolean(data);
}

// ===================== 3.4 Wrapper user-facing: log_blacklist_block =====================

/**
 * Registra um bloqueio user-facing via RPC log_blacklist_block.
 * Erros sao engolidos silenciosamente: falha de log NAO bloqueia
 * o fluxo do usuario (best-effort).
 */
export async function logBlacklistBlock(
  action: BlacklistAttempt['action'],
  type: BlacklistType,
  valueRaw: string,
  ip?: string | null,
  userAgent?: string | null
): Promise<void> {
  try {
    await supabase.rpc('log_blacklist_block', {
      p_action: action,
      p_type: type,
      p_value: valueRaw,
      p_ip: ip ?? null,
      p_user_agent: userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
    });
  } catch {
    // best-effort: nao propaga falha de log
  }
}

// ===================== Epic 4: mutacoes single =====================

/**
 * Mapeia mensagens de erro de RPC SQL (RAISE EXCEPTION) para
 * BlacklistServiceError tipados. Devolve null quando nao reconhece
 * o padrao para que o caller propague o erro original.
 *
 * Padroes reconhecidos (035):
 *   - 'MASTER_PROTECTED'                  -> MASTER_PROTECTED
 *   - 'permission_denied: ...'            -> PERMISSION_DENIED
 *   - 'ALREADY_BLACKLISTED: <uuid> (...)' -> ALREADY_BLACKLISTED
 *   - 'NOT_FOUND'                         -> NOT_FOUND
 *   - 'ALREADY_REMOVED'                   -> ALREADY_REMOVED
 *   - 'STALE_VERSION: ...'                -> STALE_VERSION
 *   - 'INVALID_INPUT: ...'                -> INVALID_INPUT
 */
function parseRpcError(err: unknown): BlacklistServiceError | null {
  const msg = ((err as { message?: unknown })?.message ?? '') as string;
  if (typeof msg !== 'string' || msg.length === 0) return null;

  if (msg.includes('MASTER_PROTECTED')) {
    return new BlacklistServiceError('MASTER_PROTECTED', undefined, err);
  }
  if (msg.includes('permission_denied')) {
    return new BlacklistServiceError('PERMISSION_DENIED', undefined, err);
  }
  // ALREADY_BLACKLISTED: <uuid> (status=active|removed)
  const alreadyMatch = msg.match(
    /ALREADY_BLACKLISTED:\s*([0-9a-f-]{36})(?:\s*\(status=([a-z_]+)\))?/i
  );
  if (alreadyMatch) {
    const existingId = alreadyMatch[1];
    const status = (alreadyMatch[2] ?? 'active').toLowerCase();
    return new BlacklistServiceError('ALREADY_BLACKLISTED', undefined, err, {
      existingId,
      removed: status === 'removed',
    });
  }
  if (/^|\W STALE_VERSION/.test(msg) || msg.includes('STALE_VERSION')) {
    return new BlacklistServiceError('STALE_VERSION', undefined, err);
  }
  if (msg.includes('ALREADY_REMOVED')) {
    return new BlacklistServiceError('ALREADY_REMOVED', undefined, err);
  }
  if (msg.includes('NOT_FOUND')) {
    return new BlacklistServiceError('NOT_FOUND', undefined, err);
  }
  if (msg.includes('INVALID_INPUT')) {
    // Mensagem do servidor apos 'INVALID_INPUT:' (se houver)
    const idx = msg.indexOf('INVALID_INPUT');
    const detail = msg
      .slice(idx)
      .replace(/^INVALID_INPUT:?\s*/i, '')
      .trim();
    return new BlacklistServiceError('INVALID_INPUT', detail.length > 0 ? detail : undefined, err);
  }
  return null;
}

/**
 * Validacao local do payload de adicao/atualizacao.
 *   - reason: trim 1..1000
 *   - expiresAt: opcional; se presente, ISO parseavel e > NOW()
 *
 * Lanca BlacklistServiceError(INVALID_INPUT) na primeira regra falha.
 */
function validateReasonAndExpires(payload: { reason: string; expiresAt: string | null }): {
  reasonTrim: string;
  expiresAt: string | null;
} {
  if (typeof payload.reason !== 'string') {
    throw new BlacklistServiceError('INVALID_INPUT', 'Motivo é obrigatório.');
  }
  const reasonTrim = payload.reason.trim();
  if (reasonTrim.length < 1 || reasonTrim.length > 1000) {
    throw new BlacklistServiceError('INVALID_INPUT', 'Motivo deve ter entre 1 e 1000 caracteres.');
  }
  if (payload.expiresAt != null) {
    const t = Date.parse(payload.expiresAt);
    if (Number.isNaN(t) || t <= Date.now()) {
      throw new BlacklistServiceError('INVALID_INPUT', 'Expiração deve ser uma data futura.');
    }
  }
  return { reasonTrim, expiresAt: payload.expiresAt };
}

// ===================== 4.1 addEntry =====================

/**
 * Adiciona uma entrada manual a admin_blacklist.
 *
 * Validacao local fail-fast (lanca antes de qualquer chamada ao banco):
 *   - blacklistNormalize + blacklistValidate em (type, valueRaw)
 *   - reason 1..1000 chars apos trim
 *   - expiresAt opcional, ISO futuro quando preenchido
 *   - sourceUserId opcional, UUID quando preenchido
 *
 * executeAdminMutation envolve a chamada com action='BLACKLIST_CREATED'.
 *
 * Mapeamento de erros da RPC:
 *   - MASTER_PROTECTED       -> BlacklistServiceError(MASTER_PROTECTED) +
 *                               audit log secundario BLACKLIST_CREATED_SKIPPED
 *                               (after.reason='MASTER_PROTECTED'), best-effort
 *   - ALREADY_BLACKLISTED    -> BlacklistServiceError(ALREADY_BLACKLISTED,
 *                               extra={existingId, removed: status==='removed'}) +
 *                               audit log secundario BLACKLIST_CREATED_SKIPPED
 *                               (targetId=existingId, after={reason, existing_id, status}),
 *                               best-effort
 *   - permission_denied      -> PERMISSION_DENIED
 *   - INVALID_INPUT          -> INVALID_INPUT (com message do server)
 *   - desconhecidos          -> rethrow original
 */
export async function addEntry(payload: BlacklistAddPayload): Promise<{ id: string }> {
  // 1) Validacao local
  const normalized = blacklistNormalize(payload.type, payload.valueRaw);
  const validation = blacklistValidate(payload.type, normalized);
  if (!validation.ok) {
    throw new BlacklistServiceError('INVALID_INPUT', validation.detail);
  }

  const { reasonTrim, expiresAt } = validateReasonAndExpires({
    reason: payload.reason,
    expiresAt: payload.expiresAt,
  });

  if (payload.sourceUserId != null && !isUuid(payload.sourceUserId)) {
    throw new BlacklistServiceError('INVALID_INPUT', 'sourceUserId inválido.');
  }

  // 2) Executa via wrapper de audit
  try {
    const result = await executeAdminMutation<{ id: string }>(
      {
        action: 'BLACKLIST_CREATED',
        targetType: 'admin_blacklist',
        targetId: null,
        before: null,
        after: {
          type: payload.type,
          value: normalized,
          reason: reasonTrim,
          expires_at: expiresAt,
          source_user_id: payload.sourceUserId,
        },
      },
      async () => {
        const { data, error } = await supabase.rpc('admin_blacklist_add', {
          p_type: payload.type,
          p_value: payload.valueRaw,
          p_reason: reasonTrim,
          p_expires_at: expiresAt,
          p_source_user_id: payload.sourceUserId,
        });

        if (error) {
          const mapped = parseRpcError(error);
          if (mapped) throw mapped;
          throw error;
        }

        const id =
          data && typeof data === 'object' && 'id' in (data as Record<string, unknown>)
            ? (((data as Record<string, unknown>).id as string) ?? '')
            : '';
        return { id };
      }
    );
    return result;
  } catch (err) {
    // 3) Audit log secundario para skips conhecidos (best-effort)
    if (err instanceof BlacklistServiceError) {
      if (err.code === 'ALREADY_BLACKLISTED') {
        const existingId = (err.extra?.existingId as string | undefined) ?? null;
        const removed = Boolean(err.extra?.removed);
        await logAdminAction({
          action: 'BLACKLIST_CREATED_SKIPPED',
          targetType: 'admin_blacklist',
          targetId: existingId,
          before: null,
          after: {
            reason: 'ALREADY_BLACKLISTED',
            existing_id: existingId,
            status: removed ? 'removed' : 'active',
          },
        }).catch(() => null);
      } else if (err.code === 'MASTER_PROTECTED') {
        await logAdminAction({
          action: 'BLACKLIST_CREATED_SKIPPED',
          targetType: 'admin_blacklist',
          targetId: null,
          before: null,
          after: { reason: 'MASTER_PROTECTED' },
        }).catch(() => null);
      }
    }
    throw err;
  }
}

// ===================== 4.2 updateEntry =====================

/**
 * Atualiza reason e expires_at de uma entrada ativa, com versionamento
 * otimista via expectedUpdatedAt.
 *
 * Mapeamento de erros da RPC admin_blacklist_update:
 *   - NOT_FOUND        -> NOT_FOUND
 *   - ALREADY_REMOVED  -> ALREADY_REMOVED
 *   - STALE_VERSION    -> STALE_VERSION + audit log secundario best-effort
 *                          BLACKLIST_UPDATE_STALE_VERSION
 *   - INVALID_INPUT    -> INVALID_INPUT (com message do server)
 *   - permission_denied -> PERMISSION_DENIED
 *
 * Sucesso: { updated: true, updated_at }.
 *
 * Snapshot de before: nao temos os valores antigos sem fetch previo;
 * deixamos como null e documentamos. UI pode capturar before via
 * BlacklistDetailBundle ja carregado.
 */
export async function updateEntry(
  id: string,
  payload: BlacklistUpdatePayload,
  expectedUpdatedAt: string
): Promise<{ updated: true; updated_at: string }> {
  if (!isUuid(id)) {
    throw new BlacklistServiceError('INVALID_INPUT', 'id inválido.');
  }
  const { reasonTrim, expiresAt } = validateReasonAndExpires(payload);

  try {
    const result = await executeAdminMutation<{ updated: true; updated_at: string }>(
      {
        action: 'BLACKLIST_UPDATED',
        targetType: 'admin_blacklist',
        targetId: id,
        before: null,
        after: { reason: reasonTrim, expires_at: expiresAt },
      },
      async () => {
        const { data, error } = await supabase.rpc('admin_blacklist_update', {
          p_id: id,
          p_reason: reasonTrim,
          p_expires_at: expiresAt,
          p_expected_updated_at: expectedUpdatedAt,
        });
        if (error) {
          const mapped = parseRpcError(error);
          if (mapped) throw mapped;
          throw error;
        }
        const updatedAt =
          data && typeof data === 'object' && 'updated_at' in (data as Record<string, unknown>)
            ? (((data as Record<string, unknown>).updated_at as string) ?? '')
            : '';
        return { updated: true as const, updated_at: updatedAt };
      }
    );
    return result;
  } catch (err) {
    if (err instanceof BlacklistServiceError && err.code === 'STALE_VERSION') {
      await logAdminAction({
        action: 'BLACKLIST_UPDATE_STALE_VERSION',
        targetType: 'admin_blacklist',
        targetId: id,
        before: { expected_updated_at: expectedUpdatedAt },
        after: { reason: 'STALE_VERSION' },
      }).catch(() => null);
    }
    throw err;
  }
}

// ===================== 4.3 reactivateEntry =====================

/**
 * Reativa uma entrada removida (reverte removed_at/removed_by/removed_reason)
 * e atualiza reason/expires_at.
 *
 * Mapeamento de erros (mesmo de update + ALREADY_BLACKLISTED para o caso
 * em que outra entrada ativa em (type, value) surgiu durante a janela
 * em que esta estava removida):
 *   - NOT_FOUND, STALE_VERSION, INVALID_INPUT, permission_denied -> idem
 *   - ALREADY_BLACKLISTED -> com extra.existingId
 *
 * Sucesso: { reactivated: true, updated_at }.
 */
export async function reactivateEntry(
  id: string,
  payload: BlacklistUpdatePayload,
  expectedUpdatedAt: string
): Promise<{ reactivated: true; updated_at: string }> {
  if (!isUuid(id)) {
    throw new BlacklistServiceError('INVALID_INPUT', 'id inválido.');
  }
  const { reasonTrim, expiresAt } = validateReasonAndExpires(payload);

  return executeAdminMutation<{ reactivated: true; updated_at: string }>(
    {
      action: 'BLACKLIST_REACTIVATED',
      targetType: 'admin_blacklist',
      targetId: id,
      before: null,
      after: { reason: reasonTrim, expires_at: expiresAt, removed_at: null },
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_blacklist_reactivate', {
        p_id: id,
        p_reason: reasonTrim,
        p_expires_at: expiresAt,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) {
        const mapped = parseRpcError(error);
        if (mapped) throw mapped;
        throw error;
      }
      const updatedAt =
        data && typeof data === 'object' && 'updated_at' in (data as Record<string, unknown>)
          ? (((data as Record<string, unknown>).updated_at as string) ?? '')
          : '';
      return { reactivated: true as const, updated_at: updatedAt };
    }
  );
}

// ===================== 4.4 removeEntry (soft delete idempotente) =====================

interface RemoveSnapshotRow {
  id: string;
  type: string;
  value: string;
  reason: string;
  expires_at: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removed_reason: string | null;
}

/**
 * Remove (soft delete) uma entrada. Idempotente.
 *
 * Validacao local: options.reason opcional, <= 1000 chars
 * (lanca INVALID_INPUT quando excede).
 *
 * Pre-fetch da entrada:
 *   - se NAO existe                -> throw NOT_FOUND
 *   - se ja removida (removed_at)  -> grava audit log BLACKLIST_REMOVED_SKIPPED
 *                                     com before/after, retorna skip SEM RPC
 *
 * Caso contrario: executeAdminMutation com action='BLACKLIST_REMOVED',
 * before=snapshot completo, after={removed_at, removed_by, removed_reason}.
 *
 * Mapeamento de erros da RPC admin_blacklist_remove:
 *   - NOT_FOUND        -> NOT_FOUND
 *   - permission_denied -> PERMISSION_DENIED
 *   - desconhecidos    -> rethrow
 */
export async function removeEntry(
  id: string,
  options: { reason?: string } = {}
): Promise<{ removed: true } | { skipped: true; reason: 'ALREADY_REMOVED' }> {
  if (!isUuid(id)) {
    throw new BlacklistServiceError('INVALID_INPUT', 'id inválido.');
  }
  if (typeof options.reason === 'string' && options.reason.length > 1000) {
    throw new BlacklistServiceError(
      'INVALID_INPUT',
      'Motivo de remoção deve ter no máximo 1000 caracteres.'
    );
  }

  // Pre-fetch
  const { data: existing, error: fetchErr } = await supabase
    .from('admin_blacklist')
    .select('id, type, value, reason, expires_at, removed_at, removed_by, removed_reason')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!existing) {
    throw new BlacklistServiceError('NOT_FOUND');
  }

  const snap = existing as RemoveSnapshotRow;

  // Idempotencia: ja removida
  if (snap.removed_at != null) {
    await logAdminAction({
      action: 'BLACKLIST_REMOVED_SKIPPED',
      targetType: 'admin_blacklist',
      targetId: id,
      before: { removed_at: snap.removed_at },
      after: { reason: 'ALREADY_REMOVED' },
    }).catch(() => null);
    return { skipped: true as const, reason: 'ALREADY_REMOVED' as const };
  }

  // Captura o admin caller para preencher after.removed_by no audit log
  const { data: userData } = await supabase.auth.getUser();
  const adminId = userData?.user?.id ?? null;
  const removeReason =
    typeof options.reason === 'string' && options.reason.trim().length > 0
      ? options.reason.trim()
      : null;
  const nowIso = new Date().toISOString();

  await executeAdminMutation<void>(
    {
      action: 'BLACKLIST_REMOVED',
      targetType: 'admin_blacklist',
      targetId: id,
      before: {
        id: snap.id,
        type: snap.type,
        value: snap.value,
        reason: snap.reason,
        expires_at: snap.expires_at,
        removed_at: snap.removed_at,
        removed_by: snap.removed_by,
        removed_reason: snap.removed_reason,
      },
      after: {
        removed_at: nowIso,
        removed_by: adminId,
        removed_reason: removeReason,
      },
    },
    async () => {
      const { error } = await supabase.rpc('admin_blacklist_remove', {
        p_id: id,
        p_remove_reason: options.reason ?? null,
      });
      if (error) {
        const mapped = parseRpcError(error);
        if (mapped) throw mapped;
        throw error;
      }
    }
  );

  return { removed: true as const };
}

// ===================== Epic 5: bulk + export =====================

/**
 * Helper interno de pool de concorrencia.
 * Processa items em batches sequenciais de tamanho `concurrency`,
 * usando Promise.allSettled em cada batch. A ordem dos resultados
 * espelha exatamente a ordem de items[].
 *
 * Reusado por bulkRemove (5.1) e bulkImport (5.2). Sem libs externas.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(worker));
    results.push(...settled);
  }
  return results;
}

const BULK_REMOVE_LIMIT = 200;
const BULK_IMPORT_LIMIT = 1000;
const BULK_CONCURRENCY = 5;
const EXPORT_HARD_LIMIT = 10000;
const EXPORT_PAGE_SIZE = 100;

// ===================== 5.1 bulkRemove =====================

/**
 * Remove (soft delete) varias entradas em uma unica operacao.
 *
 * Validacao:
 *   - ids.length <= 200 ⇒ BULK_LIMIT_EXCEEDED
 *   - options.reason opcional, <= 1000 chars ⇒ INVALID_INPUT
 *
 * Estrategia: pool de concorrencia 5 via Promise.allSettled (ver
 * runWithConcurrency). Cada id e processado por removeEntry(id, options),
 * que ja gera audit log proprio (BLACKLIST_REMOVED ou BLACKLIST_REMOVED_SKIPPED).
 * O bulk NAO emite log agregado proprio.
 *
 * Mapeamento dos resultados:
 *   - { removed: true }                        ⇒ success.push(id)
 *   - { skipped: true, reason: 'ALREADY_REMOVED' } ⇒ skipped.push({ id, ... })
 *   - rejected                                 ⇒ failed.push({ id, reason: msg })
 */
export async function bulkRemove(
  ids: string[],
  options: { reason?: string } = {}
): Promise<BulkRemoveResult> {
  if (ids.length > BULK_REMOVE_LIMIT) {
    throw new BlacklistServiceError(
      'BULK_LIMIT_EXCEEDED',
      `Máximo de ${BULK_REMOVE_LIMIT} itens por operação.`
    );
  }
  if (typeof options.reason === 'string' && options.reason.length > 1000) {
    throw new BlacklistServiceError(
      'INVALID_INPUT',
      'Motivo de remoção deve ter no máximo 1000 caracteres.'
    );
  }

  const settled = await runWithConcurrency(ids, BULK_CONCURRENCY, (id) => removeEntry(id, options));

  const success: string[] = [];
  const skipped: { id: string; reason: 'ALREADY_REMOVED' }[] = [];
  const failed: { id: string; reason: string }[] = [];

  ids.forEach((id, idx) => {
    const r = settled[idx];
    if (r.status === 'fulfilled') {
      const value = r.value;
      if ('removed' in value) {
        success.push(id);
      } else if ('skipped' in value) {
        skipped.push({ id, reason: 'ALREADY_REMOVED' });
      } else {
        // Defensivo: shape inesperado
        failed.push({ id, reason: 'UNKNOWN_RESULT' });
      }
    } else {
      const errMsg = (r.reason as { message?: unknown } | null | undefined)?.message;
      failed.push({
        id,
        reason: typeof errMsg === 'string' ? errMsg : String(r.reason),
      });
    }
  });

  return { success, skipped, failed };
}

// ===================== 5.2 bulkImport =====================

/**
 * Importa entradas de blacklist em massa a partir de linhas ja parseadas
 * (BulkImportRow[]) — tipicamente saida de parseImportCsv.
 *
 * Validacao:
 *   - rows.length <= 1000 ⇒ BULK_LIMIT_EXCEEDED
 *
 * 1 audit log header BLACKLIST_BULK_IMPORT no inicio com counts agregados
 * (best-effort: try/catch, falha de log nao bloqueia).
 *
 * Linhas com validation.ok = false: result preenchido inline com
 * status='failed' e detail=validation.detail, SEM chamar a RPC.
 *
 * Linhas validas: pool de concorrencia 5 invocando addEntry. Cada
 * addEntry interno ja gera seu proprio audit log (BLACKLIST_CREATED
 * ou BLACKLIST_CREATED_SKIPPED), portanto NAO duplicamos aqui.
 *
 * Mapeamento por linha valida:
 *   - sucesso                         ⇒ status='inserted', id
 *   - ALREADY_BLACKLISTED             ⇒ status='skipped', reason, existingId
 *   - MASTER_PROTECTED                ⇒ status='skipped', reason
 *   - outros erros                    ⇒ status='failed', detail
 *
 * As linhas sao mutadas in-place. inserted/skipped/failed sao agregados
 * apos o processamento.
 */
export async function bulkImport(rows: BulkImportRow[]): Promise<BulkImportResult> {
  if (rows.length > BULK_IMPORT_LIMIT) {
    throw new BlacklistServiceError(
      'BULK_LIMIT_EXCEEDED',
      `Máximo de ${BULK_IMPORT_LIMIT} linhas por importação.`
    );
  }

  const total = rows.length;
  const valid = rows.filter((r) => r.validation.ok).length;
  const invalid = total - valid;

  // Audit log header best-effort: falha de log nao bloqueia o import
  try {
    await logAdminAction({
      action: 'BLACKLIST_BULK_IMPORT',
      targetType: 'admin_blacklist',
      targetId: null,
      after: { total_rows: total, valid_count: valid, invalid_count: invalid },
    });
  } catch {
    // best-effort
  }

  // Linhas invalidas: marca result imediatamente, sem chamar RPC
  for (const r of rows) {
    if (!r.validation.ok) {
      r.result = { status: 'failed', detail: r.validation.detail };
    }
  }

  // Linhas validas (com normalized resolvido): pool de concorrencia 5
  const validRows = rows.filter((r) => r.validation.ok && r.normalized != null);

  await runWithConcurrency(validRows, BULK_CONCURRENCY, async (r) => {
    if (!r.normalized) {
      r.result = { status: 'failed', detail: 'Linha sem normalização.' };
      return;
    }
    try {
      const { id } = await addEntry({
        type: r.normalized.type,
        valueRaw: r.normalized.value,
        reason: r.raw.reason,
        expiresAt: r.raw.expires_at,
        sourceUserId: null,
      });
      r.result = { status: 'inserted', id };
    } catch (err) {
      if (err instanceof BlacklistServiceError) {
        if (err.code === 'ALREADY_BLACKLISTED') {
          const existingId = err.extra?.existingId as string | undefined;
          r.result = {
            status: 'skipped',
            reason: 'ALREADY_BLACKLISTED',
            existingId,
          };
          return;
        }
        if (err.code === 'MASTER_PROTECTED') {
          r.result = { status: 'skipped', reason: 'MASTER_PROTECTED' };
          return;
        }
        r.result = { status: 'failed', detail: err.message };
        return;
      }
      const msg = (err as { message?: unknown } | null | undefined)?.message;
      r.result = {
        status: 'failed',
        detail: typeof msg === 'string' ? msg : String(err),
      };
    }
  });

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of rows) {
    if (!r.result) continue;
    if (r.result.status === 'inserted') inserted++;
    else if (r.result.status === 'skipped') skipped++;
    else if (r.result.status === 'failed') failed++;
  }

  return {
    total,
    valid,
    invalid,
    inserted,
    skipped,
    failed,
    rows,
  };
}

// ===================== 5.3 exportCSV =====================

/**
 * Exporta entradas filtradas para CSV (BOM UTF-8 + ';' + RFC 4180).
 *
 * Estrategia: reusa listEntries paginando em pageSize=100 ate atingir
 * total ou EXPORT_HARD_LIMIT (10000) — o que vier primeiro. Sem cursor:
 * cada pagina e uma chamada PostgREST independente.
 *
 * truncated = total > 10000 (informativo para a UI sinalizar ao admin
 * que existem mais entradas que o exportado).
 *
 * Audit log BLACKLIST_EXPORTED via logAdminAction direto (operacao de
 * leitura, sem mutacao real, nao usa executeAdminMutation). Best-effort:
 * falha de log nao bloqueia o download.
 */
export async function exportCSV(
  filters: BlacklistFilters
): Promise<{ csv: string; totalExported: number; truncated: boolean }> {
  const accumulated: BlacklistEntry[] = [];
  let total = 0;

  for (let page = 1; ; page++) {
    const pageFilters: BlacklistFilters = {
      ...filters,
      page,
      pageSize: EXPORT_PAGE_SIZE,
    };
    const result = await listEntries(pageFilters);
    total = result.total;
    accumulated.push(...result.rows);

    // Para quando acumulou tudo que existe, atingiu o hard limit,
    // ou a pagina veio vazia (defensivo contra loop infinito)
    if (
      accumulated.length >= total ||
      accumulated.length >= EXPORT_HARD_LIMIT ||
      result.rows.length === 0
    ) {
      break;
    }
  }

  const rows =
    accumulated.length > EXPORT_HARD_LIMIT ? accumulated.slice(0, EXPORT_HARD_LIMIT) : accumulated;
  const truncated = total > EXPORT_HARD_LIMIT;
  const csv = exportEntriesToCsvString(rows);

  // Audit log best-effort
  try {
    await logAdminAction({
      action: 'BLACKLIST_EXPORTED',
      targetType: 'admin_blacklist',
      targetId: null,
      before: null,
      after: {
        filters,
        total_exported: rows.length,
        total_available: total,
        truncated,
        requested_limit: EXPORT_HARD_LIMIT,
      },
    });
  } catch {
    // best-effort
  }

  return { csv, totalExported: rows.length, truncated };
}

/**
 * checkBlacklistGate
 *
 * Helper compartilhado pelos hooks user-facing (LoginForm, RegisterForm,
 * sendEmailVerificationCode). Faz a chamada `isBlacklisted(type, valueRaw)`
 * envolvida em `withTimingParity` + timeout 3s (fail-open).
 *
 * Quando bloqueado: dispara `logBlacklistBlock(action, type, valueRaw)` em
 * background (best-effort, erro engolido) e retorna `{ blocked: true }`.
 * Quando livre ou em timeout/erro: retorna `{ blocked: false }`.
 *
 * Centralizar este fluxo aqui garante:
 *   - Paridade exata entre login/signup/email (mesmo timeout, mesma parity)
 *   - Property CP-1 testavel em um unico ponto: phone na blacklist sempre
 *     bloqueia signup E login E (analogamente) email.
 */
export async function checkBlacklistGate(
  type: BlacklistType,
  valueRaw: string,
  action: BlacklistAttempt['action'],
  options?: { timeoutMs?: number }
): Promise<{ blocked: boolean }> {
  const timeoutMs = options?.timeoutMs ?? 3000;
  const blocked = await withTimingParity(async () => {
    try {
      return await Promise.race([
        isBlacklisted(type, valueRaw),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ]);
    } catch {
      return false;
    }
  });

  if (blocked) {
    void logBlacklistBlock(action, type, valueRaw);
    return { blocked: true };
  }
  return { blocked: false };
}
