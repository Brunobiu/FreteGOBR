// Feature: admin-rastreamento-inteligente — At_Risk_List helpers (unit).
//
// Cobre deriveRiskCategory (mapeamento total causa→categoria, espelho do CASE
// SQL), compareAtRiskRows (ordenação total + desempate) e ramos de filtro de
// filterAndSortAtRisk não exercitados diretamente pelo CP10 (texto/perfil/data).
//
// Validates: Requirements 7.1, 7.2, 7.5, 13.2, 13.3

import { describe, it, expect } from 'vitest';

import {
  deriveRiskCategory,
  compareAtRiskRows,
  filterAndSortAtRisk,
  type AtRiskRow,
} from '../../../services/admin/rastreamento/atRiskList';
import { ABANDONMENT_CAUSES, RISK_CATEGORIES } from '../../../services/admin/rastreamento/domain';

function row(over: Partial<AtRiskRow>): AtRiskRow {
  return {
    user_id: '00000000-0000-4000-8000-000000000001',
    risk_score: 50,
    risk_band: 'HIGH',
    abandonment_cause: 'UNKNOWN',
    risk_category: 'INACTIVE',
    contact_status: 'AT_RISK',
    name: 'Fulano',
    phone_masked: '(62) ****-**88',
    profile: 'motorista',
    last_activity_at: 1_700_000_000_000,
    ...over,
  };
}

describe('deriveRiskCategory', () => {
  it('mapeia cada Abandonment_Cause a uma Risk_Category do domínio fechado', () => {
    for (const cause of ABANDONMENT_CAUSES) {
      expect(RISK_CATEGORIES).toContain(deriveRiskCategory(cause));
    }
  });

  it('mapeamentos específicos espelham o CASE SQL', () => {
    expect(deriveRiskCategory('SIGNUP_ABANDONED')).toBe('SIGNUP_ABANDONED');
    expect(deriveRiskCategory('PAYMENT_DECLINED')).toBe('PAYMENT_PENDING');
    expect(deriveRiskCategory('CHECKOUT_ABANDONED')).toBe('PAYMENT_PENDING');
    expect(deriveRiskCategory('PROLONGED_INACTIVITY')).toBe('INACTIVE');
    expect(deriveRiskCategory('FREIGHTS_IGNORED')).toBe('COLD_DRIVER');
    expect(deriveRiskCategory('UPLOAD_ERROR')).toBe('RECURRING_ERROR');
    expect(deriveRiskCategory('LOGIN_FAILURE')).toBe('RECURRING_ERROR');
    expect(deriveRiskCategory('APP_CRASH')).toBe('RECURRING_ERROR');
    expect(deriveRiskCategory('INTERNAL_ERROR')).toBe('RECURRING_ERROR');
    expect(deriveRiskCategory('NETWORK_TIMEOUT')).toBe('RECURRING_ERROR');
    expect(deriveRiskCategory('UNKNOWN')).toBe('INACTIVE');
  });
});

describe('compareAtRiskRows', () => {
  it('ordena por risk_score DESC e desempata por user_id ASC', () => {
    const a = row({ user_id: 'a', risk_score: 90 });
    const b = row({ user_id: 'b', risk_score: 90 });
    const c = row({ user_id: 'c', risk_score: 40 });
    expect(compareAtRiskRows(a, c)).toBeLessThan(0); // 90 antes de 40
    expect(compareAtRiskRows(c, a)).toBeGreaterThan(0);
    expect(compareAtRiskRows(a, b)).toBeLessThan(0); // empate: user_id a < b
    expect(compareAtRiskRows(a, a)).toBe(0);
  });
});

describe('filterAndSortAtRisk — ramos de filtro', () => {
  const rows = [
    row({ user_id: 'u1', name: 'Maria Souza', profile: 'motorista', risk_score: 80, abandonment_cause: 'PAYMENT_DECLINED', risk_category: 'PAYMENT_PENDING', last_activity_at: 1000 }),
    row({ user_id: 'u2', name: 'João Lima', profile: 'embarcador', risk_score: 30, abandonment_cause: 'UNKNOWN', risk_category: 'INACTIVE', last_activity_at: 5000 }),
  ];

  it('filtra por texto no nome (case-insensitive)', () => {
    expect(filterAndSortAtRisk(rows, { text: 'maria' }).map((r) => r.user_id)).toEqual(['u1']);
  });

  it('filtra por telefone mascarado (dígitos)', () => {
    expect(filterAndSortAtRisk(rows, { text: '88' }).length).toBe(2); // ambos terminam **88
  });

  it('filtra por perfil', () => {
    expect(filterAndSortAtRisk(rows, { profile: 'embarcador' }).map((r) => r.user_id)).toEqual(['u2']);
  });

  it('filtra por faixa de data (from/to)', () => {
    expect(filterAndSortAtRisk(rows, { from: 2000, to: 9000 }).map((r) => r.user_id)).toEqual(['u2']);
  });

  it('faixa de score impossível (min>max) ⇒ vazio sem erro', () => {
    expect(filterAndSortAtRisk(rows, { min_score: 90, max_score: 10 })).toEqual([]);
  });

  it('sem filtro ⇒ todos, ordenados por score DESC', () => {
    expect(filterAndSortAtRisk(rows, {}).map((r) => r.user_id)).toEqual(['u1', 'u2']);
  });
});
