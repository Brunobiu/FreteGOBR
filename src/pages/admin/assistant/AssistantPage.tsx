/**
 * AssistantPage — /admin/assistant
 *
 * Pagina do modulo Assistente (assistente de IA pessoal do Master_Admin).
 * Orquestra, em layout compacto pos-cleanup, as TRES secoes na ordem
 * definida em Req 1.8:
 *
 *   1. Mural de Destaques (HighlightsFeed)  — topo
 *   2. Chat (AssistantChat)
 *   3. Configuracoes (AssistantSettings + AssistantStatus)
 *
 * Gating em duas camadas (admin-patterns.md §2/§5): a UI exige
 * `ASSISTANT_VIEW`; sem a permissao, renderiza `Stealth404` (404 furtivo
 * identico ao publico, sem revelar a existencia da rota — Req 1.3). O
 * servidor reaplica o gating em todas as RPCs `SECURITY DEFINER`.
 *
 * Padrao compacto (Req 1.7 / project-conventions.md): SEM `<h1>` grande no
 * topo — a sidebar ja identifica o modulo. Container `space-y-3` como nos
 * demais modulos admin.
 *
 * Wiring Mural -> Chat: ao selecionar um Highlight com conversa referenciada,
 * `onSelectConversation` define o `conversationId` passado ao Chat, que entao
 * carrega o historico daquela conversa. Quando o Chat cria uma nova conversa
 * no primeiro envio, `onConversationCreated` atualiza a conversa selecionada.
 *
 * Isolamento de falhas (Req 4.7): cada secao se auto-carrega e trata o proprio
 * erro internamente (HighlightsFeed exibe `DashboardBlockError` so no Mural;
 * Settings/Status exibem seus proprios estados de erro). Como sao irmaos
 * independentes na arvore, a falha de uma secao nao impede a renderizacao das
 * demais — mesmo efeito do padrao `Promise.allSettled` de degradacao parcial.
 *
 * Responsividade (Req 16.2): coluna unica abaixo de 768px. A faixa de
 * Configuracoes vira duas colunas (Configuracoes + Status) apenas a partir de
 * `md` (>= 768px); abaixo disso tudo empilha em coluna unica.
 *
 * Requisitos: 1.7, 1.8, 4.7, 16.2.
 */

import { useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import HighlightsFeed from '../../../components/admin/assistant/HighlightsFeed';
import AssistantChat from '../../../components/admin/assistant/AssistantChat';
import AssistantSettings from '../../../components/admin/assistant/AssistantSettings';
import AssistantStatus from '../../../components/admin/assistant/AssistantStatus';

export default function AssistantPage() {
  const { allowed: canView } = useAdminPermission('ASSISTANT_VIEW');

  // Conversa selecionada in-page: alimentada pelo Mural (ao abrir um destaque)
  // e atualizada pelo Chat quando uma nova conversa e criada no 1o envio.
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  // Gate de UI: sem ASSISTANT_VIEW cai no 404 furtivo (Req 1.3).
  if (!canView) return <Stealth404 />;

  return (
    <div className="space-y-3">
      {/* 1. Mural de Destaques (topo) — Req 1.8 */}
      <HighlightsFeed onSelectConversation={setSelectedConversationId} />

      {/* 2. Chat */}
      <AssistantChat
        conversationId={selectedConversationId}
        onConversationCreated={setSelectedConversationId}
      />

      {/* 3. Configuracoes — Settings + Status.
          Coluna unica < 768px; duas colunas a partir de md (Req 16.2). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <AssistantSettings />
        <AssistantStatus />
      </div>
    </div>
  );
}
