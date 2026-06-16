/**
 * contacts.ts — Contact_List / Contact do WhatsApp_Module (camada de serviço).
 *
 * Envolve as RPCs `whatsapp_create_contact_list`, `whatsapp_list_contact_lists`
 * e `whatsapp_get_contacts` (migration 095), todas escopadas por `instance_id`
 * da Active_Instance (Req 2.5, 5.4, 5.6, 5.7).
 *
 * - `createContactList` é MUTAÇÃO: normaliza/valida os Contact_Numbers com
 *   `normalizeNumbers` (mesma lógica do frontend — Req 5.6) ANTES de persistir,
 *   bloqueia a lista válida vazia com a Canonical_Message
 *   `Informe ao menos um contato válido.` (Req 5.7) e persiste via
 *   `executeAdminMutation` (audit-by-construction com `instance_id`,
 *   admin-patterns #1). O backend ainda revalida o E.164 (defesa em profundidade).
 * - `listContactLists` / `getContacts` são LEITURAS: chamam a RPC diretamente
 *   (gating SETTINGS_VIEW no servidor) e nunca auditam.
 *
 * Erros são mapeados por `mapInstanceGuardError` (anti-enumeração canônica),
 * exceto o marker `WHATSAPP_EMPTY_CONTACT_LIST`, traduzido para a mensagem de
 * lista vazia — a mesma guarda usada pelo caminho de criação de disparo.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 *
 * _Requirements: 5.4, 5.6, 5.7, 2.5_
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError, type SupabaseLikeError } from './guards';
import { normalizeNumbers } from './validation';
import { parseContactsCsv, type CsvColumnMap, type ParseContactsCsvResult } from './csv';

/**
 * Canonical_Message (pt-BR) de Contact_List válida vazia ao iniciar um disparo
 * (Req 5.7). Exposta para reuso pelo caminho de criação de disparo (guarda
 * compartilhada) e pela UI.
 */
export const WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE = 'Informe ao menos um contato válido.' as const;

/**
 * Marker lançado pela RPC `whatsapp_create_contact_list` (ERRCODE `P0001`)
 * quando, após a revalidação server-side, não resta nenhum Contact_Number
 * válido. A camada TS o traduz para `WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE`.
 */
export const WHATSAPP_EMPTY_CONTACT_LIST_MARKER = 'WHATSAPP_EMPTY_CONTACT_LIST' as const;

/**
 * Dados arbitrários do destinatário (`{nome, empresa, ...}`) usados na
 * renderização de variáveis (Req 25). Mapeados por telefone E.164.
 */
export type RecipientData = Record<string, unknown>;

/** Resumo de uma Contact_List, como retornado pelas RPCs. */
export interface ContactListSummary {
  /** uuid da lista. */
  id: string;
  /** Nome da lista. */
  name: string;
  /** Quantidade de Contacts persistidos na lista. */
  contactCount: number;
  /** Timestamp de criação (ISO). */
  createdAt: string;
  /** Versão da linha para versionamento otimista (ISO). */
  updatedAt: string;
}

/** Um Contact persistido (telefone E.164 + Recipient_Data). */
export interface Contact {
  /** uuid do contato. */
  id: string;
  /** Telefone em E.164 normalizado (`+55DDDNNNNNNNN`). */
  phone: string;
  /** Recipient_Data associado (default `{}`). */
  recipientData: RecipientData;
}

/** Forma crua (snake_case) do resumo de lista retornado pela RPC de criação. */
interface RawContactListSummary {
  id: string;
  instance_id: string;
  name: string;
  contact_count: number;
  created_at: string;
  updated_at: string;
}

/** Forma crua (snake_case) de cada item da listagem de listas. */
interface RawContactListItem {
  id: string;
  name: string;
  contact_count: number;
  created_at: string;
  updated_at: string;
}

/** Forma crua (snake_case) de cada Contact retornado pela RPC. */
interface RawContact {
  id: string;
  phone: string;
  recipient_data: RecipientData | null;
}

/** Converte o resumo cru de lista para o shape camelCase da camada de serviço. */
function mapListSummary(row: RawContactListSummary | RawContactListItem): ContactListSummary {
  return {
    id: row.id,
    name: row.name,
    contactCount: row.contact_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Converte um Contact cru para o shape camelCase da camada de serviço. */
function mapContact(row: RawContact): Contact {
  return {
    id: row.id,
    phone: row.phone,
    recipientData: row.recipient_data ?? {},
  };
}

/**
 * Reconhece o marker de lista válida vazia da RPC (`WHATSAPP_EMPTY_CONTACT_LIST`)
 * em qualquer campo de mensagem do erro retornado pelo PostgREST/Supabase.
 */
function isEmptyContactListError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const err = error as SupabaseLikeError;
  return [err.message, err.details, err.hint]
    .filter((v): v is string => typeof v === 'string')
    .some((text) => text.includes(WHATSAPP_EMPTY_CONTACT_LIST_MARKER));
}

/**
 * Mapeia um erro de RPC de contatos para a mensagem user-facing apropriada:
 * lista vazia => Canonical_Message de lista vazia; demais => anti-enumeração.
 */
function mapContactsError(error: unknown): string {
  if (isEmptyContactListError(error)) {
    return WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE;
  }
  return mapInstanceGuardError(error);
}

/** Payload de um contato enviado à RPC (telefone E.164 + recipient_data). */
interface ContactPayload {
  phone: string;
  recipient_data: RecipientData;
}

/**
 * Cria uma Contact_List da Active_Instance a partir de texto bruto de
 * Contact_Numbers (colado/importado), persistindo-a com o `instance_id`.
 *
 * Fluxo (Req 5.6, 5.7):
 * 1. Normaliza/valida com `normalizeNumbers` (mesma lógica do frontend):
 *    aceita separação por vírgula/quebra de linha, normaliza, deduplica e
 *    valida E.164.
 * 2. Bloqueia a lista válida vazia ANTES de chamar o backend, lançando a
 *    Canonical_Message `Informe ao menos um contato válido.`.
 * 3. Anexa o Recipient_Data por telefone (quando fornecido, ex.: CSV) e persiste
 *    via RPC, dentro de `executeAdminMutation` (audit com `instance_id`).
 *
 * @param instanceId           Active_Instance alvo.
 * @param name                 Nome da Contact_List.
 * @param rawNumbers           Texto bruto com os Contact_Numbers.
 * @param recipientDataByPhone Recipient_Data opcional, indexado por E.164.
 * @returns Resumo da lista criada (id, nome, contagem, updated_at).
 * @throws `WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE` se não há contato válido;
 *         mensagem anti-enumeração mapeada para os demais erros.
 */
export async function createContactList(
  instanceId: string,
  name: string,
  rawNumbers: string,
  recipientDataByPhone?: Record<string, RecipientData>
): Promise<ContactListSummary> {
  // (1) Normalização/validação no frontend (espelhada no backend — Req 5.6).
  const { valid } = normalizeNumbers(rawNumbers);

  // (2) Guarda de lista válida vazia (Req 5.7) — bloqueia antes do backend.
  if (valid.length === 0) {
    throw new Error(WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE);
  }

  // (3) Monta o payload em E.164, anexando Recipient_Data quando disponível.
  const contacts: ContactPayload[] = valid.map((phone) => ({
    phone,
    recipient_data: recipientDataByPhone?.[phone] ?? {},
  }));

  return executeAdminMutation(
    {
      action: 'WHATSAPP_CONTACT_LIST_CREATE',
      targetType: 'whatsapp_contact_lists',
      targetId: instanceId,
      before: null,
      after: { instance_id: instanceId, name, valid_count: contacts.length },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_create_contact_list', {
        p_instance_id: instanceId,
        p_name: name,
        p_contacts: contacts,
      });
      if (error) {
        throw new Error(mapContactsError(error));
      }
      return mapListSummary(data as RawContactListSummary);
    }
  );
}

/**
 * Lista as Contact_Lists da Active_Instance (com a contagem de Contacts),
 * ordenadas das mais recentes para as mais antigas. LEITURA — não audita.
 *
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function listContactLists(instanceId: string): Promise<ContactListSummary[]> {
  const { data, error } = await supabase.rpc('whatsapp_list_contact_lists', {
    p_instance_id: instanceId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const rows = (data ?? []) as RawContactListItem[];
  return rows.map(mapListSummary);
}

/**
 * Lê os Contacts de uma Contact_List da Active_Instance. A lista precisa
 * pertencer à instância (lista cruzada/inexistente => anti-enumeração).
 * LEITURA — não audita.
 *
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function getContacts(instanceId: string, listId: string): Promise<Contact[]> {
  const { data, error } = await supabase.rpc('whatsapp_get_contacts', {
    p_instance_id: instanceId,
    p_list_id: listId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const rows = (data ?? []) as RawContact[];
  return rows.map(mapContact);
}

/** Resultado de {@link importContactsFromCsv}: lista criada + resumo da importação. */
export interface ImportContactsFromCsvResult {
  /** Resumo da Contact_List persistida (id, nome, contagem, updated_at). */
  list: ContactListSummary;
  /** Resumo do parse (lidos/importados/inválidos + linhas inválidas). */
  report: ParseContactsCsvResult;
}

/**
 * Importa uma Contact_List da Active_Instance a partir do conteúdo de um CSV
 * (CSV_Import — Req 24.1, 24.2, 24.9, 24.10).
 *
 * Fluxo:
 * 1. Faz parse puro via {@link parseContactsCsv} (regras do Req 5: normalização,
 *    E.164, dedup; linhas inválidas reportadas — Req 24.3 — sem descarte
 *    silencioso). Arquivo inválido / sem coluna de Contact_Number ⇒ lança
 *    `Não foi possível importar o arquivo.` (Req 24.4).
 * 2. Persiste reusando {@link createContactList} (RPC `whatsapp_create_contact_list`),
 *    que revalida a lista no backend antes de gravar (validação front+back —
 *    Req 24.9) e anexa o Recipient_Data por telefone (Req 24.1, 25.3).
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo — Req 24.10).
 * @param name       Nome da Contact_List.
 * @param csvText    Conteúdo bruto do arquivo CSV.
 * @param columnMap  Mapeamento opcional de colunas (Contact_Number / Recipient_Data).
 * @returns `{ list, report }` com o resumo da lista e o relatório da importação.
 * @throws `WHATSAPP_CSV_IMPORT_ERROR_MESSAGE` para arquivo inválido;
 *         `WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE` se não há contato válido.
 */
export async function importContactsFromCsv(
  instanceId: string,
  name: string,
  csvText: string,
  columnMap?: CsvColumnMap
): Promise<ImportContactsFromCsvResult> {
  // (1) Parse puro + relatório (lança para arquivo inválido — Req 24.4).
  const report = parseContactsCsv(csvText, columnMap);

  // (2) Monta o texto de números + Recipient_Data por telefone (E.164) e
  //     persiste reusando createContactList (revalidação backend — Req 24.9).
  const rawNumbers = report.contacts.map((contact) => contact.phone).join('\n');
  const recipientDataByPhone: Record<string, RecipientData> = {};
  for (const contact of report.contacts) {
    recipientDataByPhone[contact.phone] = contact.recipientData;
  }

  const list = await createContactList(instanceId, name, rawNumbers, recipientDataByPhone);

  return { list, report };
}
