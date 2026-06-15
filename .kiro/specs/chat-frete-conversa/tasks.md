# Implementation Plan: chat-frete-conversa

## Overview

Plano incremental e cirúrgico que entrega o refinamento da Conversation_Screen e
a regra de gating do chat conforme o estado do frete. A ordem prioriza primeiro a
camada pura testável (`freteGate.ts`), depois a recuperação de status
(`getFreteStatus` no `chatFrete.ts` — Critical_Module), depois as edições
localizadas em `MensagensPage.tsx`, e por fim os testes de exemplo/UI e
integração. Cada passo se apoia no anterior e termina com a integração na tela —
sem código órfão. Os tipos `FreteStatus`/`FreteSource` já existem em
`src/services/fretes.ts` e são reutilizados.

## Tasks

- [x] 1. Criar a camada pura de gating `src/services/freteGate.ts`
  - [x] 1.1 Implementar tipos e mapeadores puros
    - Criar `src/services/freteGate.ts` importando `FreteStatus`/`FreteSource` de `./fretes`
    - Definir `type FreteGate = 'active' | 'blocked' | 'unknown'` e `interface BadgeView { label: string; className: string }`
    - Implementar `freteStatusToGate(status: FreteStatus | null): FreteGate` (`null`→`unknown`, `'ativo'`→`active`, demais→`blocked`)
    - Implementar `effectiveStatus(info: { status: FreteStatus; source?: FreteSource } | null): FreteStatus | null` (`null` ou `source==='comunidade'`→`null`)
    - Implementar `isInputBlocked(gate: FreteGate): boolean` (`true` sse `gate==='blocked'`)
    - Implementar `gateToBadge(gate: FreteGate): BadgeView | null` (verde "Ativo" / vermelho "Desativado" / `null`)
    - _Requirements: 2.2, 2.3, 2.5, 3.2, 3.3, 3.4, 4.1, 6.1, 6.2_

  - [x]* 1.2 Escrever property tests da camada pura (fast-check)
    - Arquivo `src/__tests__/cp1_frete_gate.property.test.ts`, mínimo 100 iterações por propriedade
    - Geradores via `fc.constantFrom('ativo','encerrado','cancelado')`, `fc.constantFrom('active','blocked','unknown')`, `fc.constantFrom('embarcador','comunidade')`; NUNCA `fc.stringOf`
    - **Property 1: Mapeamento completo de status → gate → badge** — `freteStatusToGate` é `active` sse `'ativo'`, `blocked` para `'encerrado'`/`'cancelado'`; `gateToBadge` casa label/cor; re-resolução é determinística (idempotente)
    - **Validates: Requirements 2.2, 2.3, 3.2, 3.3, 7.2**
    - **Property 2: Status_Indisponivel nunca bloqueia e omite o badge** — `info===null` ou `source==='comunidade'` ⇒ `effectiveStatus===null`, `freteStatusToGate(null)==='unknown'`, `gateToBadge('unknown')===null`, `isInputBlocked('unknown')===false`
    - **Validates: Requirements 2.5, 3.4, 6.2**
    - **Property 3: Bloqueio do input se e somente se gate é 'blocked'** — `isInputBlocked(gate)` é `true` sse `gate==='blocked'`; `active`/`unknown` mantêm input habilitado
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.3**
    - **Property 4: Independência do papel do usuário** — assinaturas dos mapeadores não recebem papel; mesma entrada ⇒ mesmo gate/badge/bloqueio para motorista e embarcador
    - **Validates: Requirements 2.4, 4.7**

- [x] 2. Adicionar `getFreteStatus` ao Chat_Service (`src/services/chatFrete.ts`)
  - [x] 2.1 Implementar `getFreteStatus(freteId)` e `FreteStatusInfo`
    - Definir `interface FreteStatusInfo { status: FreteStatus; source: FreteSource | null; value: number | null }`
    - Consultar `fretes` por `id` selecionando `status, source, value` via `.single()`
    - Retornar `null` em `error`/sem `data`; envolver em `try/catch` para nunca lançar (fail-safe → `unknown`)
    - Mapear `value` com `Number(...)` quando não nulo; `source` com fallback `null`
    - _Requirements: 3.1, 3.5_

  - [ ]* 2.2 Escrever testes de integração (mock Supabase) de `getFreteStatus`
    - Local `tests/` (integração CI). Mock hoisted: expor spy via `(globalThis as Record<string, unknown>).__supabaseSpy = ...`, sem referenciar variáveis externas no factory
    - Consulta `fretes` por `id` selecionando `status, source, value` e mapeia corretamente (3.1)
    - Erro do Supabase ⇒ resolve `null` sem lançar (3.5); `value` nulo ⇒ `value: null`
    - Manter cobertura do Critical_Module `chatFrete.ts` no threshold
    - _Requirements: 3.1, 3.5_

- [x] 3. Checkpoint — camada pura e service
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Subcomponentes de UI em `MensagensPage.tsx`
  - [x] 4.1 Implementar `FreteCard` e `BlockedNotice`
    - Adicionar `FreteCard({ origin, destination, value, gate })`: retorna `null` sem origem e sem destino; exibe `origem → destino`; exibe valor com `toLocaleString('pt-BR', { style:'currency', currency:'BRL' })` quando `value != null`; renderiza badge de `gateToBadge(gate)` na mesma região
    - Adicionar `BlockedNotice()`: `<footer>` com o texto exato `Este frete não está mais ativo.`
    - Usar classes neutras cobertas pelos overrides `data-theme='dark'` do `index.css` (sem variantes `dark:` adicionais)
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 2.1, 4.6_

  - [ ]* 4.2 Escrever testes de exemplo de `FreteCard` e `BlockedNotice`
    - `src/__tests__/` — `FreteCard`: formato origem→destino (1.2), exibe/oculta valor conforme `value` incl. `value` zero (1.3), badge na mesma região com cor/label por gate (2.1), retorna `null` sem frete vinculado
    - `BlockedNotice`: exibe exatamente `Este frete não está mais ativo.` (4.6)
    - _Requirements: 1.2, 1.3, 2.1, 4.6_

- [x] 5. Integrar estado e recuperação de status na Conversation_Screen
  - [x] 5.1 Adicionar estado e fetch-on-open do status do frete
    - Adicionar `const [freteGate, setFreteGate] = useState<FreteGate>('unknown')` e `const [freteValue, setFreteValue] = useState<number | null>(null)`
    - No effect de troca de conversa (junto de `getFreteMessages`/`getConversationPeer`): resolver `freteId = conv?.freteId ?? null`, chamar `getFreteStatus(freteId)` somente se `freteId`, guardar `cancelled`, e setar `setFreteGate(freteStatusToGate(effectiveStatus(info)))` + `setFreteValue(info?.value ?? null)`
    - No branch de reset (sem `activeId`) e em `handleClose`: `setFreteGate('unknown')` e `setFreteValue(null)`
    - Importar os mapeadores de `../services/freteGate` e `getFreteStatus` de `../services/chatFrete`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.1_

  - [ ]* 5.2 Escrever teste de integração do fetch-on-open (mock)
    - Ao abrir conversa com `freteId`, chama `getFreteStatus` e reflete o status no badge e no estado do input (7.1)
    - Conversa sem `freteId` ⇒ não chama fetch e permanece `unknown`
    - _Requirements: 7.1_

- [x] 6. Inserir o Frete_Card e limpar o header
  - [x] 6.1 Renderizar `FreteCard` entre header e mensagens e remover linha redundante
    - Inserir `<FreteCard origin={...} destination={...} value={freteValue} gate={freteGate} />` entre o `</header>` e a `<div>` da Message_History
    - Remover o bloco `active?.frete && (<p>origem → destino</p>)` do cabeçalho (sem tocar subtítulos de empresa/veículo)
    - Garantir que a Message_History permanece visível/rolável e anexos abríveis (não regredir 5.1–5.3)
    - _Requirements: 1.1, 1.4, 5.1, 5.2, 5.3_

  - [ ]* 6.2 Escrever teste de exemplo de render da Conversation_Screen
    - Frete_Card aparece entre header e mensagens (1.1); header não contém mais a linha origem→destino redundante (1.4)
    - Message_History permanece visível e rolável com anexos abríveis sob `gate==='blocked'` (5.1, 5.2, 5.3)
    - _Requirements: 1.1, 1.4, 5.1, 5.2, 5.3_

- [x] 7. Aplicar o gating do input (footer + handlers)
  - [x] 7.1 Trocar o footer por `BlockedNotice` e adicionar guards nos handlers
    - Envolver o conteúdo do `<footer>` em `isInputBlocked(freteGate)`: `true` ⇒ renderizar `BlockedNotice`; `false` ⇒ render atual inalterado
    - `handleDragEnter`/`handleDragOver`: alterar guard para `if (!activeId || isInputBlocked(freteGate)) return;`
    - `handleDrop`: `if (!activeId || isInputBlocked(freteGate)) return;` antes do loop de upload
    - `startRecording`: `if (recording || isInputBlocked(freteGate)) return;`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.3_

  - [ ]* 7.2 Escrever testes de exemplo dos early-returns e swap de footer
    - Com `gate==='blocked'`: Input_Bar substituída por `BlockedNotice` (4.1); `handleDrop` não chama `handleAttach`/upload (4.4); `startRecording` faz early-return (4.5)
    - Com `gate==='active'`/`'unknown'`: footer normal e handlers seguem (6.1, 6.3)
    - _Requirements: 4.1, 4.4, 4.5, 6.1, 6.3_

- [ ] 8. (Opcional) Enhancement de realtime do status
  - [ ]* 8.1 Assinar `fretes` UPDATE e re-resolver o gate
    - Assinatura realtime opcional do `UPDATE` em `fretes` para a conversa aberta; ao mudar status, re-derivar via `freteStatusToGate(effectiveStatus(...))` e atualizar `freteGate`/`freteValue`
    - Testes de integração (mock): 1–2 eventos `fretes` UPDATE re-resolvendo o gate (`'ativo'`→`'encerrado'`/`'cancelado'` ⇒ badge vermelho + `BlockedNotice`)
    - _Requirements: 7.2_

- [x] 9. Checkpoint final — build + regressão
  - Rodar build/typecheck e a suíte de testes (incluindo os novos); incorporar os novos testes à Regression_Suite; garantir cobertura do Critical_Module `chatFrete.ts`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são de teste; pela governança (`testing-governance.md`)
  os testes são **obrigatórios** para concluir a feature — o `*` apenas indica
  que não são executados automaticamente como tarefa de implementação principal.
- Cada tarefa referencia critérios de aceite específicos para rastreabilidade.
- Property tests validam as 4 propriedades universais da camada pura `freteGate.ts`
  (100+ iterações, `fc.constantFrom`, sem `fc.stringOf`).
- Testes de exemplo/UI cobrem render condicional, textos fixos e early-returns;
  integração (mock) cobre `getFreteStatus` e o fetch-on-open.
- `chatFrete.ts` é Critical_Module: manter a cobertura mínima ao tocá-lo.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1"] },
    { "id": 5, "tasks": ["6.2", "7.1"] },
    { "id": 6, "tasks": ["7.2", "8.1"] }
  ]
}
```
