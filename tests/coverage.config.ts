/**
 * Thresholds de cobertura por Critical_Module — spec `testes` (Tarefa 3).
 *
 * Cada módulo crítico (regra de negócio sensível) tem um percentual mínimo
 * de cobertura de linhas. O script `scripts/check-coverage.ts` lê o
 * relatório do v8 e falha o CI se algum ficar abaixo.
 *
 * Validates: Requirements 25.7, 25.8
 *
 * NOTA: módulos que dependem de Supabase (audit.ts, verification.ts) só
 * atingem cobertura significativa com os testes de integração da Fase 2
 * (bloqueada por infra de CI — branch efêmero + secrets). Até lá ficam com
 * threshold 0 e um comentário; quando a Fase 2 entrar, elevar para os
 * valores-alvo comentados ao lado.
 */

export const CRITICAL_MODULES: Record<string, number> = {
  // Regras puras — totalmente cobríveis por unit/property (Fase 1).
  'src/utils/calculoFrete.ts': 95,
  'src/services/admin/permissions.ts': 95,
  'src/utils/passwordValidation.ts': 90,
  // Catálogo de documentos enviáveis no chat (chat-enviar-documentos). Núcleo
  // puro (catálogo/labels/seleção/classificação) coberto por property + unit.
  'src/services/driverDocsCatalog.ts': 90,

  // Módulos com cobertura forte na suíte completa (property tests dedicados).
  'src/utils/trialStatus.ts': 85,
  'src/utils/inputValidator.ts': 75,

  // Dependem de Supabase — alvo após Fase 2 (integração).
  'src/services/admin/audit.ts': 0, // alvo: 90
  'src/services/verification.ts': 0, // alvo: 85

  // Verificação de cadastro por WhatsApp/OTP (auth-otp-whatsapp, migration 125).
  // Núcleo puro espelho da autoridade SQL: normalização E.164 (CP2) e decisão de
  // canal/fallback (CP9), cobertos por property tests. O cliente signupOtp.ts
  // (wrappers de RPC) atinge cobertura só com integração (Fase 2) — alvo abaixo.
  'src/utils/phoneE164.ts': 95, // medido 100 (CP2)
  'src/utils/otpChannel.ts': 95, // medido 100 (CP9)
  'src/services/signupOtp.ts': 0, // alvo: 85 (após integração)

  // Login sem senha (login-sem-senha, migration 126). classifyIdentifier é puro
  // (CP4); requestLoginCode/verifyLoginCode são wrappers de RPC/Edge cobertos só
  // pela integração (Fase 2) — alvo abaixo.
  'src/services/passwordlessLogin.ts': 0, // alvo: 80 (após integração)

  // Biometria no app (biometria-app). biometricGate é a máquina de estados PURA
  // (CP1/CP2/CP3/CP5), totalmente coberta. biometricAuth é o wrapper do plugin
  // nativo: só o caminho de degradação (web) é testável em CI — alvo após teste
  // em dispositivo.
  'src/services/biometricGate.ts': 95, // medido 100 (CP1/CP2/CP3/CP5)
  'src/services/biometricAuth.ts': 0, // alvo: 70 (após teste em dispositivo)

  // WhatsApp_Module — regras puras + invariantes (P1–P14) e anti-enumeração,
  // cobertas por unit/property tests (Fase 1). Thresholds com margem abaixo do
  // medido para tolerar flutuação sem mascarar regressão. Os wrappers de
  // serviço de baixa cobertura (contacts/contents) e a UI (.tsx, validada por
  // build) ficam fora do gate por ora.
  'src/services/admin/whatsapp/validation.ts': 90, // medido ~98
  'src/services/admin/whatsapp/distribution.ts': 80, // medido ~86
  'src/services/admin/whatsapp/render.ts': 95, // medido 100
  'src/services/admin/whatsapp/csv.ts': 90, // medido ~98
  'src/services/admin/whatsapp/stats.ts': 90, // medido 100
  'src/services/admin/whatsapp/worker.ts': 95, // medido 100
  'src/services/admin/whatsapp/extractor.ts': 95, // medido 100
  'src/services/admin/whatsapp/guards.ts': 85, // medido ~93
  'src/services/admin/whatsapp/dispatch.ts': 85, // medido ~94

  // Central de Suporte Inteligente (suporte-inteligente, migration 115). Núcleo
  // puro espelho da autoridade SQL, coberto por property tests CP1-CP10 + unit.
  // Thresholds com margem abaixo do medido. O service suporte.ts (wrappers de
  // RPC) e a UI (.tsx, validada por build) ficam fora do gate por ora — como o
  // padrão do whatsapp.
  'src/services/admin/suporte/statusMachine.ts': 95,
  'src/services/admin/suporte/priorityClassifier.ts': 95,
  'src/services/admin/suporte/validation.ts': 90,
  'src/services/admin/suporte/responderModeReducer.ts': 90,
  'src/services/admin/suporte/listFilter.ts': 90,
  'src/services/admin/suporte/knowledgeBase.ts': 90,

  // Cliente 360 (admin-cliente-360, migration 116). Núcleo puro espelho da
  // autoridade SQL (busca/ranking/sanitização/correlação de login), coberto por
  // property tests CP1-CP3/CP9 + unit. Thresholds com margem abaixo do medido
  // (search/loginCorrelation ~100%, ranking ~87-90% com variação dos property
  // tests). O service cliente360.ts (wrappers de RPC) e a UI (.tsx, validada por
  // build) ficam fora do gate por ora — como o padrão de suporte/whatsapp.
  'src/services/admin/cliente360/search.ts': 95,
  'src/services/admin/cliente360/ranking.ts': 80,
  'src/services/admin/cliente360/loginCorrelation.ts': 90,

  // Central de Operação (admin-central-operacao, migration 117). Núcleo puro
  // espelho da autoridade SQL (forma de métricas, máquina de refresh, evaluator/
  // reconciliação, redutor de ack/resolve, ordenação, Log_Event_Map), coberto por
  // property tests CP1-CP10 + unit. Thresholds com margem abaixo do medido
  // (alertEvaluator ~98%, demais ~100%). O service operacao.ts (wrappers de RPC)
  // e a UI (.tsx, validada por build) ficam fora do gate por ora — como o padrão
  // de cliente360/suporte/whatsapp.
  'src/services/admin/operacao/metricsShape.ts': 95,
  'src/services/admin/operacao/realtimeRefresh.ts': 95,
  'src/services/admin/operacao/alertEvaluator.ts': 90,
  'src/services/admin/operacao/alertLifecycle.ts': 95,
  'src/services/admin/operacao/ordering.ts': 95,
  'src/services/admin/operacao/logEventMap.ts': 95,

  // IA Supervisora (admin-ia-supervisora, migration 118). Núcleo puro read-only
  // espelho da autoridade SQL (classificação de severidade, detector de anomalias,
  // reconciliação/dedup, ciclo de vida de insight, builder de resumo, ordenação,
  // plano de intents do chat, sanitização anti-PII), coberto por property tests
  // CP1-CP9 + unit. Thresholds com margem abaixo do medido (statements 100% em
  // todos os 7 módulos). O service supervisor.ts (wrappers de RPC + edge fn) e a
  // UI (.tsx, validada por build) ficam fora do gate por ora — como o padrão de
  // operacao/cliente360/suporte/whatsapp.
  'src/services/admin/supervisor/severityClassifier.ts': 95,
  'src/services/admin/supervisor/anomalyDetector.ts': 90,
  'src/services/admin/supervisor/insightLifecycle.ts': 95,
  'src/services/admin/supervisor/summaryBuilder.ts': 95,
  'src/services/admin/supervisor/ordering.ts': 95,
  'src/services/admin/supervisor/questionContextPlan.ts': 90,
  'src/services/admin/supervisor/sanitize.ts': 90,

  // Histórico de conversas do chat (supervisor-chat-history, migration 119).
  // Núcleo puro: deriveTitle (sem PII), comparadores de ordenação, validação de
  // mensagem. Property tests CP1-CP3 + unit; medido 100% statements.
  'src/services/admin/supervisor/chatHistory.ts': 95,

  // Rastreamento Inteligente / PatGo (admin-rastreamento-inteligente, migration
  // 124). Núcleo puro determinístico espelho da autoridade SQL (classificador de
  // causa, score/banda de risco, derivação de etapa, métricas do funil, motor de
  // regras/anti-spam, lista em risco, recuperação, CSV), coberto por property
  // tests CP1-CP14 + unit. Thresholds do design; margem abaixo do medido (100%).
  // O service rastreamento.ts (wrappers de RPC) e a UI (.tsx, validada por build)
  // ficam fora do gate por ora — como o padrão de supervisor/operacao/cliente360.
  'src/services/admin/rastreamento/abandonmentClassifier.ts': 95,
  'src/services/admin/rastreamento/riskScore.ts': 95,
  'src/services/admin/rastreamento/stageDerivation.ts': 95,
  'src/services/admin/rastreamento/funnelMetrics.ts': 95,
  'src/services/admin/rastreamento/recoveryRuleEngine.ts': 90,
  'src/services/admin/rastreamento/atRiskList.ts': 90,
  'src/services/admin/rastreamento/recoveryPerformance.ts': 95,
  'src/services/admin/rastreamento/csvExport.ts': 90,
};
