/**
 * SessionManager - Gerenciamento de sessões com controle de sessão única
 * 
 * Implementa o padrão "Derruba-Um": apenas uma sessão ativa por usuário.
 * Se o usuário logar em outro dispositivo, a sessão anterior é invalidada.
 * 
 * Features:
 * - Sessão única por usuário (single session)
 * - Revogação de JWT via blacklist
 * - Timeout por inatividade (30 minutos)
 * - Aviso antes de expirar (5 minutos)
 * - Tracking de atividade do usuário
 */

import { supabase } from './supabase';

export interface SessionData {
  userId: string;
  sessionVersion: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  lastActivityAt: Date;
}

export interface SessionValidationResult {
  isValid: boolean;
  reason?: 'expired' | 'revoked' | 'version_mismatch' | 'blacklisted' | 'inactive';
}

// Session configuration
const SESSION_CONFIG = {
  TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes of inactivity
  WARNING_BEFORE_MS: 5 * 60 * 1000, // Warn 5 minutes before expiry
  STORAGE_KEY: 'fretego_session',
  BLACKLIST_CLEANUP_INTERVAL: 60 * 60 * 1000, // Clean blacklist every hour
};

class SessionManager {
  private static activityListenersAttached = false;
  private static warningCallback: (() => void) | null = null;
  private static expiredCallback: (() => void) | null = null;

  /**
   * Creates a new session and invalidates all previous sessions for the user
   */
  static async createSession(
    userId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number
  ): Promise<SessionData> {
    // 1. Increment session_version in database (invalidates old sessions)
    const newVersion = await this.incrementSessionVersion(userId);

    // 2. Create session data
    const session: SessionData = {
      userId,
      sessionVersion: newVersion,
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      lastActivityAt: new Date(),
    };

    // 3. Store session locally
    this.storeSession(session);

    // 4. Start activity tracking
    this.startActivityTracking();

    // 5. Log session creation
    console.log(`[SESSION] New session created for user ${userId}, version ${newVersion}`);

    return session;
  }

  /**
   * Validates if the current session is still valid
   */
  static async validateSession(): Promise<SessionValidationResult> {
    const session = this.getStoredSession();

    if (!session) {
      return { isValid: false, reason: 'expired' };
    }

    // 1. Check if token is blacklisted
    const isBlacklisted = await this.isTokenBlacklisted(session.accessToken);
    if (isBlacklisted) {
      this.clearSession();
      return { isValid: false, reason: 'blacklisted' };
    }

    // 2. Check if session version matches current version in database
    const currentVersion = await this.getCurrentSessionVersion(session.userId);
    if (session.sessionVersion !== currentVersion) {
      this.clearSession();
      return { isValid: false, reason: 'version_mismatch' };
    }

    // 3. Check if session expired (JWT expiration)
    if (new Date() > session.expiresAt) {
      this.clearSession();
      return { isValid: false, reason: 'expired' };
    }

    // 4. Check inactivity timeout
    const inactiveTime = Date.now() - session.lastActivityAt.getTime();
    if (inactiveTime > SESSION_CONFIG.TIMEOUT_MS) {
      await this.revokeSession(session.userId, session.accessToken);
      return { isValid: false, reason: 'inactive' };
    }

    return { isValid: true };
  }

  /**
   * Revokes the current session (logout)
   */
  static async revokeSession(userId: string, token: string): Promise<void> {
    // 1. Add token to blacklist
    await this.addToBlacklist(token, userId);

    // 2. Clear local session
    this.clearSession();

    // 3. Log logout
    console.log(`[SESSION] Session revoked for user ${userId}`);
  }

  /**
   * Updates the last activity timestamp
   */
  static updateActivity(): void {
    const session = this.getStoredSession();
    if (session) {
      session.lastActivityAt = new Date();
      this.storeSession(session);
    }
  }

  /**
   * Checks if session is about to expire and should show warning
   */
  static shouldShowWarning(): boolean {
    const session = this.getStoredSession();
    if (!session) return false;

    const inactiveTime = Date.now() - session.lastActivityAt.getTime();
    const timeUntilExpiry = SESSION_CONFIG.TIMEOUT_MS - inactiveTime;

    return timeUntilExpiry > 0 && timeUntilExpiry <= SESSION_CONFIG.WARNING_BEFORE_MS;
  }

  /**
   * Gets time remaining until session expires (in seconds)
   */
  static getTimeRemaining(): number {
    const session = this.getStoredSession();
    if (!session) return 0;

    const inactiveTime = Date.now() - session.lastActivityAt.getTime();
    const remaining = SESSION_CONFIG.TIMEOUT_MS - inactiveTime;

    return Math.max(0, Math.floor(remaining / 1000));
  }

  /**
   * Sets callbacks for session events
   */
  static setCallbacks(
    onWarning: () => void,
    onExpired: () => void
  ): void {
    this.warningCallback = onWarning;
    this.expiredCallback = onExpired;
  }

  /**
   * Gets the current session data
   */
  static getSession(): SessionData | null {
    return this.getStoredSession();
  }

  /**
   * Checks if user has an active session
   */
  static hasSession(): boolean {
    return this.getStoredSession() !== null;
  }

  // ==================== Private Methods ====================

  /**
   * Increments session version in database
   */
  private static async incrementSessionVersion(userId: string): Promise<number> {
    try {
      // Get current version
      const { data: userData, error: fetchError } = await supabase
        .from('users')
        .select('session_version')
        .eq('id', userId)
        .single();

      if (fetchError) {
        console.error('[SESSION] Error fetching session version:', fetchError);
        return 1;
      }

      const currentVersion = userData?.session_version || 0;
      const newVersion = currentVersion + 1;

      // Update version in database
      const { error: updateError } = await supabase
        .from('users')
        .update({ session_version: newVersion })
        .eq('id', userId);

      if (updateError) {
        console.error('[SESSION] Error updating session version:', updateError);
        return currentVersion;
      }

      return newVersion;
    } catch (error) {
      console.error('[SESSION] Error incrementing session version:', error);
      return 1;
    }
  }

  /**
   * Gets current session version from database
   */
  private static async getCurrentSessionVersion(userId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('session_version')
        .eq('id', userId)
        .single();

      if (error || !data) {
        return 0;
      }

      return data.session_version || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Adds token to blacklist
   */
  private static async addToBlacklist(token: string, userId: string): Promise<void> {
    try {
      // Token hash for storage (don't store full token)
      const tokenHash = await this.hashToken(token);
      
      await supabase.from('session_blacklist').insert({
        token_hash: tokenHash,
        user_id: userId,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      });
    } catch (error) {
      console.error('[SESSION] Error adding token to blacklist:', error);
    }
  }

  /**
   * Checks if token is blacklisted
   */
  private static async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const tokenHash = await this.hashToken(token);
      
      const { data, error } = await supabase
        .from('session_blacklist')
        .select('id')
        .eq('token_hash', tokenHash)
        .gt('expires_at', new Date().toISOString())
        .single();

      return !error && !!data;
    } catch {
      return false;
    }
  }

  /**
   * Hashes token for storage (don't store full tokens)
   */
  private static async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Stores session in localStorage
   */
  private static storeSession(session: SessionData): void {
    try {
      localStorage.setItem(
        SESSION_CONFIG.STORAGE_KEY,
        JSON.stringify({
          ...session,
          expiresAt: session.expiresAt.toISOString(),
          lastActivityAt: session.lastActivityAt.toISOString(),
        })
      );
    } catch (error) {
      console.error('[SESSION] Error storing session:', error);
    }
  }

  /**
   * Gets session from localStorage
   */
  private static getStoredSession(): SessionData | null {
    try {
      const stored = localStorage.getItem(SESSION_CONFIG.STORAGE_KEY);
      if (!stored) return null;

      const parsed = JSON.parse(stored);
      return {
        ...parsed,
        expiresAt: new Date(parsed.expiresAt),
        lastActivityAt: new Date(parsed.lastActivityAt),
      };
    } catch {
      return null;
    }
  }

  /**
   * Clears session from localStorage
   */
  private static clearSession(): void {
    localStorage.removeItem(SESSION_CONFIG.STORAGE_KEY);
  }

  /**
   * Starts tracking user activity
   */
  private static startActivityTracking(): void {
    if (this.activityListenersAttached) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

    // Throttled activity update
    let lastUpdate = 0;
    const throttleMs = 60000; // Update at most once per minute

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastUpdate > throttleMs) {
        lastUpdate = now;
        this.updateActivity();
      }
    };

    events.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Check for session warning/expiry every minute
    setInterval(() => {
      if (this.shouldShowWarning() && this.warningCallback) {
        this.warningCallback();
      }

      const session = this.getStoredSession();
      if (session) {
        const inactiveTime = Date.now() - session.lastActivityAt.getTime();
        if (inactiveTime > SESSION_CONFIG.TIMEOUT_MS && this.expiredCallback) {
          this.expiredCallback();
        }
      }
    }, 60000);

    this.activityListenersAttached = true;
  }
}

export default SessionManager;
