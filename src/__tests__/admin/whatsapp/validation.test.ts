import { describe, it, expect } from 'vitest';
import { normalizeNumbers } from '../../../services/admin/whatsapp/validation';

describe('normalizeNumbers', () => {
  it('aceita separação por vírgula, quebra de linha e ambas', () => {
    const res = normalizeNumbers('11988887777, 6233334444\n5511977776666');
    expect(res.valid).toEqual(['+5511988887777', '+556233334444', '+5511977776666']);
    expect(res.invalid).toEqual([]);
  });

  it('normaliza removendo espaços e pontuação não numérica', () => {
    const res = normalizeNumbers('(11) 9 8888-7777');
    expect(res.valid).toEqual(['+5511988887777']);
    expect(res.invalid).toEqual([]);
  });

  it('deduplica números equivalentes (com e sem código de país)', () => {
    const res = normalizeNumbers('11988887777\n5511988887777\n(11) 98888-7777');
    expect(res.valid).toEqual(['+5511988887777']);
  });

  it('marca números inválidos e os separa dos válidos', () => {
    const res = normalizeNumbers('11988887777, 123, abc');
    expect(res.valid).toEqual(['+5511988887777']);
    expect(res.invalid).toEqual(['123', 'abc']);
  });

  it('aceita telefone fixo de 10 dígitos', () => {
    const res = normalizeNumbers('6233334444');
    expect(res.valid).toEqual(['+556233334444']);
  });

  it('retorna listas vazias para entrada vazia ou só separadores', () => {
    expect(normalizeNumbers('')).toEqual({ valid: [], invalid: [] });
    expect(normalizeNumbers('  , \n , ')).toEqual({ valid: [], invalid: [] });
  });

  it('deduplica entradas inválidas equivalentes', () => {
    const res = normalizeNumbers('123\n123\n1 2 3');
    expect(res.valid).toEqual([]);
    expect(res.invalid).toEqual(['123']);
  });
});
