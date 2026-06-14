# Design Document: Motorista AI Assistant

## Overview

Redesenho completo da página `/assistente` com UI estilo Siri (dark mode), integração com IA real via Supabase Edge Function (nova `motorista-ai-chat`) e persistência de conversas em tabelas dedicadas do Supabase. O assistente é focado exclusivamente em fretes disponíveis na região do motorista, com análise de lucratividade baseada nos dados operacionais do caminhão.

## Architecture

### Diagrama de Componentes

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend (AssistantePage.tsx redesenhada)                        │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────┐       │
│  │ WelcomeView│  │  ChatView  │  │  ConversationSidebar │       │
│  │ (Star+     │  │ (messages  │  │  (list + new + del)  │       │
│  │  Greeting+ │  │  + input)  │  │                      │       │
│  │  QuickCards)│  │            │  │                      │       │
│  └─────┬──────┘  └─────┬──────┘  └──────────┬───────────┘       │
│        │                │                    │                   │
│        └────────────────┴────────────────────┘                   │
│                         │                                        │
│              ┌──────────▼──────────┐                             │
│              │ useMotoristaChat()  │ ← hook de orquestração      │
│              │ (state + effects)   │                              │
│              └──────────┬──────────┘                             │
│                         │                                        │
│         ┌───────────────┼───────────────┐                        │
│         ▼               ▼               ▼                        │
│  ┌─────────────┐ ┌────────────┐ ┌──────────────────┐            │
│  │ Supabase    │ │ Edge Fn    │ │useEffective-     │            │
│  │ tables      │ │ invoke     │ │Location          │            │
│  │ (CRUD)      │ │ (chat msg) │ │(GPS/override)    │            │
│  └─────────────┘ └────────────┘ └──────────────────┘            │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Supabase Edge Function: motorista-ai-chat                       │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ 1. Auth check (JWT authenticated role)                    │    │
│  │ 2. Read Active_Provider + model from assistant_config     │    │
│  │ 3. FreightContextBuilder:                                 │    │
│  │    - Read effective_location + radius do motorista         │    │
│  │    - Query fretes ativos dentro do raio                    │    │
│  │    - Read calc_context (km/L, diesel, capacidade)         │    │
│  │    - Calculate lucro_liquido + lucro_por_km por frete     │    │
│  │    - Sort by lucro_por_km DESC, limit 20                  │    │
│  │ 4. Build System_Prompt (freight-only + pt-BR + context)   │    │
│  │ 5. Read last 10 messages from conversation                │    │
│  │ 6. Read provider API key from Vault                       │    │
│  │ 7. Invoke provider via Provider_Abstraction               │    │
│  │ 8. Return { ok, content, error }                          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                         │                                        │
│         ┌───────────────┼───────────────┐                        │
│         ▼               ▼               ▼                        │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                     │
│  │ClaudeClnt│   │GeminiClnt│   │OpenAIClnt│  (+ stubs grok/llama)│
│  └──────────┘   └──────────┘   └──────────┘                     │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Supabase Database                                               │
│  ┌─────────────────────────┐  ┌─────────────────────────┐       │
│  │ motorista_ai_conversations│  │ motorista_ai_messages   │       │
│  │ id UUID PK               │  │ id UUID PK              │       │
│  │ motorista_id UUID FK→users│  │ conversation_id UUID FK │       │
│  │ title TEXT                │  │ role TEXT (user/assistant)│      │
│  │ created_at TIMESTAMPTZ   │  │ content TEXT            │       │
│  │ updated_at TIMESTAMPTZ   │  │ metadata JSONB NULL     │       │
│  └─────────────────────────┘  │ created_at TIMESTAMPTZ   │       │
│                                └─────────────────────────┘       │
│  RLS: motorista_id = auth.uid() em ambas                         │
└──────────────────────────────────────────────────────────────────┘
```

### Decisões Arquiteturais

1. **Nova Edge Function separada** (`motorista-ai-chat`): A Edge Function existente `assistant-ai` serve o painel admin (contexto completamente diferente: métricas globais, dados sem máscara para o master admin). O assistente do motorista precisa de um contexto distinto (fretes filtrados por localização, cálculos financeiros personalizados), então criamos uma função dedicada.

2. **Persistência em Supabase (não localStorage)**: As conversas migram de localStorage para tabelas no Supabase, habilitando acesso multi-dispositivo e eliminando risco de perda de dados por limpeza de cache do browser.

3. **Provider_Abstraction reutilizada**: O padrão `AiProviderClient` da Edge Function `assistant-ai` (Claude, Gemini + stubs) é replicado na nova Edge Function, adicionando `OpenAIClient`. A configuração (provider ativo + model) continua vindo de `assistant_config`.

4. **Hook `useEffectiveLocation` reutilizado**: Em vez de `useGeolocation` direto, a nova AssistantePage usa `useEffectiveLocation` que já combina GPS + override manual do motorista.

5. **FreightContextBuilder server-side**: Toda a lógica de filtro geográfico + cálculo financeiro roda na Edge Function (server-side), não no frontend. Isso garante que o contexto enviado à IA é sempre atualizado e não depende do estado do client.

## Components and Interfaces

### 1. AssistantePage.tsx (Frontend — Redesenhada)

Componente principal da rota `/assistente`. Estados:
- **Idle**: Exibe WelcomeView (greeting + star + quick cards)
- **Active**: Exibe ChatView (mensagens + input)

```typescript
// src/pages/AssistantePage.tsx

interface AssistantePageState {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  messages: ChatMessage[];
  input: string;
  isThinking: boolean;
  sidebarOpen: boolean;
}

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
```

### 2. getGreeting() (Utility)

Função pura que determina a saudação baseada na hora e nome.

```typescript
// src/utils/greeting.ts

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening';

export function getGreetingPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 17) return 'afternoon';
  return 'evening';
}

export function getGreeting(hour: number, firstName?: string | null): string {
  const period = getGreetingPeriod(hour);
  const labels: Record<GreetingPeriod, string> = {
    morning: 'Bom dia',
    afternoon: 'Boa tarde',
    evening: 'Boa noite',
  };
  const base = labels[period];
  const name = firstName?.trim();
  return name ? `${base}, ${name} 👋` : `${base} 👋`;
}
```

### 3. FreightContextBuilder (Edge Function — Server-side)

Módulo responsável por montar o Freight_Context enviado ao provedor de IA.

```typescript
// supabase/functions/motorista-ai-chat/freightContext.ts

export interface FreightContextItem {
  origin: string;
  destination: string;
  distanceKm: number;
  distanceToOriginKm: number | null;
  value: number;
  lucroLiquido: number | null;
  lucroPorKm: number | null;
}

export interface FreightContextResult {
  items: FreightContextItem[];
  calcIncomplete: boolean;
  locationAvailable: boolean;
}

const MAX_CONTEXT_FREIGHTS = 20;

export async function buildFreightContext(
  sb: SupabaseClient,
  motoristaId: string
): Promise<FreightContextResult> {
  // 1. Read motorista location + radius
  // 2. Read calc context (km/L, diesel, capacity)
  // 3. Query active freights (with geo filter if location available)
  // 4. Calculate profitability for each
  // 5. Sort by lucroPorKm DESC, limit 20
  // 6. Return structured context
}
```

### 4. SystemPromptBuilder (Edge Function)

Monta o system prompt com restrição a fretes + contexto.

```typescript
// supabase/functions/motorista-ai-chat/systemPrompt.ts

export interface SystemPromptInput {
  freightContext: FreightContextResult;
  motoristaName: string | null;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  // Includes:
  // - Role restriction (freight-only)
  // - Language instruction (pt-BR)
  // - Off-topic rejection instruction
  // - Freight context data (formatted)
  // - Calc context status
}
```

### 5. OpenAIClient (Provider Abstraction)

Novo cliente para a família GPT, seguindo o padrão `AiProviderClient`.

```typescript
// supabase/functions/motorista-ai-chat/providers/openai.ts

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_MAX_TOKENS = 1024;

class OpenAIClient implements AiProviderClient {
  readonly id: AiProvider = 'openai';
  readonly requiresApiKey = true;
  private readonly model: string;

  constructor(model: string = DEFAULT_OPENAI_MODEL) {
    this.model = model;
  }

  async invoke(input: AiInvokeInput, apiKey: string): Promise<AiInvokeResult> {
    if (!apiKey) {
      return { ok: false, error: 'missing_api_key', provider: 'openai' };
    }
    // POST to /v1/chat/completions
    // Map system prompt to { role: 'system', content: context }
    // Map messages to { role, content } array
    // Parse response.choices[0].message.content
  }
}
```

### 6. Conversation Service (Frontend)

Substituição do serviço localStorage por Supabase.

```typescript
// src/services/motoristaAiConversations.ts

export interface MotoristaConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MotoristaMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export async function listMotoristaConversations(): Promise<MotoristaConversation[]>;
export async function createMotoristaConversation(title: string): Promise<MotoristaConversation>;
export async function getConversationMessages(convId: string): Promise<MotoristaMessage[]>;
export async function addMessage(convId: string, role: string, content: string): Promise<MotoristaMessage>;
export async function deleteMotoristaConversation(convId: string): Promise<void>;
```

### 7. Star Icon Component (Visual)

Versão ampliada do AiFab com animação de pulso e brilho externo.

```typescript
// src/components/AssistantStarIcon.tsx

interface AssistantStarIconProps {
  size?: number; // default 96 (≥ 80px required)
  className?: string;
}

export default function AssistantStarIcon({ size = 96 }: AssistantStarIconProps) {
  // Yellow circle with 4-point star (same as AiFab)
  // Outer purple/blue animated glow ring
  // Pulse animation via CSS keyframes
}
```

## Interfaces and Contracts

### Edge Function API Contract

**Endpoint:** `POST /functions/v1/motorista-ai-chat`

**Headers:**
```
Authorization: Bearer <JWT do motorista>
Content-Type: application/json
```

**Request Body:**
```typescript
interface MotoristaAiChatRequest {
  conversationId: string;  // UUID da conversa (cria automaticamente se não existir)
  message: string;         // Mensagem do motorista
}
```

**Response (sucesso):**
```typescript
interface MotoristaAiChatResponse {
  ok: true;
  content: string;        // Resposta da IA
  model: string;          // Modelo usado (ex: "gpt-4o-mini")
}
```

**Response (erro):**
```typescript
interface MotoristaAiChatErrorResponse {
  ok: false;
  error: 'missing_api_key' | 'provider_call_failed' | 'provider_not_implemented' | 'invalid_input' | 'unauthorized';
  detail?: string;        // Nunca expõe segredos
}
```

### Database Tables

**motorista_ai_conversations:**
```sql
CREATE TABLE motorista_ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Nova conversa',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_motorista_ai_conversations_user
  ON motorista_ai_conversations(motorista_id, updated_at DESC);
```

**motorista_ai_messages:**
```sql
CREATE TABLE motorista_ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES motorista_ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_motorista_ai_messages_conv
  ON motorista_ai_messages(conversation_id, created_at ASC);
```

**RLS Policies:**
```sql
-- Conversations: motorista acessa apenas as suas
ALTER TABLE motorista_ai_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY motorista_ai_conversations_own ON motorista_ai_conversations
  FOR ALL USING (motorista_id = auth.uid())
  WITH CHECK (motorista_id = auth.uid());

-- Messages: motorista acessa apenas mensagens de suas conversas
ALTER TABLE motorista_ai_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY motorista_ai_messages_own ON motorista_ai_messages
  FOR ALL USING (
    conversation_id IN (
      SELECT id FROM motorista_ai_conversations WHERE motorista_id = auth.uid()
    )
  );
```

### Admin Provider Update (OpenAI)

Atualização no tipo `AiProvider`:

```typescript
// src/services/admin/assistant.ts
export type AiProvider = 'claude' | 'gemini' | 'grok' | 'llama' | 'openai';
```

Atualização no `AssistantSettings.tsx`:
```typescript
const PROVIDERS: ReadonlyArray<{ value: AiProvider; label: string; functional: boolean }> = [
  { value: 'claude', label: 'Claude (Anthropic)', functional: true },
  { value: 'gemini', label: 'Gemini (Google)', functional: true },
  { value: 'openai', label: 'OpenAI (GPT)', functional: true },
  { value: 'grok', label: 'Grok (xAI)', functional: false },
  { value: 'llama', label: 'Llama (Meta)', functional: false },
];
```

## Data Models

### Freight Context Assembly Flow

```
motorista_id
    │
    ├─► motoristas table ──► { km_per_liter, diesel_price, cargo_capacity_ton }
    │                          = CalcContext
    │
    ├─► motorista_location_override ──┐
    │   (ou GPS via frontend param)   │
    │                                 ▼
    │                         EffectiveLocation { lat, lng }
    │                                 │
    │                                 ▼
    ├─► fretes table ────────► Filter: status='ativo'
    │     (active, with           AND haversine(origin, location) <= radius
    │      originLocation)        │
    │                             ▼
    │                      For each frete:
    │                        lucroLiquido = value - (distanceKm / kmPerLiter * dieselPrice)
    │                        lucroPorKm = lucroLiquido / distanceKm
    │                             │
    │                             ▼
    │                      Sort by lucroPorKm DESC
    │                      Limit 20
    │                             │
    └─────────────────────────────┼─► FreightContext (max 20 items)
                                  ▼
                           System Prompt + Context
```

### Message Flow

```
Motorista taps "Send"
    │
    ▼
Frontend: addMessage(convId, 'user', text)  ──► INSERT motorista_ai_messages
    │
    ▼
Frontend: invoke Edge Function (motorista-ai-chat)
    │   { conversationId, message }
    │
    ▼
Edge Function:
    1. Verify JWT (authenticated role)
    2. Read assistant_config → activeProvider, model
    3. buildFreightContext(sb, motoristaId)
    4. buildSystemPrompt(freightContext)
    5. Read last 10 messages from motorista_ai_messages
    6. Read API key from Vault
    7. provider.invoke(systemPrompt + context + history, apiKey)
    8. Return { ok: true, content, model }
    │
    ▼
Frontend: addMessage(convId, 'assistant', response.content)  ──► INSERT motorista_ai_messages
    │
    ▼
UI: render assistant bubble
```

## Error Handling

| Cenário | Código de Erro | Comportamento Frontend |
|---------|---------------|----------------------|
| JWT ausente/inválido | `unauthorized` | Redireciona para login |
| Input vazio ou inválido | `invalid_input` | Toast: "Mensagem inválida" |
| Chave do provider não configurada no Vault | `missing_api_key` | Toast: "Assistente indisponível no momento. Tente mais tarde." |
| Provider não implementado (grok/llama) | `provider_not_implemented` | Toast: "Assistente indisponível no momento. Tente mais tarde." |
| Timeout ou erro do provider | `provider_call_failed` | Toast: "Não foi possível obter resposta. Tente novamente." |
| Rede offline / Edge Function inacessível | (fetch error) | Toast: "Sem conexão. Verifique sua internet." |
| Supabase query failure (fretes/motorista) | Degrada contexto | Edge Function continua com contexto parcial |

### Degradação Parcial no Context Builder

- **Sem localização**: Inclui todos os fretes ativos (sem filtro geo). Adiciona nota ao contexto.
- **Sem calc_context completo**: Inclui fretes sem estimativa financeira. Instrui a IA a sugerir que o motorista configure o perfil.
- **Sem fretes ativos**: Contexto vazio. Instrui a IA a informar que não há fretes no momento.

## Testing Strategy

### Unit Tests (src/__tests__/)

- **Greeting function**: Testa `getGreeting` e `getGreetingPeriod` com exemplos fixos (manhã, tarde, noite, sem nome).
- **Title inference**: Testa `inferTitle` com strings curtas, longas e edge cases (vazio, exatamente 40 chars).
- **System prompt builder**: Verifica que o output contém as seções obrigatórias.
- **Profitability calculation**: Casos específicos com valores conhecidos (já coberto pela suite existente de `calculoFrete`).

### Property Tests (src/__tests__/)

- **CP1 — Greeting Period**: fast-check com `fc.integer({min:0, max:23})` × `fc.option(fc.string())`.
- **CP2 — System Prompt Completeness**: fast-check com geradores de `FreightContextResult` aleatórios.
- **CP3 — Geographic Filter**: fast-check com listas de fretes com coordenadas aleatórias × ponto + raio.
- **CP4 — Context Size/Order**: fast-check com listas de 0–100 fretes aleatórios.
- **CP5 — Profitability Calculation**: fast-check com valores positivos de distância, km/L e diesel.
- **CP6 — Provider Selection**: fast-check com `fc.constantFrom(['claude','gemini','grok','llama','openai'])`.
- **CP7 — Response Envelope**: fast-check com cenários de success/failure gerados.
- **CP8 — History Truncation**: fast-check com arrays de 0–50 mensagens.
- **CP9 — Title Inference**: fast-check com `fc.string({minLength:1, maxLength:200})`.

### Integration Tests (tests/)

- **RLS**: Verifica que motorista A não acessa conversas de motorista B.
- **Edge Function E2E**: Testa o fluxo completo com provider mockado.
- **Conversation CRUD**: Verifica criação, listagem, leitura e deleção de conversas via Supabase.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Greeting Period Correctness

*For any* hour in [0, 23] and any optional first name (including null/undefined/empty), the `getGreeting` function SHALL return a string that starts with the correct period prefix ("Bom dia" for 5–11, "Boa tarde" for 12–17, "Boa noite" for 18–4), includes the name when non-empty, and ends with "👋".

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: System Prompt Completeness

*For any* valid freight context (0 to 20 items) and any motorista name, the `buildSystemPrompt` function SHALL produce a string that contains: (a) a freight-only restriction instruction, (b) an off-topic rejection instruction, (c) a pt-BR language instruction, and (d) the formatted freight context data.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 3: Geographic Freight Filter

*For any* set of active freights with known origin locations and *any* effective location with radius, the `filterFreightsByRadius` function SHALL return only freights whose haversine distance from the effective location to the freight origin is less than or equal to the configured radius in km.

**Validates: Requirements 6.1, 6.3**

### Property 4: Freight Context Size and Ordering Invariant

*For any* set of filtered freights (regardless of size), the freight context output SHALL contain at most 20 items, and those items SHALL be ordered by `lucroPorKm` in descending order (when profitability is calculable).

**Validates: Requirements 6.4**

### Property 5: Profitability Calculation Correctness

*For any* freight with positive `distanceKm` and *any* complete calc context (positive `kmPerLiter` and positive `dieselPrice`), the calculated `lucroLiquido` SHALL equal `round2(value - (distanceKm / kmPerLiter * dieselPrice))` and `lucroPorKm` SHALL equal `round2(lucroLiquido / distanceKm)`, with all required output fields (origin, destination, distance, value, lucroLiquido, lucroPorKm) present.

**Validates: Requirements 7.1, 7.2, 7.4**

### Property 6: Provider Client Selection

*For any* valid `AiProvider` value in the closed domain (`claude`, `gemini`, `grok`, `llama`, `openai`), the `selectProviderClient` function SHALL return a client whose `id` matches the requested provider and whose `requiresApiKey` is `true` for functional providers (claude, gemini, openai) and `false` for stub providers (grok, llama).

**Validates: Requirements 8.2**

### Property 7: AI Proxy Response Envelope

*For any* invocation of the Edge Function (success or failure), the JSON response SHALL conform to exactly one of: `{ ok: true, content: string, model: string }` or `{ ok: false, error: ErrorCode }`, where `ErrorCode` is one of the closed domain values. When the API key is missing, the error SHALL be `missing_api_key`; when the provider fails, the error SHALL be `provider_call_failed`.

**Validates: Requirements 8.4, 9.5, 9.6**

### Property 8: Conversation History Truncation

*For any* conversation containing N messages (where N ≥ 0), the history sent to the AI provider SHALL contain at most 10 messages, taken from the most recent end of the conversation, preserving chronological order.

**Validates: Requirements 9.4**

### Property 9: Title Inference Length Bound

*For any* non-empty string input, the `inferTitle` function SHALL return a string of at most 40 characters. When the input length is ≤ 40, the output SHALL equal the trimmed input. When the input length is > 40, the output SHALL be truncated at 40 characters with trailing ellipsis.

**Validates: Requirements 11.5**
