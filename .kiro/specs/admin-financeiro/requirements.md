# Requirements Document

## Introduction

Esta spec entrega o modulo Financeiro do painel administrativo do FreteGO, acessivel em /admin/financeiro. O modulo se senta sobre as fundacoes ja em producao: admin-foundation (RBAC com 5 papeis, MFA, audit-by-construction, Stealth_404, executeAdminMutation, migration 030), admin-users (versionamento otimista por updated_at, padrao CSV BOM UTF-8 + `;` + RFC 4180 + truncamento 10000), admin-fretes (encerramento via fretes.status=encerrado, padrao _SKIPPED), admin-blacklist e admin-dashboard (RPC agregadora, gating server-side, migration 036).

Resumo do escopo (MVP enxuto):

1. **Configuracao de comissao** em /admin/financeiro/configuracoes, gated por FINANCEIRO_EDIT:
   - Tabela financial_settings com snapshot historico (cada mudanca gera nova linha).
   - Campos: commission_pct (decimal 0..50), commission_brackets (jsonb opcional, faixas escalonadas), effective_from, updated_at, updated_by.
   - Validacao: faixas sem buracos, sem sobreposicao, min_value < max_value, max 5 faixas.
   - Audit log FINANCIAL_SETTINGS_UPDATED via executeAdminMutation.

2. **Listagem de repasses** em /admin/financeiro:
   - Tabela financial_repasses (1 linha por frete encerrado, criada via trigger on_frete_close_create_repasse).
   - Cada linha snapshot imutavel: valor_bruto, commission_pct, commission_value, valor_liquido.
   - Status pendente / pago / estornado.
   - Mini-dashboard de 4 cards no topo (receita do mes, pendentes, pagos no mes, top embarcador devedor).
   - Filtros em popover: status, embarcador, motorista, intervalo de datas, busca livre.
   - Tabela paginada 10/50/100 (default 10).
   - Mobile: tabela vira cards single-column.

3. **Marcar repasse como pago** via modal MarkAsPaidModal:
   - Dropdown metodo (pix, ted, boleto, dinheiro, outro).
   - Upload comprovante opcional (PDF/imagem, ate 5MB) para bucket privado financial_proofs.
   - Textarea notes opcional 0..1000 chars.
   - RPC admin_repasse_mark_paid com versionamento otimista e idempotencia (CP-2): se ja esta pago, retorna { skipped: true, reason: ALREADY_PAID } + audit FINANCIAL_PAYMENT_MARKED_SKIPPED.

4. **Estornar pagamento** via modal de confirmacao:
   - Motivo obrigatorio 1..500 chars.
   - RPC admin_repasse_estornar: apenas de pago para estornado. Mantem payment_proof_url e paid_at para historico.
   - Idempotente: se ja estornado, skip + audit FINANCIAL_PAYMENT_REVERTED_SKIPPED.

5. **Detalhe do repasse** em /admin/financeiro/:id:
   - Header com id curto + status badge + botoes Marcar pago / Estornar / Baixar comprovante (gated).
   - Bloco Frete vinculado (link para /admin/fretes/<frete_id>).
   - Blocos Embarcador e Motorista (links para /admin/users/<id>).
   - Bloco Historico de auditoria (gated por AUDIT_VIEW).
   - Stealth_404 quando UUID invalido ou repasse nao encontrado.

6. **Export CSV** na listagem (gated FINANCEIRO_VIEW):
   - Colunas id;frete_id;embarcador_name;motorista_name;valor_bruto;commission_pct;commission_value;valor_liquido;status;closed_at;paid_at;payment_method.
   - BOM UTF-8 + `;` + RFC 4180 + truncamento 10000.
   - Audit FINANCIAL_EXPORTED via logAdminAction.

7. **Mini-dashboard financeiro** no topo da listagem:
   - 4 cards via RPC admin_financeiro_summary(p_from, p_to) SECURITY DEFINER.
   - Cards com role="region" + aria-label.

8. **Permissoes** (sem nova action):
   - FINANCEIRO_VIEW: SUPER_ADMIN, ADMIN, FINANCEIRO. Le listagem, detalhe, summary, export.
   - FINANCEIRO_EDIT: SUPER_ADMIN, ADMIN. Marcar pago, estornar, editar settings.
   - SUPORTE/MODERADOR: Stealth_404 em /admin/financeiro*.

9. **Storage privado** em bucket financial_proofs:
   - SELECT exige FINANCEIRO_VIEW; INSERT exige FINANCEIRO_EDIT; DELETE bloqueado (TODO MVP).
   - Path financial_proofs/<repasse_id>/<filename>.

A stack continua TypeScript + React + Vite + TailwindCSS + Supabase + Vitest + fast-check. Esta spec adiciona migration 037 (+ rollback paralelo), service src/services/admin/financeiro.ts, novos componentes em src/components/admin/financeiro/, tres paginas. **Nenhuma nova dependencia npm**.

**Fora de escopo** (vao para outras specs futuras): integracao com gateway de pagamento real, conciliacao bancaria automatica, notas fiscais, repasse para o motorista, I18n, Realtime, notificacao ao embarcador, substituicao de comprovante apos pago, DELETE fisico de comprovante, bulk operations.

## Glossary

- **Admin_Panel**: Painel administrativo entregue em admin-foundation, acessivel em /admin/*.
- **AdminGuard / AdminProvider / AdminLayoutRoute / AdminShell / AdminSidebar**: Entregues em admin-foundation, reusados sem alteracao.
- **Stealth_404**: Pagina 404 visualmente identica a 404 publica, renderizada para acessos nao autorizados.
- **Permission_Matrix**: Matriz (AdminRole, AdminAction) -> boolean em src/services/admin/permissions.ts. FINANCEIRO_VIEW e FINANCEIRO_EDIT ja existem desde a migration 030. Esta spec NAO adiciona action nova.
- **executeAdminMutation**: Helper em src/services/admin/audit.ts. Toda mutacao financeira passa por aqui.
- **logAdminAction**: Helper que registra audit log isolado. Usado em FINANCIAL_EXPORTED.
- **is_admin_with_permission**: Funcao SQL que reproduz Permission_Matrix server-side.
- **financial_settings**: Tabela com snapshot historico de regras de comissao (cada UPDATE = INSERT de nova linha).
- **Vigent_Settings**: Linha mais recente de financial_settings com effective_from <= NOW().
- **financial_repasses**: Tabela 1:1 com fretes encerrados (UNIQUE em frete_id), snapshot imutavel.
- **on_frete_close_create_repasse**: Trigger AFTER UPDATE em fretes (status -> encerrado), idempotente via ON CONFLICT (frete_id) DO NOTHING.
- **compute_commission_value(p_value, p_settings)**: Funcao SQL pura IMMUTABLE. Paridade 1:1 com helper TS computeCommission.
- **computeCommission (TS)**: Helper puro em financeiro.ts. Determinista (CP-1).
- **admin_financeiro_settings_get / update / admin_repasse_mark_paid / estornar / admin_repasses_list / admin_financeiro_summary**: 6 RPCs SECURITY DEFINER.
- **Repasse_Filters**: { status, embarcadorId, motoristaId, periodKind, from, to, q, sort, page, pageSize }.
- **DEFAULT_REPASSE_FILTERS**: { status: todos, embarcadorId: null, motoristaId: null, periodKind: closed_at, from: null, to: null, q: vazio, sort: closed_at_desc, page: 1, pageSize: 10 }.
- **MarkAsPaid_Form**: { payment_method, proof_file?, notes? }. proof_file MIME âˆˆ PDF/PNG/JPG/WEBP, size <= 5MB. notes 0..1000 chars.
- **Estornar_Form**: { revert_reason } 1..500 chars.
- **STALE_VERSION**: erro tipado quando expected_updated_at nao casa com updated_at atual.
- **CSV_Format**: BOM UTF-8 + `;` + RFC 4180 + 10000 linhas (incluindo header).
- **financial_proofs (bucket)**: bucket privado, path <repasse_id>/<filename_sanitizado>, signed URL 7 dias.
- **Migration_037**: supabase/migrations/037_admin_financeiro.sql, dependente de 001..036, idempotente, com rollback paralelo.
- **Action codes** (ingles, gravados em admin_audit_logs): FINANCIAL_SETTINGS_UPDATED, FINANCIAL_PAYMENT_MARKED, FINANCIAL_PAYMENT_MARKED_SKIPPED, FINANCIAL_PAYMENT_REVERTED, FINANCIAL_PAYMENT_REVERTED_SKIPPED, FINANCIAL_EXPORTED, FINANCIAL_VIEW_DENIED.
- **Compact_Layout_Pattern**: padrao pos-cleanup. Sem `<h1>` grande, filtros em popover via icone SlidersHorizontal, paginacao 10/50/100, botoes text-xs px-2.5 py-1.

## Padroes de Sucesso

- **TypeScript**: npx tsc --noEmit zero erros.
- **Lint**: npm run lint zero warnings.
- **Build**: npm run build limpa.
- **Testes obrigatorios** (sem asterisco em tasks.md):
  - **CP-1 - Comissao deterministica E paritaria**: Para todo (valor_bruto, settings) valido, computeCommission e funcao pura. Para todo (valor_bruto, settings), commission_value retornado por computeCommission (TS) = compute_commission_value (SQL), modulo arredondamento canonico. Snapshot do trigger = computeCommission(value, vigent_settings). Cobre flat puro, brackets vazias, brackets 1..5 entradas, valor=0, valor em borda, valor fora de bracket. Formalizada em design.md.
  - **CP-2 - markAsPaid idempotente**: Para todo (repasse_id, options) com repasse.status=pago, chamar markAsPaid retorna { skipped: true, reason: ALREADY_PAID } SEM mutar e grava FINANCIAL_PAYMENT_MARKED_SKIPPED. N >= 1 chamadas preservam estado e geram exatamente 1 FINANCIAL_PAYMENT_MARKED + (N-1) FINANCIAL_PAYMENT_MARKED_SKIPPED.
- **Testes opcionais** (com asterisco): CP-3 (compute_commission_value SQL puro via Postgres local), CP-4 (round-trip CSV), CP-5 (estornar idempotente), CP-6 (URL filters round-trip), smoke test idempotencia migration, roteiro E2E manual.

## Requirements

### Requirement 1: Rotas /admin/financeiro, gating e padrao compacto

**User Story:** Como admin com FINANCEIRO_VIEW, quero acessar /admin/financeiro para ver o modulo financeiro completo (mini-dashboard + listagem) seguindo o padrao visual compacto dos outros modulos admin.

#### Acceptance Criteria

1. THE Admin_Panel SHALL registrar a rota /admin/financeiro renderizando Financeiro_List_Page.
2. THE Admin_Panel SHALL registrar a rota /admin/financeiro/configuracoes renderizando Financeiro_Configuracoes_Page.
3. THE Admin_Panel SHALL registrar a rota /admin/financeiro/:id renderizando Financeiro_Detail_Page.
4. WHEN um admin sem FINANCEIRO_VIEW acessa /admin/financeiro, THE AdminGuard SHALL renderizar Stealth_404.
5. WHEN um admin sem FINANCEIRO_VIEW acessa /admin/financeiro/:id, THE AdminGuard SHALL renderizar Stealth_404.
6. WHEN um admin sem FINANCEIRO_EDIT acessa /admin/financeiro/configuracoes, THE AdminGuard SHALL renderizar Stealth_404.
7. WHEN um admin com perfil SUPORTE ou MODERADOR navega para qualquer rota /admin/financeiro*, THE AdminGuard SHALL renderizar Stealth_404.
8. THE Financeiro_List_Page SHALL NAO renderizar `<h1>` grande no topo, seguindo o padrao Compact_Layout_Pattern.
9. THE Financeiro_List_Page SHALL renderizar uma barra superior compacta com: contador de periodo aplicado, botao Atualizar, botao de filtros (icone SlidersHorizontal), botao Exportar CSV (gated FINANCEIRO_VIEW) e link Configurar comissao (gated FINANCEIRO_EDIT).
10. THE Financeiro_List_Page SHALL aplicar DEFAULT_REPASSE_FILTERS na primeira visita.
11. THE Financeiro_List_Page SHALL preservar Repasse_Filters como query params na URL.
12. WHEN o admin recarrega a pagina com query params validos, THE Financeiro_List_Page SHALL aplicar os filtros automaticamente.
13. IF um query param recebe valor invalido, THEN THE Financeiro_List_Page SHALL ignorar o param e usar o default correspondente.
14. WHEN um admin sem FINANCEIRO_EDIT esta em /admin/financeiro ou /admin/financeiro/:id, THE Admin_Panel SHALL ocultar (nao desabilitar) os botoes Marcar pago, Estornar e o link Configurar comissao.
15. THE AdminSidebar SHALL exibir item Financeiro apontando para /admin/financeiro, gated por FINANCEIRO_VIEW.

### Requirement 2: Configuracao de comissao

**User Story:** Como admin com FINANCEIRO_EDIT, quero configurar a comissao padrao com snapshot historico.

#### Acceptance Criteria

1. THE Financeiro_Configuracoes_Page SHALL renderizar formulario com: input numerico Percentual padrao (%) com min=0 max=50 step=0.01, tabela editavel Faixas de comissao com colunas min/max/pct + botao Remover por linha + botao Adicionar faixa (limite 5), botao Salvar.
2. THE Financeiro_Configuracoes_Page SHALL exibir bloco Configuracao vigente lendo via admin_financeiro_settings_get(), incluindo effective_from e updated_by.
3. THE Financeiro_Configuracoes_Page SHALL exibir bloco Simulador com input valor + preview computeCommission live.
4. WHEN o admin altera Percentual padrao para fora de [0, 50], THE Financeiro_Configuracoes_Page SHALL exibir erro inline e desabilitar Salvar.
5. WHEN o admin adiciona/edita faixa, THE Financeiro_Configuracoes_Page SHALL validar: min_value >= 0, max_value > min_value, pct âˆˆ [0,50], faixas ordenadas por min_value ASC, sem buracos (max[i] = min[i+1]), sem sobreposicao (max[i] <= min[i+1]), 0..5 faixas.
6. IF qualquer regra do criterio 2.5 falha, THEN THE Financeiro_Configuracoes_Page SHALL exibir erro contextual na primeira faixa conflitante e desabilitar Salvar.
7. THE Financeiro_Configuracoes_Page SHALL exibir texto inline informativo sobre brackets vs flat.
8. THE Financeiro_Configuracoes_Page SHALL exibir texto inline sobre aplicacao prospectiva.
9. WHEN o admin clica Salvar, THE Financeiro_Service SHALL invocar admin_financeiro_settings_update via executeAdminMutation com action=FINANCIAL_SETTINGS_UPDATED.
10. WHEN Salvar retorna sucesso, THE Financeiro_Configuracoes_Page SHALL exibir toast role=status Configuracao salva. e re-fetch.
11. IF a chamada falha por permissao server-side, THEN THE Financeiro_Configuracoes_Page SHALL exibir toast Sem permissao para alterar configuracao.
12. THE admin_financeiro_settings_update RPC SHALL fazer INSERT de nova linha em financial_settings (snapshot historico imutavel) ao inves de UPDATE.
13. WHEN um frete e encerrado, THE on_frete_close_create_repasse trigger SHALL resolver Vigent_Settings como linha de financial_settings com maior effective_from ainda <= NOW().
14. IF financial_settings esta vazia, THEN THE on_frete_close_create_repasse trigger SHALL aplicar commission_pct=0 e brackets vazios (defensivo).

### Requirement 3: Listagem de repasses

**User Story:** Como admin com FINANCEIRO_VIEW, quero ver a lista de repasses com filtros, paginacao e ordenacao.

#### Acceptance Criteria

1. THE Financeiro_List_Page SHALL exibir tabela de Repasse_Row com colunas: ID curto, Frete (link), Embarcador (link), Motorista (link ou em branco), Valor bruto, Comissao, Liquido, Status (badge), Fechamento, Pagamento, Acoes.
2. THE Financeiro_List_Page SHALL exibir paginacao inferior com seletor 10/50/100 (default 10) e indicador Pagina X de Y.
3. THE Financeiro_List_Page SHALL ordenar por closed_at DESC por default.
4. THE Financeiro_List_Page SHALL oferecer botoes compactos para alternar ordenacao entre closed_at_desc, paid_at_desc, valor_liquido_desc.
5. WHEN nao ha repasses com os filtros atuais, THE Financeiro_List_Page SHALL exibir mensagem Nenhum repasse encontrado.
6. THE coluna Status SHALL renderizar badge: Pendente (amarelo), Pago (verde), Estornado (cinza com tooltip do revert_reason).
7. THE coluna Frete SHALL renderizar link /admin/fretes/<frete_id> com texto <id_curto> Â· <origin> -> <destination>.
8. THE coluna Embarcador SHALL renderizar link /admin/users/<embarcador_id> com embarcador_name.
9. THE coluna Motorista SHALL renderizar link /admin/users/<motorista_id> com motorista_name quando preenchido; em branco quando NULL.
10. THE coluna Pagamento SHALL renderizar paid_at formatado dd/MM/yyyy HH:mm + label do payment_method capitalizado quando status=pago.
11. WHEN status=pendente E o admin tem FINANCEIRO_EDIT, THE coluna Acoes SHALL exibir botao Marcar pago.
12. WHEN status=pago E o admin tem FINANCEIRO_EDIT, THE coluna Acoes SHALL exibir botao Estornar.
13. WHEN status=pago E payment_proof_url IS NOT NULL, THE coluna Acoes SHALL exibir botao Comprovante que abre signed URL em nova aba.
14. THE coluna Acoes SHALL exibir sempre link Detalhe que navega para /admin/financeiro/<id>.
15. WHEN o viewport tem width < 768px, THE Financeiro_List_Page SHALL renderizar lista de cards single-column.

### Requirement 4: Filtros em popover

**User Story:** Como admin com FINANCEIRO_VIEW, quero filtrar a listagem em popover compacto.

#### Acceptance Criteria

1. THE Financeiro_List_Page SHALL renderizar botao com icone SlidersHorizontal que abre popover ancorado.
2. THE popover SHALL conter: select Status, combobox Embarcador (debounce 250ms, limite 20), combobox Motorista, toggle Periodo sobre (Fechamento/Pagamento), inputs De/Ate, input Busca livre (debounce 300ms), botao Aplicar e botao Limpar filtros.
3. WHEN o admin pressiona Esc com popover aberto, THE Financeiro_List_Page SHALL fechar sem aplicar.
4. WHEN o admin clica fora do popover, THE Financeiro_List_Page SHALL fechar sem aplicar.
5. WHEN o admin clica Aplicar, THE Financeiro_List_Page SHALL atualizar Repasse_Filters, query params, resetar page=1 e re-fetch.
6. WHEN o admin clica Limpar filtros, THE Financeiro_List_Page SHALL aplicar DEFAULT_REPASSE_FILTERS e re-fetch.
7. IF from > to, THEN THE popover SHALL exibir erro inline e desabilitar Aplicar.
8. THE popover SHALL fechar automaticamente apos Aplicar.
9. WHEN qualquer filtro distinto do default esta ativo, THE botao de filtros SHALL exibir badge com contagem.

### Requirement 5: Mini-dashboard financeiro

**User Story:** Como admin com FINANCEIRO_VIEW, quero ver 4 cards no topo da listagem.

#### Acceptance Criteria

1. THE Financeiro_List_Page SHALL renderizar 4 cards via RPC admin_financeiro_summary: Receita do mes (sum commission_value pagos no periodo), Repasses pendentes (count + sum valor_bruto), Repasses pagos no mes (count + sum valor_liquido), Top embarcador devedor.
2. WHEN p_from e p_to nao sao passados, THE admin_financeiro_summary RPC SHALL aplicar default from=first_day_of_current_month, to=NOW().
3. WHEN p_to < p_from, THE admin_financeiro_summary RPC SHALL retornar erro INVALID_PERIOD.
4. WHEN (p_to - p_from) > 365 days, THE admin_financeiro_summary RPC SHALL retornar erro PERIOD_TOO_LARGE.
5. THE 4 cards SHALL ter role=region e aria-label agregando label + valor.
6. WHEN viewport < 768px, THE 4 cards SHALL ocupar 1 coluna; em md (>=768) 2 colunas; em xl (>=1280) 4 colunas.
7. WHEN nao ha repasses no periodo, THE card Top embarcador devedor SHALL exibir Sem pendencias.
8. WHEN a RPC falha, THE Financeiro_List_Page SHALL renderizar cards em estado Erro ao carregar com botao Tentar novamente.
9. THE admin_financeiro_summary RPC SHALL validar is_admin_with_permission(FINANCEIRO_VIEW) e gravar FINANCIAL_VIEW_DENIED quando ausente.

### Requirement 6: Modal Marcar como pago

**User Story:** Como admin com FINANCEIRO_EDIT, quero marcar um repasse pendente como pago com idempotencia garantida.

#### Acceptance Criteria

1. THE MarkAsPaidModal SHALL renderizar com role=dialog, aria-modal=true, foco inicial em Cancelar.
2. THE MarkAsPaidModal SHALL conter: dropdown Metodo (sem default), input file accept=.pdf,.png,.jpg,.jpeg,.webp, textarea Notas maxLength=1000 com contador, botoes Cancelar e Confirmar pagamento.
3. WHEN o admin nao seleciona metodo, THE MarkAsPaidModal SHALL desabilitar Confirmar pagamento.
4. WHEN o admin seleciona arquivo, THE MarkAsPaidModal SHALL validar MIME âˆˆ {PDF, PNG, JPG, WEBP} e size <= 5MB.
5. IF a validacao 6.4 falha, THEN THE MarkAsPaidModal SHALL exibir erro inline e desabilitar Confirmar.
6. WHEN o admin pressiona Esc, THE MarkAsPaidModal SHALL fechar sem submeter.
7. WHEN o admin clica Confirmar pagamento, THE Financeiro_Service SHALL: se ha arquivo, fazer upload primeiro; em sucesso, invocar admin_repasse_mark_paid via executeAdminMutation com action=FINANCIAL_PAYMENT_MARKED.
8. WHEN a RPC retorna { ok: true }, THE MarkAsPaidModal SHALL fechar e exibir toast Repasse marcado como pago. E listagem re-fetch.
9. WHEN a RPC retorna { skipped: true, reason: ALREADY_PAID }, THE MarkAsPaidModal SHALL fechar e exibir toast Este repasse ja estava pago. E listagem re-fetch.
10. WHEN a RPC retorna STALE_VERSION, THE MarkAsPaidModal SHALL fechar e exibir toast Outro admin atualizou. Recarregando.
11. THE admin_repasse_mark_paid RPC SHALL validar is_admin_with_permission(FINANCEIRO_EDIT) e payment_method âˆˆ enum.
12. THE admin_repasse_mark_paid RPC SHALL ser idempotente (CP-2): chamar com status=pago retorna { skipped: true, reason: ALREADY_PAID } SEM mutar e grava FINANCIAL_PAYMENT_MARKED_SKIPPED.
13. THE admin_repasse_mark_paid RPC SHALL aplicar versionamento otimista: WHERE id=$1 AND updated_at=p_expected_updated_at. Se 0 linhas, retorna STALE_VERSION sem mutar.

### Requirement 7: Estornar pagamento

**User Story:** Como admin com FINANCEIRO_EDIT, quero estornar um repasse pago mantendo o snapshot historico.

#### Acceptance Criteria

1. THE Financeiro_Detail_Page SHALL renderizar botao Estornar (gated FINANCEIRO_EDIT) que abre EstornarModal.
2. THE Financeiro_List_Page SHALL renderizar botao Estornar em cada linha com status=pago (gated FINANCEIRO_EDIT).
3. THE EstornarModal SHALL conter: mensagem Confirmar estorno do repasse <id_curto>?, textarea Motivo obrigatorio minLength=1 maxLength=500 com contador, botao Cancelar (foco inicial) e Confirmar estorno.
4. WHEN o motivo (apos trim) tem 0 chars OU > 500 chars, THE EstornarModal SHALL desabilitar Confirmar estorno.
5. WHEN o admin clica Confirmar estorno, THE Financeiro_Service SHALL invocar admin_repasse_estornar via executeAdminMutation com action=FINANCIAL_PAYMENT_REVERTED.
6. THE admin_repasse_estornar RPC SHALL apenas processar repasses com status=pago. Se status=pendente, retorna INVALID_STATUS.
7. THE admin_repasse_estornar RPC SHALL ser idempotente: se status=estornado, retorna { skipped: true, reason: ALREADY_REVERTED } SEM mutar e grava FINANCIAL_PAYMENT_REVERTED_SKIPPED.
8. THE admin_repasse_estornar RPC SHALL aplicar versionamento otimista (expected_updated_at).
9. WHEN o estorno conclui, THE Financeiro_Service SHALL preservar payment_proof_url, paid_at, paid_by, payment_method, notes (snapshot historico) e popular reverted_at=NOW(), reverted_by=auth.uid(), revert_reason=p_reason.
10. WHEN o estorno conclui, THE Financeiro_Detail_Page SHALL exibir toast Pagamento estornado. e re-fetch.

### Requirement 8: Detalhe do repasse

**User Story:** Como admin com FINANCEIRO_VIEW, quero ver o detalhe completo de um repasse.

#### Acceptance Criteria

1. THE Financeiro_Detail_Page SHALL renderizar layout vertical com 4 blocos: Header (id curto + status badge + botoes gated), Frete vinculado (link + resumo), Embarcador e Motorista (links ou Sem motorista vinculado.), Historico de auditoria (gated AUDIT_VIEW).
2. WHEN o :id da URL nao e UUID valido, THE Financeiro_Detail_Page SHALL renderizar Stealth_404.
3. WHEN o repasse com :id nao existe, THE Financeiro_Detail_Page SHALL renderizar Stealth_404.
4. WHEN status=pendente E admin tem FINANCEIRO_EDIT, THE header SHALL exibir botao Marcar como pago que abre MarkAsPaidModal.
5. WHEN status=pago E admin tem FINANCEIRO_EDIT, THE header SHALL exibir botao Estornar que abre EstornarModal.
6. WHEN status=pago E payment_proof_url IS NOT NULL, THE header SHALL exibir botao Baixar comprovante que abre signed URL em nova aba.
7. WHEN status=estornado, THE Financeiro_Detail_Page SHALL exibir banner cinza Repasse estornado em <reverted_at>. Motivo: <revert_reason>.
8. WHEN o admin nao tem AUDIT_VIEW, THE bloco Historico de auditoria SHALL ser ocultado (nao desabilitado).
9. WHEN o admin tem AUDIT_VIEW E nao ha audit logs, THE bloco Historico de auditoria SHALL exibir Nenhum evento registrado.

### Requirement 9: Export CSV

**User Story:** Como admin com FINANCEIRO_VIEW, quero exportar a listagem filtrada como CSV.

#### Acceptance Criteria

1. THE Financeiro_List_Page SHALL renderizar botao Exportar CSV (gated FINANCEIRO_VIEW) na barra superior.
2. WHEN o admin clica Exportar CSV, THE Financeiro_Service SHALL invocar exportRepasseCSV(filters) aplicando filtros atuais (sem paginacao) com pageSize=10000, gerar CSV em CSV_Format, truncar em 10000 linhas e avisar via toast quando truncado.
3. THE CSV SHALL ter cabecalho exato: id;frete_id;embarcador_name;motorista_name;valor_bruto;commission_pct;commission_value;valor_liquido;status;closed_at;paid_at;payment_method.
4. WHEN um campo contem `;`, `"` ou `\n`, THE Financeiro_Service SHALL escapar via aspas duplas (RFC 4180).
5. WHEN motorista_name e nulo, THE celula SHALL ser string vazia.
6. WHEN paid_at e nulo, THE celula SHALL ser string vazia.
7. THE valores numericos SHALL usar separador decimal . (formato neutro).
8. THE Financeiro_Service SHALL gravar audit log FINANCIAL_EXPORTED via logAdminAction com after={ filters, row_count, truncated }.
9. WHEN o download conclui, THE Financeiro_List_Page SHALL exibir toast CSV exportado (N linhas).
10. THE filename SHALL seguir o padrao financeiro_<YYYYMMDD>_<HHmm>.csv.

### Requirement 10: Storage de comprovantes

**User Story:** Como admin com FINANCEIRO_EDIT, quero anexar comprovantes; com FINANCEIRO_VIEW, quero baixar via signed URL.

#### Acceptance Criteria

1. THE Migration_037 SHALL criar bucket privado financial_proofs via INSERT INTO storage.buckets ... ON CONFLICT (id) DO NOTHING.
2. THE Migration_037 SHALL criar policy SELECT em storage.objects requerendo is_admin_with_permission(FINANCEIRO_VIEW) para bucket financial_proofs.
3. THE Migration_037 SHALL criar policy INSERT requerendo FINANCEIRO_EDIT.
4. THE Migration_037 SHALL criar policy UPDATE requerendo FINANCEIRO_EDIT.
5. THE Migration_037 SHALL criar policy DELETE com USING (false) (bloqueado no MVP).
6. THE Financeiro_Service SHALL fazer upload em path <repasse_id>/<filename_sanitizado>.
7. THE Financeiro_Service SHALL gerar URL via supabase.storage.from(financial_proofs).createSignedUrl(path, 7 * 24 * 3600).
8. THE Financeiro_Service SHALL sanitizar filename: remove acentos, substitui espacos por _, mantem [a-zA-Z0-9._-], max 100 chars.
9. THE design.md SHALL documentar como TODO a substituicao de DELETE bloqueado por RPC admin_repasse_delete_proof com auditoria.

### Requirement 11: Permissoes e gating

**User Story:** Como sistema, quero garantir defesa em profundidade (UI + servidor).

#### Acceptance Criteria

1. THE Permission_Matrix SHALL manter FINANCEIRO_VIEW em SUPER_ADMIN, ADMIN, FINANCEIRO (sem alteracoes).
2. THE Permission_Matrix SHALL manter FINANCEIRO_EDIT em SUPER_ADMIN, ADMIN (sem alteracoes).
3. THE Permission_Matrix SHALL NAO incluir FINANCEIRO_VIEW nem FINANCEIRO_EDIT em SUPORTE ou MODERADOR.
4. WHEN um admin sem FINANCEIRO_VIEW chama qualquer RPC admin_financeiro_* / admin_repasses_* / admin_repasse_*, THE RPC SHALL retornar permission_denied E gravar FINANCIAL_VIEW_DENIED em admin_audit_logs.
5. WHEN um admin sem FINANCEIRO_EDIT chama RPCs de mutacao, THE RPC SHALL retornar permission_denied.
6. THE UI SHALL ocultar (nao desabilitar) botoes e links cujas acoes requerem permissao ausente.
7. WHEN o caller e anonimo (auth.uid() IS NULL), THE RPCs financeiras SHALL retornar permission_denied.

### Requirement 12: Acessibilidade e mobile

**User Story:** Como admin usando teclado, leitor de tela ou mobile, quero acessar o modulo com mesma cobertura.

#### Acceptance Criteria

1. THE Financeiro_List_Page SHALL ter layout responsivo: 1 coluna em <768px, 2 em md, 4 em xl para os 4 cards.
2. THE 4 cards SHALL ter role=region e aria-label.
3. THE MarkAsPaidModal e EstornarModal SHALL ter role=dialog, aria-modal=true e foco inicial em Cancelar.
4. THE filtros em popover SHALL fechar com Esc e clique fora.
5. THE tabela de repasses SHALL virar lista de cards single-column quando width < 768px.
6. THE botoes de acao SHALL ter contraste WCAG AA minimo e aria-label quando icone-only.
7. THE focus trap dos modais SHALL impedir tab de sair do modal enquanto aberto.
8. THE inputs de data e numericos SHALL ter label associado via htmlFor ou aria-label.
9. THE botao de filtros SHALL ter aria-expanded refletindo o estado do popover.

### Requirement 13: Migration 037 e idempotencia

**User Story:** Como engenheiro, quero aplicar a migration 037 sem efeitos colaterais em re-execucoes.

#### Acceptance Criteria

1. THE Migration_037 SHALL ser nomeada supabase/migrations/037_admin_financeiro.sql.
2. THE Migration_037 SHALL ser envelopada em BEGIN; ... COMMIT;.
3. THE Migration_037 SHALL ser idempotente: re-execucao nao causa erro nem duplica objetos. Usar CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS antes de CREATE POLICY, INSERT ... ON CONFLICT DO NOTHING em buckets.
4. THE Migration_037 SHALL incluir blocos DO $check$ defensivos validando: (a) is_admin_with_permission(text) existe; (b) admin_audit_logs existe; (c) users e fretes existem; (d) storage.buckets e storage.objects acessiveis. Cada bloco levanta EXCEPTION clara.
5. THE Migration_037 SHALL ser acompanhada de 037_admin_financeiro_rollback.sql que documenta DROPs reversos (nao auto-aplicado).
6. THE rollback SHALL: dropar trigger e funcao on_frete_close_create_repasse, dropar 6 RPCs, dropar funcao compute_commission_value, dropar policies do bucket, dropar tabelas financial_repasses e financial_settings, **manter** o bucket financial_proofs e seus objetos.
7. THE Migration_037 SHALL ser independente de re-aplicacao das migrations 030..036.
8. THE Migration_037 SHALL conter um bloco -- VERIFY comentado com SELECTs de smoke test.

### Requirement 14: Trigger de criacao automatica de repasse

**User Story:** Como sistema, quero criar repasse automaticamente quando um frete e encerrado.

#### Acceptance Criteria

1. THE on_frete_close_create_repasse trigger SHALL ser AFTER UPDATE em fretes.
2. THE trigger SHALL disparar apenas quando OLD.status IS DISTINCT FROM NEW.status AND NEW.status = encerrado.
3. THE trigger SHALL resolver Vigent_Settings como SELECT * FROM financial_settings WHERE effective_from <= NOW() ORDER BY effective_from DESC LIMIT 1.
4. THE trigger SHALL chamar compute_commission_value(NEW.value, vigent_settings_jsonb) para obter commission_value e commission_pct.
5. THE trigger SHALL inserir em financial_repasses com frete_id=NEW.id, embarcador_id=NEW.embarcador_id, motorista_id=NEW.motorista_id, valor_bruto=NEW.value, snapshot de comissao, status=pendente, closed_at=NEW.updated_at.
6. THE trigger SHALL ser idempotente via INSERT ... ON CONFLICT (frete_id) DO NOTHING.
7. IF financial_settings esta vazia, THEN THE trigger SHALL aplicar commission_pct=0, commission_value=0, valor_liquido=NEW.value.
8. IF NEW.value IS NULL OR NEW.value < 0, THEN THE trigger SHALL aplicar valor_bruto=0, commission_value=0, valor_liquido=0.
9. THE trigger SHALL rodar SECURITY DEFINER com search_path=public para bypass de RLS no INSERT.
10. CP-1 SHALL formalizar a paridade entre compute_commission_value (SQL) e computeCommission (TS) e a equivalencia ao snapshot gerado pelo trigger.
