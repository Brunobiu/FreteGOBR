# Plano de Implementação - Chat/WhatsApp Integration

## Tarefas

- [ ] 1. Criar migração do banco de dados
  - [ ] 1.1 Criar supabase/migrations/008_chat_system.sql
    - Tabela conversations (id, frete_id, motorista_id, embarcador_id, timestamps)
    - Tabela messages (id, conversation_id, sender_id, content, read_at, created_at)
    - Índices para performance
    - RLS policies para privacidade

- [ ] 2. Criar serviço de chat
  - [ ] 2.1 Atualizar src/services/chat.ts
    - Função getOrCreateConversation
    - Função getConversations
    - Função getMessages
    - Função sendMessage
    - Função markAsRead
  - [ ] 2.2 Implementar subscriptions Realtime
    - subscribeToMessages
    - subscribeToConversations

- [ ] 3. Criar hook useChat
  - [ ] 3.1 Criar src/hooks/useChat.ts
    - Estado de conversas e mensagens
    - Contador de não lidas
    - Funções de ação (open, start, send, markAsRead)
    - Subscriptions Realtime

- [ ] 4. Criar componentes de chat
  - [ ] 4.1 Criar src/components/ChatConversationList.tsx
    - Lista de conversas com última mensagem
    - Badge de não lidas por conversa
    - Ordenação por atividade recente
  - [ ] 4.2 Criar src/components/ChatConversation.tsx
    - Cabeçalho com info do frete/usuário
    - Lista de mensagens
    - Input de nova mensagem
  - [ ] 4.3 Criar src/components/ChatMessage.tsx
    - Bolha de mensagem (enviada/recebida)
    - Timestamp
    - Status de leitura
  - [ ] 4.4 Criar src/components/ChatInput.tsx
    - Input de texto
    - Botão enviar
    - Indicador de digitando (opcional)

- [ ] 5. Refatorar ChatWidget
  - [ ] 5.1 Atualizar src/components/ChatWidget.tsx
    - Integrar ChatConversationList
    - Integrar ChatConversation
    - Gerenciar estado aberto/fechado
    - Badge de não lidas no ícone

- [ ] 6. Criar componente WhatsAppButton
  - [ ] 6.1 Criar src/components/WhatsAppButton.tsx
    - Gerar URL wa.me com número e mensagem
    - Mensagem pré-preenchida com dados do frete
    - Abrir em nova aba

- [ ] 7. Integrar no FreteModal
  - [ ] 7.1 Adicionar botão "Chat" que inicia conversa
  - [ ] 7.2 Adicionar WhatsAppButton
  - [ ] 7.3 Verificar perfil completo antes de exibir botões

- [ ] 8. Implementar notificações
  - [ ] 8.1 Badge no ícone do chat com contador
  - [ ] 8.2 Atualizar título da página com não lidas
  - [ ] 8.3 Som de notificação (opcional, configurável)

- [ ] 9. Testes e validação
  - [ ] 9.1 Testar criação de conversa
  - [ ] 9.2 Testar envio/recebimento em tempo real
  - [ ] 9.3 Testar marcação de lidas
  - [ ] 9.4 Testar RLS (privacidade)
  - [ ] 9.5 Testar botão WhatsApp
  - [ ] 9.6 Testar notificações
