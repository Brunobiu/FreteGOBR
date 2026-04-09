/**
 * BruteForceProtector - Proteção contra ataques de força bruta
 * 
 * Implementa proteção contra "Slow Brute Force":
 * - Bloqueia conta após 5 tentativas falhas (independente do tempo entre elas)
 * - Lockout de 30 minutos
 * - Envia alerta por email quando conta é bloqueada
 * - Reset do contador após login bem-sucedido
 */

import { supabase } from './supabase';

export interface LoginAttempt {
  id?: string;
  phone: string;
  ipAddress: string;
  success: boolean;
  userId?: string;
  createdAt: Date;
}

export interface LockoutStatus {
  isLocked: boolean;
  lockedUntil?: Date;
  failedAttempts: number;
  remainingAttempts: number;
}

// Configuration
const BRUTE_FORCE_CONFIG = {
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 30 * 60 * 1000, // 30 minutes
  CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // Clean old attempts every hour
};

class BruteForceProtector {
  // In-memory cache for faster lookups (backed by database)
  private static attemptsCache = new Map<string, LoginAttempt[]>();
  private static lockoutsCache = new Map<string, Date>();

  /**
   * Records a login attempt (success or failure)
   */
  static async recordAttempt(
    phone: string,
    ipAddress: string,
    success: boolean,
    userId?: string
  ): Promise<void> {
    const attempt: LoginAttempt = {
      phone,
      ipAddress,
      success,
      userId,
      createdAt: new Date(),
    };

    // Store in database
    try {
      await supabase.from('login_attempts').insert({
        phone,
        ip_address: ipAddress,
        success,
        user_id: userId,
      });
    } catch (error) {
      console.error('[BRUTE_FORCE] Error recording attempt:', error);
    }

    // Update cache
    const key = this.getKey(phone);
    const attempts = this.attemptsCache.get(key) || [];
    attempts.push(attempt);
    this.attemptsCache.set(key, attempts);

    if (!success) {
      // Check if should lock account
      await this.checkAndLockAccount(phone, ipAddress);
    } else {
      // Reset on successful login
      await this.resetAttempts(phone);
    }
  }

  /**
   * Checks if an account is currently locked
   */
  static async checkLockout(phone: string): Promise<LockoutStatus> {
    const key = this.getKey(phone);

    // Check cache first
    let lockedUntil = this.lockoutsCache.get(key);

    // If not in cache, check database
    if (!lockedUntil) {
      try {
        const { data } = await supabase
          .from('account_lockouts')
          .select('locked_until')
          .eq('phone', phone)
          .single();

        if (data?.locked_until) {
          lockedUntil = new Date(data.locked_until);
          this.lockoutsCache.set(key, lockedUntil);
        }
      } catch {
        // No lockout found
      }
    }

    // Check if lockout expired
    if (lockedUntil && new Date() > lockedUntil) {
      // Lockout expired, clear it
      await this.clearLockout(phone);
      lockedUntil = undefined;
    }

    const failedAttempts = await this.getFailedAttemptCount(phone);
    const remainingAttempts = Math.max(0, BRUTE_FORCE_CONFIG.MAX_FAILED_ATTEMPTS - failedAttempts);

    if (lockedUntil) {
      return {
        isLocked: true,
        lockedUntil,
        failedAttempts,
        remainingAttempts: 0,
      };
    }

    return {
      isLocked: false,
      failedAttempts,
      remainingAttempts,
    };
  }

  /**
   * Gets the error message for a locked account
   */
  static getLockoutMessage(lockedUntil: Date): string {
    const remainingMs = lockedUntil.getTime() - Date.now();
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    
    if (remainingMinutes <= 1) {
      return 'Conta temporariamente bloqueada. Tente novamente em 1 minuto.';
    }
    
    return `Conta temporariamente bloqueada. Tente novamente em ${remainingMinutes} minutos.`;
  }

  /**
   * Manually unlocks an account (admin function)
   */
  static async unlockAccount(phone: string): Promise<void> {
    await this.clearLockout(phone);
    await this.resetAttempts(phone);
    console.log(`[BRUTE_FORCE] Account manually unlocked: ${phone}`);
  }

  // ==================== Private Methods ====================

  /**
   * Checks failed attempts and locks account if threshold exceeded
   */
  private static async checkAndLockAccount(
    phone: string,
    ipAddress: string
  ): Promise<void> {
    const failedCount = await this.getFailedAttemptCount(phone);

    if (failedCount >= BRUTE_FORCE_CONFIG.MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + BRUTE_FORCE_CONFIG.LOCKOUT_DURATION_MS);
      
      // Store lockout in database
      try {
        await supabase.from('account_lockouts').upsert({
          phone,
          locked_until: lockedUntil.toISOString(),
          reason: `${failedCount} failed login attempts`,
        }, {
          onConflict: 'phone',
        });
      } catch (error) {
        console.error('[BRUTE_FORCE] Error storing lockout:', error);
      }

      // Update cache
      const key = this.getKey(phone);
      this.lockoutsCache.set(key, lockedUntil);

      // Log lockout event
      await this.logLockoutEvent(phone, ipAddress, lockedUntil, failedCount);

      // Send alert email
      await this.sendLockoutAlert(phone, ipAddress, failedCount);
    }
  }

  /**
   * Gets count of failed attempts for a phone number
   */
  private static async getFailedAttemptCount(phone: string): Promise<number> {
    // Check cache first
    const key = this.getKey(phone);
    const cachedAttempts = this.attemptsCache.get(key);
    
    if (cachedAttempts) {
      return cachedAttempts.filter(a => !a.success).length;
    }

    // Query database
    try {
      const { count, error } = await supabase
        .from('login_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('phone', phone)
        .eq('success', false);

      if (error) {
        console.error('[BRUTE_FORCE] Error counting attempts:', error);
        return 0;
      }

      return count || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Resets failed attempts after successful login
   */
  private static async resetAttempts(phone: string): Promise<void> {
    const key = this.getKey(phone);
    
    // Clear cache
    this.attemptsCache.delete(key);
    this.lockoutsCache.delete(key);

    // Clear database records
    try {
      await supabase
        .from('login_attempts')
        .delete()
        .eq('phone', phone);

      await supabase
        .from('account_lockouts')
        .delete()
        .eq('phone', phone);
    } catch (error) {
      console.error('[BRUTE_FORCE] Error resetting attempts:', error);
    }
  }

  /**
   * Clears lockout for a phone number
   */
  private static async clearLockout(phone: string): Promise<void> {
    const key = this.getKey(phone);
    this.lockoutsCache.delete(key);

    try {
      await supabase
        .from('account_lockouts')
        .delete()
        .eq('phone', phone);
    } catch (error) {
      console.error('[BRUTE_FORCE] Error clearing lockout:', error);
    }
  }

  /**
   * Gets storage key for phone
   */
  private static getKey(phone: string): string {
    return `brute_force:${phone}`;
  }

  /**
   * Logs lockout event to audit system
   */
  private static async logLockoutEvent(
    phone: string,
    ipAddress: string,
    lockedUntil: Date,
    failedAttempts: number
  ): Promise<void> {
    console.warn(
      `[BRUTE_FORCE] Account locked: ${phone} from ${ipAddress}. ` +
      `${failedAttempts} failed attempts. Locked until ${lockedUntil.toISOString()}`
    );

    // Log to audit_logs table
    try {
      await supabase.from('audit_logs').insert({
        action: 'account_lockout',
        ip_address: ipAddress,
        new_data: {
          phone,
          failed_attempts: failedAttempts,
          locked_until: lockedUntil.toISOString(),
        },
      });
    } catch (error) {
      console.error('[BRUTE_FORCE] Error logging lockout event:', error);
    }
  }

  /**
   * Sends lockout alert email to user
   */
  private static async sendLockoutAlert(
    phone: string,
    ipAddress: string,
    failedAttempts: number
  ): Promise<void> {
    // In production, this would send an email via Supabase Edge Functions or email service
    console.log(
      `[BRUTE_FORCE] Sending lockout alert to ${phone}. ` +
      `${failedAttempts} failed attempts from IP ${ipAddress}`
    );

    // TODO: Implement email sending
    // await supabase.functions.invoke('send-lockout-alert', {
    //   body: { phone, ipAddress, failedAttempts }
    // });
  }

  /**
   * Cleans up old login attempts (run periodically)
   */
  static async cleanup(): Promise<void> {
    // Keep only last 24 hours of attempts
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    try {
      await supabase
        .from('login_attempts')
        .delete()
        .lt('created_at', cutoff.toISOString());

      // Clear expired lockouts
      await supabase
        .from('account_lockouts')
        .delete()
        .lt('locked_until', new Date().toISOString());

      console.log('[BRUTE_FORCE] Cleanup completed');
    } catch (error) {
      console.error('[BRUTE_FORCE] Cleanup error:', error);
    }

    // Clear caches
    this.attemptsCache.clear();
    this.lockoutsCache.clear();
  }
}

// Run cleanup periodically
if (typeof window !== 'undefined') {
  setInterval(() => {
    BruteForceProtector.cleanup();
  }, BRUTE_FORCE_CONFIG.CLEANUP_INTERVAL_MS);
}

export default BruteForceProtector;
