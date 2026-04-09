/**
 * Password Validation Utility
 *
 * Validates passwords according to enhanced FreteGO security requirements:
 * - Minimum 8 characters (increased from 6)
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * - At least 1 special character
 * - Not in common passwords list
 */

export interface PasswordValidation {
  isValid: boolean;
  errors: string[];
  requirements: {
    hasMinLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecialChar: boolean;
    notCommonPassword: boolean;
  };
  strength: 'weak' | 'medium' | 'strong';
}

// Common passwords to reject (top 100 most common)
const COMMON_PASSWORDS = [
  '123456', '123456789', 'qwerty', 'password', '12345678',
  '111111', '123123', '1234567890', '1234567', 'qwerty123',
  '000000', '1q2w3e', 'aa12345678', 'abc123', 'password1',
  '1234', 'qwertyuiop', '654321', '555555', 'lovely',
  '7777777', 'welcome', '888888', 'princess', 'dragon',
  'password123', '123qwe', 'senha', 'senha123', 'admin',
  'admin123', 'root', 'toor', 'pass', 'test', 'guest',
  'master', 'changeme', 'letmein', 'login', 'hello',
  'charlie', 'donald', 'iloveyou', 'sunshine', 'monkey',
  'shadow', 'ashley', 'football', 'jesus', 'michael',
  'ninja', 'mustang', 'password!', 'fretego', 'frete123',
];

// Minimum password length
const MIN_PASSWORD_LENGTH = 8;

// Special characters allowed
const SPECIAL_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

/**
 * Validates a password against enhanced FreteGO security requirements
 *
 * @param password - The password string to validate
 * @returns PasswordValidation object with detailed validation results
 */
export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];

  // Check minimum length (8 characters)
  const hasMinLength = password.length >= MIN_PASSWORD_LENGTH;
  if (!hasMinLength) {
    errors.push(`Senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres`);
  }

  // Check for uppercase letter
  const hasUppercase = /[A-Z]/.test(password);
  if (!hasUppercase) {
    errors.push('Senha deve conter pelo menos uma letra maiúscula');
  }

  // Check for lowercase letter
  const hasLowercase = /[a-z]/.test(password);
  if (!hasLowercase) {
    errors.push('Senha deve conter pelo menos uma letra minúscula');
  }

  // Check for number
  const hasNumber = /[0-9]/.test(password);
  if (!hasNumber) {
    errors.push('Senha deve conter pelo menos um número');
  }

  // Check for special character
  const specialCharRegex = new RegExp(`[${SPECIAL_CHARS.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`);
  const hasSpecialChar = specialCharRegex.test(password);
  if (!hasSpecialChar) {
    errors.push('Senha deve conter pelo menos um caractere especial (!@#$%^&*...)');
  }

  // Check against common passwords
  const notCommonPassword = !COMMON_PASSWORDS.includes(password.toLowerCase());
  if (!notCommonPassword) {
    errors.push('Esta senha é muito comum. Escolha uma senha mais segura');
  }

  // Calculate password strength
  const strength = calculateStrength({
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecialChar,
    notCommonPassword,
    length: password.length,
  });

  const isValid = hasMinLength && hasUppercase && hasLowercase && 
                  hasNumber && hasSpecialChar && notCommonPassword;

  return {
    isValid,
    errors,
    requirements: {
      hasMinLength,
      hasUppercase,
      hasLowercase,
      hasNumber,
      hasSpecialChar,
      notCommonPassword,
    },
    strength,
  };
}

/**
 * Calculates password strength based on requirements met
 */
function calculateStrength(params: {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
  notCommonPassword: boolean;
  length: number;
}): 'weak' | 'medium' | 'strong' {
  let score = 0;

  if (params.hasMinLength) score++;
  if (params.hasUppercase) score++;
  if (params.hasLowercase) score++;
  if (params.hasNumber) score++;
  if (params.hasSpecialChar) score++;
  if (params.notCommonPassword) score++;
  if (params.length >= 12) score++; // Bonus for longer passwords
  if (params.length >= 16) score++; // Extra bonus for very long passwords

  if (score <= 3) return 'weak';
  if (score <= 5) return 'medium';
  return 'strong';
}

/**
 * Gets a user-friendly description of password requirements
 */
export function getPasswordRequirements(): string[] {
  return [
    `Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`,
    'Pelo menos uma letra maiúscula (A-Z)',
    'Pelo menos uma letra minúscula (a-z)',
    'Pelo menos um número (0-9)',
    'Pelo menos um caractere especial (!@#$%^&*...)',
  ];
}

/**
 * Legacy function for backward compatibility
 * Maps new validation to old interface
 */
export function validatePasswordLegacy(password: string): {
  isValid: boolean;
  errors: string[];
  hasMinLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
} {
  const validation = validatePassword(password);
  return {
    isValid: validation.isValid,
    errors: validation.errors,
    hasMinLength: validation.requirements.hasMinLength,
    hasLetter: validation.requirements.hasUppercase || validation.requirements.hasLowercase,
    hasNumber: validation.requirements.hasNumber,
  };
}
