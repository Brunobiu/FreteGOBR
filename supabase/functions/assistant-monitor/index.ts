// ============================================================================
// Edge Function: assistant-monitor
// ============================================================================
// Spec: .kiro/specs/admin-assistant/{requirements,design,tasks}.md
//   Task 8.3 — Monitor_Edge_Function: coleta, classifica, persiste, publica.
//   Requirements: 9.4, 9.5, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8,
//                 13.3, 13.4, 13.6.
//
// Responsabilidade desta function (monitoramento autonomo no servidor —
// Req 12, design.md secao 7 "Monitor_Edge_Function" + secao 8 Event_Classifier):
//   1. Invocada pelo Cron_Job (pg_cron) via net.http_post com Bearer
//      SERVICE_ROLE_KEY; a function valida esse Bearer (Owner-server-only).
//   2. Le a Assistant_Config (thresholds, cron_interval, whatsapp_toggle).
//   3. Coleta DEFENSIVAMENTE os sinais recentes na janela de avaliacao
//      (Req 12.2): contagens de error_logs por tipo (page_error_rate /
//      request_failure_rate), falhas de login por IP, tentativas de acesso
//      nao autorizado, falhas de pagamento e queda de desempenho do banco.
//      Toda fonte que pode nao existir/estar aplicada degrada para 0/empty
//      via try/catch — NUNCA quebra a execucao (Req 12.6).
//   4. Monta `ClassifierSignals` e roda o `classifyEvents` PURO/DETERMINISTICO.
//   5. Para cada Critical_Event ainda NAO notificado (dedup por `dedup_key`,
//      chave estavel `type:scope:timeBucket` — Req 12.7):
//        - cria a Chat_Conversation + publica a Chat_Message `assistant`
//          automatica (buildCriticalMessage: o que / onde / sugestao, SEM
//          remediacao — Req 12.4);
//        - persiste o Critical_Event via rpc_assistant_persist_critical_event
//          (ON CONFLICT (dedup_key) DO NOTHING — Req 12.3/12.7), vinculando a
//          conversa onde a mensagem foi publicada;
//        - o Highlight do Mural e DERIVADO da linha do Critical_Event
//          (summarizeHighlight, no read-time da UI) — nao ha tabela propria;
//        - loga ASSISTANT_CRITICAL_EVENT_DETECTED em admin_audit_logs
//          (Req 12.8);
//        - WhatsApp_Dispatcher.dispatch(): NO-OP enquanto whatsapp_toggle e
//          false (Req 13.3/13.4); seam pronto para a futura Evolution API
//          (Req 13.6) — nada e enviado.
//   6. Common_Event (newSignups / postedFretes) => NAO persiste, NAO publica,
//      NAO chama IA (Req 9.4). Nenhum Critical_Event => conclui sem publicar
//      nem invocar provedor (Req 9.5 / 12.5).
//   7. try/catch POR EVENTO: a falha de um evento nunca interrompe os demais
//      nem as execucoes agendadas futuras (Req 12.6).
//
// ----------------------------------------------------------------------------
// DUPLICACAO INTENCIONAL (mesma decisao de design que `assistant-ai` espelhar
// `assistantProvider.ts`): este arquivo ESPELHA, no runtime Deno, a logica
// PURA canonica de `src/services/admin/assistantClassifier.ts` (classifyEvents)
// e os helpers de evento critico de `src/services/admin/assistant.ts`
// (buildCriticalMessage / dedupNewEvents / whatsappDispatch). A fonte canonica
// TypeScript e exercitada por testes de propriedade (Vitest + fast-check,
// CP-15..CP-25). As Edge Functions rodam em Deno; para evitar um passo de
// build cross-runtime sem divergir do contrato, a especificacao deterministica
// e COPIADA aqui. Mantenha os dois lados em sincronia: qualquer mudanca na
// regra de classificacao/dedup deve ser refletida em ambos.
// ----------------------------------------------------------------------------
//
// Deploy (verify_jwt = FALSE — chamada via pg_net do Cron_Job injeta o
// SERVICE_ROLE como Bearer, NAO um JWT de user; a validacao ocorre dentro
// desta function checando o Bearer, mesmo padrao de send-push-notification):
//   supabase functions deploy assistant-monitor --no-verify-jwt
//
// Env vars necessarias:
//   SUPABASE_URL                (auto-injetado)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injetado) — le config + sinais + grava
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ===================== Dominios fechados (espelho de assistant.ts) ==========

type CriticalEventType =
  | 'page_error_rate'
  | 'request_failure_rate'
  | 'unauthorized_access_attempt'
  | 'failed_login_burst'
  | 'payment_failure'
  | 'db_performance_drop';

type Severity = 'info' | 'warning' | 'critical';

/**
 * Evento detectado pelo Event_Classifier. Espelho de `DetectedEvent` de
 * `src/services/admin/assistant.ts`. Cada evento carrega tipo no dominio
 * fechado, severidade, resumo e escopo (ex.: `ip:1.2.3.4` ou `global`).
 */
interface DetectedEvent {
  type: CriticalEventType;
  severity: Severity;
  summary: string;
  scope: string;
}

// ===================== Event_Classifier (espelho canonico) ==================
//
// Espelho 1:1 de `src/services/admin/assistantClassifier.ts`. Logica PURA e
// DETERMINISTICA: mesma entrada produz sempre a mesma saida (Req 9.1), sem
// I/O, sem relogio, sem aleatoriedade.

/** Limites configuraveis (Critical_Threshold) por tipo baseado em contagem. */
interface ThresholdConfig {
  page_error_rate: number; // >= 1
  request_failure_rate: number; // >= 1
  failed_login_burst: number; // >= 1
}

/**
 * Sinais agregados coletados na janela de avaliacao. `failedLoginsByIp`
 * mapeia cada IP a sua contagem (NAO somada entre IPs). `newSignups`/
 * `postedFretes` sao Common_Event e estao presentes apenas para deixar
 * explicito que sao ignorados (Req 9.3).
 */
interface ClassifierSignals {
  pageErrorCount: number;
  requestFailureCount: number;
  failedLoginsByIp: Record<string, number>;
  unauthorizedAccessCount: number;
  paymentFailureCount: number;
  dbPerformanceDrop: boolean;
  newSignups: number;
  postedFretes: number;
}

/**
 * Severidade canonica por Critical_Event_Type (estavel/deterministica).
 * Espelha SEVERITY_BY_TYPE do modulo canonico.
 */
const SEVERITY_BY_TYPE: Record<CriticalEventType, Severity> = {
  page_error_rate: 'warning',
  request_failure_rate: 'warning',
  unauthorized_access_attempt: 'critical',
  failed_login_burst: 'critical',
  payment_failure: 'critical',
  db_performance_drop: 'warning',
};

/**
 * Classifica os sinais agregados em zero ou mais Critical_Event. Espelho
 * exato de `classifyEvents` do modulo canonico (ver design.md secao 8 e
 * Reqs 9/10/11). Pura e deterministica; ordem de saida estavel (tipos em
 * ordem fixa; bursts de login ordenados por IP).
 */
function classifyEvents(signals: ClassifierSignals, thresholds: ThresholdConfig): DetectedEvent[] {
  const events: DetectedEvent[] = [];

  // 1. page_error_rate — bicondicional por threshold (Req 10.2/10.3).
  if (signals.pageErrorCount >= thresholds.page_error_rate) {
    events.push({
      type: 'page_error_rate',
      severity: SEVERITY_BY_TYPE.page_error_rate,
      summary: `Taxa de erros de pagina elevada: ${signals.pageErrorCount} erro(s) na janela (limite ${thresholds.page_error_rate}).`,
      scope: 'global',
    });
  }

  // 2. request_failure_rate — bicondicional por threshold (Req 10.2/10.3).
  if (signals.requestFailureCount >= thresholds.request_failure_rate) {
    events.push({
      type: 'request_failure_rate',
      severity: SEVERITY_BY_TYPE.request_failure_rate,
      summary: `Taxa de falhas de requisicao elevada: ${signals.requestFailureCount} falha(s) na janela (limite ${thresholds.request_failure_rate}).`,
      scope: 'global',
    });
  }

  // 3. unauthorized_access_attempt — presenca do sinal dispara (Req 11.1).
  if (signals.unauthorizedAccessCount > 0) {
    events.push({
      type: 'unauthorized_access_attempt',
      severity: SEVERITY_BY_TYPE.unauthorized_access_attempt,
      summary: `Tentativa(s) de acesso nao autorizado a rotas protegidas: ${signals.unauthorizedAccessCount} ocorrencia(s).`,
      scope: 'global',
    });
  }

  // 4. failed_login_burst — avaliado POR IP; cada IP cuja contagem >=
  //    threshold gera um evento proprio (scope = ip:<addr>). IPs distintos
  //    NAO sao somados (Req 11.2/11.3/11.4). Ordenacao por IP => saida estavel.
  const ips = Object.keys(signals.failedLoginsByIp).sort();
  for (const ip of ips) {
    const count = signals.failedLoginsByIp[ip];
    if (count >= thresholds.failed_login_burst) {
      events.push({
        type: 'failed_login_burst',
        severity: SEVERITY_BY_TYPE.failed_login_burst,
        summary: `Rajada de falhas de login do IP ${ip}: ${count} tentativa(s) na janela (limite ${thresholds.failed_login_burst}).`,
        scope: `ip:${ip}`,
      });
    }
  }

  // 5. payment_failure — presenca do sinal dispara (Req 11.5).
  if (signals.paymentFailureCount > 0) {
    events.push({
      type: 'payment_failure',
      severity: SEVERITY_BY_TYPE.payment_failure,
      summary: `Falha(s) no processamento de pagamento: ${signals.paymentFailureCount} ocorrencia(s).`,
      scope: 'global',
    });
  }

  // 6. db_performance_drop — flag verdadeira dispara (Req 11.6).
  if (signals.dbPerformanceDrop) {
    events.push({
      type: 'db_performance_drop',
      severity: SEVERITY_BY_TYPE.db_performance_drop,
      summary: 'Queda subita de desempenho do banco de dados detectada na janela.',
      scope: 'global',
    });
  }

  // newSignups/postedFretes sao Common_Event: nunca geram eventos (Req 9.3).
  return events;
}

// ===================== Helpers de evento critico (espelho de assistant.ts) ==
//
// Espelho da logica pura de evento critico (task 3.5 do modulo canonico):
// buildCriticalMessage, dedupNewEvents e whatsappDispatch.

/** Rotulos pt-BR glanceaveis por tipo (espelha CRITICAL_CATEGORY_LABELS). */
const CRITICAL_CATEGORY_LABELS: Record<CriticalEventType, string> = {
  page_error_rate: 'Erros de pagina',
  request_failure_rate: 'Falhas de requisicao',
  unauthorized_access_attempt: 'Acesso nao autorizado',
  failed_login_burst: 'Rajada de falhas de login',
  payment_failure: 'Falha de pagamento',
  db_performance_drop: 'Queda de desempenho do banco',
};

/**
 * Sugestao de correcao (apenas ORIENTACAO; NUNCA remediacao automatica —
 * Req 12.4) por Critical_Event_Type. Texto pt-BR, deterministico.
 */
const CRITICAL_SUGGESTIONS: Record<CriticalEventType, string> = {
  page_error_rate:
    'Investigue os Error_Log recentes (boundary/window/console) na rota afetada e priorize a correcao do erro de maior recorrencia.',
  request_failure_rate:
    'Verifique a saude das APIs/RPCs e a conectividade do Supabase; analise os request_failure recentes para identificar o endpoint problematico.',
  unauthorized_access_attempt:
    'Revise os logs de acesso e as policies/guards das rotas protegidas; confirme se houve tentativa de bypass de autorizacao.',
  failed_login_burst:
    'Avalie bloquear temporariamente o IP de origem e reforcar o rate limiting; confirme se nao e um ataque de brute force.',
  payment_failure:
    'Verifique a integracao de pagamento e os repasses recentes; reconcilie as transacoes com falha antes de novas cobrancas.',
  db_performance_drop:
    'Inspecione queries lentas, locks e uso de conexoes; considere indices ausentes e a carga atual do banco.',
};

/**
 * Monta a mensagem automatica `assistant` de um Critical_Event (Req 12.4).
 *
 * Espelho de `buildCriticalMessage` do modulo canonico. PURA e SEM
 * remediacao: descreve O QUE aconteceu (resumo/categoria), ONDE ocorreu
 * (`scope`) e uma SUGESTAO de correcao (apenas orientacao). Nunca aplica
 * nem executa qualquer correcao.
 */
function buildCriticalMessage(event: DetectedEvent): string {
  const category = CRITICAL_CATEGORY_LABELS[event.type] ?? 'Evento critico';
  const scope = event.scope && event.scope.trim().length > 0 ? event.scope : 'global';
  const summary =
    event.summary && event.summary.trim().length > 0
      ? event.summary
      : `${category} detectado em ${scope}`;
  const suggestion =
    CRITICAL_SUGGESTIONS[event.type] ?? 'Investigue o evento e avalie a correcao adequada.';

  return [
    `[${category}] Evento critico detectado.`,
    `O que aconteceu: ${summary}`,
    `Onde: ${scope}`,
    `Sugestao: ${suggestion}`,
  ].join('\n');
}

/**
 * Filtra os eventos ainda NAO notificados, comparando `dedup_key` contra o
 * conjunto ja conhecido (Req 12.7). Espelho de `dedupNewEvents` do modulo
 * canonico: idempotente — nunca retorna um `dedup_key` ja presente em
 * `already`, e deduplica colisoes dentro do proprio lote.
 */
function dedupNewEvents(
  already: Set<string>,
  batch: { event: DetectedEvent; dedupKey: string }[]
): { event: DetectedEvent; dedupKey: string }[] {
  const seen = new Set<string>(already);
  const result: { event: DetectedEvent; dedupKey: string }[] = [];
  for (const item of batch) {
    if (!seen.has(item.dedupKey)) {
      seen.add(item.dedupKey);
      result.push(item);
    }
  }
  return result;
}

/**
 * Resultado tipado de um despacho de WhatsApp. Espelha o seam canonico.
 */
type WhatsappDispatchResult = { sent: false; reason: 'toggle_off' | 'not_implemented' };

/**
 * WhatsApp_Dispatcher (seam) — NO-OP enquanto o toggle esta desligado
 * (Req 13.3/13.4). Espelho de `whatsappDispatch` do modulo canonico.
 *
 * Esta entrega NUNCA envia nada: quando `whatsappToggle` e false retorna
 * `{ sent: false, reason: 'toggle_off' }`; mesmo com toggle ligado, o canal
 * real (Evolution API — Req 13.6) ainda nao esta implementado e retorna
 * `{ sent: false, reason: 'not_implemented' }`. O seam fica pronto para a
 * spec futura conectar o envio sem alterar o fluxo de deteccao.
 */
function whatsappDispatch(
  _event: DetectedEvent,
  opts: { whatsappToggle: boolean }
): WhatsappDispatchResult {
  if (!opts.whatsappToggle) {
    return { sent: false, reason: 'toggle_off' };
  }
  // TODO(spec futura Evolution API — Req 13.6): conectar o envio real aqui.
  // Nenhum envio ocorre nesta entrega.
  return { sent: false, reason: 'not_implemented' };
}

// ===================== Env + helpers de I/O ================================

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Username imutavel do Master_Admin (Bruno Henrique) — ver convencoes. */
const MASTER_ADMIN_USERNAME = 'Nexus_Vortex99';

/** Defaults seguros de thresholds (espelham os defaults de assistant_config). */
const DEFAULT_THRESHOLDS: ThresholdConfig = {
  page_error_rate: 10,
  request_failure_rate: 10,
  failed_login_burst: 5,
};
const DEFAULT_CRON_INTERVAL_MIN = 1;

/** Tipos de Error_Log que contam para `page_error_rate` (tudo exceto request). */
const PAGE_ERROR_TYPES = [
  'react_render',
  'window_error',
  'unhandled_rejection',
  'console_error',
] as const;

interface MonitorConfig {
  thresholds: ThresholdConfig;
  cronIntervalMinutes: number;
  whatsappToggle: boolean;
}

// ===================== Leitura da config ===================================

/**
 * Le o registro unico de `assistant_config` (thresholds + intervalo do cron +
 * whatsapp_toggle). Em qualquer falha cai em defaults seguros para nao
 * derrubar a execucao agendada (Req 12.6).
 */
async function readMonitorConfig(sb: SupabaseClient): Promise<MonitorConfig> {
  try {
    const { data } = await sb
      .from('assistant_config')
      .select(
        'threshold_page_error_rate, threshold_request_failure_rate, threshold_failed_login_burst, cron_interval_minutes, whatsapp_toggle'
      )
      .eq('id', true)
      .maybeSingle();

    const toThreshold = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fallback;

    const cron =
      typeof data?.cron_interval_minutes === 'number' &&
      Number.isInteger(data.cron_interval_minutes) &&
      data.cron_interval_minutes >= 1 &&
      data.cron_interval_minutes <= 5
        ? data.cron_interval_minutes
        : DEFAULT_CRON_INTERVAL_MIN;

    return {
      thresholds: {
        page_error_rate: toThreshold(
          data?.threshold_page_error_rate,
          DEFAULT_THRESHOLDS.page_error_rate
        ),
        request_failure_rate: toThreshold(
          data?.threshold_request_failure_rate,
          DEFAULT_THRESHOLDS.request_failure_rate
        ),
        failed_login_burst: toThreshold(
          data?.threshold_failed_login_burst,
          DEFAULT_THRESHOLDS.failed_login_burst
        ),
      },
      cronIntervalMinutes: cron,
      whatsappToggle: data?.whatsapp_toggle === true,
    };
  } catch {
    return {
      thresholds: { ...DEFAULT_THRESHOLDS },
      cronIntervalMinutes: DEFAULT_CRON_INTERVAL_MIN,
      whatsappToggle: false,
    };
  }
}

// ===================== Coleta DEFENSIVA de sinais ==========================
//
// Cada coletor e isolado em try/catch e degrada para 0/empty/false quando a
// fonte nao existe ou a query falha (tabela nao aplicada, coluna ausente,
// permissao). Isso garante que UMA fonte indisponivel nunca quebra a execucao
// (Req 12.6) — o classificador roda com os sinais disponiveis.

/** Conta Error_Log de `page_error_rate` (tipos != request_failure) na janela. */
async function collectPageErrorCount(sb: SupabaseClient, sinceIso: string): Promise<number> {
  try {
    const { count, error } = await sb
      .from('error_logs')
      .select('id', { count: 'exact', head: true })
      .in('error_type', PAGE_ERROR_TYPES as unknown as string[])
      .gte('occurred_at', sinceIso);
    if (error) return 0;
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

/** Conta Error_Log de `request_failure` na janela (request_failure_rate). */
async function collectRequestFailureCount(sb: SupabaseClient, sinceIso: string): Promise<number> {
  try {
    const { count, error } = await sb
      .from('error_logs')
      .select('id', { count: 'exact', head: true })
      .eq('error_type', 'request_failure')
      .gte('occurred_at', sinceIso);
    if (error) return 0;
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Agrega falhas de login POR IP na janela a partir de `login_attempts`
 * (success=false). NAO soma IPs distintos (Req 11.4). Fonte pode nao existir
 * em alguns ambientes => degrada para {} via try/catch.
 */
async function collectFailedLoginsByIp(
  sb: SupabaseClient,
  sinceIso: string
): Promise<Record<string, number>> {
  try {
    const { data, error } = await sb
      .from('login_attempts')
      .select('ip_address')
      .eq('success', false)
      .gte('created_at', sinceIso)
      .limit(10000);
    if (error || !Array.isArray(data)) return {};

    const byIp: Record<string, number> = {};
    for (const row of data) {
      const ip = (row as { ip_address?: unknown }).ip_address;
      // Ignora linhas sem IP legivel (nao da para atribuir a um escopo).
      if (typeof ip === 'string' && ip.length > 0) {
        byIp[ip] = (byIp[ip] ?? 0) + 1;
      }
    }
    return byIp;
  } catch {
    return {};
  }
}

/**
 * Conta tentativas de acesso nao autorizado na janela. Nao ha fonte dedicada
 * garantida nesta entrega: tenta `error_logs` cuja mensagem/rota indique
 * negacao de acesso (heuristica defensiva). Degrada para 0 em qualquer falha.
 */
async function collectUnauthorizedAccessCount(
  sb: SupabaseClient,
  sinceIso: string
): Promise<number> {
  try {
    const { count, error } = await sb
      .from('error_logs')
      .select('id', { count: 'exact', head: true })
      .eq('error_type', 'request_failure')
      .gte('occurred_at', sinceIso)
      // PostgREST .or(): wildcards de ilike usam `*` (nao `%`).
      .or(
        'message.ilike.*403*,message.ilike.*401*,message.ilike.*permission_denied*,message.ilike.*unauthorized*'
      );
    if (error) return 0;
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Conta falhas de pagamento na janela. Nao ha tabela de pagamentos dedicada
 * garantida; usa `financial_repasses` com status `estornado` (repasse
 * revertido) como sinal defensivo. Fonte pode nao existir => degrada para 0.
 */
async function collectPaymentFailureCount(sb: SupabaseClient, sinceIso: string): Promise<number> {
  try {
    const { count, error } = await sb
      .from('financial_repasses')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'estornado')
      .gte('reverted_at', sinceIso);
    if (error) return 0;
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Detecta queda subita de desempenho do banco na janela. Nao ha fonte de
 * metricas de desempenho garantida nesta entrega; retorna `false`
 * (degradacao segura) ate uma spec futura prover o sinal. Isolado em
 * try/catch por simetria e robustez.
 */
async function collectDbPerformanceDrop(_sb: SupabaseClient, _sinceIso: string): Promise<boolean> {
  try {
    // Sem fonte de metricas confiavel: nao dispara (false). Seam pronto para
    // futura instrumentacao (ex.: pg_stat_statements / health checks).
    return false;
  } catch {
    return false;
  }
}

/**
 * Coleta todos os sinais recentes da janela e monta o `ClassifierSignals`
 * (Req 12.2). Cada coletor degrada isoladamente; `newSignups`/`postedFretes`
 * sao Common_Event e ficam zerados (o classificador os ignora — Req 9.3/9.4).
 */
async function collectSignals(sb: SupabaseClient, sinceIso: string): Promise<ClassifierSignals> {
  const [
    pageErrorCount,
    requestFailureCount,
    failedLoginsByIp,
    unauthorizedAccessCount,
    paymentFailureCount,
    dbPerformanceDrop,
  ] = await Promise.all([
    collectPageErrorCount(sb, sinceIso),
    collectRequestFailureCount(sb, sinceIso),
    collectFailedLoginsByIp(sb, sinceIso),
    collectUnauthorizedAccessCount(sb, sinceIso),
    collectPaymentFailureCount(sb, sinceIso),
    collectDbPerformanceDrop(sb, sinceIso),
  ]);

  return {
    pageErrorCount,
    requestFailureCount,
    failedLoginsByIp,
    unauthorizedAccessCount,
    paymentFailureCount,
    dbPerformanceDrop,
    // Common_Event: deliberadamente zerados (nunca disparam — Req 9.3).
    newSignups: 0,
    postedFretes: 0,
  };
}

// ===================== Dedup key (type:scope:timeBucket) ====================

/**
 * Constroi a `dedup_key` estavel de um evento na janela de avaliacao
 * (Req 12.7). Formato `type:scope:timeBucket`, onde o `timeBucket` e o numero
 * da janela atual (floor(now / windowMs)). Reexecucoes do cron dentro da mesma
 * janela produzem a MESMA chave => o ON CONFLICT (dedup_key) DO NOTHING e o
 * pre-check evitam republicar o evento.
 */
function buildDedupKey(event: DetectedEvent, nowMs: number, windowMs: number): string {
  const bucket = Math.floor(nowMs / windowMs);
  return `${event.type}:${event.scope}:${bucket}`;
}

// ===================== Resolucao do admin_id para auditoria =================

/**
 * Resolve o `admin_id` usado no audit log do monitor. `admin_audit_logs.admin_id`
 * e NOT NULL e referencia `users(id)`, mas o monitor roda como service-role
 * sem `auth.uid()`. Usa o Master_Admin (username imutavel `Nexus_Vortex99`);
 * fallback para qualquer SUPER_ADMIN ativo. Retorna null se nada for
 * resolvido (o caller entao pula o audit de forma defensiva).
 */
async function resolveAuditAdminId(sb: SupabaseClient): Promise<string | null> {
  try {
    const { data: master } = await sb
      .from('users')
      .select('id')
      .eq('admin_username', MASTER_ADMIN_USERNAME)
      .limit(1)
      .maybeSingle();
    const masterId = (master as { id?: unknown } | null)?.id;
    if (typeof masterId === 'string' && masterId.length > 0) return masterId;
  } catch {
    // cai para o fallback
  }

  try {
    const { data: superAdmin } = await sb
      .from('admin_roles')
      .select('user_id')
      .eq('role', 'SUPER_ADMIN')
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle();
    const uid = (superAdmin as { user_id?: unknown } | null)?.user_id;
    if (typeof uid === 'string' && uid.length > 0) return uid;
  } catch {
    // sem admin resolvivel
  }

  return null;
}

// ===================== Publicacao de um Critical_Event =====================
//
// IMPORTANTE (decisao de design / restricao real):
//   A RPC canonica `rpc_assistant_post_message` e gated por ASSISTANT_VIEW e
//   exige `auth.uid()` nao nulo (GRANT apenas a `authenticated`). O monitor
//   roda como SERVICE-ROLE (sem auth.uid()), logo NAO pode chama-la. Assim, o
//   monitor cria a Chat_Conversation e publica a Chat_Message `assistant`
//   DIRETAMENTE via service-role (RLS bypassada por design, mesmo padrao do
//   send-push-notification), espelhando o comportamento da RPC: insere a
//   mensagem e toca `updated_at` da conversa. O Critical_Event continua sendo
//   persistido pela RPC server-only `rpc_assistant_persist_critical_event`
//   (concedida a service_role), preservando o dedup idempotente.

interface PublishOutcome {
  persisted: boolean;
  conversationId: string | null;
  criticalEventId: string | null;
}

/**
 * Cria a conversa, publica a mensagem automatica e persiste o Critical_Event
 * com dedup idempotente. Lanca em falha de banco para que o caller registre o
 * erro do evento sem interromper os demais (try/catch por evento — Req 12.6).
 */
async function publishCriticalEvent(
  sb: SupabaseClient,
  event: DetectedEvent,
  dedupKey: string
): Promise<PublishOutcome> {
  const category = CRITICAL_CATEGORY_LABELS[event.type] ?? 'Evento critico';

  // 1. Cria a Chat_Conversation onde a mensagem automatica sera publicada.
  const { data: conv, error: convErr } = await sb
    .from('assistant_conversations')
    .insert({ title: `${category} — ${event.scope}`.slice(0, 60) })
    .select('id')
    .single();
  if (convErr || !conv) {
    throw new Error(`conversation_insert_failed: ${convErr?.message ?? 'unknown'}`);
  }
  const conversationId = (conv as { id: string }).id;

  // 2. Publica a Chat_Message `assistant` (buildCriticalMessage: o que / onde /
  //    sugestao, SEM remediacao — Req 12.3/12.4). Espelha rpc_assistant_post_message.
  const content = buildCriticalMessage(event);
  const { error: msgErr } = await sb
    .from('assistant_messages')
    .insert({ conversation_id: conversationId, role: 'assistant', content });
  if (msgErr) {
    throw new Error(`message_insert_failed: ${msgErr.message}`);
  }

  // Toca updated_at da conversa (mantem a ordenacao DESC do mural/lista),
  // espelhando o comportamento da RPC canonica.
  await sb
    .from('assistant_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  // 3. Persiste o Critical_Event via RPC server-only com dedup idempotente
  //    (ON CONFLICT (dedup_key) DO NOTHING — Req 12.3/12.7), vinculando a
  //    conversa onde a mensagem foi publicada. O Highlight do Mural e DERIVADO
  //    desta linha (summarizeHighlight, no read-time) — nao ha tabela propria.
  const { data: persistRes, error: persistErr } = await sb.rpc(
    'rpc_assistant_persist_critical_event',
    {
      p_event: {
        event_type: event.type,
        severity: event.severity,
        summary: event.summary,
        scope: event.scope,
        dedup_key: dedupKey,
        conversation_id: conversationId,
      },
    }
  );
  if (persistErr) {
    throw new Error(`persist_critical_event_failed: ${persistErr.message}`);
  }

  const persisted = (persistRes as { persisted?: unknown } | null)?.persisted === true;
  const criticalEventId =
    typeof (persistRes as { id?: unknown } | null)?.id === 'string'
      ? (persistRes as { id: string }).id
      : null;

  return { persisted, conversationId, criticalEventId };
}

// ===================== Handler =============================================

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Auth: aceita exclusivamente Bearer SERVICE_ROLE_KEY (chamada do Cron_Job
  // via pg_net). Owner-server-only — nenhuma sessao de usuario invoca o monitor.
  const auth = req.headers.get('Authorization') ?? '';
  if (!SERVICE_ROLE_KEY || auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  // Service-role client: le config + sinais e grava conversas/mensagens/eventos
  // server-side (RLS bypassada por design — mesmo padrao do send-push-notification).
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Config (thresholds + janela + whatsapp_toggle).
  const config = await readMonitorConfig(supabase);
  const windowMs = config.cronIntervalMinutes * 60_000;
  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - windowMs).toISOString();

  // 2. Coleta DEFENSIVA dos sinais recentes na janela (Req 12.2).
  const signals = await collectSignals(supabase, sinceIso);

  // 3. Classificacao pura/deterministica (Req 9.1).
  const detected = classifyEvents(signals, config.thresholds);

  // Nenhum Critical_Event => conclui sem publicar nem invocar IA (Req 9.5/12.5).
  if (detected.length === 0) {
    return json({ ok: true, detected: 0, published: 0, deduped: 0 });
  }

  // 4. Constroi dedup_keys estaveis e descobre quais ja foram notificados na
  //    janela (pre-check + dedupNewEvents — Req 12.7), evitando recriar
  //    conversas para eventos ja publicados.
  const candidates = detected.map((event) => ({
    event,
    dedupKey: buildDedupKey(event, nowMs, windowMs),
  }));

  let alreadyNotified = new Set<string>();
  try {
    const keys = candidates.map((c) => c.dedupKey);
    const { data: existing } = await supabase
      .from('assistant_critical_events')
      .select('dedup_key')
      .in('dedup_key', keys);
    if (Array.isArray(existing)) {
      alreadyNotified = new Set(
        existing
          .map((r) => (r as { dedup_key?: unknown }).dedup_key)
          .filter((k): k is string => typeof k === 'string')
      );
    }
  } catch {
    // Pre-check indisponivel: segue em frente — o ON CONFLICT (dedup_key) da
    // RPC ainda garante a deduplicacao idempotente no momento da persistencia.
    alreadyNotified = new Set<string>();
  }

  const newEvents = dedupNewEvents(alreadyNotified, candidates);

  // 5. Resolve o admin_id usado no audit log (uma vez por execucao).
  const auditAdminId = await resolveAuditAdminId(supabase);

  // 6. Processa cada Critical_Event novo com try/catch POR EVENTO: a falha de
  //    um nunca interrompe os demais nem as execucoes futuras (Req 12.6).
  let published = 0;
  const errors: { dedupKey: string; error: string }[] = [];

  for (const { event, dedupKey } of newEvents) {
    try {
      const outcome = await publishCriticalEvent(supabase, event, dedupKey);

      // Loga ASSISTANT_CRITICAL_EVENT_DETECTED (Req 12.8). Pulado de forma
      // defensiva se nenhum admin_id pode ser resolvido (admin_id e NOT NULL).
      if (auditAdminId) {
        try {
          await supabase.from('admin_audit_logs').insert({
            admin_id: auditAdminId,
            action: 'ASSISTANT_CRITICAL_EVENT_DETECTED',
            target_type: 'assistant_critical_events',
            target_id: outcome.criticalEventId,
            before_data: null,
            after_data: {
              event_type: event.type,
              severity: event.severity,
              scope: event.scope,
              dedup_key: dedupKey,
              conversation_id: outcome.conversationId,
              persisted: outcome.persisted,
            },
          });
        } catch {
          // Audit best-effort: nunca interrompe o processamento do evento.
        }
      }

      // WhatsApp_Dispatcher: NO-OP enquanto o toggle esta off (Req 13.3/13.4).
      // Seam pronto para a futura Evolution API (Req 13.6); nada e enviado.
      whatsappDispatch(event, { whatsappToggle: config.whatsappToggle });

      published += 1;
    } catch (err) {
      // Registra o erro do evento e segue para o proximo (Req 12.6).
      errors.push({
        dedupKey,
        error: err instanceof Error ? err.message : 'unknown_error',
      });
      console.error('[assistant-monitor] falha ao publicar evento', dedupKey, err);
    }
  }

  return json({
    ok: true,
    detected: detected.length,
    published,
    deduped: candidates.length - newEvents.length,
    errors: errors.length,
  });
});
