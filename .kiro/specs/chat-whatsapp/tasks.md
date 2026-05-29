# Plano de Implementação - Chat / WhatsApp

> **STATUS (29/05/2026)**: spec **100% concluída** via implementação
> incremental. Funcionalidades validadas em produção.
>
> Arquivos chave:
> - `src/components/FreteChatWidget.tsx` — widget global de chat
> - `src/components/FreteCard.tsx`, `FreteModal` — botão WhatsApp e Chat
> - `src/services/chatFrete.ts`, `services/chat.ts` — API
> - `src/pages/MensagensPage.tsx` — central de conversas
> - Migrations: 008, 009 (chat_conversations, chat_messages, conversations,
>   messages), 023, 024 (notify_new_message), 025 (chat_attachments).

## Tarefas

- [x] 1. Iniciar Conversa pelo Frete
  - [x] Botão "Chat" no FreteModal
  - [x] Conversa vinculada ao frete (`conversations.frete_id`)
  - [x] Reabertura de conversa existente (UNIQUE constraint)
  - [x] Header da conversa com info do frete

- [x] 2. Widget de Chat
  - [x] Ícone fixo bottom-right via `FreteChatWidget`
  - [x] Painel de conversas
  - [x] Lista de conversas ativas
  - [x] Badge global de não-lidas
  - [x] Minimizar/maximizar

- [x] 3. Envio e Recebimento
  - [x] Envio de texto
  - [x] Tempo real via Supabase Realtime
  - [x] Timestamp por mensagem
  - [x] Status enviado/lido (`read_at`)
  - [x] Ordenação por data

- [x] 4. Notificações
  - [x] Badge visual no header
  - [x] Dedup de notificação `new_message` (migration 024)
  - [x] Marca como lido ao abrir
  - [x] Som configurável (notifications-hub)

- [x] 5. Histórico
  - [x] Lista de conversas em `MensagensPage`
  - [x] Última mensagem e timestamp
  - [x] Ordenação por atividade
  - [x] Busca por nome/frete

- [x] 6. Integração WhatsApp
  - [x] Botão "WhatsApp" no FreteCard / FreteModal
  - [x] Abre `wa.me/<phone>?text=<mensagem>`
  - [x] Mensagem pré-preenchida com info do frete

## Notas

Esta spec foi escrita na fase inicial do projeto. O trabalho real
foi feito de forma orgânica conforme a feature crescia. O chat
interno (Supabase Realtime) e a integração WhatsApp coexistem
no FreteCard como dois CTAs separados, dando ao motorista a
opção de canal preferido.

### Próximas evoluções (não escopo desta spec)

- WhatsApp Business API real (mensagens automáticas pelo sistema
  via número oficial). Hoje usa apenas `wa.me` (deeplink).
- Anexos no chat interno (já tem migration 025 mas UI parcial).
- Indicador de "digitando..."
- Reactions / reply quoting
