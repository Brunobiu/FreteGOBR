/**
 * Property-Based Tests for Password Hashing
 * Feature: fretego
 *
 * **Validates: Requirements 1.1**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hashPassword, verifyPassword } from '../utils/passwordHash';

describe('Property Tests - Password Hashing', () => {
  /**
   * Property 1: Password Hashing Verification
   *
   * For any valid password string, after hashing with bcrypt,
   * verifying the hash against the original password should return true.
   *
   * **Validates: Requirements 1.1**
   */
  it('Property 1: should verify any hashed password against original', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 6, maxLength: 100 }), async (password) => {
        const hash = await hashPassword(password);
        const isValid = await verifyPassword(password, hash);
        expect(isValid).toBe(true);
      }),
      { numRuns: 20 } // Reduced runs due to bcrypt being computationally expensive
    );
  }, 60000);

  it('Property 1: should reject verification with wrong password', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 6, maxLength: 100 }),
        fc.string({ minLength: 6, maxLength: 100 }),
        async (password1, password2) => {
          // Skip if passwords are the same
          fc.pre(password1 !== password2);

          const hash = await hashPassword(password1);
          const isValid = await verifyPassword(password2, hash);
          expect(isValid).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  }, 60000);

  it('Property 1: should produce different hashes for same password', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 6, maxLength: 100 }), async (password) => {
        const hash1 = await hashPassword(password);
        const hash2 = await hashPassword(password);

        // Hashes should be different due to different salts
        expect(hash1).not.toBe(hash2);

        // But both should verify correctly
        expect(await verifyPassword(password, hash1)).toBe(true);
        expect(await verifyPassword(password, hash2)).toBe(true);
      }),
      { numRuns: 10 } // Reduced due to computational cost
    );
  }, 60000);

  it('Property 1: hash should always be a non-empty string', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 100 }), async (password) => {
        const hash = await hashPassword(password);
        expect(typeof hash).toBe('string');
        expect(hash.length).toBeGreaterThan(0);
        // Bcrypt hashes are always 60 characters
        expect(hash.length).toBe(60);
      }),
      { numRuns: 20 }
    );
  }, 60000);
});

describe('Unit Tests - Password Hashing', () => {
  it('should hash a password successfully', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(60); // Bcrypt hashes are 60 chars
    expect(hash).not.toBe(password);
  });

  it('should verify correct password', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);

    expect(isValid).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const password = 'testPassword123';
    const wrongPassword = 'wrongPassword456';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(wrongPassword, hash);

    expect(isValid).toBe(false);
  });

  it('should produce different hashes for same password', async () => {
    const password = 'testPassword123';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  it('should handle empty string password', async () => {
    const password = '';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);

    expect(isValid).toBe(true);
  });

  it('should handle special characters in password', async () => {
    const password = 'p@ssw0rd!#$%^&*()';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);

    expect(isValid).toBe(true);
  });

  it('should handle unicode characters in password', async () => {
    const password = 'senha123çãõ';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);

    expect(isValid).toBe(true);
  });

  it('should be case sensitive', async () => {
    const password = 'TestPassword123';
    const hash = await hashPassword(password);

    expect(await verifyPassword('testpassword123', hash)).toBe(false);
    expect(await verifyPassword('TESTPASSWORD123', hash)).toBe(false);
    expect(await verifyPassword(password, hash)).toBe(true);
  });
});
