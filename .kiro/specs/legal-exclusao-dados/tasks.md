# Implementation Plan

> Feature 4 — Exclusão de Dados pelo Usuário (FreteGO)

## Overview

> ⚠️ **Decisão de produto (atualizada):** a exclusão é **IMEDIATA e
> irreversível** (não há janela de 30 dias, cancelamento, Edge de email nem
> painel admin de execução). Ao excluir, gravamos o **hash (sha256) do CPF e do
> telefone** numa blocklist anti-reuso: quem tentar recriar conta com o mesmo
> CPF/telefone é bloqueado e orientado a **falar com o suporte** (botão que abre
> ticket). O plano original (agendamento + admin) foi substituído por este.

Fluxo: RPC única `rpc_delete_my_account` (SECURITY DEFINER) que grava a
blocklist, apaga o Storage, `public.users` (cascata) e `auth.users` numa
transação. Anti-reuso por trigger `BEFORE INSERT` + pré-check público no signup.

## Tasks

- [x] 1. Migration 065: blocklist anti-reuso + RPC de exclusão + trigger
  - Tabela `account_deletion_blocklist` (cpf_hash, phone_hash, reason) com RLS
    deny-all; helpers `legal_normalize_identifier`/`legal_hash_identifier`
    (sha256 via `extensions.digest`); `is_identifier_blocked(type,value)`
    (anon+authenticated); trigger `users_block_deleted_reuse` (BEFORE INSERT);
    `rpc_delete_my_account()` (grava blocklist → apaga storage → public.users →
    auth.users; Master Admin protegido; idempotente). Par `_rollback.sql`.
  - _Requirements: 2.x (exclusão), 4.x (master), 5.x (tabela/RLS)_

- [x] 2. Serviço `services/dataDeletion.ts`
  - `deleteMyAccount()` chama a RPC, encerra a sessão (signOut) em sucesso e
    mapeia erros (`MASTER_PROTECTED`, `permission_denied`→UNAUTHENTICATED,
    genérico→UNKNOWN) para `DataDeletionError` com mensagens pt-BR.
  - _Requirements: 1.5, 6.1_

- [x] 3. UI de exclusão no perfil/configurações
  - Seção "Privacidade" em `ConfiguracoesPage` com botão destrutivo →
    `AccountDeletionModal` (escopo + irreversibilidade + aviso de anti-reuso;
    confirmação digitando EXCLUIR; ESC fecha). Em sucesso: logout + redirect.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 4. Anti-reuso no cadastro (orienta suporte)
  - `auth.ts`: pré-check `is_identifier_blocked` (fail-open) + mapeamento do erro
    do trigger `account_blocked` → `ACCOUNT_BLOCKED_MESSAGE` (código
    `ACCOUNT_BLOCKED`). `RegisterForm` exibe o botão "Falar com o suporte"
    (`/contato`) quando o código é `ACCOUNT_BLOCKED`.
  - _Requirements: anti-reuso de CPF/telefone_

- [x] 5. Testes e validação
  - `dataDeletion.test.ts` (sucesso/signOut/idempotência + mapeamento de erros);
    `antiReuseNormalization.property.test.ts` (normalização estável a
    formatação/DDI — espelho do SQL). `npx tsc` + `npm run build` verdes.
  - _Requirements: 2.x, 4.x_

## Notes

- Exclusão imediata: sem `data_deletion_requests`, sem `scheduled_for`, sem
  Edge de email, sem painel admin de execução (diferente da spec original).
- Anti-reuso guarda apenas **hashes** (sha256) — não armazena CPF/telefone em
  claro na blocklist (privacidade por design).
- Master Admin (`Nexus_Vortex99`) nunca pode se autoexcluir (abortado na RPC).
- Migrations só entram em vigor no push (Supabase aplica 064 e 065).
