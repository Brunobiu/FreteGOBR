/**
 * IBGE API - Estados e Cidades do Brasil
 * https://servicodados.ibge.gov.br/api/docs/localidades
 */

export interface Estado {
  id: number;
  sigla: string;
  nome: string;
}

export interface Cidade {
  id: number;
  nome: string;
}

const IBGE_BASE = 'https://servicodados.ibge.gov.br/api/v1/localidades';

let estadosCache: Estado[] | null = null;
const cidadesCache: Record<string, Cidade[]> = {};

export async function getEstados(): Promise<Estado[]> {
  if (estadosCache) return estadosCache;

  const res = await fetch(`${IBGE_BASE}/estados?orderBy=nome`);
  if (!res.ok) throw new Error('Erro ao buscar estados');

  const data = await res.json();
  estadosCache = data.map((e: { id: number; sigla: string; nome: string }) => ({
    id: e.id,
    sigla: e.sigla,
    nome: e.nome,
  }));
  return estadosCache!;
}

export async function getCidades(uf: string): Promise<Cidade[]> {
  if (cidadesCache[uf]) return cidadesCache[uf];

  const res = await fetch(`${IBGE_BASE}/estados/${uf}/municipios?orderBy=nome`);
  if (!res.ok) throw new Error('Erro ao buscar cidades');

  const data = await res.json();
  cidadesCache[uf] = data.map((c: { id: number; nome: string }) => ({
    id: c.id,
    nome: c.nome,
  }));
  return cidadesCache[uf];
}
