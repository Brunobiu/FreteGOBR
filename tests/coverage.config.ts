/**
 * Thresholds de cobertura por Critical_Module — spec `testes` (Tarefa 3).
 *
 * Cada módulo crítico (regra de negócio sensível) tem um percentual mínimo
 * de cobertura de linhas. O script `scripts/check-coverage.ts` lê o
 * relatório do v8 e falha o CI se algum ficar abaixo.
 *
 * Validates: Requirements 25.7, 25.8
 */

export const CRITICAL_MODULES: Record<string, number> = {
  'src/utils/calculoFrete.ts': 95,
  'src/services/admin/permissions.ts': 95,
  'src/services/admin/audit.ts': 90,
  'src/utils/trialStatus.ts': 90,
  'src/utils/inputValidator.ts': 90,
  'src/utils/passwordValidation.ts': 90,
  'src/services/verification.ts': 85,
};
