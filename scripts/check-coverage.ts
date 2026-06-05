/**
 * check-coverage — spec `testes` (Tarefa 3).
 *
 * Lê o relatório de cobertura gerado pelo Vitest (provider v8) em
 * `coverage/coverage-final.json` e falha (exit 1) se algum Critical_Module
 * ficar abaixo do threshold definido em `tests/coverage.config.ts`.
 *
 * Uso: npx tsx scripts/check-coverage.ts
 *
 * Validates: Requirements 25.7, 25.8
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CRITICAL_MODULES } from '../tests/coverage.config';

interface IstanbulStatementMap {
  [id: string]: unknown;
}
interface IstanbulFileCoverage {
  path?: string;
  s: Record<string, number>; // statement hit counts
  statementMap: IstanbulStatementMap;
}
type CoverageFinal = Record<string, IstanbulFileCoverage>;

const COVERAGE_PATH = resolve(process.cwd(), 'coverage', 'coverage-final.json');

function linePct(file: IstanbulFileCoverage): number {
  const counts = Object.values(file.s ?? {});
  if (counts.length === 0) return 100;
  const covered = counts.filter((c) => c > 0).length;
  return (covered / counts.length) * 100;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

function main(): void {
  if (!existsSync(COVERAGE_PATH)) {
    console.error(
      `[check-coverage] relatório não encontrado em ${COVERAGE_PATH}.\n` +
        `Rode: npm run test:run -- --coverage`
    );
    process.exit(1);
  }

  const raw = readFileSync(COVERAGE_PATH, 'utf-8');
  const data = JSON.parse(raw) as CoverageFinal;

  // Indexa por caminho relativo normalizado.
  const byRelative = new Map<string, IstanbulFileCoverage>();
  for (const [key, file] of Object.entries(data)) {
    const abs = normalize(file.path ?? key);
    const rel = abs.includes('/src/') ? `src/${abs.split('/src/')[1]}` : normalize(key);
    byRelative.set(rel, file);
  }

  const failures: string[] = [];
  const report: Array<{ module: string; pct: number; threshold: number; ok: boolean }> = [];

  for (const [moduleRel, threshold] of Object.entries(CRITICAL_MODULES)) {
    const file = byRelative.get(moduleRel);
    if (!file) {
      failures.push(`${moduleRel}: SEM COBERTURA (módulo não encontrado no relatório)`);
      report.push({ module: moduleRel, pct: 0, threshold, ok: false });
      continue;
    }
    const pct = linePct(file);
    const ok = pct >= threshold;
    report.push({ module: moduleRel, pct, threshold, ok });
    if (!ok) {
      failures.push(`${moduleRel}: ${pct.toFixed(1)}% < ${threshold}% (threshold)`);
    }
  }

  console.log('\n[check-coverage] Critical_Modules:');
  for (const r of report) {
    const mark = r.ok ? 'OK ' : 'XX ';
    console.log(`  ${mark} ${r.module} — ${r.pct.toFixed(1)}% (min ${r.threshold}%)`);
  }

  if (failures.length > 0) {
    console.error('\n[check-coverage] FALHA — módulos abaixo do threshold:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('\n[check-coverage] OK — todos os Critical_Modules atingem o threshold.\n');
}

main();
