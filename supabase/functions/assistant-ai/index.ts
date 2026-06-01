// ============================================================================
// Edge Function: assistant-ai
// ============================================================================
// Spec: .kiro/specs/admin-assistant/{requirements,design,tasks}.md
//   Task 8.1 — Provider_Abstraction + leitura do Vault.
//   Task 8.2 — Context_Builder real (dados reais do Supabase) + historico
//              de conversa no array de mensagens.
//
// Responsabilidade desta function (a UNICA camada que toca a chave do
// provedor de IA — Req 8.7 / 14.2):
//   1. Recebe POST { conversationId, userMessage } do Assistant_Service
//      (browser, JWT do Master_Admin) OU do assistant-monitor (service-role).
//   2. Le o Active_Provider + model de `assistant_config`.
//   3. Monta o contexto com dados reais do Supabase (Context_Builder, 8.2).
//   4. Le a chave do Active_Provider EXCLUSIVAMENTE do Vault
//      (`vault.decrypted_secrets`, nome `assistant_provider_key_<provider>`)
//      via service-role client; ausente => `missing_api_key` (Req 8.7, 7.7).
//   5. Invoca o cliente do provider por tras da Provider_Abstraction:
//        - claude  => ClaudeClient (Anthropic Messages API via fetch).
//        - gemini/grok/llama => stub tipado `provider_not_implemented`
//          SEM tocar em segredos (Req 8.5).
//   6. Falha do Claude => `provider_call_failed` tipado, SEM fallback para
//      outro provider (Req 8.3). Nenhum erro expoe segredo.
//
// Adicionar um novo provider = implementar `AiProviderClient` e registra-lo
// em `selectProviderClient`, sem alterar o fluxo de chat (Req 8.6).
//
// Este arquivo ESPELHA, no runtime Deno, o modulo canonico TypeScript
// `src/services/admin/assistantProvider.ts` (testado por Vitest + fast-check,
// CP-14). Mantenha os dois lados em sincronia.
//
// Deploy (verify_jwt = TRUE — exige JWT de admin; o gateway Supabase valida
// o JWT e esta function ainda confirma a permissao ASSISTANT_VIEW):
//   supabase functions deploy assistant-ai
//   (NAO usar --no-verify-jwt.)
//
// O service-role key tambem e um JWT valido assinado pelo projeto, entao o
// gateway aceita a chamada interna do assistant-monitor (Bearer SERVICE_ROLE).
//
// Env vars necessarias:
//   SUPABASE_URL                (auto-injetado)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injetado) — le config + Vault
//   SUPABASE_ANON_KEY           (auto-injetado) — checa permissao via REST
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ===================== Dominios fechados (espelho de assistant.ts) ==========

type AiProvider = 'claude' | 'gemini' | 'grok' | 'llama';
type ChatRole = 'user' | 'assistant' | 'system';

const AI_PROVIDERS: readonly AiProvider[] = ['claude', 'gemini', 'grok', 'llama'];

function isValidProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

// ===================== Contrato comum (espelho de assistantProvider.ts) =====

/**
 * Entrada de invocacao do provedor de IA. `context` e o bloco textual
 * montado pelo Context_Builder (server-side); `messages` e o historico
 * da conversa com papeis do dominio fechado `ChatRole`.
 */
interface AiInvokeInput {
  context: string;
  messages: { role: ChatRole; content: string }[];
}

/**
 * Resultado tipado de uma invocacao ao provedor. Falha sempre carrega um
 * codigo de erro fechado + o `provider`; nenhum campo carrega segredos.
 */
type AiInvokeResult =
  | { ok: true; content: string; model: string }
  | {
      ok: false;
      error: 'provider_not_implemented' | 'provider_call_failed' | 'missing_api_key';
      provider: AiProvider;
      detail?: string;
    };

/**
 * Interface comum de invocacao (Req 8.1). `requiresApiKey` informa a Edge se
 * deve ler a chave do Vault antes de invocar — assim os stubs nao tocam em
 * segredos (Req 8.5) e adicionar um provider real nao muda o fluxo (Req 8.6).
 */
interface AiProviderClient {
  readonly id: AiProvider;
  readonly requiresApiKey: boolean;
  invoke(input: AiInvokeInput, apiKey: string): Promise<AiInvokeResult>;
}

// ===================== Constantes do Claude =================================

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_CLAUDE_MODEL = 'claude-3-5-sonnet-latest';
const CLAUDE_MAX_TOKENS = 1024;

// ===================== ClaudeClient (funcional) ============================

/**
 * Cliente funcional do Claude. Invoca a Anthropic Messages API via `fetch`,
 * lendo o `model` da config (injetado no construtor; default
 * `DEFAULT_CLAUDE_MODEL`). Em qualquer falha (chave ausente, resposta nao-OK,
 * erro de rede ou payload inesperado) retorna erro tipado imediatamente, SEM
 * acionar fallback para outro provedor (Req 8.3).
 */
class ClaudeClient implements AiProviderClient {
  public readonly id: AiProvider = 'claude';
  public readonly requiresApiKey = true;

  private readonly model: string;

  constructor(model: string = DEFAULT_CLAUDE_MODEL) {
    this.model = model;
  }

  async invoke(input: AiInvokeInput, apiKey: string): Promise<AiInvokeResult> {
    // Sem chave nao ha como chamar o provedor (Req 7.7 / 8.7).
    if (!apiKey) {
      return { ok: false, error: 'missing_api_key', provider: 'claude' };
    }

    try {
      // A Anthropic so aceita papeis `user`/`assistant` no array de
      // mensagens; o contexto vai no campo `system`. Mensagens `system`
      // do historico sao descartadas (ja representadas no contexto).
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
 * Extrai o texto concatenado dos blocos `content: [{ type: 'text', text }]`
 * da resposta da Anthropic. Retorna `null` se o payload nao tem o formato
 * esperado.
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

// ===================== Stubs estruturais (nao implementados) ===============

/**
 * Cliente estrutural para provedores ainda nao implementados
 * (`gemini`/`grok`/`llama`). Retorna sempre `provider_not_implemented` SEM
 * tocar em segredos (Req 8.5). `requiresApiKey = false` garante que a Edge
 * nem sequer le o Vault para estes providers.
 */
class NotImplementedClient implements AiProviderClient {
  public readonly id: AiProvider;
  public readonly requiresApiKey = false;

  constructor(provider: AiProvider) {
    this.id = provider;
  }

  // Parametros deliberadamente ignorados: nenhum segredo e tocado.
  async invoke(_input: AiInvokeInput, _apiKey: string): Promise<AiInvokeResult> {
    return { ok: false, error: 'provider_not_implemented', provider: this.id };
  }
}

// ===================== Selecao do cliente ==================================

/**
 * Retorna o `AiProviderClient` cujo `id` corresponde ao `provider`
 * configurado como Active_Provider (Req 8.4). `claude` retorna o cliente
 * funcional (com o `model` lido da config); os demais retornam o stub.
 */
function selectProviderClient(provider: AiProvider, model?: string): AiProviderClient {
  switch (provider) {
    case 'claude':
      return new ClaudeClient(model);
    case 'gemini':
    case 'grok':
    case 'llama':
      return new NotImplementedClient(provider);
    default: {
      // Exaustividade: novo AiProvider sem caso aqui quebra o type-check.
      const exhaustiveCheck: never = provider;
      return new NotImplementedClient(exhaustiveCheck);
    }
  }
}

// ===================== Env + helpers de I/O ================================

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

interface Payload {
  conversationId?: string | null;
  userMessage?: string;
}

// ===================== Leitura da config (Active_Provider + model) =========

/**
 * Le o registro unico de `assistant_config` (Active_Provider + model). Em
 * qualquer falha cai nos defaults seguros (`claude` + modelo padrao) para
 * nao derrubar a function.
 */
async function readAssistantConfig(
  sb: SupabaseClient
): Promise<{ activeProvider: AiProvider; model: string }> {
  try {
    const { data } = await sb
      .from('assistant_config')
      .select('active_provider, model')
      .eq('id', true)
      .maybeSingle();

    const activeProvider = isValidProvider(data?.active_provider)
      ? (data?.active_provider as AiProvider)
      : 'claude';
    const model =
      typeof data?.model === 'string' && data.model.length > 0 ? data.model : DEFAULT_CLAUDE_MODEL;

    return { activeProvider, model };
  } catch {
    return { activeProvider: 'claude', model: DEFAULT_CLAUDE_MODEL };
  }
}

// ===================== Leitura da chave no Vault ===========================

/**
 * Le a chave do provider EXCLUSIVAMENTE do Vault (`vault.decrypted_secrets`,
 * nome `assistant_provider_key_<provider>`) via service-role client (Req 8.7,
 * padrao da migration 042b). Retorna `null` quando ausente => `missing_api_key`
 * (Req 7.7). Nunca loga nem retorna o valor bruto.
 *
 * NOTA DE DEPLOY: o schema `vault` precisa estar exposto ao Data API
 * (Settings > API > Exposed schemas, ou `PGRST_DB_SCHEMAS`) para o acesso
 * via `.schema('vault')` funcionar com o service-role client. Caso o schema
 * nao esteja exposto, este caminho retorna erro e caimos no fallback por RPC
 * `SECURITY DEFINER` (`rpc_assistant_read_provider_key`, criado junto das RPCs
 * de segredo na migration 047), mantendo a leitura sempre server-side.
 */
async function readProviderKeyFromVault(
  sb: SupabaseClient,
  provider: AiProvider
): Promise<string | null> {
  const secretName = `assistant_provider_key_${provider}`;

  // Caminho 1: leitura direta de vault.decrypted_secrets (schema exposto).
  try {
    const { data, error } = await sb
      .schema('vault')
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', secretName)
      .limit(1)
      .maybeSingle();

    if (!error) {
      const secret = (data as { decrypted_secret?: unknown } | null)?.decrypted_secret;
      if (typeof secret === 'string' && secret.length > 0) return secret;
    }
  } catch {
    // cai para o fallback por RPC
  }

  // Caminho 2 (fallback): RPC SECURITY DEFINER no schema public que le o
  // Vault internamente. So o service-role pode chama-la; nunca expoe o bruto
  // a roles nao autorizadas. Ausente/sem permissao => null => missing_api_key.
  try {
    const { data, error } = await sb.rpc('rpc_assistant_read_provider_key', {
      p_provider: provider,
    });
    if (error) return null;
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

// ===================== Context_Builder (task 8.2) ==========================
//
// Monta, ANTES da chamada ao provedor, um bloco textual de CONTEXTO com dados
// REAIS do Supabase (Req 5.1, 5.2): contagens/amostras de usuarios
// (motoristas/embarcadores), fretes (ativos / sem aceite), pagamentos
// (financial_repasses, modulo financeiro 037), error_logs recentes e
// assistant_critical_events recentes.
//
// >>> DECISAO CONSCIENTE DO DONO — DADOS SEM MASCARA (UNMASKED) <<<
// O dono/Master_Admin decidiu conscientemente que o assistente enxerga os
// dados REAIS da plataforma SEM mascaramento de PII (nomes, etc.), porque este
// painel e seus dados sao visiveis somente a ele e o objetivo e observabilidade
// total ("tudo que entra e tudo que sai"). A ressalva LGPD e exibida nas
// Configuracoes do modulo.
//
// MITIGACAO DE SEGURANCA (o que NAO relaxa, mesmo sem mascara):
//   - As CHAVES de API / segredos permanecem CRIPTOGRAFADAS no Vault
//     (vault.decrypted_secrets) e NUNCA chegam ao frontend.
//   - Apenas esta Edge Function (server-side, service-role) ve os dados reais
//     e os envia ao provedor; o frontend nunca chama o provedor diretamente
//     nem ve a chave (Req 7.5 / 8.7).
//
// CUSTO/PAYLOAD: todas as consultas sao BOUNDED (LIMIT por amostra +
// contagens head-only) para evitar payloads enormes e custo de IA descontrolado
// (Req 5.2). Cada bloco e isolado em try/catch e a montagem usa
// Promise.allSettled: uma tabela ausente (ex.: migration 037 nao aplicada) ou
// uma consulta com erro degrada APENAS aquele bloco, sem quebrar o contexto.

/** Quantidade maxima de linhas de amostra por bloco (mantem o payload bounded). */
const CONTEXT_SAMPLE_LIMIT = 5;
/** Tamanho maximo do historico de conversa enviado ao provedor. */
const CONTEXT_HISTORY_LIMIT = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Timestamp ISO de `ms` milissegundos atras (janelas relativas). */
function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** Formata uma contagem PostgREST (`count`), tolerando `null`/erro. */
function fmtCount(count: number | null | undefined): string {
  return typeof count === 'number' ? String(count) : 'indisponivel';
}

/** Mensagem curta de bloco indisponivel — nao vaza segredos, so o motivo. */
function blockUnavailable(title: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err ?? 'desconhecido');
  return `## ${title}\n- (bloco indisponivel: ${detail})`;
}

/**
 * Heuristica defensiva: a consulta falhou porque a relacao/tabela nao existe
 * (ex.: migration 037 do financeiro nao aplicada neste ambiente). PostgREST
 * usa `42P01` (undefined_table) ou um codigo `PGRST*` quando a tabela nao esta
 * no schema cache.
 */
function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();
  return (
    code === '42P01' ||
    code.startsWith('PGRST') ||
    msg.includes('does not exist') ||
    msg.includes('could not find')
  );
}

/** Bloco: usuarios (totais por tipo + novos na semana + amostra recente). */
async function ctxUsers(sb: SupabaseClient): Promise<string> {
  try {
    const weekAgo = isoAgo(MS_PER_WEEK);
    const [totalRes, motoristasRes, embarcadoresRes, ativosRes, novosRes, amostraRes] =
      await Promise.all([
        sb.from('users').select('id', { count: 'exact', head: true }),
        sb.from('users').select('id', { count: 'exact', head: true }).eq('user_type', 'motorista'),
        sb.from('users').select('id', { count: 'exact', head: true }).eq('user_type', 'embarcador'),
        sb.from('users').select('id', { count: 'exact', head: true }).eq('is_active', true),
        sb.from('users').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
        sb
          .from('users')
          .select('name, user_type, is_active, created_at')
          .order('created_at', { ascending: false })
          .limit(CONTEXT_SAMPLE_LIMIT),
      ]);

    const lines: string[] = ['## Usuarios'];
    lines.push(`- Total: ${fmtCount(totalRes.count)}`);
    lines.push(`- Motoristas: ${fmtCount(motoristasRes.count)}`);
    lines.push(`- Embarcadores: ${fmtCount(embarcadoresRes.count)}`);
    lines.push(`- Ativos: ${fmtCount(ativosRes.count)}`);
    lines.push(`- Novos cadastros (ultimos 7 dias): ${fmtCount(novosRes.count)}`);

    const amostra = amostraRes.data ?? [];
    if (amostra.length > 0) {
      lines.push(`- Cadastros mais recentes (ate ${CONTEXT_SAMPLE_LIMIT}):`);
      for (const u of amostra) {
        lines.push(
          `  - ${u.name ?? '(sem nome)'} | ${u.user_type} | ${
            u.is_active ? 'ativo' : 'inativo'
          } | ${u.created_at}`
        );
      }
    }
    return lines.join('\n');
  } catch (err) {
    return blockUnavailable('Usuarios', err);
  }
}

/** Bloco: fretes (ativos, "sem aceite" = ativos sem nenhum clique, amostra). */
async function ctxFretes(sb: SupabaseClient): Promise<string> {
  try {
    // "sem aceite": o schema atual de fretes nao possui motorista_id nem coluna
    // de aceite formal; o sinal mais proximo de frete parado e um frete ativo
    // sem nenhum clique de motorista (clicks_count = 0).
    const [ativosRes, semAceiteRes, encerradosRes, amostraRes] = await Promise.all([
      sb.from('fretes').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
      sb
        .from('fretes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'ativo')
        .eq('clicks_count', 0),
      sb.from('fretes').select('id', { count: 'exact', head: true }).eq('status', 'encerrado'),
      sb
        .from('fretes')
        .select('origin, destination, cargo_type, value, status, clicks_count, created_at')
        .eq('status', 'ativo')
        .order('created_at', { ascending: false })
        .limit(CONTEXT_SAMPLE_LIMIT),
    ]);

    const lines: string[] = ['## Fretes'];
    lines.push(`- Ativos: ${fmtCount(ativosRes.count)}`);
    lines.push(
      `- Ativos sem aceite (sem nenhum clique de motorista): ${fmtCount(semAceiteRes.count)}`
    );
    lines.push(`- Encerrados (total): ${fmtCount(encerradosRes.count)}`);

    const amostra = amostraRes.data ?? [];
    if (amostra.length > 0) {
      lines.push(`- Fretes ativos mais recentes (ate ${CONTEXT_SAMPLE_LIMIT}):`);
      for (const f of amostra) {
        lines.push(
          `  - ${f.origin} -> ${f.destination} | ${f.cargo_type} | R$ ${f.value} | ${
            f.clicks_count
          } cliques | ${f.created_at}`
        );
      }
    }
    return lines.join('\n');
  } catch (err) {
    return blockUnavailable('Fretes', err);
  }
}

/**
 * Bloco: pagamentos / financeiro (financial_repasses, migration 037). A tabela
 * pode NAO existir neste ambiente — degradacao graciosa se a relacao faltar.
 */
async function ctxPayments(sb: SupabaseClient): Promise<string> {
  try {
    const [pendRes, pagoRes, estornadoRes, amostraRes] = await Promise.all([
      sb
        .from('financial_repasses')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendente'),
      sb
        .from('financial_repasses')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pago'),
      sb
        .from('financial_repasses')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'estornado'),
      sb
        .from('financial_repasses')
        .select('valor_bruto, valor_liquido, commission_value, status, closed_at, paid_at')
        .order('closed_at', { ascending: false })
        .limit(CONTEXT_SAMPLE_LIMIT),
    ]);

    // Migration 037 nao aplicada (tabela ausente) => bloco indisponivel, sem
    // quebrar o contexto (Req 5.2 / degradacao parcial).
    if (isMissingRelation(pendRes.error) || isMissingRelation(amostraRes.error)) {
      return '## Pagamentos / Financeiro\n- (modulo financeiro indisponivel neste ambiente)';
    }

    const lines: string[] = ['## Pagamentos / Financeiro (repasses)'];
    lines.push(`- Repasses pendentes: ${fmtCount(pendRes.count)}`);
    lines.push(`- Repasses pagos: ${fmtCount(pagoRes.count)}`);
    lines.push(`- Repasses estornados: ${fmtCount(estornadoRes.count)}`);

    const amostra = amostraRes.data ?? [];
    if (amostra.length > 0) {
      lines.push(`- Repasses mais recentes (ate ${CONTEXT_SAMPLE_LIMIT}):`);
      for (const r of amostra) {
        lines.push(
          `  - ${r.status} | bruto R$ ${r.valor_bruto} | liquido R$ ${r.valor_liquido} | comissao R$ ${
            r.commission_value
          } | fechado ${r.closed_at}${r.paid_at ? ` | pago ${r.paid_at}` : ''}`
        );
      }
    }
    return lines.join('\n');
  } catch (err) {
    return blockUnavailable('Pagamentos / Financeiro', err);
  }
}

/** Bloco: erros de frontend recentes (error_logs) — contagem 24h + amostra. */
async function ctxErrors(sb: SupabaseClient): Promise<string> {
  try {
    const dayAgo = isoAgo(MS_PER_DAY);
    const [recentRes, amostraRes] = await Promise.all([
      sb.from('error_logs').select('id', { count: 'exact', head: true }).gte('occurred_at', dayAgo),
      sb
        .from('error_logs')
        .select('error_type, route, message, occurred_at')
        .order('occurred_at', { ascending: false })
        .limit(CONTEXT_SAMPLE_LIMIT),
    ]);

    const lines: string[] = ['## Erros do site / console (error_logs)'];
    lines.push(`- Erros nas ultimas 24h: ${fmtCount(recentRes.count)}`);

    const amostra = amostraRes.data ?? [];
    if (amostra.length > 0) {
      lines.push(`- Erros mais recentes (ate ${CONTEXT_SAMPLE_LIMIT}):`);
      for (const e of amostra) {
        const msg = typeof e.message === 'string' ? e.message.slice(0, 200) : '(sem mensagem)';
        lines.push(`  - [${e.error_type}] ${e.route ?? '(rota?)'} | ${msg} | ${e.occurred_at}`);
      }
    } else {
      lines.push('- Nenhum erro recente registrado.');
    }
    return lines.join('\n');
  } catch (err) {
    return blockUnavailable('Erros do site / console', err);
  }
}

/** Bloco: eventos criticos recentes detectados pelo monitor. */
async function ctxCriticalEvents(sb: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await sb
      .from('assistant_critical_events')
      .select('event_type, severity, summary, scope, detected_at')
      .order('detected_at', { ascending: false })
      .limit(CONTEXT_SAMPLE_LIMIT);

    if (error) return blockUnavailable('Eventos criticos', error);

    const lines: string[] = ['## Eventos criticos recentes'];
    const amostra = data ?? [];
    if (amostra.length > 0) {
      for (const ev of amostra) {
        lines.push(
          `  - [${ev.severity}] ${ev.event_type} (${ev.scope}) | ${ev.summary} | ${ev.detected_at}`
        );
      }
    } else {
      lines.push('- Nenhum evento critico recente.');
    }
    return lines.join('\n');
  } catch (err) {
    return blockUnavailable('Eventos criticos', err);
  }
}

/**
 * Context_Builder real (Req 5.1, 5.2). Consulta dados REAIS via service-role
 * client e monta um bloco textual de contexto, SEM mascara (decisao consciente
 * do dono — ver nota de seguranca acima). As consultas sao bounded (LIMIT) e
 * cada bloco e isolado por Promise.allSettled: uma fonte indisponivel degrada
 * apenas o proprio bloco. O contexto e relevante a pergunta do dono porem um
 * snapshot geral solido e suficiente para esta entrega.
 */
async function buildContext(userMessage: string, sb: SupabaseClient): Promise<string> {
  const header = [
    'Voce e o assistente de IA pessoal do dono do FreteGO (Master Admin).',
    'Responda em pt-BR, de forma objetiva e tecnica, com base no snapshot real abaixo.',
    'Os dados abaixo vem direto do banco do FreteGO (Supabase), SEM mascara de PII —',
    'decisao consciente do dono. Se a pergunta exigir um recorte que NAO esta no',
    'snapshot, diga claramente o que falta em vez de inventar numeros.',
    '',
    `Pergunta do dono: ${userMessage}`,
    '',
    `Snapshot gerado em ${new Date().toISOString()}:`,
  ].join('\n');

  // Cada bloco e auto-contido e tolerante a falha; allSettled e uma camada
  // extra de seguranca caso um bloco lance algo inesperado.
  const settled = await Promise.allSettled([
    ctxUsers(sb),
    ctxFretes(sb),
    ctxPayments(sb),
    ctxErrors(sb),
    ctxCriticalEvents(sb),
  ]);

  const body = settled
    .map((r) => (r.status === 'fulfilled' ? r.value : blockUnavailable('Bloco', r.reason)))
    .join('\n\n');

  return `${header}\n\n${body}`;
}

/**
 * Carrega o historico persistido de uma conversa (`assistant_messages`) em
 * ordem cronologica ASC (Req 5.7 / task 8.1 TODO), filtrando para o dominio
 * fechado de `ChatRole`. Bounded por CONTEXT_HISTORY_LIMIT. Conversa nula
 * (ex.: chamada do monitor ou primeira mensagem) ou falha de leitura => [].
 */
async function loadConversationHistory(
  sb: SupabaseClient,
  conversationId: string | null | undefined
): Promise<{ role: ChatRole; content: string }[]> {
  if (!conversationId) return [];
  try {
    const { data, error } = await sb
      .from('assistant_messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(CONTEXT_HISTORY_LIMIT);

    if (error || !Array.isArray(data)) return [];

    const messages: { role: ChatRole; content: string }[] = [];
    for (const row of data) {
      const role = row.role;
      if (
        (role === 'user' || role === 'assistant' || role === 'system') &&
        typeof row.content === 'string'
      ) {
        messages.push({ role, content: row.content });
      }
    }
    return messages;
  } catch {
    return [];
  }
}

// ===================== Auth (verify_jwt=true + ASSISTANT_VIEW) =============

/**
 * Confirma que o JWT do caller tem a permissao ASSISTANT_VIEW, consultando
 * `is_admin_with_permission` via REST com o MESMO JWT (Owner_Only_Gate em
 * duas camadas). O gateway ja validou o JWT (verify_jwt=true); aqui checamos
 * a permissao server-side.
 */
async function callerHasAssistantView(authHeader: string): Promise<boolean> {
  if (!SUPABASE_URL || !ANON_KEY) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin_with_permission`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_action: 'ASSISTANT_VIEW' }),
    });
    if (!resp.ok) return false;
    const allowed = await resp.json();
    return allowed === true;
  } catch {
    return false;
  }
}

// ===================== Handler =============================================

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Auth: aceita Bearer SERVICE_ROLE_KEY (chamada interna do assistant-monitor)
  // OU JWT de admin com ASSISTANT_VIEW (chamada do browser via
  // supabase.functions.invoke). Owner_Only_Gate.
  const auth = req.headers.get('Authorization') ?? '';
  const isServiceRole = SERVICE_ROLE_KEY !== '' && auth === `Bearer ${SERVICE_ROLE_KEY}`;

  let authorized = isServiceRole;
  if (!authorized && auth.startsWith('Bearer ')) {
    authorized = await callerHasAssistantView(auth);
  }
  if (!authorized) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const userMessage = payload.userMessage;
  if (typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return json({ error: 'userMessage ausente ou invalido' }, 400);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Config de ambiente ausente — nao expoe detalhe de segredo.
    return json({ error: 'server_misconfigured' }, 500);
  }

  // Service-role client: le config + Vault server-side (a chave NUNCA vai ao
  // frontend — Req 7.5 / 8.7).
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Active_Provider + model.
  const { activeProvider, model } = await readAssistantConfig(supabase);

  // 2. Contexto montado com dados reais do Supabase (Context_Builder, task 8.2).
  const context = await buildContext(userMessage, supabase);

  // 3. Mensagens enviadas ao provider: historico persistido da conversa
  //    (`conversationId`) em ordem cronologica ASC + a mensagem atual do
  //    usuario ao final (task 8.2; resolve o TODO da task 8.1). Conversa nula
  //    ou sem historico => apenas a mensagem atual.
  const history = await loadConversationHistory(supabase, payload.conversationId);
  const input: AiInvokeInput = {
    context,
    messages: [...history, { role: 'user', content: userMessage }],
  };

  // 4. Seleciona o cliente do Active_Provider (Provider_Abstraction).
  const client = selectProviderClient(activeProvider, model);

  // 5. Le a chave SO quando o provider exige (stubs nao tocam segredos).
  let apiKey = '';
  if (client.requiresApiKey) {
    const key = await readProviderKeyFromVault(supabase, activeProvider);
    if (!key) {
      // Chave ausente no Vault => erro tipado, sem expor segredo (Req 8.7/7.7).
      return json({ ok: false, error: 'missing_api_key', provider: activeProvider }, 200);
    }
    apiKey = key;
  }

  // 6. Invoca o provider. Falha do Claude => `provider_call_failed` tipado,
  //    sem fallback (Req 8.3). Stubs => `provider_not_implemented` (Req 8.5).
  const result = await client.invoke(input, apiKey);

  // O resultado tipado segue para o Assistant_Service; falhas de provider
  // retornam 200 com `{ ok: false, error }` (o service interpreta). Nenhum
  // campo da resposta contem segredo.
  return json(result, 200);
});
