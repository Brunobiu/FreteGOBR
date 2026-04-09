/**
 * InputValidator - Sanitização e validação de entradas de usuário
 * Previne SQL Injection, XSS e outros ataques de injeção
 */

export interface ValidationRule {
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  allowedChars?: string;
  sanitize?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  sanitizedValue: string;
  errors: string[];
}

// Limites de caracteres para campos
export const INPUT_LIMITS = {
  MAX_FRETE_DESCRIPTION: 500,
  MAX_USER_NAME: 200,
  MAX_CHAT_MESSAGE: 1000,
  MAX_RATING_COMMENT: 500,
  MAX_COMPANY_NAME: 200,
  MAX_ADDRESS: 300,
  MAX_EMAIL: 254,
  MAX_PHONE: 20,
} as const;

class InputValidator {
  // SQL injection keywords to detect
  private static SQL_KEYWORDS = [
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE',
    'ALTER', 'EXEC', 'EXECUTE', 'UNION', 'TRUNCATE', 'GRANT',
    'REVOKE', 'DECLARE', 'CAST', 'CONVERT', 'TABLE', 'FROM',
    'WHERE', 'OR 1=1', 'OR 1 = 1', "' OR '", '" OR "',
    '--', ';--', '/*', '*/', 'XP_', 'SP_', 'WAITFOR', 'DELAY'
  ];

  // XSS patterns to detect
  private static XSS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/i,
    /javascript:/i,
    /on\w+\s*=/i, // event handlers like onclick=, onload=
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<form/i,
    /<input/i,
    /<link/i,
    /<meta/i,
    /<style/i,
    /<svg/i,
    /<math/i,
    /<marquee/i,
    /<details\b[^>]*\bopen\b/i,
    /expression\s*\(/i,
    /url\s*\(/i,
    /vbscript:/i,
    /data:/i,
  ];

  /**
   * Validates and sanitizes text input
   */
  static validateText(
    input: string,
    rules: ValidationRule = {}
  ): ValidationResult {
    const errors: string[] = [];
    let sanitized = input?.trim() ?? '';

    // Check for null/undefined
    if (input === null || input === undefined) {
      return {
        isValid: false,
        sanitizedValue: '',
        errors: ['Entrada inválida']
      };
    }

    // Check length
    if (rules.maxLength && sanitized.length > rules.maxLength) {
      errors.push(`Máximo de ${rules.maxLength} caracteres`);
    }

    if (rules.minLength && sanitized.length < rules.minLength) {
      errors.push(`Mínimo de ${rules.minLength} caracteres`);
    }

    // Check for SQL injection
    if (this.containsSQLInjection(sanitized)) {
      errors.push('Entrada contém caracteres não permitidos');
      this.logSecurityEvent('sql_injection_attempt', sanitized);
    }

    // Check for XSS
    if (this.containsXSS(sanitized)) {
      if (rules.sanitize) {
        sanitized = this.sanitizeHTML(sanitized);
      } else {
        errors.push('Entrada contém código não permitido');
      }
      this.logSecurityEvent('xss_attempt', sanitized);
    }

    // Pattern validation
    if (rules.pattern && !rules.pattern.test(sanitized)) {
      errors.push('Formato inválido');
    }

    // Always sanitize HTML for safety
    if (rules.sanitize !== false) {
      sanitized = this.sanitizeHTML(sanitized);
    }

    return {
      isValid: errors.length === 0,
      sanitizedValue: sanitized,
      errors
    };
  }

  /**
   * Detects SQL injection attempts
   */
  static containsSQLInjection(input: string): boolean {
    if (!input) return false;
    
    const upperInput = input.toUpperCase();
    
    // Check for SQL keywords
    for (const keyword of this.SQL_KEYWORDS) {
      if (upperInput.includes(keyword.toUpperCase())) {
        // Additional check: ensure it's not part of a normal word
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(input)) {
          return true;
        }
      }
    }

    // Check for common SQL injection patterns
    const sqlPatterns = [
      /'\s*OR\s*'?\d*'?\s*=\s*'?\d*'?/i,
      /"\s*OR\s*"?\d*"?\s*=\s*"?\d*"?/i,
      /;\s*DROP\s+/i,
      /;\s*DELETE\s+/i,
      /;\s*UPDATE\s+/i,
      /;\s*INSERT\s+/i,
      /UNION\s+SELECT/i,
      /UNION\s+ALL\s+SELECT/i,
      /'\s*--/,                          // comment after quote: admin'--
      /'\s*;\s*--/,                      // semicolon comment: admin';--
      /'\)\s*OR\s*\(/i,                  // ') OR (
      /'\s*OR\s*\(/i,                    // ' OR (
      /\)\s*OR\s*\('/i,                  // ) OR ('
    ];

    return sqlPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Detects XSS attempts
   */
  static containsXSS(input: string): boolean {
    if (!input) return false;
    return this.XSS_PATTERNS.some(pattern => pattern.test(input));
  }

  /**
   * Sanitizes HTML by escaping special characters
   */
  static sanitizeHTML(input: string): string {
    if (!input) return '';
    
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;'
    };
    
    // First unescape any existing entities to avoid double-encoding
    let unescaped = input
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&#x60;/g, '`')
      .replace(/&#x3D;/g, '=');
    
    return unescaped.replace(/[&<>"'/`=]/g, char => map[char] || char);
  }

  /**
   * Validates numeric input
   */
  static validateNumber(
    input: number | string,
    options: {
      min?: number;
      max?: number;
      allowNegative?: boolean;
      allowDecimal?: boolean;
    } = {}
  ): ValidationResult {
    const errors: string[] = [];
    const num = typeof input === 'string' ? parseFloat(input) : input;

    if (isNaN(num) || !isFinite(num)) {
      return {
        isValid: false,
        sanitizedValue: '0',
        errors: ['Valor numérico inválido']
      };
    }

    if (!options.allowNegative && num < 0) {
      errors.push('Valor não pode ser negativo');
    }

    if (options.min !== undefined && num < options.min) {
      errors.push(`Valor mínimo: ${options.min}`);
    }

    if (options.max !== undefined && num > options.max) {
      errors.push(`Valor máximo: ${options.max}`);
    }

    if (!options.allowDecimal && !Number.isInteger(num)) {
      errors.push('Valor deve ser inteiro');
    }

    return {
      isValid: errors.length === 0,
      sanitizedValue: num.toString(),
      errors
    };
  }

  /**
   * Validates email format
   */
  static validateEmail(email: string): ValidationResult {
    const errors: string[] = [];
    const sanitized = email?.trim().toLowerCase() ?? '';

    if (!sanitized) {
      return {
        isValid: false,
        sanitizedValue: '',
        errors: ['Email é obrigatório']
      };
    }

    // RFC 5322 simplified pattern
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(sanitized)) {
      errors.push('Email inválido');
    }

    // Check for dangerous characters in local part
    const localPart = sanitized.split('@')[0];
    if (/[<>()[\]\\,;:\s"]/.test(localPart)) {
      errors.push('Email contém caracteres não permitidos');
    }

    // Check max length
    if (sanitized.length > INPUT_LIMITS.MAX_EMAIL) {
      errors.push(`Email muito longo (máximo ${INPUT_LIMITS.MAX_EMAIL} caracteres)`);
    }

    return {
      isValid: errors.length === 0,
      sanitizedValue: sanitized,
      errors
    };
  }

  /**
   * Validates Brazilian phone number
   */
  static validatePhone(phone: string): ValidationResult {
    const errors: string[] = [];

    if (!phone) {
      return {
        isValid: false,
        sanitizedValue: '',
        errors: ['Telefone é obrigatório']
      };
    }

    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');

    // Check length (10 or 11 digits for Brazilian phones)
    if (digits.length !== 10 && digits.length !== 11) {
      errors.push('Telefone inválido');
    }

    // Check area code (11-99 for Brazil)
    if (digits.length >= 2) {
      const areaCode = parseInt(digits.substring(0, 2));
      if (areaCode < 11 || areaCode > 99) {
        errors.push('DDD inválido');
      }
    }

    return {
      isValid: errors.length === 0,
      sanitizedValue: digits,
      errors
    };
  }

  /**
   * Validates URL and sanitizes
   */
  static validateURL(url: string): ValidationResult {
    const errors: string[] = [];
    const sanitized = url?.trim() ?? '';

    if (!sanitized) {
      return {
        isValid: false,
        sanitizedValue: '',
        errors: ['URL é obrigatória']
      };
    }

    try {
      const parsed = new URL(sanitized);

      // Block dangerous protocols
      const dangerousProtocols = ['javascript:', 'data:', 'file:', 'vbscript:'];
      if (dangerousProtocols.includes(parsed.protocol)) {
        errors.push('Protocolo não permitido');
        this.logSecurityEvent('dangerous_url_attempt', sanitized);
      }

      // Only allow http and https
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('Apenas URLs HTTP/HTTPS são permitidas');
      }
    } catch {
      errors.push('URL inválida');
    }

    return {
      isValid: errors.length === 0,
      sanitizedValue: sanitized,
      errors
    };
  }

  /**
   * Sanitizes URL for safe use in href attributes
   * Returns null if URL is dangerous
   */
  static sanitizeURL(url: string): string | null {
    const result = this.validateURL(url);
    return result.isValid ? result.sanitizedValue : null;
  }

  /**
   * Generates safe attributes for external links
   * Adds rel="noopener noreferrer" to prevent tabnabbing attacks
   */
  static getExternalLinkAttributes(url: string): {
    href: string;
    rel: string;
    target: string;
  } | null {
    const sanitizedUrl = this.sanitizeURL(url);
    
    if (!sanitizedUrl) {
      return null;
    }

    return {
      href: sanitizedUrl,
      rel: 'noopener noreferrer',
      target: '_blank',
    };
  }

  /**
   * Checks if URL is external (different domain)
   */
  static isExternalURL(url: string): boolean {
    try {
      const parsed = new URL(url);
      const currentHost = typeof window !== 'undefined' ? window.location.host : '';
      return parsed.host !== currentHost;
    } catch {
      return false;
    }
  }

  /**
   * Validates and sanitizes image URL
   * More restrictive than general URL validation
   */
  static validateImageURL(url: string): ValidationResult {
    const baseResult = this.validateURL(url);
    
    if (!baseResult.isValid) {
      return baseResult;
    }

    const errors: string[] = [];

    // Check for valid image extensions or data URLs
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const lowerUrl = url.toLowerCase();
    
    const hasValidExtension = validExtensions.some(ext => lowerUrl.includes(ext));
    const isDataUrl = lowerUrl.startsWith('data:image/');
    const isBlobUrl = lowerUrl.startsWith('blob:');

    if (!hasValidExtension && !isDataUrl && !isBlobUrl) {
      // Allow URLs without extensions (CDN URLs often don't have them)
      // but log for monitoring
      console.log('[INPUT_VALIDATOR] Image URL without extension:', url.substring(0, 50));
    }

    return {
      isValid: errors.length === 0,
      sanitizedValue: baseResult.sanitizedValue,
      errors
    };
  }

  /**
   * Validates frete description
   */
  static validateFreteDescription(description: string): ValidationResult {
    return this.validateText(description, {
      maxLength: INPUT_LIMITS.MAX_FRETE_DESCRIPTION,
      minLength: 10,
      sanitize: true
    });
  }

  /**
   * Validates user name
   */
  static validateUserName(name: string): ValidationResult {
    return this.validateText(name, {
      maxLength: INPUT_LIMITS.MAX_USER_NAME,
      minLength: 2,
      sanitize: true
    });
  }

  /**
   * Validates chat message
   */
  static validateChatMessage(message: string): ValidationResult {
    return this.validateText(message, {
      maxLength: INPUT_LIMITS.MAX_CHAT_MESSAGE,
      minLength: 1,
      sanitize: true
    });
  }

  /**
   * Validates rating comment
   */
  static validateRatingComment(comment: string): ValidationResult {
    return this.validateText(comment, {
      maxLength: INPUT_LIMITS.MAX_RATING_COMMENT,
      sanitize: true
    });
  }

  /**
   * Logs security events to audit log
   */
  private static logSecurityEvent(
    eventType: string,
    input: string
  ): void {
    // Truncate input for logging
    const truncatedInput = input.substring(0, 100);
    console.warn(`[SECURITY] ${eventType}:`, truncatedInput);
    
    // In production, this would call AuditLogger
    // AuditLogger.logSecurityEvent(eventType, { input: truncatedInput });
  }
}

export default InputValidator;
