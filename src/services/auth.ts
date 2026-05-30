/**
 * Authentication Service
 *
 * Handles user registration, login, logout, and token refresh
 * using Supabase Auth with custom password validation and hashing
 *
 * Security Features:
 * - Anti-enumeration: Same error message for invalid phone and invalid password
 * - Constant-time responses to prevent timing attacks
 */

import { supabase } from './supabase';
import { validatePassword } from '../utils/passwordValidation';
import { computeTrialEndsAt } from '../utils/trialStatus';
import type { RegisterData, LoginCredentials, AuthResponse, User } from '../types';

// Generic error message for anti-enumeration
const GENERIC_AUTH_ERROR = 'Credenciais inválidas';

// Minimum response time to prevent timing attacks (ms)
const MIN_RESPONSE_TIME = 500;

/**
 * Mensagem canônica de duplicidade no cadastro (anti-fraude).
 *
 * Ao contrário do login (que usa anti-enumeration genérico), o Requirement 8
 * (8.2–8.4) pede explicitamente uma mensagem específica de duplicidade no
 * cadastro. Mantemos exatamente o texto canônico solicitado.
 */
export const DUPLICATE_IDENTIFIER_MESSAGE = 'Este CPF/telefone/e-mail já está cadastrado.';

/**
 * Pré-check de disponibilidade de identificador (anti-fraude — UX).
 *
 * Espelha o padrão fail-open do `checkBlacklistGate`: chama a RPC
 * `is_identifier_available(p_type, p_value)` e, em caso de erro de rede/RPC,
 * NÃO bloqueia o cadastro (retorna `true` = disponível). O trigger
 * `users_antifraud_duplicate_block` (BEFORE INSERT em `users`) é a barreira
 * final/autoritativa de atomicidade.
 *
 * @returns `true` quando o identificador está disponível (ou em fail-open);
 *          `false` somente quando a RPC indica explicitamente indisponível.
 */
async function isIdentifierAvailable(
  pType: 'phone' | 'cpf' | 'email',
  pValue: string
): Promise<boolean> {
  try {
    const { data: available, error } = await supabase.rpc('is_identifier_available', {
      p_type: pType,
      p_value: pValue,
    });
    // Fail-open em falha de infraestrutura: o trigger é a autoridade.
    if (error) return true;
    return available !== false;
  } catch {
    // Fail-open em erro de rede.
    return true;
  }
}

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
    // Anti-fraude (UX/pré-check) — Requirements 8.1–8.4:
    // Antes de criar qualquer registro (e antes mesmo do signUp em Auth para não
    // gerar usuário órfão), verificamos a disponibilidade de cada identificador
    // informado via `is_identifier_available`. `phone` é sempre verificado;
    // `cpf`/`email` são verificados apenas quando presentes no payload (leitura
    // defensiva, pois o RegisterData atual não os expõe). NÃO verificamos o
    // e-mail sintético `{phone}@example.com`, que nunca é persistido em
    // `users.email`. Em falha de infra, `isIdentifierAvailable` é fail-open; o
    // trigger `users_antifraud_duplicate_block` é a autoridade final (Req 8.5).
    const optionalIdentifiers = data as Partial<{ cpf: string; email: string }>;
    const identifiersToCheck: Array<{ type: 'phone' | 'cpf' | 'email'; value: string }> = [
      { type: 'phone', value: data.phone },
    ];
    if (optionalIdentifiers.cpf && optionalIdentifiers.cpf.trim() !== '') {
      identifiersToCheck.push({ type: 'cpf', value: optionalIdentifiers.cpf });
    }
    if (optionalIdentifiers.email && optionalIdentifiers.email.trim() !== '') {
      identifiersToCheck.push({ type: 'email', value: optionalIdentifiers.email });
    }
    for (const identifier of identifiersToCheck) {
      const available = await isIdentifierAvailable(identifier.type, identifier.value);
      if (!available) {
        throw new AuthError(DUPLICATE_IDENTIFIER_MESSAGE, 'DUPLICATE_IDENTIFIER', 409);
      }
    }

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

    // Helper de rollback compensatório para falhas após o signUp em Auth.
    // Como o Supabase JS não expõe transações multi-tabela, executamos a
    // operação inversa (delete em users) e signOut para evitar um usuário
    // órfão capaz de logar. Parametrizável para também mapear o erro do
    // trigger anti-fraude (duplicidade) à mensagem canônica (Req 8.5).
    const compensateUserRollback = async (
      cause: string,
      code: string = 'DATABASE_ERROR',
      statusCode: number = 500
    ): Promise<never> => {
      try {
        await supabase.from('users').delete().eq('id', authData.user!.id);
      } catch {
        // best effort
      }
      try {
        await supabase.auth.signOut();
      } catch {
        // best effort
      }
      throw new AuthError(cause, code, statusCode);
    };

    // Create user record in users table
    // Importante: NÃO salvamos o email sintético `{phone}@example.com` em
    // `users.email`. Esse email é usado só pelo Supabase Auth para login;
    // o email "real" do embarcador fica vazio até ser verificado via
    // fluxo de OTP no perfil.
    const { error: dbError } = await supabase.from('users').insert({
      id: authData.user.id,
      phone: data.phone,
      user_type: data.userType,
      name: data.name,
    });

    if (dbError) {
      console.error('Database error:', dbError);
      // Anti-fraude (autoridade) — Requirements 8.2–8.5: o trigger
      // `users_antifraud_duplicate_block` aborta o INSERT com
      // `duplicate_identifier:<campo>`. Mapeamos qualquer variante para a
      // mensagem canônica e executamos o rollback compensatório (delete em
      // users + signOut) para não deixar usuário órfão em auth.users.
      if (dbError.message.includes('duplicate_identifier')) {
        await compensateUserRollback(DUPLICATE_IDENTIFIER_MESSAGE, 'DUPLICATE_IDENTIFIER', 409);
      }
      // Rollback do usuário em Auth: não temos privilégio para deletar
      // de auth.users via client, mas garantimos signOut para limpar token.
      try {
        await supabase.auth.signOut();
      } catch {
        // ignorar
      }
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
        await compensateUserRollback('Erro ao criar perfil de motorista');
      }
    } else if (data.userType === 'embarcador') {
      const { error: embarcadorError } = await supabase.from('embarcadores').insert({
        id: authData.user.id,
        company_name: data.companyName!,
        whatsapp: data.phone,
      });

      if (embarcadorError) {
        await compensateUserRollback('Erro ao criar perfil de embarcador');
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
      // Espelha os defaults aplicados pelo trigger `users_set_trial_defaults`
      // (Migration 044): motorista recebe trial de 30 dias a partir de
      // created_at; demais tipos não têm trial. Status inicial `trial`,
      // não-assinante.
      trialEndsAt:
        data.userType === 'motorista'
          ? computeTrialEndsAt(new Date(authData.user.created_at))
          : null,
      subscriptionStatus: 'trial',
      isSubscribed: false,
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
 * Security: Uses anti-enumeration pattern - returns same error message
 * for both "user not found" and "wrong password" to prevent user enumeration
 *
 * @param credentials - Login credentials (phone and password)
 * @returns Promise resolving to AuthResponse with user data and tokens
 * @throws AuthError if credentials are invalid
 */
export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  const startTime = Date.now();

  try {
    // Login with Supabase Auth using phone as email format
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: `${credentials.phone}@example.com`,
      password: credentials.password,
    });

    // Anti-enumeration: Use same error message for all auth failures
    if (authError || !authData.user || !authData.session) {
      // Ensure minimum response time to prevent timing attacks
      await ensureMinResponseTime(startTime);
      throw new AuthError(GENERIC_AUTH_ERROR, 'INVALID_CREDENTIALS', 401);
    }

    // Fetch user data from database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (userError || !userData) {
      // Anti-enumeration: Same error message
      await ensureMinResponseTime(startTime);
      throw new AuthError(GENERIC_AUTH_ERROR, 'INVALID_CREDENTIALS', 401);
    }

    // Check if user is active
    if (!userData.is_active) {
      throw new AuthError(
        'Conta temporariamente bloqueada. Entre em contato com o suporte.',
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
      trialEndsAt: userData.trial_ends_at ? new Date(userData.trial_ends_at) : null,
      subscriptionStatus: userData.subscription_status ?? undefined,
      isSubscribed: userData.is_subscribed ?? undefined,
    };

    return {
      user,
      accessToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in || 3600,
    };
  } catch (error) {
    // Ensure minimum response time for all error cases
    await ensureMinResponseTime(startTime);

    if (error instanceof AuthError) {
      throw error;
    }
    // Anti-enumeration: Generic error for unknown errors too
    throw new AuthError(GENERIC_AUTH_ERROR, 'INVALID_CREDENTIALS', 401);
  }
}

/**
 * Ensures minimum response time to prevent timing attacks
 */
async function ensureMinResponseTime(startTime: number): Promise<void> {
  const elapsed = Date.now() - startTime;
  if (elapsed < MIN_RESPONSE_TIME) {
    await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed));
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
      trialEndsAt: userData.trial_ends_at ? new Date(userData.trial_ends_at) : null,
      subscriptionStatus: userData.subscription_status ?? undefined,
      isSubscribed: userData.is_subscribed ?? undefined,
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
      trialEndsAt: userData.trial_ends_at ? new Date(userData.trial_ends_at) : null,
      subscriptionStatus: userData.subscription_status ?? undefined,
      isSubscribed: userData.is_subscribed ?? undefined,
    };
  } catch (error) {
    return null;
  }
}
