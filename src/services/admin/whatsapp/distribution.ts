/**
 * Distribuição de conteúdos entre destinatários (Req 7) — lógica PURA, sem I/O.
 *
 * Alvo de property test (Property 5, tarefa 2.4). Atribui **exatamente um**
 * `Content` a cada `Recipient` da Contact_List, na ordem registrada dos contents
 * (`position`) e na ordem determinística dos destinatários (`seq`).
 *
 * Modos (Distribution_Mode):
 * - `INTERLEAVED` (Req 7.3): rodízio — o i-ésimo recipient recebe
 *   `contents[i mod M]`.
 * - `BLOCK` (Req 7.2, 7.5): blocos sequenciais de tamanho `blockSize` — o i-ésimo
 *   recipient recebe `contents[floor(i / blockSize) mod M]`; quando os contatos
 *   excedem a soma dos blocos, a sequência de contents reinicia do primeiro.
 *
 * A função é total: dado `contents.length = M >= 1`, todo recipient recebe
 * exatamente um content válido (índice sempre `mod M`).
 */

/** Modo de distribuição de Contents entre os contatos (Req 7.1). */
export type DistributionMode = 'BLOCK' | 'INTERLEAVED';

/**
 * Destinatário do disparo. Apenas o identificador é necessário para a atribuição;
 * a ordem usada é a ordem do array recebido (já ordenado por `seq` pelo chamador).
 */
export interface Recipient {
  /** Identificador estável do destinatário (ex.: id do dispatch_recipient). */
  id: string;
}

/**
 * Conteúdo a ser distribuído. A ordem usada é a ordem do array recebido (já
 * ordenado por `position` pelo chamador).
 */
export interface Content {
  /** Identificador estável do conteúdo (ex.: id do whatsapp_contents). */
  id: string;
}

/** Resultado da distribuição: vínculo recipient ↔ content (exatamente um por recipient). */
export interface Assignment {
  /** Índice determinístico do destinatário na ordem de processamento (0-based). */
  index: number;
  /** Identificador do destinatário. */
  recipientId: string;
  /** Identificador do conteúdo atribuído. */
  contentId: string;
}

/**
 * Atribui exatamente um `Content` a cada `Recipient` conforme o `mode`.
 *
 * @param recipients Destinatários na ordem de processamento (`seq`).
 * @param contents   Conteúdos na ordem registrada (`position`); espera-se `M >= 1`.
 * @param mode       `BLOCK` ou `INTERLEAVED`.
 * @param blockSize  Tamanho do bloco para `BLOCK` (`>= 1`); ignorado em `INTERLEAVED`.
 * @returns Uma `Assignment` por destinatário, na mesma ordem dos `recipients`.
 */
export function assignContents(
  recipients: Recipient[],
  contents: Content[],
  mode: DistributionMode,
  blockSize: number
): Assignment[] {
  const contentCount = contents.length;

  // Domínio esperado: contents >= 1. Sem conteúdos não há atribuição possível;
  // mantém a função total retornando vazio em vez de lançar.
  if (contentCount === 0) {
    return [];
  }

  // Guarda contra blockSize inválido (<= 0): evita divisão por zero e mantém a
  // função total. O domínio válido (Req 7) exige blockSize >= 1.
  const effectiveBlockSize = blockSize >= 1 ? Math.floor(blockSize) : 1;

  return recipients.map((recipient, index) => {
    const contentIndex =
      mode === 'BLOCK'
        ? Math.floor(index / effectiveBlockSize) % contentCount
        : index % contentCount;

    return {
      index,
      recipientId: recipient.id,
      contentId: contents[contentIndex].id,
    };
  });
}
