/**
 * Lista canonica de Tipos de Caminhao.
 *
 * Ordem alfabetica (pt-BR, com acentos normalizados via localeCompare).
 * "Nao informado" fica no fim como fallback. Os valores sao usados:
 *  - no perfil do motorista (MotoristaPerfilPage) para escolher o tipo
 *    do veiculo dele;
 *  - no formulario do embarcador (FreteForm) para indicar quais tipos
 *    de caminhao sao aceitos no frete;
 *  - futuramente, para filtrar fretes mostrados ao motorista em funcao
 *    do tipo de caminhao dele.
 *
 * Fonte unica de verdade: editar SO aqui.
 */

export interface VehicleTypeOption {
  /** Slug ASCII estavel para gravar no banco (sem acentos/espacos). */
  value: string;
  /** Rotulo exibido ao usuario, com acentos. */
  label: string;
}

const RAW: string[] = [
  'Bi-caçamba (4 eixos) 24T',
  'Bi-caçamba (6 eixos) 40T',
  'Bi-container (4 eixos) 40T',
  'Bi-container (6 eixos) 45T',
  'Bi-graneleiro (4 eixos) 40T',
  'Bi-graneleiro (6 eixos) 45T',
  'Bi-trem (7 eixos) 57T',
  'Bi-trem (9 eixos) 74T',
  'Bi-trem 2/3 (8 eixos) 65.5T',
  'Bi-trem 3/2 (8 eixos) 65.5T',
  'Bi-trem Bi-truck (8 eixos) 63T',
  'Caçamba Semi-reboque (4 eixos) 24T',
  'Caçamba Semi-reboque (6 eixos) 40T',
  'Caminhão (4 eixos) 31.5T',
  'Caminhão 3/4 (2 eixos) 16T',
  'Caminhão Bi-Truck (5 eixos) 35T',
  'Caminhão Bi-Truck (8x2) 29T',
  'Caminhão Truck (6x2) 23T',
  'Caminhão VUC',
  'Carreta Canguru Toco (5 eixos) 43T',
  'Carreta Canguru Truck (6 eixos) 50T',
  'Carreta Canguru Truck (7 eixos) 58.5T',
  'Carreta Espaçado Toco (4 eixos) 36T',
  'Carreta Espaçado Truck (5 eixos) 43T',
  'Carreta LS Toco (5 eixos) 41.5T',
  'Carreta LS Truck (6 eixos curta) 45T',
  'Carreta LS Truck (6 eixos) 48.5T',
  'Carreta LS Truck (7 eixos) 54.5T',
  'Carreta Simples Toco (3 eixos) 25T',
  'Carreta Simples Truck (4 eixos) 33T',
  'Carreta Toco (4 eixos) 33T',
  'Carreta Truck (5 eixos) 40T',
  'Carreta Vanderléia Toco (5 eixos) 46T',
  'Carreta Vanderléia Truck (6 eixos) 53T',
  'Graneleiro Semi-reboque (4 eixos) 24T',
  'Graneleiro Semi-reboque (6 eixos) 40T',
  'Graneleiro trucado Semi-reboque (6 eixos) 40T',
  'Graneleiro trucado Semi-reboque (7 eixos) 45T',
  'Graneleiro vanderleia Semi-reboque (9 eixos) 60T',
  'Graneleiro vanderleia Semi-reboque (10 eixos) 70T',
  'Isotank 23T',
  'Isotank 25T',
  'Rodotrem (9 eixos) 74T',
  'Rodotrem caçamba Semi-reboque (9 eixos) 60T',
  'Rodotrem caçamba Semi-reboque (10 eixos) 70T',
  'Rodotrem madeira Semi-reboque (9 eixos) 60T',
  'Rodotrem madeira Semi-reboque (10 eixos) 70T',
  'Romeu e Julieta (4 eixos) 36T',
  'Romeu e Julieta (6 eixos) 50T',
  'Romeu e Julieta (7 eixos) 50T',
  'Romeu e Julieta (9 eixos) 74T',
  'Romeu Julieta 2/3 (5 eixos) 43T',
  'Romeu Julieta 3/2 (5 eixos) 43T',
  'Treminhão (7 eixos) 63T',
  'Treminhão (9 eixos) 74T',
  'Tri-trem (9 eixos) 74T',
  'Tri-trem Semi-reboque (9 eixos) 60T',
  'Tri-trem Semi-reboque (10 eixos) 70T',
  'Utilitário',
  'Vanderleia Semi-reboque (9 eixos) 60T',
  'Vanderleia Semi-reboque (10 eixos) 70T',
];

/**
 * Slug estavel para o `value` gravado no banco. Remove acentos, troca
 * espacos por `_`, normaliza minusculas. Fica humano-legivel ("isotank_25t").
 */
function toSlug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

const ORDERED = [...RAW].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

export const VEHICLE_TYPES: VehicleTypeOption[] = [
  ...ORDERED.map((label) => ({ value: toSlug(label), label })),
  { value: 'nao_informado', label: 'Não informado' },
];

/**
 * Lookup rapido label -> option (para exibir o nome amigavel a partir
 * do value que veio do banco).
 */
export const VEHICLE_TYPE_BY_VALUE: Record<string, VehicleTypeOption> = Object.fromEntries(
  VEHICLE_TYPES.map((v) => [v.value, v])
);

/** Legivel de um array CSV/joined de values, com fallback ao proprio value. */
export function vehicleTypeLabel(value: string): string {
  return VEHICLE_TYPE_BY_VALUE[value]?.label ?? value;
}

/**
 * Converte o CSV (ou string com `, `) salvo em fretes.vehicle_type para
 * uma string legivel separada por ` · `. Aceita tanto values novos
 * (slugs canonicos) quanto labels antigos (compatibilidade com fretes
 * legados criados antes da consolidacao em data/vehicleTypes).
 */
export function vehicleTypesCsvLabel(csv: string | null | undefined): string {
  if (!csv) return '—';
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((v) => vehicleTypeLabel(v))
    .join(' · ');
}

/**
 * Igual a `vehicleTypesCsvLabel`, mas retorna a LISTA de labels (um por
 * item) em vez de uma string única. Útil para exibir um veículo abaixo do
 * outro (sem quebra horizontal) no detalhe do frete.
 */
export function vehicleTypesList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((v) => vehicleTypeLabel(v));
}
