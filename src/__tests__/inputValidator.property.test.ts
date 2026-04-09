/**
 * Property-Based Tests for InputValidator
 *
 * Property 1: Input Sanitization
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.4, 2.5
 *
 * Tests that:
 * - Inputs with SQL keywords are rejected or sanitized
 * - Inputs with XSS patterns are sanitized
 * - HTML special characters are properly escaped
 * - Validation is deterministic
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import InputValidator, { INPUT_LIMITS } from '../utils/inputValidator';

// SQL injection payloads for testing
const SQL_INJECTION_PAYLOADS = [
  "'; DROP TABLE users; --",
  "' OR '1'='1",
  '" OR "1"="1',
  "1; DELETE FROM users",
  "UNION SELECT * FROM users",
  "'; EXEC xp_cmdshell('dir'); --",
  "1' OR 1=1 --",
  "admin'--",
  "SELECT * FROM users WHERE id = 1",
  "INSERT INTO users VALUES ('hacker')",
  "UPDATE users SET admin = 1",
  "DELETE FROM users WHERE 1=1",
  "DROP TABLE users",
  "CREATE TABLE hacked (id INT)",
  "ALTER TABLE users ADD hacked INT",
  "TRUNCATE TABLE users",
  "GRANT ALL ON users TO hacker",
  "WAITFOR DELAY '0:0:10'",
];

// XSS payloads for testing
const XSS_PAYLOADS = [
  '<script>alert("XSS")</script>',
  '<img src="x" onerror="alert(1)">',
  '<svg onload="alert(1)">',
  'javascript:alert(1)',
  '<iframe src="evil.com"></iframe>',
  '<object data="evil.swf"></object>',
  '<embed src="evil.swf">',
  '<form action="evil.com"><input type="submit"></form>',
  '<link rel="stylesheet" href="evil.css">',
  '<meta http-equiv="refresh" content="0;url=evil.com">',
  '<style>body{background:url("javascript:alert(1)")}</style>',
  '<div onclick="alert(1)">click me</div>',
  '<a href="javascript:alert(1)">click</a>',
  'vbscript:msgbox("XSS")',
  '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
  'expression(alert(1))',
];

// Safe inputs that should pass validation
const SAFE_INPUTS = [
  'Hello World',
  'João da Silva',
  'Frete de São Paulo para Rio de Janeiro',
  'Carga: 500kg de produtos eletrônicos',
  'Entrega urgente - prazo 24h',
  '12345',
  'user@example.com',
  'Rua das Flores, 123 - Centro',
  'Preço: R$ 1.500,00',
  'Observação: cuidado com itens frágeis',
];

describe('Property 1: Input Sanitization - SQL Injection Prevention', () => {
  it('should detect SQL injection in all known payloads', () => {
    for (const payload of SQL_INJECTION_PAYLOADS) {
      const detected = InputValidator.containsSQLInjection(payload);
      expect(detected).toBe(true);
    }
  });

  it('should reject inputs containing SQL keywords', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SQL_INJECTION_PAYLOADS),
        (sqlPayload) => {
          const result = InputValidator.validateText(sqlPayload);
          // Should either be invalid or have errors
          expect(result.isValid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: SQL_INJECTION_PAYLOADS.length }
    );
  });

  it('should not flag safe inputs as SQL injection', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SAFE_INPUTS),
        (safeInput) => {
          const detected = InputValidator.containsSQLInjection(safeInput);
          expect(detected).toBe(false);
        }
      ),
      { numRuns: SAFE_INPUTS.length }
    );
  });

  it('should detect SQL injection regardless of case', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('select', 'SELECT', 'SeLeCt', 'drop', 'DROP', 'DrOp'),
        fc.constantFrom(' * FROM users', ' TABLE users', ' DATABASE'),
        (keyword, suffix) => {
          const payload = keyword + suffix;
          const detected = InputValidator.containsSQLInjection(payload);
          expect(detected).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 1: Input Sanitization - XSS Prevention', () => {
  it('should detect XSS in all known payloads', () => {
    for (const payload of XSS_PAYLOADS) {
      const detected = InputValidator.containsXSS(payload);
      expect(detected).toBe(true);
    }
  });

  it('should sanitize inputs containing XSS patterns', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...XSS_PAYLOADS),
        (xssPayload) => {
          const result = InputValidator.validateText(xssPayload, { sanitize: true });
          // Sanitized value should not contain raw HTML tags
          expect(result.sanitizedValue).not.toContain('<script');
          expect(result.sanitizedValue).not.toContain('<iframe');
          expect(result.sanitizedValue).not.toContain('<object');
        }
      ),
      { numRuns: XSS_PAYLOADS.length }
    );
  });

  it('should not flag safe inputs as XSS', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SAFE_INPUTS),
        (safeInput) => {
          const detected = InputValidator.containsXSS(safeInput);
          expect(detected).toBe(false);
        }
      ),
      { numRuns: SAFE_INPUTS.length }
    );
  });

  it('should escape HTML special characters in sanitized output', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (input) => {
          const sanitized = InputValidator.sanitizeHTML(input);
          // Should not contain raw < or > characters
          expect(sanitized).not.toMatch(/(?<!&lt|&gt)[<>](?!;)/);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property 1: Input Sanitization - HTML Escaping', () => {
  it('should escape all dangerous HTML characters', () => {
    const dangerousChars = ['<', '>', '"', "'", '&', '/', '`', '='];
    
    fc.assert(
      fc.property(
        fc.constantFrom(...dangerousChars),
        (char) => {
          const sanitized = InputValidator.sanitizeHTML(char);
          expect(sanitized).not.toBe(char);
          expect(sanitized.startsWith('&')).toBe(true);
        }
      ),
      { numRuns: dangerousChars.length }
    );
  });

  it('should preserve safe alphanumeric content', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9\s]+$/),
        (safeInput) => {
          const sanitized = InputValidator.sanitizeHTML(safeInput);
          expect(sanitized).toBe(safeInput);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be idempotent - double sanitization produces same result', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (input) => {
          const once = InputValidator.sanitizeHTML(input);
          const twice = InputValidator.sanitizeHTML(once);
          // After first sanitization, second should not change anything
          // (already escaped characters should stay escaped)
          expect(twice).toBe(once);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 1: Input Sanitization - Validation Determinism', () => {
  it('should produce consistent results for same input', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 500 }),
        (input) => {
          const result1 = InputValidator.validateText(input);
          const result2 = InputValidator.validateText(input);
          expect(result1.isValid).toBe(result2.isValid);
          expect(result1.sanitizedValue).toBe(result2.sanitizedValue);
          expect(result1.errors).toEqual(result2.errors);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('should handle empty and whitespace inputs consistently', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', ' ', '  ', '\t', '\n', '   \t\n   '),
        (whitespace) => {
          const result = InputValidator.validateText(whitespace);
          expect(result.sanitizedValue).toBe(whitespace.trim());
        }
      ),
      { numRuns: 10 }
    );
  });

  it('should handle null and undefined gracefully', () => {
    const nullResult = InputValidator.validateText(null as unknown as string);
    const undefinedResult = InputValidator.validateText(undefined as unknown as string);
    
    expect(nullResult.isValid).toBe(false);
    expect(undefinedResult.isValid).toBe(false);
    expect(nullResult.sanitizedValue).toBe('');
    expect(undefinedResult.sanitizedValue).toBe('');
  });
});

describe('Property 1: Input Sanitization - Length Validation', () => {
  it('should reject inputs exceeding maxLength', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 101, max: 500 }),
        (maxLength, inputLength) => {
          const input = 'a'.repeat(inputLength);
          const result = InputValidator.validateText(input, { maxLength });
          expect(result.isValid).toBe(false);
          expect(result.errors.some(e => e.includes('Máximo'))).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should accept inputs within maxLength', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 500 }),
        (maxLength) => {
          const input = 'a'.repeat(maxLength - 1);
          const result = InputValidator.validateText(input, { maxLength });
          expect(result.errors.some(e => e.includes('Máximo'))).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should enforce INPUT_LIMITS for specific field validators', () => {
    // Test frete description limit
    const longDescription = 'a'.repeat(INPUT_LIMITS.MAX_FRETE_DESCRIPTION + 1);
    const descResult = InputValidator.validateFreteDescription(longDescription);
    expect(descResult.isValid).toBe(false);

    // Test chat message limit
    const longMessage = 'a'.repeat(INPUT_LIMITS.MAX_CHAT_MESSAGE + 1);
    const msgResult = InputValidator.validateChatMessage(longMessage);
    expect(msgResult.isValid).toBe(false);

    // Test user name limit
    const longName = 'a'.repeat(INPUT_LIMITS.MAX_USER_NAME + 1);
    const nameResult = InputValidator.validateUserName(longName);
    expect(nameResult.isValid).toBe(false);

    // Test rating comment limit
    const longComment = 'a'.repeat(INPUT_LIMITS.MAX_RATING_COMMENT + 1);
    const commentResult = InputValidator.validateRatingComment(longComment);
    expect(commentResult.isValid).toBe(false);
  });
});

describe('Property 1: Input Sanitization - Combined Attack Vectors', () => {
  it('should handle combined SQL + XSS attacks', () => {
    const combinedPayloads = [
      "'; <script>alert('XSS')</script> DROP TABLE users; --",
      '<img src="x" onerror="fetch(\'/api?q=\'+document.cookie)"> UNION SELECT',
      "javascript:fetch('/api?sql=DROP TABLE users')",
    ];

    for (const payload of combinedPayloads) {
      const result = InputValidator.validateText(payload);
      expect(result.isValid).toBe(false);
    }
  });

  it('should sanitize output even when validation fails', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...XSS_PAYLOADS),
        (xssPayload) => {
          const result = InputValidator.validateText(xssPayload, { sanitize: true });
          // Even if invalid, sanitized value should be safe
          expect(result.sanitizedValue).not.toContain('<script');
          expect(result.sanitizedValue).not.toMatch(/on\w+=/i);
        }
      ),
      { numRuns: XSS_PAYLOADS.length }
    );
  });
});

describe('Property 1: Input Sanitization - URL Validation', () => {
  it('should block dangerous URL protocols', () => {
    const dangerousUrls = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
    ];

    for (const url of dangerousUrls) {
      const result = InputValidator.validateURL(url);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Protocolo') || e.includes('URL'))).toBe(true);
    }
  });

  it('should accept valid HTTP/HTTPS URLs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('http', 'https'),
        fc.domain(),
        fc.webPath(),
        (protocol, domain, path) => {
          const url = `${protocol}://${domain}${path}`;
          const result = InputValidator.validateURL(url);
          expect(result.isValid).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 1: Input Sanitization - Numeric Validation', () => {
  it('should reject NaN and Infinity', () => {
    const invalidNumbers = [NaN, Infinity, -Infinity, 'not a number', ''];
    
    for (const invalid of invalidNumbers) {
      const result = InputValidator.validateNumber(invalid as number);
      expect(result.isValid).toBe(false);
    }
  });

  it('should enforce min/max bounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 501, max: 1000 }),
        (value, min, max) => {
          const result = InputValidator.validateNumber(value, { min, max });
          if (value >= min && value <= max) {
            expect(result.isValid).toBe(true);
          } else {
            expect(result.isValid).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject negative numbers when not allowed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: -1 }),
        (negativeValue) => {
          const result = InputValidator.validateNumber(negativeValue, { allowNegative: false });
          expect(result.isValid).toBe(false);
          expect(result.errors.some(e => e.includes('negativo'))).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 1: Input Sanitization - Email Validation', () => {
  it('should accept valid email formats', () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        (email) => {
          const result = InputValidator.validateEmail(email);
          // fast-check generates valid emails, should pass
          expect(result.sanitizedValue).toBe(email.toLowerCase().trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject emails with dangerous characters', () => {
    const dangerousEmails = [
      'user<script>@example.com',
      'user"test@example.com',
      'user(test)@example.com',
      'user[test]@example.com',
    ];

    for (const email of dangerousEmails) {
      const result = InputValidator.validateEmail(email);
      expect(result.isValid).toBe(false);
    }
  });

  it('should normalize emails to lowercase', () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        (email) => {
          const upperEmail = email.toUpperCase();
          const result = InputValidator.validateEmail(upperEmail);
          expect(result.sanitizedValue).toBe(email.toLowerCase());
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 1: Input Sanitization - Phone Validation', () => {
  it('should accept valid Brazilian phone numbers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 11, max: 99 }), // DDD
        fc.integer({ min: 900000000, max: 999999999 }), // 9 digits (mobile)
        (ddd, number) => {
          const phone = `(${ddd}) ${number.toString().slice(0, 5)}-${number.toString().slice(5)}`;
          const result = InputValidator.validatePhone(phone);
          expect(result.isValid).toBe(true);
          expect(result.sanitizedValue).toMatch(/^\d{11}$/);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should reject invalid phone formats', () => {
    const invalidPhones = [
      '123', // too short
      '12345678901234567890', // too long
      '(00) 99999-9999', // invalid DDD
      '(100) 99999-9999', // DDD > 99
    ];

    for (const phone of invalidPhones) {
      const result = InputValidator.validatePhone(phone);
      expect(result.isValid).toBe(false);
    }
  });

  it('should extract only digits from phone input', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\(\d{2}\) \d{4,5}-\d{4}$/),
        (formattedPhone) => {
          const result = InputValidator.validatePhone(formattedPhone);
          expect(result.sanitizedValue).toMatch(/^\d+$/);
        }
      ),
      { numRuns: 50 }
    );
  });
});
