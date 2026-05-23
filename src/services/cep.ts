/**
 * CepService — Lookup de CEP via ViaCEP (HTTPS público gratuito).
 *
 * Pattern espelhado de `cnpj.ts`. Helpers puros (sanitize/format/
 * isValid) podem ser usados no UI para máscara em tempo real.
 * `lookupCep` faz `fetch` ao endpoint público.
 *
 * Exemplo:
 *   const data = await lookupCep('01310-100');
 *   // data.logradouro === 'Avenida Paulista'
 *   // data.uf === 'SP'
 */

export interface CepData {
  cep: string;
  logradouro: string;
  bairro: string;
  localidade: string; // cidade
  uf: string;
}

export type CepLookupErrorCode = 'NOT_FOUND' | 'INVALID' | 'NETWORK' | 'UNKNOWN';

export class CepLookupError extends Error {
  constructor(
    message: string,
    public readonly code: CepLookupErrorCode
  ) {
    super(message);
    this.name = 'CepLookupError';
  }
}

const VIA_CEP_BASE = 'https://viacep.com.br/ws';

/**
 * Remove tudo que não for dígito.
 */
export function sanitizeCep(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Aplica máscara `NNNNN-NNN` sobre os dígitos sanitizados.
 * Trunca em 8 dígitos.
 */
export function formatCep(value: string): string {
  const digits = sanitizeCep(value).slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/**
 * `true` se o valor tem exatamente 8 dígitos quando sanitizado.
 */
export function isValidCepFormat(value: string): boolean {
  return /^[0-9]{8}$/.test(sanitizeCep(value));
}

/**
 * Consulta o ViaCEP. Lança `CepLookupError` em caso de
 * CEP inválido, não encontrado ou falha de rede.
 */
export async function lookupCep(cep: string): Promise<CepData> {
  const digits = sanitizeCep(cep);
  if (digits.length !== 8) {
    throw new CepLookupError('CEP deve ter 8 dígitos.', 'INVALID');
  }

  let res: Response;
  try {
    res = await fetch(`${VIA_CEP_BASE}/${digits}/json/`);
  } catch {
    throw new CepLookupError('Falha de rede ao consultar o CEP.', 'NETWORK');
  }

  if (!res.ok) {
    throw new CepLookupError(`Erro ao consultar CEP (status ${res.status}).`, 'UNKNOWN');
  }

  const data = await res.json();
  if (data?.erro === true) {
    throw new CepLookupError('CEP não encontrado.', 'NOT_FOUND');
  }

  return {
    cep: typeof data.cep === 'string' ? data.cep : digits,
    logradouro: data.logradouro ?? '',
    bairro: data.bairro ?? '',
    localidade: data.localidade ?? '',
    uf: data.uf ?? '',
  };
}
