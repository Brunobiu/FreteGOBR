/**
 * Configuração de IA por instância — camada de serviço (TypeScript).
 *
 * Envolve as RPCs `whatsapp_get_ai_config` / `whatsapp_save_ai_config`
 * (migration 097) que materializam a config de IA **única por instância**
 * (UNIQUE(instance_id) em `whatsapp_ai_configs`). A config guarda apenas dados
 * NÃO sensíveis — `enabled`, `ai_prompt` (persona, Req 26), `knowledge_base`
 * (base de conhecimento, Req 15.2) e `handoff_message` (Req 31.4).
 *
 * A **AI_Api_Key nunca trafega aqui**: vive no Supabase Vault escopada por
 * `instance_id`, gravada via `setInstanceSecret(instance, 'AI', key)` (RPC
 * `whatsapp_set_instance_secret`, guards.ts). O serviço só expõe o indicador
 * booleano `hasApiKey`, derivado de `instanceSecretIsSet(instance, 'AI')`
 * (Req 14.2, 14.5, 18.7) — o valor bruto da chave jamais é retornado ou logado
 * (testes `expectNoSecrets`).
 *
 * - `getAiConfig` é LEITURA: chama a RPC diretamente (gating SETTINGS_VIEW no
 *   servidor) e nunca audita.
 * - `saveAiConfig` / `setAiApiKey` são MUTAÇÕES: passam por
 *   `executeAdminMutation` (audit-by-construction, admin-patterns #1), sempre
 *   registrando o `instance_id` no log — e NUNCA o valor da chave. O gating
 *   SETTINGS_EDIT é reaplicado no servidor (camada 2 do RBAC).
 *
 * Isolamento por instância: toda operação é parametrizada por `instanceId`; a
 * config/segredo usados são sempre os da mesma instância (Req 16.1, 26.4, 26.5).
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError, setInstanceSecret, instanceSecretIsSet } from './guards';
import { validateAiPrompt, validateKnowledgeBase } from './validation';

/**
 * Forma da configuração de IA exposta à UI. `hasApiKey` é o indicador derivado
 * do Vault (a chave nunca é exposta); `updatedAt` é `null` enquanto não há
 * linha de config materializada (estado default).
 */
export interface AiConfig {
  enabled: boolean;
  aiPrompt: string | null;
  knowledgeBase: string | null;
  hasApiKey: boolean;
  handoffMessage: string | null;
  updatedAt: string | null;
}

/** Entrada de gravação da config de IA (sem a chave — vai pelo Vault). */
export interface SaveAiConfigInput {
  enabled: boolean;
  aiPrompt: string;
  knowledgeBase: string | null;
  handoffMessage: string | null;
  /** Versão otimista; `null` na primeira gravação (ainda não há linha). */
  expectedUpdatedAt: string | null;
}

/** Forma crua (snake_case) retornada pelas RPCs de config de IA. */
interface AiConfigRow {
  enabled: boolean;
  ai_prompt: string | null;
  knowledge_base: string | null;
  has_api_key: boolean;
  handoff_message: string | null;
  updated_at: string | null;
}

/** Converte a linha crua da RPC para o shape camelCase da camada de serviço. */
function mapAiConfig(row: AiConfigRow): AiConfig {
  return {
    enabled: row.enabled,
    aiPrompt: row.ai_prompt,
    knowledgeBase: row.knowledge_base,
    hasApiKey: row.has_api_key,
    handoffMessage: row.handoff_message,
    updatedAt: row.updated_at,
  };
}

/**
 * Canonical_Message para AI_Api_Key vazia/ausente (Req 14.3). Validada no
 * serviço (e revalidada na RPC de Vault) antes de tocar o Vault.
 */
const AI_API_KEY_REQUIRED_MESSAGE = 'Informe uma chave de API válida.' as const;

/**
 * Lê a config de IA da instância (enabled, prompt, base e indicador de chave).
 * Quando ainda não há config, a RPC retorna a forma default (enabled=false,
 * demais `null`); `hasApiKey` sempre reflete o Vault (Req 14.5). LEITURA — não
 * audita.
 *
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function getAiConfig(instanceId: string): Promise<AiConfig> {
  const { data, error } = await supabase.rpc('whatsapp_get_ai_config', {
    p_instance_id: instanceId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  return mapAiConfig(data as AiConfigRow);
}

/**
 * Grava a config de IA da instância (prompt/base/handoff/enabled), com
 * versionamento otimista (`expectedUpdatedAt` → `STALE_VERSION` na divergência,
 * Req 15.4/26.6). Mutação auditada com `instance_id` (Req 15.5, 26.7); jamais
 * grava a chave.
 *
 * Revalida no frontend antes de chamar o backend (Req 15.6, 26.8):
 * - `aiPrompt` vazio ⇒ `Informe um prompt válido.` (Req 26.3).
 * - `knowledgeBase` acima do limite ⇒ `O conteúdo excede o limite permitido.`
 *   (Req 15.3), sem truncar (Req 15.2).
 *
 * @throws `Error` com a Canonical_Message pt-BR em falha de validação, ou a
 *   mensagem mapeada da RPC (anti-enumeração / `STALE_VERSION`).
 */
export async function saveAiConfig(
  instanceId: string,
  input: SaveAiConfigInput
): Promise<AiConfig> {
  // Revalidação client-side (espelha a do backend) — bloqueia antes do I/O.
  const promptCheck = validateAiPrompt(input.aiPrompt);
  if (!promptCheck.ok) {
    throw new Error(promptCheck.message);
  }

  const kbCheck = validateKnowledgeBase(input.knowledgeBase);
  if (!kbCheck.ok) {
    throw new Error(kbCheck.message);
  }

  return executeAdminMutation(
    {
      action: 'WHATSAPP_AI_CONFIG_SAVE',
      targetType: 'whatsapp_ai_configs',
      targetId: instanceId,
      before: { instance_id: instanceId, expected_updated_at: input.expectedUpdatedAt },
      // NUNCA inclui a AI_Api_Key — apenas dados não sensíveis (expectNoSecrets).
      after: {
        instance_id: instanceId,
        enabled: input.enabled,
        has_prompt: true,
        has_knowledge_base: (input.knowledgeBase ?? '').length > 0,
        has_handoff_message: (input.handoffMessage ?? '').length > 0,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_save_ai_config', {
        p_instance_id: instanceId,
        p_enabled: input.enabled,
        p_ai_prompt: input.aiPrompt,
        p_knowledge_base: input.knowledgeBase,
        p_handoff_message: input.handoffMessage,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
      if (error) {
        throw new Error(mapInstanceGuardError(error));
      }
      return mapAiConfig(data as AiConfigRow);
    }
  );
}

/**
 * Grava/sobrescreve a AI_Api_Key da instância no Vault (Req 14.1, 14.4). A chave
 * é validada antes de tocar o Vault (vazia ⇒ `Informe uma chave de API válida.`,
 * Req 14.3) e gravada via `setInstanceSecret` (RPC `whatsapp_set_instance_secret`).
 *
 * Mutação auditada com `instance_id` — o valor da chave NUNCA é gravado no log
 * (audit sem segredo, Req 14.4; testes `expectNoSecrets`).
 *
 * @throws `Error` com a Canonical_Message pt-BR em chave inválida, ou a mensagem
 *   mapeada da RPC (anti-enumeração quando aplicável).
 */
export async function setAiApiKey(instanceId: string, apiKey: string): Promise<void> {
  // Validação client-side: chave não vazia (Req 14.3). Revalidada na RPC de Vault.
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error(AI_API_KEY_REQUIRED_MESSAGE);
  }

  await executeAdminMutation(
    {
      action: 'WHATSAPP_AI_API_KEY_SET',
      targetType: 'whatsapp_ai_configs',
      targetId: instanceId,
      before: null,
      // NUNCA inclui o valor da chave — apenas o indicador de presença.
      after: { instance_id: instanceId, has_api_key: true },
    },
    async () => {
      await setInstanceSecret(instanceId, 'AI', apiKey);
    }
  );
}

/**
 * Indica se a AI_Api_Key da instância está configurada no Vault (Req 14.5).
 * Retorna apenas o booleano — a chave em texto puro nunca é exposta. LEITURA.
 *
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function aiApiKeyIsSet(instanceId: string): Promise<boolean> {
  return instanceSecretIsSet(instanceId, 'AI');
}
