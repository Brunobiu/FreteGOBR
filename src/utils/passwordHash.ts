/**
 * Password Hashing Utility
 *
 * Provides secure password hashing and verification using bcrypt
 */

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

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
