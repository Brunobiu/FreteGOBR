$path = '.kiro/specs/admin-financeiro/requirements.md'
$content = @"
# Requirements Document

## Introduction

Esta spec entrega o modulo Financeiro do painel administrativo do FreteGO, acessivel em /admin/financeiro. O modulo se senta sobre as fundacoes ja em producao: admin-foundation (RBAC com 5 papeis, MFA, audit-by-construction, sessao isolada, Stealth_404, RPC is_admin_with_permission, executeAdminMutation, logAdminAction, migration 030), admin-users (gestao de usuarios, padrao de bulk com Promise.allSettled + concorrencia 5, padrao de versionamento otimista por updated_at, padrao CSV BOM UTF-8 + ; + RFC 4180 + truncamento 10000), admin-fretes (gestao de fretes), admin-blacklist (lista negra) e admin-dashboard (RPC agregadora, gating server-side, action DASHBOARD_VIEW, migration 036).

## Glossary

- **Admin_Panel**: Painel administrativo entregue em admin-foundation, acessivel em /admin/*.
- **financial_settings**: Tabela com snapshot historico de regras de comissao.
- **financial_repasses**: Tabela 1:1 com fretes encerrados, snapshot imutavel.
- **compute_commission_value**: Funcao SQL pura IMMUTABLE, paritaria com helper TS computeCommission.
- **on_frete_close_create_repasse**: Trigger AFTER UPDATE em fretes.
- **financial_proofs**: Bucket privado de comprovantes.
- **Migration_037**: supabase/migrations/037_admin_financeiro.sql.

## Requirements

### Requirement 1: Rotas /admin/financeiro

**User Story:** Como admin com FINANCEIRO_VIEW, quero acessar /admin/financeiro para ver o modulo financeiro.

#### Acceptance Criteria

1. THE Admin_Panel SHALL registrar a rota /admin/financeiro renderizando Financeiro_List_Page.
2. THE Admin_Panel SHALL registrar a rota /admin/financeiro/configuracoes renderizando Financeiro_Configuracoes_Page.
3. THE Admin_Panel SHALL registrar a rota /admin/financeiro/:id renderizando Financeiro_Detail_Page.
4. WHEN um admin sem FINANCEIRO_VIEW acessa /admin/financeiro, THE AdminGuard SHALL renderizar Stealth_404.
"@
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
Write-Output ('OK. New length: ' + (Get-Item $path).Length)
