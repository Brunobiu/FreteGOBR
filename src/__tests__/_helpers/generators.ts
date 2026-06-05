/**
 * Geradores fast-check compartilhados — spec `testes` (Tarefa 1).
 *
 * Centraliza geradores reusáveis respeitando as convenções do projeto
 * (project-conventions.md):
 *   - `fc.stringOf` NÃO existe — usar `fc.string({...}).filter(...)`.
 *   - PII (phone/CPF/CNPJ/email): `fc.constantFrom` de templates fixos
 *     válidos para evitar valores aleatórios que falham na validação.
 *
 * Validates: Requirements 1.5, 3.6
 */

import fc from 'fast-check';

// ─── PII via templates fixos válidos ────────────────────────────────────────

/** CPFs com dígito verificador válido (templates fixos). */
export function validCpf(): fc.Arbitrary<string> {
  return fc.constantFrom('111.444.777-35', '529.982.247-25', '390.533.447-05');
}

/** CPFs em formato inválido ou com DV incorreto. */
export function invalidCpf(): fc.Arbitrary<string> {
  return fc.constantFrom('111.111.111-11', '000.000.000-00', '123.456.789-00', '12345', '');
}

/** CNPJs com dígito verificador válido (templates fixos). */
export function validCnpj(): fc.Arbitrary<string> {
  return fc.constantFrom('11.222.333/0001-81', '45.448.325/0001-92', '34.028.316/0001-03');
}

/** CNPJs inválidos. */
export function invalidCnpj(): fc.Arbitrary<string> {
  return fc.constantFrom('11.111.111/1111-11', '00.000.000/0000-00', '123', '');
}

/** Telefones BR válidos (DDD 11-99, celular 9 dígitos). */
export function validPhone(): fc.Arbitrary<string> {
  return fc.constantFrom(
    '(62) 99999-8888',
    '(11) 98765-4321',
    '(21) 99123-4567',
    '(48) 98888-7777'
  );
}

/** Telefones inválidos (DDD fora de faixa, tamanho errado). */
export function invalidPhone(): fc.Arbitrary<string> {
  return fc.constantFrom('(00) 99999-9999', '(100) 99999-9999', '123', '999999999999999', '');
}

/** E-mails válidos (templates fixos). */
export function validEmail(): fc.Arbitrary<string> {
  return fc.constantFrom(
    'teste@fretegobr.com.br',
    'motorista@gmail.com',
    'embarcador@empresa.com.br',
    'bruno.contas@uol.com.br'
  );
}

/** E-mails inválidos (sem @, sem domínio, com caractere perigoso). */
export function invalidEmail(): fc.Arbitrary<string> {
  return fc.constantFrom('semarroba.com', 'user@', '@dominio.com', 'user<script>@x.com', '');
}

// ─── Texto seguro (nunca fc.stringOf) ───────────────────────────────────────

/**
 * String não-vazia dentro de [min, max], usando fc.string + filter.
 * NUNCA usa fc.stringOf (não existe na lib).
 */
export function safeText(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .string({ minLength: min, maxLength: max })
    .filter((s) => s.trim().length >= Math.max(1, min) && s.trim().length <= max);
}

// ─── Números financeiros (válidos + extremos + inválidos) ───────────────────

/**
 * Valor financeiro incluindo extremos perigosos: NaN, Infinity, -Infinity,
 * zero, negativo. Usado para exercitar INVALID_NUMERIC_INPUT e NUMERIC_OVERFLOW.
 */
export function financialAmount(): fc.Arbitrary<number> {
  return fc.oneof(
    fc.double({ min: 0, max: 1_000_000, noNaN: true }),
    fc.constantFrom(NaN, Infinity, -Infinity, 0, -0.01, Number.MAX_VALUE)
  );
}

/** Valor financeiro estritamente válido (sem NaN/Infinity, >= 0). */
export function validFinancialAmount(): fc.Arbitrary<number> {
  return fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });
}

// ─── Identificadores ────────────────────────────────────────────────────────

/** UUID v4 sintético determinístico para seeds de teste. */
export function uuidLike(): fc.Arbitrary<string> {
  const hex = (n: number) =>
    fc
      .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: n, maxLength: n })
      .map((a) => a.join(''));
  return fc
    .tuple(hex(8), hex(4), hex(4), hex(4), hex(12))
    .map(([a, b, c, d, e]) => `${a}-${b}-4${c.slice(1)}-${d}-${e}`);
}
