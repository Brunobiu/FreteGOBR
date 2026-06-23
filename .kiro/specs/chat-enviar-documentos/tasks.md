# Implementation Plan: chat-enviar-documentos

## Overview

Plano incremental e aditivo que entrega o botão **"Enviar documentos"** no lado
do motorista da Conversation_Screen e o fluxo de envio dos documentos do próprio
motorista como anexos da conversa. A ordem prioriza primeiro a **camada pura**
testável (`driverDocsCatalog.ts`), depois o **service** de envio
(`chatDocuments.ts`, que reusa `sendFreteAttachment` sem tocar o Critical_Module
`chatFrete.ts`), depois o **modal** (`EnviarDocumentosModal.tsx`), e por fim a
**integração** na `MensagensPage` (extensão da `Handoff_Bar` + estado do modal) e
os **testes de segurança**. Cada passo se apoia no anterior e termina integrado à
tela — sem código órfão.

**Sem mudança de schema, sem migration, sem nova RPC.** Reaproveita:
`getDocumentsByUser`/`getMotoristaReferences` (origem dos arquivos, RLS dono),
`sendFreteAttachment` (entrega no chat, RLS participante+remetente) e
`waUnlocked` de `getConversationChatState` (gating compartilhado com o WhatsApp).

## Tasks

- [ ] 1. Criar a camada pura `src/services/driverDocsCatalog.ts`
  - [ ] 1.1 Implementar tipos, rótulos e funções puras
    - Criar `src/services/driverDocsCatalog.ts` importando `DocumentType` de `./documents`
    - Definir `DocGroupKey`, `SendableDocument`, `CatalogDocInput`, `CatalogRefInput`
    - `DRIVER_DOC_LABELS` (reusar os rótulos canônicos de `UserDocumentsBlock`) e `docLabel(type)` total (fallback legível, nunca vazio)
    - `attachmentKindForMime(mime)` → `'image'` sse `mime` começa com `image/`, senão `'file'`
    - `buildSendableCatalog(docs, refs)`: 1 item por documento exceto `profile_photo`; 1 item por referência com `ctePath`; `id` estável (`doc:<id>`/`ref:<id>`); `sourcePath`/`label` não-vazios; ordenado por grupo canônico
    - `selectSendables(catalog, selectedIds)`: subconjunto exato por id, sem duplicatas
    - _Requirements: 5.2, 5.3, 5.4, 6.2, 6.4, 7.3, 9.1_

  - [ ]* 1.2 Property tests da camada pura (fast-check)
    - Arquivo `src/__tests__/cp1_driver_docs_catalog.property.test.ts`, mínimo 100 iterações por propriedade
    - Geradores: `fc.constantFrom(...VALID_DOCUMENT_TYPES)`, `fc.boolean()` (ctePath), `fc.subarray` (seleção), `fc.constantFrom('image/png','image/jpeg','application/pdf','',null)` (MIME); NUNCA `fc.stringOf`
    - **Property 1: Catálogo só documentos próprios e enviáveis** — exclui `profile_photo`; só refs com `ctePath`; todo item tem `sourcePath`+`label`; contagem = #docs(≠profile_photo)+#refs(ctePath)
    - **Validates: Requirements 5.2, 5.3, 9.1**
    - **Property 2: Rótulo total/determinístico e identidade estável** — `docLabel` não-vazio; conhecido→canônico; rebuild ⇒ mesmos ids/ordem
    - **Validates: Requirements 5.4, 6.1**
    - **Property 3: Seleção é subconjunto exato** — `selectSendables` retorna exatamente os ids ∈ seleção; 1 id ⇒ 1 item; ids inexistentes ignorados
    - **Validates: Requirements 6.2, 6.4**
    - **Property 4: Classificação de anexo por MIME** — `attachmentKindForMime` `image` sse `image/*`; PDF/null/desconhecido ⇒ `file`
    - **Validates: Requirement 7.3**

- [ ] 2. Criar o service de envio `src/services/chatDocuments.ts`
  - [ ] 2.1 Implementar `listSendableDriverDocuments` e `sendDriverDocuments`
    - `listSendableDriverDocuments(userId)`: chama `getDocumentsByUser(userId)` + `getMotoristaReferences(userId)`, mapeia para `CatalogDocInput`/`CatalogRefInput` e retorna `buildSendableCatalog(...)`
    - `sendDriverDocuments(conversationId, senderId, items)`: por item, `supabase.storage.from('documents').download(item.sourcePath)`, monta `File` (mime conhecido ou `blob.type`), classifica com `attachmentKindForMime` e chama `sendFreteAttachment(conversationId, senderId, file, kind, '')` (texto vazio)
    - Pool de concorrência pequeno (~3) via workers; isolar falha por item em `SendResult.failed` (download/upload/insert), nunca abortar o lote; importar `sendFreteAttachment` sem alterar `chatFrete.ts`
    - _Requirements: 5.1, 7.1, 7.2, 7.3, 8.1, 8.3, 8.4, 9.1, 9.2, 9.5_

  - [ ]* 2.2 Testes de integração (mock Supabase) do service
    - Local `tests/` (integração CI). Mock hoisted: spy via `(globalThis as Record<string, unknown>).__spy = ...`, sem variáveis externas no factory
    - `listSendableDriverDocuments`: junta docs+refs, exclui `profile_photo`, exige `ctePath`
    - `sendDriverDocuments`: baixa por `sourcePath` e chama `sendFreteAttachment` com `kind` e texto vazio corretos; erro de download/upload de 1 item ⇒ só ele em `failed`, demais em `sent`; concorrência limitada (sem estourar o pool)
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.3, 9.1_

- [ ] 3. Checkpoint — camada pura + service
  - Garantir que todos os testes passam; tirar dúvidas com o usuário se surgirem.

- [ ] 4. Criar o `src/components/EnviarDocumentosModal.tsx`
  - [ ] 4.1 Implementar o modal de seleção e envio
    - Props `{ open, conversationId, userId, unlocked, onClose, onSent? }`
    - Ao `open`: `listSendableDriverDocuments(userId)` com estados loading/error(retry)/empty/ready
    - Estado vazio em pt-BR orientando concluir o cadastro; "Enviar" desabilitado
    - Render agrupado por `groupKey` com checkbox + rótulo + miniatura (imagem via signed URL preguiçosa: `getSignedUrl`/`getDocumentSignedUrlByPath`) ou ícone p/ PDF
    - Seleção `Set<string>` (toggle, selecionar todos, limpar); ação `Enviar (N)` reflete contagem e desabilita com 0
    - Enviar: `selectSendables` + `sendDriverDocuments`; sucesso total ⇒ `onSent`+`onClose`; falha parcial ⇒ mantém aberto, marca `failedIds`, permite reenviar só os que falharam; guard `!unlocked` ⇒ não envia + aviso
    - Acessibilidade: `role="dialog"`, `aria-modal`, foco gerenciado, Esc/overlay fecham, trap de foco, bloqueio de scroll de fundo; mobile-first; tema escuro
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.3, 6.5, 6.6, 7.5, 8.2, 8.5_

  - [ ]* 4.2 Testes de exemplo/UI do modal
    - `src/__tests__/` — estados loading/empty/error/partial; checkbox por item; `Enviar (N)` reflete contagem e desabilita com 0; Esc/overlay fecham; `role="dialog"`/`aria-modal` presentes
    - Guard `!unlocked`: não dispara envio
    - _Requirements: 4.2, 4.4, 5.6, 6.3, 6.5, 8.2_

- [ ] 5. Estender a `Handoff_Bar` e integrar na `MensagensPage`
  - [ ] 5.1 Estender `WhatsappHandoffBar` (layout de dois botões)
    - Adicionar props opcionais `showDocuments?: boolean` e `onOpenDocuments?: () => void`
    - `showDocuments === false` (embarcador): manter layout atual (nudge `Converse um pouco para liberar o WhatsApp.` + WhatsApp_Button) — sem regressão
    - `showDocuments === true` (motorista): Nudge_Text acima (`Converse um pouco para liberar os botões.` / liberado `Vocês já podem conversar no WhatsApp e enviar documentos.`) e, abaixo, linha `flex gap-2` com `Enviar documentos` (esquerda, `flex-1`) e `WhatsApp` (direita, `flex-1`); ambos desabilitados quando `!unlocked`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 3.1, 3.2, 3.3, 10.5_

  - [ ] 5.2 Integrar estado e o modal na `MensagensPage`
    - Estado `const [docsModalOpen, setDocsModalOpen] = useState(false)`; resetar ao trocar de conversa e em `handleClose`
    - Passar à barra `showDocuments={user?.userType === 'motorista'}` e `onOpenDocuments={() => waUnlocked && setDocsModalOpen(true)}`
    - Renderizar `<EnviarDocumentosModal open={docsModalOpen} conversationId={activeId} userId={user.id} unlocked={waUnlocked} onClose={...} />` (sem refetch manual: realtime existente entrega as mensagens)
    - Manter tudo dentro do bloco `{!isInputBlocked(freteGate) && (...)}` (some quando frete indisponível)
    - _Requirements: 2.4, 4.1, 7.4, 10.2, 10.3, 10.4_

  - [ ]* 5.3 Testes de exemplo/UI da barra e da integração
    - `Handoff_Bar`: motorista vê dois botões `flex-1` (Enviar documentos à esquerda, WhatsApp à direita) + nudge acima com texto exato; embarcador vê layout atual (não-regressão); ambos desabilitados com `!unlocked`
    - Integração: clicar `Enviar documentos` com `unlocked` abre o modal; com `!unlocked` não abre
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 3.1, 3.3, 10.5_

- [ ]* 6. Testes de segurança / RLS (cenários negativos)
  - Estender `tests/security/*` e/ou `src/__tests__/security/*`
  - Usuário não-dono recebe erro ao baixar arquivo de `documents` de outro (RLS dono)
  - Anexo só legível por participante; path gravado é `<conv>/<senderId=self>/...` (RLS `chat-attachments`)
  - Catálogo nunca inclui `profile_photo` nem referência sem CT-e (anti-vazamento)
  - `noSecretLeak`/log: nenhum caminho de arquivo ou URL assinada em logs de erro
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 7. Checkpoint final — build + regressão + cobertura
  - Rodar build/typecheck e a suíte (incluindo os novos testes); incorporar à Regression_Suite
  - Confirmar que `tests/contract/schemaCompat.test.ts` segue verde sem alteração (sem mudança de schema — Req 10.1)
  - Confirmar que `chatFrete.ts` (Critical_Module) não foi alterado e sua cobertura segue no threshold; módulos novos com cobertura própria
  - Garantir que todos os testes passam; tirar dúvidas com o usuário se surgirem.

## Notes

- Tarefas com `*` são de teste; pela governança (`testing-governance.md`) os testes
  são **obrigatórios** para concluir a feature — o `*` apenas indica que não são a
  tarefa de implementação principal. Nenhuma feature é concluída sem testes
  (unit/property + falhas/negativos + validações + Regression_Suite atualizada).
- Cada tarefa referencia critérios de aceite específicos para rastreabilidade.
- Property tests validam as 4 propriedades universais de `driverDocsCatalog.ts`
  (100+ iterações, `fc.constantFrom`, sem `fc.stringOf`).
- `chatFrete.ts` é Critical_Module: **não alterar** — reusar `sendFreteAttachment`
  por import. A lógica nova fica em `chatDocuments.ts` (com cobertura própria).
- Segurança por defesa em profundidade: RLS de `documents` (download do dono) +
  RLS de `chat-attachments` (upload na pasta do remetente + participante). Nenhum
  caminho da feature envia documento de terceiro.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2"] },
    { "id": 5, "tasks": ["5.3", "6"] },
    { "id": 6, "tasks": ["7"] }
  ]
}
```
