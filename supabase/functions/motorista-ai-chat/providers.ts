// ============================================================================
// providers.ts — Provider Abstraction para o motorista-ai-chat
// ============================================================================
// Suporte a OpenAI, Claude e Gemini. Grok e Llama retornam
// `provider_not_implemented` sem tocar em segredos.
// ============================================================================

export type AiProvider = 'openai' | 'claude' | 'gemini' | 'grok' | 'llama';

export interface AiProviderInput {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model: string;
}

export interface AiProviderResult {
  ok: boolean;
  content?: string;
  model?: string;
  error?: string;
}

// ===================== OpenAI ===============================================

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

async function callOpenAI(input: AiProviderInput, apiKey: string): Promise<AiProviderResult> {
  try {
    const model = input.model || DEFAULT_OPENAI_MODEL;

    const messages = [{ role: 'system' as const, content: input.systemPrompt }, ...input.messages];

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      return { ok: false, error: `openai_http_${response.status}` };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { ok: false, error: 'openai_unexpected_response' };
    }

    return { ok: true, content, model: data?.model ?? model };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'openai_unknown_error',
    };
  }
}

// ===================== Claude ===============================================

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_CLAUDE_MODEL = 'claude-3-5-sonnet-latest';

async function callClaude(input: AiProviderInput, apiKey: string): Promise<AiProviderResult> {
  try {
    const model = input.model || DEFAULT_CLAUDE_MODEL;

    // Anthropic aceita apenas roles user/assistant no array de messages;
    // system prompt vai no campo `system`.
    const messages = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': CLAUDE_ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: input.systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      return { ok: false, error: `claude_http_${response.status}` };
    }

    const data = await response.json();
    const content = extractClaudeText(data);
    if (content === null) {
      return { ok: false, error: 'claude_unexpected_response' };
    }

    return { ok: true, content, model: data?.model ?? model };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'claude_unknown_error',
    };
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
  return parts.length > 0 ? parts.join('') : null;
}

// ===================== Gemini ===============================================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-pro';

async function callGemini(input: AiProviderInput, apiKey: string): Promise<AiProviderResult> {
  try {
    const model = input.model || DEFAULT_GEMINI_MODEL;

    // Gemini usa role "model" em vez de "assistant"
    const contents = input.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        generationConfig: { maxOutputTokens: 1024 },
      }),
    });

    if (!response.ok) {
      return { ok: false, error: `gemini_http_${response.status}` };
    }

    const data = await response.json();
    const content = extractGeminiText(data);
    if (content === null) {
      return { ok: false, error: 'gemini_unexpected_response' };
    }

    return { ok: true, content, model: data?.modelVersion ?? model };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'gemini_unknown_error',
    };
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
    if (
      typeof part === 'object' &&
      part !== null &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      out.push((part as { text: string }).text);
    }
  }
  return out.length > 0 ? out.join('') : null;
}

// ===================== Dispatcher ===========================================

export async function callProvider(
  provider: AiProvider,
  input: AiProviderInput,
  apiKey: string
): Promise<AiProviderResult> {
  switch (provider) {
    case 'openai':
      return callOpenAI(input, apiKey);
    case 'claude':
      return callClaude(input, apiKey);
    case 'gemini':
      return callGemini(input, apiKey);
    case 'grok':
    case 'llama':
      return { ok: false, error: 'provider_not_implemented' };
    default:
      return { ok: false, error: 'provider_not_implemented' };
  }
}
