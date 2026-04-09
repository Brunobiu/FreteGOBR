/**
 * Unit Tests for AuthService
 * Feature: fretego
 *
 * **Validates: Requirements 3.1, 3.2, 3.7, 1.5**
 *
 * Note: These tests use mocks since we don't have a test Supabase instance.
 * In a production environment, you would use a test database or Supabase local dev.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { register, login, logout, AuthError } from '../services/auth';
import type { RegisterData, LoginCredentials } from '../types';
import type {
  User as SupabaseUser,
  Session,
  AuthError as SupabaseAuthError,
} from '@supabase/supabase-js';

// Mock Supabase
vi.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
      getUser: vi.fn(),
      admin: {
        deleteUser: vi.fn(),
      },
    },
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnValue({ error: null }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })),
  },
}));

describe('Unit Tests - AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    const validMotoristaData: RegisterData = {
      phone: '11999999999',
      password: 'Senha123!',
      name: 'João Silva',
      userType: 'motorista',
    };

    const validEmbarcadorData: RegisterData = {
      phone: '11988888888',
      password: 'Senha123!',
      name: 'Maria Santos',
      userType: 'embarcador',
      companyName: 'Transportes ABC',
    };

    it('should reject password with less than 8 characters', async () => {
      const invalidData: RegisterData = {
        ...validMotoristaData,
        password: 'Ab1!xyz',
      };

      await expect(register(invalidData)).rejects.toThrow(AuthError);
      await expect(register(invalidData)).rejects.toThrow('Senha deve ter no mínimo 8 caracteres');
    });

    it('should reject embarcador registration without company name', async () => {
      const invalidData: RegisterData = {
        phone: '11988888888',
        password: 'Senha123!',
        name: 'Maria Santos',
        userType: 'embarcador',
        // Missing companyName
      };

      await expect(register(invalidData)).rejects.toThrow(AuthError);
      await expect(register(invalidData)).rejects.toThrow(
        'Nome da empresa é obrigatório para embarcadores'
      );
    });

    it('should accept valid motorista registration data', async () => {
      // This test validates the structure, actual Supabase calls are mocked
      const { supabase } = await import('../services/supabase');

      vi.mocked(supabase.auth.signUp).mockResolvedValue({
        data: {
          user: {
            id: 'test-user-id',
            email: '11999999999@fretego.local',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
          } as SupabaseUser,
          session: {
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
            token_type: 'bearer',
            user: {} as SupabaseUser,
          } as Session,
        },
        error: null,
      });

      // Mock successful database operations
      const mockFrom = vi.fn(() => ({
        insert: vi.fn().mockReturnValue({ error: null }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'test-user-id',
                phone: validMotoristaData.phone,
                user_type: 'motorista',
                name: validMotoristaData.name,
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      }));

      vi.mocked(supabase.from).mockImplementation(mockFrom as unknown as typeof supabase.from);

      const result = await register(validMotoristaData);

      expect(result).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.user.phone).toBe(validMotoristaData.phone);
      expect(result.user.name).toBe(validMotoristaData.name);
      expect(result.user.userType).toBe('motorista');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should accept valid embarcador registration data', async () => {
      const { supabase } = await import('../services/supabase');

      vi.mocked(supabase.auth.signUp).mockResolvedValue({
        data: {
          user: {
            id: 'test-embarcador-id',
            email: '11988888888@fretego.local',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
          } as SupabaseUser,
          session: {
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
            token_type: 'bearer',
            user: {} as SupabaseUser,
          } as Session,
        },
        error: null,
      });

      const mockFrom = vi.fn(() => ({
        insert: vi.fn().mockReturnValue({ error: null }),
      }));

      vi.mocked(supabase.from).mockImplementation(mockFrom as unknown as typeof supabase.from);

      const result = await register(validEmbarcadorData);

      expect(result).toBeDefined();
      expect(result.user.userType).toBe('embarcador');
    });
  });

  describe('login', () => {
    const validCredentials: LoginCredentials = {
      phone: '11999999999',
      password: 'senha123',
    };

    it('should reject invalid credentials', async () => {
      const { supabase } = await import('../services/supabase');

      vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
        data: { user: null, session: null },
        error: {
          message: 'Invalid credentials',
          name: 'AuthError',
          status: 400,
          code: 'invalid_credentials',
          __isAuthError: true,
        } as unknown as SupabaseAuthError,
      });

      await expect(login(validCredentials)).rejects.toThrow(AuthError);
      await expect(login(validCredentials)).rejects.toThrow('Credenciais inválidas');
    });

    it('should successfully login with valid credentials', async () => {
      const { supabase } = await import('../services/supabase');

      const mockUser: SupabaseUser = {
        id: 'test-user-id',
        email: '11999999999@fretego.local',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
      };

      const mockSession: Session = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
        user: mockUser,
      };

      vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
        data: {
          user: mockUser,
          session: mockSession,
        },
        error: null,
      });

      const mockFrom = vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'test-user-id',
                phone: validCredentials.phone,
                user_type: 'motorista',
                name: 'João Silva',
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }));

      vi.mocked(supabase.from).mockImplementation(mockFrom as unknown as typeof supabase.from);

      const result = await login(validCredentials);

      expect(result).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.user.phone).toBe(validCredentials.phone);
      expect(result.accessToken).toBe('test-access-token');
      expect(result.refreshToken).toBe('test-refresh-token');
    });

    it('should reject login for inactive user', async () => {
      const { supabase } = await import('../services/supabase');

      vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
        data: {
          user: {
            id: 'test-user-id',
            email: 'test@example.com',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
          } as SupabaseUser,
          session: {
            access_token: 'token',
            refresh_token: 'refresh',
            expires_in: 3600,
            token_type: 'bearer',
            user: {} as SupabaseUser,
          } as Session,
        },
        error: null,
      });

      const mockFrom = vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'test-user-id',
                phone: validCredentials.phone,
                user_type: 'motorista',
                name: 'João Silva',
                is_active: false, // Inactive user
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      }));

      vi.mocked(supabase.from).mockImplementation(mockFrom as unknown as typeof supabase.from);

      await expect(login(validCredentials)).rejects.toThrow(AuthError);
      await expect(login(validCredentials)).rejects.toThrow('Conta temporariamente bloqueada');
    });
  });

  describe('logout', () => {
    it('should successfully logout user', async () => {
      const { supabase } = await import('../services/supabase');

      vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });

      const mockFrom = vi.fn(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }));

      vi.mocked(supabase.from).mockImplementation(mockFrom as unknown as typeof supabase.from);

      await expect(logout('test-user-id')).resolves.not.toThrow();
    });

    it('should handle logout errors', async () => {
      const { supabase } = await import('../services/supabase');

      vi.mocked(supabase.auth.signOut).mockResolvedValue({
        error: {
          message: 'Logout failed',
          name: 'AuthError',
          status: 500,
          code: 'logout_failed',
          __isAuthError: true,
        } as unknown as SupabaseAuthError,
      });

      await expect(logout('test-user-id')).rejects.toThrow(AuthError);
    });
  });

  describe('AuthError', () => {
    it('should create AuthError with correct properties', () => {
      const error = new AuthError('Test error', 'TEST_CODE', 400);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AuthError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('AuthError');
    });

    it('should use default status code 400', () => {
      const error = new AuthError('Test error', 'TEST_CODE');

      expect(error.statusCode).toBe(400);
    });
  });
});
