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
 * Mensagem canônica de identificador bloqueado por exclusão prévia (Feature 4).
 *
 * Quando um CPF/telefone consta na `account_deletion_blocklist` (conta excluída
 * anteriormente), o cadastro é bloqueado e o usuário é orientado a falar com o
 * suporte. A UI usa o código `ACCOUNT_BLOCKED` para exibir o botão de contato.
 */
export const ACCOUNT_BLOCKED_MESSAGE =
  'Não foi possível criar a conta. Entre em contato com o suporte.';

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
 * Pré-check de identificador bloqueado por exclusão prévia (Feature 4).
 *
 * Espelha o padrão fail-open: em erro de rede/RPC NÃO bloqueia o cadastro
 * (retorna `false` = não bloqueado); o trigger `users_block_deleted_reuse`
 * (BEFORE INSERT) é a barreira atômica/autoritativa. Só `phone`/`cpf` têm
 * blocklist.
 *
 * @returns `true` somente quando a RPC indica explicitamente que está bloqueado.
 */
async function isIdentifierBlocked(pType: 'phone' | 'cpf', pValue: string): Promise<boolean> {
  try {
    const { data: blocked, error } = await supabase.rpc('is_identifier_blocked', {
      p_type: pType,
      p_value: pValue,
    });
    if (error) return false;
    return blocked === true;
  } catch {
    return false;
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

  // Embarcador não informa mais o nome da empresa no cadastro — ele preenche
  // depois no perfil (gate de "cadastro completo para postar frete", migr. 125).

  // Revalidação servidor do aceite dos Termos (Feature 2 — Req 2.2).
  // O cliente já bloqueia o submit sem aceite; aqui garantimos a invariante
  // "nenhuma conta nova sem registro de aceite" mesmo se a chamada vier por
  // outro caminho. O timestamp é definido pelo servidor (trigger 064).
  if (!data.acceptedVersion || data.acceptedVersion.trim() === '') {
    throw new AuthError(
      'É necessário aceitar os Termos de Uso e a Política de Privacidade.',
      'TERMS_NOT_ACCEPTED',
      400
    );
  }

  // E-mail é coletado no cadastro multi-step: é a IDENTIDADE no Auth e a base de
  // recuperação de senha. A verificação agora é do CONTATO (telefone via WhatsApp,
  // com fallback de e-mail) — fluxo da migration 125. Validamos formato e o token.
  const normalizedEmail = (data.email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new AuthError('Informe um e-mail válido.', 'INVALID_EMAIL', 400);
  }
  if (!data.phoneVerificationToken || data.phoneVerificationToken.trim() === '') {
    throw new AuthError('Contato não verificado.', 'CONTACT_NOT_VERIFIED', 400);
  }

  // Consome o token de verificação no servidor: garante que o contato foi
  // verificado neste fluxo e que o token é válido/único (uso único, anti-fraude).
  // Retorna o canal verificado ('whatsapp' ⇒ telefone; 'email' ⇒ fallback).
  let verifiedChannel: 'whatsapp' | 'email' = 'whatsapp';
  {
    const { data: consumeResult, error: tokenError } = await supabase.rpc(
      'consume_signup_otp_token',
      { p_phone: data.phone, p_token: data.phoneVerificationToken }
    );
    const consumed = (consumeResult as { ok?: boolean; channel?: string } | null) ?? null;
    if (tokenError || consumed?.ok !== true) {
      throw new AuthError(
        'Verificação expirada. Refaça a verificação.',
        'CONTACT_NOT_VERIFIED',
        400
      );
    }
    verifiedChannel = consumed.channel === 'email' ? 'email' : 'whatsapp';
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
      { type: 'email', value: normalizedEmail },
    ];
    if (optionalIdentifiers.cpf && optionalIdentifiers.cpf.trim() !== '') {
      identifiersToCheck.push({ type: 'cpf', value: optionalIdentifiers.cpf });
    }
    for (const identifier of identifiersToCheck) {
      const available = await isIdentifierAvailable(identifier.type, identifier.value);
      if (!available) {
        throw new AuthError(DUPLICATE_IDENTIFIER_MESSAGE, 'DUPLICATE_IDENTIFIER', 409);
      }
      // Anti-reuso (Feature 4): phone/cpf que constam na blocklist de contas
      // excluídas são bloqueados — usuário é orientado a falar com o suporte.
      if (identifier.type === 'phone' || identifier.type === 'cpf') {
        const blocked = await isIdentifierBlocked(identifier.type, identifier.value);
        if (blocked) {
          throw new AuthError(ACCOUNT_BLOCKED_MESSAGE, 'ACCOUNT_BLOCKED', 403);
        }
      }
    }

    // Register with Supabase Auth using the user's REAL email as identity.
    // Isso habilita login por e-mail e o reset de senha nativo do Supabase.
    // O CONTATO foi verificado no fluxo pré-cadastro (migration 125 — WhatsApp
    // ou e-mail no fallback); a confirmação de e-mail nativa do Supabase deve
    // ficar DESLIGADA no painel (Auth settings).
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: normalizedEmail,
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
        throw new AuthError(DUPLICATE_IDENTIFIER_MESSAGE, 'DUPLICATE_IDENTIFIER', 409);
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
    // O e-mail real é salvo (identidade no Auth). A flag de contato verificado
    // reflete o canal: WhatsApp ⇒ phone_verified; e-mail (fallback) ⇒ email_verified.
    const { error: dbError } = await supabase.from('users').insert({
      id: authData.user.id,
      phone: data.phone,
      user_type: data.userType,
      name: data.name,
      email: normalizedEmail,
      email_verified: verifiedChannel === 'email',
      phone_verified: verifiedChannel === 'whatsapp',
      // Registro de aceite (Feature 2). O trigger 064 carimba
      // terms_accepted_at = now() no servidor quando terms_version vem preenchida.
      terms_version: data.acceptedVersion,
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
      // Anti-reuso (Feature 4): o trigger `users_block_deleted_reuse` aborta o
      // INSERT com `account_blocked:<campo>`. Mapeia para a mensagem canônica
      // (orienta contato com suporte) e faz rollback compensatório.
      if (dbError.message.includes('account_blocked')) {
        await compensateUserRollback(ACCOUNT_BLOCKED_MESSAGE, 'ACCOUNT_BLOCKED', 403);
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
      // company_name é opcional no cadastro (migration 125): o embarcador
      // preenche depois no perfil. whatsapp permanece obrigatório (= telefone).
      const { error: embarcadorError } = await supabase.from('embarcadores').insert({
        id: authData.user.id,
        company_name: data.companyName?.trim() || null,
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
    // O identificador pode ser e-mail OU telefone (login flexível).
    const identifier = (credentials.phone ?? '').trim();
    const isEmail = identifier.includes('@');

    let loginEmail: string | null = null;

    if (isEmail) {
      loginEmail = identifier.toLowerCase();
    } else {
      // Telefone: resolve o e-mail de login via RPC (cobre contas novas, cuja
      // identidade no Auth é o e-mail real). Fallback para o e-mail sintético
      // legado `{phone}@example.com` das contas antigas.
      const cleanPhone = identifier.replace(/\D/g, '');
      try {
        const { data: resolvedEmail } = await supabase.rpc('resolve_login_email', {
          p_phone: cleanPhone,
        });
        if (typeof resolvedEmail === 'string' && resolvedEmail.length > 0) {
          loginEmail = resolvedEmail;
        }
      } catch {
        // fail-open: cai no fallback legado abaixo.
      }
      if (!loginEmail) {
        loginEmail = `${cleanPhone}@example.com`;
      }
    }

    // Login with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
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
 * Solicita o e-mail de redefinição de senha (reset nativo do Supabase).
 *
 * Envia um link de redefinição para o e-mail informado. Por anti-enumeração,
 * a função NÃO revela se o e-mail existe — o chamador deve sempre exibir a
 * mesma mensagem de sucesso ("se houver conta, enviaremos o link").
 *
 * O link redireciona para `${origin}/redefinir-senha`, onde o usuário define a
 * nova senha (a sessão de recuperação é estabelecida pelo Supabase via hash da
 * URL).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    throw new AuthError('Informe um e-mail válido.', 'INVALID_EMAIL', 400);
  }
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/redefinir-senha` : undefined;
  // Best-effort / anti-enumeração: não propagamos erro de "não existe".
  await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo });
}

/**
 * Define a nova senha do usuário na sessão de recuperação corrente (após clicar
 * no link do e-mail). Requer que o Supabase já tenha estabelecido a sessão de
 * recovery a partir do hash da URL.
 */
export async function updatePasswordInRecovery(newPassword: string): Promise<void> {
  const validation = validatePassword(newPassword);
  if (!validation.isValid) {
    throw new AuthError(validation.errors.join(', '), 'INVALID_PASSWORD', 400);
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    throw new AuthError(
      'Não foi possível redefinir a senha. Tente novamente.',
      'RESET_FAILED',
      400
    );
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
