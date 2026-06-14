/**
 * admin/assistantProvider.ts
 *
 * Provider_Abstraction (task 5.1) do modulo Assistente (admin-assistant).
 *
 * Camada plugavel que seleciona e invoca o AI_Provider configurado por
 * tras de uma interface comum (`AiProviderClient`), permitindo adicionar
 * provedores sem refatorar o Context_Builder nem o fluxo de chat (Req 8.6).
 *
 * Nesta entrega apenas o Claude e funcional; Gemini/Grok/Llama sao stubs
 * estruturais que retornam erro tipado de "nao implementado" sem tocar em
 * segredos (Req 8.5). Falha do cliente Claude retorna erro tipado
 * imediatamente, SEM fallback para outro provedor (Req 8.3).
 *
 * Este e o modulo canonico em TypeScript (testado pelo Vitest + fast-check,
 * alvo do property test CP-14). A Edge Function `assistant-ai` (task 8.1)
 * espelha exatamente este mesmo contrato no runtime Deno; a chave do
 * provedor e lida APENAS server-side (Vault) e injetada como `apiKey` no
 * `invoke` — o frontend nunca ve a chave (Req 8.7, 7.5).
 *
 * Convencoes herdadas (project-conventions.md / admin-patterns.md):
 *   - TypeScript strict; identifiers/error codes em ingles; comentarios
 *     user-facing em pt-BR.
 *   - `fetch` usa SEMPRE `globalThis.fetch`, lido no momento da chamada,
 *     para ser substituivel por mock em testes.
 */

import type { AiProvider, ChatRole } from './assistant';

// ===================== Contrato comum =====================

/**
 * Entrada de invocacao do provedor de IA. `context` e o bloco textual
 * montado pelo Context_Builder (server-side); `messages` e o historico
 * da conversa com papeis do dominio fechado `ChatRole`.
 */
export interface AiInvokeInput {
  context: string;
  messages: { role: ChatRole; content: string }[];
}

/**
 * Resultado tipado de uma invocacao ao provedor.
 *
 * - Sucesso: `content` (texto do modelo) + `model` efetivamente usado.
 * - Falha: codigo de erro fechado + `provider` que falhou + `detail`
 *   opcional (mensagem nao sensivel para diagnostico). Nenhum erro
 *   carrega segredos.
 */
export type AiInvokeResult =
  | { ok: true; content: string; model: string }
  | {
      ok: false;
      error: 'provider_not_implemented' | 'provider_call_failed' | 'missing_api_key';
      provider: AiProvider;
      detail?: string;
    };

/**
 * Interface comum de invocacao (Req 8.1). Cada cliente expoe seu `id`
 * (o AI_Provider que implementa), permitindo que `selectProviderClient`
 * garanta que o cliente retornado corresponde ao provider solicitado.
 */
export interface AiProviderClient {
  readonly id: AiProvider;
  invoke(input: AiInvokeInput, apiKey: string): Promise<AiInvokeResult>;
}

// ===================== Constantes do Claude =====================

/**
 * Endpoint da Anthropic Messages API. A chamada e feita via
 * `globalThis.fetch` para permitir mock em testes.
 */
export const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Versao da API exigida no header `anthropic-version`.
 */
export const CLAUDE_ANTHROPIC_VERSION = '2023-06-01';

/**
 * Modelo padrao do Claude. Espelha o default de `assistant_config.model`
 * (migration 047). A Edge `assistant-ai` injeta o `model` lido da config;
 * quando nao informado, este default e usado.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-3-5-sonnet-latest';

/**
 * Limite de tokens da resposta (campo obrigatorio na Anthropic Messages API).
 */
export const CLAUDE_MAX_TOKENS = 1024;

// ===================== Constantes do Gemini =====================

/**
 * Endpoint base da Gemini API (v1beta). Aceita `:generateContent` por modelo;
 * o `model` final e injetado pela Edge a partir da config.
 */
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Modelo padrao do Gemini quando a config nao informa um. Modelo gratuito
 * atual com tier amplo. `gemini-1.5-flash` foi deprecated em 2025 (404 em
 * keys novas); `gemini-2.5-flash` e a substituicao recomendada pelo Google.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Limite de tokens da resposta. Espelha CLAUDE_MAX_TOKENS para paridade
 * de UX entre provedores.
 */
export const GEMINI_MAX_TOKENS = 1024;

// ===================== ClaudeClient (funcional) =====================

/**
 * Cliente funcional do Claude. Invoca a Anthropic Messages API via
 * `globalThis.fetch`, lendo o `model` da config (injetado no construtor;
 * default `DEFAULT_CLAUDE_MODEL`).
 *
 * Em qualquer falha (chave ausente, resposta nao-OK, erro de rede ou
 * payload inesperado) retorna um erro tipado imediatamente, SEM acionar
 * fallback para outro provedor (Req 8.3).
 */
export class ClaudeClient implements AiProviderClient {
  public readonly id: AiProvider = 'claude';

  private readonly model: string;

  constructor(model: string = DEFAULT_CLAUDE_MODEL) {
    this.model = model;
  }

  async invoke(input: AiInvokeInput, apiKey: string): Promise<AiInvokeResult> {
    // Sem chave nao ha como chamar o provedor (Req 7.7/8.7). A leitura da
    // chave do Vault e responsabilidade da Edge; aqui apenas validamos.
    if (!apiKey) {
      return { ok: false, error: 'missing_api_key', provider: 'claude' };
    }

    try {
      // A Anthropic so aceita papeis `user`/`assistant` no array de
      // mensagens; o contexto vai no campo `system`. Mensagens `system`
      // do historico sao descartadas do array (ja representadas no contexto).
      const messages = input.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await globalThis.fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': CLAUDE_ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: CLAUDE_MAX_TOKENS,
          system: input.context,
          messages,
        }),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: 'provider_call_failed',
          provider: 'claude',
          detail: `HTTP ${response.status}`,
        };
      }

      const data: unknown = await response.json();
      const content = extractClaudeText(data);
      if (content === null) {
        return {
          ok: false,
          error: 'provider_call_failed',
          provider: 'claude',
          detail: 'unexpected_response_shape',
        };
      }

      const model = extractClaudeModel(data) ?? this.model;
      return { ok: true, content, model };
    } catch (err) {
      // Erro de rede / parsing: erro tipado imediato, sem fallback (Req 8.3).
      return {
        ok: false,
        error: 'provider_call_failed',
        provider: 'claude',
        detail: err instanceof Error ? err.message : 'unknown_error',
      };
    }
  }
}

/**
 * Extrai o texto concatenado dos blocos de conteudo da resposta da
 * Anthropic Messages API (`content: [{ type: 'text', text }]`). Retorna
 * `null` quando o payload nao tem o formato esperado.
 */
function extractClaudeText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join('');
}

/**
 * Extrai o `model` efetivamente usado da resposta, quando presente.
 */
function extractClaudeModel(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const model = (data as { model?: unknown }).model;
  return typeof model === 'string' ? model : null;
}

// ===================== GeminiClient (funcional) =====================

/**
 * Cliente funcional do Gemini (Google Generative Language API).
 *
 * Difere do Claude em tres pontos importantes:
 *   1. Modelos de chat usam o endpoint `:generateContent` com a chave na
 *      query string (`?key=...`) -- nao ha header dedicado para a API key.
 *   2. O contrato de mensagens usa `contents: [{ role, parts: [{ text }] }]`
 *      com `role` em `{ user, model }` (a propria Gemini chama o assistant
 *      de "model"). Mensagens `system` do historico viram um bloco
 *      `systemInstruction` separado, junto do contexto agregado.
 *   3. A resposta agrega varios `candidates[].content.parts[].text`. Pegamos
 *      o primeiro candidato e concatenamos seus parts.
 *
 * Em qualquer falha (chave ausente, resposta nao-OK, erro de rede ou payload
 * inesperado) retorna erro tipado imediatamente, SEM fallback (Req 8.3).
 */
export class GeminiClient implements AiProviderClient {
  public readonly id: AiProvider = 'gemini';

  private readonly model: string;

  constructor(model: string = DEFAULT_GEMINI_MODEL) {
    this.model = model;
  }

  async invoke(input: AiInvokeInput, apiKey: string): Promise<AiInvokeResult> {
    if (!apiKey) {
      return { ok: false, error: 'missing_api_key', provider: 'gemini' };
    }

    try {
      // Mapeia `assistant` -> `model` (papel esperado pela Gemini) e descarta
      // `system` do historico (vai em `systemInstruction`, abaixo).
      const contents = input.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const url = `${GEMINI_API_BASE}/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const response = await globalThis.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: input.context }] },
          generationConfig: { maxOutputTokens: GEMINI_MAX_TOKENS },
        }),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: 'provider_call_failed',
          provider: 'gemini',
          detail: `HTTP ${response.status}`,
        };
      }

      const data: unknown = await response.json();
      const content = extractGeminiText(data);
      if (content === null) {
        return {
          ok: false,
          error: 'provider_call_failed',
          provider: 'gemini',
          detail: 'unexpected_response_shape',
        };
      }

      const model = extractGeminiModel(data) ?? this.model;
      return { ok: true, content, model };
    } catch (err) {
      return {
        ok: false,
        error: 'provider_call_failed',
        provider: 'gemini',
        detail: err instanceof Error ? err.message : 'unknown_error',
      };
    }
  }
}

/**
 * Extrai o texto agregado dos `candidates[0].content.parts[].text` da
 * resposta da Gemini. Retorna `null` quando o payload nao tem o formato
 * esperado.
 */
function extractGeminiText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const first = candidates[0];
  if (typeof first !== 'object' || first === null) return null;
  const content = (first as { content?: unknown }).content;
  if (typeof content !== 'object' || content === null) return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;

  const out: string[] = [];
  for (const part of parts) {
    if (
      typeof part === 'object' &&
      part !== null &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      out.push((part as { text: string }).text);
    }
  }
  return out.join('');
}

/**
 * Extrai o `modelVersion` retornado pela Gemini, quando presente.
 */
function extractGeminiModel(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const model = (data as { modelVersion?: unknown }).modelVersion;
  return typeof model === 'string' ? model : null;
}

// ===================== Stubs estruturais (nao implementados) =====================

/**
 * Cliente estrutural para provedores ainda nao implementados
 * (`gemini`/`grok`/`llama`). Retorna sempre `provider_not_implemented`
 * SEM tocar em `apiKey`/segredos (Req 8.5). Adicionar um provedor real
 * significa apenas implementar `AiProviderClient` e registra-lo em
 * `selectProviderClient` (Req 8.6).
 */
export class NotImplementedClient implements AiProviderClient {
  public readonly id: AiProvider;

  constructor(provider: AiProvider) {
    this.id = provider;
  }

  // Os parametros sao deliberadamente ignorados: nenhum segredo e tocado.
  async invoke(_input: AiInvokeInput, _apiKey: string): Promise<AiInvokeResult> {
    return { ok: false, error: 'provider_not_implemented', provider: this.id };
  }
}

// ===================== Selecao do cliente =====================

/**
 * Retorna o `AiProviderClient` cujo `id` corresponde ao `provider`
 * configurado como Active_Provider (Req 8.4). `claude` retorna o cliente
 * funcional; os demais retornam o stub estrutural.
 */
export function selectProviderClient(provider: AiProvider): AiProviderClient {
  switch (provider) {
    case 'claude':
      return new ClaudeClient();
    case 'gemini':
      return new GeminiClient();
    case 'openai':
    case 'grok':
    case 'llama':
      return new NotImplementedClient(provider);
    default: {
      // Exaustividade: se um novo AiProvider for adicionado ao dominio sem
      // um caso aqui, o TypeScript acusa o erro nesta atribuicao.
      const exhaustiveCheck: never = provider;
      return new NotImplementedClient(exhaustiveCheck);
    }
  }
}
