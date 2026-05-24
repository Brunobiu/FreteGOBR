-- ============================================================================
-- Script: Reset completo (DESTRUTIVO)
-- ============================================================================
-- Apaga TODOS os usuários (motoristas, embarcadores e admins comuns), todos
-- os fretes e todos os dados associados. Use APENAS no banco de testes.
--
-- Tabelas preservadas (estruturais):
--   - schemas, migrations, RLS, triggers, funções
--
-- Apagado:
--   - auth.users (login)
--   - public.users + cascatas: motoristas, embarcadores, documentos,
--     fretes, mensagens, conversations, notifications, frete_likes,
--     motorista_pis, motorista_references, verification_codes, audit_logs
--   - storage.objects nos buckets `documents`, `chat-attachments`,
--     `company-logos`
--
-- Como rodar:
--   1. Abra o SQL Editor do Supabase Studio.
--   2. Cole o script todo.
--   3. Confirme antes de executar — não dá pra desfazer.
-- ============================================================================

BEGIN;

-- 1. Storage: limpa arquivos dos buckets do app.
--
-- O Supabase recente bloqueia DELETE direto em `storage.objects` via
-- trigger `protect_delete`. Tentamos desabilitar; se o seu papel não
-- tiver permissão, pula essa etapa silenciosamente — os arquivos órfãos
-- não impedem o reset (pode limpar depois pelo painel: Storage → bucket
-- → Select all → Delete).
DO $cleanup$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE storage.objects DISABLE TRIGGER protect_delete';
    DELETE FROM storage.objects WHERE bucket_id IN (
      'documents', 'chat-attachments', 'company-logos'
    );
    EXECUTE 'ALTER TABLE storage.objects ENABLE TRIGGER protect_delete';
  EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
    RAISE NOTICE 'Sem permissão pra limpar storage. Apague os arquivos pelo painel Storage do Supabase Studio.';
  END;
END
$cleanup$;

-- 2. Tabelas de domínio. A ordem importa quando não há ON DELETE CASCADE.
-- Cada DELETE roda dentro de um bloco DO pra que tabelas ausentes
-- (criadas em migrations posteriores ou que não foram aplicadas) não
-- abortem o script.

DO $del$
DECLARE
  v_tables TEXT[] := ARRAY[
    'frete_likes',
    'messages',
    'conversations',
    'chat_messages',
    'chat_conversations',
    'notifications',
    'frete_clicks',
    'fretes',
    'motorista_references',
    'motorista_pis',
    'verification_codes',
    'documents',
    'motoristas',
    'embarcadores',
    'audit_logs',
    'login_attempts',
    'account_lockouts',
    'users'
  ];
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = v_table
    ) THEN
      EXECUTE format('DELETE FROM public.%I', v_table);
      RAISE NOTICE 'Limpa: %', v_table;
    ELSE
      RAISE NOTICE 'Pulada (não existe): %', v_table;
    END IF;
  END LOOP;
END
$del$;

-- 3. auth.users — só funciona com privilégio elevado (Studio tem).
DELETE FROM auth.users;

COMMIT;

-- ============================================================================
-- CONFERÊNCIA
-- ============================================================================
SELECT 'auth.users' AS tabela, count(*) AS total FROM auth.users
UNION ALL SELECT 'public.users', count(*) FROM users
UNION ALL SELECT 'fretes',       count(*) FROM fretes;
