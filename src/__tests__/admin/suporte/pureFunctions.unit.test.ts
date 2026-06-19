/**
 * Unit tests (exemplo/edge) das funções puras da Support_Console.
 *
 * Cobre statusMachine (transições + display map), priorityClassifier (tabela),
 * validation (limites) e o responderModeReducer (casos concretos de exclusão
 * mútua e idempotência).
 *
 * Validates: Requirements 3.3, 3.6, 5.2, 6.8, 10.3
 */

import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  renderStatus,
  STATUS_DISPLAY_MAP,
  TICKET_STATUSES,
} from '../../../services/admin/suporte/statusMachine';
import { classifyPriority } from '../../../services/admin/suporte/priorityClassifier';
import {
  validateFaqQuestion,
  validateFaqAnswer,
  isValidCategory,
  isValidConfidenceThreshold,
  deriveAnswerableSignal,
} from '../../../services/admin/suporte/validation';
import {
  applyOp,
  initialTicket,
} from '../../../services/admin/suporte/responderModeReducer';

describe('statusMachine — exemplos e edge', () => {
  it('transições válidas representativas', () => {
    expect(isValidTransition('open', 'in_progress')).toBe(true);
    expect(isValidTransition('open', 'closed')).toBe(true);
    expect(isValidTransition('resolved', 'in_progress')).toBe(true);
    expect(isValidTransition('waiting_customer', 'resolved')).toBe(true);
  });

  it('transições inválidas representativas (base de INVALID_STATUS_TRANSITION)', () => {
    expect(isValidTransition('in_progress', 'open')).toBe(false);
    expect(isValidTransition('resolved', 'waiting_customer')).toBe(false);
    expect(isValidTransition('closed', 'open')).toBe(false);
    expect(isValidTransition('open', 'open')).toBe(false);
  });

  it('STATUS_DISPLAY_MAP é total e renderStatus concatena marcador + rótulo', () => {
    for (const s of TICKET_STATUSES) {
      expect(STATUS_DISPLAY_MAP[s]).toBeDefined();
      expect(renderStatus(s)).toContain(STATUS_DISPLAY_MAP[s].label);
    }
    expect(renderStatus('open')).toBe('🟢 Novo');
    expect(renderStatus('closed')).toBe('🔴 Fechado');
  });
});

describe('priorityClassifier — tabela de decisão', () => {
  it('categoria crítica ⇒ 3 (independe do sinal)', () => {
    expect(classifyPriority(true, 'financeiro')).toBe(3);
    expect(classifyPriority(false, 'tecnico')).toBe(3);
    expect(classifyPriority(false, 'administrativo')).toBe(3);
  });

  it('sem categoria: true ⇒ 1, false ⇒ 2', () => {
    expect(classifyPriority(true, null)).toBe(1);
    expect(classifyPriority(false, null)).toBe(2);
  });
});

describe('validation — limites e domínio', () => {
  it('pergunta nos limites 3..300', () => {
    expect(validateFaqQuestion('ab')).toBe(false); // 2
    expect(validateFaqQuestion('abc')).toBe(true); // 3
    expect(validateFaqQuestion('a'.repeat(300))).toBe(true);
    expect(validateFaqQuestion('a'.repeat(301))).toBe(false);
    expect(validateFaqQuestion('   ')).toBe(false); // trim => vazio
  });

  it('resposta nos limites 1..5000', () => {
    expect(validateFaqAnswer('')).toBe(false);
    expect(validateFaqAnswer('x')).toBe(true);
    expect(validateFaqAnswer('a'.repeat(5000))).toBe(true);
    expect(validateFaqAnswer('a'.repeat(5001))).toBe(false);
  });

  it('category e confidence_threshold', () => {
    expect(isValidCategory('financeiro')).toBe(true);
    expect(isValidCategory('inexistente')).toBe(false);
    expect(isValidConfidenceThreshold(0)).toBe(true);
    expect(isValidConfidenceThreshold(1)).toBe(true);
    expect(isValidConfidenceThreshold(0.7)).toBe(true);
    expect(isValidConfidenceThreshold(1.1)).toBe(false);
    expect(isValidConfidenceThreshold(NaN)).toBe(false);
  });

  it('deriveAnswerableSignal no limiar', () => {
    expect(deriveAnswerableSignal(0.7, 0.7)).toBe(true);
    expect(deriveAnswerableSignal(0.69, 0.7)).toBe(false);
  });
});

describe('responderModeReducer — exclusão mútua (exemplos)', () => {
  it('IA sob modo human é bloqueada (AI_LOCKED) e não persiste mensagem', () => {
    const t = initialTicket({ responderMode: 'human' });
    const after = applyOp(t, { kind: 'ai_reply_attempt' });
    expect(after.lastResult).toBe('ai_locked');
    expect(after.messages).toHaveLength(0);
  });

  it('resposta humana sob modo ai faz flip atômico antes de aceitar', () => {
    const t = initialTicket({ responderMode: 'ai', status: 'open' });
    const after = applyOp(t, { kind: 'human_reply' });
    expect(after.responderMode).toBe('human');
    expect(after.handoffAt).not.toBeNull();
    expect(after.messages[after.messages.length - 1]?.authorKind).toBe('admin');
    expect(after.status).toBe('in_progress');
  });

  it('mensagem do cliente reabre waiting_customer/resolved, mas não closed', () => {
    expect(applyOp(initialTicket({ status: 'resolved' }), { kind: 'customer_message' }).status).toBe(
      'in_progress'
    );
    expect(
      applyOp(initialTicket({ status: 'waiting_customer' }), { kind: 'customer_message' }).status
    ).toBe('in_progress');
    expect(applyOp(initialTicket({ status: 'closed' }), { kind: 'customer_message' }).status).toBe(
      'closed'
    );
  });
});
