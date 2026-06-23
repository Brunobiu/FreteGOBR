/**
 * components/admin/rastreamento/labels.ts — rótulos pt-BR do Tracking_Module.
 *
 * Mapeia os identifiers em inglês (action/event/cause codes) para rótulos
 * user-facing em pt-BR (project-conventions: UI em pt-BR, códigos em inglês).
 * Funções totais com fallback ao próprio código.
 */

import type {
  AbandonmentCause,
  ContactStatus,
  FunnelStage,
  JourneyEventType,
  JourneySurface,
  RiskCategory,
} from '../../../services/admin/rastreamento/domain';

export const EVENT_TYPE_LABELS: Record<JourneyEventType, string> = {
  SITE_VISIT: 'Visitou o site',
  SIGNUP_STARTED: 'Iniciou o cadastro',
  SIGNUP_COMPLETED: 'Concluiu o cadastro',
  SIGNUP_ABANDONED: 'Abandonou o cadastro',
  DOCUMENT_UPLOAD_STARTED: 'Iniciou envio de documento',
  DOCUMENT_UPLOAD_FAILED: 'Falha no envio de documento',
  DOCUMENT_APPROVED: 'Documento aprovado',
  LOGIN_SUCCEEDED: 'Login realizado',
  LOGIN_FAILED: 'Falha no login',
  CHECKOUT_STARTED: 'Iniciou o checkout',
  CHECKOUT_ABANDONED: 'Abandonou o checkout',
  PAYMENT_STARTED: 'Iniciou o pagamento',
  PAYMENT_FAILED: 'Pagamento recusado',
  PAYMENT_SUCCEEDED: 'Pagamento aprovado',
  SUBSCRIPTION_ACTIVATED: 'Assinatura ativada',
  APP_OPENED: 'Abriu o aplicativo',
  APP_CRASH: 'Travamento do aplicativo',
  FREIGHT_VIEWED: 'Visualizou frete',
  FREIGHT_IGNORED: 'Ignorou frete',
  FREIGHT_ACCEPTED: 'Aceitou frete',
  FIRST_FREIGHT_COMPLETED: 'Primeiro frete concluído',
  INACTIVITY_DETECTED: 'Inatividade detectada',
  INTERNAL_ERROR: 'Erro interno',
  NETWORK_TIMEOUT: 'Tempo de rede esgotado',
};

export const SURFACE_LABELS: Record<JourneySurface, string> = {
  SITE: 'Site',
  DASHBOARD: 'Painel',
  APP: 'Aplicativo',
};

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  VISITOR: 'Visitante',
  SIGNUP_STARTED: 'Cadastro iniciado',
  SIGNUP_COMPLETED: 'Cadastro concluído',
  DOCUMENTS_APPROVED: 'Documentos aprovados',
  SUBSCRIPTION_PAID: 'Assinatura paga',
  APP_ACTIVE: 'App ativo',
  FIRST_FREIGHT: 'Primeiro frete',
  RECURRING_USER: 'Usuário recorrente',
};

export const ABANDONMENT_CAUSE_LABELS: Record<AbandonmentCause, string> = {
  SIGNUP_ABANDONED: 'Cadastro abandonado',
  UPLOAD_ERROR: 'Erro no envio de documento',
  LOGIN_FAILURE: 'Falha de login',
  PAYMENT_DECLINED: 'Pagamento recusado',
  CHECKOUT_ABANDONED: 'Checkout abandonado',
  APP_CRASH: 'Travamento do app',
  PROLONGED_INACTIVITY: 'Inatividade prolongada',
  FREIGHTS_IGNORED: 'Fretes ignorados',
  INTERNAL_ERROR: 'Erro interno',
  NETWORK_TIMEOUT: 'Falha de rede',
  UNKNOWN: 'Não identificada',
};

export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  SIGNUP_ABANDONED: 'Cadastro abandonado',
  PAYMENT_PENDING: 'Pagamento pendente',
  INACTIVE: 'Inativo',
  COLD_DRIVER: 'Motorista frio',
  RECURRING_ERROR: 'Erro recorrente',
};

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  AT_RISK: 'Em risco',
  CONTACTED: 'Contatado',
  REPLIED: 'Respondeu',
  CONVERTED: 'Convertido',
};

/** Classe de cor (Tailwind) por Risk_Band para o badge na UI. */
export const RISK_BAND_BADGE: Record<string, string> = {
  LOW: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  HIGH: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  CRITICAL: 'bg-red-500/15 text-red-300 border-red-500/30',
};
