/**
 * Password Hashing Utility
 *
 * Provides secure password hashing and verification using bcrypt
 * 
 * Security Configuration:
 * - Cost factor (salt rounds): 12 (recommended minimum for production)
 * - Higher cost factor = more secure but slower
 * - Cost factor 12 takes ~250ms on modern hardware
 * - Consider increasing to 14 when hardware allows
 */

import bcrypt from 'bcryptjs';

/**
 * Bcrypt cost factor (salt rounds)
 * 
 * Security recommendation: minimum 12 for production
 * - 10 = ~100ms (too fast, vulnerable to brute force)
 * - 12 = ~250ms (recommended minimum)
 * - 14 = ~1s (more secure, use if performance allows)
 */
export const BCRYPT_COST_FACTOR = 12;

// Alias for backward compatibility
const SALT_ROUNDS = BCRYPT_COST_FACTOR;

/**
 * Hashes a password using bcrypt
 *
 * @param password - The plain text password to hash
 * @returns Promise resolving to the hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  const hash = await bcrypt.hash(password, salt);
  return hash;
}

/**
 * Verifies a password against a hash
 *
 * @param password - The plain text password to verify
 * @param hash - The hash to verify against
 * @returns Promise resolving to true if password matches, false otherwise
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const isValid = await bcrypt.compare(password, hash);
  return isValid;
}
