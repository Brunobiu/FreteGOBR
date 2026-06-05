/**
 * Assertions de não-vazamento de segredos — spec `testes` (Tarefa 2).
 *
 * Decisão oficial: dados sensíveis nunca aparecem em respostas, logs ou
 * traces; secrets nunca ficam expostos; stack traces não vão ao cliente.
 *
 * Validates: Requirements 19.1, 19.2, 19.3
 */

import { expect } from 'vitest';

/** Padrões que NUNCA devem aparecer em respostas/logs capturados. */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'bcrypt hash', re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/ },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Supabase service key', re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: 'Resend key', re: /\bre_[A-Za-z0-9_-]{16,}/ },
  { name: 'Supabase access token', re: /\bsbp_[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'generic api_key field', re: /"(?:api[_-]?key|secret|password|token)"\s*:\s*"[^"]+"/i },
  { name: 'stack trace', re: /\bat\s+.+\(.+:\d+:\d+\)/ },
];

/**
 * Serializa qualquer valor e falha se contiver um padrão de segredo.
 * Aceita string, objeto, array — serializa via JSON quando necessário.
 */
export function expectNoSecrets(sample: unknown): void {
  const text = typeof sample === 'string' ? sample : safeStringify(sample);
  for (const { name, re } of SECRET_PATTERNS) {
    expect(re.test(text), `vazamento detectado (${name}) em: ${truncate(text)}`).toBe(false);
  }
}

/**
 * Valida que uma linha de log estruturado tem os campos mínimos e não
 * vaza segredos (R26.1 logs estruturados contínuos).
 */
export function expectStructuredLog(line: unknown): void {
  const obj = typeof line === 'string' ? JSON.parse(line) : (line as Record<string, unknown>);
  expect(obj).toHaveProperty('level');
  expect(obj).toHaveProperty('ts');
  expectNoSecrets(obj);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string): string {
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
