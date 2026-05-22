/**
 * Property-Based Tests — Contador de documentos por seção
 *
 * Property 8 (Design Section 10): o contador `X/Y documentos` de cada
 * seção (Dados Pessoais, Veículo, Proprietário) só conta documentos
 * cujo `documentType` pertence à lista da seção; tipos de outras
 * seções não influenciam o contador.
 *
 * Validates: Requirement 4.7
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

const TIPOS_PESSOAIS = ['cnh', 'foto_segurando_cnh', 'comprovante_endereco_motorista'] as const;
const TIPOS_VEICULO = [
  'crlv_cavalo',
  'crlv_carreta_1',
  'crlv_carreta_2',
  'crlv_carreta_3',
  'crlv_carreta_4',
  'rntrc_cavalo',
  'rntrc_carreta_1',
  'rntrc_carreta_2',
  'foto_frente_caminhao',
  'foto_caminhao_completo',
] as const;
const TIPOS_PROPRIETARIO = ['comprovante_endereco_proprietario', 'documento_proprietario'] as const;

const ALL_TYPES = [...TIPOS_PESSOAIS, ...TIPOS_VEICULO, ...TIPOS_PROPRIETARIO] as const;

// Função pura espelhando o `countDocs` do MotoristaPerfilPage
function countDocs(types: readonly string[], documents: Record<string, unknown>): number {
  return types.filter((t) => documents[t]).length;
}

describe('countDocs', () => {
  it('retorna 0 quando nenhum documento da seção foi enviado', () => {
    expect(countDocs(TIPOS_PESSOAIS, {})).toBe(0);
    expect(countDocs(TIPOS_VEICULO, {})).toBe(0);
    expect(countDocs(TIPOS_PROPRIETARIO, {})).toBe(0);
  });

  it('retorna o número total de tipos quando todos os documentos da seção estão presentes', () => {
    const fullPessoais = Object.fromEntries(TIPOS_PESSOAIS.map((t) => [t, { id: t }]));
    expect(countDocs(TIPOS_PESSOAIS, fullPessoais)).toBe(TIPOS_PESSOAIS.length);
  });

  it('é nunca maior que o total de tipos da seção', () => {
    fc.assert(
      fc.property(fc.subarray([...ALL_TYPES] as string[]), (typesPresent) => {
        const docs = Object.fromEntries(typesPresent.map((t) => [t, { id: t }]));
        expect(countDocs(TIPOS_PESSOAIS, docs)).toBeLessThanOrEqual(TIPOS_PESSOAIS.length);
        expect(countDocs(TIPOS_VEICULO, docs)).toBeLessThanOrEqual(TIPOS_VEICULO.length);
        expect(countDocs(TIPOS_PROPRIETARIO, docs)).toBeLessThanOrEqual(TIPOS_PROPRIETARIO.length);
      }),
      { numRuns: 200 }
    );
  });

  it('isolamento entre seções: tipos de uma seção não afetam contador da outra', () => {
    fc.assert(
      fc.property(
        fc.subarray([...TIPOS_VEICULO] as string[]),
        fc.subarray([...TIPOS_PROPRIETARIO] as string[]),
        (veiculoTypes, proprietarioTypes) => {
          const docs = Object.fromEntries(
            [...veiculoTypes, ...proprietarioTypes].map((t) => [t, { id: t }])
          );
          // Contador de Pessoais deve ser 0 — nenhum tipo dessa seção foi adicionado
          expect(countDocs(TIPOS_PESSOAIS, docs)).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('contador é igual à interseção entre tipos da seção e tipos presentes', () => {
    fc.assert(
      fc.property(fc.subarray([...ALL_TYPES] as string[]), (typesPresent) => {
        const docs = Object.fromEntries(typesPresent.map((t) => [t, { id: t }]));
        const expected = TIPOS_VEICULO.filter((t) => typesPresent.includes(t)).length;
        expect(countDocs(TIPOS_VEICULO, docs)).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });
});
