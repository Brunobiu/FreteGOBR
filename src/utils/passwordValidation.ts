/**
 * Password Validation Utility
 *
 * Validates passwords according to FreteGO requirements:
 * - Minimum 6 characters
 * - At least 1 letter
 * - At least 1 number
 */

export interface PasswordValidation {
  isValid: boolean;
  errors: string[];
  hasMinLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
}

/**
 * Validates a password against FreteGO requirements
 *
 * @param password - The password string to validate
 * @returns PasswordValidation object with validation results
 */
export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];

  // Check minimum length (6 characters)
  const hasMinLength = password.length >= 6;
  if (!hasMinLength) {
    errors.push('Senha deve ter no mínimo 6 caracteres');
  }

  // Letra e número não são mais obrigatórios
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  const isValid = hasMinLength;

  return {
    isValid,
    errors,
    hasMinLength,
    hasLetter,
    hasNumber,
  };
}
