// Core types for FreteGO application
// These will be expanded as we implement features

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
  companyName?: string; // Required for embarcador
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
