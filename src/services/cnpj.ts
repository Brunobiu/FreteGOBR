/**
 * CNPJ Service
 *
 * Consulta dados de uma empresa pelo CNPJ usando a BrasilAPI.
 * Documentação: https://brasilapi.com.br/docs#tag/CNPJ
 *
 * Endpoint público, sem chave de API, com cache no servidor.
 */

export interface CnpjData {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacao: string;
  uf?: string | null;
  municipio?: string | null;
}

const BRASIL_API_BASE = 'https://brasilapi.com.br/api/cnpj/v1';

/**
 * Remove tudo que não for dígito.
 */
export function sanitizeCnpj(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Formata um CNPJ no padrão "XX.XXX.XXX/XXXX-XX" conforme o usuário digita.
 */
export function formatCnpj(value: string): string {
  const digits = sanitizeCnpj(value).slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/**
 * Validação simples de tamanho. Não verifica dígito verificador para
 * permitir que a BrasilAPI retorne erro caso seja inválido.
 */
export function isValidCnpjLength(value: string): boolean {
  return sanitizeCnpj(value).length === 14;
}

export class CnpjLookupError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'INVALID' | 'NETWORK' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'CnpjLookupError';
  }
}

/**
 * Busca os dados públicos de um CNPJ na BrasilAPI.
 */
export async function lookupCnpj(cnpj: string): Promise<CnpjData> {
  const digits = sanitizeCnpj(cnpj);
  if (digits.length !== 14) {
    throw new CnpjLookupError('CNPJ deve ter 14 dígitos.', 'INVALID');
  }

  let res: Response;
  try {
    res = await fetch(`${BRASIL_API_BASE}/${digits}`);
  } catch {
    throw new CnpjLookupError('Falha de rede ao consultar o CNPJ.', 'NETWORK');
  }

  if (res.status === 404) {
    throw new CnpjLookupError('CNPJ não encontrado.', 'NOT_FOUND');
  }
  if (!res.ok) {
    throw new CnpjLookupError(`Erro ao consultar CNPJ (status ${res.status}).`, 'UNKNOWN');
  }

  const data = (await res.json()) as {
    cnpj: string;
    razao_social?: string;
    nome_fantasia?: string;
    descricao_situacao_cadastral?: string;
    uf?: string;
    municipio?: string;
  };

  return {
    cnpj: data.cnpj,
    razaoSocial: data.razao_social ?? '',
    nomeFantasia: data.nome_fantasia ?? null,
    situacao: data.descricao_situacao_cadastral ?? '',
    uf: data.uf ?? null,
    municipio: data.municipio ?? null,
  };
}
