/**
 * Supabase Test Harness — spec finalizacao-lancamento (Área 2).
 *
 * Fornece base reutilizável para testes de integração/RLS contra um Supabase
 * de teste. Credenciais SEMPRE via variáveis de ambiente — NUNCA hardcoded.
 *
 * Infra_Dependent: a EXECUÇÃO verde depende de um branch Supabase efêmero +
 * secrets no CI (SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY,
 * SUPABASE_TEST_SERVICE_KEY). A entrega desta task é o código do harness; os
 * testes que o usam ficam protegidos por `describeIntegration` (skip quando
 * o ambiente não está provisionado), evitando falha de infra na suíte local.
 *
 * Validates: Requirements 14.1, 14.2
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe } from 'vitest';

// ─── Configuração via env ────────────────────────────────────────────────────

export interface HarnessEnv {
  url: string;
  anonKey: string;
  serviceKey: string;
}

/** Lê as credenciais de teste do ambiente. Retorna null se incompletas. */
export function readHarnessEnv(): HarnessEnv | null {
  const url = process.env.SUPABASE_TEST_URL;
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !anonKey || !serviceKey) return null;
  return { url, anonKey, serviceKey };
}

/** True quando o ambiente de integração está disponível. */
export function hasIntegrationEnv(): boolean {
  return readHarnessEnv() !== null;
}

/**
 * `describe` que só roda quando o ambiente de integração existe; caso
 * contrário marca como skip (não falha a suíte local). Use para suites
 * Infra_Dependent.
 */
export const describeIntegration = hasIntegrationEnv() ? describe : describe.skip;

// ─── Clientes ────────────────────────────────────────────────────────────────

/** Cliente anônimo (sem sessão). */
export function asAnon(): SupabaseClient {
  const env = requireEnv();
  return createClient(env.url, env.anonKey, { auth: { persistSession: false } });
}

/** Cliente com service role (bypassa RLS — usar só para seed/cleanup). */
export function asService(): SupabaseClient {
  const env = requireEnv();
  return createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
}

/** Cliente autenticado como um usuário (via access token já obtido). */
export function asUser(accessToken: string): SupabaseClient {
  const env = requireEnv();
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

// ─── Seed / cleanup ──────────────────────────────────────────────────────────

export interface SeedUserOptions {
  /** Sufixo determinístico (derive do nome do teste, não aleatório). */
  tag: string;
  userType: 'motorista' | 'embarcador';
  password?: string;
}

export interface SeededUser {
  id: string;
  email: string;
  accessToken: string;
}

/**
 * Cria um usuário de teste determinístico via service role + signIn para
 * obter o access token. IDs/emails derivam de `tag` (nunca aleatórios), o
 * que torna o cleanup idempotente.
 */
export async function seedUser(opts: SeedUserOptions): Promise<SeededUser> {
  const env = requireEnv();
  const svc = asService();
  const email = `test+${opts.tag}@fretego.test`;
  const password = opts.password ?? 'Test1234!@#';

  // Cria (idempotente: ignora se já existe).
  const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
  await admin.auth.admin
    .createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { userType: opts.userType },
    })
    .catch(() => undefined);

  // Autentica para obter token.
  const anon = asAnon();
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`seedUser falhou ao autenticar ${email}: ${error?.message ?? 'sem sessão'}`);
  }

  void svc; // service client disponível para seeds de tabela, se necessário.
  return { id: data.user!.id, email, accessToken: data.session.access_token };
}

/** Remove um usuário de teste (idempotente). */
export async function cleanupUser(userId: string): Promise<void> {
  const env = requireEnv();
  const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}

// ─── Interno ─────────────────────────────────────────────────────────────────

function requireEnv(): HarnessEnv {
  const env = readHarnessEnv();
  if (!env) {
    throw new Error(
      'Supabase_Test_Harness: ambiente de integração ausente. Defina SUPABASE_TEST_URL, ' +
        'SUPABASE_TEST_ANON_KEY e SUPABASE_TEST_SERVICE_KEY (branch efêmero no CI).'
    );
  }
  return env;
}
