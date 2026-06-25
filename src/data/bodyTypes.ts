/**
 * Lista canonica de Tipos de Carroceria.
 *
 * Mesma logica de `data/vehicleTypes`: numeros da fonte original removidos,
 * ordenacao alfabetica pt-BR, "Nao Identificado" no fim.
 *
 * Usada em:
 *  - perfil do motorista (campo `body_type`, motorista tem 1 so);
 *  - formulario do embarcador (`bodyTypes`, frete pode aceitar varios);
 *  - displays de frete (FreteCard, FreteModal, etc).
 *
 * Fonte unica de verdade: editar SO aqui.
 */

export interface BodyTypeOption {
  /** Slug ASCII estavel para gravar no banco (sem acentos/espacos). */
  value: string;
  /** Rotulo exibido ao usuario, com acentos. */
  label: string;
}

const RAW: string[] = [
  'Basculante Lateral',
  'Baú Carga Seca',
  'Baú Frigorifico',
  'Baú Rebaixado',
  'Boiadeiro',
  'Caçamba / Basculante',
  'Canavieiro',
  'Carga Seca',
  'Cegonha',
  'Florestal',
  'Gaiola',
  'Grade baixa / porta container 20T (4 pinos)',
  'Grade baixa / porta container 40T (4 pinos)',
  'Grade baixa / porta container 40T (8 pinos)',
  'Grade baixa / porta container 40T (12 pinos)',
  'Graneleiro',
  'Hopper',
  'Munck',
  'Porta Container 20T (4 pinos)',
  'Porta Container 40T (4 pinos)',
  'Porta Container 40T (8 pinos)',
  'Porta Container 40T (12 pinos)',
  'Prancha',
  'Sider',
  'Sider Bebideiro',
  'Sider Rebaixado',
  'Silo',
  'Tanque de Aço Carbono - Cilindrico',
  'Tanque de Aço Carbono - Elíptico',
  'Tanque Inox',
];

function toSlug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

const ORDERED = [...RAW].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

export const BODY_TYPES: BodyTypeOption[] = [
  ...ORDERED.map((label) => ({ value: toSlug(label), label })),
  { value: 'nao_identificado', label: 'Não Identificado' },
];

export const BODY_TYPE_BY_VALUE: Record<string, BodyTypeOption> = Object.fromEntries(
  BODY_TYPES.map((b) => [b.value, b])
);

/** Label amigavel a partir do `value`. Cai no proprio value se nao mapear. */
export function bodyTypeLabel(value: string): string {
  return BODY_TYPE_BY_VALUE[value]?.label ?? value;
}

/**
 * Converte CSV (ou string com `, `) salvo em fretes.body_types para uma
 * string legivel. Aceita values novos (slugs canonicos) e labels antigos
 * (compatibilidade com fretes legados).
 */
export function bodyTypesCsvLabel(csv: string | null | undefined): string {
  if (!csv) return '—';
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((v) => bodyTypeLabel(v))
    .join(' · ');
}

/**
 * Igual a `bodyTypesCsvLabel`, mas retorna a LISTA de labels (uma carroceria
 * por item) em vez de uma string única. Útil para exibir uma carroceria
 * abaixo da outra no detalhe do frete.
 */
export function bodyTypesList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((v) => bodyTypeLabel(v));
}
