/**
 * Testes de Penetração Simulados
 * 
 * Simula ataques comuns para validar as defesas do sistema:
 * - SQL Injection
 * - XSS (Cross-Site Scripting)
 * - CSRF (Cross-Site Request Forgery)
 * - File Upload Attacks
 * - Authentication Bypass
 * - Privilege Escalation
 * - Rate Limit Bypass
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import InputValidator from '../../utils/inputValidator';
import FileValidatorAdvanced from '../../utils/fileValidatorAdvanced';
import CSRFTokenManager from '../../services/csrfTokenManager';
import RateLimiter from '../../services/rateLimiter';
import BruteForceProtector from '../../services/bruteForceProtector';

describe('Penetration Tests - SQL Injection', () => {
  const sqlInjectionPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "1; SELECT * FROM users",
    "' UNION SELECT * FROM users --",
    "admin'--",
    "1' OR '1'='1' /*",
    "'; EXEC xp_cmdshell('dir'); --",
    "1; WAITFOR DELAY '0:0:10'--",
    "' OR 1=1#",
    "') OR ('1'='1",
  ];

  it.each(sqlInjectionPayloads)(
    'deve detectar SQL injection: %s',
    (payload) => {
      const result = InputValidator.containsSQLInjection(payload);
      expect(result).toBe(true);
    }
  );

  it('deve sanitizar inputs com SQL injection em validateText', () => {
    const payload = "'; DROP TABLE users; --";
    const result = InputValidator.validateText(payload);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Entrada contém caracteres não permitidos');
  });

  it('deve permitir texto normal sem falsos positivos', () => {
    const normalTexts = [
      'Carga de móveis para São Paulo',
      'Preciso de frete urgente',
      'Valor: R$ 1.500,00',
      'Contato: (11) 99999-9999',
    ];

    normalTexts.forEach(text => {
      const result = InputValidator.containsSQLInjection(text);
      expect(result).toBe(false);
    });
  });
});

describe('Penetration Tests - XSS', () => {
  const xssPayloads = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert("XSS")>',
    '<svg onload=alert("XSS")>',
    'javascript:alert("XSS")',
    '<iframe src="javascript:alert(\'XSS\')">',
    '<body onload=alert("XSS")>',
    '<input onfocus=alert("XSS") autofocus>',
    '<marquee onstart=alert("XSS")>',
    '<object data="javascript:alert(\'XSS\')">',
    '<embed src="javascript:alert(\'XSS\')">',
  ];

  it.each(xssPayloads)(
    'deve detectar XSS: %s',
    (payload) => {
      const result = InputValidator.containsXSS(payload);
      expect(result).toBe(true);
    }
  );

  it('deve sanitizar HTML perigoso', () => {
    const payload = '<script>alert("XSS")</script>';
    const sanitized = InputValidator.sanitizeHTML(payload);
    
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).toContain('&lt;script&gt;');
  });

  it('deve permitir texto normal sem falsos positivos', () => {
    const normalTexts = [
      'Olá, como vai?',
      'Preço < R$ 1000',
      'Entrega > 2 dias',
      'Email: teste@email.com',
    ];

    normalTexts.forEach(text => {
      const result = InputValidator.containsXSS(text);
      expect(result).toBe(false);
    });
  });
});

describe('Penetration Tests - CSRF', () => {
  beforeEach(() => {
    // Limpar sessionStorage
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  });

  it('deve gerar tokens únicos', () => {
    const tokens = new Set<string>();
    
    for (let i = 0; i < 100; i++) {
      const token = CSRFTokenManager.generateToken();
      expect(tokens.has(token)).toBe(false);
      tokens.add(token);
    }
  });

  it('deve rejeitar token inválido', () => {
    const validToken = CSRFTokenManager.generateToken();
    const invalidToken = 'invalid-token-12345';
    
    expect(CSRFTokenManager.validateToken(validToken)).toBe(true);
    expect(CSRFTokenManager.validateToken(invalidToken)).toBe(false);
  });

  it('deve rejeitar token vazio', () => {
    expect(CSRFTokenManager.validateToken('')).toBe(false);
    expect(CSRFTokenManager.validateToken(null as unknown as string)).toBe(false);
  });
});

describe('Penetration Tests - File Upload', () => {
  it('deve rejeitar arquivo com extensão falsa', async () => {
    // Arquivo .exe disfarçado de .jpg
    const fakeJpg = new File(
      [new Uint8Array([0x4D, 0x5A])], // Magic bytes de .exe
      'image.jpg',
      { type: 'image/jpeg' }
    );

    const result = await FileValidatorAdvanced.validateFile(fakeJpg);
    expect(result.isValid).toBe(false);
  });

  it('deve rejeitar arquivo muito grande', async () => {
    // Criar arquivo de 15MB (limite é 10MB)
    const largeFile = new File(
      [new ArrayBuffer(15 * 1024 * 1024)],
      'large.pdf',
      { type: 'application/pdf' }
    );

    const result = await FileValidatorAdvanced.validateFile(largeFile);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Arquivo muito grande. Máximo: 10MB');
  });

  it('deve rejeitar tipo de arquivo não permitido', async () => {
    const exeFile = new File(
      [new Uint8Array([0x4D, 0x5A])],
      'malware.exe',
      { type: 'application/x-msdownload' }
    );

    const result = await FileValidatorAdvanced.validateFile(exeFile);
    expect(result.isValid).toBe(false);
  });

  it('deve aceitar arquivo válido', async () => {
    // PDF válido com magic bytes corretos e tamanho razoável
    const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const pdfBody = new Uint8Array(1024).fill(0x20); // 1KB de conteúdo
    const pdfContent = new Uint8Array(pdfHeader.length + pdfBody.length);
    pdfContent.set(pdfHeader);
    pdfContent.set(pdfBody, pdfHeader.length);
    
    const validPdf = new File(
      [pdfContent],
      'document.pdf',
      { type: 'application/pdf' }
    );

    const result = await FileValidatorAdvanced.validateFile(validPdf);
    expect(result.isValid).toBe(true);
  });
});

describe('Penetration Tests - URL Injection', () => {
  const dangerousUrls = [
    'javascript:alert("XSS")',
    'data:text/html,<script>alert("XSS")</script>',
    'file:///etc/passwd',
    'vbscript:msgbox("XSS")',
  ];

  it.each(dangerousUrls)(
    'deve bloquear URL perigosa: %s',
    (url) => {
      const result = InputValidator.validateURL(url);
      expect(result.isValid).toBe(false);
    }
  );

  it('deve aceitar URLs HTTP/HTTPS válidas', () => {
    const validUrls = [
      'https://example.com',
      'http://localhost:3000',
      'https://api.example.com/v1/data',
    ];

    validUrls.forEach(url => {
      const result = InputValidator.validateURL(url);
      expect(result.isValid).toBe(true);
    });
  });
});

describe('Penetration Tests - Rate Limiting', () => {
  beforeEach(() => {
    // Reset rate limiter
    RateLimiter.resetLimit('test-ip', 'login_ip');
  });

  it('deve bloquear após exceder limite de login', async () => {
    const testIP = 'attacker-ip-' + Date.now();

    // Fazer 5 tentativas (limite)
    for (let i = 0; i < 5; i++) {
      const result = await RateLimiter.checkLoginLimit(testIP);
      expect(result.allowed).toBe(true);
    }

    // 6ª tentativa deve ser bloqueada
    const blocked = await RateLimiter.checkLoginLimit(testIP);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('deve retornar header Retry-After quando bloqueado', async () => {
    const testIP = 'rate-limit-test-' + Date.now();

    // Exceder limite
    for (let i = 0; i < 6; i++) {
      await RateLimiter.checkLoginLimit(testIP);
    }

    const result = await RateLimiter.checkLoginLimit(testIP);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThan(0);
  });
});

describe('Penetration Tests - Brute Force', () => {
  beforeEach(() => {
    BruteForceProtector.unlockAccount('test-phone');
  });

  it('deve bloquear conta após 5 tentativas falhas', async () => {
    const phone = 'brute-force-test-' + Date.now();

    // 5 tentativas falhas
    for (let i = 0; i < 5; i++) {
      await BruteForceProtector.recordAttempt(phone, '127.0.0.1', false);
    }

    const lockout = await BruteForceProtector.checkLockout(phone);
    expect(lockout.isLocked).toBe(true);
    expect(lockout.lockedUntil).toBeDefined();
    expect(lockout.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('deve resetar contador após login bem-sucedido', async () => {
    const phone = 'reset-test-' + Date.now();

    // 3 tentativas falhas
    for (let i = 0; i < 3; i++) {
      await BruteForceProtector.recordAttempt(phone, false);
    }

    // Login bem-sucedido
    await BruteForceProtector.recordAttempt(phone, true);

    // Verificar que contador foi resetado
    const lockout = await BruteForceProtector.checkLockout(phone);
    expect(lockout.isLocked).toBe(false);
  });
});

describe('Penetration Tests - Authentication Bypass', () => {
  it('deve rejeitar telefone com formato inválido', () => {
    const invalidPhones = [
      '123', // muito curto
      '12345678901234567890', // muito longo
      'abcdefghij', // letras
      '(11) 9999-999', // incompleto
    ];

    invalidPhones.forEach(phone => {
      const result = InputValidator.validatePhone(phone);
      expect(result.isValid).toBe(false);
    });
  });

  it('deve aceitar telefone válido', () => {
    const validPhones = [
      '11999999999',
      '1199999999',
      '(11) 9 9999-9999',
      '(11) 9999-9999',
    ];

    validPhones.forEach(phone => {
      const result = InputValidator.validatePhone(phone);
      expect(result.isValid).toBe(true);
    });
  });
});

describe('Penetration Tests - Input Length', () => {
  it('deve rejeitar descrição de frete muito longa', () => {
    const longDescription = 'A'.repeat(501); // Limite é 500
    const result = InputValidator.validateFreteDescription(longDescription);
    
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('500'))).toBe(true);
  });

  it('deve rejeitar mensagem de chat muito longa', () => {
    const longMessage = 'B'.repeat(1001); // Limite é 1000
    const result = InputValidator.validateChatMessage(longMessage);
    
    expect(result.isValid).toBe(false);
  });

  it('deve rejeitar nome muito longo', () => {
    const longName = 'C'.repeat(201); // Limite é 200
    const result = InputValidator.validateUserName(longName);
    
    expect(result.isValid).toBe(false);
  });
});

describe('Penetration Tests - Query String Injection', () => {
  it('deve sanitizar parâmetros de URL com SQL injection', () => {
    const maliciousParam = "id=1' OR '1'='1";
    const result = InputValidator.containsSQLInjection(maliciousParam);
    
    expect(result).toBe(true);
  });

  it('deve sanitizar parâmetros de URL com XSS', () => {
    const maliciousParam = 'name=<script>alert(1)</script>';
    const result = InputValidator.containsXSS(maliciousParam);
    
    expect(result).toBe(true);
  });
});
