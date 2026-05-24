/**
 * admin/mfa.ts
 *
 * MFA TOTP (RFC 6238) + 10 backup codes.
 *
 * - Secret base32 (160 bits)
 * - TOTP HMAC-SHA1 step 30s, 6 digitos, tolerancia +/- 30s
 * - Backup codes: 10 chars [A-HJ-NP-Z2-9], hash bcrypt no banco
 */

import { supabase } from '../supabase';
import {
  base32ToBytes,
  decryptTotpSecret,
  encryptTotpSecret,
  formatBackupCode,
  generateRandomBackupCode,
  generateTotpSecretBase32,
  parseBackupCode,
} from '../../utils/adminCrypto';
import { hashPassword, verifyPassword } from '../../utils/passwordHash';

const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = 'FreteGO Admin';
const TOTP_TOLERANCE = 1; // +/- 1 step (30s)

export interface BackupCodeEntry {
  hash: string;
  used_at: string | null;
}

export interface MfaSetupData {
  secret: string;
  otpauthUri: string;
}

export interface MfaSetupResult {
  backupCodes: string[]; // plaintext, exibido uma vez
}

export type MfaVerifyResult =
  | { ok: true; usedBackupCode: boolean }
  | { ok: false; reason: 'invalid' | 'no_secret' };

// ========== TOTP core ==========

async function hmacSha1(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg as BufferSource);
  return new Uint8Array(sig);
}

function intToBytes(n: number): Uint8Array {
  const buf = new Uint8Array(8);
  // n cabe em 53 bits seguros, suficiente ate 2255 d.C.
  for (let i = 7; i >= 0; i--) {
    buf[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return buf;
}

export async function generateTotp(
  secretBase32: string,
  forTime: number = Date.now()
): Promise<string> {
  const counter = Math.floor(forTime / 1000 / STEP_SECONDS);
  const key = base32ToBytes(secretBase32);
  const hash = await hmacSha1(key, intToBytes(counter));
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

export async function verifyTotp(
  secretBase32: string,
  code: string,
  now: number = Date.now()
): Promise<boolean> {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== DIGITS) return false;
  for (let delta = -TOTP_TOLERANCE; delta <= TOTP_TOLERANCE; delta++) {
    const t = now + delta * STEP_SECONDS * 1000;
    const candidate = await generateTotp(secretBase32, t);
    if (candidate === clean) return true;
  }
  return false;
}

// ========== Setup / verify ==========

/**
 * Gera secret + uri otpauth pra exibir QR code no setup.
 * NAO persiste; persistencia ocorre em completeMfaSetup.
 */
export function generateMfaSetupData(username: string): MfaSetupData {
  const secret = generateTotpSecretBase32();
  const label = encodeURIComponent(`${ISSUER}:${username}`);
  const issuer = encodeURIComponent(ISSUER);
  const otpauthUri =
    `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}` +
    `&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  return { secret, otpauthUri };
}

/**
 * Gera 10 backup codes plaintext + entries hashadas pra persistir.
 */
export async function generateBackupCodes(): Promise<{
  plain: string[];
  entries: BackupCodeEntry[];
}> {
  const plain: string[] = [];
  const entries: BackupCodeEntry[] = [];
  for (let i = 0; i < 10; i++) {
    const code = generateRandomBackupCode();
    plain.push(formatBackupCode(code));
    const hash = await hashPassword(code);
    entries.push({ hash, used_at: null });
  }
  return { plain, entries };
}

/**
 * Conclui setup: cifra TOTP secret, persiste via RPC set_mfa_secret.
 * Lanca em caso de erro. Retorna backup codes plaintext (para exibir uma vez).
 */
export async function completeMfaSetup(args: {
  totpSecret: string;
  firstTotpCode: string;
}): Promise<MfaSetupResult> {
  const { totpSecret, firstTotpCode } = args;
  const ok = await verifyTotp(totpSecret, firstTotpCode);
  if (!ok) {
    throw new Error('Codigo TOTP inicial invalido');
  }
  const { plain, entries } = await generateBackupCodes();
  const cipher = await encryptTotpSecret(totpSecret);
  const cipherB64 = btoa(String.fromCharCode(...cipher));

  // Supabase RPC com bytea espera \\x ou base64 — usamos base64 wrapper
  const { error } = await supabase.rpc('set_mfa_secret', {
    p_totp_encrypted: `\\x${bytesToHex(cipher)}`,
    p_backup_codes: entries,
  });
  if (error) {
    // fallback: tenta com base64 direto se driver aceitar
    const { error: err2 } = await supabase.rpc('set_mfa_secret', {
      p_totp_encrypted: cipherB64,
      p_backup_codes: entries,
    });
    if (err2) throw err2;
  }

  return { backupCodes: plain };
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifica MFA: aceita TOTP 6 digitos OU backup code (com ou sem hifen).
 */
export async function verifyMfa(args: { userId: string; code: string }): Promise<MfaVerifyResult> {
  const raw = args.code.trim();
  const isBackupShape = /^[A-Z0-9-]{10,14}$/i.test(raw) && raw.replace(/-/g, '').length === 10;
  const isTotpShape = /^\d{6}$/.test(raw);

  if (!isTotpShape && !isBackupShape) {
    return { ok: false, reason: 'invalid' };
  }

  const { data: row } = await supabase
    .from('admin_mfa_secrets')
    .select('totp_secret_encrypted, backup_codes')
    .eq('user_id', args.userId)
    .maybeSingle();

  if (!row) return { ok: false, reason: 'no_secret' };

  if (isTotpShape) {
    const cipher = decodeBytea(row.totp_secret_encrypted as unknown);
    const secret = await decryptTotpSecret(cipher);
    const ok = await verifyTotp(secret, raw);
    return ok ? { ok: true, usedBackupCode: false } : { ok: false, reason: 'invalid' };
  }

  // backup code: tenta cada hash via bcrypt compare
  const normalized = parseBackupCode(raw);
  const codes = (row.backup_codes ?? []) as BackupCodeEntry[];
  for (const entry of codes) {
    if (entry.used_at) continue;
    const match = await verifyPassword(normalized, entry.hash);
    if (match) {
      const { data: consumed, error } = await supabase.rpc('consume_backup_code', {
        p_hash: entry.hash,
      });
      if (error || !consumed) return { ok: false, reason: 'invalid' };
      return { ok: true, usedBackupCode: true };
    }
  }
  return { ok: false, reason: 'invalid' };
}

function decodeBytea(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      const hex = value.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
      }
      return out;
    }
    // base64
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (Array.isArray(value)) return new Uint8Array(value);
  throw new Error('formato bytea invalido');
}

/** Regenera os 10 backup codes. Retorna plaintext (exibido uma vez). */
export async function regenerateBackupCodes(): Promise<string[]> {
  const { plain, entries } = await generateBackupCodes();
  const { error } = await supabase.rpc('regenerate_backup_codes', {
    p_backup_codes: entries,
  });
  if (error) throw error;
  return plain;
}
