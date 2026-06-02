/**
 * AdminWhatsAppPage - /admin/whatsapp
 *
 * Central de automações de WhatsApp do FreteGO. Por enquanto é um placeholder
 * estruturado ("Em breve") que descreve as automações planejadas. A integração
 * real (Evolution API ou outra) será implementada em uma spec dedicada.
 *
 * Gated por SETTINGS_VIEW (apenas SUPER_ADMIN e ADMIN) — recurso sensível
 * (disparo em massa / auto-resposta). Acesso negado renderiza Stealth404.
 */

import { useAdminPermission } from '../../hooks/useAdminPermission';
import Stealth404 from '../../components/admin/Stealth404';

interface PlannedFeature {
  title: string;
  description: string;
  icon: string; // path d de SVG (estilo lucide/inline, consistente com a sidebar)
}

const PLANNED_FEATURES: readonly PlannedFeature[] = [
  {
    title: 'Conexão do número',
    description:
      'Conectar o WhatsApp via QR code (Evolution API ou similar) e acompanhar o status da sessão.',
    icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
  },
  {
    title: 'Disparo em massa',
    description:
      'Enviar mensagens para listas segmentadas (motoristas, embarcadores, filtros) com controle de cadência.',
    icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
  },
  {
    title: 'Auto-resposta',
    description:
      'Responder automaticamente as pessoas com base em palavras-chave e fluxos configuráveis.',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
  {
    title: 'Modelos de mensagem',
    description: 'Criar e reutilizar templates de mensagem com variáveis (nome, frete, etc).',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
];

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
        <span className="ml-auto inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
          Em breve
        </span>
      </div>

      {/* Aviso de estado */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <p className="text-sm text-gray-300">
          Esta área vai concentrar as automações de WhatsApp do FreteGO. A integração ainda está em
          construção — em breve você vai poder conectar seu número e configurar os fluxos abaixo.
        </p>
      </div>

      {/* Funcionalidades planejadas */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PLANNED_FEATURES.map((f) => (
          <div
            key={f.title}
            className="flex gap-3 rounded-lg border border-gray-800 bg-gray-900 p-4 opacity-90"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-cyan-300">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={f.icon} />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-100">{f.title}</div>
              <p className="mt-0.5 text-xs text-gray-500">{f.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
