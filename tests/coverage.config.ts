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

  // Módulos com cobertura forte na suíte completa (property tests dedicados).
  'src/utils/trialStatus.ts': 85,
  'src/utils/inputValidator.ts': 75,

  // Dependem de Supabase — alvo após Fase 2 (integração).
  'src/services/admin/audit.ts': 0, // alvo: 90
  'src/services/verification.ts': 0, // alvo: 85

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
};
