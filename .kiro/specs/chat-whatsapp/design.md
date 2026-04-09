# Documento de Design - Chat/WhatsApp Integration

## Visão Geral

Sistema de comunicação em tempo real entre motoristas e embarcadores usando Supabase Realtime.

## Arquitetura

### Modelo de Dados

```sql
-- Tabela de conversas
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id UUID REFERENCES fretes(id),
  motorista_id UUID NOT NULL REFERENCES users(id),
  embarcador_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(frete_id, motorista_id)
);

-- Tabela de mensagens
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_conversations_users ON conversations(motorista_id, embarcador_id);
```

### Componentes

```
src/components/
├── ChatWidget.tsx          # Widget principal (já existe, refatorar)
├── ChatConversationList.tsx # Lista de conversas
├── ChatConversation.tsx    # Conversa individual
├── ChatMessage.tsx         # Mensagem individual
├── ChatInput.tsx           # Input de mensagem
├── WhatsAppButton.tsx      # Botão de WhatsApp
```

### Serviço de Chat

```typescript
// src/services/chat.ts
export async function getOrCreateConversation(
  freteId: string,
  motoristaId: string,
  embarcadorId: string
): Promise<Conversation>;

export async function getConversations(userId: string): Promise<Conversation[]>;

export async function getMessages(conversationId: string): Promise<Message[]>;

export async function sendMessage(
  conversationId: string,
  senderId: string,
  content: string
): Promise<Message>;

export async function markAsRead(conversationId: string, userId: string): Promise<void>;

export function subscribeToMessages(
  conversationId: string,
  callback: (message: Message) => void
): () => void;

export function subscribeToConversations(
  userId: string,
  callback: (conversation: Conversation) => void
): () => void;
```

### Hook de Chat

```typescript
// src/hooks/useChat.ts
export function useChat() {
  return {
    conversations: Conversation[];
    unreadCount: number;
    activeConversation: Conversation | null;
    messages: Message[];
    isLoading: boolean;
    openConversation: (conversationId: string) => void;
    startConversation: (freteId: string, embarcadorId: string) => Promise<void>;
    sendMessage: (content: string) => Promise<void>;
    markAsRead: () => Promise<void>;
  };
}
```

### Fluxo de Dados (Realtime)

```
┌─────────────────────────────────────────────────────────┐
│                    Supabase Realtime                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Channel: messages:conversation_id               │   │
│  │ Event: INSERT                                   │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│         ┌────────────────┼────────────────┐            │
│         ▼                ▼                ▼            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Motorista   │  │ Embarcador  │  │ Badge Count │    │
│  │ ChatWidget  │  │ ChatWidget  │  │ Update      │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Propriedades de Corretude

1. **Privacidade**: Apenas participantes podem ver mensagens da conversa
2. **Ordenação**: Mensagens sempre ordenadas por created_at ASC
3. **Unicidade**: Apenas uma conversa por par (frete, motorista)
4. **Tempo Real**: Mensagens aparecem em < 1 segundo após envio
