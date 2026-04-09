/**
 * CSRFTokenManager - Gerenciamento de tokens CSRF
 * Protege contra ataques Cross-Site Request Forgery
 */

class CSRFTokenManager {
  private static TOKEN_KEY = 'csrf_token';
  private static TOKEN_HEADER = 'X-CSRF-Token';
  private static TOKEN_LENGTH = 32; // 32 bytes = 64 hex chars

  /**
   * Generates a new CSRF token using cryptographically secure random values
   */
  static generateToken(): string {
    const array = new Uint8Array(this.TOKEN_LENGTH);
    crypto.getRandomValues(array);
    const token = Array.from(array, byte =>
      byte.toString(16).padStart(2, '0')
    ).join('');

    // Store in sessionStorage (cleared when browser closes)
    sessionStorage.setItem(this.TOKEN_KEY, token);

    return token;
  }

  /**
   * Gets current CSRF token, generating one if it doesn't exist
   */
  static getToken(): string {
    let token = sessionStorage.getItem(this.TOKEN_KEY);

    if (!token) {
      token = this.generateToken();
    }

    return token;
  }

  /**
   * Validates a CSRF token against the stored token
   */
  static validateToken(token: string): boolean {
    if (!token) return false;

    const storedToken = sessionStorage.getItem(this.TOKEN_KEY);
    if (!storedToken) return false;

    // Use constant-time comparison to prevent timing attacks
    return this.constantTimeCompare(token, storedToken);
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private static constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Adds CSRF token to request headers
   */
  static addTokenToHeaders(headers: Headers): Headers {
    const token = this.getToken();
    headers.set(this.TOKEN_HEADER, token);
    return headers;
  }

  /**
   * Creates headers object with CSRF token
   */
  static createHeadersWithToken(additionalHeaders?: Record<string, string>): Headers {
    const headers = new Headers(additionalHeaders);
    return this.addTokenToHeaders(headers);
  }

  /**
   * Adds CSRF token to form data
   */
  static addTokenToFormData(formData: FormData): FormData {
    const token = this.getToken();
    formData.append('csrf_token', token);
    return formData;
  }

  /**
   * Gets the header name used for CSRF token
   */
  static getHeaderName(): string {
    return this.TOKEN_HEADER;
  }

  /**
   * Clears CSRF token (should be called on logout)
   */
  static clearToken(): void {
    sessionStorage.removeItem(this.TOKEN_KEY);
  }

  /**
   * Rotates CSRF token (should be called after sensitive operations)
   */
  static rotateToken(): string {
    this.clearToken();
    return this.generateToken();
  }

  /**
   * Checks if a token exists
   */
  static hasToken(): boolean {
    return sessionStorage.getItem(this.TOKEN_KEY) !== null;
  }

  /**
   * Creates a fetch wrapper that automatically includes CSRF token
   */
  static async secureFetch(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    this.addTokenToHeaders(headers);

    return fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin', // Include cookies for same-origin requests
    });
  }

  /**
   * Validates CSRF token from request (for server-side validation simulation)
   * In a real app, this would be done on the server
   */
  static validateRequest(request: Request): boolean {
    const headerToken = request.headers.get(this.TOKEN_HEADER);
    
    if (!headerToken) {
      console.warn('[CSRF] Missing CSRF token in request');
      return false;
    }

    const isValid = this.validateToken(headerToken);
    
    if (!isValid) {
      console.warn('[CSRF] Invalid CSRF token');
    }

    return isValid;
  }

  /**
   * Creates a hidden input element with CSRF token for forms
   */
  static createHiddenInput(): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'csrf_token';
    input.value = this.getToken();
    return input;
  }

  /**
   * Gets token as an object for JSON requests
   */
  static getTokenObject(): { csrf_token: string } {
    return { csrf_token: this.getToken() };
  }
}

export default CSRFTokenManager;
