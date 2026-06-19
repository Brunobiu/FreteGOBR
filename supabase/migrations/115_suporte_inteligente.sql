-- ============================================================================
-- Migration 115: Suporte_Inteligente — Central de Suporte Inteligente
-- ============================================================================
-- Spec: .kiro/specs/suporte-inteligente/{requirements,design,tasks}.md
--
-- Parte 1 (schema / RBAC / RLS / trigger). As RPCs SECURITY DEFINER do console
-- ficam na migration 115b (115b_suporte_inteligente_rpcs.sql), conforme o
-- design (divisao 115 = schema, 115b = RPCs).
--
-- ENTREGA (tasks 1.1 + 1.2 do tasks.md):
--   - Amplifica support_tickets de forma ADITIVA e COMPATIVEL: dominio de
--     `status` 3 -> 5 estados (open, in_progress, waiting_customer, resolved,
--     closed), colunas responder_mode / priority_level / handoff_at /
--     returned_to_ai_at, indices novos (Req 3.1, 3.2, 13.3, 13.4).
--   - support_ticket_messages.author_kind ('user'|'admin'|'ai') + backfill
--     nao destrutivo a partir de is_admin (Req 6.4).
--   - support_kb_entries (Base de Conhecimento / FAQ) (Req 5.1).
--   - support_ai_config (singleton; SEM segredos — a chave do provedor fica no
--     Vault da Provider_Abstraction da migration 047) (Req 6.8).
--   - RBAC: re-assere is_admin_with_permission preservando integralmente o
--     corpo vigente (047/048) e concedendo FAQ_VIEW ao papel SUPORTE; FAQ_EDIT
--     e SUPORTE_AI_CONFIG sao concedidas a ADMIN (allow-all, fora da deny-list)
--     e SUPER_ADMIN (wildcard) (Req 4.2, 4.3, 4.4).
--   - RLS em support_kb_entries e support_ai_config; trg_set_updated_at (041)
--     anexado as duas (Req 11.1, 11.2, 11.5).
--   - Trigger AFTER INSERT que reabre (waiting_customer/resolved -> in_progress)
--     quando o CLIENTE envia nova mensagem (Req 3.10).
--
-- DEPENDENCIAS (validadas no DO $check$):
--   - 030 (admin-foundation): is_admin_with_permission, admin_audit_logs.
--   - 041 (notifications-hub): support_tickets, support_ticket_messages,
--     trg_set_updated_at.
--   - 047 (admin-assistant): assistant_config (Provider_Abstraction reusada
--     pela Edge support-ai-reply; aqui apenas validamos presenca).
--
-- IDEMPOTENTE (admin-patterns Sec. 9): ADD COLUMN IF NOT EXISTS, CREATE TABLE
--   IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--   DROP ... IF EXISTS antes de CREATE, INSERT ... ON CONFLICT DO NOTHING.
--   Envolvida em BEGIN; ... COMMIT;. Par documentado (nao auto-aplicado):
--   115_suporte_inteligente_rollback.sql.
--
-- Idioma: identifiers / action codes / error codes em ingles (UPPER_SNAKE);
--   mensagens user-facing pt-BR moram no client.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Validacoes defensivas: dependencias precisam estar aplicadas
-- ────────────────────────────────────────────────────────────────────────────

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                  WHERE routine_schema='public' AND routine_name='is_admin_with_permission') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='admin_audit_logs') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='support_tickets') THEN
    RAISE EXCEPTION 'Migration 041 (notifications-hub) nao aplicada: support_tickets ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='support_ticket_messages') THEN
    RAISE EXCEPTION 'Migration 041 (notifications-hub) nao aplicada: support_ticket_messages ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='trg_set_updated_at') THEN
    RAISE EXCEPTION 'Migration 041 (notifications-hub) nao aplicada: trg_set_updated_at ausente';
  END IF;

  -- Provider_Abstraction (admin-assistant 047): assistant_config (Active_Provider)
  -- + Vault. A Edge support-ai-reply reusa essa camada; aqui so validamos presenca.
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='assistant_config') THEN
    RAISE EXCEPTION 'Migration 047 (admin-assistant) nao aplicada: assistant_config ausente (Provider_Abstraction)';
  END IF;
END
$check$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Amplificacao de support_tickets (aditiva e compativel — Req 3.2, 13.3, 13.4)
-- ────────────────────────────────────────────────────────────────────────────

-- 1.1 Colunas novas com defaults compativeis (nao exigem reescrita das linhas
--     existentes). responder_mode inicia em 'ai' (caminho IA-primeiro);
--     priority_level inicia em 1 (Nivel 1 — IA resolve; o Priority_Classifier
--     reclassifica deterministicamente para 2/3 assim que o Answerable_Signal/
--     Critical_Category e conhecido).
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS responder_mode    text        NOT NULL DEFAULT 'ai'
    CHECK (responder_mode IN ('ai','human'));
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS priority_level    smallint    NOT NULL DEFAULT 1
    CHECK (priority_level BETWEEN 1 AND 3);
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS handoff_at        timestamptz NULL;
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS returned_to_ai_at timestamptz NULL;

-- 1.2 Amplificacao compativel do dominio de status (3 -> 5 estados).
--     Drop-then-add com nome estavel => idempotente em reaplicacao. As linhas
--     existentes em open/in_progress/resolved permanecem validas; a checagem
--     apenas ACRESCENTA waiting_customer e closed (Req 3.2). Nenhuma reescrita
--     destrutiva.
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_status_check;
ALTER TABLE support_tickets ADD  CONSTRAINT support_tickets_status_check
  CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed'));

CREATE INDEX IF NOT EXISTS idx_tickets_responder_mode
  ON support_tickets (responder_mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_priority_level
  ON support_tickets (priority_level, created_at DESC);

COMMENT ON COLUMN support_tickets.responder_mode IS
  'Responder_Mode vigente do atendimento: ai | human. Garante um unico responsavel por vez (exclusao mutua IA x humano — suporte-inteligente 115).';
COMMENT ON COLUMN support_tickets.priority_level IS
  'Priority_Level 1..3 (1=IA resolve, 2=handoff humano, 3=critico). Derivado pelo Priority_Classifier (suporte-inteligente 115).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Origem da mensagem em support_ticket_messages (Req 6.4) — escolha compativel
-- ────────────────────────────────────────────────────────────────────────────
-- A tabela ja tem is_admin boolean e author_id uuid NULL. Para distinguir
-- IA vs humano sem quebrar o schema, adiciona-se author_kind com default
-- compativel e backfill NAO destrutivo a partir do is_admin existente.
ALTER TABLE support_ticket_messages
  ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'user'
    CHECK (author_kind IN ('user','admin','ai'));

-- Backfill unico e nao destrutivo: mensagens de admin existentes (is_admin=true)
-- viram 'admin'; as demais permanecem 'user'. So toca linhas ainda em 'user'
-- com is_admin=true (idempotente em reaplicacao).
UPDATE support_ticket_messages
   SET author_kind = 'admin'
 WHERE author_kind = 'user' AND is_admin = true;

COMMENT ON COLUMN support_ticket_messages.author_kind IS
  'Origem da mensagem: user (cliente) | admin (humano) | ai (Support_AI). Mensagem de IA usa author_kind=ai, is_admin=true, author_id=NULL (suporte-inteligente 115).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Base de Conhecimento (FAQ) — support_kb_entries (Req 5.1)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_kb_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question          text NOT NULL CHECK (char_length(question) BETWEEN 3 AND 300),
  answer            text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 5000),
  category          text NOT NULL
    CHECK (category IN ('geral','financeiro','tecnico','administrativo','conta','planos')),
  publication_state text NOT NULL DEFAULT 'rascunho'
    CHECK (publication_state IN ('rascunho','publicada')),
  created_by        uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_category
  ON support_kb_entries (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_publication
  ON support_kb_entries (publication_state, created_at DESC);

ALTER TABLE support_kb_entries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE support_kb_entries IS
  'Base de Conhecimento (FAQ). A Support_AI consome EXCLUSIVAMENTE entradas com publication_state=publicada (Req 5.7). Acesso gated por FAQ_VIEW (leitura) / FAQ_EDIT (mutacao).';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Configuracao da Support_AI — support_ai_config (singleton; SEM segredos)
-- ────────────────────────────────────────────────────────────────────────────
-- Sem coluna de segredo: a chave do provedor permanece no Vault da
-- Provider_Abstraction (assistant_provider_key_<provider>), lida apenas
-- server-side pela Edge support-ai-reply (Req 6.3).
CREATE TABLE IF NOT EXISTS support_ai_config (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),   -- single-row
  enabled              boolean NOT NULL DEFAULT true,
  confidence_threshold numeric(3,2) NOT NULL DEFAULT 0.70
    CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  support_model        text NOT NULL DEFAULT 'claude-3-5-sonnet-latest',
  updated_at           timestamptz NOT NULL DEFAULT NOW()
);

-- Seed idempotente da linha singleton.
INSERT INTO support_ai_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE support_ai_config ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE support_ai_config IS
  'Config singleton da Support_AI (enabled, confidence_threshold [0,1], support_model). SEM segredos — a chave do provedor fica no Vault (suporte-inteligente 115).';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RBAC — re-assercao de is_admin_with_permission (Req 4.2, 4.3, 4.4)
-- ────────────────────────────────────────────────────────────────────────────
-- Recriacao idempotente (CREATE OR REPLACE) que PRESERVA INTEGRALMENTE o corpo
-- vigente em producao (047/048) e acrescenta apenas o grant FAQ_VIEW ao papel
-- SUPORTE. Paridade 1:1 com src/services/admin/permissions.ts:
--   - SUPER_ADMIN  => wildcard (recebe FAQ_VIEW/FAQ_EDIT/SUPORTE_AI_CONFIG).
--   - ADMIN        => allow-all menos deny-list. FAQ_EDIT/SUPORTE_AI_CONFIG NAO
--                     entram na deny-list => ADMIN os recebe por construcao.
--                     (ASSISTANT_VIEW/ASSISTANT_EDIT permanecem negadas.)
--   - SUPORTE      => allowlist + FAQ_VIEW (NAO recebe FAQ_EDIT nem
--                     SUPORTE_AI_CONFIG).
--   - FINANCEIRO / MODERADOR => allowlists fechadas, sem nenhuma acao nova.
-- Caller anonimo (auth.uid() nulo) nao possui linha em `active` => false
-- (deny-by-default preservado, Req 4.5, 4.6). Mantem SECURITY DEFINER,
-- SET search_path = public e os grants identicos a definicao anterior.
CREATE OR REPLACE FUNCTION is_admin_with_permission(p_action text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  WITH active AS (
    SELECT role
    FROM admin_roles
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1 FROM active a
    WHERE
      a.role = 'SUPER_ADMIN'
      OR (a.role = 'ADMIN' AND p_action NOT IN
           ('USER_DELETE','ADMIN_ROLE_GRANT','ADMIN_ROLE_REVOKE',
            'ASSISTANT_VIEW','ASSISTANT_EDIT'))
      OR (a.role = 'FINANCEIRO' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FINANCEIRO_VIEW','FINANCEIRO_EDIT','AUDIT_VIEW'))
      OR (a.role = 'SUPORTE' AND p_action IN
           ('USER_VIEW','USER_TOGGLE_ACTIVE','FRETE_VIEW',
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW','FAQ_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_EDIT'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RLS — support_kb_entries e support_ai_config (Req 11.1, 11.2, 11.5)
-- ────────────────────────────────────────────────────────────────────────────
-- support_tickets / support_ticket_messages MANTEM as policies de 041 (owner
-- via user_id=auth.uid() OU admin SUPORTE_VIEW; UPDATE admin via SUPORTE_REPLY).
-- Mutacoes de IA/handoff/status passam por RPCs SECURITY DEFINER (115b), que
-- nao dependem das policies de UPDATE direto.

-- 6.1 support_kb_entries: SELECT sob FAQ_VIEW; mutacao sob FAQ_EDIT.
DROP POLICY IF EXISTS kb_select_view ON support_kb_entries;
CREATE POLICY kb_select_view ON support_kb_entries
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('FAQ_VIEW'));

DROP POLICY IF EXISTS kb_mutate_edit ON support_kb_entries;
CREATE POLICY kb_mutate_edit ON support_kb_entries
  FOR ALL TO authenticated
  USING (is_admin_with_permission('FAQ_EDIT'))
  WITH CHECK (is_admin_with_permission('FAQ_EDIT'));

-- 6.2 support_ai_config: SELECT sob SUPORTE_VIEW; mutacao sob SUPORTE_AI_CONFIG.
DROP POLICY IF EXISTS ai_config_select ON support_ai_config;
CREATE POLICY ai_config_select ON support_ai_config
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('SUPORTE_VIEW'));

DROP POLICY IF EXISTS ai_config_mutate ON support_ai_config;
CREATE POLICY ai_config_mutate ON support_ai_config
  FOR ALL TO authenticated
  USING (is_admin_with_permission('SUPORTE_AI_CONFIG'))
  WITH CHECK (is_admin_with_permission('SUPORTE_AI_CONFIG'));

-- 6.3 trg_set_updated_at (041) anexado as duas tabelas novas, para manter
--     updated_at no versionamento otimista (admin-patterns Sec. 3).
DROP TRIGGER IF EXISTS support_kb_entries_set_updated_at ON support_kb_entries;
CREATE TRIGGER support_kb_entries_set_updated_at
  BEFORE UPDATE ON support_kb_entries
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS support_ai_config_set_updated_at ON support_ai_config;
CREATE TRIGGER support_ai_config_set_updated_at
  BEFORE UPDATE ON support_ai_config
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Trigger: reabrir atendimento quando o CLIENTE responde (Req 3.10)
-- ────────────────────────────────────────────────────────────────────────────
-- AFTER INSERT em support_ticket_messages: quando o cliente envia nova mensagem
-- (author_kind='user' e is_admin=false) e o ticket esta em waiting_customer ou
-- resolved, transiciona para in_progress (transicoes permitidas pela maquina de
-- estados). NAO toca tickets closed (terminal). SECURITY DEFINER porque o
-- cliente nao tem permissao de UPDATE direto em support_tickets (a RLS de 041
-- so permite UPDATE a admin SUPORTE_REPLY). Idempotente e escopado ao proprio
-- ticket. O guard is_admin=false garante que respostas de admin/IA (que tambem
-- poderiam, por algum caminho legado, vir sem author_kind explicito) jamais
-- disparem a reabertura.
CREATE OR REPLACE FUNCTION support_ticket_reopen_on_user_msg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE support_tickets
     SET status = 'in_progress'
   WHERE id = NEW.ticket_id
     AND status IN ('waiting_customer','resolved');
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS support_ticket_messages_reopen_on_user_msg ON support_ticket_messages;
CREATE TRIGGER support_ticket_messages_reopen_on_user_msg
  AFTER INSERT ON support_ticket_messages
  FOR EACH ROW
  WHEN (NEW.author_kind = 'user' AND NEW.is_admin = false)
  EXECUTE FUNCTION support_ticket_reopen_on_user_msg();

COMMENT ON FUNCTION support_ticket_reopen_on_user_msg() IS
  'Reabre (waiting_customer/resolved -> in_progress) quando o cliente envia nova mensagem. Nao toca closed. (suporte-inteligente 115, Req 3.10).';

COMMIT;

-- ============================================================================
-- VERIFY (smoke manual — comentado; nao executa no push)
-- ============================================================================
/*
-- Dominio de status ampliado para 5 estados:
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname = 'support_tickets_status_check';

-- Colunas novas em support_tickets:
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name='support_tickets'
   AND column_name IN ('responder_mode','priority_level','handoff_at','returned_to_ai_at')
 ORDER BY column_name;

-- author_kind + backfill:
SELECT author_kind, is_admin, count(*) FROM support_ticket_messages
 GROUP BY author_kind, is_admin ORDER BY author_kind;

-- Tabelas novas + RLS habilitada:
SELECT relname, relrowsecurity FROM pg_class
 WHERE relname IN ('support_kb_entries','support_ai_config');

-- Singleton seed:
SELECT * FROM support_ai_config;

-- RBAC reconhece as acoes novas (espera-se que SUPORTE tenha FAQ_VIEW e nao
-- FAQ_EDIT; rodar autenticado como cada papel em teste de integracao):
--   SELECT is_admin_with_permission('FAQ_VIEW'), is_admin_with_permission('FAQ_EDIT');

-- Policies das tabelas novas:
SELECT polname, polcmd FROM pg_policy
 WHERE polrelid IN ('support_kb_entries'::regclass,'support_ai_config'::regclass)
 ORDER BY polname;
*/
