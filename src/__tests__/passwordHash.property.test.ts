/**
 * Property-Based Tests for Password Hashing
 *
 * Property 1: Password Hashing Verification
 * Validates: Requirements 1.1
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { hashPassword, verifyPassword } from '../utils/passwordHash';

describe('Password Hashing - Property Tests', () => {
  it('Property: hashed password should verify correctly with original password', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 6, maxLength: 50 }), async (password) => {
        const hash = await hashPassword(password);
        const isValid = await verifyPassword(password, hash);
        expect(isValid).toBe(true);
      }),
      { numRuns: 20 }
    );
  }, 60000);

  it('Property: wrong password should not verify', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 6, maxLength: 50 }),
        fc.string({ minLength: 6, maxLength: 50 }),
        async (password, wrongPassword) => {
          fc.pre(password !== wrongPassword); // Skip if passwords are the same
          const hash = await hashPassword(password);
          const isValid = await verifyPassword(wrongPassword, hash);
          expect(isValid).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  }, 60000);

  it('Property: same password should produce different hashes (salt)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 6, maxLength: 50 }), async (password) => {
        const hash1 = await hashPassword(password);
        const hash2 = await hashPassword(password);
        expect(hash1).not.toBe(hash2); // Different salts

        // But both should verify
        expect(await verifyPassword(password, hash1)).toBe(true);
        expect(await verifyPassword(password, hash2)).toBe(true);
      }),
      { numRuns: 10 }
    );
  }, 60000);

  it('Property: hash should be a non-empty string', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 50 }), async (password) => {
        const hash = await hashPassword(password);
        expect(typeof hash).toBe('string');
        expect(hash.length).toBeGreaterThan(0);
      }),
      { numRuns: 20 }
    );
  }, 60000);
});
