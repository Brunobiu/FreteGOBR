/**
 * Validações puras (sem I/O) do WhatsApp_Module.
 *
 * Este arquivo concentra a lógica determinística usada tanto no frontend quanto
 * revalidada no backend (Req 5.6, 24.9). Por ser puro, é alvo de property tests
 * `fast-check` (P4 — ver task 2.2).
 *
 * Identifiers em inglês; mensagens user-facing em pt-BR (convenção FreteGO).
 */

import { sanitizePhone, isValidPhoneBR } from '../../../utils/phoneFormat';

/**
 * Resultado da normalização/validação de uma lista de Contact_Numbers.
 * - `valid`: números válidos, normalizados em E.164 (`+55DDDNNNNNNNN`), sem duplicatas.
 * - `invalid`: tokens que não correspondem a um telefone BR válido (Req 5.5),
 *   também deduplicados, preservando o texto original informado para exibição.
 */
export interface NumberNormalizationResult {
  valid: string[];
  invalid: string[];
}

/** Código de país do Brasil usado para compor o formato E.164. */
const BR_COUNTRY_CODE = '55';

/**
 * Normaliza, deduplica e valida uma lista de Contact_Numbers colada/importada.
 *
 * Regras (Req 5.1, 5.2, 5.3, 5.5, 24.2):
 * 1. Aceita números separados por vírgula, por quebra de linha ou por ambos.
 * 2. Normaliza cada número removendo espaços e pontuação não numérica.
 * 3. Remove duplicatas, mantendo uma única ocorrência de cada número.
 * 4. Valida o formato (telefone BR de 10/11 dígitos, com ou sem o código de
 *    país `55`); válidos são retornados em E.164, inválidos são reportados.
 *
 * Função PURA: não realiza I/O e não lança exceções.
 *
 * @param raw Texto bruto com um ou mais números.
 * @returns `{ valid, invalid }` — ambos deduplicados.
 */
export function normalizeNumbers(raw: string): NumberNormalizationResult {
  const valid: string[] = [];
  const invalid: string[] = [];

  if (!raw) return { valid, invalid };

  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();

  // Separa por vírgula e/ou quebra de linha (\n e \r), em qualquer combinação.
  const tokens = raw
    .split(/[\n\r,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  for (const token of tokens) {
    // Remove espaços e sinais de pontuação não numéricos (Req 5.2).
    const digits = sanitizePhone(token);

    // Remove o código de país BR quando presente, para validar o número nacional.
    let national = digits;
    if (digits.startsWith(BR_COUNTRY_CODE) && (digits.length === 12 || digits.length === 13)) {
      national = digits.slice(BR_COUNTRY_CODE.length);
    }

    if (isValidPhoneBR(national)) {
      const e164 = `+${BR_COUNTRY_CODE}${national}`;
      if (!seenValid.has(e164)) {
        seenValid.add(e164);
        valid.push(e164);
      }
    } else {
      // Deduplica inválidos pela forma de dígitos (ou pelo texto cru, quando
      // não há dígitos), preservando o token original para exibição.
      const invalidKey = digits.length > 0 ? digits : token;
      if (!seenInvalid.has(invalidKey)) {
        seenInvalid.add(invalidKey);
        invalid.push(token);
      }
    }
  }

  return { valid, invalid };
}

/* -------------------------------------------------------------------------- *
 * Validadores compartilhados front+back (Req 5.6, 6.3, 6.5, 8.2, 8.4, 15.2,  *
 * 15.3, 26.3).                                                                *
 *                                                                            *
 * São funções PURAS, sem I/O, projetadas para rodar identicamente no         *
 * frontend (bloqueio do formulário + mensagem pt-BR) e no backend            *
 * (revalidação antes de persistir). Retornam um resultado discriminado:      *
 *  - `{ ok: true }` quando o valor é aceito;                                 *
 *  - `{ ok: false, error, message }` quando rejeitado, com `error` (código   *
 *    em inglês, estável para lógica) e `message` (Canonical_Message pt-BR     *
 *    para exibição).                                                          *
 * -------------------------------------------------------------------------- */

/** Resultado de sucesso de um validador. */
export interface ValidationOk {
  ok: true;
}

/** Resultado de falha: código de erro em inglês + mensagem user-facing pt-BR. */
export interface ValidationFailure {
  ok: false;
  /** Error_Code estável (inglês) para uso programático/logs. */
  error: string;
  /** Canonical_Message em pt-BR para exibição ao Admin_User. */
  message: string;
}

/** Resultado discriminado de um validador (sucesso ou falha). */
export type ValidationResult = ValidationOk | ValidationFailure;

const OK: ValidationOk = { ok: true };

/**
 * Coage um valor (number ou string vinda de input) para número finito.
 * Retorna `NaN` para qualquer entrada não numérica, vazia ou não finita —
 * tratando uniformemente os casos "NaN" e "non-numeric".
 */
function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return NaN;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

/**
 * Valida o Send_Interval (em segundos). Rejeita `<= 0`, `NaN` e valores não
 * numéricos (Req 8.2). Predefinidos ou personalizados, o intervalo precisa ser
 * um número finito estritamente positivo.
 */
export function validateSendInterval(value: unknown): ValidationResult {
  const n = toFiniteNumber(value);
  if (Number.isNaN(n) || n <= 0) {
    return {
      ok: false,
      error: 'INVALID_SEND_INTERVAL',
      message: 'Informe um intervalo válido.',
    };
  }
  return OK;
}

/**
 * Valida a Execution_Quota. Rejeita `< 1`, `NaN` e valores não numéricos
 * (Req 8.4). A quota representa uma contagem, portanto exige inteiro `>= 1`.
 */
export function validateExecutionQuota(value: unknown): ValidationResult {
  const n = toFiniteNumber(value);
  if (Number.isNaN(n) || !Number.isInteger(n) || n < 1) {
    return {
      ok: false,
      error: 'INVALID_EXECUTION_QUOTA',
      message: 'Informe uma quantidade válida.',
    };
  }
  return OK;
}

/**
 * Entrada para validação de Content: corpo de texto e quantidade de mídias
 * associadas. Um Content é válido se tiver texto não vazio OU ao menos uma
 * mídia (Req 6.5).
 */
export interface ContentValidationInput {
  /** Texto do Content (template). */
  body?: string | null;
  /** Quantidade de Content_Media já associados ao Content. */
  mediaCount?: number;
}

/**
 * Valida um Content (Req 6.5): inválido quando não há texto (ou só espaços)
 * E não há ao menos uma mídia. Caso contrário, válido.
 */
export function validateContent(input: ContentValidationInput): ValidationResult {
  const hasText = typeof input.body === 'string' && input.body.trim().length > 0;
  const hasMedia = (input.mediaCount ?? 0) >= 1;
  if (!hasText && !hasMedia) {
    return {
      ok: false,
      error: 'EMPTY_CONTENT',
      message: 'Informe um texto ou anexe ao menos uma mídia.',
    };
  }
  return OK;
}

/**
 * Conjunto de tipos MIME suportados para Content_Media, por media_type
 * (`IMAGE` | `VIDEO` | `AUDIO` | `DOCUMENT`). Qualquer MIME fora deste conjunto
 * é rejeitado com `INVALID_FILE_TYPE` (Req 6.3).
 */
export const SUPPORTED_MIME_TYPES = {
  IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  VIDEO: ['video/mp4', 'video/3gpp', 'video/quicktime'],
  AUDIO: ['audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/amr'],
  DOCUMENT: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ],
} as const;

/** Conjunto achatado de todos os MIME suportados, para verificação rápida. */
export const SUPPORTED_MIME_SET: ReadonlySet<string> = new Set<string>(
  Object.values(SUPPORTED_MIME_TYPES).flat()
);

/**
 * Valida o tipo MIME de um Content_Media. MIME ausente, vazio ou fora do
 * conjunto suportado é rejeitado com o Error_Code `INVALID_FILE_TYPE` (Req 6.3).
 * A comparação ignora caixa e parâmetros pós-`;` (ex.: `; charset=...`).
 */
export function validateMimeType(mime: unknown): ValidationResult {
  const normalized = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
  if (normalized === '' || !SUPPORTED_MIME_SET.has(normalized)) {
    return {
      ok: false,
      error: 'INVALID_FILE_TYPE',
      message: 'Tipo de arquivo não suportado.',
    };
  }
  return OK;
}

/**
 * Limite máximo de caracteres da Knowledge_Base (Req 15.2, 15.3). Aceita grande
 * volume de texto, mas rejeita acima deste limite sem truncamento silencioso.
 */
export const KNOWLEDGE_BASE_MAX_LENGTH = 100_000;

/**
 * Valida a Knowledge_Base (Req 15.2, 15.3). Conteúdo acima de
 * `KNOWLEDGE_BASE_MAX_LENGTH` é rejeitado (sem truncar) com a Canonical_Message
 * `O conteúdo excede o limite permitido.`. Conteúdo vazio é permitido aqui
 * (Knowledge_Base é opcional).
 */
export function validateKnowledgeBase(value: unknown): ValidationResult {
  const text = typeof value === 'string' ? value : '';
  if (text.length > KNOWLEDGE_BASE_MAX_LENGTH) {
    return {
      ok: false,
      error: 'KNOWLEDGE_BASE_TOO_LONG',
      message: 'O conteúdo excede o limite permitido.',
    };
  }
  return OK;
}

/**
 * Valida o AI_Prompt (Req 26.3). Prompt ausente, vazio ou só com espaços é
 * rejeitado com a Canonical_Message `Informe um prompt válido.`.
 */
export function validateAiPrompt(value: unknown): ValidationResult {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    return {
      ok: false,
      error: 'INVALID_AI_PROMPT',
      message: 'Informe um prompt válido.',
    };
  }
  return OK;
}
