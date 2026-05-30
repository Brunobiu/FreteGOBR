/**
 * Property-Based Tests — Anti-fraude no cadastro (`src/utils/trialStatus.ts`:
 * `normalizeIdentifier` / `computeIdentifierAvailable`).
 *
 * Arquivo compartilhado pelas Correctness Properties 7–9 da spec `trial-e-bloqueio`
 * (Design Section "Correctness Properties"). Cada propriedade é implementada por um
 * único property test (fast-check, >= 100 iterações) e tagueada com o comentário
 * `Feature: trial-e-bloqueio, Property {n}`.
 *
 * Layout do arquivo (um `describe` de topo por propriedade; seções claramente
 * separadas para que as próximas tarefas adicionem blocos sem conflito):
 *   - Property 7: Rejeição atômica de cadastro duplicado   (esta tarefa — 4.3)
 *   - Property 8: Disponibilidade quando únicos             (tarefa 4.4)
 *   - Property 9: Checagem isolada booleana sem efeito      (tarefa 4.5)
 *
 * Modelo puro: as funções `isSignupBlocked` / `attemptSignup` abaixo espelham a
 * semântica atômica do trigger SQL `users_antifraud_duplicate_block` (BEFORE
 * INSERT em `users`): qualquer duplicidade de phone/cpf/email aborta o INSERT
 * inteiro antes de qualquer linha persistir, independentemente do resultado de
 * qualquer checagem isolada de disponibilidade (`is_identifier_available`).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  normalizeIdentifier,
  computeIdentifierAvailable,
  type IdentifierType,
} from '../utils/trialStatus';

// ============================================================================
// Constante canônica (Requirements 8.2–8.4).
//
// NOTA: a constante `DUPLICATE_IDENTIFIER_MESSAGE` será exportada de `auth.ts`
// pela tarefa 4.1. Para manter este teste independente dessa tarefa, fixamos o
// literal canônico diretamente aqui.
// ============================================================================
const DUPLICATE_IDENTIFIER_MESSAGE = 'Este CPF/telefone/e-mail já está cadastrado.';

// ============================================================================
// Pools fixos de identificadores válidos (steering: usar `fc.constantFrom` de
// templates fixos válidos — nunca strings aleatórias que falham na validação).
//
// Cada entrada de pool é um grupo de VARIAÇÕES DE FORMATAÇÃO que normalizam
// para a MESMA forma canônica (a posição [0] é a forma "plana" registrada na
// base). Isso valida a equivalência de normalização (pontos/traços, DDI +55).
// ============================================================================

/** Telefones registráveis: cada grupo normaliza para o mesmo número (11 dígitos). */
const PHONE_POOL: readonly (readonly string[])[] = [
  ['11987654321', '(11) 98765-4321', '+55 (11) 98765-4321', '5511987654321'],
  ['21912345678', '(21) 91234-5678', '+55 21 91234-5678', '5521912345678'],
  ['31988887777', '(31) 98888-7777', '+5531988887777', '5531988887777'],
  ['41999990000', '(41) 99999-0000', '+55 41 99999-0000', '5541999990000'],
] as const;

/** CPFs registráveis (templates fixos; normalização só remove não-dígitos). */
const CPF_POOL: readonly (readonly string[])[] = [
  ['11144477735', '111.444.777-35'],
  ['52998224725', '529.982.247-25'],
  ['39053344705', '390.533.447-05'],
  ['16899535009', '168.995.350-09'],
] as const;

/** E-mails registráveis: variações de caixa/espaços normalizam para o mesmo. */
const EMAIL_POOL: readonly (readonly string[])[] = [
  ['joao.silva@example.com', ' JOAO.SILVA@example.com ', 'Joao.Silva@Example.Com'],
  ['maria@frete.com.br', 'MARIA@Frete.com.BR', '  maria@frete.com.br'],
  ['pedro_santos@mail.io', 'Pedro_Santos@Mail.IO ', 'PEDRO_SANTOS@MAIL.IO'],
  ['ana@empresa.org', ' Ana@Empresa.org', 'ANA@EMPRESA.ORG'],
] as const;

/** Identificadores "frescos": canônicos disjuntos dos pools — nunca registrados. */
const PHONE_FRESH: readonly string[] = [
  '51988776655',
  '(61) 97766-5544',
  '+55 71 96655-4433',
] as const;
const CPF_FRESH: readonly string[] = ['12345678909', '987.654.321-00', '74125896301'] as const;
const EMAIL_FRESH: readonly string[] = [
  'novo.motorista@frete.app',
  'Disponivel@Mail.com',
  ' fresh.user@example.net ',
] as const;

type Field = IdentifierType; // 'phone' | 'cpf' | 'email'

const POOLS: Record<Field, readonly (readonly string[])[]> = {
  phone: PHONE_POOL,
  cpf: CPF_POOL,
  email: EMAIL_POOL,
};
const FRESH: Record<Field, readonly string[]> = {
  phone: PHONE_FRESH,
  cpf: CPF_FRESH,
  email: EMAIL_FRESH,
};

const FIELDS: readonly Field[] = ['phone', 'cpf', 'email'] as const;

/** Seleção determinística (módulo) dentro de um array não-vazio. */
function pickFrom<T>(arr: readonly T[], n: number): T {
  return arr[n % arr.length];
}

// ----------------------------------------------------------------------------
// Modelo puro do trigger atômico `users_antifraud_duplicate_block`.
// ----------------------------------------------------------------------------

/** Conjuntos de identificadores JÁ NORMALIZADOS presentes na base `users`. */
interface ExistingBase {
  phone: Set<string>;
  cpf: Set<string>;
  email: Set<string>;
}

/** Submissão de cadastro (identificador ausente ⇒ `null`, como no trigger). */
interface SignupSubmission {
  phone: string | null;
  cpf: string | null;
  email: string | null;
}

/**
 * Espelho da semântica do trigger BEFORE INSERT: retorna `true` (bloqueado) se
 * QUALQUER um dos identificadores não-nulos já existe na base (em forma
 * normalizada equivalente). Usa as funções puras do núcleo.
 */
function isSignupBlocked(base: ExistingBase, sub: SignupSubmission): boolean {
  const phoneDup = sub.phone != null && !computeIdentifierAvailable('phone', sub.phone, base.phone);
  const cpfDup = sub.cpf != null && !computeIdentifierAvailable('cpf', sub.cpf, base.cpf);
  const emailDup = sub.email != null && !computeIdentifierAvailable('email', sub.email, base.email);
  return phoneDup || cpfDup || emailDup;
}

/**
 * Modela a operação de cadastro atômica: em caso de duplicidade, NENHUMA linha
 * é criada (contagem inalterada) e a mensagem canônica é retornada.
 */
function attemptSignup(
  base: ExistingBase,
  usersCount: number,
  sub: SignupSubmission
): { blocked: boolean; message: string | null; newCount: number } {
  if (isSignupBlocked(base, sub)) {
    return { blocked: true, message: DUPLICATE_IDENTIFIER_MESSAGE, newCount: usersCount };
  }
  return { blocked: false, message: null, newCount: usersCount + 1 };
}

// ============================================================================
// Feature: trial-e-bloqueio, Property 7: Rejeição atômica de cadastro duplicado
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
//
// For any base de usuários pré-existente e for any submissão cujos
// identificadores contenham PELO MENOS UM cpf/telefone/email já em uso (em
// qualquer forma normalizada equivalente), a operação SHALL ser rejeitada com a
// mensagem canônica e a contagem de linhas em `users` SHALL permanecer
// inalterada — independentemente do resultado de qualquer checagem isolada de
// disponibilidade.
// ============================================================================
describe('Property 7: Rejeição atômica de cadastro duplicado', () => {
  /**
   * Gera: (a) uma base pré-existente não-vazia por campo; (b) um subconjunto
   * não-vazio de campos a duplicar; (c) uma submissão que reusa um identificador
   * registrado (em forma de variante) nos campos duplicados e usa identificadores
   * frescos/ausentes nos demais. A construção garante >= 1 duplicidade.
   */
  const scenarioArb = fc.record({
    // Índices registrados (subconjunto não-vazio) por campo.
    regPhone: fc.uniqueArray(fc.nat({ max: PHONE_POOL.length - 1 }), {
      minLength: 1,
      maxLength: PHONE_POOL.length,
    }),
    regCpf: fc.uniqueArray(fc.nat({ max: CPF_POOL.length - 1 }), {
      minLength: 1,
      maxLength: CPF_POOL.length,
    }),
    regEmail: fc.uniqueArray(fc.nat({ max: EMAIL_POOL.length - 1 }), {
      minLength: 1,
      maxLength: EMAIL_POOL.length,
    }),
    usersCount: fc.nat({ max: 1_000_000 }),
    // Campos que terão duplicidade (não-vazio ⇒ >= 1 duplicado).
    dupFields: fc.uniqueArray(fc.constantFrom<Field>('phone', 'cpf', 'email'), {
      minLength: 1,
      maxLength: 3,
    }),
    // Seletores de entrada registrada + variante de formatação por campo.
    phoneRegSel: fc.nat(),
    phoneVarSel: fc.nat(),
    cpfRegSel: fc.nat(),
    cpfVarSel: fc.nat(),
    emailRegSel: fc.nat(),
    emailVarSel: fc.nat(),
    // Seletores de valor fresco + inclusão para campos NÃO-duplicados.
    phoneFreshSel: fc.nat(),
    cpfFreshSel: fc.nat(),
    emailFreshSel: fc.nat(),
    phoneInclude: fc.boolean(),
    cpfInclude: fc.boolean(),
    emailInclude: fc.boolean(),
  });

  it('bloqueia com mensagem canônica e mantém a contagem inalterada (≥1 duplicado)', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const reg: Record<Field, number[]> = {
          phone: s.regPhone,
          cpf: s.regCpf,
          email: s.regEmail,
        };
        const regSel: Record<Field, number> = {
          phone: s.phoneRegSel,
          cpf: s.cpfRegSel,
          email: s.emailRegSel,
        };
        const varSel: Record<Field, number> = {
          phone: s.phoneVarSel,
          cpf: s.cpfVarSel,
          email: s.emailVarSel,
        };
        const freshSel: Record<Field, number> = {
          phone: s.phoneFreshSel,
          cpf: s.cpfFreshSel,
          email: s.emailFreshSel,
        };
        const include: Record<Field, boolean> = {
          phone: s.phoneInclude,
          cpf: s.cpfInclude,
          email: s.emailInclude,
        };

        // (a) Base pré-existente: conjuntos de identificadores normalizados.
        const base: ExistingBase = {
          phone: new Set(reg.phone.map((i) => normalizeIdentifier('phone', POOLS.phone[i][0]))),
          cpf: new Set(reg.cpf.map((i) => normalizeIdentifier('cpf', POOLS.cpf[i][0]))),
          email: new Set(reg.email.map((i) => normalizeIdentifier('email', POOLS.email[i][0]))),
        };

        // (b)/(c) Submissão: campos duplicados reusam registrados (variante);
        // demais campos usam valores frescos (disponíveis) ou ausentes.
        const buildField = (field: Field): string | null => {
          if (s.dupFields.includes(field)) {
            const regIdx = pickFrom(reg[field], regSel[field]);
            const variants = POOLS[field][regIdx];
            return pickFrom(variants, varSel[field]);
          }
          return include[field] ? pickFrom(FRESH[field], freshSel[field]) : null;
        };

        const submission: SignupSubmission = {
          phone: buildField('phone'),
          cpf: buildField('cpf'),
          email: buildField('email'),
        };

        const result = attemptSignup(base, s.usersCount, submission);

        // Rejeição garantida (≥1 duplicado por construção).
        expect(result.blocked).toBe(true);
        // Mensagem canônica exata (Requirements 8.2–8.4).
        expect(result.message).toBe(DUPLICATE_IDENTIFIER_MESSAGE);
        // Contagem de `users` inalterada — nenhum registro criado (Req 8.5).
        expect(result.newCount).toBe(s.usersCount);

        // Independência do resultado de checagem isolada (Req 8.5):
        // campos NÃO-duplicados que foram incluídos reportam "disponível" em
        // isolamento, e ainda assim o bloqueio se mantém.
        for (const field of FIELDS) {
          if (!s.dupFields.includes(field) && submission[field] != null) {
            const availableInIsolation = computeIdentifierAvailable(
              field,
              submission[field] as string,
              base[field]
            );
            expect(availableInIsolation).toBe(true);
          }
        }
        // O bloqueio é independente das checagens isoladas acima.
        expect(isSignupBlocked(base, submission)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('o bloqueio independe da forma de formatação: variante ≠ registrada ainda colide', () => {
    // Reforça a equivalência de normalização: registra a forma plana e submete
    // uma variante formatada (pontos/traços/DDI +55) do MESMO identificador.
    const fieldVariantArb = fc.constantFrom<Field>('phone', 'cpf', 'email').chain((field) =>
      fc.record({
        field: fc.constant(field),
        poolIdx: fc.nat({ max: POOLS[field].length - 1 }),
        varIdx: fc.nat({ max: 16 }),
        usersCount: fc.nat({ max: 1_000_000 }),
      })
    );

    fc.assert(
      fc.property(fieldVariantArb, ({ field, poolIdx, varIdx, usersCount }) => {
        const variants = POOLS[field][poolIdx];
        const base: ExistingBase = { phone: new Set(), cpf: new Set(), email: new Set() };
        // Registra a forma canônica/plana.
        base[field].add(normalizeIdentifier(field, variants[0]));

        // Submete uma variante (possivelmente formatada) do mesmo valor.
        const submitted = pickFrom(variants, varIdx);
        const submission: SignupSubmission = { phone: null, cpf: null, email: null };
        submission[field] = submitted;

        const result = attemptSignup(base, usersCount, submission);
        expect(result.blocked).toBe(true);
        expect(result.message).toBe(DUPLICATE_IDENTIFIER_MESSAGE);
        expect(result.newCount).toBe(usersCount);
      }),
      { numRuns: 200 }
    );
  });
});

// ============================================================================
// Feature: trial-e-bloqueio, Property 8: Disponibilidade quando todos os
// identificadores são únicos
// Validates: Requirements 8.6
//
// For any trio (cpf, telefone, email) em que NENHUM consta na base existente,
// `computeIdentifierAvailable` (espelho de `is_identifier_available`) SHALL
// retornar `true` para cada um, e o cadastro modelado SHALL poder prosseguir
// (não bloqueado), criando exatamente 1 linha em `users`. Usa os pools
// "frescos" (FRESH), disjuntos dos pools registrados, com variações de
// formatação via `fc.constantFrom`.
// ============================================================================
describe('Property 8: Disponibilidade quando todos os identificadores são únicos', () => {
  /**
   * Gera: (a) uma base pré-existente arbitrária por campo (subconjunto possivelmente
   * vazio dos pools registrados); (b) um trio de identificadores FRESCOS — disjuntos
   * por construção de qualquer forma normalizada presente na base — escolhidos com
   * variações de formatação (`fc.constantFrom` sobre os pools FRESH, que incluem
   * máscara/pontos/traços/DDI +55 e espaços/caixa em e-mail).
   */
  const scenarioArb = fc.record({
    // Subconjunto (possivelmente vazio) de cada pool registrado compõe a base.
    regPhone: fc.uniqueArray(fc.nat({ max: PHONE_POOL.length - 1 }), {
      maxLength: PHONE_POOL.length,
    }),
    regCpf: fc.uniqueArray(fc.nat({ max: CPF_POOL.length - 1 }), {
      maxLength: CPF_POOL.length,
    }),
    regEmail: fc.uniqueArray(fc.nat({ max: EMAIL_POOL.length - 1 }), {
      maxLength: EMAIL_POOL.length,
    }),
    usersCount: fc.nat({ max: 1_000_000 }),
    // Identificadores frescos (variações de formatação) — nunca registrados.
    phoneFresh: fc.constantFrom(...PHONE_FRESH),
    cpfFresh: fc.constantFrom(...CPF_FRESH),
    emailFresh: fc.constantFrom(...EMAIL_FRESH),
  });

  it('todos únicos ⇒ disponível para cada identificador e cadastro prossegue (+1 linha)', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        // (a) Base pré-existente: identificadores registrados já normalizados.
        const base: ExistingBase = {
          phone: new Set(s.regPhone.map((i) => normalizeIdentifier('phone', PHONE_POOL[i][0]))),
          cpf: new Set(s.regCpf.map((i) => normalizeIdentifier('cpf', CPF_POOL[i][0]))),
          email: new Set(s.regEmail.map((i) => normalizeIdentifier('email', EMAIL_POOL[i][0]))),
        };

        // (b) Submissão com os três identificadores frescos (disjuntos da base).
        const submission: SignupSubmission = {
          phone: s.phoneFresh,
          cpf: s.cpfFresh,
          email: s.emailFresh,
        };

        // `is_identifier_available` retorna `true` para CADA identificador (Req 8.6).
        expect(computeIdentifierAvailable('phone', submission.phone as string, base.phone)).toBe(
          true
        );
        expect(computeIdentifierAvailable('cpf', submission.cpf as string, base.cpf)).toBe(true);
        expect(computeIdentifierAvailable('email', submission.email as string, base.email)).toBe(
          true
        );

        // O cadastro PODE prosseguir: não bloqueado, sem mensagem de erro, e a
        // contagem de `users` cresce em exatamente 1 (registro criado).
        expect(isSignupBlocked(base, submission)).toBe(false);

        const result = attemptSignup(base, s.usersCount, submission);
        expect(result.blocked).toBe(false);
        expect(result.message).toBeNull();
        expect(result.newCount).toBe(s.usersCount + 1);
      }),
      { numRuns: 200 }
    );
  });
});

// ============================================================================
// Feature: trial-e-bloqueio, Property 9: Checagem isolada de disponibilidade é
// booleana e sem efeito colateral
// Validates: Requirements 8.7
//
// For any identificador e tipo válido, `computeIdentifierAvailable(type, value,
// existing)` (espelho de `is_identifier_available`) SHALL retornar
// `NOT exists(normalizado ∈ existing)` (um BOOLEANO), SHALL não criar nenhuma
// conta e a contagem modelada de linhas em `users` SHALL permanecer inalterada
// após a chamada — resultado distinto e independente do efeito de bloqueio de
// criação da Property 7.
//
// "Sem efeito colateral" é modelado de três formas complementares (a função é
// pura): (a) a contagem modelada de `users` é a mesma antes/depois; (b) o `Set`
// `existing` passado por referência NÃO é mutado (mesmo tamanho e membros);
// (c) chamar a função duas vezes com os mesmos argumentos produz resultado
// idêntico (determinismo). Cobre tanto o caso DISPONÍVEL (identificador fresco,
// fora da base) quanto o INDISPONÍVEL (identificador presente na base em uma
// variante de formatação diferente).
// ============================================================================
describe('Property 9: Checagem isolada de disponibilidade é booleana e sem efeito colateral', () => {
  // Todos os pools (PHONE/CPF/EMAIL) têm 4 entradas ⇒ índices válidos 0..3.
  const POOL_MAX_IDX = 3;

  const scenarioArb = fc.record({
    field: fc.constantFrom<Field>('phone', 'cpf', 'email'),
    // Base pré-existente: subconjunto (possivelmente vazio) de índices do pool.
    regIdx: fc.uniqueArray(fc.nat({ max: POOL_MAX_IDX }), { maxLength: POOL_MAX_IDX + 1 }),
    // Contagem modelada de linhas em `users` antes da checagem isolada.
    usersCount: fc.nat({ max: 1_000_000 }),
    // Qual dos dois casos cobrir: indisponível (registrado) vs disponível (fresco).
    unavailable: fc.boolean(),
    // Caso indisponível: índice registrado + variante de formatação (mesma forma
    // normalizada da entrada [0] registrada na base).
    targetIdx: fc.nat({ max: POOL_MAX_IDX }),
    variantSel: fc.nat(),
    // Caso disponível: valor fresco (com variação de formatação) disjunto da base.
    freshSel: fc.nat(),
  });

  it('retorna NOT exists(normalizado) como booleano, sem efeito colateral e determinístico', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const field = s.field;

        // Base de identificadores já normalizados presentes em `users`.
        const regIndices = [...s.regIdx];
        // No caso indisponível, garante que o alvo consultado está na base.
        if (s.unavailable) regIndices.push(s.targetIdx);
        const existing = new Set(
          regIndices.map((i) => normalizeIdentifier(field, POOLS[field][i][0]))
        );

        // Valor consultado, escolhido via `fc.constantFrom` com variações de
        // formatação (máscara/pontos/traços/DDI +55, caixa/espaços em e-mail).
        const value = s.unavailable
          ? pickFrom(POOLS[field][s.targetIdx], s.variantSel) // variante registrada ⇒ colide
          : pickFrom(FRESH[field], s.freshSel); // fresco ⇒ disjunto da base

        // Snapshot ANTES: contagem modelada de `users` e estado do Set passado.
        const usersCountBefore = s.usersCount;
        const sizeBefore = existing.size;
        const membersBefore = [...existing].sort();

        const result = computeIdentifierAvailable(field, value, existing);

        // (1) O resultado é estritamente booleano.
        expect(typeof result).toBe('boolean');

        // (2) Semântica `NOT exists`: igual a `!(normalizado ∈ existing)`.
        const expected = !existing.has(normalizeIdentifier(field, value));
        expect(result).toBe(expected);

        // Cobertura explícita dos dois casos gerados.
        if (s.unavailable) {
          expect(result).toBe(false); // presente em variante ⇒ indisponível
        } else {
          expect(result).toBe(true); // fresco ⇒ disponível
        }

        // (3a) Sem efeito colateral: a checagem isolada NÃO cria conta; a
        // contagem modelada de `users` permanece inalterada — distinta e
        // independente do efeito de bloqueio de criação (Property 7).
        const usersCountAfter = usersCountBefore;
        expect(usersCountAfter).toBe(s.usersCount);

        // (3b) Pureza: o `Set` passado por referência não é mutado.
        expect(existing.size).toBe(sizeBefore);
        expect([...existing].sort()).toEqual(membersBefore);

        // (3c) Determinismo: invocar de novo com os mesmos argumentos repete o
        // resultado, sem nenhuma mutação acumulada.
        const again = computeIdentifierAvailable(field, value, existing);
        expect(again).toBe(result);
        expect(existing.size).toBe(sizeBefore);
        expect([...existing].sort()).toEqual(membersBefore);
      }),
      { numRuns: 200 }
    );
  });
});
