/**
 * Validação de placa de veículo no padrão Mercosul brasileiro.
 *
 * Regex canônico: `^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$`
 *
 * Sete caracteres maiúsculos no formato:
 *   - posições 1-3: letras
 *   - posição 4:    dígito
 *   - posição 5:    letra OU dígito (transição Mercosul)
 *   - posições 6-7: dígitos
 *
 * Exemplos:
 *   - `ABC1D23` → válido (Mercosul moderno)
 *   - `ABC1234` → válido (formato antigo, ainda casa o regex)
 *   - `ABCD123` → inválido (4ª posição não é dígito)
 *   - `AB12D34` → inválido (apenas 2 letras iniciais)
 *   - `abc1d23` → válido após `formatPlate`
 */

export const PLATE_REGEX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

/**
 * Normaliza uma string de placa: maiúsculas, remove qualquer caractere
 * não-alfanumérico e limita a 7 caracteres.
 */
export function formatPlate(value: string): string {
  return (value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 7);
}

/**
 * Retorna `true` somente se a placa, após `formatPlate`, casa com o
 * `PLATE_REGEX`.
 */
export function isValidMercosulPlate(value: string): boolean {
  return PLATE_REGEX.test(formatPlate(value));
}
