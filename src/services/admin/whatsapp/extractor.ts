/**
 * Contact Extractor — lógica pura (sem I/O) do WhatsApp_Module (Req 17).
 *
 * Este arquivo concentra a lógica determinística do Extrator de Contatos
 * (Req 17.5–17.10, 17.15), toda PURA (sem I/O), operando exclusivamente sobre
 * os dados dos WhatsApp_Groups/WhatsApp_Session da Active_Instance fornecidos
 * por parâmetro (a parte de RPC/proxy/persistência fica em `extraction.ts`):
 *
 *  - **Dispatch_Ready_List** (Req 17.6, 17.9, 17.10): string de Contact_Numbers
 *    únicos e válidos, separados por vírgula e SEM espaços, pronta para colar no
 *    Disparo em Massa (`buildDispatchReadyList` / `dedupValidNumbers`).
 *  - **Estatísticas da extração** (Req 17.8): total de contatos encontrados,
 *    total de contatos únicos (após deduplicação, excluindo inválidos) e número
 *    de grupos analisados (`computeExtractionStats`).
 *  - **Deduplicação OPCIONAL entre grupos** (Req 17.9): quando o mesmo
 *    Contact_Number aparece em múltiplos WhatsApp_Groups, a flag remove os
 *    duplicados entre grupos; quando desligada, preserva. É IDEMPOTENTE
 *    (`dedupContactsAcrossGroups`).
 *  - **Exportação CSV** (Req 17.7) DISTINTA da Dispatch_Ready_List separada por
 *    vírgula: reusa o helper de CSV do projeto (`csv.ts` — BOM UTF-8, separador
 *    `;`, escape RFC 4180, quebra `\r\n`, truncamento em 10000 linhas)
 *    (`buildExtractedContactsCsv`).
 *
 * A validação NÃO é reimplementada aqui: reusa `normalizeNumbers` de
 * `validation.ts`, que já normaliza (E.164), deduplica e separa válidos de
 * inválidos. Como a saída do extrator é para colar no Disparo em Massa, os
 * números são emitidos em dígitos (E.164 sem o `+`), ex.: `5511999999999`.
 *
 * Funções PURAS: não realizam I/O e não lançam exceções.
 *
 * Identifiers em inglês; comentários em pt-BR (convenção FreteGO).
 */

import { normalizeNumbers } from './validation';
import { buildCsvExport, CSV_EXPORT_CONTACT_PHONE_HEADER, type CsvExportResult } from './csv';

/** Separador da Dispatch_Ready_List: vírgula SEM espaços (Req 17.6). */
const DISPATCH_READY_SEPARATOR = ',';

/** Código de país do Brasil; removido do prefixo E.164 para emitir dígitos. */
const BR_COUNTRY_CODE = '55';

/**
 * Deduplica e mantém apenas os Contact_Numbers válidos de uma extração,
 * em dígitos (E.164 sem o `+`), preservando a ordem da primeira ocorrência.
 *
 * Regras (Req 17.9, 17.10):
 * - Números inválidos são EXCLUÍDOS (não entram no resultado).
 * - Duplicatas (após normalização) são removidas.
 * - A operação é IDEMPOTENTE: como os valores de saída já estão normalizados,
 *   aplicar a função sobre o próprio resultado produz o mesmo resultado
 *   (`dedupValidNumbers(dedupValidNumbers(x)) === dedupValidNumbers(x)`).
 *
 * @param numbers Lista bruta de Contact_Numbers (pode conter repetidos/inválidos).
 * @returns Números válidos, únicos, em dígitos, na ordem de primeira ocorrência.
 */
export function dedupValidNumbers(numbers: readonly string[]): string[] {
  if (!numbers || numbers.length === 0) return [];

  // Reaproveita toda a lógica de normalização/dedup/validação de validation.ts.
  // Junta por quebra de linha (separador aceito por normalizeNumbers) para
  // tratar cada item como um token independente.
  const raw = numbers.join('\n');
  const { valid } = normalizeNumbers(raw);

  // `valid` vem em E.164 (`+55...`) já deduplicado; emite em dígitos puros.
  return valid.map(toDigits);
}

/**
 * Constrói a Dispatch_Ready_List: números válidos e únicos juntados por vírgula
 * SEM espaços (Req 17.6), prontos para colar no Disparo em Massa.
 *
 * Ex.: `['+5511999999999', '5511888888888', '11999999999']`
 *      → `'5511999999999,5511888888888'`
 *
 * @param numbers Lista bruta de Contact_Numbers.
 * @returns String comma-joined sem espaços (vazia se não houver válidos).
 */
export function buildDispatchReadyList(numbers: readonly string[]): string {
  return dedupValidNumbers(numbers).join(DISPATCH_READY_SEPARATOR);
}

/** Remove o prefixo `+55` do formato E.164, retornando apenas dígitos. */
function toDigits(e164: string): string {
  const withoutPlus = e164.startsWith('+') ? e164.slice(1) : e164;
  return withoutPlus.startsWith(BR_COUNTRY_CODE) ? withoutPlus : `${BR_COUNTRY_CODE}${withoutPlus}`;
}

/* -------------------------------------------------------------------------- *
 * Estatísticas, dedup opcional entre grupos e CSV (Req 17.5, 17.7, 17.8,      *
 * 17.9, 17.15).                                                               *
 *                                                                            *
 * Tudo PURO (sem I/O): opera apenas sobre os Contact_Numbers já extraídos dos *
 * WhatsApp_Groups da Active_Instance, recebidos por parâmetro. A entrada      *
 * espelha estruturalmente o `ExtractedContact` de `extraction.ts` (phone +    *
 * grupo de origem), porém este módulo NÃO importa a camada de serviço (mantém *
 * a pureza e evita dependência reversa lógica-pura → I/O).                    *
 * -------------------------------------------------------------------------- */

/**
 * Um Contact_Number extraído de um WhatsApp_Group (entrada pura do extrator).
 *
 * Estruturalmente compatível com `ExtractedContact` de `extraction.ts`, de modo
 * que o resultado bruto da extração pode ser passado diretamente às funções
 * deste módulo.
 */
export interface ExtractedGroupContact {
  /** Contact_Number bruto do participante (qualquer formato/máscara). */
  phone: string;
  /** JID do WhatsApp_Group de origem (`<id>@g.us`). */
  sourceGroupJid: string;
}

/**
 * Estatísticas de uma Contact_Extraction (Req 17.8).
 *
 * Invariante: `uniqueContacts <= totalContacts` (o conjunto único de válidos é
 * sempre um subconjunto dos contatos encontrados).
 */
export interface ExtractionStats {
  /** Total de Contact_Numbers encontrados (bruto: inclui duplicados/inválidos). */
  totalContacts: number;
  /** Total de Contact_Numbers únicos e VÁLIDOS, após deduplicação (Req 17.10). */
  uniqueContacts: number;
  /** Número de WhatsApp_Groups analisados (Req 17.8). */
  analyzedGroups: number;
}

/**
 * Deriva uma chave de deduplicação estável para um Contact_Number bruto.
 *
 * Números VÁLIDOS colapsam para sua forma canônica em dígitos (E.164 BR sem
 * `+`), de modo que `11999998888` e `5511999998888` compartilham a mesma chave.
 * Números INVÁLIDOS usam o texto após trim como chave (preservando o token para
 * exibição, sem nunca se confundirem com válidos).
 */
function dedupKey(phone: string): string {
  const { valid } = normalizeNumbers(phone);
  if (valid.length > 0) {
    // `valid[0]` vem em `+55...`; remove o `+` para a forma em dígitos.
    return valid[0].slice(1);
  }
  return phone.trim();
}

/**
 * Conta os WhatsApp_Groups distintos presentes em uma lista de contatos
 * extraídos, pela identidade do `sourceGroupJid`.
 */
function countDistinctGroups(contacts: readonly ExtractedGroupContact[]): number {
  const groups = new Set<string>();
  for (const contact of contacts) {
    groups.add(contact.sourceGroupJid);
  }
  return groups.size;
}

/**
 * Calcula as estatísticas de uma Contact_Extraction (Req 17.8):
 *
 * - `totalContacts`: total bruto de Contact_Numbers encontrados (todas as
 *   ocorrências, incluindo duplicados entre grupos e inválidos).
 * - `uniqueContacts`: total de Contact_Numbers únicos e VÁLIDOS após
 *   deduplicação — inválidos são EXCLUÍDOS (Req 17.10).
 * - `analyzedGroups`: número de WhatsApp_Groups analisados. Quando informado em
 *   `analyzedGroups`, prevalece (ex.: a camada de serviço conta também grupos
 *   bem-sucedidos sem participantes); caso contrário, é derivado dos grupos
 *   distintos presentes nos contatos.
 *
 * Função PURA. Garante a invariante `uniqueContacts <= totalContacts`.
 *
 * @param contacts       Contact_Numbers extraídos (phone + grupo de origem).
 * @param analyzedGroups Override opcional do número de grupos analisados.
 */
export function computeExtractionStats(
  contacts: readonly ExtractedGroupContact[],
  analyzedGroups?: number
): ExtractionStats {
  const safe = contacts ?? [];
  const uniqueValid = dedupValidNumbers(safe.map((c) => c.phone));

  const groups =
    typeof analyzedGroups === 'number' && Number.isFinite(analyzedGroups) && analyzedGroups >= 0
      ? Math.floor(analyzedGroups)
      : countDistinctGroups(safe);

  return {
    totalContacts: safe.length,
    uniqueContacts: uniqueValid.length,
    analyzedGroups: groups,
  };
}

/**
 * Deduplicação OPCIONAL de Extracted_Contacts entre WhatsApp_Groups (Req 17.9).
 *
 * - `enabled = true`: quando o mesmo Contact_Number aparece em múltiplos grupos,
 *   mantém apenas a PRIMEIRA ocorrência (preservando a ordem de leitura),
 *   produzindo um conjunto sem repetições entre grupos.
 * - `enabled = false`: PRESERVA a lista como está (duplicados entre grupos são
 *   mantidos), apenas retornando uma cópia (não muta a entrada).
 *
 * IDEMPOTENTE em ambos os modos: aplicar a função sobre o próprio resultado
 * produz o mesmo resultado (`f(f(x)) === f(x)`), pois após a primeira passagem
 * com dedup ligada todas as chaves já são únicas.
 *
 * Não filtra inválidos (a exclusão de inválidos é responsabilidade da
 * Dispatch_Ready_List e das estatísticas de únicos — Req 17.10).
 *
 * @param contacts Contact_Numbers extraídos (phone + grupo de origem).
 * @param enabled  Liga/desliga a remoção de duplicados entre grupos.
 */
export function dedupContactsAcrossGroups(
  contacts: readonly ExtractedGroupContact[],
  enabled: boolean
): ExtractedGroupContact[] {
  const safe = contacts ?? [];
  if (!enabled) {
    // Preserva tudo (cópia rasa, sem mutar a entrada).
    return safe.map((c) => ({ phone: c.phone, sourceGroupJid: c.sourceGroupJid }));
  }

  const seen = new Set<string>();
  const out: ExtractedGroupContact[] = [];
  for (const contact of safe) {
    const key = dedupKey(contact.phone);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ phone: contact.phone, sourceGroupJid: contact.sourceGroupJid });
  }
  return out;
}

/** Cabeçalho da coluna de grupo de origem no CSV de contatos extraídos. */
export const CSV_EXTRACTOR_GROUP_HEADER = 'grupo_origem';

/** Opções da exportação CSV de contatos extraídos. */
export interface ExtractedContactsCsvOptions {
  /**
   * Quando `true`, remove duplicados do mesmo Contact_Number entre grupos antes
   * de gerar o CSV (Req 17.9). Default `false` (preserva por grupo de origem).
   */
  dedupAcrossGroups?: boolean;
  /** Momento de referência para o filename (`whatsapp_<YYYYMMDD>_<HHmm>.csv`). */
  date?: Date;
}

/**
 * Gera a exportação CSV dos Contact_Numbers extraídos (Req 17.7), DISTINTA da
 * Dispatch_Ready_List separada por vírgula: reusa o helper de CSV do projeto
 * (`buildCsvExport`/`toCsv` — BOM UTF-8, separador `;`, escape RFC 4180, quebra
 * `\r\n`, truncamento em 10000 linhas, filename `whatsapp_<YYYYMMDD>_<HHmm>.csv`).
 *
 * Apenas Contact_Numbers VÁLIDOS são exportados, em dígitos (E.164 BR sem `+`),
 * acompanhados do JID do grupo de origem. Inválidos são EXCLUÍDOS (Req 17.10).
 * A flag `dedupAcrossGroups` aplica a deduplicação entre grupos (Req 17.9).
 *
 * Função PURA: não realiza I/O nem dispara o download (cabe ao chamador, usando
 * `result.truncated` para o audit).
 *
 * @param contacts Contact_Numbers extraídos (phone + grupo de origem).
 * @param options  Dedup entre grupos e momento do filename.
 */
export function buildExtractedContactsCsv(
  contacts: readonly ExtractedGroupContact[],
  options?: ExtractedContactsCsvOptions
): CsvExportResult {
  const safe = contacts ?? [];

  // Mantém apenas válidos, já em dígitos, preservando o grupo de origem.
  const validContacts: ExtractedGroupContact[] = [];
  for (const contact of safe) {
    const { valid } = normalizeNumbers(contact.phone);
    if (valid.length === 0) continue;
    validContacts.push({ phone: valid[0].slice(1), sourceGroupJid: contact.sourceGroupJid });
  }

  const rows: ExtractedGroupContact[] = options?.dedupAcrossGroups
    ? dedupContactsAcrossGroups(validContacts, true)
    : validContacts;

  const matrix: string[][] = [[CSV_EXPORT_CONTACT_PHONE_HEADER, CSV_EXTRACTOR_GROUP_HEADER]];
  for (const contact of rows) {
    matrix.push([contact.phone, contact.sourceGroupJid]);
  }

  return buildCsvExport(matrix, options?.date);
}
