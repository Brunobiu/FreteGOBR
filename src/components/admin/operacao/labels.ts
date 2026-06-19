/**
 * labels.ts — rótulos pt-BR fixos de Alert_Type para a UI da Central de Operação.
 * Em módulo separado (não-componente) para não quebrar o fast-refresh.
 */

import type { AlertType } from '../../../services/admin/operacao';

/** Rótulos pt-BR fixos por Alert_Type (sem PII). */
export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  WHATSAPP_DISCONNECTED: 'WhatsApp desconectado',
  CAMPAIGN_PAUSED: 'Campanha pausada',
  CAMPAIGN_ERROR: 'Campanha com erro',
  INTEGRATION_FAILURE: 'Falha de integração',
  SUBSCRIPTION_EXPIRING: 'Assinatura vencendo',
  CUSTOMER_AWAITING: 'Cliente aguardando',
};

export const ALERT_TYPES = Object.keys(ALERT_TYPE_LABEL) as AlertType[];
