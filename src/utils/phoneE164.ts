/**
 * phoneE164 — normalização de telefone brasileiro para o formato E.164 usado
 * pelo WhatsApp (ex.: `5511987654321`).
 *
 * É o ESPELHO em TypeScript da função SQL `normalize_phone_e164` (migration
 * 125). As duas implementações DEVEM permanecer em sincronia: o cliente
 * normaliza para exibir/enviar e o servidor (RPCs) normaliza para comparar e
 * armazenar. A propriedade de idempotência (CP2) garante que normalizar um
 * número já normalizado não o altera.
 *
 * Regras (BR):
 *   - Remove tudo que não é dígito.
 *   - `55` + 10|11 dígitos locais (total 12 ou 13) ⇒ já está em E.164.
 *   - 10 ou 11 dígitos (DDD + assinante) ⇒ prefixa `55`.
 *   - Qualquer outro tamanho ⇒ inválido (`null`).
 *
 * Observação sobre o DDD 55 (RS): um número local de 11 dígitos iniciado por
 * `55` (ex.: `55 9XXXX-XXXX`) tem comprimento 11 e cai na regra de "local",
 * sendo prefixado corretamente para `5555...`. Só tratamos como já-E.164 os
 * comprimentos 12/13 iniciados por `55`.
 */

/** Remove tudo que não é dígito. */
export function onlyDigits(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * Normaliza um telefone BR para E.164 (`55DDDNNNNNNNNN`). Retorna `null`
 * quando o número não está em um formato BR válido.
 */
export function toE164BR(raw: string): string | null {
  const v = onlyDigits(raw ?? '');
  if (v === '') return null;
  // Já internacional BR: 55 + (10|11) dígitos => total 12 ou 13.
  if (v.startsWith('55') && (v.length === 12 || v.length === 13)) {
    return v;
  }
  // Local BR (DDD + assinante): 10 ou 11 dígitos => prefixa 55.
  if (v.length === 10 || v.length === 11) {
    return `55${v}`;
  }
  return null;
}

/** `true` quando o valor é um telefone BR normalizável para E.164. */
export function isValidBRPhone(raw: string): boolean {
  return toE164BR(raw) !== null;
}
