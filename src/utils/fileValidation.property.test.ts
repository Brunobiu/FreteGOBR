/**
 * Property-Based Tests for File Validation
 *
 * Property 15: File Size Validation
 * Property 16: File Format Validation
 * Validates: Requirements 19.8, 19.9
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateFile, validateFileSize, validateFileType, formatFileSize } from './fileValidation';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

describe('File Validation - Property Tests', () => {
  it('Property: files under 10MB should pass size validation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_FILE_SIZE }),
        fc.constantFrom('application/pdf', 'image/jpeg', 'image/png'),
        (size, mimeType) => {
          const file = new File(['x'.repeat(size)], 'test.pdf', { type: mimeType });
          expect(validateFileSize(file)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property: files over 10MB should fail size validation', () => {
    fc.assert(
      fc.property(fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 2 }), (size) => {
        const file = new File(['x'.repeat(Math.min(size, 1000))], 'test.pdf', {
          type: 'application/pdf',
        });
        Object.defineProperty(file, 'size', { value: size });
        expect(validateFileSize(file)).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  it('Property: allowed MIME types should pass type validation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('application/pdf', 'image/jpeg', 'image/jpg', 'image/png'),
        (mimeType) => {
          const file = new File(['test'], 'test.pdf', { type: mimeType });
          expect(validateFileType(file)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property: disallowed MIME types should fail type validation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('text/plain', 'application/zip', 'video/mp4', 'audio/mp3'),
        (mimeType) => {
          const file = new File(['test'], 'test.txt', { type: mimeType });
          expect(validateFileType(file)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property: valid files should have no errors', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_FILE_SIZE }),
        fc.constantFrom('application/pdf', 'image/jpeg', 'image/png'),
        (size, mimeType) => {
          const file = new File(['x'.repeat(Math.min(size, 1000))], 'test.pdf', { type: mimeType });
          Object.defineProperty(file, 'size', { value: size });
          const result = validateFile(file);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property: formatFileSize should return non-empty string', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000000000 }), (bytes) => {
        const formatted = formatFileSize(bytes);
        expect(typeof formatted).toBe('string');
        expect(formatted.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('Property: validation is deterministic', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_FILE_SIZE * 2 }),
        fc.constantFrom('application/pdf', 'image/jpeg', 'text/plain'),
        (size, mimeType) => {
          const file = new File(['test'], 'test.pdf', { type: mimeType });
          Object.defineProperty(file, 'size', { value: size });
          const result1 = validateFile(file);
          const result2 = validateFile(file);
          expect(result1).toEqual(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
