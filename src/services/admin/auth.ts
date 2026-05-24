/**
 * admin/auth.ts
 *
 * Auth do painel administrativo. Login via username (nao telefone),
 * convertendo para email sintetico {username}@admin.fretego.local.
 *
 * Sessao persistida em localStorage.fretego_admin_session
 * (isolada da sessao do app comum em fretego-auth).
 *
 * Toda falha de login gasta no minimo 500ms (anti-timing).
 */

import { supabase } from '../supabase';
import type { AdminRole } from './permissions';

const SESSION_KEY = 'fretego_admin_session';
const ADMIN_EMAIL_DOMAIN = '@admin.fretego.local';
const MIN_FAIL_RESPONSE_MS = 500;

export interface AdminSession {
  v: 1;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  lastActivityAt: number;
  roles: AdminRole[];
  mfaVerified: boolean;
  mfaVerifiedAt: number | null;
  username: string;
  displayName: string;
  photoUrl: string | null;
}

export type AdminLoginStep = 'mfa-setup' | 'mfa-verify' | 'denied';

export interface AdminLoginResult {
  step: AdminLoginStep;
  reason?: 'invalid_credentials' | 'inactive' | 'no_roles' | 'locked' | 'not_superadmin';
  lockoutMessage?: string;
}

export type AdminSessionInvalidReason =
  | 'inactive'
  | 'no_roles'
  | 'expired'
  | 'mfa_required'
  | 'no_session'
  | 'not_superadmin';

export interface ValidateAdminSessionResult {
  isValid: boolean;
  reason?: AdminSessionInvalidReason;
  roles: AdminRole[];
  hasMfa: boolean;
}

function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${ADMIN_EMAIL_DOMAIN}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function ensureMinTime<T>(startedAt: number, result: T): Promise<T> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_FAIL_RESPONSE_MS) {
    await sleep(MIN_FAIL_RESPONSE_MS - elapsed);
  }
  return result;
}

export function getAdminSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (parsed.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAdminSession(s: AdminSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearAdminSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function updateAdminSessionActivity(now: number = Date.now()): void {
  const s = getAdminSession();
  if (!s) return;
  setAdminSession({ ...s, lastActivityAt: now });
}

export function markMfaVerified(): void {
  const s = getAdminSession();
  if (!s) return;
  setAdminSession({
    ...s,
    mfaVerified: true,
    mfaVerifiedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

/**
 * Login admin. Retorna proximo step (mfa-setup ou mfa-verify) em sucesso,
 * ou 'denied' com reason em falha. Sempre gasta minimo 500ms em falhas.
 */
export async function loginAdmin(username: string, password: string): Promise<AdminLoginResult> {
  const startedAt = Date.now();
  const email = usernameToEmail(username);

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user || !authData.session) {
    return ensureMinTime(startedAt, {
      step: 'denied' as const,
      reason: 'invalid_credentials' as const,
    });
  }

  // Carrega flags do usuario (users.id == auth.users.id)
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, name, profile_photo_url, is_active, is_superuser, admin_username')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (userErr || !userRow) {
    await supabase.auth.signOut();
    return ensureMinTime(startedAt, {
      step: 'denied' as const,
      reason: 'invalid_credentials' as const,
    });
  }

  if (!userRow.is_active) {
    await supabase.auth.signOut();
    return ensureMinTime(startedAt, {
      step: 'denied' as const,
      reason: 'inactive' as const,
    });
  }

  if (!userRow.is_superuser) {
    await supabase.auth.signOut();
    return ensureMinTime(startedAt, {
      step: 'denied' as const,
      reason: 'not_superadmin' as const,
    });
  }

  // Carrega papeis ativos
  const { data: roles } = await supabase
    .from('admin_roles')
    .select('role')
    .eq('user_id', userRow.id)
    .is('revoked_at', null);

  const activeRoles: AdminRole[] = (roles ?? []).map((r) => r.role as AdminRole);

  if (activeRoles.length === 0) {
    await supabase.auth.signOut();
    return ensureMinTime(startedAt, {
      step: 'denied' as const,
      reason: 'no_roles' as const,
    });
  }

  // Verifica se MFA ja esta configurado
  const { data: mfaRow } = await supabase
    .from('admin_mfa_secrets')
    .select('user_id')
    .eq('user_id', userRow.id)
    .maybeSingle();

  const session: AdminSession = {
    v: 1,
    userId: userRow.id,
    accessToken: authData.session.access_token,
    refreshToken: authData.session.refresh_token,
    expiresAt: (authData.session.expires_at ?? 0) * 1000,
    lastActivityAt: Date.now(),
    roles: activeRoles,
    mfaVerified: false,
    mfaVerifiedAt: null,
    username: userRow.admin_username ?? username,
    displayName: userRow.name ?? username,
    photoUrl: userRow.profile_photo_url ?? null,
  };
  setAdminSession(session);

  return {
    step: mfaRow ? 'mfa-verify' : 'mfa-setup',
  };
}

/**
 * Logout admin: limpa sessao admin e desloga do Supabase Auth.
 */
export async function logoutAdmin(): Promise<void> {
  clearAdminSession();
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  }
}

/**
 * Valida sessao admin via RPC validate_admin_session.
 * Retorna roles ativos atuais (snapshot do banco).
 */
export async function validateAdminSession(): Promise<ValidateAdminSessionResult> {
  const session = getAdminSession();
  if (!session) {
    return { isValid: false, reason: 'no_session', roles: [], hasMfa: false };
  }

  const { data, error } = await supabase.rpc('validate_admin_session');
  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    return { isValid: false, reason: 'no_session', roles: [], hasMfa: false };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const roles: AdminRole[] = (row.active_roles ?? []) as AdminRole[];
  const hasMfa: boolean = !!row.has_mfa;

  if (!row.is_active) {
    return { isValid: false, reason: 'inactive', roles, hasMfa };
  }
  if (!row.is_superuser) {
    return { isValid: false, reason: 'not_superadmin', roles, hasMfa };
  }
  if (roles.length === 0) {
    return { isValid: false, reason: 'no_roles', roles, hasMfa };
  }
  if (!session.mfaVerified) {
    return { isValid: false, reason: 'mfa_required', roles, hasMfa };
  }

  return { isValid: true, roles, hasMfa };
}
