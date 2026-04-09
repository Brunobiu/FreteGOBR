/**
 * HoneypotDetector - Detecção de bots e scanners automatizados
 * 
 * Implementa honeypots (armadilhas) para detectar:
 * - Bots de scraping
 * - Scanners de vulnerabilidade
 * - Tentativas de enumeração
 * - Ataques automatizados
 * 
 * Tipos de honeypots:
 * - Rotas ocultas (ex: /admin-legacy)
 * - Campos de formulário invisíveis
 */

import { supabase } from './supabase';
import AuditLogger from './auditLogger';

export interface HoneypotTrigger {
  ip_address: string;
  user_agent: string;
  trigger_type: 'route' | 'field';
  trigger_name: string;
  timestamp: Date;
}

// Configuração
const MAX_TRIGGERS_BEFORE_BLOCK = 3;
const BLOCK_DURATION_HOURS = 24;

// In-memory store (em produção, usar Redis)
const triggerStore = new Map<string, HoneypotTrigger[]>();
const blockedIPs = new Map<string, Date>();

class HoneypotDetector {
  /**
   * Registra acionamento de honeypot
   */
  static async recordTrigger(
    ipAddress: string,
    userAgent: string,
    triggerType: 'route' | 'field',
    triggerName: string
  ): Promise<{ blocked: boolean; triggerCount: number }> {
    const trigger: HoneypotTrigger = {
      ip_address: ipAddress,
      user_agent: userAgent,
      trigger_type: triggerType,
      trigger_name: triggerName,
      timestamp: new Date(),
    };

    // Adicionar ao store
    const triggers = triggerStore.get(ipAddress) || [];
    triggers.push(trigger);
    triggerStore.set(ipAddress, triggers);

    // Log no audit
    await AuditLogger.logHoneypotTrigger(triggerType, {
      ip_address: ipAddress,
      user_agent: userAgent,
      trigger_name: triggerName,
    });

    // Salvar no banco
    try {
      await supabase.from('honeypot_triggers').insert({
        ip_address: ipAddress,
        user_agent: userAgent,
        trigger_type: triggerType,
        trigger_name: triggerName,
      });
    } catch (error) {
      console.error('[HONEYPOT] Erro ao salvar trigger:', error);
    }

    // Verificar se deve bloquear
    const recentTriggers = triggers.filter(t => {
      const hourAgo = new Date();
      hourAgo.setHours(hourAgo.getHours() - 1);
      return t.timestamp > hourAgo;
    });

    if (recentTriggers.length >= MAX_TRIGGERS_BEFORE_BLOCK) {
      await this.blockIP(ipAddress);
      return { blocked: true, triggerCount: recentTriggers.length };
    }

    return { blocked: false, triggerCount: recentTriggers.length };
  }

  /**
   * Verifica se IP está bloqueado
   */
  static isBlocked(ipAddress: string): boolean {
    const blockedUntil = blockedIPs.get(ipAddress);
    
    if (!blockedUntil) {
      return false;
    }

    if (new Date() > blockedUntil) {
      blockedIPs.delete(ipAddress);
      return false;
    }

    return true;
  }

  /**
   * Bloqueia um IP
   */
  static async blockIP(ipAddress: string): Promise<void> {
    const blockedUntil = new Date();
    blockedUntil.setHours(blockedUntil.getHours() + BLOCK_DURATION_HOURS);
    
    blockedIPs.set(ipAddress, blockedUntil);

    console.warn(`[HONEYPOT] IP bloqueado: ${ipAddress} até ${blockedUntil.toISOString()}`);

    // Salvar no banco
    try {
      await supabase.from('blocked_ips').upsert({
        ip_address: ipAddress,
        reason: 'honeypot_triggers',
        blocked_until: blockedUntil.toISOString(),
      });
    } catch (error) {
      console.error('[HONEYPOT] Erro ao salvar bloqueio:', error);
    }
  }

  /**
   * Desbloqueia um IP (admin)
   */
  static async unblockIP(ipAddress: string): Promise<void> {
    blockedIPs.delete(ipAddress);

    try {
      await supabase
        .from('blocked_ips')
        .delete()
        .eq('ip_address', ipAddress);
    } catch (error) {
      console.error('[HONEYPOT] Erro ao remover bloqueio:', error);
    }
  }

  /**
   * Cria configuração para campo honeypot em formulário
   * O campo deve ser invisível para usuários reais mas visível para bots
   */
  static createFieldHoneypot(fieldName: string): {
    name: string;
    style: React.CSSProperties;
    ariaHidden: boolean;
    tabIndex: number;
    autoComplete: string;
  } {
    return {
      name: fieldName,
      style: {
        position: 'absolute',
        left: '-9999px',
        top: '-9999px',
        width: '1px',
        height: '1px',
        opacity: 0,
        overflow: 'hidden',
      },
      ariaHidden: true,
      tabIndex: -1,
      autoComplete: 'off',
    };
  }

  /**
   * Valida se campo honeypot foi preenchido (indica bot)
   */
  static async validateField(
    fieldValue: string,
    fieldName: string,
    ipAddress: string,
    userAgent: string
  ): Promise<{ isBot: boolean; blocked: boolean }> {
    // Se o campo honeypot foi preenchido, é um bot
    if (fieldValue && fieldValue.trim() !== '') {
      const result = await this.recordTrigger(
        ipAddress,
        userAgent,
        'field',
        fieldName
      );

      return {
        isBot: true,
        blocked: result.blocked,
      };
    }

    return { isBot: false, blocked: false };
  }

  /**
   * Handler para rota honeypot
   * Deve ser chamado quando uma rota oculta é acessada
   */
  static async handleRouteAccess(
    routePath: string,
    ipAddress: string,
    userAgent: string
  ): Promise<{ blocked: boolean }> {
    const result = await this.recordTrigger(
      ipAddress,
      userAgent,
      'route',
      routePath
    );

    return { blocked: result.blocked };
  }

  /**
   * Lista de rotas honeypot conhecidas
   */
  static getHoneypotRoutes(): string[] {
    return [
      '/admin-legacy',
      '/wp-admin',
      '/wp-login.php',
      '/administrator',
      '/phpmyadmin',
      '/.env',
      '/config.php',
      '/backup',
      '/api/v1/admin',
    ];
  }

  /**
   * Verifica se uma rota é honeypot
   */
  static isHoneypotRoute(path: string): boolean {
    return this.getHoneypotRoutes().some(route => 
      path.toLowerCase().includes(route.toLowerCase())
    );
  }

  /**
   * Obtém estatísticas de honeypot
   */
  static async getStats(): Promise<{
    totalTriggers: number;
    blockedIPs: number;
    recentTriggers: HoneypotTrigger[];
  }> {
    const allTriggers: HoneypotTrigger[] = [];
    triggerStore.forEach(triggers => allTriggers.push(...triggers));

    const hourAgo = new Date();
    hourAgo.setHours(hourAgo.getHours() - 24);

    const recentTriggers = allTriggers
      .filter(t => t.timestamp > hourAgo)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 50);

    return {
      totalTriggers: allTriggers.length,
      blockedIPs: blockedIPs.size,
      recentTriggers,
    };
  }

  /**
   * Limpa dados antigos
   */
  static cleanup(): void {
    const now = new Date();
    let cleanedTriggers = 0;
    let cleanedBlocks = 0;

    // Limpar triggers antigos (mais de 24h)
    const dayAgo = new Date();
    dayAgo.setHours(dayAgo.getHours() - 24);

    triggerStore.forEach((triggers, ip) => {
      const recent = triggers.filter(t => t.timestamp > dayAgo);
      if (recent.length < triggers.length) {
        cleanedTriggers += triggers.length - recent.length;
        if (recent.length === 0) {
          triggerStore.delete(ip);
        } else {
          triggerStore.set(ip, recent);
        }
      }
    });

    // Limpar bloqueios expirados
    blockedIPs.forEach((blockedUntil, ip) => {
      if (now > blockedUntil) {
        blockedIPs.delete(ip);
        cleanedBlocks++;
      }
    });

    if (cleanedTriggers > 0 || cleanedBlocks > 0) {
      console.log(`[HONEYPOT] Limpeza: ${cleanedTriggers} triggers, ${cleanedBlocks} bloqueios`);
    }
  }
}

// Limpeza periódica a cada hora
if (typeof window !== 'undefined') {
  setInterval(() => HoneypotDetector.cleanup(), 60 * 60 * 1000);
}

export default HoneypotDetector;
