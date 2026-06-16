/**
 * AdminWhatsAppPage - /admin/whatsapp
 *
 * Central de automações de WhatsApp do FreteGO. Conteúdo limpo, aguardando o
 * novo módulo completo de automação (Evolution API) que será definido em spec
 * dedicada. Mantém apenas o gate de permissão e um placeholder mínimo.
 *
 * Gated por SETTINGS_VIEW (apenas SUPER_ADMIN e ADMIN) — recurso sensível
 * (disparo em massa / auto-resposta). Acesso negado renderiza Stealth404.
 */

import { useAdminPermission } from '../../hooks/useAdminPermission';
import Stealth404 from '../../components/admin/Stealth404';

export default function AdminWhatsAppPage() {
  const { allowed } = useAdminPermission('SETTINGS_VIEW');
  if (!allowed) return <Stealth404 />;

  return (
    <div className="space-y-4">
      {/* Cabeçalho compacto (sem h1 grande, padrão do painel) */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/15 text-green-400">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-100">WhatsApp</div>
          <div className="text-xs text-gray-500">Automações de mensagens</div>
        </div>
      </div>
    </div>
  );
}
