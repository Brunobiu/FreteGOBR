/**
 * Unit test — delta da Permission_Matrix para a Central de Suporte Inteligente.
 *
 * Confere o espelho frontend das ações novas (FAQ_VIEW/FAQ_EDIT/SUPORTE_AI_CONFIG)
 * em paridade com a re-asserção SQL de is_admin_with_permission (migration 115):
 *   - FAQ_VIEW          ⇒ SUPER_ADMIN, ADMIN e SUPORTE.
 *   - FAQ_EDIT          ⇒ SUPER_ADMIN e ADMIN apenas.
 *   - SUPORTE_AI_CONFIG ⇒ SUPER_ADMIN e ADMIN apenas.
 * FINANCEIRO e MODERADOR não recebem nenhuma das três (deny-by-default).
 *
 * Validates: Requirements 4.2, 4.3, 4.6
 */

import { describe, it, expect } from 'vitest';
import { hasPermission, type AdminRole } from '../../../services/admin/permissions';

const ALL_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'];

describe('Permission_Matrix — ações de suporte-inteligente', () => {
  it('FAQ_VIEW concedida a SUPER_ADMIN, ADMIN e SUPORTE', () => {
    expect(hasPermission('SUPER_ADMIN', 'FAQ_VIEW')).toBe(true);
    expect(hasPermission('ADMIN', 'FAQ_VIEW')).toBe(true);
    expect(hasPermission('SUPORTE', 'FAQ_VIEW')).toBe(true);
    expect(hasPermission('FINANCEIRO', 'FAQ_VIEW')).toBe(false);
    expect(hasPermission('MODERADOR', 'FAQ_VIEW')).toBe(false);
  });

  it('FAQ_EDIT concedida apenas a SUPER_ADMIN e ADMIN', () => {
    expect(hasPermission('SUPER_ADMIN', 'FAQ_EDIT')).toBe(true);
    expect(hasPermission('ADMIN', 'FAQ_EDIT')).toBe(true);
    expect(hasPermission('SUPORTE', 'FAQ_EDIT')).toBe(false);
    expect(hasPermission('FINANCEIRO', 'FAQ_EDIT')).toBe(false);
    expect(hasPermission('MODERADOR', 'FAQ_EDIT')).toBe(false);
  });

  it('SUPORTE_AI_CONFIG concedida apenas a SUPER_ADMIN e ADMIN', () => {
    expect(hasPermission('SUPER_ADMIN', 'SUPORTE_AI_CONFIG')).toBe(true);
    expect(hasPermission('ADMIN', 'SUPORTE_AI_CONFIG')).toBe(true);
    expect(hasPermission('SUPORTE', 'SUPORTE_AI_CONFIG')).toBe(false);
    expect(hasPermission('FINANCEIRO', 'SUPORTE_AI_CONFIG')).toBe(false);
    expect(hasPermission('MODERADOR', 'SUPORTE_AI_CONFIG')).toBe(false);
  });

  it('deny-by-default preservado para string fora do enum', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, 'FAQ_DESTROY_EVERYTHING')).toBe(false);
    }
  });
});
