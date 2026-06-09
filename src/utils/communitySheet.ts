/**
 * Núcleo puro da planilha de importação do Frete Comunidade (FreteGO) —
 * spec frete-comunidade, Fase 0. Sem I/O, sem React, sem Supabase.
 *
 * Responsável por:
 *   - Definir o cabeçalho/colunas do Modelo_Planilha (ordem fixa, pt-BR).
 *   - Gerar o Modelo_Planilha em CSV (BOM UTF-8 + `;` + `\r\n`, padrão do projeto).
 *   - Parsear a planilha enviada (Template_Validation + linha a linha).
 *   - Validar cada Import_Row (campos obrigatórios, valor, telefone BR).
 *
 * Convenções de CSV herdadas (project-conventions.md §CSV Export e o parser da
 * blacklist): BOM UTF-8 inicial tolerado/prefixado, separador `;`, RFC 4180
 * (aspas duplas, aspa interna duplicada), quebra `\r\n`.
 *
 * XLSX é fora de escopo do MVP (decisão D3 do design): um adaptador converte
 * XLSX → matriz de strings e chama `parseCommunityMatrix`. Aqui só CSV.
 */

import { sanitizePhone, isValidPhoneBR } from './phoneFormat';

/** Limite duro de linhas por importação (design D / Req 5.12). */
export const MAX_IMPORT_ROWS = 200;

/**
 * Colunas do Modelo_Planilha, na ORDEM EXATA (Req 4.2). Rótulos em pt-BR,
 * minúsculos — a Template_Validation compara após `trim().toLowerCase()`.
 */
export const COMMUNITY_SHEET_HEADER = [
  'transportadora',
  'origem',
  'destino',
  'local de carregamento',
  'local de descarregamento',
  'valor',
  'tipo de produto',
  'telefone (whatsapp)',
] as const;

/** Uma linha lida da planilha (campos crus + normalizados). */
export interface ImportRow {
  /** Número da linha (1-based) para apresentação no preview. */
  rowNumber: number;
  carrierName: string;
  origin: string;
  destination: string;
  originDetail: string;
  destinationDetail: string;
  /** Valor parseado; `null` quando não numérico. */
  value: number | null;
  product: string;
  /** Telefone como veio na planilha. */
  phoneRaw: string;
  /** Telefone só com dígitos (sanitizePhone). */
  phoneNormalized: string;
}

export type FieldError = 'REQUIRED' | 'INVALID_VALUE' | 'INVALID_PHONE';

export interface ImportRowValidation {
  ok: boolean;
  fieldErrors: Partial<Record<keyof ImportRow, FieldError>>;
}

export interface ParseResult {
  /** Template_Validation: cabeçalho/ordem/colunas batem com o modelo. */
  templateOk: boolean;
  headerReceived: string[];
  rows: ImportRow[];
  rowValidations: ImportRowValidation[];
  /** Erros de arquivo/template (mensagens pt-BR). */
  errors: string[];
  /** `true` quando a planilha excede MAX_IMPORT_ROWS (linhas extras ignoradas). */
  truncated: boolean;
}

const SEP = ';';
const BOM = '\uFEFF';

/**
 * Parser RFC 4180 de uma linha CSV (aspas duplas, aspa interna duplicada).
 * Reaproveita a lógica do parser da blacklist (admin/blacklist.ts).
 */
function parseCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === sep) {
      out.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  out.push(cur);
  return out;
}

/** Escapa um campo para CSV RFC 4180 (aspas quando contém `"`,`;`,`\n`,`\r`). */
function csvEscape(field: string): string {
  if (/[";\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Template_Validation isolada (Req 5.9/5.10): o cabeçalho recebido deve ser
 * EXATAMENTE igual a COMMUNITY_SHEET_HEADER (mesmas colunas, mesma ordem),
 * comparando cada célula após `trim().toLowerCase()`.
 */
export function validateTemplate(headerCells: string[]): boolean {
  if (!Array.isArray(headerCells)) return false;
  if (headerCells.length !== COMMUNITY_SHEET_HEADER.length) return false;
  return COMMUNITY_SHEET_HEADER.every(
    (expected, idx) => (headerCells[idx] ?? '').trim().toLowerCase() === expected
  );
}

/** Normaliza telefone BR para apenas dígitos (delega a sanitizePhone). */
export function normalizeCommunityPhone(raw: string): string {
  return sanitizePhone(raw ?? '');
}

/**
 * Faz o parse de um valor monetário em pt-BR vindo da planilha.
 * Aceita "1.234,56", "1234,56", "1234.56", "R$ 1.234,56". Retorna `null`
 * quando não é numérico.
 */
export function parseSheetValue(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;
  // Remove tudo que não for dígito, vírgula, ponto ou sinal.
  let cleaned = s.replace(/[^\d.,-]/g, '');
  if (cleaned === '') return null;
  // Heurística pt-BR: se há vírgula, ela é o separador decimal; pontos são
  // separadores de milhar. Sem vírgula, o ponto é tratado como decimal.
  if (cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Constrói uma ImportRow a partir das células de uma linha de dados. */
function buildImportRow(cells: string[], rowNumber: number): ImportRow {
  const get = (i: number) => (cells[i] ?? '').trim();
  const phoneRaw = get(7);
  return {
    rowNumber,
    carrierName: get(0),
    origin: get(1),
    destination: get(2),
    originDetail: get(3),
    destinationDetail: get(4),
    value: parseSheetValue(get(5)),
    product: get(6),
    phoneRaw,
    phoneNormalized: normalizeCommunityPhone(phoneRaw),
  };
}

/**
 * Revalida uma única Import_Row (Req 5.3–5.7, 6.3). Determinística:
 * mesma linha ⇒ mesmo resultado. Marca o primeiro erro por campo.
 */
export function validateImportRow(row: ImportRow): ImportRowValidation {
  const fieldErrors: Partial<Record<keyof ImportRow, FieldError>> = {};

  // Campos textuais obrigatórios.
  if (row.carrierName.trim() === '') fieldErrors.carrierName = 'REQUIRED';
  if (row.origin.trim() === '') fieldErrors.origin = 'REQUIRED';
  if (row.destination.trim() === '') fieldErrors.destination = 'REQUIRED';
  if (row.originDetail.trim() === '') fieldErrors.originDetail = 'REQUIRED';
  if (row.destinationDetail.trim() === '') fieldErrors.destinationDetail = 'REQUIRED';
  if (row.product.trim() === '') fieldErrors.product = 'REQUIRED';

  // Valor: obrigatório, numérico e > 0. `null` cobre vazio e não-numérico.
  if (row.value === null || !(row.value > 0)) {
    fieldErrors.value = 'INVALID_VALUE';
  }

  // Telefone: obrigatório e BR válido (10/11 dígitos com DDD).
  if (row.phoneRaw.trim() === '') {
    fieldErrors.phoneRaw = 'REQUIRED';
  } else if (!isValidPhoneBR(row.phoneNormalized)) {
    fieldErrors.phoneRaw = 'INVALID_PHONE';
  }

  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
}

/**
 * Estado de resolução de cidade / exclusão de uma linha no Preview_Import.
 * `originResolved`/`destinationResolved` indicam que a City_Autocomplete
 * resolveu a cidade em coordenadas (lat/lng); `excluded` marca a linha que o
 * admin optou por não publicar (ex.: duplicada que decidiu excluir).
 */
export interface RowPublishState {
  originResolved: boolean;
  destinationResolved: boolean;
  excluded: boolean;
}

/**
 * City_Resolution é pré-condição de publicação (Req 6.7, 8.3, 15.4, 15.5,
 * 15.8). Uma Import_Row é elegível para publicação sse:
 *   - passa em `validateImportRow` (todos os campos válidos), E
 *   - origem E destino estão resolvidas em coordenadas, E
 *   - não foi marcada como excluída.
 * Função pura e determinística — espelho da regra que habilita o botão
 * "Publicar" e que a RPC reforça (linha com cidade pendente ⇒ `CITY_UNRESOLVED`).
 */
export function isRowPublishable(row: ImportRow, state: RowPublishState): boolean {
  if (state.excluded) return false;
  if (!state.originResolved || !state.destinationResolved) return false;
  return validateImportRow(row).ok;
}

/**
 * Parser puro: recebe a matriz já lida (linhas × células) e produz o
 * ParseResult. A primeira linha é o cabeçalho (Template_Validation); as demais
 * são linhas de dados. Linhas totalmente vazias são ignoradas.
 */
export function parseCommunityMatrix(matrix: string[][]): ParseResult {
  const errors: string[] = [];

  if (!Array.isArray(matrix) || matrix.length === 0) {
    return {
      templateOk: false,
      headerReceived: [],
      rows: [],
      rowValidations: [],
      errors: ['A planilha não está no formato do modelo. Baixe o modelo correto.'],
      truncated: false,
    };
  }

  const headerReceived = (matrix[0] ?? []).map((c) => (c ?? '').trim());
  const templateOk = validateTemplate(headerReceived);
  if (!templateOk) {
    errors.push('A planilha não está no formato do modelo. Baixe o modelo correto e tente novamente.');
    return { templateOk: false, headerReceived, rows: [], rowValidations: [], errors, truncated: false };
  }

  // Linhas de dados: ignora linhas totalmente vazias.
  const dataLines = matrix.slice(1).filter((cells) => cells.some((c) => (c ?? '').trim() !== ''));

  if (dataLines.length === 0) {
    errors.push('A planilha não contém fretes.');
    return { templateOk: true, headerReceived, rows: [], rowValidations: [], errors, truncated: false };
  }

  const truncated = dataLines.length > MAX_IMPORT_ROWS;
  const limited = truncated ? dataLines.slice(0, MAX_IMPORT_ROWS) : dataLines;

  const rows: ImportRow[] = limited.map((cells, idx) => buildImportRow(cells, idx + 1));
  const rowValidations = rows.map((r) => validateImportRow(r));

  return { templateOk: true, headerReceived, rows, rowValidations, errors, truncated };
}

/**
 * Conveniência: parse direto de texto CSV. Tolera BOM inicial, aceita CRLF/LF,
 * separador `;`, RFC 4180 por célula.
 */
export function parseCommunityCsv(text: string): ParseResult {
  let body = text ?? '';
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);

  const lines = body.split(/\r\n|\n|\r/);
  // Remove uma eventual última linha vazia (arquivo termina com quebra).
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const matrix = lines.map((line) => parseCsvLine(line, SEP));
  return parseCommunityMatrix(matrix);
}

/**
 * Gera o Modelo_Planilha em CSV: BOM UTF-8 + cabeçalho pt-BR + 1 linha de
 * exemplo preenchida (Req 4.2/4.3/4.4). Separador `;`, quebra `\r\n`.
 */
export function buildModeloPlanilhaCsv(): string {
  const header = COMMUNITY_SHEET_HEADER.map(csvEscape).join(SEP);
  const example = [
    'Transportadora Exemplo Ltda',
    'Goiânia - GO',
    'Uberlândia - MG',
    'Fazenda Boa Vista, BR-153 km 12',
    'Armazém Central, Av. Industrial 500',
    '8500,00',
    'Soja em grãos',
    '(62) 9 9999-8888',
  ]
    .map(csvEscape)
    .join(SEP);
  return `${BOM}${header}\r\n${example}`;
}
