/**
 * RateLimiter - Controle de taxa de requisições
 * 
 * Implementa rate limiting por IP e por usuário usando sliding window algorithm.
 * Protege contra:
 * - Ataques de força bruta
 * - Scraping de dados
 * - Abuso de API
 * - DoS (Denial of Service)
 */

import { supabase } from './supabase';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // seconds
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
}

// Rate limit configurations
const RATE_LIMITS = {
  // Login: 5 attempts per 15 minutes per IP
  LOGIN_BY_IP: {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: 'login_ip',
  },
  // API: 100 requests per minute per IP
  API_BY_IP: {
    maxRequests: 100,
    windowMs: 60 * 1000,
    keyPrefix: 'api_ip',
  },
  // Frete creation: 10 per hour per user
  FRETE_CREATION: {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000,
    keyPrefix: 'frete_user',
  },
  // Document upload: 20 per hour per user
  DOCUMENT_UPLOAD: {
    maxRequests: 20,
    windowMs: 60 * 60 * 1000,
    keyPrefix: 'doc_user',
  },
  // Chat messages: 100 per hour per user
  CHAT_MESSAGE: {
    maxRequests: 100,
    windowMs: 60 * 60 * 1000,
    keyPrefix: 'chat_user',
  },
  // Password reset: 3 per hour per phone
  PASSWORD_RESET: {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
    keyPrefix: 'reset_phone',
  },
} as const;

// In-memory store for rate limits (in production, use Redis)
const store = new Map<string, { count: number; resetAt: number; timestamps: number[] }>();

class RateLimiter {
  /**
   * Checks if a request is allowed under the rate limit
   * Uses sliding window algorithm for accurate counting
   */
  static async checkLimit(
    identifier: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const key = `${config.keyPrefix}:${identifier}`;
    const windowStart = now - config.windowMs;

    // Get or create record
    let record = store.get(key);

    if (!record) {
      record = { count: 0, resetAt: now + config.windowMs, timestamps: [] };
    }

    // Remove timestamps outside the window (sliding window)
    record.timestamps = record.timestamps.filter(ts => ts > windowStart);
    record.count = record.timestamps.length;

    // Check if limit exceeded
    if (record.count >= config.maxRequests) {
      const oldestTimestamp = record.timestamps[0] || now;
      const retryAfter = Math.ceil((oldestTimestamp + config.windowMs - now) / 1000);

      // Log rate limit violation
      await this.logViolation(key, identifier, config.keyPrefix);

      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(oldestTimestamp + config.windowMs),
        retryAfter: Math.max(1, retryAfter),
      };
    }

    // Add current timestamp and update record
    record.timestamps.push(now);
    record.count = record.timestamps.length;
    record.resetAt = now + config.windowMs;
    store.set(key, record);

    return {
      allowed: true,
      remaining: config.maxRequests - record.count,
      resetAt: new Date(record.resetAt),
    };
  }

  /**
   * Rate limit for login attempts by IP
   */
  static async checkLoginLimit(ipAddress: string): Promise<RateLimitResult> {
    return this.checkLimit(ipAddress, RATE_LIMITS.LOGIN_BY_IP);
  }

  /**
   * Rate limit for general API requests by IP
   */
  static async checkAPILimit(ipAddress: string): Promise<RateLimitResult> {
    return this.checkLimit(ipAddress, RATE_LIMITS.API_BY_IP);
  }

  /**
   * Rate limit for frete creation by user
   */
  static async checkFreteCreationLimit(userId: string): Promise<RateLimitResult> {
    return this.checkLimit(userId, RATE_LIMITS.FRETE_CREATION);
  }

  /**
   * Rate limit for document uploads by user
   */
  static async checkDocumentUploadLimit(userId: string): Promise<RateLimitResult> {
    return this.checkLimit(userId, RATE_LIMITS.DOCUMENT_UPLOAD);
  }

  /**
   * Rate limit for chat messages by user
   */
  static async checkChatMessageLimit(userId: string): Promise<RateLimitResult> {
    return this.checkLimit(userId, RATE_LIMITS.CHAT_MESSAGE);
  }

  /**
   * Rate limit for password reset requests by phone
   */
  static async checkPasswordResetLimit(phone: string): Promise<RateLimitResult> {
    return this.checkLimit(phone, RATE_LIMITS.PASSWORD_RESET);
  }

  /**
   * Gets rate limit headers for HTTP response
   */
  static getHeaders(result: RateLimitResult, config: RateLimitConfig): RateLimitHeaders {
    const headers: RateLimitHeaders = {
      'X-RateLimit-Limit': config.maxRequests.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': Math.floor(result.resetAt.getTime() / 1000).toString(),
    };

    if (result.retryAfter) {
      headers['Retry-After'] = result.retryAfter.toString();
    }

    return headers;
  }

  /**
   * Resets rate limit for a specific key (admin function)
   */
  static resetLimit(identifier: string, keyPrefix: string): void {
    const key = `${keyPrefix}:${identifier}`;
    store.delete(key);
    console.log(`[RATE_LIMIT] Reset limit for ${key}`);
  }

  /**
   * Gets current usage for a specific key
   */
  static getUsage(identifier: string, keyPrefix: string): { count: number; resetAt: Date } | null {
    const key = `${keyPrefix}:${identifier}`;
    const record = store.get(key);

    if (!record) {
      return null;
    }

    return {
      count: record.count,
      resetAt: new Date(record.resetAt),
    };
  }

  /**
   * Logs rate limit violation to audit system
   */
  private static async logViolation(
    key: string,
    identifier: string,
    limitType: string
  ): Promise<void> {
    console.warn(`[RATE_LIMIT] Limit exceeded: ${key}`);

    try {
      await supabase.from('audit_logs').insert({
        action: 'rate_limit_violation',
        new_data: {
          key,
          identifier,
          limit_type: limitType,
        },
      });
    } catch (error) {
      console.error('[RATE_LIMIT] Error logging violation:', error);
    }
  }

  /**
   * Cleans up expired entries (run periodically)
   */
  static cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, record] of store.entries()) {
      // Remove entries with no recent timestamps
      if (record.timestamps.length === 0 || record.resetAt < now - 3600000) {
        store.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[RATE_LIMIT] Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Gets all rate limit configurations (for documentation/admin)
   */
  static getConfigurations(): typeof RATE_LIMITS {
    return RATE_LIMITS;
  }
}

// Cleanup expired entries every 5 minutes
if (typeof window !== 'undefined') {
  setInterval(() => RateLimiter.cleanup(), 5 * 60 * 1000);
}

export default RateLimiter;
export { RATE_LIMITS };
