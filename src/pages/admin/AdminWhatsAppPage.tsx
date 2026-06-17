/**
 * AdminWhatsAppPage - /admin/whatsapp (task 21.2 — fiação final)
 *
 * Central de automações de WhatsApp do FreteGO (multi-instância, data-driven).
 * Gated por SETTINGS_VIEW (recurso sensível: disparo em massa / auto-resposta);
 * acesso negado renderiza Stealth404 (task 20.15). Toda operação é escopada à
 * Active_Instance selecionada no Instance_Panel (hook `useWhatsAppInstance`).
 *
 * Estrutura: Instance_Panel no topo + abas escopadas à Active_Instance —
 * Visão geral (conexão + dashboard), Disparo em massa, Grupos, Programados,
 * Fila, Histórico, Rascunhos, IA, Conversas e Extrator. As superfícies que
 * acompanham estado (Dashboard, Fila, Conversas) atualizam em tempo real via
 * `useRealtimeDispatch` (com fallback de polling). Reusa a rota e o item de
 * menu existentes, sem alterar outras rotas.
 */

import { useState } from 'react';
import { useAdminPermission } from '../../hooks/useAdminPermission';
import { useWhatsAppInstance } from '../../hooks/useWhatsAppInstance';
import Stealth404 from '../../components/admin/Stealth404';
import InstancePanel from '../../components/admin/whatsapp/InstancePanel';
import ConnectionCard from '../../components/admin/whatsapp/ConnectionCard';
import InstanceDashboard from '../../components/admin/whatsapp/InstanceDashboard';
import BulkDispatchTab from '../../components/admin/whatsapp/BulkDispatchTab';
import GroupDispatchTab from '../../components/admin/whatsapp/GroupDispatchTab';
import ScheduledDispatchTab from '../../components/admin/whatsapp/ScheduledDispatchTab';
import ExecutionQueue from '../../components/admin/whatsapp/ExecutionQueue';
import CampaignHistory from '../../components/admin/whatsapp/CampaignHistory';
import DraftsList from '../../components/admin/whatsapp/DraftsList';
import AIServiceTab from '../../components/admin/whatsapp/AIServiceTab';
import ConversationInbox from '../../components/admin/whatsapp/ConversationInbox';
import ContactExtractorTab from '../../components/admin/whatsapp/ContactExtractorTab';

type WaTab =
  | 'overview'
  | 'bulk'
  | 'group'
  | 'scheduled'
  | 'queue'
  | 'history'
  | 'drafts'
  | 'ai'
  | 'inbox'
  | 'extractor';

export default function AdminWhatsAppPage() {
  const { allowed } = useAdminPermission('SETTINGS_VIEW');
  const { instances, activeId, setActiveId, loading, error } = useWhatsAppInstance(allowed);
  const [tab, setTab] = useState<WaTab>('overview');

  // Gating de leitura (recurso sensível) — sem SETTINGS_VIEW vê 404 (stealth).
  if (!allowed) return <Stealth404 />;

  return (
    <div className="space-y-4 p-3 sm:p-5">
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

      {error && (
        <div className="rounded border border-red-900/40 bg-red-500/10 p-2 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}

      {/* Seletor de instâncias (Active_Instance) */}
      <InstancePanel
        instances={instances}
        activeInstanceId={activeId}
        onSelect={setActiveId}
        loading={loading}
      />

      {activeId ? (
        <>
          {/* Abas */}
          <div className="flex flex-wrap gap-1 border-b border-gray-800">
            <TabButton label="Visão geral" active={tab === 'overview'} onClick={() => setTab('overview')} />
            <TabButton label="Disparo em massa" active={tab === 'bulk'} onClick={() => setTab('bulk')} />
            <TabButton label="Grupos" active={tab === 'group'} onClick={() => setTab('group')} />
            <TabButton label="Programados" active={tab === 'scheduled'} onClick={() => setTab('scheduled')} />
            <TabButton label="Fila" active={tab === 'queue'} onClick={() => setTab('queue')} />
            <TabButton label="Histórico" active={tab === 'history'} onClick={() => setTab('history')} />
            <TabButton label="Rascunhos" active={tab === 'drafts'} onClick={() => setTab('drafts')} />
            <TabButton label="IA" active={tab === 'ai'} onClick={() => setTab('ai')} />
            <TabButton label="Conversas" active={tab === 'inbox'} onClick={() => setTab('inbox')} />
            <TabButton label="Extrator" active={tab === 'extractor'} onClick={() => setTab('extractor')} />
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              <ConnectionCard key={`conn-${activeId}`} instanceId={activeId} />
              <InstanceDashboard key={`dash-${activeId}`} instanceId={activeId} />
            </div>
          )}

          {tab === 'bulk' && <BulkDispatchTab key={`bulk-${activeId}`} instanceId={activeId} />}
          {tab === 'group' && <GroupDispatchTab key={`group-${activeId}`} instanceId={activeId} />}
          {tab === 'scheduled' && (
            <ScheduledDispatchTab key={`sched-${activeId}`} instanceId={activeId} />
          )}
          {tab === 'queue' && <ExecutionQueue key={`queue-${activeId}`} instanceId={activeId} />}
          {tab === 'history' && <CampaignHistory key={`hist-${activeId}`} instanceId={activeId} />}
          {tab === 'drafts' && <DraftsList key={`drafts-${activeId}`} instanceId={activeId} />}
          {tab === 'ai' && <AIServiceTab key={`ai-${activeId}`} instanceId={activeId} />}
          {tab === 'inbox' && <ConversationInbox key={`inbox-${activeId}`} instanceId={activeId} />}
          {tab === 'extractor' && (
            <ContactExtractorTab key={`extr-${activeId}`} instanceId={activeId} />
          )}
        </>
      ) : (
        !loading && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-500">
            Selecione uma instância para ver os detalhes.
          </div>
        )
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-green-500 bg-gray-800/50 text-green-400'
          : 'border-transparent text-gray-400 hover:border-gray-600 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}
