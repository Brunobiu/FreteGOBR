# Implementation Plan: motorista-chat-nav

## Overview

Plano incremental para adicionar o `Chat_Slot` à `MotoristaBottomNav` (de 5 para 6
slots), com `Chat_Badge` que conta **conversas distintas não lidas**
(`Conversation_Badge_Count`), atualização em tempo real via `Realtime_Channel` e
alinhamento do contrato do `Unread_Count_Event` para significar conversas (não mensagens).

A construção começa pelos helpers puros e pela função de serviço (base testável por
property-based testing), segue pela UI da bottom nav e termina migrando os
produtores/consumidores do evento para o novo contrato, garantindo que header e rodapé
mostrem o mesmo número. Cada etapa se apoia na anterior e é integrada ao final.

Linguagem de implementação: **TypeScript** (definida no design — React 18 + Vite).

## Tasks

- [x] 1. Helpers puros de contagem/reducer e função de serviço em `src/services/chatFrete.ts`
  - [x] 1.1 Adicionar tipo e helpers puros de contagem
    - Adicionar a interface `UnreadMessageRow { conversationId; senderId; readAt }`
    - Implementar `countUnreadConversations(rows, userId)` (Set de `conversationId` com `senderId != userId` e `readAt === null`)
    - Implementar `countUnreadInConversation(rows, userId)` (nº de mensagens não lidas de terceiros)
    - Exportar ambos para reuso pela UI e pelos testes
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 4.1, 4.2, 4.3_

  - [x] 1.2 Adicionar helpers puros de formatação e reducer do conjunto de não lidas
    - Implementar `formatBadge(n)`: `''` quando `n === 0`, `String(n)` quando `1..9`, `'9+'` quando `n > 9`
    - Implementar reducer `applyIncomingMessage(set, conversationId, senderIsMotorista)`: retorna `set ∪ {c}` quando remetente não é o motorista; no-op caso contrário
    - Implementar reducer `applyMarkRead(set, conversationId)`: retorna `set \ {c}`
    - Manter as funções puras (sem I/O) e exportadas
    - _Requirements: 3.4, 3.5, 5.1, 5.2, 5.5, 5.6, 6.1, 6.2_

  - [x] 1.3 Implementar `getUnreadConversationsCount(userId)` (async, autoritativo)
    - Buscar `conversations` do motorista via `.or(motorista_id.eq / embarcador_id.eq)`; retornar 0 se não houver
    - Buscar `messages` filtrando `.in(conversation_id)`, `.neq('sender_id', userId)`, `.is('read_at', null)`
    - Em erro de query, resolver `0` (degradação silenciosa)
    - Mapear linhas para `UnreadMessageRow[]` e delegar a `countUnreadConversations`
    - _Requirements: 3.1, 6.3, 7.2, 7.3_

  - [x]* 1.4 Property test cp1 — contagem de conversas distintas não lidas
    - Arquivo `src/__tests__/cp1_count_unread_conversations.property.test.ts`
    - **Property 1: Contagem é o número de conversas distintas não lidas**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.6**
    - Gerar `UnreadMessageRow[]` com `conversationId`/`senderId` via `fc.uuid()`/`fc.constantFrom` (colisões intencionais), `readAt` nulo/preenchido; conferir contra `Set` de referência. NUNCA `fc.stringOf`. Mín. 100 iterações

  - [x]* 1.5 Property test cp2 — contagem por conversa
    - Arquivo `src/__tests__/cp2_count_unread_in_conversation.property.test.ts`
    - **Property 2: Contagem por conversa conta apenas mensagens não lidas de terceiros**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Gerar mensagens de uma conversa; conferir `countUnreadInConversation`; caso sem não lidas ⇒ 0

  - [x]* 1.6 Property test cp3 — formatação do badge satura em "9+"
    - Arquivo `src/__tests__/cp3_format_badge.property.test.ts`
    - **Property 3: Formatação do badge satura em "9+"**
    - **Validates: Requirements 3.4, 3.5**
    - Para `n` em `fc.nat()`, conferir `formatBadge(n)` (`''` / `String(n)` / `'9+'`)

  - [x]* 1.7 Property test cp4 — inserção idempotente por conversa
    - Arquivo `src/__tests__/cp4_apply_incoming_message.property.test.ts`
    - **Property 4: Inserção de mensagem não lida é incremento idempotente por conversa**
    - **Validates: Requirements 5.1, 5.2**
    - Conferir transição `|S'| = |S| + 1` quando `c ∉ S` e `|S'| = |S|` quando `c ∈ S`

  - [x]* 1.8 Property test cp5 — marcar como lida decrementa em 1 (ou no-op)
    - Arquivo `src/__tests__/cp5_apply_mark_read.property.test.ts`
    - **Property 5: Marcar conversa como lida decrementa em exatamente 1 (ou mantém)**
    - **Validates: Requirements 5.5**
    - Conferir `S' = S \ {c}`: decremento quando `c ∈ S`, no-op quando `c ∉ S`

  - [x]* 1.9 Property test cp6 — invariante de não-negatividade e tamanho do conjunto
    - Arquivo `src/__tests__/cp6_badge_count_invariant.property.test.ts`
    - **Property 6: O Conversation_Badge_Count é sempre inteiro não negativo igual ao tamanho do conjunto**
    - **Validates: Requirements 5.6, 6.1, 6.2**
    - Gerar sequência aleatória de inserções/marcações; invariante `count === set.size` e `count >= 0`; conjunto vazio ⇒ 0 (sem badge)

- [x] 2. Chat_Slot e Chat_Badge na `MotoristaBottomNav`
  - [x] 2.1 Alterar layout e adicionar o Chat_Slot com navegação e estado ativo
    - Em `src/components/MotoristaBottomNav.tsx`, trocar `grid-cols-5` → `grid-cols-6`
    - Inserir o Chat_Slot na 2ª posição; ordem final: Início, Chat, Mapa, ANTT, Marketplace, Menu
    - Reduzir sizing (ícone `w-5 h-5`, rótulo `text-[9px]`) preservando o estilo pílula e o auto-hide-on-scroll
    - `onClick` chama `navigate('/mensagens')`; `isChatActive = location.pathname === '/mensagens'` aplica `text-green-400`
    - Definir `aria-label` em pt-BR (ex.: "Chat" / "Chat - N conversas não lidas")
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.4_

  - [x] 2.2 Implementar estado do badge, realtime debounced e consumo do evento
    - Manter `chatUnread: number` e renderizar o Chat_Badge sobreposto (espelhando o dot do Menu) somente quando `> 0`, usando `formatBadge`
    - Buscar valor inicial via `getUnreadConversationsCount(user.id)`
    - Assinar o `Realtime_Channel` (INSERT em `messages`) e recomputar (debounce ~250 ms) quando o remetente não é o motorista; sem polling
    - Ouvir o `Unread_Count_Event` (`fretego-chat-unread-count`) e refletir o `detail` numérico (guard `typeof detail === 'number'`)
    - Garantir que erro de contagem não oculta o slot nem quebra a navegação (apenas o badge some)
    - _Requirements: 3.4, 5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.2, 6.3_

  - [x]* 2.3 Testes de componente da bottom nav (example-based)
    - Arquivo `src/__tests__/motorista_bottom_nav.test.tsx`
    - Render motorista: existe item "Chat"; ordem dos 6 slots; classe `grid-cols-6`; aria-label pt-BR (Req 1.1–1.5)
    - Estado ativo em `/mensagens` (Req 1.6); clique chama `navigate('/mensagens')` (Req 2.1, 2.4)
    - Badge: oculto com count 0; visível com número; `"9+"` quando >9 (Req 3.4, 6.1)
    - `Unread_Count_Event`: `detail=k` → badge reflete `k`; ignora `detail` não numérico (Req 5.3)
    - Degradação: mock de erro do Supabase → resolve 0 e navegação preservada (Req 6.3)
    - Não-motorista → componente não monta (Req 7.1)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.4, 3.4, 5.3, 6.1, 6.3, 7.1_

- [x] 3. Alinhar o contrato do `Unread_Count_Event` = conversas (migrar produtores/consumidores)
  - [x] 3.1 Migrar `AppHeader` para `getUnreadConversationsCount`
    - Em `src/components/AppHeader.tsx`, trocar `getTotalUnreadCount` → `getUnreadConversationsCount` no `refreshCounts` do badge de chat
    - Manter o consumo do evento (já reflete `detail` numérico) para consistência com o Chat_Slot
    - _Requirements: 5.3_

  - [x] 3.2 Migrar `FreteChatWidget` para recompute autoritativo por conversas
    - Em `src/components/FreteChatWidget.tsx`, trocar contagem inicial e recompute para `getUnreadConversationsCount`
    - Substituir incremento por mensagem (`setTotalUnread((c) => c + 1)`) por recompute autoritativo (debounced) no handler de INSERT
    - Disparar o `Unread_Count_Event` com o valor de conversas (idempotência Req 5.2)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 3.3 Migrar dispatch da `MensagensPage` e formalizar contador por item
    - Em `src/pages/MensagensPage.tsx`, trocar a fonte do dispatch do evento de `getTotalUnreadCount` → `getUnreadConversationsCount`
    - Após `markFreteMessagesAsRead`, recomputar e disparar o evento com o novo valor (decrementa/zera — Req 5.5, 5.6)
    - Usar `countUnreadInConversation` como base do contador por item da lista; omitir quando 0
    - _Requirements: 2.2, 2.3, 4.1, 4.2, 4.3, 5.5, 5.6_

- [ ] 4. Testes de integração (CI, pasta `tests/`)
  - [ ]* 4.1 Teste de escopo RLS na contagem
    - Arquivo `tests/motorista-chat-nav.rls.test.ts`
    - Motorista não recebe conversas alheias no `getUnreadConversationsCount`; consulta restrita ao motorista autenticado (branch Supabase efêmero)
    - _Requirements: 7.2, 7.3_

  - [ ]* 4.2 Teste do fluxo realtime end-to-end
    - Arquivo `tests/motorista-chat-nav.realtime.test.ts`
    - INSERT de mensagem de terceiro incrementa o badge sem reload; marcar lida decrementa; determinístico (mock do canal quando possível, sem flaky)
    - _Requirements: 5.1, 5.5_

- [x] 5. Checkpoint — build + regressão
  - Rodar build, lint e a suíte completa (unit + property + regressão). Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são testes (governança exige tests; aqui marcados conforme convenção de sub-tarefas opcionais, mas devem ser entregues para a feature ser considerada concluída).
- `chatFrete.ts` é Critical_Module de chat: manter a cobertura mínima de `tests/coverage.config.ts` ao tocá-lo.
- Convenções fast-check do projeto: NUNCA `fc.stringOf`; usar `fc.string({minLength,maxLength}).filter(...)` e `fc.constantFrom`/`fc.uuid` para IDs; `vi.mock` é hoisted (expor spies via `globalThis`).
- Cada property test referencia explicitamente uma Property do design e os requisitos validados.
- Sem polling: todas as atualizações vêm do `Realtime_Channel` e do `Unread_Count_Event`.
- Esta workflow gera apenas artefatos de planejamento; a implementação começa abrindo `tasks.md` e clicando em "Start task".

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.5"] },
    { "id": 2, "tasks": ["1.3", "1.6", "1.7", "1.8", "1.9"] },
    { "id": 3, "tasks": ["2.2", "3.1", "3.2", "3.3"] },
    { "id": 4, "tasks": ["2.3", "4.1", "4.2"] }
  ]
}
```
