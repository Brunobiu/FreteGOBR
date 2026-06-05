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
};
