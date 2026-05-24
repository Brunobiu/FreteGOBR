/**
 * adminCrypto.ts
 *
 * Cifragem AES-256-GCM para o segredo TOTP do MFA admin.
 * Usa Web Crypto API. A chave master vem de VITE_ADMIN_MFA_KEY (base64).
 *
 * Formato do buffer cifrado: [IV (12 bytes)] || [ciphertext + tag GCM]
 *
 * Tambem expoe helpers para formatacao e validacao de backup codes
 * e secrets base32.
 */

const ENV_KEY = 'VITE_ADMIN_MFA_KEY';
const IV_LENGTH = 12;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_REGEX = /^[A-Z2-7]+=*$/;

/** Backup codes usam o alfabeto base32 sem chars ambiguos. */
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let cachedKey: CryptoKey | null = null;

function base64ToBytes(b64: string): Uint8Array {
  // Tolerante: remove espacos, quebras de linha e aspas que podem aparecer
  // ao copiar do terminal, e converte URL-safe para padrao se necessario.
  const clean = b64
    .replace(/\s+/g, '')
    .replace(/^["']|["']$/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getMasterKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env?.[
    ENV_KEY
  ];
  if (!raw || raw.startsWith('your_')) {
    throw new Error(
      `${ENV_KEY} nao configurada. Gere com: openssl rand -base64 32 e adicione ao .env`
    );
  }
  const keyBytes = base64ToBytes(raw);
  if (keyBytes.length !== 32) {
    throw new Error(`${ENV_KEY} deve ser 32 bytes (256 bits) em base64`);
  }
  // Copia para um ArrayBuffer dedicado (evita SharedArrayBuffer e satisfaz BufferSource estrito)
  const keyBuf = new Uint8Array(new ArrayBuffer(32));
  keyBuf.set(keyBytes);
  cachedKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  return cachedKey;
}

/** Cifra string base32 (TOTP secret) -> Uint8Array (IV || ciphertext+tag). */
export async function encryptTotpSecret(plain: string): Promise<Uint8Array> {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plain);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const out = new Uint8Array(IV_LENGTH + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), IV_LENGTH);
  return out;
}

/** Decifra Uint8Array (IV || ciphertext+tag) -> string base32 do TOTP secret. */
export async function decryptTotpSecret(cipherBuf: Uint8Array): Promise<string> {
  const key = await getMasterKey();
  if (cipherBuf.length <= IV_LENGTH) {
    throw new Error('decryptTotpSecret: buffer muito curto');
  }
  const iv = cipherBuf.slice(0, IV_LENGTH);
  const data = cipherBuf.slice(IV_LENGTH);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plain);
}

/**
 * Formata um backup code de 10 chars em grupos: ABCDEFGHIJ -> ABCD-EFGH-IJ
 */
export function formatBackupCode(raw: string): string {
  const clean = raw.replace(/[\s-]/g, '').toUpperCase();
  if (clean.length !== 10) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 10)}`;
}

/**
 * Normaliza um backup code: remove hifens/espacos, upper case.
 * Aceita com ou sem hifen.
 */
export function parseBackupCode(formatted: string): string {
  return formatted.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Gera um backup code aleatorio de 10 chars do alfabeto sem ambiguidades.
 */
export function generateRandomBackupCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += BACKUP_ALPHABET[bytes[i] % BACKUP_ALPHABET.length];
  }
  return out;
}

/** Valida string base32 RFC 4648 (uppercase). */
export function isValidBase32(s: string): boolean {
  if (!s || s.length === 0) return false;
  if (s.length % 8 !== 0 && !/^[A-Z2-7]+=*$/.test(s)) return false;
  return BASE32_REGEX.test(s);
}

/** Gera secret TOTP base32 (32 bytes -> 52 chars sem padding). */
export function generateTotpSecretBase32(): string {
  const bytes = new Uint8Array(20); // 160 bits, padrao TOTP
  crypto.getRandomValues(bytes);
  return bytesToBase32(bytes);
}

function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/** Decodifica base32 RFC 4648 -> Uint8Array. Lanca em chars invalidos. */
export function base32ToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`base32 invalido: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** Para tests / mock: limpa cache da chave. */
export function _resetMasterKeyCache(): void {
  cachedKey = null;
}
