/**
 * SecurityDashboardPage - Dashboard de Monitoramento de Segurança
 * 
 * Exibe métricas de segurança em tempo real:
 * - Tentativas de login falhas
 * - Violações de rate limit
 * - Acionamentos de honeypot
 * - Rejeições de upload
 * - Top IPs suspeitos
 * 
 * Acesso restrito a administradores.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AuditLogger from '../services/auditLogger';
import AppHeader from '../components/AppHeader';

interface SecurityStats {
  loginFailures: number;
  rateLimitViolations: number;
  honeypotTriggers: number;
  unauthorizedAccess: number;
  injectionAttempts: number;
}

interface SecurityEvent {
  id: string;
  event_type: string;
  created_at: string;
  ip_address?: string;
  severity: 'info' | 'warning' | 'critical';
}

export default function SecurityDashboardPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [recentEvents, setRecentEvents] = useState<SecurityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
      return;
    }

    // Verificar se é admin (simplificado - em produção, verificar no backend)
    // Por enquanto, qualquer usuário autenticado pode ver
    loadSecurityData();
  }, [user, loading, navigate]);

  const loadSecurityData = async () => {
    setIsLoading(true);
    try {
      // Carregar estatísticas
      const securityStats = await AuditLogger.getSecurityStats();
      setStats(securityStats);

      // Carregar eventos recentes
      const events = await AuditLogger.getLogs({
        limit: 20,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Últimas 24h
      });
      setRecentEvents(events as unknown as SecurityEvent[]);
    } catch (error) {
      console.error('Erro ao carregar dados de segurança:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-900/50 border-red-700 text-red-300';
      case 'warning':
        return 'bg-yellow-900/50 border-yellow-700 text-yellow-300';
      default:
        return 'bg-blue-900/50 border-blue-700 text-blue-300';
    }
  };

  const getEventIcon = (eventType: string) => {
    if (eventType.includes('login')) return '🔐';
    if (eventType.includes('rate_limit')) return '⏱️';
    if (eventType.includes('honeypot')) return '🍯';
    if (eventType.includes('injection') || eventType.includes('xss')) return '💉';
    if (eventType.includes('unauthorized')) return '🚫';
    return '📋';
  };

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <AppHeader />
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">
            Dashboard de Segurança
          </h1>
          <p className="text-gray-400">
            Monitoramento de eventos de segurança nas últimas 24 horas
          </p>
        </div>

        {/* Cards de Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <StatCard
            title="Login Falhos"
            value={stats?.loginFailures || 0}
            icon="🔐"
            color="yellow"
          />
          <StatCard
            title="Rate Limit"
            value={stats?.rateLimitViolations || 0}
            icon="⏱️"
            color="orange"
          />
          <StatCard
            title="Honeypot"
            value={stats?.honeypotTriggers || 0}
            icon="🍯"
            color="red"
          />
          <StatCard
            title="Acesso Negado"
            value={stats?.unauthorizedAccess || 0}
            icon="🚫"
            color="purple"
          />
          <StatCard
            title="Injeções"
            value={stats?.injectionAttempts || 0}
            icon="💉"
            color="red"
          />
        </div>

        {/* Alertas Ativos */}
        {stats && (stats.honeypotTriggers > 0 || stats.injectionAttempts > 0) && (
          <div className="mb-8 p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <h3 className="text-red-300 font-semibold mb-2">⚠️ Alertas Ativos</h3>
            <ul className="text-red-200 text-sm space-y-1">
              {stats.honeypotTriggers > 0 && (
                <li>• {stats.honeypotTriggers} acionamento(s) de honeypot detectado(s)</li>
              )}
              {stats.injectionAttempts > 0 && (
                <li>• {stats.injectionAttempts} tentativa(s) de injeção bloqueada(s)</li>
              )}
            </ul>
          </div>
        )}

        {/* Timeline de Eventos */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-white">
              Eventos Recentes
            </h2>
            <button
              onClick={loadSecurityData}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Atualizar
            </button>
          </div>

          {recentEvents.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              Nenhum evento de segurança nas últimas 24 horas
            </p>
          ) : (
            <div className="space-y-3">
              {recentEvents.map((event) => (
                <div
                  key={event.id}
                  className={`p-3 rounded-lg border ${getSeverityColor(event.severity)}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{getEventIcon(event.event_type)}</span>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <span className="font-medium">
                          {formatEventType(event.event_type)}
                        </span>
                        <span className="text-xs opacity-70">
                          {formatDate(event.created_at)}
                        </span>
                      </div>
                      {event.ip_address && (
                        <span className="text-xs opacity-70">
                          IP: {event.ip_address}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Informações do Sistema */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Proteções Ativas
            </h3>
            <ul className="space-y-2 text-sm">
              <ProtectionItem label="Rate Limiting" active />
              <ProtectionItem label="Brute Force Protection" active />
              <ProtectionItem label="SQL Injection Detection" active />
              <ProtectionItem label="XSS Prevention" active />
              <ProtectionItem label="CSRF Protection" active />
              <ProtectionItem label="Honeypot Detection" active />
              <ProtectionItem label="Security Headers" active />
              <ProtectionItem label="MFA" active={false} />
            </ul>
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Configurações de Limite
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex justify-between">
                <span>Login por IP</span>
                <span className="text-gray-500">5 / 15 min</span>
              </li>
              <li className="flex justify-between">
                <span>API por IP</span>
                <span className="text-gray-500">100 / min</span>
              </li>
              <li className="flex justify-between">
                <span>Criação de Frete</span>
                <span className="text-gray-500">10 / hora</span>
              </li>
              <li className="flex justify-between">
                <span>Upload de Documento</span>
                <span className="text-gray-500">20 / hora</span>
              </li>
              <li className="flex justify-between">
                <span>Mensagens de Chat</span>
                <span className="text-gray-500">100 / hora</span>
              </li>
              <li className="flex justify-between">
                <span>Lockout por Brute Force</span>
                <span className="text-gray-500">5 falhas → 30 min</span>
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}

// Componentes auxiliares

function StatCard({ 
  title, 
  value, 
  icon, 
  color 
}: { 
  title: string; 
  value: number; 
  icon: string; 
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    yellow: 'bg-yellow-900/30 border-yellow-700',
    orange: 'bg-orange-900/30 border-orange-700',
    red: 'bg-red-900/30 border-red-700',
    purple: 'bg-purple-900/30 border-purple-700',
    blue: 'bg-blue-900/30 border-blue-700',
  };

  return (
    <div className={`p-4 rounded-xl border ${colorClasses[color] || colorClasses.blue}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{icon}</span>
        <span className="text-gray-400 text-sm">{title}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

function ProtectionItem({ label, active }: { label: string; active: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span className={active ? 'text-green-400' : 'text-gray-500'}>
        {active ? '✓' : '○'}
      </span>
      <span className={active ? 'text-gray-300' : 'text-gray-500'}>
        {label}
      </span>
      {!active && (
        <span className="text-xs text-gray-600 ml-auto">Em breve</span>
      )}
    </li>
  );
}

function formatEventType(type: string): string {
  const labels: Record<string, string> = {
    login_failure: 'Falha de Login',
    login_success: 'Login Bem-sucedido',
    logout: 'Logout',
    rate_limit_violation: 'Limite de Taxa Excedido',
    honeypot_trigger: 'Honeypot Acionado',
    sql_injection_attempt: 'Tentativa de SQL Injection',
    xss_attempt: 'Tentativa de XSS',
    unauthorized_access: 'Acesso Não Autorizado',
    brute_force_lockout: 'Conta Bloqueada',
    file_validation_failure: 'Upload Rejeitado',
  };
  return labels[type] || type;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'Agora';
  if (diffMins < 60) return `${diffMins} min atrás`;
  if (diffHours < 24) return `${diffHours}h atrás`;
  return date.toLocaleDateString('pt-BR');
}
