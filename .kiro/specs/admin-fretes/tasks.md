# Implementation Plan: admin-fretes

## Overview

Plano incremental para entregar o módulo de Gestão de Fretes do painel administrativo do FreteGO, sentado em cima das fundações já em produção: `admin-foundation` (migration 030, `AdminProvider`, `AdminGuard`, `AdminShell`, `Permission_Matrix`, `executeAdminMutation`, `is_admin_with_permission`) e `admin-users` (migration 031, padrão de versionamento otimista, padrão de bulk com `Promise.allSettled` + concorrência 5, padrão de CSV RFC 4180, `users.is_active`/`users.ban_reason` para checagem de `EMBARCADOR_INACTIVE`). Cada task referencia requisitos do `requirements.md` (Reqs X.Y) e propriedades de correção do `design.md` (CP-N). Sub-tasks marcadas com `*` são opcionais (testes de propriedade complementares, smoke tests, docs auxiliares); sub-tasks sem asterisco são obrigatórias.

Convenções:
- Esta spec é continuação de `admin-foundation` + `admin-users`. Toda dependência lá entregue (Provider, Guard, Shell, Sidebar, hooks, services, RPCs, padrões) é **reusada sem modificação**, exceto `AdminLayoutRoute` que recebe 2 rotas filhas novas.
- Toda mutação passa por `executeAdminMutation`; nenhuma chamada direta a `.update`/`.delete`/`.insert` em `fretes.ts` (exceto `select`).
- Stack: TypeScript + React + Supabase + fast-check + Vitest (já em uso no projeto).
- Property tests obrigatórios: 3.11 (CP-1, `forceClose` idempotente em frete encerrado) e 3.12 (CP-2, `cancelFrete` sem motivo falha com `INVALID_INPUT`). Os demais CPs são opcionais conforme `requirements.md` § Padrões de Sucesso item 2.

## Tasks

- [ ] 1. Migration 032 e contratos base de banco
  - [x] 1.1 Criar `supabase/migrations/032_admin_fretes.sql`
    - Cabeçalho com objetivo, dependência de `001..031` e nota sobre as 5 colunas novas, RPC `admin_delete_frete` e policies adicionais.
    - Envolver em `BEGIN; ... COMMIT;`. 2 blocos `DO $check$` validando: (a) `is_admin_with_permission` existe (migration 030); (b) `users.ban_reason` existe (migration 031).
    - `ALTER TABLE fretes ADD COLUMN IF NOT EXISTS cancel_reason TEXT NULL`, `flagged_for_review BOOLEAN NOT NULL DEFAULT false`, `flagged_reason TEXT NULL`, `flagged_at TIMESTAMPTZ NULL`, `flagged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`.
    - _Requirements: 11.1, 17.1, 17.2, 17.3, 17.4, 17.5, 17.8_

  - [x] 1.2 Adicionar 4 constraints de coerência em `fretes`
    - `chk_fretes_cancel_reason_length`: `cancel_reason IS NULL OR char_length(cancel_reason) <= 1000`.
    - `chk_fretes_cancel_reason_consistency`: `(status='cancelado' AND cancel_reason IS NOT NULL) OR (status<>'cancelado' AND cancel_reason IS NULL)`.
    - `chk_fretes_flagged_reason_length`: `flagged_reason IS NULL OR char_length(flagged_reason) <= 500`.
    - `chk_fretes_flag_consistency`: as 4 colunas `flagged_*` andam juntas conforme Req 11.2.
    - Idempotente via `DROP CONSTRAINT IF EXISTS` antes de `ADD CONSTRAINT`.
    - _Requirements: 6.4, 11.2, 17.3_

  - [x] 1.3 Adicionar 4 índices
    - `idx_fretes_flagged ON fretes(id) WHERE flagged_for_review = true` (parcial, Req 11.3).
    - `idx_fretes_status_created ON fretes(status, created_at DESC)`.
    - `idx_fretes_embarcador_created ON fretes(embarcador_id, created_at DESC)`.
    - `idx_fretes_active_deadline ON fretes(deadline) WHERE status = 'ativo'` (para alerta `expired_active`).
    - Todos via `CREATE INDEX IF NOT EXISTS` para idempotência.
    - _Requirements: 11.3, 17.3_

  - [x] 1.4 Salvaguarda de cascade em `frete_clicks`
    - Bloco `DO $fk$` defensivo que verifica se `frete_clicks_frete_id_fkey` existe e tem `ON DELETE CASCADE`; se não tiver, recria a FK preservando o constraint name.
    - Helper local `attname(oid, smallint)` via `CREATE OR REPLACE FUNCTION` (idempotente).
    - **Não modifica** a FK quando ela já está correta — bloco é apenas defensivo.
    - _Requirements: 8.8, 17.3_

  - [x] 1.5 Função `admin_delete_frete(p_frete_id uuid) RETURNS jsonb` SECURITY DEFINER
    - `CREATE OR REPLACE FUNCTION` com `LANGUAGE plpgsql SET search_path = public`.
    - Valida `auth.uid() IS NOT NULL` e `is_admin_with_permission('FRETE_DELETE')`; senão `RAISE EXCEPTION 'permission_denied: FRETE_DELETE required'`.
    - Valida existência do frete; senão `RAISE EXCEPTION 'not_found'`.
    - `SELECT FOR UPDATE` no frete para serializar, depois `DELETE FROM frete_clicks` capturando `ROW_COUNT` em `v_clicks_deleted`, depois `DELETE FROM fretes`.
    - Retorna `jsonb_build_object('deleted', true, 'clicks_deleted', v_clicks_deleted)`.
    - `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.
    - **Não** loga internamente; o log é responsabilidade do `executeAdminMutation` na camada TS.
    - _Requirements: 8.6, 8.7, 8.8, 17.2_

  - [x] 1.6 Adicionar 5 policies RLS via `is_admin_with_permission`
    - `fretes_admin_select` (FOR SELECT) ⇒ `is_admin_with_permission('FRETE_VIEW')`.
    - `fretes_admin_update` (FOR UPDATE) ⇒ `FRETE_EDIT OR FRETE_FORCE_CLOSE` em USING e WITH CHECK.
    - `fretes_admin_delete` (FOR DELETE) ⇒ `FRETE_DELETE` (defesa em profundidade — RPC já checa).
    - `frete_clicks_admin_select` (FOR SELECT) ⇒ `FRETE_VIEW`.
    - `frete_clicks_admin_delete` (FOR DELETE) ⇒ `FRETE_DELETE` (necessária para a RPC apagar cliques).
    - Idempotente via `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`.
    - Preservar policies do app comum (`embarcador edita próprio frete`, `motorista clica em frete`) intactas.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10_

  - [x] 1.7 Bloco `-- VERIFY` pós-deploy
    - SELECTs que validam: 5 colunas novas em `fretes`, 4 constraints, 4 índices, 1 RPC `admin_delete_frete`, 5 policies novas, FK `frete_clicks.frete_id` com `confdeltype = 'c'`.
    - Os SELECTs servem como smoke test executável manualmente após o deploy.
    - _Requirements: 17.7_

  - [ ]* 1.8 Smoke test de idempotência da migration
    - Script ou doc em `supabase/migrations/_test_idempotency_032.sql` que aplica a migration 2x e valida que a segunda execução não falha e não duplica dados.
    - _Requirements: 17.3, 17.6_

  - [x] 1.9 Criar script de rollback `supabase/migrations/032_admin_fretes_rollback.sql`
    - Documenta DROP de RPC `admin_delete_frete`, DROP das 5 policies novas, DROP das 4 constraints, DROP dos 4 índices e `ALTER TABLE` para remover as 5 colunas novas.
    - **Não** é auto-aplicado; serve como referência para recovery.
    - _Requirements: 17.6_

- [ ] 2. Service core: `src/services/admin/fretes.ts` — parte 1 (tipos + helpers + leituras)
  - [x] 2.1 Tipos públicos exportados
    - `FreteStatus`, `FreteStatusFilter`, `FreteSort`, `FretesFilters` (com `DEFAULT_FRETES_FILTERS`), `FreteRow`, `FretesListResult`, `FreteEmbarcadorSnapshot`, `FreteClickRow`, `FreteAuditEntry`, `FreteMetrics`, `FreteDetailBundle` (com `errors: Partial<Record<...>>` para degradação parcial).
    - `FretesAlerts` com `flaggedCount`, `expiredActiveCount`, `noClicksRecentCount`.
    - `BulkResult` e `BulkSkipReason`.
    - `EditFretePayload`.
    - Classe `FretesServiceError extends Error` com 10 codes do `FretesErrorCode`: `STALE_VERSION`, `EMBARCADOR_INACTIVE`, `INVALID_INPUT`, `INVALID_STATUS_TRANSITION`, `TERMINAL_STATE_FIELD_LOCKED`, `DEADLINE_IN_PAST`, `ALREADY_CLOSED`, `NOT_FOUND`, `PERMISSION_DENIED`, `BULK_LIMIT_EXCEEDED`.
    - Tabela de mensagens UI (pt-BR) por code, exportada como `FRETES_ERROR_MESSAGES`.
    - Constante `SPECIFICATIONS_PLACEHOLDER = '[Conteúdo removido por moderação]'`.
    - _Requirements: 4.6, 4.9, 5.6, 6.6, 7.4, 9.13, 10.4, 16.3_

  - [x] 2.2 Helpers puros e testáveis
    - `classifyFreteStatus(f)`: retorna `f.status` (Req 11 — invariante de classificação).
    - `isUuid(s)`: regex UUID v4.
    - `calculateMetrics({views_count, clicks_count, created_at, now?})`: calcula `days_active` (floor de `(now - created_at) / 86400_000`) e `estimated_conversion` (`clicks/views*100` com 2 casas, `null` se views=0).
    - `exportFretesToCsvString(rows)`: cabeçalho fixo de 17 campos `id,status,origin,destination,cargo_type,vehicle_type,weight,value,deadline,embarcador_id,embarcador_name,views_count,clicks_count,flagged_for_review,cancel_reason,created_at,updated_at`; escape RFC 4180; separador `;`; BOM UTF-8.
    - `parseFretesFiltersFromQuery(qs)` / `serializeFretesFiltersToQuery(f)`: round-trip; defaults aplicados a valores ausentes/inválidos (Req 2.14).
    - _Requirements: 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 3.9, 12.3, 12.4_

  - [x] 2.3 `listFretes(filters)` — leitura paginada
    - Aplica `Frete_Status_Filter`, `Frete_Embarcador_Filter` (eq `embarcador_id`), `Frete_Period_Filter` (`gte from + 'T00:00:00Z'`, `lte to + 'T23:59:59Z'`), `Frete_Search` (ILIKE em `origin/destination/cargo_type`), `flagged` (eq true), `Frete_Sort` e paginação 25/página.
    - Join `users` (para `embarcador_name`) e `embarcadores` (para `cnpj`).
    - Retorna `{rows, total, page, pageSize}`. `total` vem de `count: 'exact'` na query do Supabase.
    - Execução com JWT do admin: RLS filtra silenciosamente quando o admin não tem `FRETE_VIEW`.
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 2.9, 2.10, 13.7_

  - [x] 2.4 `getFreteDetail(id, clicksPage)` — bundle agregado com degradação parcial
    - Valida `id` como UUID antes de chamar o banco; se inválido, lança `NOT_FOUND` (a página converte em Stealth 404).
    - Consolida 7 sub-queries via `Promise.allSettled`: frete principal (fonte da verdade), embarcador snapshot (join `users` + `embarcadores`), cliques paginados 10/página (join `users`), métricas (computadas via `calculateMetrics`), histórico de `admin_audit_logs WHERE target_type='fretes' AND target_id=:id`, contagem total de cliques.
    - Cada bloco que falha é registrado em `bundle.errors[bloco]`; os demais blocos continuam renderizando.
    - Bloqueia retorno (lança `NOT_FOUND`) quando o registro principal não existe.
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 15.2, 15.3_

  - [x] 2.5 `getAlerts()` — retorna `FretesAlerts`
    - 3 SELECTs `count: 'exact', head: true` em paralelo: `flagged_for_review = true`; `status = 'ativo' AND deadline < CURRENT_DATE`; `status = 'ativo' AND clicks_count = 0 AND created_at < NOW() - INTERVAL '7 days'`.
    - Em qualquer falha de sub-query, retorna 0 nesse contador (degradação parcial).
    - _Requirements: 1.5, 11.10_

  - [ ]* 2.6 Property test CP-3 (filtros round-trip via URL) em `src/__tests__/admin/fretes/filtersRoundTrip.property.test.ts`
    - **Property CP-3: Round-trip de filtros via URL**
    - Para todo `f: FretesFilters` válido, `parseFretesFiltersFromQuery(serializeFretesFiltersToQuery(f))` é deep-equal a `f`.
    - **Validates: Requirements 2.12, 2.13, 2.14**

  - [ ]* 2.7 Property test CP-4 (CSV round-trip RFC 4180) em `src/__tests__/admin/fretes/csvRoundTrip.property.test.ts`
    - **Property CP-4: CSV export respeita RFC 4180**
    - Para toda lista `L: FreteRow[]` com strings arbitrárias (incluindo `,`, `"`, `\n`, `\r` em `origin/destination/cargo_type/cancel_reason`), `parseCsv(exportFretesToCsvString(L))` é deep-equal a `L`; cada linha tem 17 campos.
    - **Validates: Requirements 12.3, 12.4**

  - [ ]* 2.8 Property test CP-10 (estimated_conversion em range) em `src/__tests__/admin/fretes/conversionInRange.property.test.ts`
    - **Property CP-10: estimated_conversion está em [0, +∞) ou '—'**
    - Para todo par `(views_count, clicks_count) ∈ ℕ × ℕ`, `calculateMetrics(...)` retorna `estimated_conversion` ≥ 0 com 2 casas decimais quando `views_count > 0`, e `null` (UI exibe `—`) quando `views_count = 0`. Nunca `NaN`, `Infinity` ou negativo.
    - **Validates: Requirements 3.9**

  - [ ]* 2.9 Property test CP-11 (status filter classification) em `src/__tests__/admin/fretes/statusFilterClassification.property.test.ts`
    - **Property CP-11: Frete_Status_Filter classifica corretamente**
    - Para todo `FreteRow f` com `status ∈ {'ativo','encerrado','cancelado'}`, `f` aparece quando o filtro é `'todos'` ou igual ao próprio status; nunca aparece em outro filtro.
    - **Validates: Requirements 2.1**

- [ ] 3. Service core: `src/services/admin/fretes.ts` — parte 2 (mutações)
  - [x] 3.1 `editFrete(id, data, expectedUpdatedAt)` com versionamento otimista
    - Validação local do payload: `weight > 0`, `value > 0`, `deadline >= hoje` (lança `DEADLINE_IN_PAST`), `loading_time >= 0`, `unloading_time >= 0`, `specifications` <= 2000 chars; `embarcador_id` da request não pode divergir do atual (lança `INVALID_INPUT` com mensagem `Embarcador do frete não pode ser alterado.`).
    - Pre-check: se `status = 'cancelado'`, lança `TERMINAL_STATE_FIELD_LOCKED` para campos críticos (todos exceto reativação).
    - `executeAdminMutation('FRETE_EDIT', ...)` que aplica `UPDATE fretes SET ... WHERE id = $1 AND updated_at = expectedUpdatedAt`; se `count = 0`, lança `STALE_VERSION` e gera audit log `FRETE_EDIT_STALE_VERSION`.
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 16.1, 16.2, 16.3_

  - [x] 3.2 `forceCloseFrete(id)` idempotente
    - Pre-fetch do `status` atual.
    - Se `status === 'encerrado'` (alvo): grava `FRETE_FORCE_CLOSE_SKIPPED` com `before:{status:'encerrado'}` e `after:{reason:'ALREADY_IN_TARGET_STATE'}`, NÃO toca o banco, retorna `{ skipped: true, reason: 'ALREADY_IN_TARGET_STATE' }`.
    - Se `status === 'cancelado'`: lança `INVALID_STATUS_TRANSITION`.
    - Se `status === 'ativo'`: `executeAdminMutation('FRETE_FORCE_CLOSE', ...)` que executa `UPDATE fretes SET status='encerrado', updated_at=NOW() WHERE id=$1`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 3.3 `cancelFrete(id, reason)` com validação `INVALID_INPUT` antes do DB
    - Validação **local** antes de qualquer chamada ao banco: `reason` é string não-vazia após `trim()` e `<= 1000` chars; senão lança `INVALID_INPUT` (Req 6.6).
    - Se `status === 'cancelado'`: grava `FRETE_FORCE_CANCEL_SKIPPED` com motivo `ALREADY_IN_TARGET_STATE`, retorna skip sem tocar o banco.
    - Caso contrário: `executeAdminMutation('FRETE_FORCE_CANCEL', ...)` que executa `UPDATE fretes SET status='cancelado', cancel_reason=$2, updated_at=NOW() WHERE id=$1`.
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 3.4 `reactivateFrete(id)` com pre-check `EMBARCADOR_INACTIVE`
    - Pre-fetch via JOIN: `SELECT f.status, u.is_active, u.ban_reason FROM fretes f JOIN users u ON u.id = f.embarcador_id WHERE f.id = $1`.
    - Se `is_active = false OR ban_reason IS NOT NULL`: lança `EMBARCADOR_INACTIVE` antes de qualquer mutação.
    - Se `status === 'ativo'`: grava `FRETE_REACTIVATE_SKIPPED`, retorna skip.
    - Caso contrário: `executeAdminMutation('FRETE_REACTIVATE', ...)` que executa `UPDATE fretes SET status='ativo', cancel_reason=NULL, updated_at=NOW() WHERE id=$1`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 3.5 `deleteFrete(id, options)` via RPC `admin_delete_frete`
    - Valida `options.confirmedKeyword === 'EXCLUIR'`; senão lança `INVALID_INPUT`.
    - Pre-fetch do snapshot completo do frete + `clicks_count` para `before_data`.
    - `executeAdminMutation('FRETE_DELETE', { before:{frete:<snapshot>, clicks_count}, after:null }, fn)` que invoca `supabase.rpc('admin_delete_frete', { p_frete_id })`.
    - Após sucesso da RPC, dispara **log secundário** `FRETE_DELETE_CASCADE_CLICKS` com `after:{clicks_deleted: <retorno da RPC>}`.
    - Retorna `{ deleted: true, clicksDeleted }`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [x] 3.6 `flagFrete(id, reason)` e `unflagFrete(id)`
    - `flagFrete`: valida `reason` 1..500 chars após `trim()`; senão lança `INVALID_INPUT`. `executeAdminMutation('FRETE_FLAGGED', ...)` que executa `UPDATE fretes SET flagged_for_review=true, flagged_reason=$2, flagged_at=NOW(), flagged_by=<admin_id>, updated_at=NOW() WHERE id=$1`.
    - `unflagFrete`: `executeAdminMutation('FRETE_UNFLAGGED', ...)` que zera as 4 colunas `flagged_*`.
    - Idempotência: se já no estado-alvo, segue o mesmo fluxo (audit log gerado, `count=1` por update real do `updated_at`).
    - _Requirements: 11.4, 11.5, 11.6, 11.7, 11.8_

  - [x] 3.7 `moderateSpecifications(id)` idempotente via `ALREADY_MODERATED`
    - Pre-fetch do `specifications` atual.
    - Se já igual a `SPECIFICATIONS_PLACEHOLDER`: grava `FRETE_CONTENT_MODERATED_SKIPPED`, retorna `{ skipped: true, reason: 'ALREADY_MODERATED' }`.
    - Caso contrário: `executeAdminMutation('FRETE_CONTENT_MODERATED', { before:{specifications: <original>}, after:{specifications: SPECIFICATIONS_PLACEHOLDER} }, fn)` que executa `UPDATE fretes SET specifications=$2, updated_at=NOW() WHERE id=$1`.
    - _Requirements: 10.2, 10.3, 10.4, 10.5_

  - [x] 3.8 `bulkClose(ids)` com `Promise.allSettled` + concorrência 5 + limite 200
    - Valida `ids.length <= 200`; senão lança `BULK_LIMIT_EXCEEDED`.
    - Pre-fetch de status: `SELECT id, status FROM fretes WHERE id IN (...)`.
    - Para cada id classifica: `status='encerrado'` ⇒ skip (`ALREADY_IN_TARGET_STATE`); `status='cancelado'` ⇒ skip (`INVALID_STATUS_TRANSITION`); `status='ativo'` ⇒ executa `forceCloseFrete(id)` core.
    - Cada skip gera 1 audit log `FRETE_FORCE_CLOSE_SKIPPED` próprio (Req 9.6, 9.9, 9.10); cada sucesso gera 1 audit log `FRETE_FORCE_CLOSE`.
    - Pool de concorrência 5 via `Promise.allSettled` (padrão herdado de `users.ts::bulkToggleActive`).
    - Retorna `BulkResult { success, skipped, failed }`.
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13_

  - [x] 3.9 `bulkCancel(ids, reason)` — variante com motivo obrigatório
    - Valida `reason` 1..1000 chars após `trim()` antes de qualquer mutação; senão lança `INVALID_INPUT`.
    - Mesmo padrão de `bulkClose`: pre-fetch, classifica skip por estado-alvo, executa `cancelFrete(id, reason)` para cada ativo/encerrado.
    - `status='cancelado'` ⇒ skip (`ALREADY_IN_TARGET_STATE`).
    - O mesmo `reason` é aplicado a todos os fretes do lote (Req 9.4).
    - _Requirements: 9.4, 9.6, 9.7, 9.9, 9.11, 9.12, 9.13_

  - [x] 3.10 `exportFretesCSV(filters)` client-side com truncamento e audit
    - Reusa `listFretes(filters)` paginando até atingir 10000 linhas ou `total`.
    - Gera CSV via `exportFretesToCsvString`; retorna `{csv, totalExported, truncated}` (`truncated = total > 10000`).
    - Dispara `executeAdminMutation('FRETES_EXPORT', { before:null, after:{filters, total_exported, requested_limit:10000} })`.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [x] 3.11 Property test CP-1 (forceClose idempotente em frete encerrado) em `src/__tests__/admin/fretes/forceCloseIdempotent.property.test.ts`
    - **Property CP-1: forceClose é idempotente em frete encerrado**
    - Para todo `f: FreteRow` com `f.status = 'encerrado'`, executar `forceCloseFrete(f.id)` retorna `{ skipped: true, reason: 'ALREADY_IN_TARGET_STATE' }`, NÃO executa `UPDATE` no banco (mock conta `update.callCount === 0`), e gera exatamente 1 registro novo em `admin_audit_logs` com `action = 'FRETE_FORCE_CLOSE_SKIPPED'`. Repetir `n ∈ [1, 5]` vezes preserva o estado.
    - **Validates: Requirements 5.5, 14.1, 14.2, 14.5**

  - [x] 3.12 Property test CP-2 (cancelFrete sem motivo falha com INVALID_INPUT) em `src/__tests__/admin/fretes/cancelRequiresReason.property.test.ts`
    - **Property CP-2: cancelFrete sem motivo falha com INVALID_INPUT**
    - Para toda string `r ∈ {undefined, null, '', '   ', '\t\n'}` (motivos vazios ou apenas whitespace), `cancelFrete(freteId, r)` falha com `FretesServiceError(INVALID_INPUT)` ANTES de qualquer chamada ao banco e ANTES de qualquer audit log de mutação principal. Estado de `fretes` permanece inalterado e nenhum registro novo aparece em `admin_audit_logs`.
    - **Validates: Requirements 6.3, 6.4, 6.6, 14.1, 14.2**

  - [ ]* 3.13 Property test CP-7 (versionamento otimista em editFrete) em `src/__tests__/admin/fretes/optimisticVersion.property.test.ts`
    - **Property CP-7: Versionamento otimista detecta concorrência em edit**
    - Para toda sequência `[t1, t2]` com `t1 < t2`, `editFrete(f, expectedUpdatedAt=t1)` quando o banco já tem `updated_at=t2` falha com `STALE_VERSION` e o registro permanece inalterado. Audit log `FRETE_EDIT_STALE_VERSION` é gerado.
    - **Validates: Requirements 4.9, 16.1, 16.2, 16.3**

  - [ ]* 3.14 Property test CP-8 (audit by construction) em `src/__tests__/admin/fretes/auditByConstruction.property.test.ts`
    - **Property CP-8: Toda mutação gera exatamente 1 audit log (ou 2 em rollback/skip)**
    - Para toda mutação bem-sucedida em `Fretes_Service`, há exatamente 1 registro novo em `admin_audit_logs`; em falha pós-log, há 1 original + 1 `_ROLLBACK`; em skip, há 1 `_SKIPPED` no lugar do principal. Exceção documentada: `deleteFrete` gera 2 logs em sucesso (`FRETE_DELETE` + `FRETE_DELETE_CASCADE_CLICKS`).
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**

  - [ ]* 3.15 Property test CP-9 (reactivate bloqueado por embarcador inativo) em `src/__tests__/admin/fretes/reactivateBlocked.property.test.ts`
    - **Property CP-9: Reativar embarcador inativo falha com EMBARCADOR_INACTIVE**
    - Para todo `Frete f` cujo embarcador `e` tem `e.is_active = false OR e.ban_reason IS NOT NULL`, `reactivateFrete(f.id)` falha com `EMBARCADOR_INACTIVE` antes de chamar mutação no banco, independente de `f.status`.
    - **Validates: Requirements 7.4**

  - [ ]* 3.16 Property test CP-5 (bulk pula fretes de status mistos) em `src/__tests__/admin/fretes/bulkSkip.property.test.ts`
    - **Property CP-5: Bulk pula fretes já no estado-alvo e em transição inválida**
    - Para toda lista mista de fretes (ativo/encerrado/cancelado), `bulkClose(ids)` retorna `S = |encerrados| + |cancelados|` em `skipped` (com motivos `ALREADY_IN_TARGET_STATE` e `INVALID_STATUS_TRANSITION` respectivamente), `K = |ativos|` em `success`, `F = 0` em `failed`. Tamanho `n ∈ [0, 200]`.
    - **Validates: Requirements 9.9, 9.10, 9.13**

- [ ] 4. Componentes da listagem
  - [x] 4.1 `src/components/admin/fretes/FretesFilters.tsx`
    - Dropdown `Frete_Status_Filter` (Todos/Ativo/Encerrado/Cancelado), dropdown searchable `Frete_Embarcador_Filter` (consulta `users` + `embarcadores.cnpj`), 2 inputs `<input type="date">` para `from`/`to`, input `Frete_Search` com debounce 300ms, dropdown `Frete_Sort`, checkbox `Apenas sinalizados`.
    - Validação client-side: `from > to` ⇒ erro `Data inicial deve ser menor ou igual à final.` e NÃO dispara busca (Req 2.6).
    - `onChange` sempre reseta `page=1` (Req 2.11).
    - Labels associados via `htmlFor`/`id`; container com contador `Total: N fretes (filtrados)`.
    - _Requirements: 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 11.10, 18.1, 18.2_

  - [x] 4.2 `src/components/admin/fretes/FretesTable.tsx`
    - Linha com checkbox bulk (oculto se `canSelect=false`), id curto (8 chars), origem, destino, tipo de carga, badge de status (cor por valor), valor BRL, prazo, data de cadastro, contagem de cliques, ícone laranja quando `flagged_for_review = true`.
    - `<th scope="col">` em todas as colunas; `<caption class="sr-only">Lista de fretes do FreteGO</caption>`.
    - Atalhos de teclado: `↑/↓` navega, `Enter` abre detalhe, `Space` toggla checkbox.
    - `aria-label` em checkboxes (`Selecionar frete [origem → destino]`); `aria-busy` no container quando `loading=true`.
    - Estado vazio com `role="status"` e mensagem `Nenhum frete encontrado com os filtros atuais.`.
    - _Requirements: 1.5, 1.8, 1.9, 9.1, 9.2, 11.9, 18.3, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10_

  - [x] 4.3 `src/components/admin/fretes/FretesBulkBar.tsx`
    - Barra fixa no topo quando `selectedCount > 0`, com botões `Encerrar selecionados`, `Cancelar selecionados`, `Limpar seleção`, contador `[N] selecionados`.
    - `disabled` quando `selectedCount > 200` com aviso `Máximo de 200 por operação.`.
    - Modal de progresso `[K] de [N] processados` durante execução (Req 9.8).
    - Modal de resumo final `[K] sucesso, [F] falhas, [S] pulados.` com link `Ver detalhes` listando pulados/falhos.
    - _Requirements: 9.3, 9.4, 9.5, 9.8, 9.11, 9.12, 9.13_

  - [x] 4.4 `src/components/admin/fretes/FretesAlertsCard.tsx`
    - Card no topo da listagem com 3 alertas (consome `FretesAlerts`):
      - `flaggedCount > 0` ⇒ badge laranja `[N] fretes sob revisão` clicável (aplica filtro `flagged=1`).
      - `expiredActiveCount > 0` ⇒ badge amarelo `[N] fretes ativos com prazo expirado`.
      - `noClicksRecentCount > 0` ⇒ badge cinza `[N] fretes ativos sem cliques há 7 dias`.
    - Cada bloco oculto quando seu contador é 0; card inteiro oculto quando todos são 0.
    - _Requirements: 1.5, 11.10_

- [ ] 5. Componentes do detalhe
  - [x] 5.1 `src/components/admin/fretes/FreteDetailHeader.tsx`
    - Título com origem → destino, badge de status, botões de ação: `Editar`, `Forçar encerramento`, `Forçar cancelamento`, `Reativar frete`, `Sinalizar/Remover sinalização`, `Excluir frete`.
    - Gating via `useAdminPermission` + checagens locais por `status` (ex: `Reativar` só visível se status ≠ ativo; `Forçar encerramento` só visível se status = ativo).
    - Botões **ocultos** (não desabilitados) quando o admin não tem permissão.
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 6.1, 7.1, 8.1, 8.2, 11.4, 11.5_

  - [x] 5.2 `src/components/admin/fretes/FreteDataBlock.tsx`
    - Campos do frete: id completo, status, origem (texto + lat/lng), destino (texto + lat/lng), `cargo_type`, `vehicle_type`, `weight`, `value` em BRL, `deadline`, `loading_time`, `unloading_time`, `specifications`, `created_at`, `updated_at`.
    - Botão `Moderar conteúdo` ao lado de `specifications` (gated por `FRETE_EDIT`).
    - Badge `Moderado` ao lado de `specifications` quando seu valor é igual a `SPECIFICATIONS_PLACEHOLDER`.
    - _Requirements: 3.6, 10.1, 10.6_

  - [x] 5.3 `src/components/admin/fretes/FreteEmbarcadorBlock.tsx`
    - Snapshot do embarcador: nome, CNPJ formatado, email, telefone.
    - Link `Ver perfil` que navega para `/admin/users/<embarcador_id>` (visível apenas se o admin tem `USER_VIEW`).
    - Estado de erro isolado quando `bundle.errors.embarcador` está presente.
    - _Requirements: 3.7_

  - [x] 5.4 `src/components/admin/fretes/FreteMapBlock.tsx`
    - Mini-mapa origem→destino reusando `InteractiveMap` em modo readonly.
    - Renderiza placeholder quando lat/lng ausentes.
    - _Requirements: 3.6_

  - [x] 5.5 `src/components/admin/fretes/FreteClicksBlock.tsx`
    - Lista paginada 10/página, ordenada por `clicked_at DESC`.
    - Cada linha: nome do motorista, telefone, `clicked_at` formatado `dd/MM/yyyy HH:mm`.
    - Link `Ver perfil` por motorista (gated por `USER_VIEW`).
    - Estado de erro isolado.
    - _Requirements: 3.8_

  - [x] 5.6 `src/components/admin/fretes/FreteLikesBlock.tsx`
    - Bloco de "Likes" análogo a `FreteClicksBlock`. **Adaptação**: se a tabela `frete_likes` não existe no schema, este componente deriva os dados de `admin_audit_logs WHERE target_type='fretes' AND target_id=:id AND action='FRETE_LIKED'`; se também não houver dados nessa origem, exibe estado vazio neutro `Sem likes registrados.`.
    - Componente é **opcional na UI**: oculto quando `bundle.likes` é `undefined` ou vazio.
    - _Requirements: 3.8_

  - [x] 5.7 `src/components/admin/fretes/FreteAuditHistoryBlock.tsx`
    - Lista de `admin_audit_logs WHERE target_type='fretes' AND target_id=:id` ordenada por `created_at DESC`.
    - Cada linha: data/hora, nome do admin (resolvido via join), `action`, botão `Ver detalhes` que abre modal com `before_data` e `after_data` em JSON.
    - Bloco inteiro **gated por `AUDIT_VIEW`**: oculto se admin não tem essa permissão.
    - _Requirements: 3.10_

  - [x] 5.8 `src/components/admin/fretes/FreteFlagInfoBlock.tsx`
    - Visível somente quando `frete.flagged_for_review === true`.
    - Exibe `flagged_reason`, `flagged_at`, nome do `flagged_by` (resolvido via join no `getFreteDetail`).
    - Badge `Sob revisão`.
    - _Requirements: 3.11_

- [ ] 6. Modais
  - [x] 6.1 `src/components/admin/fretes/EditFreteModal.tsx`
    - Campos editáveis: origin/origin_location, destination/destination_location, cargo_type, vehicle_type, weight, value, deadline, loading_time, unloading_time, specifications.
    - `embarcador_id` em readonly (não-editável).
    - Pré-preenche com `expectedUpdatedAt` capturado na abertura.
    - Validação local antes de submit; toast com mensagem amigável por code (`DEADLINE_IN_PAST`, `INVALID_INPUT`, etc.).
    - Em `STALE_VERSION`: exibe banner com botão `Recarregar` que fecha o modal e força re-fetch do bundle.
    - `role="dialog"`, `aria-modal="true"`, foco inicial no botão `Cancelar`.
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 16.4, 18.4_

  - [x] 6.2 `src/components/admin/fretes/CancelFreteModal.tsx`
    - Textarea `Motivo` obrigatório (1..1000 chars), com contador de caracteres.
    - Botão `Confirmar cancelamento` desabilitado quando `motivo` vazio (após `trim()`) ou > 1000 chars; mensagens de erro inline.
    - `role="dialog"`, `aria-modal="true"`, foco inicial em `Cancelar`.
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 18.4_

  - [x] 6.3 `src/components/admin/fretes/DeleteFreteModal.tsx`
    - Dupla confirmação: input para digitar `EXCLUIR` exatamente + checkbox `Estou ciente de que [N] cliques de motoristas serão excluídos junto`.
    - Aviso destacado em vermelho `Esta ação é irreversível. O frete e todos os cliques de motoristas serão removidos permanentemente.`.
    - Pre-fetch de `clicksCount` ao abrir o modal (renderiza `[N] cliques de motoristas serão excluídos junto.`).
    - Submit chama `deleteFrete(id, { confirmedKeyword: 'EXCLUIR' })` e redireciona para `/admin/fretes` em sucesso com toast `Frete excluído com sucesso. [N] cliques removidos.`.
    - `role="dialog"`, foco inicial em `Cancelar`.
    - _Requirements: 8.3, 8.4, 8.5, 8.9, 18.4_

  - [x] 6.4 `src/components/admin/fretes/FlagFreteModal.tsx`
    - Mode `flag` ou `unflag` via prop.
    - Em mode `flag`: textarea `Motivo` obrigatório (1..500 chars) com contador.
    - Em mode `unflag`: confirmação simples sem motivo.
    - `role="dialog"`, `aria-modal="true"`.
    - _Requirements: 11.6, 11.7, 11.8, 18.4_

  - [x] 6.5 `src/components/admin/fretes/ModerateContentModal.tsx`
    - Mostra antes (`specifications` original) e depois (`SPECIFICATIONS_PLACEHOLDER`).
    - Texto de confirmação: `Substituir o conteúdo de "Especificações" por placeholder de moderação? O conteúdo original ficará registrado no audit log.`.
    - Submit chama `moderateSpecifications(id)`; em skip (`ALREADY_MODERATED`), exibe toast neutro `Conteúdo já estava moderado.`.
    - _Requirements: 10.2, 10.3, 10.4, 10.5_

- [ ] 7. Páginas
  - [x] 7.1 `src/pages/admin/fretes/FretesListPage.tsx`
    - `useSearchParams` para sincronizar filtros com URL (`?status=&embarcador=&from=&to=&q=&sort=&flagged=&page=`); estado derivado via `parseFretesFiltersFromQuery`.
    - Compõe `FretesAlertsCard` + `FretesFilters` + `FretesTable` + `FretesBulkBar` + botão `Exportar CSV`.
    - Skeleton em `loading=true`; estado de erro com botão `Tentar novamente`.
    - Render Stealth 404 quando o admin não tem `FRETE_VIEW` (delegado ao `AdminGuard`; comportamento herdado).
    - Busca debounced 300ms apenas no campo `q`; demais filtros disparam imediatamente.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.8, 1.9, 1.10, 2.7, 2.12, 2.13, 12.1, 12.7, 15.1_

  - [x] 7.2 `src/pages/admin/fretes/FreteDetailPage.tsx`
    - Path param `:id`; valida UUID antes de chamar `getFreteDetail`; em inválido ou `NOT_FOUND`, renderiza `Stealth_404`.
    - Compõe `FreteDetailHeader` + `FreteFlagInfoBlock` + `FreteDataBlock` + `FreteEmbarcadorBlock` + `FreteMapBlock` + `FreteClicksBlock` + `FreteLikesBlock` + `FreteAuditHistoryBlock` (cada um isolando seu estado de erro).
    - Gating de modais (`EditFreteModal`, `CancelFreteModal`, `DeleteFreteModal`, `FlagFreteModal`, `ModerateContentModal`) via `useAdminPermission` + checagens locais por status.
    - Após delete bem-sucedido, redireciona para `/admin/fretes` com toast.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.12, 5.7, 6.8, 7.6, 8.9, 11.7, 11.8, 15.1, 15.2, 15.3_

  - [ ]* 7.3 Permission visibility test CP-6 em `src/__tests__/admin/fretes/permissionVisibility.property.test.ts`
    - **Property CP-6: Permission_Matrix decide visibilidade dos botões**
    - Para todo conjunto de papéis `R` e todo `Target_Frete f`, a presença/ausência dos botões de ação em `Frete_Detail_Page` casa com `hasPermissionForRoles(R, action)` para cada uma das 6 ações (`FRETE_EDIT`, `FRETE_FORCE_CLOSE`, `FRETE_DELETE`), respeitando também a visibilidade condicional por `f.status` (ex: `Reativar` só aparece se status ≠ ativo).
    - Snapshot por papel × ação × status.
    - **Validates: Requirements 4.2, 5.2, 6.1, 7.1, 8.2, 10.7, 11.4, 11.5**

- [ ] 8. Wiring de rotas
  - [x] 8.1 Atualizar `src/components/admin/AdminLayoutRoute.tsx`
    - Adicionar 2 rotas filhas dentro do bloco `<AdminGuard><AdminShell>...`: `fretes` e `fretes/:id`.
    - Importar `FretesListPage` e `FreteDetailPage` de `src/pages/admin/fretes/`.
    - **Atenção à ordem**: `fretes` (lista) precisa vir antes de `fretes/:id` (detalhe). Caso futuras specs adicionem `fretes/<segmento>` (ex: `fretes/relatorios`), elas devem vir antes de `fretes/:id`.
    - _Requirements: 1.1, 3.1, 15.4_

  - [ ]* 8.2 Test de roteamento em `src/__tests__/admin/fretes/routing.test.tsx`
    - Garante que `fretes` casa com `FretesListPage` e `fretes/<uuid>` casa com `FreteDetailPage`; regressão da ordem das rotas.
    - _Requirements: 15.4_

- [ ] 9. Checkpoint intermediário
  - [x] 9.1 Ensure all tests pass, ask the user if questions arise
    - Rodar `npx tsc --noEmit` (zero erros).
    - Rodar `npx vitest --run` com pelo menos os testes obrigatórios verdes (3.11 CP-1 + 3.12 CP-2).
    - Rodar `npm run build` (build limpa).

- [ ] 10. Validação fim a fim e migração
  - [ ]* 10.1 Roteiro E2E manual em `docs/admin-fretes-e2e.md`
    - Sequência: aplicar migration 032 → login admin → `/admin/fretes` (filtros, busca, sort, paginação, alertas, export CSV) → `/admin/fretes/:id` (7 blocos, ações destrutivas, edição com STALE_VERSION simulado, moderar conteúdo, sinalizar/remover sinalização) → bulk encerrar/cancelar com fretes de status mistos.
    - Casos negativos: SUPORTE tentando UPDATE direto via cliente Supabase ⇒ 0 linhas afetadas; MODERADOR tentando editar `cargo_type` ⇒ botão `Editar` ausente; reativar frete de embarcador banido ⇒ toast `EMBARCADOR_INACTIVE`; encerrar frete cancelado ⇒ toast `INVALID_STATUS_TRANSITION`.

  - [ ] 10.2 Aplicar migration `032_admin_fretes.sql` em Supabase de desenvolvimento
    - Executar via psql ou Supabase Studio.
    - Rodar bloco `-- VERIFY` e validar todos os SELECTs retornando esperado (5 colunas, 4 constraints, 4 índices, 1 RPC, 5 policies, FK com `confdeltype='c'`).
    - _Requirements: 17.1, 17.2, 17.3, 17.5, 17.7_

  - [ ]* 10.3 Smoke test do trigger ↔ service parity (CP-12 — integração) em `src/__tests__/admin/fretes/permissionMatrixFrete.property.test.ts`
    - **Property CP-12: Permission_Matrix determinística para FRETE_***
    - Integração: gated por env var `RUN_SUPABASE_INTEGRATION=1`; em ambiente local conectado ao Supabase, executa `is_admin_with_permission` no banco para cada `(role, action) ∈ AdminRole × {FRETE_VIEW, FRETE_EDIT, FRETE_DELETE, FRETE_FORCE_CLOSE}` e compara com `hasPermission` do TS, garantindo paridade exata.
    - Skipa silenciosamente quando a env var não está setada.
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.7, 13.8, 13.9**

  - [x] 10.4 Checkpoint final
    - `npx tsc --noEmit` zero erros.
    - `npm run build` limpa.
    - `npx vitest --run` todas as suítes verdes (opcionais skipadas se não implementadas; obrigatórias 3.11 e 3.12 verdes).
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tasks marcadas com `*` são opcionais (testes de propriedade complementares, smoke tests, roteiros manuais e docs auxiliares). O agente de implementação **NÃO** as executa automaticamente; podem ser puladas para um MVP mais rápido.
- Sub-tasks 3.11 (CP-1, `forceClose` idempotente) e 3.12 (CP-2, `cancelFrete` sem motivo) **NÃO** levam asterisco — são property tests obrigatórios conforme `requirements.md` § Padrões de Sucesso item 2.
- Cada property test referencia uma propriedade específica do `design.md` (CP-N) e os requisitos que ela valida.
- Cada checkpoint serve como ponto de validação incremental antes de avançar.
- Dependências da `admin-foundation` e `admin-users` (Provider, Guard, Shell, Sidebar, hooks, services, padrões de versionamento e bulk) são reusadas sem modificação, exceto `AdminLayoutRoute` que recebe 2 rotas filhas (task 8.1).
- Workflow de spec encerra após a criação do `tasks.md`. Para começar a executar, abra o arquivo e clique em "Start task" ao lado de cada item.
