/**
 * Helpers puros para formatação de telefone BR.
 *
 * Uso conjunto: `setState(sanitizePhone(value))` armazena dígitos
 * crus; `formatPhoneBR(state)` exibe na UI.
 *
 * Exemplos:
 *   sanitizePhone("(62) 9 8888-1234") -> "62988881234"
 *   formatPhoneBR("62988881234")      -> "(62) 9 8888-1234"
 *   formatPhoneBR("6233334444")       -> "(62) 3333-4444"
 */

export function sanitizePhone(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Formata um telefone BR no padrão `(DD) NNNN-NNNN` (10 dígitos)
 * ou `(DD) N NNNN-NNNN` (11 dígitos) conforme o usuário digita.
 * Valores parciais retornam o mesmo prefixo aplicado.
 */
export function formatPhoneBR(value: string): string {
  const d = sanitizePhone(value).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3, 7)}-${d.slice(7)}`;
}

/**
 * `true` se o telefone tem exatamente 10 (fixo) ou 11 (celular)
 * dígitos quando sanitizado.
 */
export function isValidPhoneBR(value: string): boolean {
  const d = sanitizePhone(value);
  return d.length === 10 || d.length === 11;
}
