# Implementation Plan: Motorista AI Assistant

## Overview

Redesenho completo da página `/assistente` com UI dark estilo Siri, integração com IA real via Supabase Edge Function (`motorista-ai-chat`), persistência de conversas em tabelas Supabase, e adição do OpenAI como provedor configurável. Implementação incremental: database → utilities → services → UI → Edge Function → integração → testes.

## Tasks

- [ ] 1. Database migration e fundação
  - [ ] 1.1 Criar migration `090_motorista_ai_conversations.sql`
    - Criar tabela `motorista_ai_conversations` (id UUID PK, motorista_id FK→users, title TEXT, created_at, updated_at)
    - Criar tabela `motorista_ai_messages` (id UUID PK, conversation_id FK, role CHECK('user','assistant'), content TEXT, metadata JSONB nullable, created_at)
    - Criar índices `idx_motorista_ai_conversations_user` e `idx_motorista_ai_messages_conv`
    - Habilitar RLS em ambas tabelas com policies `motorista_ai_conversations_own` e `motorista_ai_messages_own`
    - Criar par rollback `090_motorista_ai_conversations_rollback.sql`
    - Usar padrão idempotente com `DO $check$` defensivo (admin-patterns Sec. 9)
    - _Requirements: 10.1, 10.2, 10.5, 10.6_

- [ ] 2. Utility functions e testes
  - [ ] 2.1 Implementar `src/utils/greeting.ts`
    - Criar `getGreetingPeriod(hour)` e `getGreeting(hour, firstName?)` conforme design
    - Exportar type `GreetingPeriod`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 2.2 Property test CP1: Greeting Period Correctness
    - **Property 1: Greeting Period Correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
    - Criar `src/__tests__/cp1_greeting_period.property.test.ts`
    - Usar `fc.integer({min:0, max:23})` × `fc.option(fc.string())`
    - Verificar prefixo correto por faixa horária, presença do nome quando não-vazio, sufixo 👋

  - [ ] 2.3 Implementar `src/utils/inferTitle.ts`
    - Criar `inferTitle(input: string): string` que retorna no máximo 40 caracteres
    - Truncar com ellipsis "…" quando input > 40 chars
    - _Requirements: 11.5_

  - [ ]* 2.4 Property test CP9: Title Inference Length Bound
    - **Property 9: Title Inference Length Bound**
    - **Validates: Requirements 11.5**
    - Criar `src/__tests__/cp9_title_inference.property.test.ts`
    - Usar `fc.string({minLength:1, maxLength:200})`
    - Verificar output ≤ 40 chars, igualdade quando input ≤ 40, truncamento com ellipsis quando > 40

- [ ] 3. Conversation service (Supabase)
  - [ ] 3.1 Implementar `src/services/motoristaAiConversations.ts`
    - Criar funções `listMotoristaConversations`, `createMotoristaConversation`, `getConversationMessages`, `addMessage`, `deleteMotoristaConversation`
    - Usar cliente Supabase de `src/services/supabase.ts`
    - Substituir o padrão localStorage existente em `src/services/aiConversations.ts`
    - _Requirements: 10.3, 10.4, 10.7, 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 4. Checkpoint - Verificar fundação
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Frontend: componentes visuais
  - [ ] 5.1 Criar `src/components/AssistantStarIcon.tsx`
    - Versão ampliada do AiFab (mínimo 80px, default 96px)
    - Estrela amarela de 4 pontas sobre círculo amarelo com sombra
    - Animação de pulso/brilho contínuo via CSS keyframes
    - Brilho externo púrpura/azul animado ao redor do círculo
    - _Requirements: 2.2, 2.3, 2.4_

  - [ ] 5.2 Redesenhar `src/pages/AssistantePage.tsx` — WelcomeView
    - Fundo escuro slate-950 em toda a tela
    - Greeting_Card acima do Star_Icon com saudação contextual via `getGreeting`
    - Star_Icon centralizado usando `AssistantStarIcon`
    - Quick_Cards abaixo (mínimo 3): "Quais fretes tem na minha região?", "Qual o frete mais lucrativo?", e pelo menos 1 adicional
    - Toque em Quick_Card envia mensagem imediatamente sem confirmação
    - Usar `useEffectiveLocation` em vez de `useGeolocation`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.5, 3.1, 3.2, 3.3_

  - [ ] 5.3 Redesenhar `src/pages/AssistantePage.tsx` — ChatView
    - Ocultar WelcomeView quando conversa estiver ativa
    - Bolhas de chat: user alinhada à direita (azul), assistant à esquerda com avatar
    - Indicador de digitação (dots animados) enquanto AI processa
    - Scroll vertical suave + auto-scroll para mensagem mais recente
    - Barra de input fixa na parte inferior com placeholder "Pergunte qualquer coisa..."
    - Envio via Enter ou botão
    - _Requirements: 3.4, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 5.4 Implementar gerenciamento de conversas na AssistantePage
    - Sidebar/menu com lista de conversas anteriores (carregadas do Supabase)
    - Botão "Nova conversa" reseta para WelcomeView
    - Seleção de conversa anterior carrega mensagens
    - Exclusão com confirmação via `deleteMotoristaConversation`
    - Inferência de título via `inferTitle` na primeira mensagem
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 6. Admin: adicionar OpenAI ao provider list
  - [ ] 6.1 Atualizar `src/services/admin/assistant.ts`
    - Adicionar `'openai'` ao type `AiProvider` e ao array `AI_PROVIDERS`
    - _Requirements: 8.1_

  - [ ] 6.2 Atualizar `src/services/admin/assistantProvider.ts`
    - Adicionar `OpenAIClient` implementando `AiProviderClient` (stub local; cliente real na Edge Function)
    - Atualizar `selectProviderClient` para retornar `OpenAIClient` quando provider === 'openai'
    - _Requirements: 8.1, 8.2_

  - [ ] 6.3 Atualizar UI `AssistantSettings.tsx`
    - Adicionar `{ value: 'openai', label: 'OpenAI (GPT)', functional: true }` ao array PROVIDERS
    - _Requirements: 8.1_

- [ ] 7. Checkpoint - Verificar frontend e admin
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Edge Function: motorista-ai-chat
  - [ ] 8.1 Criar estrutura `supabase/functions/motorista-ai-chat/`
    - Criar `index.ts` como entry point Deno com `Deno.serve`
    - Auth check: validar JWT com role `authenticated`
    - Parsear request body: `{ conversationId, message }`
    - Validar inputs; retornar `{ ok: false, error: 'invalid_input' }` se inválido
    - Retornar `{ ok: false, error: 'unauthorized' }` se JWT falhar
    - _Requirements: 9.1, 9.2, 9.5_

  - [ ] 8.2 Implementar `freightContext.ts` (FreightContextBuilder)
    - Ler effective_location + radius do motorista
    - Ler calc_context (km/L, diesel, capacidade)
    - Query fretes ativos com filtro geográfico (haversine) quando localização disponível
    - Calcular lucroLiquido e lucroPorKm por frete
    - Ordenar por lucroPorKm DESC, limitar a 20
    - Degradação parcial: sem localização → todos os fretes; sem calc → sem estimativa
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_

  - [ ] 8.3 Implementar `systemPrompt.ts` (SystemPromptBuilder)
    - Restrição a fretes exclusivamente
    - Instrução de rejeição educada para off-topic
    - Instrução de resposta em pt-BR
    - Freight context formatado no prompt
    - Status de calc_context (completo ou sugerir configuração)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 8.4 Implementar `providers/` (Provider Abstraction)
    - Criar `providers/openai.ts` (OpenAIClient): POST `/v1/chat/completions`, model configurável, max_tokens 1024
    - Criar `providers/claude.ts` (ClaudeClient): POST Anthropic Messages API
    - Criar `providers/gemini.ts` (GeminiClient): POST Google Generative AI API
    - Criar stubs `providers/grok.ts` e `providers/llama.ts` retornando `provider_not_implemented`
    - Criar `providers/index.ts` com `selectProviderClient` e leitura de API key do Vault
    - _Requirements: 8.2, 8.3, 8.4, 8.5_

  - [ ] 8.5 Orquestração completa no `index.ts`
    - Ler assistant_config → activeProvider + model
    - Chamar `buildFreightContext`
    - Chamar `buildSystemPrompt`
    - Ler últimas 10 mensagens da conversa
    - Ler API key do Vault (`assistant_provider_key_<provider>`)
    - Invocar provider via abstração
    - Retornar `{ ok: true, content, model }` ou `{ ok: false, error }` sem expor segredos
    - Sem limites de uso (sem rate limiting)
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 12.1, 12.2_

- [ ] 9. Integração frontend ↔ Edge Function
  - [ ] 9.1 Criar hook `useMotoristaChat` e wiring completo
    - Hook orquestra: state, envio de mensagem, invoke da Edge Function, persistência no Supabase
    - Ao enviar: `addMessage(convId, 'user', text)` → invoke Edge Function → `addMessage(convId, 'assistant', content)`
    - Criar conversa automaticamente na primeira mensagem se não existir
    - Tratar erros conforme tabela de Error Handling do design (toasts em pt-BR)
    - Sem limites de criação de conversas
    - _Requirements: 4.2, 4.3, 4.4, 9.2, 10.3, 10.4, 12.3_

- [ ] 10. Checkpoint - Verificar integração end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Property tests (CPs restantes)
  - [ ]* 11.1 Property test CP2: System Prompt Completeness
    - **Property 2: System Prompt Completeness**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
    - Criar `src/__tests__/cp2_system_prompt.property.test.ts`
    - Gerar `FreightContextResult` aleatórios com fast-check
    - Verificar presença de restrição a fretes, rejeição off-topic, instrução pt-BR, e contexto formatado

  - [ ]* 11.2 Property test CP3: Geographic Freight Filter
    - **Property 3: Geographic Freight Filter**
    - **Validates: Requirements 6.1, 6.3**
    - Criar `src/__tests__/cp3_geographic_filter.property.test.ts`
    - Gerar listas de fretes com coordenadas aleatórias × ponto + raio
    - Verificar que todos os retornados estão dentro do raio (haversine ≤ radius)

  - [ ]* 11.3 Property test CP4: Freight Context Size and Ordering
    - **Property 4: Freight Context Size and Ordering Invariant**
    - **Validates: Requirements 6.4**
    - Criar `src/__tests__/cp4_context_size_order.property.test.ts`
    - Gerar listas de 0–100 fretes aleatórios
    - Verificar output ≤ 20 itens e ordenação lucroPorKm DESC

  - [ ]* 11.4 Property test CP5: Profitability Calculation
    - **Property 5: Profitability Calculation Correctness**
    - **Validates: Requirements 7.1, 7.2, 7.4**
    - Criar `src/__tests__/cp5_profitability.property.test.ts`
    - Gerar valores positivos de distância, km/L, diesel
    - Verificar fórmula: lucroLiquido = value - (distanceKm / kmPerLiter * dieselPrice), lucroPorKm = lucroLiquido / distanceKm

  - [ ]* 11.5 Property test CP6: Provider Client Selection
    - **Property 6: Provider Client Selection**
    - **Validates: Requirements 8.2**
    - Criar `src/__tests__/cp6_provider_selection.property.test.ts`
    - Usar `fc.constantFrom(['claude','gemini','grok','llama','openai'])`
    - Verificar que client.id === provider solicitado

  - [ ]* 11.6 Property test CP7: AI Proxy Response Envelope
    - **Property 7: AI Proxy Response Envelope**
    - **Validates: Requirements 8.4, 9.5, 9.6**
    - Criar `src/__tests__/cp7_response_envelope.property.test.ts`
    - Gerar cenários de success/failure
    - Verificar conformidade com envelope: `{ ok: true, content, model }` ou `{ ok: false, error }`

  - [ ]* 11.7 Property test CP8: Conversation History Truncation
    - **Property 8: Conversation History Truncation**
    - **Validates: Requirements 9.4**
    - Criar `src/__tests__/cp8_history_truncation.property.test.ts`
    - Gerar arrays de 0–50 mensagens
    - Verificar output ≤ 10, tomadas do final, ordem cronológica preservada

- [ ] 12. Final checkpoint - Build e validação
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- A migration 090 é a próxima livre após 089_tutorials
- O `useEffectiveLocation` já existe e deve ser reusado (não criar novo)
- O padrão `AiProviderClient` da Edge Function `assistant-ai` (admin) serve de referência para a nova
- O serviço `src/services/aiConversations.ts` (localStorage) será substituído pelo novo serviço Supabase
- Convenções fast-check: usar `fc.string().filter()` (nunca `fc.stringOf`), geradores em `src/__tests__/_helpers/generators.ts`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.3"] },
    { "id": 1, "tasks": ["2.2", "2.4", "3.1", "6.1"] },
    { "id": 2, "tasks": ["5.1", "6.2", "6.3"] },
    { "id": 3, "tasks": ["5.2", "5.3"] },
    { "id": 4, "tasks": ["5.4", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 6, "tasks": ["8.5"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7"] }
  ]
}
```
