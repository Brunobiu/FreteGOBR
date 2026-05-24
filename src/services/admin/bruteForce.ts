/**
 * admin/bruteForce.ts
 *
 * Wrapper sobre BruteForceProtector que prefixa chaves com `admin:`
 * para isolar contadores de lockout do app comum.
 *
 * Chave: `admin:username:{username.toLowerCase()}`
 */

import BruteForceProtector, { LockoutStatus } from '../bruteForceProtector';

const PREFIX = 'admin:username:';

function key(username: string): string {
  return `${PREFIX}${username.toLowerCase()}`;
}

export async function checkAdminLockout(username: string): Promise<LockoutStatus> {
  return BruteForceProtector.checkLockout(key(username));
}

export async function recordAdminAttempt(
  username: string,
  ipAddress: string,
  success: boolean,
  userId?: string
): Promise<void> {
  return BruteForceProtector.recordAttempt(key(username), ipAddress, success, userId);
}

export function getAdminLockoutMessage(lockedUntil: Date): string {
  return BruteForceProtector.getLockoutMessage(lockedUntil);
}

export async function unlockAdminAccount(username: string): Promise<void> {
  return BruteForceProtector.unlockAccount(key(username));
}
