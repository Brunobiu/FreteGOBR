/**
 * Authentication Service
 *
 * Handles user registration, login, logout, and token refresh
 * using Supabase Auth with custom password validation and hashing
 */

import { supabase } from './supabase';
import { validatePassword } from '../utils/passwordValidation';
import type { RegisterData, LoginCredentials, AuthResponse, User } from '../types';

/**
 * Custom error class for authentication errors
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Registers a new user (Motorista or Embarcador)
 *
 * @param data - Registration data including phone, password, name, and user type
 * @returns Promise resolving to AuthResponse with user data and tokens
 * @throws AuthError if validation fails or registration fails
 */
export async function register(data: RegisterData): Promise<AuthResponse> {
  // Validate password
  const passwordValidation = validatePassword(data.password);
  if (!passwordValidation.isValid) {
    throw new AuthError(passwordValidation.errors.join(', '), 'INVALID_PASSWORD', 400);
  }

  // Validate embarcador has company name
  if (data.userType === 'embarcador' && !data.companyName) {
    throw new AuthError(
      'Nome da empresa é obrigatório para embarcadores',
      'MISSING_COMPANY_NAME',
      400
    );
  }

  try {
    // Register with Supabase Auth using phone as email format
    // Note: Supabase requires email format, so we use phone@example.com
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: `${data.phone}@example.com`,
      password: data.password,
      options: {
        data: {
          phone: data.phone,
          name: data.name,
          user_type: data.userType,
          company_name: data.companyName,
        },
      },
    });

    if (authError) {
      // Check for duplicate phone/email
      if (authError.message.includes('already registered')) {
        throw new AuthError('Este telefone já está cadastrado', 'DUPLICATE_PHONE', 409);
      }
      throw new AuthError(authError.message, 'REGISTRATION_FAILED', 400);
    }

    if (!authData.user || !authData.session) {
      throw new AuthError('Falha ao criar conta. Tente novamente.', 'REGISTRATION_FAILED', 500);
    }

    // Create user record in users table
    const { error: dbError } = await supabase.from('users').insert({
      id: authData.user.id,
      phone: data.phone,
      user_type: data.userType,
      name: data.name,
      email: authData.user.email,
    });

    if (dbError) {
      console.error('Database error:', dbError);
      throw new AuthError(
        'Erro ao criar perfil de usuário: ' + dbError.message,
        'DATABASE_ERROR',
        500
      );
    }

    // Create type-specific record (motorista or embarcador)
    if (data.userType === 'motorista') {
      const { error: motoristaError } = await supabase.from('motoristas').insert({
        id: authData.user.id,
      });

      if (motoristaError) {
        throw new AuthError('Erro ao criar perfil de motorista', 'DATABASE_ERROR', 500);
      }
    } else if (data.userType === 'embarcador') {
      const { error: embarcadorError } = await supabase.from('embarcadores').insert({
        id: authData.user.id,
        company_name: data.companyName!,
        whatsapp: data.phone,
      });

      if (embarcadorError) {
        throw new AuthError('Erro ao criar perfil de embarcador', 'DATABASE_ERROR', 500);
      }
    }

    // Map to User type
    const user: User = {
      id: authData.user.id,
      phone: data.phone,
      userType: data.userType,
      name: data.name,
      email: authData.user.email,
      isActive: true,
      createdAt: new Date(authData.user.created_at),
      updatedAt: new Date(authData.user.updated_at || authData.user.created_at),
    };

    return {
      user,
      accessToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in || 3600,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Erro ao registrar usuário. Tente novamente.', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Logs in a user with phone and password
 *
 * @param credentials - Login credentials (phone and password)
 * @returns Promise resolving to AuthResponse with user data and tokens
 * @throws AuthError if credentials are invalid
 */
export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  try {
    // Login with Supabase Auth using phone as email format
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: `${credentials.phone}@example.com`,
      password: credentials.password,
    });

    if (authError || !authData.user || !authData.session) {
      throw new AuthError('Telefone ou senha incorretos', 'INVALID_CREDENTIALS', 401);
    }

    // Fetch user data from database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (userError || !userData) {
      throw new AuthError('Erro ao buscar dados do usuário', 'USER_NOT_FOUND', 404);
    }

    // Check if user is active
    if (!userData.is_active) {
      throw new AuthError(
        'Conta desativada. Entre em contato com o suporte.',
        'ACCOUNT_DISABLED',
        403
      );
    }

    // Update last activity
    await supabase
      .from('users')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', authData.user.id);

    // Map to User type
    const user: User = {
      id: userData.id,
      phone: userData.phone,
      userType: userData.user_type,
      name: userData.name,
      email: userData.email,
      cpf: userData.cpf,
      profilePhotoUrl: userData.profile_photo_url,
      isActive: userData.is_active,
      lastActivityAt: userData.last_activity_at ? new Date(userData.last_activity_at) : undefined,
      createdAt: new Date(userData.created_at),
      updatedAt: new Date(userData.updated_at),
    };

    return {
      user,
      accessToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in || 3600,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Erro ao fazer login. Tente novamente.', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Logs out a user
 *
 * @param userId - The ID of the user to logout
 * @returns Promise that resolves when logout is complete
 */
export async function logout(userId: string): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new AuthError('Erro ao fazer logout', 'LOGOUT_FAILED', 500);
    }

    // Update last activity
    await supabase
      .from('users')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', userId);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Erro ao fazer logout', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Refreshes the access token using a refresh token
 *
 * @param refreshToken - The refresh token
 * @returns Promise resolving to AuthResponse with new tokens
 * @throws AuthError if refresh fails
 */
export async function refreshToken(refreshToken: string): Promise<AuthResponse> {
  try {
    const { data: authData, error: authError } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (authError || !authData.session || !authData.user) {
      throw new AuthError(
        'Sessão expirada. Por favor, faça login novamente.',
        'TOKEN_EXPIRED',
        401
      );
    }

    // Fetch user data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (userError || !userData) {
      throw new AuthError('Erro ao buscar dados do usuário', 'USER_NOT_FOUND', 404);
    }

    const user: User = {
      id: userData.id,
      phone: userData.phone,
      userType: userData.user_type,
      name: userData.name,
      email: userData.email,
      cpf: userData.cpf,
      profilePhotoUrl: userData.profile_photo_url,
      isActive: userData.is_active,
      lastActivityAt: userData.last_activity_at ? new Date(userData.last_activity_at) : undefined,
      createdAt: new Date(userData.created_at),
      updatedAt: new Date(userData.updated_at),
    };

    return {
      user,
      accessToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in || 3600,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Erro ao renovar sessão. Faça login novamente.', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Gets the current authenticated user
 *
 * @returns Promise resolving to User or null if not authenticated
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return null;
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (userError || !userData) {
      return null;
    }

    return {
      id: userData.id,
      phone: userData.phone,
      userType: userData.user_type,
      name: userData.name,
      email: userData.email,
      cpf: userData.cpf,
      profilePhotoUrl: userData.profile_photo_url,
      isActive: userData.is_active,
      lastActivityAt: userData.last_activity_at ? new Date(userData.last_activity_at) : undefined,
      createdAt: new Date(userData.created_at),
      updatedAt: new Date(userData.updated_at),
    };
  } catch (error) {
    return null;
  }
}
