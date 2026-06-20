/**
 * supervisor/questionContextPlan.ts — Question_Context_Plan (alvo de CP9).
 *
 * Mapa determinístico de intenção: dada uma pergunta em pt-BR, decide quais
 * blocos de agregados (sem PII) entram no Supervisor_Context. Total: sempre
 * retorna ao menos um intent (default OVERVIEW). Sem I/O.
 *
 * Spec: .kiro/specs/admin-ia-supervisora (Task 2.6).
 */

export type ContextIntent =
  | 'USERS'
  | 'SUBSCRIPTIONS'
  | 'TICKETS'
  | 'MESSAGES'
  | 'ALERTS'
  | 'DIAGNOSTICS'
  | 'OVERVIEW';

export const CONTEXT_INTENTS: readonly ContextIntent[] = [
  'USERS',
  'SUBSCRIPTIONS',
  'TICKETS',
  'MESSAGES',
  'ALERTS',
  'DIAGNOSTICS',
  'OVERVIEW',
];

/** Palavras-chave pt-BR (lowercase, sem acento) → intent. Ordem estável. */
const KEYWORD_MAP: ReadonlyArray<{ intent: ContextIntent; words: readonly string[] }> = [
  { intent: 'USERS', words: ['usuario', 'usuarios', 'cadastro', 'cadastros', 'online', 'motorista', 'embarcador'] },
  { intent: 'SUBSCRIPTIONS', words: ['assinatura', 'assinaturas', 'pagou', 'pagamento', 'faturamento', 'receita', 'plano', 'planos'] },
  { intent: 'TICKETS', words: ['ticket', 'tickets', 'atendimento', 'atendimentos', 'suporte', 'chamado', 'chamados'] },
  { intent: 'MESSAGES', words: ['mensagem', 'mensagens', 'campanha', 'campanhas', 'disparo', 'disparos', 'whatsapp', 'instancia', 'instancias'] },
  { intent: 'ALERTS', words: ['alerta', 'alertas', 'problema', 'problemas', 'critico', 'criticos'] },
  { intent: 'DIAGNOSTICS', words: ['erro', 'erros', 'falha', 'falhas', 'diagnostico', 'diagnosticos', 'travado', 'travada', 'lentidao', 'lento'] },
];

function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove acentos
}

/**
 * Planeja os intents de contexto para uma pergunta. Total e determinística:
 * casa palavras-chave (preservando a ordem de CONTEXT_INTENTS); sem nenhum
 * casamento ⇒ ['OVERVIEW'].
 */
export function planIntents(question: string): ContextIntent[] {
  const norm = normalize(question);
  const found = new Set<ContextIntent>();
  for (const { intent, words } of KEYWORD_MAP) {
    if (words.some((w) => norm.includes(w))) found.add(intent);
  }
  if (found.size === 0) return ['OVERVIEW'];
  // ordem estável conforme CONTEXT_INTENTS
  return CONTEXT_INTENTS.filter((i) => found.has(i));
}
