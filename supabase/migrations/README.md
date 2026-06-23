# FreteGO Database Migrations

This directory contains SQL migration files for the FreteGO database schema.

## Migration Files

### 001_initial_schema.sql
**Purpose**: Creates the foundational database structure

**Contents**:
- Enables required PostgreSQL extensions (`uuid-ossp`, `postgis`)
- Creates 11 core tables:
  - `users` - Base user table for all user types
  - `motoristas` - Motorista-specific data (extends users)
  - `embarcadores` - Embarcador-specific data (extends users)
  - `fretes` - Freight/cargo listings
  - `frete_clicks` - Click tracking for analytics
  - `avaliacoes` - Rating system for embarcadores
  - `chat_conversations` - Support chat conversations
  - `chat_messages` - Chat messages
  - `documents` - User document storage metadata
  - `notifications` - User notifications
  - `audit_logs` - System audit trail
- Creates performance indexes for all tables
- Implements geographic indexes using PostGIS for location-based queries

**Key Features**:
- UUID primary keys for all tables
- Geographic data types for location tracking
- Proper foreign key relationships with CASCADE deletes
- Timestamp tracking (created_at, updated_at)
- Check constraints for data validation

### 002_functions_and_triggers.sql
**Purpose**: Implements database-level business logic and automation

**Functions**:
- `update_updated_at_column()` - Auto-updates timestamp on row changes
- `update_embarcador_rating()` - Recalculates embarcador average rating
- `increment_frete_views()` - Increments view counter for fretes
- `record_frete_click()` - Records click and updates counter (prevents duplicates)
- `find_nearby_fretes()` - Geographic search for fretes within radius
- `calculate_distance()` - Calculates distance between two geographic points
- `record_user_activity()` - Updates user last activity timestamp
- `get_online_users_count()` - Returns count of users active in last 5 minutes
- `get_platform_metrics()` - Returns comprehensive platform statistics
- `get_user_growth()` - Returns user registration growth data
- `get_frete_growth()` - Returns frete posting growth data
- `get_unread_message_count()` - Returns unread message count for conversation
- `mark_messages_as_read()` - Marks all messages in conversation as read

**Triggers**:
- Auto-update `updated_at` on all tables with that column
- Auto-recalculate embarcador rating when new rating is added
- Auto-update conversation timestamp when new message is added

### 003_rls_policies.sql
**Purpose**: Implements Row Level Security for data protection

**Security Model**:
- **Users**: Can view/update own data; admins can view/update all
- **Motoristas**: Can view/update own profile; admins have full access
- **Embarcadores**: Can view/update own profile; motoristas can view public info
- **Fretes**: Public read for active fretes; only owner can modify
- **Documents**: Strict isolation - only owner and admins can access
- **Chat**: Only conversation participants can view/send messages
- **Notifications**: Users can only see their own notifications
- **Audit Logs**: Admin-only access

**Key Policies**:
- Anonymous users can view active fretes (public marketplace)
- Users cannot access other users' private data
- Admins have full access to all tables
- Immutable records (audit logs, clicks) cannot be updated

## Running Migrations

### Using Supabase CLI (Recommended)

```bash
# Link to your project
supabase link --project-ref your-project-ref

# Push all migrations
supabase db push

# Or push specific migration
supabase db push --file supabase/migrations/001_initial_schema.sql
```

### Manual Execution

1. Open Supabase Dashboard > SQL Editor
2. Copy content from migration file
3. Paste and execute
4. Repeat for each file in order (001, 002, 003)

## Verification

After running migrations, verify:

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';

-- Check extensions
SELECT * FROM pg_extension 
WHERE extname IN ('uuid-ossp', 'postgis');

-- Check functions
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_type = 'FUNCTION';

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- Check policies exist
SELECT tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public';
```

## Rollback

To rollback migrations (use with caution):

```sql
-- Drop all tables (will cascade to dependent objects)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_conversations CASCADE;
DROP TABLE IF EXISTS avaliacoes CASCADE;
DROP TABLE IF EXISTS frete_clicks CASCADE;
DROP TABLE IF EXISTS fretes CASCADE;
DROP TABLE IF EXISTS embarcadores CASCADE;
DROP TABLE IF EXISTS motoristas CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP FUNCTION IF EXISTS update_embarcador_rating CASCADE;
DROP FUNCTION IF EXISTS increment_frete_views CASCADE;
DROP FUNCTION IF EXISTS record_frete_click CASCADE;
DROP FUNCTION IF EXISTS find_nearby_fretes CASCADE;
DROP FUNCTION IF EXISTS calculate_distance CASCADE;
DROP FUNCTION IF EXISTS record_user_activity CASCADE;
DROP FUNCTION IF EXISTS get_online_users_count CASCADE;
DROP FUNCTION IF EXISTS get_platform_metrics CASCADE;
DROP FUNCTION IF EXISTS get_user_growth CASCADE;
DROP FUNCTION IF EXISTS get_frete_growth CASCADE;
DROP FUNCTION IF EXISTS get_unread_message_count CASCADE;
DROP FUNCTION IF EXISTS mark_messages_as_read CASCADE;
```

## Testing Migrations

### Test RLS Policies

```sql
-- Test as anonymous user (should see active fretes only)
SET ROLE anon;
SELECT * FROM fretes; -- Should only return active fretes
RESET ROLE;

-- Test document isolation
-- Create test users and verify they can't access each other's documents
```

### Test Functions

```sql
-- Test rating calculation
INSERT INTO avaliacoes (embarcador_id, motorista_id, rating) 
VALUES ('uuid1', 'uuid2', 5);
-- Check embarcador rating was updated

-- Test nearby fretes
SELECT * FROM find_nearby_fretes(
  ST_GeogFromText('POINT(-46.6333 -23.5505)'), -- São Paulo coordinates
  100 -- 100km radius
);

-- Test platform metrics
SELECT * FROM get_platform_metrics();
```

### 116_admin_cliente_360.sql
**Purpose**: Cliente 360 — Pesquisa Global + Visão 360 do Cliente (spec `admin-cliente-360`)

**Contents**:
- Creates `admin_user_notes` (Internal_Note: `user_id` CASCADE, `author_id` SET NULL, `body` CHECK 1..5000) + `updated_at` trigger + index
- Admin-only RLS on `admin_user_notes`: SELECT gated by `USER_NOTE_VIEW`; direct INSERT/UPDATE/DELETE denied (writes only via SECURITY DEFINER RPCs)
- Re-asserts `is_admin_with_permission` preserving the prior body (030 + 048 deny-list + 115 `FAQ_VIEW`); `USER_NOTE_VIEW`/`USER_NOTE_EDIT` granted by construction to SUPER_ADMIN/ADMIN only
- RPCs `SECURITY DEFINER`: `admin_global_search` (USER_VIEW), `admin_user_financial_history` (FINANCEIRO_VIEW), `admin_user_login_history` (USER_VIEW), `admin_user_note_create`/`_update`/`_delete` (USER_NOTE_EDIT)
- Reads only (never rewrites): `users`/`embarcadores`/`subscriptions`/`subscription_charges`/`financial_repasses`/`support_tickets`/`conversations`/`login_attempts`

**Key Features**:
- Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`), defensive `DO $check$`, commented `-- VERIFY` block
- Negative audit logs: `GLOBAL_SEARCH_VIEW_DENIED`/`FINANCEIRO_VIEW_DENIED`/`USER_VIEW_DENIED`/`USER_NOTE_VIEW_DENIED`; `permission_denied` precedence over input validation; Master_Admin (`Nexus_Vortex99`) immutable as note target
- Paired with documented `116_admin_cliente_360_rollback.sql` (not auto-applied)

### 117_admin_central_operacao.sql
**Purpose**: Central de Operação — Painel Operacional + Sistema de Alertas + Logs (spec `admin-central-operacao`)

**Contents**:
- Creates `system_alerts` (closed CHECK domains for `alert_type`/`severity`/`state`; PARTIAL unique index `uq_system_alerts_active_dedup` on `dedup_key` `WHERE state IN ('OPEN','ACKNOWLEDGED')` — at most one active alert per situation; list/type indexes; `operacao_touch_updated_at` trigger)
- Admin-only RLS on `system_alerts`: SELECT gated by `ALERT_VIEW`; direct INSERT/UPDATE/DELETE denied (`no_dml` USING/CHECK false — writes only via SECURITY DEFINER RPCs)
- Re-asserts `is_admin_with_permission` preserving the on-disk body (030 + 048 deny-list + 115 `FAQ_VIEW`); `ALERT_VIEW`/`ALERT_ACK`/`ALERT_RESOLVE`/`LOG_VIEW` recognized by construction (SUPER_ADMIN wildcard, ADMIN allow-all minus deny-list); `DASHBOARD_VIEW` reused
- RPCs `SECURITY DEFINER`: `admin_operations_metrics` (DASHBOARD_VIEW; 4 degradation sub-blocks; `USERS_ONLINE` always `available=false`), `admin_alerts_list` (ALERT_VIEW), `admin_logs_list` (LOG_VIEW; Log_Event_Map forward/reverse + fixed pt-BR summary), `admin_alerts_evaluate` (pg_cron service-role OR ALERT_VIEW; dedup via partial index `ON CONFLICT DO UPDATE last_seen_at` + auto-resolve), `admin_alert_acknowledge` (ALERT_ACK), `admin_alert_resolve` (ALERT_RESOLVE)
- `pg_cron` defensive `DO` block scheduling `SELECT public.admin_alerts_evaluate()` every minute (mirrors 092; no-op without the extension)
- Reads only (never rewrites): `users`/`subscriptions`/`support_tickets`/`whatsapp_*` (whatsapp is a SOFT dependency — absence degrades message KPIs/alerts at runtime)

**Key Features**:
- Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY/TRIGGER IF EXISTS`), defensive `DO $check$`, commented `-- VERIFY` block
- Audit by construction: `ALERT_GENERATED`/`ALERT_ACK_SKIPPED`/`ALERT_RESOLVE_SKIPPED` written inside the RPCs (success path); negative `DASHBOARD_VIEW_DENIED`/`ALERT_VIEW_DENIED`/`LOG_VIEW_DENIED`; positive `ALERT_ACK`/`ALERT_RESOLVE` written by the TS service layer. Evaluate-path audit inserts guarded by `IF v_caller IS NOT NULL` (cron path has no `auth.uid()`; `admin_audit_logs.admin_id` is NOT NULL)
- `permission_denied` precedence over input validation; Master_Admin (`Nexus_Vortex99`) immutable by construction (no `users` mutation)
- Paired with documented `117_admin_central_operacao_rollback.sql` (not auto-applied)

### 118_admin_ia_supervisora.sql
**Purpose**: IA Supervisora — Painel Inteligente (chat read-only) + Central de Diagnóstico + Insights/Anomalias + Resumo periódico (spec `admin-ia-supervisora`)

**Contents**:
- Creates `supervisor_diagnostics` (rolling idempotent record: `UNIQUE(dedup_key)` + `occurrence_count` + `first_seen_at`/`last_seen_at`; closed CHECK on `severity`; list/module indexes) and `supervisor_insights` (closed CHECK domains for `insight_type` `ANOMALY/SUGGESTION/SUMMARY/SECURITY`, `severity`, `state` `OPEN/ACKNOWLEDGED/DISMISSED` with DISMISSED terminal; PARTIAL unique index `uq_supervisor_insights_active_dedup` on `dedup_key` `WHERE state IN ('OPEN','ACKNOWLEDGED')` — at most one active insight per situation; list/type indexes); both with `supervisor_touch_updated_at` trigger
- Admin-only RLS on both tables: SELECT gated by `SUPERVISOR_VIEW`; direct INSERT/UPDATE/DELETE denied (`no_dml` USING/CHECK false — writes only via SECURITY DEFINER RPCs)
- Re-asserts `is_admin_with_permission` preserving the on-disk body (030 + 048 deny-list + 115 `FAQ_VIEW` + 116 `USER_NOTE_*` + 117 `ALERT_*`/`LOG_VIEW`); `SUPERVISOR_VIEW`/`SUPERVISOR_MANAGE` recognized by construction (SUPER_ADMIN wildcard, ADMIN allow-all minus deny-list; SUPORTE/FINANCEIRO/MODERADOR closed allowlists deny them)
- 8 RPCs `SECURITY DEFINER`: `supervisor_record_diagnostic` (service-role OR SUPERVISOR_VIEW; rolling `ON CONFLICT(dedup_key) DO UPDATE occurrence_count++`; `detail` arrives pre-sanitized from the service), `supervisor_diagnostics_list`/`supervisor_insights_list` (SUPERVISOR_VIEW; `{items,total}`), `supervisor_chat_context` (SUPERVISOR_VIEW; reuses `admin_operations_metrics(300)` + counts, aggregates only — no PII), `supervisor_evaluate` (pg_cron service-role OR SUPERVISOR_VIEW; opens ANOMALY from recurrent diagnostics via partial-index dedup + auto-dismiss extinct anomalies, `dismissed_by NULL`), `supervisor_generate_summary` (service-role OR SUPERVISOR_VIEW; SUMMARY insight idempotent per `'SUMMARY:<period>:<bucket>'` window), `supervisor_insight_acknowledge`/`supervisor_insight_dismiss` (SUPERVISOR_MANAGE; OPEN→ACKNOWLEDGED→DISMISSED with optimistic `expected_updated_at` + `STALE_VERSION`; `INVALID_STATE_TRANSITION` on ack of DISMISSED; `_SKIPPED` idempotency)
- `pg_cron` defensive `DO` block scheduling `supervisor_evaluate()` every 5 min + `supervisor_generate_summary('daily')` at 00:05 (mirrors 092/117; no-op without the extension)
- Reads only (never rewrites): `users`/`subscriptions`/`support_tickets`/`system_alerts` + the 117 metrics bundle; notifications-hub (041) and admin-assistant (047, Provider_Abstraction + Vault key) are SOFT dependencies — absence degrades proactive notifications / the chat at runtime. The IA is **read-only by design** (observes/answers/suggests/notifies — never an automatic destructive action)

**Key Features**:
- Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY/TRIGGER IF EXISTS`), defensive `DO $check$` (hard deps 030/117) + `DO $soft$` (041), commented `-- VERIFY` block
- Audit by construction: `SUPERVISOR_DIAGNOSTIC_RECORDED`/`SUPERVISOR_INSIGHT_GENERATED`/`*_ACK_SKIPPED`/`*_DISMISS_SKIPPED` written inside the RPCs (success path); negative `SUPERVISOR_VIEW_DENIED`; positive `SUPERVISOR_INSIGHT_ACK`/`SUPERVISOR_INSIGHT_DISMISS` written by the TS service layer. Cron-path audit inserts guarded by `IF v_caller IS NOT NULL` (cron has no `auth.uid()`; `admin_audit_logs.admin_id` is NOT NULL)
- `permission_denied` precedence over input validation; `detail` never carries PII/secrets (sanitized in the service before persisting); Master_Admin (`Nexus_Vortex99`) immutable by construction (no `users` mutation)
- Paired with documented `118_admin_ia_supervisora_rollback.sql` (not auto-applied)

### 119_supervisor_chat_history.sql
**Purpose**: Histórico de conversas do chat da IA Supervisora — persiste sessões + mensagens e lista as conversas na lateral (spec `supervisor-chat-history`, complementa 118)

**Contents**:
- Creates `supervisor_chat_sessions` (conversa: `admin_id` dono CASCADE, `title` CHECK 1..120, timestamps) + `supervisor_chat_messages` (`session_id` CASCADE, `role` CHECK `user`/`ai`, `content` CHECK 1..8000); índices `(admin_id, updated_at DESC)` e `(session_id, created_at ASC)`; reusa o trigger `supervisor_touch_updated_at` (118)
- RLS admin-only **POR DONO**: SELECT gated por `SUPERVISOR_VIEW` **AND** `admin_id = auth.uid()` (mensagens via `EXISTS` na sessão do dono); `no_dml` (escrita só via RPC)
- Reusa a ação RBAC `SUPERVISOR_VIEW` (sem nova ação): gating em `is_admin_with_permission` (118)
- 6 RPCs `SECURITY DEFINER`: `supervisor_chat_session_create` (título derivado no client), `supervisor_chat_sessions_list` (só do dono), `supervisor_chat_messages_list` (valida posse; sessão alheia/inexistente ⇒ `[]`), `supervisor_chat_message_append` (valida posse + role + content 1..8000; toca `updated_at`; content chega pré-sanitizado do service), `supervisor_chat_session_rename` (do dono; não-dono ⇒ skipped), `supervisor_chat_session_delete` (idempotente `ALREADY_GONE`; CASCADE)
- Persistência **dirigida pelo frontend**: a página chama `append` após a pergunta e após a resposta — **a edge function `ia-supervisor` NÃO muda** (sem redeploy)

**Key Features**:
- Idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`), defensive `DO $check$` (030 + 118), commented `-- VERIFY` block
- Audit by construction: `SUPERVISOR_CHAT_SESSION_CREATED`/`_DELETED` gravados nas RPCs (guarded `IF v_caller IS NOT NULL`); negative `SUPERVISOR_VIEW_DENIED`
- `permission_denied` precedence; `content`/`title` nunca carregam PII (sanitizados no service via `sanitizeSupervisorText` antes de persistir)
- Paired with documented `119_supervisor_chat_history_rollback.sql` (not auto-applied)

### 124_admin_rastreamento_inteligente.sql
**Purpose**: Rastreamento Inteligente (PatGo) — aba `/admin/rastreamento` que rastreia a jornada do usuário (site/dashboard/app), classifica causa de abandono, calcula score de risco, mostra funil de conversão + lista de usuários em risco e dispara recuperação por WhatsApp sob um motor de regras + anti-spam (spec `admin-rastreamento-inteligente`). Pipeline: Rastreamento → Motor de Regras → IA → Ação.

**Contents**:
- Creates 4 tables (closed CHECK domains): `journey_events` (`event_type` 24-valor / `surface` 3-valor; `user_id` SET NULL OU `visitor_id`; índices user/visitor/type-time), `tracking_visitor_identities` (correlação `visitor_id`→`user_id`), `recovery_attempts` (PARTIAL unique `uq_recovery_active_per_user WHERE active` — ≤1 ativa por usuário; PARTIAL unique `uq_recovery_per_critical_event` — 1 por `trigger_event_id`; FK `dispatch_job_id`→`whatsapp_dispatch_jobs` SET NULL), `tracking_ai_config` (singleton; SEM segredo) + trigger `tracking_touch_updated_at`
- Admin-only RLS em todas as tabelas: SELECT gated por `RASTREAMENTO_VIEW`; DML direto negado (`no_dml` USING/CHECK false — escrita só via SECURITY DEFINER RPCs); `journey_events` **sem** policy de insert (ingestão só pela RPC anônima write-only); nenhuma leitura a `anon`; nenhum acesso cruzado entre usuários
- Re-asserts `is_admin_with_permission` preservando o corpo on-disk vigente (030 + 047/048 deny-list + 115 `FAQ_VIEW`); `RASTREAMENTO_VIEW`/`RASTREAMENTO_MANAGE` reconhecidas por construção (SUPER_ADMIN wildcard, ADMIN allow-all menos deny-list; SUPORTE/FINANCEIRO/MODERADOR negam)
- Helpers `IMMUTABLE` (espelho SQL do núcleo puro TS): `tracking_mask_phone`, `tracking_risk_score` (pesos 2/8/6/5/15 clamp [0,100]), `tracking_risk_band` (24/49/74), `tracking_abandonment_cause` (precedência total), `tracking_risk_category`, `tracking_resolve_scenario`; `STABLE tracking_recovery_decision` (Anti_Spam_Guard: CONCURRENT > MIN_DELAY > DUPLICATE > WITHIN_COOLDOWN 72h > MAX_PER_WINDOW 24h/1 > DISPATCH)
- 13 RPCs `SECURITY DEFINER`: `rpc_tracking_ingest_event` (anon+auth, write-only, valida domínio fechado, rate-limit, retorna só `{inserted,rejected,throttled}` — anti-enumeração), `rpc_tracking_correlate_visitor` (auth), leituras gated `_timeline`/`_at_risk_list` (page_size ∈ {10,50,100} + ILIKE escapado)/`_funnel`/`_recovery_performance`/`_get_config`, mutações `_mark_contacted` (idempotente `_SKIPPED ALREADY_CONTACTED` + `STALE_VERSION`)/`_trigger_recovery` (autoridade do motor; SUPPRESS⇒`RECOVERY_TRIGGER_SKIPPED`)/`_record_dispatch` (registra Recovery_Attempt CONTACTED após delegação — honra Req 9.12)/`_update_ai_config` (`STALE_VERSION`), `rpc_tracking_scan_recovery` (service_role/pg_cron; `NEW_SIGNUP_WELCOME` + `RECOVERY_AUTO_DISPATCH`), `rpc_tracking_publish_alert` (publica `ABANDONMENT_SPIKE` em `system_alerts`)
- **Ampliação ADITIVA e não-destrutiva** de `system_alerts.alert_type` (DROP de qualquer CHECK de `alert_type` + ADD com a união dos valores de 117 + `ABANDONMENT_SPIKE`) — confirmada pelo dono; revertida no rollback. Nenhuma tabela/RPC/policy de 092–118 é recriada
- `pg_cron` defensivo agendando `rpc_tracking_scan_recovery()` a cada 5 min (no-op sem a extensão)
- Reusa (não recria): envio (whatsapp-automation 092–114), personalização de IA + Vault (admin-assistant 047), handoff (suporte-inteligente 115), identificação/navegação (admin-cliente-360 116), alertas/logs (central-operacao 117 + ia-supervisora 118)

**Key Features**:
- Idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY/TRIGGER IF EXISTS`, `ON CONFLICT DO NOTHING`), `DO $check$` defensivo (hard: 030/users/092/117; soft NOTICE: 047/116), bloco `-- VERIFY` comentado
- Audit by construction: `TRACKING_CONTACT_MARK_SKIPPED`/`RECOVERY_TRIGGER_SKIPPED`/`RECOVERY_AUTO_DISPATCH` gravados nas RPCs (success path); negative `RASTREAMENTO_VIEW_DENIED`; positivos `TRACKING_CONTACT_MARK`/`RECOVERY_TRIGGER`/`TRACKING_AI_CONFIG_UPDATE` pelo TS service layer
- `permission_denied` precedence; `payload`/`detail`/contexto de IA sem PII bruta; Master_Admin (`Nexus_Vortex99`) imutável (guarda antes de qualquer touch que referencie `users`)
- Paired with documented `124_admin_rastreamento_inteligente_rollback.sql` (not auto-applied; restaura o CHECK original de `system_alerts.alert_type`)

## Migration Best Practices

1. **Always backup** before running migrations in production
2. **Test migrations** in development environment first
3. **Run migrations in order** (001, 002, 003)
4. **Verify each migration** before proceeding to next
5. **Monitor performance** after adding indexes
6. **Review RLS policies** to ensure proper data isolation

## Troubleshooting

**Error: Extension "postgis" not available**
- Solution: PostGIS should be available in Supabase by default. Contact support if not.

**Error: Permission denied**
- Solution: Ensure you're using the service role key for migrations, not anon key.

**Error: Relation already exists**
- Solution: Migration was already run. Check existing schema or rollback first.

**RLS blocking queries**
- Solution: Verify you're authenticated with correct user type. Check policy conditions.

## Additional Resources

- [Supabase Database Documentation](https://supabase.com/docs/guides/database)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [PostGIS Documentation](https://postgis.net/documentation/)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
