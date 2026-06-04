/**
 * Helpers de formatação e sanitização de CPF.
 *
 * Padrão visual: `000.000.000-00` (11 dígitos + 3 separadores).
 *
 * `sanitizeCpf` remove tudo que não for dígito.
 * `formatCpf` aplica a máscara incrementalmente conforme o usuário digita,
 * sempre truncando em 11 dígitos.
 */

export function sanitizeCpf(value: string): string {
  return (value ?? '').replace(/\D/g, '').slice(0, 11);
}

export function formatCpf(value: string): string {
  const digits = sanitizeCpf(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

/**
 * Verifica se a string contém exatamente 11 dígitos (sem validar dígito
 * verificador). Para validação completa, ver `isValidCpf` em
 * `services/admin/users.ts`.
 */
export function isCpfDigitsLengthValid(value: string): boolean {
  return sanitizeCpf(value).length === 11;
}
