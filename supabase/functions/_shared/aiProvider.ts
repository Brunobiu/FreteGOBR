// ============================================================================
// _shared/aiProvider.ts — Provider_Abstraction compartilhada (runtime Deno)
// ============================================================================
// Espelha o módulo canônico src/services/admin/assistantProvider.ts (testado
// por Vitest + fast-check no app). Camada plugável que seleciona e invoca o
// AI_Provider ativo por trás de uma interface comum (AiProviderClient).
//
// Reusada pelas Edge Functions de IA (assistant-ai mantém cópia inline própria;
// support-ai-reply usa este módulo). A chave do provedor é lida SOMENTE
// server-side (Vault) e injetada como `apiKey` no `invoke` — nunca no frontend.
//
// Claude e Gemini são funcionais; grok/llama são stubs estruturais que
// retornam `provider_not_implemented` sem tocar em segredos.
// ============================================================================

export type AiProvider = 'claude' | 'gemini' | 'grok' | 'llama';
export type ChatRole = 'user' | 'assistant' | 'system';

const AI_PROVIDERS: readonly AiProvider[] = ['claude', 'gemini', 'grok', 'llama'];

export function isValidProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

export interface AiInvokeInput {
  context: string;
  messages: { role: ChatRole; content: string }[];
}

export type AiInvokeResult =
  | { ok: true; content: string; model: string }
  | {
      ok: false;
      error: 'provider_not_implemented' | 'provider_call_failed' | 'missing_api_key';
      provider: AiProvider;
      detail?: string;
    };

export interface AiProviderClient {
  readonly id: AiProvider;
  readonly requiresApiKey: boolean;
  invoke(input: AiInvokeInput, apiKey: string): Promise<AiInvokeResult>;
}

// ===================== Claude =====================
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_CLAUDE_MODEL = 'claude-3-5-sonnet-latest';
const CLAUDE_MAX_TOKENS = 1024;

export class ClaudeClient implements AiProviderClient {
  public readonly id: AiProvider = 'claude';
  public readonly requiresApiKey = true;
  private readonly model: string;

  constructor(model: string = DEFAULT_CLAUDE_MODEL) {
    this.model = model;
  }

  async invoke(input: AiInvokeInput, apiKey: string): Promise<AiInvokeResult> {
    if (!apiKey) return { ok: false, error: 'missing_api_key', provider: 'claude' };
    try {
      const messages = input.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch(CLAUDE_API_URL, {
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
        return { ok: false, error: 'provider_call_failed', provider: 'claude', detail: `HTTP ${response.status}` };
      }
      const data: unknown = await response.json();
      const content = extractClaudeText(data);
      if (content === null) {
        return { ok: false, error: 'provider_call_failed', provider: 'claude', detail: 'unexpected_response_shape' };
      }
      return { ok: true, content, model: extractClaudeModel(data) ?? this.model };
    } catch (err) {
      return {
        ok: false,
        error: 'provider_call_failed',
        provider: 'claude',
        detail: err instanceof Error ? err.message : 'unknown_error',
      };
    }
  }
}

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

function extractClaudeModel(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const model = (data as { model?: unknown }).model;
  return typeof model === 'string' ? model : null;
}

// ===================== Gemini =====================
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MAX_TOKENS = 1024;

export class GeminiClient implements AiProviderClient {
  public readonly id: AiProvider = 'gemini';
  public readonly requiresApiKey = true;
  private readonly model: string;

  constructor(model: string = DEFAULT_GEMINI_MODEL) {
    this.model = model;
  }

  async invoke(input: AiInvokeInput, apiKey: string): Promise<AiInvokeResult> {
    if (!apiKey) return { ok: false, error: 'missing_api_key', provider: 'gemini' };
    try {
      const contents = input.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const url = `${GEMINI_API_BASE}/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: input.context }] },
          generationConfig: { maxOutputTokens: GEMINI_MAX_TOKENS },
        }),
      });

      if (!response.ok) {
        return { ok: false, error: 'provider_call_failed', provider: 'gemini', detail: `HTTP ${response.status}` };
      }
      const data: unknown = await response.json();
      const content = extractGeminiText(data);
      if (content === null) {
        return { ok: false, error: 'provider_call_failed', provider: 'gemini', detail: 'unexpected_response_shape' };
      }
      return { ok: true, content, model: extractGeminiModel(data) ?? this.model };
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
    if (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string') {
      out.push((part as { text: string }).text);
    }
  }
  return out.join('');
}

function extractGeminiModel(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const model = (data as { modelVersion?: unknown }).modelVersion;
  return typeof model === 'string' ? model : null;
}

// ===================== Stub (não implementado) =====================
export class NotImplementedClient implements AiProviderClient {
  public readonly id: AiProvider;
  public readonly requiresApiKey = false;

  constructor(provider: AiProvider) {
    this.id = provider;
  }

  // Parâmetros ignorados de propósito: nenhum segredo é tocado.
  async invoke(_input: AiInvokeInput, _apiKey: string): Promise<AiInvokeResult> {
    return { ok: false, error: 'provider_not_implemented', provider: this.id };
  }
}

// ===================== Seleção =====================
/** Default por provider quando o `model` salvo não pertence ao provider ativo. */
export function pickModelForProvider(provider: AiProvider, model: string | undefined): string | undefined {
  if (typeof model !== 'string' || model.length === 0) return undefined;
  const lower = model.toLowerCase();
  switch (provider) {
    case 'claude':
      return lower.startsWith('claude-') ? model : undefined;
    case 'gemini':
      return lower.startsWith('gemini-') ? model : undefined;
    case 'grok':
      return lower.startsWith('grok-') ? model : undefined;
    case 'llama':
      return lower.startsWith('llama-') || lower.startsWith('meta-llama-') ? model : undefined;
    default:
      return undefined;
  }
}

export function selectProviderClient(provider: AiProvider, model?: string): AiProviderClient {
  switch (provider) {
    case 'claude':
      return new ClaudeClient(model);
    case 'gemini':
      return new GeminiClient(model);
    case 'grok':
    case 'llama':
      return new NotImplementedClient(provider);
    default: {
      const exhaustiveCheck: never = provider;
      return new NotImplementedClient(exhaustiveCheck);
    }
  }
}
