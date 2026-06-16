/**
 * CSV puro do WhatsApp_Module — `toCsv` / `parseCsv`.
 *
 * Implementa o **padrão de CSV herdado** do FreteGO
 * (`project-conventions.md` §CSV Export), idêntico ao já aplicado em
 * `services/admin/{users,fretes,dashboard,financeiro,blacklist}.ts` e
 * `utils/communitySheet.ts`. Como o projeto **não** expõe um helper genérico
 * compartilhado (cada módulo replica um `csvEscape`/`parseCsvLine` privado),
 * esta é a primeira centralização da convenção em uma função pura reutilizável
 * `toCsv(rows: string[][])`, espelhando byte a byte o mesmo comportamento.
 *
 * Convenção (inalterada):
 *  - BOM UTF-8 (`\uFEFF`) prefixado.
 *  - Separador `;` (compatível Excel pt-BR).
 *  - Escape RFC 4180: campos com `"`, `;`, `\n` ou `\r` entre aspas duplas;
 *    aspa interna duplicada (`"` → `""`).
 *  - Quebra de linha `\r\n`.
 *  - Truncamento em **10000 linhas** (incluindo o cabeçalho).
 *
 * Lógica pura (sem I/O) — alvo do property test de round-trip
 * (Property 10, task 2.8).
 *
 * _Requirements: 24.6, 24.7_
 */

/** BOM UTF-8 prefixado para abertura correta no Excel pt-BR. */
export const CSV_BOM = '\uFEFF';

/** Separador de campos (Excel pt-BR usa `,` como decimal). */
export const CSV_SEPARATOR = ';';

/** Quebra de linha entre registros. */
export const CSV_LINE_BREAK = '\r\n';

/** Limite máximo de linhas no export, incluindo o cabeçalho. */
export const CSV_MAX_ROWS = 10_000;

/**
 * Escapa um campo conforme RFC 4180: envolve em aspas duplas quando contém
 * `"`, `;`, `\n` ou `\r`, duplicando a aspa interna. Espelha o `csvEscape`
 * herdado dos módulos admin.
 */
export function csvEscape(field: string): string {
  if (/[";\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Serializa uma matriz de linhas em CSV no padrão herdado do projeto.
 *
 * A primeira linha de `rows` é tratada como qualquer outra (o chamador inclui
 * o cabeçalho em `rows[0]` quando aplicável); o truncamento de
 * {@link CSV_MAX_ROWS} considera todas as linhas, cabeçalho incluído.
 *
 * @returns string CSV com BOM, separador `;`, escape RFC 4180 e quebra `\r\n`.
 */
export function toCsv(rows: string[][]): string {
  const limited = rows.length > CSV_MAX_ROWS ? rows.slice(0, CSV_MAX_ROWS) : rows;
  const body = limited.map((row) => row.map(csvEscape).join(CSV_SEPARATOR)).join(CSV_LINE_BREAK);
  return CSV_BOM + body;
}

/**
 * Faz parse de um CSV no padrão do projeto de volta para a matriz de linhas.
 *
 * Parser RFC 4180 completo: trata aspas duplas, aspa interna duplicada e
 * campos multilinha (`\n`/`\r` dentro de aspas). Tolera o BOM inicial e tanto
 * `\r\n` quanto `\n` como separador de registros fora de aspas. É a operação
 * inversa de {@link toCsv} (round-trip — Property 10).
 *
 * Texto vazio (ou apenas o BOM) retorna `[]`.
 */
export function parseCsv(text: string): string[][] {
  // Remove o BOM inicial, se presente.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (input.length === 0) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === CSV_SEPARATOR) {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Consome `\r\n` (ou `\r` solto) como separador de registro.
      endRow();
      i += input[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Fecha o último registro (sempre há um pendente quando input não-vazio).
  endRow();
  return rows;
}

/* -------------------------------------------------------------------------- *
 * CSV_Import — parsing puro de contatos (Req 24.1–24.5, 24.9).               *
 *                                                                            *
 * `parseContactsCsv` é PURA (sem I/O): faz parse do CSV (reusando            *
 * `parseCsv`), lê a coluna de Contact_Number e as colunas mapeadas de        *
 * Recipient_Data, aplica as regras do Requirement 5 via `normalizeNumbers`   *
 * (normalização, E.164, deduplicação) e reporta cada linha inválida com seu  *
 * número de linha + motivo, SEM descartá-la silenciosamente (Req 24.3).      *
 *                                                                            *
 * A persistência reusa a RPC `whatsapp_create_contact_list` via              *
 * `importContactsFromCsv` em `contacts.ts` (validação front+back).           *
 * -------------------------------------------------------------------------- */

import { normalizeNumbers } from './validation';

/**
 * Canonical_Message (pt-BR) de importação rejeitada: arquivo não é um CSV
 * válido ou não contém a coluna de Contact_Number (Req 24.4).
 */
export const WHATSAPP_CSV_IMPORT_ERROR_MESSAGE = 'Não foi possível importar o arquivo.' as const;

/**
 * Mapeamento opcional de colunas do CSV de importação.
 *
 * - `contactNumber`: nome (header) da coluna de Contact_Number. Quando omitido,
 *   a coluna é detectada por nomes comuns (`telefone`, `numero`, `whatsapp`, …).
 * - `recipientData`: mapeia uma chave de Recipient_Data (ex.: `nome`, `empresa`)
 *   para o nome (header) da coluna correspondente no CSV. Quando omitido, todas
 *   as colunas que não a de Contact_Number viram Recipient_Data, chaveadas pelo
 *   próprio header.
 */
export interface CsvColumnMap {
  /** Header da coluna de Contact_Number (sobrepõe a detecção automática). */
  contactNumber?: string;
  /** Chave de Recipient_Data → header da coluna no CSV. */
  recipientData?: Record<string, string>;
}

/** Recipient_Data extraído de uma linha do CSV (`{nome, empresa, ...}`). */
export type CsvRecipientData = Record<string, string>;

/** Um contato válido extraído do CSV (telefone E.164 + Recipient_Data). */
export interface CsvParsedContact {
  /** Telefone normalizado em E.164 (`+55DDDNNNNNNNN`). */
  phone: string;
  /** Recipient_Data das colunas mapeadas (pode ser vazio). */
  recipientData: CsvRecipientData;
}

/** Uma linha rejeitada na importação (reportada, nunca descartada em silêncio). */
export interface CsvInvalidRow {
  /** Número da linha no arquivo (1-based; a linha 1 é o cabeçalho). */
  line: number;
  /** Valor original da célula de Contact_Number (para exibição). */
  value: string;
  /** Motivo da rejeição, em pt-BR. */
  reason: string;
}

/** Resultado de {@link parseContactsCsv}: contatos, inválidos e o resumo. */
export interface ParseContactsCsvResult {
  /** Contatos válidos e deduplicados, na ordem de leitura. */
  contacts: CsvParsedContact[];
  /** Linhas rejeitadas (número da linha + motivo), Req 24.3. */
  invalidRows: CsvInvalidRow[];
  /** Total de linhas de dados lidas (exclui o cabeçalho e linhas em branco). */
  totalRead: number;
  /** Total importado com sucesso (= `contacts.length`). */
  importedCount: number;
  /** Total de linhas inválidas (= `invalidRows.length`). */
  invalidCount: number;
}

/** Motivos canônicos (pt-BR) de rejeição de linha na importação. */
const CSV_ROW_REASON = {
  MISSING: 'Número de telefone ausente.',
  INVALID: 'Número de telefone inválido.',
  DUPLICATE: 'Número duplicado.',
} as const;

/** Nomes (normalizados) de header reconhecidos como coluna de Contact_Number. */
const CONTACT_NUMBER_HEADER_CANDIDATES: ReadonlySet<string> = new Set<string>([
  'contactnumber',
  'contato',
  'contatos',
  'numero',
  'number',
  'telefone',
  'fone',
  'celular',
  'whatsapp',
  'phone',
]);

/**
 * Normaliza um header para comparação: minúsculas, sem acentos e somente
 * caracteres alfanuméricos (ex.: `"Número "` → `"numero"`).
 */
function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve o índice da coluna de Contact_Number no cabeçalho.
 * Retorna `-1` quando não há coluna mapeável (Req 24.4).
 */
function resolveContactColumn(header: string[], columnMap?: CsvColumnMap): number {
  if (columnMap?.contactNumber !== undefined) {
    const target = normalizeHeader(columnMap.contactNumber);
    return header.findIndex((h) => normalizeHeader(h) === target);
  }
  return header.findIndex((h) => CONTACT_NUMBER_HEADER_CANDIDATES.has(normalizeHeader(h)));
}

/**
 * Monta o mapa de colunas de Recipient_Data → índice no cabeçalho.
 *
 * Com `columnMap.recipientData`, mapeia apenas as chaves cujo header existe.
 * Sem ele, todas as colunas que não a de Contact_Number viram Recipient_Data,
 * chaveadas pelo header (trim), ignorando headers vazios.
 */
function resolveRecipientColumns(
  header: string[],
  contactColumn: number,
  columnMap?: CsvColumnMap
): Array<{ key: string; index: number }> {
  if (columnMap?.recipientData !== undefined) {
    const result: Array<{ key: string; index: number }> = [];
    for (const [key, headerName] of Object.entries(columnMap.recipientData)) {
      const target = normalizeHeader(headerName);
      const index = header.findIndex((h) => normalizeHeader(h) === target);
      if (index >= 0) result.push({ key, index });
    }
    return result;
  }

  const result: Array<{ key: string; index: number }> = [];
  header.forEach((h, index) => {
    if (index === contactColumn) return;
    const key = h.trim();
    if (key.length === 0) return;
    result.push({ key, index });
  });
  return result;
}

/**
 * Faz parse de um CSV de contatos e aplica as regras do Requirement 5.
 *
 * Fluxo (Req 24.1, 24.2, 24.3, 24.5):
 * 1. Faz parse com {@link parseCsv}. Texto vazio / sem coluna de Contact_Number
 *    detectável ⇒ lança a Canonical_Message
 *    `Não foi possível importar o arquivo.` (Req 24.4).
 * 2. Para cada linha de dados, lê o Contact_Number e normaliza/valida via
 *    `normalizeNumbers` (mesma lógica do Req 5: normalização, E.164, dedup).
 * 3. Linha com número ausente/inválido ⇒ reportada em `invalidRows` (número da
 *    linha + motivo), NUNCA descartada em silêncio. Número válido já visto ⇒
 *    reportado como duplicado (dedup do Req 5, sem reimportar).
 * 4. Linha válida e inédita ⇒ vira um `CsvParsedContact` com o Recipient_Data
 *    das colunas mapeadas.
 *
 * Função PURA: não realiza I/O.
 *
 * @param csvText   Conteúdo bruto do arquivo CSV (com ou sem BOM).
 * @param columnMap Mapeamento opcional de colunas (ver {@link CsvColumnMap}).
 * @returns `{ contacts, invalidRows, totalRead, importedCount, invalidCount }`.
 * @throws `WHATSAPP_CSV_IMPORT_ERROR_MESSAGE` quando o arquivo não é um CSV
 *         válido ou não contém a coluna de Contact_Number.
 */
export function parseContactsCsv(
  csvText: string,
  columnMap?: CsvColumnMap
): ParseContactsCsvResult {
  const rows = parseCsv(csvText);

  // (1) Sem cabeçalho => arquivo inválido (Req 24.4).
  if (rows.length === 0) {
    throw new Error(WHATSAPP_CSV_IMPORT_ERROR_MESSAGE);
  }

  const header = rows[0];
  const contactColumn = resolveContactColumn(header, columnMap);

  // Sem coluna de Contact_Number mapeável => arquivo inválido (Req 24.4).
  if (contactColumn < 0) {
    throw new Error(WHATSAPP_CSV_IMPORT_ERROR_MESSAGE);
  }

  const recipientColumns = resolveRecipientColumns(header, contactColumn, columnMap);

  const contacts: CsvParsedContact[] = [];
  const invalidRows: CsvInvalidRow[] = [];
  const seenPhones = new Set<string>();
  let totalRead = 0;

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const line = r + 1; // 1-based; a linha 1 é o cabeçalho.

    // Ignora linhas totalmente vazias (ex.: quebra de linha final do arquivo,
    // comum em CSVs exportados do Excel). Uma linha com telefone ausente mas
    // com algum outro dado preenchido NÃO é considerada vazia — ela é uma
    // linha inválida legítima (reportada abaixo), nunca descartada (Req 24.3).
    if (row.every((cell) => cell.trim() === '')) {
      continue;
    }
    totalRead += 1;

    const rawValue = row[contactColumn] ?? '';
    const value = rawValue.trim();

    if (value === '') {
      invalidRows.push({ line, value, reason: CSV_ROW_REASON.MISSING });
      continue;
    }

    // (2) Regras do Req 5 (normalização, E.164, validação) via normalizeNumbers.
    const { valid } = normalizeNumbers(value);
    const phone = valid[0];

    if (phone === undefined) {
      invalidRows.push({ line, value, reason: CSV_ROW_REASON.INVALID });
      continue;
    }

    // (3) Dedup do Req 5: número já visto não é reimportado, mas é reportado.
    if (seenPhones.has(phone)) {
      invalidRows.push({ line, value, reason: CSV_ROW_REASON.DUPLICATE });
      continue;
    }
    seenPhones.add(phone);

    // (4) Recipient_Data das colunas mapeadas (valores vazios são ignorados).
    const recipientData: CsvRecipientData = {};
    for (const { key, index } of recipientColumns) {
      const cell = (row[index] ?? '').trim();
      if (cell.length > 0) recipientData[key] = cell;
    }

    contacts.push({ phone, recipientData });
  }

  return {
    contacts,
    invalidRows,
    totalRead,
    importedCount: contacts.length,
    invalidCount: invalidRows.length,
  };
}

/* -------------------------------------------------------------------------- *
 * CSV_Export — geração pura de CSV de contatos e resultados (Req 24.6–24.8).  *
 *                                                                            *
 * Reusa `toCsv`/`csvEscape` (convenção herdada: BOM UTF-8, separador `;`,     *
 * escape RFC 4180, quebra `\r\n`, truncamento em 10000 linhas — P10).        *
 *                                                                            *
 * Funções PURAS (sem I/O): o chamador (RPC/serviço) é quem persiste o audit  *
 * com `truncated` e dispara o download. Distinto da Dispatch_Ready_List, que *
 * junta números por vírgula (Req 17.7) — aqui o separador é sempre `;`.       *
 *                                                                            *
 * _Requirements: 24.6, 24.7, 24.8_                                            *
 * -------------------------------------------------------------------------- */

/**
 * Resultado de uma operação de CSV_Export.
 *
 * - `csv`: conteúdo serializado (BOM + separador `;` + escape RFC 4180 + `\r\n`),
 *   já truncado em {@link CSV_MAX_ROWS} linhas quando aplicável.
 * - `truncated`: `true` quando o conteúdo original excedia {@link CSV_MAX_ROWS}
 *   linhas (incluindo o cabeçalho) e foi truncado — o chamador deve registrar
 *   `truncated: true` no audit (Req 24.7).
 * - `filename`: nome no formato `whatsapp_<YYYYMMDD>_<HHmm>.csv` (Req 24.8).
 */
export interface CsvExportResult {
  /** Conteúdo CSV pronto para download (com BOM, já truncado se necessário). */
  csv: string;
  /** `true` quando houve truncamento em {@link CSV_MAX_ROWS} linhas (Req 24.7). */
  truncated: boolean;
  /** Nome do arquivo `whatsapp_<YYYYMMDD>_<HHmm>.csv` (Req 24.8). */
  filename: string;
}

/** Cabeçalho da coluna de telefone no export de contatos. */
export const CSV_EXPORT_CONTACT_PHONE_HEADER = 'telefone';

/** Cabeçalho fixo do export de resultados de disparo. */
export const CSV_EXPORT_RESULT_HEADER = [
  'destino',
  'tipo',
  'status',
  'conteudo',
  'erro',
  'enviado_em',
] as const;

/**
 * Deriva o nome do arquivo de export no formato `whatsapp_<YYYYMMDD>_<HHmm>.csv`
 * (Req 24.8), em UTC — espelha a convenção herdada de `financeiro.ts`
 * (ordenação lexicográfica estável em listagens de download).
 *
 * @param date Momento de referência (default: agora).
 */
export function buildWhatsappCsvFilename(date: Date = new Date()): string {
  const iso = date.toISOString(); // ex.: 2024-01-15T12:34:56.789Z
  const yyyymmdd = iso.slice(0, 10).replace(/-/g, '');
  const hhmm = iso.slice(11, 16).replace(':', '');
  return `whatsapp_${yyyymmdd}_${hhmm}.csv`;
}

/**
 * Monta um {@link CsvExportResult} a partir de uma matriz de linhas
 * (a primeira linha é o cabeçalho).
 *
 * Calcula `truncated` ANTES da serialização (sobre o total de linhas, cabeçalho
 * incluído) e delega a `toCsv` o corte em {@link CSV_MAX_ROWS} (Req 24.6, 24.7).
 *
 * @param rows Matriz `header + linhas` já no formato de células string.
 * @param date Momento para o filename (default: agora).
 */
export function buildCsvExport(rows: string[][], date: Date = new Date()): CsvExportResult {
  return {
    csv: toCsv(rows),
    truncated: rows.length > CSV_MAX_ROWS,
    filename: buildWhatsappCsvFilename(date),
  };
}

/** Um contato a exportar (telefone E.164 + Recipient_Data opcional). */
export interface CsvExportContact {
  /** Telefone normalizado em E.164. */
  phone: string;
  /** Recipient_Data (`{nome, empresa, ...}`); chaves viram colunas extras. */
  recipientData?: CsvRecipientData;
}

/**
 * Exporta uma Contact_List para CSV (Req 24.6–24.8).
 *
 * O cabeçalho é `telefone` seguido da união determinística das chaves de
 * Recipient_Data (na ordem de primeira aparição). Cada contato vira uma linha;
 * chaves ausentes para um contato resultam em célula vazia.
 *
 * Função PURA: não realiza I/O nem persiste audit (cabe ao chamador, usando
 * `result.truncated`).
 *
 * @param contacts Contatos da Active_Instance a exportar (Req 24.10).
 * @param date     Momento para o filename (default: agora).
 */
export function exportContactsCsv(
  contacts: ReadonlyArray<CsvExportContact>,
  date: Date = new Date()
): CsvExportResult {
  // União determinística das chaves de Recipient_Data (ordem de 1ª aparição).
  const dataKeys: string[] = [];
  const seenKeys = new Set<string>();
  for (const contact of contacts) {
    for (const key of Object.keys(contact.recipientData ?? {})) {
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        dataKeys.push(key);
      }
    }
  }

  const rows: string[][] = [[CSV_EXPORT_CONTACT_PHONE_HEADER, ...dataKeys]];
  for (const contact of contacts) {
    const data = contact.recipientData ?? {};
    rows.push([contact.phone, ...dataKeys.map((key) => data[key] ?? '')]);
  }

  return buildCsvExport(rows, date);
}

/** Uma linha de resultado de disparo a exportar. */
export interface CsvExportDispatchResult {
  /** Destino: telefone (CONTACT) ou JID do grupo (GROUP). */
  target: string;
  /** Tipo do destino (`CONTACT` | `GROUP`); omitido vira célula vazia. */
  targetKind?: string;
  /** Status final do destinatário (`SENT` | `FAILED` | `SKIPPED` | …). */
  status: string;
  /** Rótulo do Content atribuído (título/posição); opcional. */
  contentLabel?: string;
  /** Motivo da falha, quando houver; opcional. */
  error?: string;
  /** Instante de envio (ISO 8601); opcional. */
  sentAt?: string;
}

/**
 * Exporta os resultados de um disparo para CSV (Req 24.6–24.8).
 *
 * Cabeçalho fixo {@link CSV_EXPORT_RESULT_HEADER}
 * (`destino;tipo;status;conteudo;erro;enviado_em`). Campos opcionais ausentes
 * viram célula vazia.
 *
 * Função PURA: não realiza I/O nem persiste audit (cabe ao chamador, usando
 * `result.truncated`).
 *
 * @param results Resultados por destinatário da Active_Instance (Req 24.10).
 * @param date    Momento para o filename (default: agora).
 */
export function exportDispatchResultsCsv(
  results: ReadonlyArray<CsvExportDispatchResult>,
  date: Date = new Date()
): CsvExportResult {
  const rows: string[][] = [[...CSV_EXPORT_RESULT_HEADER]];
  for (const result of results) {
    rows.push([
      result.target,
      result.targetKind ?? '',
      result.status,
      result.contentLabel ?? '',
      result.error ?? '',
      result.sentAt ?? '',
    ]);
  }

  return buildCsvExport(rows, date);
}
