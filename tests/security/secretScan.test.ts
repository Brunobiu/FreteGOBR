/**
 * Testes do scanner de segredos (Tarefa 21).
 *
 * 1. Garante que o código-fonte NÃO contém secrets hardcoded (gate real).
 * 2. Valida que o scanner detecta padrões conhecidos (não é um no-op).
 *
 * Validates: Requirements 19.5
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForSecrets } from './secretScan';

describe('secret-scan — gate sobre o código-fonte real', () => {
  it('não encontra segredos hardcoded no repositório', () => {
    const findings = scanForSecrets(process.cwd());
    const msg = findings.map((f) => `  ${f.file}:${f.line} [${f.rule}] ${f.excerpt}`).join('\n');
    expect(findings, `secrets hardcoded detectados:\n${msg}`).toHaveLength(0);
  });
});

describe('secret-scan — detecção (não é no-op)', () => {
  it('detecta JWT, sb_secret, resend key e private key em fixtures', () => {
    const dir = join(tmpdir(), `secretscan-${Date.now()}`);
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    try {
      writeFileSync(
        join(srcDir, 'leak.ts'),
        [
          "const a = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcDEFghiJKLmnoPQR';",
          "const b = 'sb_secret_bXyU0cKxVFWXHu51aR8AnDy4Uym';",
          "const c = 're_abcd1234efgh5678ijkl';",
          '-----BEGIN PRIVATE KEY-----MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ',
        ].join('\n')
      );
      const findings = scanForSecrets(dir);
      const rules = new Set(findings.map((f) => f.rule));
      expect(rules.has('JWT (eyJ...)')).toBe(true);
      expect(rules.has('Supabase secret key')).toBe(true);
      expect(rules.has('Resend API key')).toBe(true);
      expect(rules.has('Private key block')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('não acusa código limpo', () => {
    const dir = join(tmpdir(), `secretscan-clean-${Date.now()}`);
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    try {
      writeFileSync(
        join(srcDir, 'ok.ts'),
        "export const greeting = 'Olá, motorista'; const n = 42;\n"
      );
      expect(scanForSecrets(dir)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
