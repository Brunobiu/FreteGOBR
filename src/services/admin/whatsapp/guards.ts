/**
 * Guardas de acesso e anti-enumeração do WhatsApp_Module (camada de serviço).
 *
 * Espelha no TypeScript a 3ª camada de isolamento implementada na migration
 * (SECTION 14): a guarda server-side `whatsapp_assert_instance` lança o marker
 * canônico `WHATSAPP_NOT_FOUND` (ERRCODE `P0001`) quando a instância não existe
 * ou está fora de acesso — resposta indistinguível, sem revelar existência
 * (Req 2.8, 30.8). Aqui mapeamos esse marker para a Canonical_Message
 * user-facing em pt-BR.
 *
 * Também expõe os wrappers tipados das RPCs de Vault por instância
 * (`whatsapp_set_instance_secret`, `whatsapp_instance_secret_is_set`): o setter
 * nunca retorna o valor do segredo e o checker retorna apenas um booleano de
 * presença (Req 18.5, 18.7).
 *
 * Convenção FreteGO: a constante canônica de PRODUÇÃO vive aqui (não em
 * `src/__tests__/_helpers`); os testes apenas a reusam.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 */

import { supabase } from '../../supabase';

/**
 * Canonical_Message anti-enumeração do módulo (pt-BR).
 *
 * Usada sempre que uma instância/registro/conversa inexistente ou cruzada entre
 * instâncias é solicitada — a mesma resposta para "não existe" e "sem acesso",
 * impedindo enumeração (Req 2.8, 18.5, 30.8).
 */
export const WHATSAPP_CANONICAL_OPERATION_FAILED = 'Não foi possível concluir a operação.' as const;

/**
 * Marker lançado pela guarda SQL `whatsapp_assert_instance` (ERRCODE `P0001`).
 * A camada TS o reconhece e o traduz para a Canonical_Message acima.
 */
export const WHATSAPP_NOT_FOUND_MARKER = 'WHATSAPP_NOT_FOUND' as const;

/** Tipos de segredo suportados por instância (espelha o domínio fechado do SQL). */
export type WhatsAppSecretKind = 'EVOLUTION' | 'AI';

/**
 * Forma mínima de um erro retornado pelo PostgREST/Supabase ao chamar uma RPC.
 * Mantida deliberadamente parcial para aceitar tanto `PostgrestError` quanto
 * exceções genéricas com `message`/`code`.
 */
export interface SupabaseLikeError {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Indica se um erro corresponde à guarda de instância / anti-enumeração do SQL.
 *
 * Reconhece tanto o marker textual `WHATSAPP_NOT_FOUND` (em qualquer campo de
 * mensagem) quanto o ERRCODE `P0001` usado pela guarda.
 */
export function isInstanceGuardError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;

  const err = error as SupabaseLikeError;
  const haystacks = [err.message, err.details, err.hint].filter(
    (v): v is string => typeof v === 'string'
  );

  if (haystacks.some((text) => text.includes(WHATSAPP_NOT_FOUND_MARKER))) {
    return true;
  }

  // Fallback por ERRCODE: P0001 carregando o marker é a guarda de instância.
  if (err.code === 'P0001' && haystacks.some((t) => t.includes(WHATSAPP_NOT_FOUND_MARKER))) {
    return true;
  }

  return false;
}

/**
 * Mapeia um erro de RPC para a mensagem user-facing apropriada.
 *
 * - Erro da guarda de instância (`WHATSAPP_NOT_FOUND`) ⇒ Canonical_Message
 *   anti-enumeração (não revela existência).
 * - Demais erros ⇒ a própria mensagem do erro, ou a Canonical_Message como
 *   fallback seguro quando não há mensagem utilizável.
 *
 * Nunca propaga detalhes que possam revelar a existência de uma instância.
 */
export function mapInstanceGuardError(error: unknown): string {
  if (isInstanceGuardError(error)) {
    return WHATSAPP_CANONICAL_OPERATION_FAILED;
  }

  if (error != null && typeof error === 'object') {
    const msg = (error as SupabaseLikeError).message;
    if (typeof msg === 'string' && msg.trim().length > 0) {
      return msg;
    }
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return WHATSAPP_CANONICAL_OPERATION_FAILED;
}

/**
 * Grava/sobrescreve (idempotente) um segredo da instância no Vault via RPC
 * `whatsapp_set_instance_secret`. NUNCA retorna o valor do segredo.
 *
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function setInstanceSecret(
  instanceId: string,
  kind: WhatsAppSecretKind,
  secret: string
): Promise<void> {
  const { error } = await supabase.rpc('whatsapp_set_instance_secret', {
    p_instance_id: instanceId,
    p_kind: kind,
    p_secret: secret,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }
}

/**
 * Verifica se um segredo da instância está configurado no Vault via RPC
 * `whatsapp_instance_secret_is_set`. Retorna apenas o indicador booleano de
 * presença — o valor em texto puro nunca é exposto.
 *
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function instanceSecretIsSet(
  instanceId: string,
  kind: WhatsAppSecretKind
): Promise<boolean> {
  const { data, error } = await supabase.rpc('whatsapp_instance_secret_is_set', {
    p_instance_id: instanceId,
    p_kind: kind,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  return data === true;
}
