/**
 * Scanner de segredos hardcoded — spec `testes` (Tarefa 21).
 *
 * Varre o código-fonte (src/, supabase/functions/, scripts/) procurando
 * padrões de credenciais que NUNCA devem ser commitadas. Puro/local,
 * sem dependência de rede.
 *
 * Validates: Requirements 19.5
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export interface SecretFinding {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

interface Rule {
  name: string;
  re: RegExp;
}

const RULES: Rule[] = [
  { name: 'JWT (eyJ...)', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/ },
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{12,}/ },
  { name: 'Supabase access token', re: /\bsbp_[A-Za-z0-9]{20,}/ },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{16,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  // Exige conteúdo base64 real após o header (≥40 chars na mesma linha ou
  // marcador isolado), evitando falso-positivo com `.replace('-----BEGIN...')`.
  {
    name: 'Private key block',
    re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\\nr"'`]*[A-Za-z0-9+/]{40,}/,
  },
];

const SCAN_DIRS = ['src', 'supabase/functions', 'scripts'];
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// Arquivos/caminhos ignorados: testes que contêm padrões de segredo
// propositais (fixtures realistas para validar mascaramento/não-vazamento) e
// node_modules. NÃO incluir código de produção aqui — só testes.
const IGNORE_SUBSTR = [
  'node_modules',
  'secretScan',
  'logAssertions',
  '_helpers/helpers.test',
  // Testes de não-vazamento de segredos do WhatsApp: usam valores
  // `sb_secret_...` realistas para verificar que NUNCA voltam na superfície.
  '__tests__/admin/whatsapp/ai.test',
  '__tests__/admin/whatsapp/gating.test',
  // Idem para Central de Operação, Cliente 360 e IA Supervisora: os testes de
  // precedência de erro e de isolamento/não-vazamento injetam um token
  // `sb_secret_...` fake para provar que a sanitização/erro mapeado nunca o
  // devolve. Mesma razão dos fixtures do WhatsApp acima (só testes).
  '__tests__/admin/operacao/cp7_permission_precedence',
  '__tests__/admin/operacao/cp8_isolation_no_leak',
  '__tests__/admin/cliente-360/cliente360_service.test',
  '__tests__/admin/supervisor/cp6_permission_precedence',
  '__tests__/admin/supervisor/cp7_isolation_no_leak',
  '__tests__/admin/supervisor/supervisor_service.test',
];

function walk(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // dir inexistente — ignora
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      walk(full, acc);
    } else if (SCAN_EXT.has(extname(name))) {
      acc.push(full);
    }
  }
}

export function scanForSecrets(rootDir: string = process.cwd()): SecretFinding[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(rootDir, d), files);

  const findings: SecretFinding[] = [];
  for (const file of files) {
    const norm = file.replace(/\\/g, '/');
    if (IGNORE_SUBSTR.some((s) => norm.includes(s))) continue;

    const content = readFileSync(file, 'utf-8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          findings.push({
            file: norm,
            line: idx + 1,
            rule: rule.name,
            excerpt: line.trim().slice(0, 80),
          });
        }
      }
    });
  }
  return findings;
}
