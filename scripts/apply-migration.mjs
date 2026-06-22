// Aplica uma migration no Supabase via Management API (mesmo mecanismo do _q.mjs,
// mas lendo um arquivo .sql inteiro em vez de receber SQL pela linha de comando).
//
// Uso:
//   SBP_TOKEN=<token> node scripts/apply-migration.mjs supabase/migrations/122_marketplace.sql
//
// SBP_TOKEN = token de acesso da Management API do Supabase (conta → Access Tokens).
// SBP_PROJECT_REF = ref do projeto (default: o projeto do FreteGO).

import { readFileSync } from 'node:fs';

const token = process.env.SBP_TOKEN;
const file = process.argv[2];
const projectRef = process.env.SBP_PROJECT_REF || 'kvdwmgchtpdnllxwswtf';

if (!token) {
  console.error('ERRO: defina SBP_TOKEN (token da Management API do Supabase).');
  process.exit(1);
}
if (!file) {
  console.error('Uso: node scripts/apply-migration.mjs <caminho-do-arquivo.sql>');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');

const res = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  }
);

console.log(`HTTP ${res.status}`);
console.log(await res.text());
process.exit(res.ok ? 0 : 1);
