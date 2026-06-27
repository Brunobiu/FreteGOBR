// Core types for FreteGO application
// These will be expanded as we implement features

// Reusa o tipo do núcleo puro de trial como fonte única de verdade.
// `trialStatus.ts` não importa deste módulo, então não há ciclo de imports.
import type { SubscriptionStatus } from '../utils/trialStatus';

export type UserType = 'motorista' | 'embarcador' | 'admin';

export interface User {
  id: string;
  phone: string;
  userType: UserType;
  name: string;
  email?: string;
  cpf?: string;
  profilePhotoUrl?: string;
  isActive: boolean;
  lastActivityAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  // Campos de trial (opcionais para retrocompatibilidade com caches antigos
  // de `fretego_user` que não os possuem). Mapeados de `trial_ends_at`,
  // `subscription_status` e `is_subscribed` da tabela `users`.
  trialEndsAt?: Date | null;
  subscriptionStatus?: SubscriptionStatus;
  isSubscribed?: boolean;
}

export interface GeographicPoint {
  latitude: number;
  longitude: number;
}

/**
 * Authentication Types
 */
export interface RegisterData {
  phone: string;
  password: string;
  name: string;
  userType: 'motorista' | 'embarcador';
  companyName?: string; // Embarcador preenche depois no perfil (não no cadastro)
  // Versão dos documentos legais aceita no cadastro (currentLegalVersion()).
  // Obrigatória: o servidor revalida e grava terms_version + terms_accepted_at.
  acceptedVersion: string;
  // E-mail do usuário (cadastro multi-step). É a identidade no Auth e a base de
  // recuperação de senha; pode não ser verificado quando o canal foi o WhatsApp.
  email: string;
  // Token emitido por confirm_signup_otp; o servidor o consome (migration 125)
  // para garantir que o contato (telefone) foi verificado neste fluxo.
  phoneVerificationToken: string;
  // Canal confirmado: 'whatsapp' ⇒ telefone verificado; 'email' ⇒ e-mail verificado.
  verifiedChannel?: 'whatsapp' | 'email';
  // Legado (migration 066, verificação por e-mail). Mantido opcional p/ compat.
  emailVerificationToken?: string;
}

export interface LoginCredentials {
  phone: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Password Validation Types
 */
export interface PasswordValidation {
  isValid: boolean;
  errors: string[];
  hasMinLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
}

// More types will be added in subsequent tasks

/**
 * Document Types
 */
export type DocumentType =
  | 'cpf'
  | 'cnh'
  | 'antt'
  | 'vehicle_registration'
  | 'vehicle_insurance'
  | 'profile_photo';

export interface Document {
  id: string;
  userId: string;
  documentType: DocumentType;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
}

export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
}
