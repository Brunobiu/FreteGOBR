/**
 * supervisor/sanitize.ts — não-vazamento de PII/segredos (alvo de CP7).
 *
 * `sanitizeSupervisorDetail` remove de um objeto `detail` (de diagnóstico/insight)
 * qualquer PII (e-mail/telefone/CPF/CNPJ) ou segredo (hash/JWT/chaves), antes de
 * persistir/exibir. Conservador: prefere super-redigir a vazar. Reusa o mesmo
 * padrão de `operacao.sanitizeAlertDetailView`.
 *
 * Spec: .kiro/specs/admin-ia-supervisora (Task 2.7).
 */

const PII_SECRET_PATTERNS: readonly RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // e-mail
  /\(?\d{2}\)?[\s-]?9?\d{4}-?\d{4}/, // telefone BR (10-11 dígitos)
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, // CNPJ
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/, // bcrypt
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /\b(?:sb_secret_|sbp_|re_)[A-Za-z0-9_-]{10,}/, // chaves de serviço
  /AKIA[0-9A-Z]{16}/, // AWS access key
];

const SENSITIVE_KEY_RE =
  /(?:^|_)(?:password|senha|secret|token|api[_-]?key|authorization|cookie|email|e[_-]?mail|phone|telefone|cpf|cnpj)(?:_|$)/i;

const REDACTED = '[oculto]';

function looksSensitive(value: string): boolean {
  return PII_SECRET_PATTERNS.some((re) => re.test(value));
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return looksSensitive(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') return sanitizeObject(value as Record<string, unknown>);
  return value; // number | boolean | null | undefined
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY_RE.test(k)) continue; // chave sensível: descarta por completo
    out[k] = sanitizeValue(v);
  }
  return out;
}

/**
 * Sanitiza um `detail` para persistência/exibição. PURO e total: entrada não-objeto
 * ⇒ `{}`. Drop de chaves sensíveis + redação de valores PII/segredo.
 */
export function sanitizeSupervisorDetail(detail: unknown): Record<string, unknown> {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
  return sanitizeObject(detail as Record<string, unknown>);
}
