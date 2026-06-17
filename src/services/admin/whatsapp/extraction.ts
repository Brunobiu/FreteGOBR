/**
 * Camada de serviço da Contact_Extraction (Extrator de Contatos — Req 17).
 *
 * Espelha o estilo de `dispatch.ts`: orquestra a operação com I/O (proxy
 * Evolution + RPC) e delega a lógica PURA (dedup / Dispatch_Ready_List) ao
 * módulo `extractor.ts` (não duplicada aqui). A persistência dos
 * Extracted_Contacts é feita pela RPC `whatsapp_record_extraction` (migration
 * 110), SEMPRE escopada por `instance_id` (Req 17.15) e auditada por construção
 * via `executeAdminMutation` (admin-patterns §1) com o `instance_id` e o número
 * de grupos analisados (Req 17.16).
 *
 * ## Fluxo (Req 17.4, 17.11, 17.12, 17.13)
 *
 * 1. **Seleção vazia (Req 17.11):** sem nenhum WhatsApp_Group selecionado, a
 *    operação é BLOQUEADA antes de qualquer I/O com a Canonical_Message
 *    `Selecione ao menos um grupo.`
 * 2. **Extração em lotes com degradação parcial (Req 17.4, 17.12):** os grupos
 *    selecionados são processados em LOTES de concorrência limitada via
 *    `Promise.allSettled`. Cada grupo é consultado isoladamente no proxy
 *    Evolution (`listParticipants`); um grupo que falha é SINALIZADO em
 *    `failedGroups` SEM abortar a extração inteira — os participantes dos grupos
 *    bem-sucedidos são preservados.
 * 3. **Indisponibilidade TOTAL (Req 17.13):** se TODOS os grupos falham (proxy
 *    indisponível/erro em toda a extração), lança a Canonical_Message
 *    anti-enumeração `Não foi possível concluir a operação.` sem expor detalhes
 *    internos.
 * 4. **Persistência + auditoria (Req 17.16):** o conjunto de Contact_Numbers dos
 *    grupos bem-sucedidos é gravado sob um único `extraction_id` pela RPC,
 *    dentro de `executeAdminMutation`, registrando o `instance_id` e a
 *    quantidade de grupos analisados no log de auditoria.
 *
 * A operação atua EXCLUSIVAMENTE sobre os grupos/sessão da Active_Instance: o
 * proxy Evolution exige a WhatsApp_Session `CONNECTED` da própria instância e a
 * RPC revalida a instância (anti-enumeração `WHATSAPP_NOT_FOUND`). A
 * deduplicação fina / estatísticas / Dispatch_Ready_List pertencem à task 18.2
 * (`extractor.ts`); aqui persiste-se o bruto dos grupos bem-sucedidos.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR; segredos nunca
 * trafegam por aqui (a Evolution_Api_Key é lida no Vault DENTRO do proxy).
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError, WHATSAPP_CANONICAL_OPERATION_FAILED } from './guards';

/**
 * Canonical_Message (pt-BR) de seleção vazia (Req 17.11). Exibida quando a
 * extração é acionada sem nenhum WhatsApp_Group selecionado.
 */
export const WHATSAPP_NO_GROUPS_SELECTED_MESSAGE = 'Selecione ao menos um grupo.' as const;

/**
 * Tamanho do lote de grupos processados em paralelo por vez (Req 17.4, 17.14).
 * Mantém a concorrência limitada — espelha o `PARTICIPANTS_BATCH_SIZE` do proxy
 * Evolution — evitando saturar a Evolution_API em extrações com muitos grupos.
 */
const EXTRACTION_BATCH_SIZE = 5;

/** Nome da Edge Function que faz o proxy autenticado à Evolution_API. */
const EVOLUTION_PROXY_FUNCTION = 'whatsapp-evolution-proxy';

/**
 * Contato extraído (camelCase) de um WhatsApp_Group: o Contact_Number e o JID
 * do grupo de origem (para a deduplicação entre grupos da task 18.2).
 */
export interface ExtractedContact {
  /** Contact_Number bruto retornado pelo proxy (dígitos). */
  phone: string;
  /** JID do WhatsApp_Group de origem (`<id>@g.us`). */
  sourceGroupJid: string;
}

/**
 * Resultado de uma Contact_Extraction concluída (com possível degradação
 * parcial). Carrega o `extractionId` gerado pela RPC, os contadores e a
 * sinalização de quais grupos foram bem-sucedidos vs. falharam (Req 17.12).
 */
export interface ExtractionResult {
  /** Identificador único da Contact_Extraction (gerado pela RPC). */
  extractionId: string;
  /** Active_Instance sobre a qual a extração operou. */
  instanceId: string;
  /** Total de Contact_Numbers persistidos pela RPC (linhas com phone). */
  totalCount: number;
  /** Quantidade de WhatsApp_Groups selecionados/analisados (Req 17.16). */
  analyzedGroups: number;
  /** JIDs dos grupos extraídos com sucesso. */
  succeededGroups: string[];
  /** JIDs dos grupos que falharam (degradação parcial, Req 17.12). */
  failedGroups: string[];
  /** Contatos brutos dos grupos bem-sucedidos (phone + grupo de origem). */
  contacts: ExtractedContact[];
  /** Instante do registro (ISO) retornado pela RPC. */
  recordedAt: string;
}

/** Forma crua (snake_case) da resposta da RPC `whatsapp_record_extraction`. */
interface RawRecordExtraction {
  extraction_id: string;
  instance_id: string;
  total_count: number;
  recorded_at: string;
}

/** Item do payload `p_contacts` enviado à RPC (snake_case, persistido bruto). */
interface RawExtractedContact {
  phone: string;
  source_group_jid: string;
}

/**
 * Forma (parcial) da resposta do proxy Evolution para `listParticipants`.
 * Sucesso: `{ ok: true, participants: string[], failedGroups: string[] }`.
 * Falha estruturada: `{ ok: false, code, message }` (sessão não conectada,
 * Evolution indisponível, instância inexistente/cruzada).
 */
interface ProxyListParticipantsResponse {
  ok?: boolean;
  status?: string;
  participants?: unknown;
  failedGroups?: unknown;
  code?: string;
  message?: string;
}

/**
 * Consulta os participantes de UM WhatsApp_Group no proxy Evolution
 * (`listParticipants`), escopado por `instance_id` (a sessão/segredo são
 * resolvidos server-side). Lança em qualquer falha — de invocação ou
 * estruturada (`ok !== true`) — para que o chamador a registre como grupo
 * falho (degradação parcial, Req 17.12), nunca expondo detalhes internos.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo, Req 17.15).
 * @param groupJid   JID do grupo a extrair (`<id>@g.us`).
 * @returns Lista de Contact_Numbers (dígitos) dos participantes do grupo.
 * @throws Error quando a extração do grupo falha (rede/sessão/Evolution).
 */
async function fetchGroupParticipants(instanceId: string, groupJid: string): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke(EVOLUTION_PROXY_FUNCTION, {
    body: { action: 'listParticipants', instanceId, groupJids: [groupJid] },
  });

  // Erro de invocação (non-2xx / rede) ⇒ grupo falho (sinalizado pelo chamador).
  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const body = (data ?? null) as ProxyListParticipantsResponse | null;

  // Falha estruturada no corpo (sessão não conectada / Evolution indisponível /
  // instância inexistente): trata como grupo falho, sem propagar detalhes.
  if (!body || body.ok !== true) {
    throw new Error(body?.code ?? 'EVOLUTION_UNAVAILABLE');
  }

  return Array.isArray(body.participants)
    ? body.participants.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
}

/**
 * Higieniza a seleção de grupos: descarta valores não-string/vazios e remove
 * duplicatas preservando a ordem da primeira ocorrência.
 */
function sanitizeGroupJids(groupJids: readonly string[] | null | undefined): string[] {
  if (!groupJids || groupJids.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const jid of groupJids) {
    if (typeof jid !== 'string') continue;
    const trimmed = jid.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Executa uma Contact_Extraction sobre os WhatsApp_Groups selecionados da
 * Active_Instance (Req 17.4): extrai os participantes em lotes com degradação
 * parcial (Req 17.12), persiste os Contact_Numbers dos grupos bem-sucedidos via
 * RPC `whatsapp_record_extraction` e registra o audit com `instance_id` e nº de
 * grupos analisados (Req 17.16).
 *
 * Regras de borda:
 * - Seleção vazia (Req 17.11) ⇒ lança `Selecione ao menos um grupo.` ANTES de
 *   qualquer I/O.
 * - Indisponibilidade TOTAL — todos os grupos falham (Req 17.13) ⇒ lança a
 *   Canonical_Message anti-enumeração `Não foi possível concluir a operação.`
 * - `WHATSAPP_NOT_FOUND` da RPC (instância inexistente/cruzada) ⇒ mesma
 *   Canonical_Message anti-enumeração (via `guards.ts`).
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo, Req 17.15).
 * @param groupJids  JIDs dos WhatsApp_Groups selecionados.
 * @returns `ExtractionResult` com o `extractionId`, contadores e os grupos
 *          bem-sucedidos/falhos (degradação parcial sinalizada).
 * @throws Error com Canonical_Message pt-BR em seleção vazia, indisponibilidade
 *         total ou anti-enumeração.
 */
export async function extractContacts(
  instanceId: string,
  groupJids: readonly string[]
): Promise<ExtractionResult> {
  // (1) Guarda de seleção vazia (Req 17.11) — bloqueia antes de qualquer I/O.
  const jids = sanitizeGroupJids(groupJids);
  if (jids.length === 0) {
    throw new Error(WHATSAPP_NO_GROUPS_SELECTED_MESSAGE);
  }

  // (2) Extração em lotes com degradação parcial (Req 17.4, 17.12): cada lote
  //     resolve em paralelo via Promise.allSettled; grupos que falham vão para
  //     `failedGroups` sem abortar — os demais seguem normalmente.
  const contacts: ExtractedContact[] = [];
  const succeededGroups: string[] = [];
  const failedGroups: string[] = [];

  for (let i = 0; i < jids.length; i += EXTRACTION_BATCH_SIZE) {
    const batch = jids.slice(i, i + EXTRACTION_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((jid) => fetchGroupParticipants(instanceId, jid))
    );

    settled.forEach((outcome, idx) => {
      const jid = batch[idx];
      if (outcome.status === 'fulfilled') {
        succeededGroups.push(jid);
        for (const phone of outcome.value) {
          contacts.push({ phone, sourceGroupJid: jid });
        }
      } else {
        // Degradação parcial: sinaliza o grupo falho e prossegue (Req 17.12).
        failedGroups.push(jid);
      }
    });
  }

  // (3) Indisponibilidade TOTAL (Req 17.13): todos os grupos falharam ⇒
  //     Canonical_Message anti-enumeração, sem expor detalhes internos.
  if (failedGroups.length === jids.length) {
    throw new Error(WHATSAPP_CANONICAL_OPERATION_FAILED);
  }

  // (4) Persiste os contatos brutos dos grupos bem-sucedidos sob um único
  //     extraction_id (RPC), auditado por construção com o instance_id e o nº
  //     de grupos analisados (Req 17.16, admin-patterns §1).
  const payload: RawExtractedContact[] = contacts.map((c) => ({
    phone: c.phone,
    source_group_jid: c.sourceGroupJid,
  }));

  return executeAdminMutation(
    {
      action: 'WHATSAPP_EXTRACTION_RECORD',
      targetType: 'whatsapp_extracted_contacts',
      targetId: instanceId,
      before: null,
      // Registra sempre o instance_id e a quantidade de grupos (Req 17.16);
      // nenhum conteúdo sensível além do necessário.
      after: {
        instance_id: instanceId,
        analyzed_groups: jids.length,
        succeeded_groups: succeededGroups.length,
        failed_groups: failedGroups.length,
        contact_count: contacts.length,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_record_extraction', {
        p_instance_id: instanceId,
        p_contacts: payload,
      });
      if (error) {
        throw new Error(mapInstanceGuardError(error));
      }

      const raw = data as RawRecordExtraction;
      return {
        extractionId: raw.extraction_id,
        instanceId: raw.instance_id,
        totalCount: raw.total_count,
        analyzedGroups: jids.length,
        succeededGroups,
        failedGroups,
        contacts,
        recordedAt: raw.recorded_at,
      };
    }
  );
}
