# Implementation Plan — Cliente 360 (`admin-cliente-360`)

## Overview

Plano incremental e orientado a teste para entregar a **Pesquisa Global** (`Global_Search`) e a
**Visão 360 do Cliente** (`Cliente_360_View`), **ampliando** o que já está em produção sem recriar
nem quebrar módulos existentes. A linguagem de implementação é **TypeScript (strict)** para
service/funções puras/UI/testes e **SQL (PL/pgSQL)** para a migration 116 (o design usa código
concreto, não pseudocódigo).

A ordem segue de baixo para cima e termina com a integração e a governança: **(1)** migration 116 +
rollback → **(2)** funções puras do núcleo + property tests CP-1/CP-2/CP-3/CP-9\* → **(3)** delta de
RBAC em `permissions.ts` → **(4)** `Cliente_360_Service` + property tests CP-4..CP-8 → **(5)** UI
(Pesquisa Global + blocos da Visão 360 + validação frontend) → **(6)** integração de RLS/SECURITY
DEFINER em `tests/` → **(7)** Regression_Suite, cobertura, documentação e roteiro E2E\*. Cada etapa
constrói sobre a anterior e termina conectada à árvore (sem código órfão): as funções puras alimentam
o service, o service alimenta a UI, e a UI é ligada na rota `/admin/users/:id` e na `Topbar_Search`
do `AdminShell`.

Adere integralmente aos steerings `testing-governance`, `project-conventions` e `admin-patterns`.
Texto e mensagens user-facing em **pt-BR**; action codes, error codes e identifiers em **inglês**
(UPPER_SNAKE). As propriedades **CP-1..CP-8 são obrigatórias (sem `*`)**; **CP-9, smoke e roteiro
E2E são opcionais (com `*`)**.

## Tasks

- [ ] 1. Migration 116 (`admin_user_notes`, RLS, RBAC, RPCs) e par de rollback
  - [ ] 1.1 Criar o esqueleto idempotente da migration com tabela, trigger, índice e bloco de verificação
    - Criar `supabase/migrations/116_admin_cliente_360.sql` envolto em `BEGIN; ... COMMIT;`
    - Abrir com `DO $check$` defensivo validando existência de `is_admin_with_permission`,
      `admin_audit_logs`, `users.subscription_status`, `subscriptions`, `subscription_charges`,
      `financial_repasses`, `support_tickets`, `conversations` e `login_attempts` (mensagem clara por dependência ausente)
    - `CREATE TABLE IF NOT EXISTS admin_user_notes` (`id` uuid pk, `user_id` FK `users(id) ON DELETE CASCADE`,
      `author_id` FK `users(id) ON DELETE SET NULL`, `body` text `CHECK (char_length(body) BETWEEN 1 AND 5000)`,
      `created_at`/`updated_at` timestamptz)
    - `CREATE OR REPLACE FUNCTION admin_user_notes_set_updated_at()` + trigger `BEFORE UPDATE`; `CREATE INDEX IF NOT EXISTS idx_admin_user_notes_user_created (user_id, created_at DESC)`
    - Fechar com bloco `-- VERIFY` comentado (tabela, policy, trigger, existência das 6 funções, grant efetivo)
    - Seguir `admin-patterns` §9 (idempotência); CHECK de `body` é defesa em profundidade (tabela + RPC + frontend)
    - _Requirements: 13.1, 16.1, 16.2, 16.3, 16.7_

  - [ ] 1.2 Habilitar RLS admin-only e bloquear escrita direta em `admin_user_notes`
    - `ALTER TABLE admin_user_notes ENABLE ROW LEVEL SECURITY`
    - `DROP POLICY IF EXISTS` + `CREATE POLICY admin_user_notes_select FOR SELECT TO authenticated USING (is_admin_with_permission('USER_NOTE_VIEW'))`
    - Policy `RESTRICTIVE` `admin_user_notes_no_direct_write FOR ALL ... USING (false) WITH CHECK (false)` (escrita só via RPC `SECURITY DEFINER`)
    - Garantir que SELECT siga regido apenas pela policy permissiva e que INSERT/UPDATE/DELETE diretos fiquem sempre negados
    - _Requirements: 13.4, 13.5_
    - _CP-6_

  - [ ] 1.3 Re-asserir `is_admin_with_permission` reconhecendo as ações novas por construção
    - `CREATE OR REPLACE FUNCTION is_admin_with_permission(text)` preservando integralmente o corpo vigente
      (base 030 + deny-list de marketing/assistant de 048 + grant `FAQ_VIEW` adicionado a `SUPORTE` por 115)
    - `USER_NOTE_VIEW`/`USER_NOTE_EDIT` recebidas por `SUPER_ADMIN` (wildcard) e `ADMIN` (allow-all menos deny-list); negadas a `SUPORTE`/`FINANCEIRO`/`MODERADOR` (allowlists fechadas) sem ramo próprio
    - Não adicionar ramo dedicado para as ações novas (evita mascarar regressões na deny-list)
    - _Requirements: 13.2, 13.3_
    - _CP-8_

  - [ ] 1.4 Implementar as RPCs `SECURITY DEFINER` de leitura (busca, financeiro, login)
    - `admin_global_search(p_query text, p_limit int DEFAULT 20)`: `Sanitized_Query` (trim + colapso + escape de `% _ \` com `ESCAPE '\'`), classificação UUID/só-dígitos(≥8)/texto, filtro `user_type IN ('motorista','embarcador')`, `match_rank` 0/1/2 e `ORDER BY match_rank, name, id`, clamp de `p_limit` em `[1,50]` (default 20); query vazia/curta não-UUID ⇒ `[]`; não logar `Search_Query` bruto
    - `admin_user_financial_history(p_user_id uuid, p_limit int DEFAULT 50)`: lê `subscriptions`/`subscription_charges`/`financial_repasses` (clamp seguro), ordena por data desc, sem afrouxar a RLS dessas tabelas
    - `admin_user_login_history(p_user_id uuid, p_limit int DEFAULT 50)`: correlaciona `login_attempts` pelo telefone normalizado do Cliente, retorna `{ attempts[], retention_days, has_phone }` (estrutura mesmo sem telefone)
    - Postura padrão (`admin-patterns` §10): `SET search_path = public`; `auth.uid()` nulo ⇒ `permission_denied`; gating com log negativo `GLOBAL_SEARCH_VIEW_DENIED`/`FINANCEIRO_VIEW_DENIED`/`USER_VIEW_DENIED` antes de abortar; `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.5, 9.1, 9.5, 9.6, 12.1, 12.2, 12.4, 15.6, 16.4_
    - _CP-1, CP-2, CP-3, CP-9_

  - [ ] 1.5 Implementar as RPCs `SECURITY DEFINER` de CRUD de `Internal_Note`
    - `admin_user_note_create(p_user_id, p_body)`, `admin_user_note_update(p_note_id, p_body, p_expected_updated_at)`, `admin_user_note_delete(p_note_id)`
    - Ordem estrutural: `auth.uid()` → gating `USER_NOTE_EDIT` (log negativo `USER_NOTE_VIEW_DENIED`) → proteção do Master_Admin (recusa `user_id` alvo = `Nexus_Vortex99` com `master_admin_immutable`) → validação `body` 1–5000 — garantindo **precedência de `permission_denied`** sobre validação
    - `update`: versionamento otimista com `expected_updated_at`, distinguindo `not_found` de `STALE_VERSION`
    - `delete`: idempotência **exclusivamente** na inexistência ⇒ grava `USER_NOTE_DELETE_SKIPPED` e retorna `{ skipped: true, reason: 'ALREADY_REMOVED' }`; qualquer outra condição de erro propaga normalmente
    - `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` para as três
    - _Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 16.4_
    - _CP-5, CP-7_

  - [ ] 1.6 Escrever o par de rollback documentado
    - Criar `supabase/migrations/116_admin_cliente_360_rollback.sql` (não auto-aplicado), na ordem inversa:
      `DROP FUNCTION` das 6 RPCs + trigger, `DROP POLICY`, `DROP TABLE admin_user_notes`, `CREATE OR REPLACE` de `is_admin_with_permission` para o corpo anterior
    - Não tocar dados das tabelas reusadas
    - _Requirements: 16.5, 16.6, 16.8_

- [ ] 2. Checkpoint — migração
  - Revisar idempotência e a postura de segurança das RPCs; garantir que `npx tsc --noEmit` e `npm run lint` seguem limpos no que foi tocado. Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Funções puras do núcleo (`src/services/admin/cliente360/`) e property tests CP-1/CP-2/CP-3/CP-9*
  - [ ] 3.1 Implementar `search.ts` (sanitização e classificação da query)
    - Criar `src/services/admin/cliente360/search.ts`: `normalizeQuery` (trim + colapso de espaços), `escapeIlike` (`\` primeiro, depois `%` e `_`), `sanitizeQuery` (retorna `{ normalized, escaped, digits }`), `classifyQueryKind` (`empty`/`uuid`/`digits`/`text`)
    - Reusar `isValidUuid` e `normalizeDigits` de `admin-users` (`src/services/admin/users.ts`); não recriar
    - Espelhar exatamente a lógica SQL da `admin_global_search`
    - _Requirements: 2.2, 2.3, 2.8_
    - _CP-3_

  - [ ] 3.2 Implementar `ranking.ts` (matched_field, match_rank e ordenação total)
    - Criar `src/services/admin/cliente360/ranking.ts`: `assignMatchRank` (rank 0 exato id/email/phone; 1 prefixo name/company; 2 substring; `null` se não casa), `compareSearchResults` (`match_rank` ASC → `name` ASC → `id` ASC), `runSearch` (pipeline puro completo)
    - Importar `sanitizeQuery`/`classifyQueryKind` de `search.ts`; filtrar `user_type='admin'`
    - _Requirements: 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5_
    - _CP-1_

  - [ ] 3.3 Implementar `loginCorrelation.ts` (correlação por telefone)
    - Criar `src/services/admin/cliente360/loginCorrelation.ts`: `normalizePhoneForCorrelation` (somente dígitos) e `loginAttemptMatchesUser` (match sse dígitos iguais)
    - Reusar `normalizeDigits` de `users.ts`; espelhar `regexp_replace(\D,...)` da RPC
    - _Requirements: 12.2_
    - _CP-9_

  - [ ] 3.4 Escrever property test CP-1 (determinismo e ordenação total da busca)
    - `src/__tests__/admin/cliente-360/cp1_busca_determinismo.property.test.ts` (numRuns ≥ 100)
    - **Property 1: Determinismo e ordenação total da busca** — ordem estrita `match_rank ASC → name ASC → id ASC`, idempotência e invariância a permutação da entrada
    - Reusar `_helpers/generators.ts` (`safeText`, `validEmail`, `validPhone`, `uuidLike`); PII via `fc.constantFrom`, nunca `fc.stringOf`
    - **Validates: Requirements 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5**
    - _CP-1_

  - [ ] 3.5 Escrever property test CP-2 (isolamento da busca)
    - `src/__tests__/admin/cliente-360/cp2_busca_isolamento.property.test.ts` (numRuns ≥ 100)
    - **Property 2: Isolamento da busca** — nenhum `Search_Result` com `user_type='admin'`; caller sem `USER_VIEW` (qualquer papel e `auth.uid()` nulo) ⇒ `permission_denied` sem vazar resultado
    - Reusar `expectPermissionDenied` (`_helpers/authAssertions.ts`); papéis via `fc.constantFrom`
    - **Validates: Requirements 2.7, 4.1, 4.4, 4.6**
    - _CP-2_

  - [ ] 3.6 Escrever property test CP-3 (sanitização e fronteiras da query)
    - `src/__tests__/admin/cliente-360/cp3_sanitizacao_fronteiras.property.test.ts` (numRuns ≥ 100)
    - **Property 3: Sanitização e fronteiras da query** — escape idempotente de `% _ \` (nenhum curinga ativo), query normalizada `<2` e não-UUID ⇒ vazio sem erro, clamp de `p_limit` em `[1,50]` (default 20)
    - Strings arbitrárias com `% _ \` e vazias; `p_limit` inteiro/ausente/fora de faixa
    - **Validates: Requirements 2.2, 2.3, 2.8**
    - _CP-3_

  - [ ]* 3.7 Escrever property test CP-9 (correlação de login por telefone) — opcional
    - `src/__tests__/admin/cliente-360/cp9_login_correlacao.property.test.ts` (numRuns ≥ 100)
    - **Property 9*: Correlação de login por telefone** — inclui tentativa sse dígitos do telefone batem; vazio sem telefone; invariância a máscara/formatação
    - Reusar `validPhone` ∪ `fc.constantFrom(null,'',' ')`; nunca `fc.stringOf`
    - **Validates: Requirements 12.2**
    - _CP-9*_

  - [ ] 3.8 Escrever unit tests das funções puras (exemplos e edge cases)
    - `src/__tests__/admin/cliente-360/pureFunctions.unit.test.ts`: `normalizeQuery`/`escapeIlike` (`"  a  b "`, `"50%_x\\y"`), exemplos de cada `match_rank`, empates resolvidos por `id`, telefone `(62) 99999-8888` vs `6299998888`
    - _Requirements: 2.2, 2.4, 2.5, 3.1, 3.2, 3.3, 12.2, 17.6_

- [ ] 4. Delta de RBAC em `permissions.ts` (espelho frontend das ações novas)
  - [ ] 4.1 Acrescentar `USER_NOTE_VIEW`/`USER_NOTE_EDIT` ao espelho de permissões
    - Em `src/services/admin/permissions.ts`, adicionar as duas ações ao enum `ADMIN_ACTIONS`
    - **Não** incluí-las em `ADMIN_DENY` nem em `FINANCEIRO_PERMS`/`SUPORTE_PERMS`/`MODERADOR_PERMS` (negação por construção); `hasPermission` segue `false` para qualquer string fora do enum
    - Espelha o backend re-asserido em 1.3 (só `SUPER_ADMIN` + `ADMIN`)
    - _Requirements: 13.2, 13.3_
    - _CP-8_

  - [ ] 4.2 Escrever unit test do delta da Permission_Matrix
    - `src/__tests__/admin/cliente-360/permissions_notes.unit.test.ts`: `USER_NOTE_VIEW`/`USER_NOTE_EDIT` ⇒ `true` para `SUPER_ADMIN`/`ADMIN` e `false` para `SUPORTE`/`FINANCEIRO`/`MODERADOR`
    - _Requirements: 13.2, 13.3, 17.6_

- [ ] 5. Checkpoint — funções puras e permissões
  - Rodar `npx tsc --noEmit`, `npm run test:run` e `npm run lint`. Ensure all tests pass, ask the user if questions arise.

- [ ] 6. `Cliente_360_Service` (`src/services/admin/cliente360.ts`) e property tests CP-4..CP-8
  - [ ] 6.1 Criar tipos do bundle, mapeamento de erros e wrappers de leitura das RPCs
    - Criar `src/services/admin/cliente360.ts`: `Cliente360Caps`, `PlanoLabel`, `FinancialHistory`, `SupportHistory`, `MessageHistory`, `LoginHistory`, `InternalNote`, `Cliente360Bundle` (estende `UserDetailBundle`)
    - `Cliente360Error` tipado por `code`, reusando `mapPostgresError` no padrão de `tickets.ts`/`users.ts` (`permission_denied`/`NOT_FOUND`/`STALE_VERSION`/`ALREADY_REMOVED`/`invalid_input`/`master_admin_immutable`/`BLOCK_UNAVAILABLE`); mensagens UI em pt-BR
    - Fetchers privados das RPCs: `fetchPlanoLabel`, `fetchFinancialHistory`, `fetchSupportHistory`, `fetchMessageHistory` (reusando a lógica de metadados de chat de `getUserDetail`/`users.ts` — `fetchChatMetadata`), `fetchLoginHistory`, `fetchInternalNotes`
    - Nunca logar PII bruta/segredos no mapeamento de erros
    - _Requirements: 6.5, 15.4, 17.3, 17.5_

  - [ ] 6.2 Implementar `getCliente360Detail` com degradação parcial e gating por bloco
    - Estender `getUserDetail(id)` (Source_Block `cadastrais`, único a lançar `NOT_FOUND`); demais blocos isolados via `Promise.allSettled` preenchendo `errors[bloco]`
    - Gating por bloco (omissão sem PII parcial): `financeiro` só com `caps.financeiro`, `suporte` só com `caps.suporte`, `notas` só com `caps.notas`; `plano`/`mensagens`/`login` sempre presentes (sob `USER_VIEW`)
    - Distinguir bloco **omitido** (sem permissão) de **vazio** (presente, lista vazia) de **erro** (`errors[bloco]`)
    - Reusar `getUserDetail`/`isValidUuid` de `users.ts`; não recriar o detalhe-base
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.7, 7.1, 7.2, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.1, 11.1, 11.2, 15.1, 15.2_
    - _CP-4, CP-8_

  - [ ] 6.3 Implementar o wrapper `globalSearch`
    - `globalSearch(query, { limit })` chamando `rpc('admin_global_search', ...)`, com fallback de reordenação no cliente via `compareSearchResults`; debounce/limite tratados na UI
    - Estado vazio e mapeamento de `permission_denied` propagados ao chamador
    - _Requirements: 1.6, 2.1, 2.9, 2.10, 4.6_
    - _CP-1, CP-2_

  - [ ] 6.4 Implementar o CRUD de notas via `executeAdminMutation`
    - `createNote`/`updateNote`/`deleteNote` envolvidos por `executeAdminMutation` (audit-by-construction: `USER_NOTE_CREATE`/`USER_NOTE_UPDATE`/`USER_NOTE_DELETE`)
    - `updateNote` envia `expected_updated_at`; `deleteNote` retorna `{ ok } | { skipped, reason:'ALREADY_REMOVED' }` (o `_SKIPPED` vem do retorno da RPC, sem `executeAdminMutation`)
    - Mapear `STALE_VERSION` e `master_admin_immutable` para a UI
    - _Requirements: 13.6, 14.2, 14.4, 14.5, 14.6, 14.7, 14.10, 15.3_
    - _CP-5, CP-7_

  - [ ] 6.5 Escrever property test CP-4 (degradação parcial por bloco)
    - `src/__tests__/admin/cliente-360/cp4_degradacao_parcial.property.test.ts` (numRuns ≥ 100)
    - **Property 4: Degradação parcial por bloco** — falha de bloco != `Source_Block` não derruba os demais; `errors` == conjunto de falhos; só o `Source_Block` propaga `NOT_FOUND`
    - `fc.record` de flags de falha por bloco + flag do Source_Block; fetchers mockados
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6, 7.7, 9.7, 10.6, 11.6, 12.7, 17.3, 17.4**
    - _CP-4_

  - [ ] 6.6 Escrever property test CP-5 (precedência de `permission_denied`)
    - `src/__tests__/admin/cliente-360/cp5_precedencia_permission_denied.property.test.ts` (numRuns ≥ 100)
    - **Property 5: Precedência de `permission_denied`** — falta de permissão + input inválido simultâneos ⇒ sempre `permission_denied` (qualquer papel, inclusive `auth.uid()` nulo)
    - Reusar `expectPermissionDenied`; pares `(semPermissão, inputInválido)`
    - **Validates: Requirements 1.6, 6.7, 9.1, 12.1, 14.8, 15.3, 15.6**
    - _CP-5_

  - [ ] 6.7 Escrever property test CP-6 (notas nunca expostas a não-admin)
    - `src/__tests__/admin/cliente-360/cp6_notas_isolamento.property.test.ts` (numRuns ≥ 100)
    - **Property 6: Observações internas nunca expostas a não-admin** — leitura por `anon`/`cliente_dono`/`outro_cliente`/`admin_sem_note_view` ⇒ zero linhas (model de RLS)
    - Callers via `fc.constantFrom`; `body` via `safeText`; ids via `uuidLike`
    - **Validates: Requirements 13.5, 13.8, 15.5**
    - _CP-6_

  - [ ] 6.8 Escrever property test CP-7 (idempotência e versionamento das notas)
    - `src/__tests__/admin/cliente-360/cp7_notas_idempotencia_versionamento.property.test.ts` (numRuns ≥ 100)
    - **Property 7: Idempotência e versionamento das notas** — `expected_updated_at` divergente ⇒ `STALE_VERSION` sem mutar; N remoções ⇒ exatamente 1 `USER_NOTE_DELETE` + (N−1) `USER_NOTE_DELETE_SKIPPED`; erro != inexistência propaga
    - `N ∈ fc.integer({min:1,max:8})`; `expected_updated_at` ok/divergente; condição de erro via `fc.constantFrom`
    - **Validates: Requirements 14.5, 14.7, 14.10**
    - _CP-7_

  - [ ] 6.9 Escrever property test CP-8 (privacidade por bloco)
    - `src/__tests__/admin/cliente-360/cp8_privacidade_por_bloco.property.test.ts` (numRuns ≥ 100)
    - **Property 8: Privacidade por bloco** — `financeiro`⇔`FINANCEIRO_VIEW`, `suporte`⇔`SUPORTE_VIEW`, `notas`⇔`USER_NOTE_VIEW`; ausência ⇒ chave `undefined` (sem PII); grant de notas só `SUPER_ADMIN`/`ADMIN`
    - `fc.record` de caps + 5 papéis em `hasPermission`
    - **Validates: Requirements 8.4, 8.5, 9.4, 10.3, 13.2, 13.3, 13.7, 15.1, 15.2**
    - _CP-8_

  - [ ] 6.10 Escrever unit/cenários de falha do service
    - `src/__tests__/admin/cliente-360/cliente360_service.test.ts`: `STALE_VERSION` na edição, `ALREADY_REMOVED` só na inexistência (outro erro propaga), recusa de nota com alvo Master_Admin, estados vazios por bloco, mapeamento de erros sem vazar PII (`expectNoSecrets`)
    - _Requirements: 7.5, 8.6, 9.7, 10.5, 10.6, 11.5, 11.6, 12.5, 12.7, 14.3, 14.9, 17.3_

- [ ] 7. Checkpoint — service
  - Rodar `npx tsc --noEmit`, `npm run test:run` e `npm run lint`. Ensure all tests pass, ask the user if questions arise.

- [ ] 8. UI — Pesquisa Global, blocos da Visão 360 e validação frontend
  - [ ] 8.1 Implementar `TopbarSearch` + `SearchResultItem` e montá-los no `AdminShell`
    - Criar `src/components/admin/busca/TopbarSearch.tsx` e `src/components/admin/busca/SearchResultItem.tsx`
    - **Só renderiza** quando `useAdminPermission('USER_VIEW')`; debounce 300ms; dropdown com ≤8 resultados + ação "Ver todos os resultados" (→ `/admin/busca?q=`); teclado (↑/↓, Enter seleciona, Esc fecha); Enter no campo navega a `/admin/busca?q=`
    - `SearchResultItem` exibe nome, tipo, e-mail, telefone, empresa e o `Search_Field` que casou; link para `/admin/users/<id>`
    - Montar `TopbarSearch` na barra superior do `AdminShell` (`src/components/admin/AdminShell.tsx`), reusando `useAdminPermission`
    - _Requirements: 1.1, 1.2, 1.8, 2.1, 2.9, 5.1, 5.2, 5.3_

  - [ ] 8.2 Implementar a `SearchPage` (`/admin/busca`) com rota e item de sidebar
    - Criar `src/pages/admin/busca/SearchPage.tsx`: sob `AdminGuard`+`USER_VIEW` (senão `Stealth_404`), sem `<h1>` grande, lê `?q=` e **reexecuta** a busca no load/reload, estado vazio `Nenhum cliente encontrado.`, cada resultado é link para `/admin/users/<id>`
    - Registrar a rota `/admin/busca` no roteador admin e adicionar a entrada na `AdminSidebar`
    - Reusar `AdminGuard`/`Stealth404` e o wrapper `globalSearch` do service
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 1.9, 2.10, 5.4_

  - [ ] 8.3 Implementar `PlanoBlock` e `FinanceiroBlock`
    - Criar `src/components/admin/cliente360/PlanoBlock.tsx` (rótulo de `users` + data de cadastro `created_at`; enriquecido com `subscriptions` quando `FINANCEIRO_VIEW`; indica ausência de assinatura paga) e `FinanceiroBlock.tsx` (cobranças + repasses por data desc; **oculto por completo** sem `FINANCEIRO_VIEW`; erro isolado com `DashboardBlockError`)
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 9.2, 9.3, 9.4, 9.7_

  - [ ] 8.4 Implementar `SuporteBlock`, `MensagensBlock` e `LoginBlock`
    - Criar `src/components/admin/cliente360/SuporteBlock.tsx` (tickets + contagem de mensagens + marcador de status de `suporte-inteligente`; link `/admin/suporte/<ticket_id>`; **oculto** sem `SUPORTE_VIEW`; vazio `Nenhum atendimento registrado.`)
    - `MensagensBlock.tsx` (metadados sem conteúdo; link "abrir conversa" só com `SUPORTE_REPLY`; **sempre visível** com vazio `Nenhuma conversa registrada.`)
    - `LoginBlock.tsx` (tentativas data/resultado/motivo/IP/user-agent desc; placeholder `Sem telefone cadastrado para correlacionar logins.` sem ocultar; nota de retenção ~30 dias)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.3, 12.5, 12.6, 12.7_

  - [ ] 8.5 Implementar `NotasBlock` + `NotaEditor` com validação frontend espelhando o backend
    - Criar `src/components/admin/cliente360/NotasBlock.tsx` (lista de `Internal_Note` corpo/autor/data desc com `USER_NOTE_VIEW`; **oculto** sem a permissão) e `NotaEditor.tsx` (controles criar/editar/remover só com `USER_NOTE_EDIT`)
    - Validação `body` 1–5000 (trim) inline em pt-BR: **envio efetivo ao backend bloqueado** enquanto inválido **e** mensagem de erro exibida (ambos); `STALE_VERSION` ⇒ toast `Outro admin atualizou. Recarregando.` + refetch; skip ⇒ toast neutro `Esta nota já estava removida.`
    - _Requirements: 13.6, 13.7, 14.1, 14.2, 14.3, 14.4, 14.5, 17.1, 17.2_

  - [ ] 8.6 Ligar a Visão 360 na `User_Detail_Page` existente (`/admin/users/:id`)
    - Estender a página de detalhe de `admin-users` para montar `Cliente360Caps` via `useAdminPermission` (`FINANCEIRO_VIEW`/`SUPORTE_VIEW`/`USER_NOTE_VIEW`/`SUPORTE_REPLY`), chamar `getCliente360Detail` e renderizar os novos blocos **após** os existentes (sem remover cadastrais/documentos/fretes/avaliações/chat)
    - Cada bloco com três estados mutuamente exclusivos (carregando/erro/conteúdo-vazio); blocos gated ausentes simplesmente não renderizam; `Source_Block` em `NOT_FOUND` ⇒ `Stealth_404`
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 7.3, 7.5, 7.6, 7.7_

  - [ ] 8.7 Escrever testes de UI da Pesquisa Global
    - `src/__tests__/admin/cliente-360/topbarSearch.test.tsx` e `searchPage.test.tsx`: render gated por `USER_VIEW`, debounce, dropdown ≤8, navegação por teclado (Enter/Esc), `?q=` reexecutando no load, navegação para `/admin/users/:id`, estado vazio
    - _Requirements: 1.1, 1.2, 1.5, 1.8, 1.9, 2.1, 2.10, 5.2, 5.3_

  - [ ] 8.8 Escrever testes de UI dos blocos e da validação do `NotaEditor`
    - `src/__tests__/admin/cliente-360/blocks.test.tsx` e `notaEditor.test.tsx`: estados carregando/erro/vazio/conteúdo e **omissão sem permissão** de cada bloco; `NotaEditor` bloqueia o **envio efetivo** com input inválido **e** exibe mensagem pt-BR (regra `testing-governance`)
    - _Requirements: 7.3, 7.6, 7.7, 9.4, 10.3, 11.5, 12.5, 13.7, 14.3, 17.1, 17.2_

- [ ] 9. Checkpoint — UI
  - Rodar `npx tsc --noEmit`, `npm run test:run` e `npm run lint`. Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Integração de RLS/SECURITY DEFINER e migration (`tests/`, branch efêmero)
  - [ ] 10.1 Testar RLS de `admin_user_notes`
    - `tests/admin/cliente360/notes_rls.integration.test.ts`: `anon`, cliente dono, outro cliente e admin sem `USER_NOTE_VIEW` ⇒ **zero linhas**; admin com `USER_NOTE_VIEW` ⇒ lê; nenhum role escreve direto (só RPC)
    - _Requirements: 13.4, 13.5, 13.8, 15.5_
    - _CP-6_

  - [ ] 10.2 Testar leituras financeiras/login sob SECURITY DEFINER e isolamento entre contas
    - `tests/admin/cliente360/financial_login_security_definer.integration.test.ts`: `admin_user_financial_history`/`admin_user_login_history` leem sem afrouxar a RLS de `subscriptions`/`subscription_charges`/`financial_repasses`/`login_attempts`; busca/financeiro/login de um Cliente nunca retorna dados de outro
    - _Requirements: 9.5, 12.4, 15.5, 16.8_

  - [ ] 10.3 Testar Master_Admin imutável e grant de RBAC efetivo
    - `tests/admin/cliente360/notes_master_rbac.integration.test.ts`: criar nota com `user_id` = master ⇒ recusada; `is_admin_with_permission('USER_NOTE_VIEW'/'USER_NOTE_EDIT')` verdadeiro só para `SUPER_ADMIN`/`ADMIN`, falso para `SUPORTE`/`FINANCEIRO`/`MODERADOR`
    - _Requirements: 13.2, 13.3, 14.9_
    - _CP-8_

  - [ ] 10.4 Testar idempotência e rollback da migration 116
    - `tests/admin/cliente360/migration116_idempotency.integration.test.ts`: aplicar 2× sem erro nem duplicação; `DO $check$` falha claramente quando uma dependência está ausente; rollback reverte sem tocar dados das tabelas reusadas
    - _Requirements: 16.2, 16.3, 16.6, 16.8_

  - [ ]* 10.5 Smoke test do bloco `-- VERIFY` da migration — opcional
    - `tests/admin/cliente360/migration116_smoke.integration.test.ts`: executar os SELECTs do `-- VERIFY` (tabela, policy, trigger, 6 funções, grant efetivo) no branch efêmero
    - _Requirements: 16.7_

- [ ] 11. Regression_Suite, cobertura e documentação
  - [ ] 11.1 Incorporar os novos testes à Regression_Suite e manter a cobertura mínima
    - Garantir que os property/unit/UI/integração entram na suíte de CI (qualquer falha, inclusive flaky pós-retry, bloqueia merge/deploy); atualizar `tests/coverage.config.ts` para manter os thresholds dos Critical_Modules tocados (`permissions.ts`) e rodar `scripts/check-coverage.ts`
    - _Requirements: 17.6, 17.7, 17.8_

  - [ ] 11.2 Atualizar a documentação técnica
    - Adicionar a entrada da migration 116 em `supabase/migrations/README.md`; garantir JSDoc/headers nos exports públicos de `cliente360.ts` e dos módulos puros; registrar o checklist de governança coberto (unit + property + cenários de falha + validação frontend e backend + Regression_Suite)
    - _Requirements: 17.5_

  - [ ]* 11.3 Authorar o roteiro de E2E manual — opcional
    - Criar `tests/e2e/cliente-360-roteiro.md` com o passo a passo manual (busca → resultado → Visão 360; gating por bloco; CRUD de nota com `STALE_VERSION` e skip); documento, não execução automatizada
    - _Requirements: 17.6_

- [ ] 12. Checkpoint final
  - Rodar `npx tsc --noEmit`, `npm run test:run`, `npm run lint` e `scripts/check-coverage.ts`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são **opcionais** (CP-9\*, smoke da migration e roteiro E2E manual) e podem
  ser puladas para um MVP mais rápido. As propriedades **CP-1..CP-8 e seus testes não são opcionais**
  (sem `*`), conforme `project-conventions` (CPs obrigatórios do painel nunca levam `*`) e
  `testing-governance` (nenhuma feature conclui sem testes completos).
- Cada tarefa referencia Requirements/CP granulares para rastreabilidade; os property tests vivem em
  `src/__tests__/admin/cliente-360/cp<N>_<nome>.property.test.ts` com **numRuns ≥ 100**, reusando os
  helpers de `src/__tests__/_helpers/` (PII via `fc.constantFrom` — `validPhone`/`validEmail`/`validCpf`/
  `uuidLike`; texto via `safeText`; **nunca** `fc.stringOf`; autorização via `expectPermissionDenied`;
  não-vazamento via `expectNoSecrets`).
- Reuso explícito (não duplicar, não quebrar): `getUserDetail`/`UserDetailBundle`/`isValidUuid`/
  `normalizeDigits` (`admin-users`), `executeAdminMutation`/`logAdminAction` (`audit.ts`),
  `is_admin_with_permission` (030, re-asserida), `AdminShell`/`AdminGuard`/`useAdminPermission`/
  `Stealth404`, a lógica de metadados de chat de `getUserDetail` (`fetchChatMetadata`) e os helpers de
  teste de `_helpers/`.
- Testes puros/UI rodam no pre-commit + CI (`src/__tests__/`); integração de RLS/SECURITY DEFINER/
  idempotência roda só no CI em branch Supabase efêmero (`tests/`).
- Checkpoints rodam `npx tsc --noEmit`, `npm run test:run` e `npm run lint`; o checkpoint final também
  roda `scripts/check-coverage.ts`. Idioma pt-BR; identifiers/codes em inglês.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "3.3", "4.1"] },
    { "id": 1, "tasks": ["1.2", "3.2", "3.6", "3.7", "4.2"] },
    { "id": 2, "tasks": ["1.3", "3.4", "3.5", "3.8", "6.1"] },
    { "id": 3, "tasks": ["1.4", "6.2"] },
    { "id": 4, "tasks": ["1.5", "6.3"] },
    { "id": 5, "tasks": ["1.6", "6.4"] },
    { "id": 6, "tasks": ["6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "8.1", "8.2", "8.3", "8.4", "8.5"] },
    { "id": 7, "tasks": ["8.6", "8.7", "8.8"] },
    { "id": 8, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3"] }
  ]
}
```
