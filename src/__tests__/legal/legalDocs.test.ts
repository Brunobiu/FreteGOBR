/**
 * Testes do módulo de conteúdo/versão legal (Feature 1 — legal, Tarefa 8).
 *
 * Property 1: versão sempre exposta e estável.
 *
 * Validates: Requirements 1.4, 2.3, 3.1, 3.3
 */

import { describe, it, expect } from 'vitest';
import {
  LEGAL_DOCS,
  LEGAL_SECTIONS,
  currentLegalVersion,
  type LegalDocKey,
} from '../../data/legal';

const KEYS: LegalDocKey[] = ['terms', 'privacy'];

describe('LEGAL_DOCS — metadados', () => {
  it('cada documento tem version e updatedAt não-vazios', () => {
    for (const k of KEYS) {
      const m = LEGAL_DOCS[k];
      expect(m.version.trim().length).toBeGreaterThan(0);
      expect(m.updatedAt.trim().length).toBeGreaterThan(0);
      expect(m.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('version está no formato data ISO YYYY-MM-DD', () => {
    for (const k of KEYS) {
      expect(LEGAL_DOCS[k].version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('rotas são /termos e /privacidade', () => {
    expect(LEGAL_DOCS.terms.route).toBe('/termos');
    expect(LEGAL_DOCS.privacy.route).toBe('/privacidade');
  });
});

describe('currentLegalVersion — Property 1', () => {
  it('inclui as versões de ambos os documentos', () => {
    const v = currentLegalVersion();
    expect(v).toContain(`terms@${LEGAL_DOCS.terms.version}`);
    expect(v).toContain(`privacy@${LEGAL_DOCS.privacy.version}`);
  });

  it('é determinístico (mesma saída em chamadas repetidas)', () => {
    expect(currentLegalVersion()).toBe(currentLegalVersion());
  });

  it('tem o formato canônico terms@<v>|privacy@<v>', () => {
    expect(currentLegalVersion()).toMatch(/^terms@\d{4}-\d{2}-\d{2}\|privacy@\d{4}-\d{2}-\d{2}$/);
  });
});

describe('LEGAL_SECTIONS — conteúdo', () => {
  it('cada documento tem ao menos uma seção, com id e heading', () => {
    for (const k of KEYS) {
      const sections = LEGAL_SECTIONS[k];
      expect(sections.length).toBeGreaterThan(0);
      for (const s of sections) {
        expect(s.id.trim().length).toBeGreaterThan(0);
        expect(s.heading.trim().length).toBeGreaterThan(0);
        expect(s.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('ids das seções são únicos dentro de cada documento', () => {
    for (const k of KEYS) {
      const ids = LEGAL_SECTIONS[k].map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('Política de Privacidade cobre as categorias de dados sensíveis exigidas', () => {
    const allText = LEGAL_SECTIONS.privacy
      .flatMap((s) => [s.heading, ...s.body, ...(s.bullets ?? [])])
      .join(' ');
    for (const termo of ['CPF', 'RG', 'CNH', 'RNTRC', 'CNPJ', 'localização', 'veículo']) {
      expect(allText).toContain(termo);
    }
  });

  it('Política de Privacidade menciona o prazo de 30 dias de exclusão', () => {
    const allText = LEGAL_SECTIONS.privacy
      .flatMap((s) => [...s.body, ...(s.bullets ?? [])])
      .join(' ');
    expect(allText).toContain('30 dias');
  });
});
