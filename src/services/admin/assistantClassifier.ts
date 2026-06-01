/**
 * admin/assistantClassifier.ts
 *
 * Event_Classifier do modulo Assistente (admin-assistant, migration 047).
 *
 * Logica PURA e DETERMINISTICA que, dados sinais agregados de uma janela
 * de avaliacao + os thresholds configurados, decide quais Critical_Event
 * existem e de qual Critical_Event_Type. Nao possui efeitos colaterais:
 * mesma entrada produz sempre a mesma saida (Req 9.1).
 *
 * Este e o modulo CANONICO do classificador, compartilhado entre o
 * frontend (testes de propriedade Vitest + fast-check, CP-15..CP-20) e a
 * Edge Function `assistant-monitor` (Deno), que espelha o mesmo contrato
 * deterministico ao coletar os sinais e montar o `ClassifierSignals`.
 *
 * Decisoes de classificacao (ver design.md secao 8 e requirements Reqs 9/10/11):
 *   - Somente tipos do dominio fechado `CriticalEventType` (Req 9.2).
 *   - `newSignups`/`postedFretes` sao Common_Event e JAMAIS disparam (Req 9.3).
 *   - Sinais baseados em threshold (`page_error_rate`, `request_failure_rate`):
 *     evento sse contagem observada >= threshold; caso contrario nenhum
 *     (Req 10.2/10.3, bicondicional).
 *   - `failed_login_burst`: avaliado POR IP; cada IP cuja contagem >= threshold
 *     gera um evento proprio com `scope = ip:<addr>`; IPs distintos nao sao
 *     somados (Req 11.2/11.3/11.4).
 *   - `unauthorized_access_attempt`, `payment_failure`: presenca do sinal
 *     (contagem > 0) dispara (Req 11.1/11.5).
 *   - `db_performance_drop`: dispara quando a flag e verdadeira (Req 11.6).
 *   - Cada evento carrega `type` (no dominio), `severity` e `summary` nao
 *     vazios (Req 9.6).
 *
 * Convencoes herdadas (ver project-conventions.md e admin-patterns.md):
 *   - Identifiers/event codes em ingles; textos de `summary` em pt-BR.
 *   - Modulo sem dependencias externas, sem I/O, sem `Date`/`Math.random`.
 */

import type { CriticalEventType, Severity, DetectedEvent } from './assistant';

// ===================== Interfaces do classificador =====================

/**
 * Limites configuraveis (Critical_Threshold) por Critical_Event_Type
 * baseado em contagem. Cada valor e um inteiro >= 1 (validado no service
 * antes de persistir; aqui apenas consumido). Espelha as colunas
 * threshold_* de `assistant_config`.
 */
export interface ThresholdConfig {
  page_error_rate: number; // >= 1
  request_failure_rate: number; // >= 1
  failed_login_burst: number; // >= 1
}

/**
 * Sinais agregados coletados na janela de avaliacao e submetidos ao
 * classificador. Contagens sao numeros nao negativos; `failedLoginsByIp`
 * mapeia cada IP de origem a sua contagem de falhas (NAO somada entre IPs).
 * `newSignups`/`postedFretes` sao Common_Event e estao presentes apenas
 * para deixar explicito que sao ignorados pela classificacao.
 */
export interface ClassifierSignals {
  pageErrorCount: number;
  requestFailureCount: number;
  failedLoginsByIp: Record<string, number>; // contagem por IP, NAO somada entre IPs
  unauthorizedAccessCount: number; // > 0 dispara
  paymentFailureCount: number; // > 0 dispara
  dbPerformanceDrop: boolean; // true dispara
  newSignups: number; // Common_Event, nunca dispara
  postedFretes: number; // Common_Event, nunca dispara
}

// `DetectedEvent` e reusado de `./assistant` (fonte canonica do tipo).
export type { DetectedEvent } from './assistant';

// ===================== Mapeamento de severidade =====================

/**
 * Severidade canonica por Critical_Event_Type. Deterministica e estavel:
 * eventos de seguranca/pagamento sao `critical`; sinais baseados em taxa
 * e queda de desempenho sao `warning`. Mantida como constante para que a
 * classificacao nao dependa de nenhum estado externo.
 */
const SEVERITY_BY_TYPE: Record<CriticalEventType, Severity> = {
  page_error_rate: 'warning',
  request_failure_rate: 'warning',
  unauthorized_access_attempt: 'critical',
  failed_login_burst: 'critical',
  payment_failure: 'critical',
  db_performance_drop: 'warning',
};

// ===================== classifyEvents =====================

/**
 * Classifica os sinais agregados em zero ou mais Critical_Event.
 *
 * Funcao pura e deterministica: nao le relogio, nao gera aleatoriedade e
 * nao muta a entrada. A ordem dos eventos retornados e estavel para a
 * mesma entrada (tipos em ordem fixa; bursts de login ordenados por IP),
 * garantindo igualdade entre invocacoes consecutivas (Req 9.1).
 *
 * Os campos `newSignups` e `postedFretes` de `signals` sao Common_Event e
 * deliberadamente ignorados: jamais produzem evento (Req 9.3).
 */
export function classifyEvents(
  signals: ClassifierSignals,
  thresholds: ThresholdConfig
): DetectedEvent[] {
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
  //    NAO sao somados (Req 11.2/11.3/11.4). Ordenacao por IP garante
  //    saida estavel independente da ordem de insercao do Record.
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
