/**
 * Cobertura dos helpers/guards puros da Support_Console (type guards, render,
 * Context_Builder vazio e historyToMessages) — complementa CP2/CP5/CP9/CP10.
 *
 * Validates: Requirements 3.3, 5.7, 6.2, 10.2
 */

import { describe, it, expect } from 'vitest';
import { isTicketStatus, renderStatus } from '../../../services/admin/suporte/statusMachine';
import { isCriticalCategory } from '../../../services/admin/suporte/priorityClassifier';
import { isValidPublicationState, isValidCategory } from '../../../services/admin/suporte/validation';
import {
  selectPublishedFaq,
  historyToMessages,
  buildSupportContext,
  type KbEntryLite,
} from '../../../services/admin/suporte/knowledgeBase';

describe('statusMachine — type guard e render', () => {
  it('isTicketStatus aceita só o domínio fechado', () => {
    expect(isTicketStatus('open')).toBe(true);
    expect(isTicketStatus('closed')).toBe(true);
    expect(isTicketStatus('bogus')).toBe(false);
  });
  it('renderStatus cobre todos os estados', () => {
    expect(renderStatus('in_progress')).toContain('Em andamento');
    expect(renderStatus('waiting_customer')).toContain('Aguardando cliente');
    expect(renderStatus('resolved')).toContain('Resolvido');
  });
});

describe('priorityClassifier / validation — type guards', () => {
  it('isCriticalCategory', () => {
    expect(isCriticalCategory('financeiro')).toBe(true);
    expect(isCriticalCategory('outro')).toBe(false);
  });
  it('isValidCategory / isValidPublicationState', () => {
    expect(isValidCategory('planos')).toBe(true);
    expect(isValidCategory('xxx')).toBe(false);
    expect(isValidPublicationState('publicada')).toBe(true);
    expect(isValidPublicationState('rascunho')).toBe(true);
    expect(isValidPublicationState('xxx')).toBe(false);
  });
});

describe('knowledgeBase — Context_Builder e mapeamento de histórico', () => {
  it('buildSupportContext com Base vazia indica "vazia"', () => {
    expect(buildSupportContext([])).toContain('Base de Conhecimento vazia');
  });
  it('buildSupportContext lista as FAQs fornecidas', () => {
    const faqs: KbEntryLite[] = [
      { id: '1', question: 'Como cancelo?', answer: 'Pelo painel.', category: 'planos', publication_state: 'publicada' },
    ];
    const ctx = buildSupportContext(faqs);
    expect(ctx).toContain('Como cancelo?');
    expect(ctx).toContain('Pelo painel.');
  });
  it('selectPublishedFaq filtra por publicada', () => {
    const faqs: KbEntryLite[] = [
      { id: '1', question: 'q1', answer: 'a1', category: 'geral', publication_state: 'publicada' },
      { id: '2', question: 'q2', answer: 'a2', category: 'geral', publication_state: 'rascunho' },
    ];
    expect(selectPublishedFaq(faqs).map((f) => f.id)).toEqual(['1']);
  });
  it('historyToMessages mapeia user->user e admin/ai->assistant', () => {
    const msgs = historyToMessages([
      { author_kind: 'user', body: 'oi' },
      { author_kind: 'admin', body: 'olá' },
      { author_kind: 'ai', body: 'resposta' },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'olá' },
      { role: 'assistant', content: 'resposta' },
    ]);
  });
});
