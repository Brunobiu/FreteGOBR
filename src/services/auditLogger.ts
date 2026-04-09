/**
 * AuditLogger - Sistema de trilha de auditoria
 * 
 * Registra todas as ações importantes do sistema para:
 * - Conformidade e compliance
 * - Investigação de incidentes de segurança
 * - Resolução de disputas
 * - Monitoramento de atividades suspeitas
 * 
 * Retenção: 90 dias
 */

import { supabase } from './supabase';

export type AuditEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'session_expired'
  | 'session_revoked'
  | 'password_change'
  | 'password_reset_request'
  | 'profile_update'
  | 'frete_created'
  | 'frete_updated'
  | 'frete_deleted'
  | 'frete_accepted'
  | 'frete_completed'
  | 'document_uploaded'
  | 'document_deleted'
  | 'chat_message_sent'
  | 'rating_submitted'
  | 'unauthorized_access'
  | 'sql_injection_attempt'
  | 'xss_attempt'
  | 'rate_limit_violation'
  | 'honeypot_trigger'
  | 'file_validation_failure'
  | 'csrf_validation_failure'
  | 'brute_force_lockout'
  | 'admin_action';

export interface AuditLogEntry {
  id?: string;
  event_type: AuditEventType;
  user_id?: string;
  ip_address?: string;
  user_agent?: string;
  resource_type?: string;
  resource_id?: string;
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  severity: 'info' | 'warning' | 'critical';
  created_at?: string;
}

// Configuração de retenção
const RETENTION_DAYS = 90;

class AuditLogger {
  /**
   * Obtém informações do cliente (IP e User Agent)
   * Nota: Em produção, o IP real vem do servidor/proxy
   */
  private static getClientInfo(): { ip_address: string; user_agent: string } {
    return {
      ip_address: 'client-side', // Em produção, obtido via header X-Forwarded-For
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    };
  }

  /**
   * Registra um evento de auditoria genérico
   */
  static async log(entry: Omit<AuditLogEntry, 'id' | 'created_at'>): Promise<void> {
    const clientInfo = this.getClientInfo();

    const logEntry: AuditLogEntry = {
      ...entry,
      ip_address: entry.ip_address || clientInfo.ip_address,
      user_agent: entry.user_agent || clientInfo.user_agent,
    };

    // Log no console para desenvolvimento
    const logLevel = entry.severity === 'critical' ? 'error' : 
                     entry.severity === 'warning' ? 'warn' : 'log';
    console[logLevel](`[AUDIT] ${entry.event_type}:`, logEntry);

    try {
      await supabase.from('audit_logs').insert({
        action: entry.event_type,
        user_id: entry.user_id,
        old_data: entry.old_data,
        new_data: {
          ...entry.new_data,
          ip_address: logEntry.ip_address,
          user_agent: logEntry.user_agent,
          resource_type: entry.resource_type,
          resource_id: entry.resource_id,
          metadata: entry.metadata,
          severity: entry.severity,
        },
      });
    } catch (error) {
      console.error('[AUDIT] Erro ao salvar log:', error);
    }
  }

  /**
   * Registra login bem-sucedido
   */
  static async logLogin(userId: string, phone: string): Promise<void> {
    await this.log({
      event_type: 'login_success',
      user_id: userId,
      metadata: { phone: phone.substring(0, 4) + '****' },
      severity: 'info',
    });
  }

  /**
   * Registra falha de login
   */
  static async logLoginFailure(phone: string, reason: string): Promise<void> {
    await this.log({
      event_type: 'login_failure',
      metadata: { 
        phone: phone.substring(0, 4) + '****',
        reason,
      },
      severity: 'warning',
    });
  }

  /**
   * Registra logout
   */
  static async logLogout(userId: string): Promise<void> {
    await this.log({
      event_type: 'logout',
      user_id: userId,
      severity: 'info',
    });
  }

  /**
   * Registra upload de arquivo
   */
  static async logFileUpload(
    userId: string,
    fileName: string,
    fileType: string,
    fileSize: number,
    success: boolean
  ): Promise<void> {
    await this.log({
      event_type: success ? 'document_uploaded' : 'file_validation_failure',
      user_id: userId,
      resource_type: 'document',
      metadata: {
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        success,
      },
      severity: success ? 'info' : 'warning',
    });
  }

  /**
   * Registra tentativa de acesso não autorizado
   */
  static async logUnauthorizedAccess(
    userId: string | undefined,
    resource: string,
    action: string
  ): Promise<void> {
    await this.log({
      event_type: 'unauthorized_access',
      user_id: userId,
      resource_type: resource,
      metadata: { action },
      severity: 'critical',
    });
  }

  /**
   * Registra tentativa de SQL Injection
   */
  static async logSQLInjectionAttempt(
    userId: string | undefined,
    input: string,
    field: string
  ): Promise<void> {
    await this.log({
      event_type: 'sql_injection_attempt',
      user_id: userId,
      metadata: {
        input: input.substring(0, 100), // Truncar para segurança
        field,
      },
      severity: 'critical',
    });
  }

  /**
   * Registra tentativa de XSS
   */
  static async logXSSAttempt(
    userId: string | undefined,
    input: string,
    field: string
  ): Promise<void> {
    await this.log({
      event_type: 'xss_attempt',
      user_id: userId,
      metadata: {
        input: input.substring(0, 100),
        field,
      },
      severity: 'critical',
    });
  }

  /**
   * Registra violação de rate limit
   */
  static async logRateLimitViolation(
    identifier: string,
    limitType: string,
    userId?: string
  ): Promise<void> {
    await this.log({
      event_type: 'rate_limit_violation',
      user_id: userId,
      metadata: {
        identifier,
        limit_type: limitType,
      },
      severity: 'warning',
    });
  }

  /**
   * Registra acionamento de honeypot
   */
  static async logHoneypotTrigger(
    triggerType: 'route' | 'field',
    details: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      event_type: 'honeypot_trigger',
      metadata: {
        trigger_type: triggerType,
        ...details,
      },
      severity: 'critical',
    });
  }

  /**
   * Registra bloqueio por força bruta
   */
  static async logBruteForceLockout(
    phone: string,
    attempts: number
  ): Promise<void> {
    await this.log({
      event_type: 'brute_force_lockout',
      metadata: {
        phone: phone.substring(0, 4) + '****',
        attempts,
      },
      severity: 'critical',
    });
  }

  /**
   * Registra ação de usuário genérica
   */
  static async logUserAction(
    userId: string,
    action: AuditEventType,
    resourceType: string,
    resourceId: string,
    oldData?: Record<string, unknown>,
    newData?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      event_type: action,
      user_id: userId,
      resource_type: resourceType,
      resource_id: resourceId,
      old_data: oldData,
      new_data: newData,
      severity: 'info',
    });
  }

  /**
   * Registra evento de segurança genérico
   */
  static async logSecurityEvent(
    eventType: AuditEventType,
    details: Record<string, unknown>,
    severity: 'info' | 'warning' | 'critical' = 'warning'
  ): Promise<void> {
    await this.log({
      event_type: eventType,
      metadata: details,
      severity,
    });
  }

  /**
   * Busca logs de auditoria (admin)
   */
  static async getLogs(options: {
    userId?: string;
    eventType?: AuditEventType;
    severity?: 'info' | 'warning' | 'critical';
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(options.limit || 100);

    if (options.userId) {
      query = query.eq('user_id', options.userId);
    }

    if (options.eventType) {
      query = query.eq('action', options.eventType);
    }

    if (options.startDate) {
      query = query.gte('created_at', options.startDate.toISOString());
    }

    if (options.endDate) {
      query = query.lte('created_at', options.endDate.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error('[AUDIT] Erro ao buscar logs:', error);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      event_type: row.action as AuditEventType,
      user_id: row.user_id,
      old_data: row.old_data,
      new_data: row.new_data,
      ip_address: row.new_data?.ip_address as string,
      user_agent: row.new_data?.user_agent as string,
      resource_type: row.new_data?.resource_type as string,
      resource_id: row.new_data?.resource_id as string,
      metadata: row.new_data?.metadata as Record<string, unknown>,
      severity: (row.new_data?.severity as 'info' | 'warning' | 'critical') || 'info',
      created_at: row.created_at,
    }));
  }

  /**
   * Limpa logs antigos (executar periodicamente)
   */
  static async cleanupOldLogs(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    const { data, error } = await supabase
      .from('audit_logs')
      .delete()
      .lt('created_at', cutoffDate.toISOString())
      .select('id');

    if (error) {
      console.error('[AUDIT] Erro ao limpar logs antigos:', error);
      return 0;
    }

    const count = data?.length || 0;
    if (count > 0) {
      console.log(`[AUDIT] Removidos ${count} logs com mais de ${RETENTION_DAYS} dias`);
    }

    return count;
  }

  /**
   * Obtém estatísticas de segurança (últimas 24h)
   */
  static async getSecurityStats(): Promise<{
    loginFailures: number;
    rateLimitViolations: number;
    honeypotTriggers: number;
    unauthorizedAccess: number;
    injectionAttempts: number;
  }> {
    const since = new Date();
    since.setHours(since.getHours() - 24);

    const { data, error } = await supabase
      .from('audit_logs')
      .select('action')
      .gte('created_at', since.toISOString());

    if (error) {
      console.error('[AUDIT] Erro ao buscar estatísticas:', error);
      return {
        loginFailures: 0,
        rateLimitViolations: 0,
        honeypotTriggers: 0,
        unauthorizedAccess: 0,
        injectionAttempts: 0,
      };
    }

    const actions = data?.map(row => row.action) || [];

    return {
      loginFailures: actions.filter(a => a === 'login_failure').length,
      rateLimitViolations: actions.filter(a => a === 'rate_limit_violation').length,
      honeypotTriggers: actions.filter(a => a === 'honeypot_trigger').length,
      unauthorizedAccess: actions.filter(a => a === 'unauthorized_access').length,
      injectionAttempts: actions.filter(a => 
        a === 'sql_injection_attempt' || a === 'xss_attempt'
      ).length,
    };
  }
}

export default AuditLogger;
