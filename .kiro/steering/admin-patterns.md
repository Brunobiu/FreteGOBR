---
inclusion: always
---

# Padrões do Painel Admin do FreteGO

Padrões herdados desde `admin-foundation` (migration 030) que se repetem em
TODAS as specs do painel administrativo. Quando criar nova spec/módulo admin,
reusar exatamente assim — sem reinventar.

## 1. Audit-by-construction via `executeAdminMutation`

Toda mutação admin é envolvida por `executeAdminMutation` em `src/services/admin/audit.ts`.
O wrapper grava audit log inicial, executa a `fn`, e rollback-loga em caso de falha.

```ts
import { executeAdminMutation } from '../audit';

export async function someMutation(id: string, payload: P, expectedUpdatedAt: string) {
  return executeAdminMutation(
    {
      action: 'MODULE_ACTION',           // inglês, UPPER_SNAKE
      targetType: 'tabela_alvo',         // snake_case
      targetId: id,
      before: { ...snapshot_antes },
      after: { ...snapshot_depois },
    },
    async () => {
      const { data, error } = await supabase.rpc('rpc_name', { ...args });
      if (error) throw error;
      return data;
    }
  );
}
```

Operações **idempotentes** que não mutam (`_SKIPPED`) gravam o audit log
**dentro da própria RPC SQL** com `INSERT INTO admin_audit_logs(...)` e
retornam `{ skipped: true, reason: '...' }`. NÃO usar `executeAdminMutation`
nesses casos — não há mutação real.

Audit log de **leitura sem permissão** (path negativo de RPCs gated):
gravar `<MODULE>_VIEW_DENIED` com `before=NULL`, `after={ user_id, reason }`.

## 2. RBAC server-side: `is_admin_with_permission`

Gating em **duas camadas**, sempre:

**Camada 1 — UI:**
```tsx
const { allowed: canEdit } = useAdminPermission('MODULE_EDIT');
if (!canEdit) return null; // botão NÃO aparece
```

**Camada 2 — RPC SECURITY DEFINER:**
```sql
CREATE OR REPLACE FUNCTION rpc_name(...)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('MODULE_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'MODULE_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: MODULE_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- ... lógica
END;
$func$;

REVOKE ALL ON FUNCTION rpc_name(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_name(...) TO authenticated;
```

Nunca confiar só no UI — o servidor decide.

## 3. Versionamento otimista (`updated_at` + `STALE_VERSION`)

Toda UPDATE que muda estado importante usa `expected_updated_at`:

```sql
UPDATE tabela
   SET ..., updated_at = NOW()
 WHERE id = p_id
   AND updated_at = p_expected_updated_at;

GET DIAGNOSTICS v_rows = ROW_COUNT;
IF v_rows = 0 THEN
  -- distinguir NOT_FOUND, ALREADY_REMOVED, STALE_VERSION via SELECT pré-fetch
  RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
END IF;
```

**TS:**
```ts
catch (err) {
  if (err.code === 'STALE_VERSION') {
    toast('Outro admin atualizou. Recarregando.');
    refetch();
  }
}
```

UI sempre lê `updated_at` antes de abrir modal de edição e envia o valor
de volta na chamada.

## 4. Idempotência `_SKIPPED`

Operações que devem ser seguras de chamar múltiplas vezes:

```sql
-- Pre-check do estado
SELECT status INTO v_status FROM tabela WHERE id = p_id;

IF v_status = 'estado_destino' THEN
  -- já no estado-alvo: NÃO mutar, gravar log SKIPPED, retornar skip
  INSERT INTO admin_audit_logs(...) VALUES (..., 'ACTION_SKIPPED', ...);
  RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_<STATE>');
END IF;

-- Caso contrário, mutação normal com versionamento otimista
```

**TS:**
```ts
type Result =
  | { ok: true; updated_at: string }
  | { skipped: true; reason: 'ALREADY_PAID' | 'ALREADY_REMOVED' | ... };
```

UI exibe toast neutro em skip (`Esta entrada já estava removida.`),
não como erro.

## 5. `Stealth_404` para acessos sem permissão

Em `AdminGuard`, falha de qualquer check resulta em
`<NotFoundPage />` idêntico ao 404 público — sem revelar que a rota
existe. **Nunca** mostrar `Acesso negado` explicitamente.

```tsx
const { allowed } = useAdminPermission('MODULE_VIEW');
if (!allowed) return <Stealth404 />;
```

## 6. Degradação parcial em fetch agregado

Padrão de `getUserDetail`/`getBlacklistDetail`/`getMetrics`:
- `Promise.allSettled` em sub-queries paralelas.
- Falha de bloco vai para `bundle.errors[bloco] = 'Bloco indisponível.'`.
- Bloco principal (entidade-fonte) é o único que pode lançar `NOT_FOUND`.
- UI renderiza `<DashboardBlockError onRetry={onRefresh} />` apenas no
  bloco que falhou. Demais blocos seguem normal.

## 7. Bulk com pool de concorrência 5

Operações em lote (`bulkRemove`, `bulkImport`, `bulkToggleActive`):

```ts
const queue = [...items];
async function worker() {
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    try {
      await singleOperation(item);
      results.success++;
    } catch (err) {
      if (err.code === 'ALREADY_X') results.skipped++;
      else results.failed++;
    }
  }
}
await Promise.all(Array.from({ length: Math.min(5, items.length) }, () => worker()));
```

Limite hard de **200 itens** por bulk (UI bloqueia antes).

## 8. Master Admin imutável

`users.admin_username = 'Nexus_Vortex99'` (Bruno Henrique).
Toda mutação admin no `users` deve abortar **antes** do touch:

```ts
await assertNotMasterNorSelf(targetId);
// ...
```

E em SQL via trigger `users_protect_master` que bloqueia UPDATE/DELETE.

## 9. Migration idempotente com `DO $check$` defensivo

Toda migration nova:

```sql
BEGIN;

-- Validações defensivas
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema='public' AND routine_name='is_admin_with_permission') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada';
  END IF;
END
$check$;

-- DDL idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS antes de CREATE POLICY,
-- INSERT ... ON CONFLICT DO NOTHING em buckets/seeds.

-- ...

-- Bloco -- VERIFY comentado no fim para smoke test manual.
/*
SELECT ...;
*/

COMMIT;
```

E criar **par rollback** `_rollback.sql` documentado, não auto-aplicado.

## 10. RPC Security Posture

Toda RPC SECURITY DEFINER:
1. `SET search_path = public` no header (evita search-path attacks).
2. `auth.uid() IS NULL` ⇒ `RAISE permission_denied`.
3. `is_admin_with_permission(...)` check — log negativo se falhar.
4. Validações de input (domínios fechados, ranges).
5. `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` no fim.

Nunca expor RPC ao role `anon` exceto se o caso de uso explicitamente
suporta sem login (ex: `is_blacklisted` pré-signup).
