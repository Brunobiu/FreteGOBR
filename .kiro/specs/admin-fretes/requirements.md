# Requirements Document: admin-fretes

## Introduction

Esta spec entrega o **módulo de Gestão de Fretes** do painel administrativo do FreteGO. Sobre as fundações já entregues em `admin-foundation` (RBAC, MFA, audit-by-construction, sessão isolada, Stealth 404, RPC `is_admin_with_permission`) e `admin-users` (gestão de usuários, padrão de versionamento otimista, padrão de bulk com skip), este módulo adiciona:

1. Tela de listagem paginada de fretes em `/admin/fretes` com filtros (status, embarcador, período, busca livre), ordenação e paginação 25/página.
2. Tela de detalhe consolidado em `/admin/fretes/:id` com dados completos do frete, embarcador linkado a `/admin/users/:id`, lista paginada de motoristas que clicaram, métricas e histórico de mudanças extraído de `admin_audit_logs`.
3. Conjunto de ações administrativas auditadas via `executeAdminMutation`: editar dados, forçar encerramento, forçar cancelamento (com motivo obrigatório), reativar, excluir definitivamente (hard-delete com cascade), bulk encerrar/cancelar (até 200), export CSV.
4. Moderação de conteúdo no detalhe: sinalizar `specifications` inadequadas (substituição por placeholder) e marcar frete como suspeito (`flagged_for_review`).
5. Reforço de RLS via novas policies em `fretes` e `frete_clicks` baseadas em `is_admin_with_permission`, preservando policies do app comum.
6. Migration `032_admin_fretes.sql` adicionando colunas (`cancel_reason`, `flagged_for_review`, `flagged_reason`, `flagged_at`, `flagged_by`), 12 policies RLS e RPC `admin_delete_frete(uuid)` SECURITY DEFINER.

A stack continua TypeScript + React + Vite + TailwindCSS + Supabase + Vitest + fast-check. Esta spec adiciona a migration `032_admin_fretes.sql`, novos componentes em `src/components/admin/fretes/`, novas páginas em `src/pages/admin/fretes/` e o serviço `src/services/admin/fretes.ts`.

**Fora de escopo desta spec** (vão para outras specs já planejadas):

- `admin-dashboard`: cards de métricas globais, gráficos de fretes por período.
- `admin-finance`: aprovação/conciliação de pagamentos relacionados ao frete.
- `admin-users` (já entregue): listagem de motoristas que clicaram em fretes do embarcador X. Esta spec apenas exibe os cliques no detalhe do frete; agregações por embarcador ficam em `admin-users`.
- Qualquer fluxo de matching/contratação automática.

## Glossary

- **Admin_Panel**: Painel administrativo já entregue em `admin-foundation`, acessível em `/admin/*`.
- **Admin_Session**: Sessão admin isolada em `localStorage` sob `fretego_admin_session`, fornecida pelo `AdminProvider`.
- **AdminGuard**: Componente que envolve rotas `/admin/*` e cai em `Stealth_404` se sessão admin inválida.
- **Stealth_404**: Página 404 visualmente idêntica à 404 padrão do app, renderizada para acessos não autorizados a `/admin/*`.
- **Permission_Matrix**: Matriz determinística `(AdminRole, AdminAction) → boolean` em `src/services/admin/permissions.ts`.
- **executeAdminMutation**: Helper em `src/services/admin/audit.ts` que executa uma mutação admin sempre acompanhada de audit log, com rollback-log em caso de falha.
- **is_admin_with_permission**: Função SQL `STABLE SECURITY DEFINER` em Postgres que reproduz a `Permission_Matrix` no banco para reforço de RLS.
- **Fretes_Service**: Novo serviço em `src/services/admin/fretes.ts` que centraliza as operações da spec.
- **Fretes_List_Page**: Página `/admin/fretes` com listagem paginada, filtros, busca, ordenação e bulk actions.
- **Frete_Detail_Page**: Página `/admin/fretes/:id` com dados consolidados de um frete.
- **Target_Frete**: Linha de `fretes` sendo administrada.
- **Frete_Status_Filter**: Filtro de status com valores `todos`, `ativo`, `encerrado`, `cancelado`.
- **Frete_Embarcador_Filter**: Filtro searchable por embarcador (id), pesquisado por `users.name` ou `embarcadores.cnpj`.
- **Frete_Period_Filter**: Filtro de período de cadastro (`created_at`), com `from` e `to` em datas ISO (UTC).
- **Frete_Search**: Busca livre que casa, case-insensitive, contra `fretes.origin`, `fretes.destination` e `fretes.cargo_type` (`ILIKE '%termo%'`).
- **Frete_Sort**: Ordenação com valores `created_desc` (padrão), `created_asc`, `value_desc`, `value_asc`, `clicks_desc`.
- **Fretes_Export_Format**: CSV com cabeçalho fixo (Req 12) e até 10000 linhas por export.
- **Bulk_Frete_Action**: Operação `FRETE_FORCE_CLOSE` ou `FRETE_FORCE_CANCEL` aplicada a um conjunto de fretes selecionados, com 1 audit log por frete afetado e limite máximo de 200 alvos por operação.
- **Frete_Click**: Linha em `frete_clicks` representando interesse de um motorista em um frete (`motorista_id`, `frete_id`, `clicked_at`).
- **Frete_Detail_Bundle**: Estrutura agregada retornada por `Fretes_Service.getFreteDetail(id)` contendo: dados completos do frete, snapshot do embarcador, lista paginada de cliques de motoristas, métricas calculadas (`views`, `clicks`, `days_active`, `estimated_conversion`), histórico de mudanças.
- **Frete_History**: Lista de registros de `admin_audit_logs WHERE target_type = 'fretes' AND target_id = :id` ordenados por `created_at DESC`.
- **Cancel_Reason**: Motivo obrigatório de cancelamento administrativo, gravado em `fretes.cancel_reason`. Texto livre 1..1000 caracteres.
- **Flagged_Frete**: Frete com `flagged_for_review = true`, indicando que algum admin solicitou revisão. Acompanha `flagged_reason`, `flagged_at`, `flagged_by`.
- **Specifications_Placeholder**: Texto canônico `[Conteúdo removido por moderação]` que substitui `fretes.specifications` quando o admin sinaliza o campo como inadequado.
- **Migration_032**: Arquivo `supabase/migrations/032_admin_fretes.sql`, dependente de migrations `001..031`.
- **Embarcador_Inactive**: Embarcador cujo registro em `users` tem `is_active = false` OU `ban_reason IS NOT NULL`. Reativar fretes desse embarcador é bloqueado com `EMBARCADOR_INACTIVE`.

## Requirements

### Requirement 1: Página `/admin/fretes` — Listagem Paginada

**User Story:** Como admin com `FRETE_VIEW`, quero uma listagem paginada de fretes com filtros e ordenação, para encontrar e moderar fretes rapidamente.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/fretes` protegida por `AdminGuard`.
2. THE Fretes_List_Page SHALL ser acessível apenas a admins com permissão `FRETE_VIEW`.
3. WHEN um admin sem `FRETE_VIEW` acessa `/admin/fretes`, THE AdminGuard SHALL renderizar `Stealth_404`.
4. THE Fretes_List_Page SHALL listar registros de `fretes` com paginação de 25 por página.
5. THE Fretes_List_Page SHALL exibir, em cada linha: id curto (primeiros 8 chars), origem, destino, tipo de carga, status (badge colorido por valor), valor formatado em BRL, prazo (`deadline`), data de cadastro, contagem de cliques e flag visual quando `flagged_for_review = true`.
6. THE Fretes_List_Page SHALL exibir contador `Total: N fretes (filtrados)` no topo.
7. THE Fretes_List_Page SHALL paginar via parâmetro `?page=N&pageSize=25` na URL.
8. WHEN a paginação resulta em página vazia, THE Fretes_List_Page SHALL exibir estado vazio com mensagem `Nenhum frete encontrado com os filtros atuais.`.
9. THE Fretes_List_Page SHALL renderizar skeleton loading enquanto carrega a página.
10. IF a query falha por erro de rede, THEN THE Fretes_List_Page SHALL exibir estado de erro com botão `Tentar novamente`.

### Requirement 2: Filtros, Busca e Ordenação

**User Story:** Como admin, quero filtrar por status, embarcador e período, buscar texto livre e ordenar a lista, para refinar resultados.

#### Acceptance Criteria

1. THE Fretes_List_Page SHALL oferecer `Frete_Status_Filter` como dropdown com opções `Todos`, `Ativo`, `Encerrado`, `Cancelado`.
2. THE Fretes_List_Page SHALL oferecer `Frete_Embarcador_Filter` como dropdown searchable que consulta `users` (com join `embarcadores`) por `name ILIKE '%q%' OR embarcadores.cnpj ILIKE '%q%'`, exibindo `name + (cnpj formatado)` em cada item.
3. THE Fretes_List_Page SHALL oferecer `Frete_Period_Filter` com 2 inputs `<input type="date">` para `from` e `to`, ambos opcionais.
4. WHEN `from` é preenchido, THE Fretes_Service SHALL filtrar `created_at >= from` (00:00:00 UTC do dia).
5. WHEN `to` é preenchido, THE Fretes_Service SHALL filtrar `created_at <= to` (23:59:59 UTC do dia).
6. IF `from > to` ao submeter, THEN THE Fretes_List_Page SHALL exibir erro de validação `Data inicial deve ser menor ou igual à final.` e NÃO disparar busca.
7. THE Fretes_List_Page SHALL oferecer campo `Frete_Search` que aceita texto e dispara busca após 300ms de debounce.
8. WHEN `Frete_Search` é aplicado, THE Fretes_Service SHALL casar o termo (case-insensitive) contra `fretes.origin`, `fretes.destination` e `fretes.cargo_type` usando `ILIKE '%termo%'`.
9. THE Fretes_List_Page SHALL oferecer `Frete_Sort` como dropdown com `Mais recentes` (padrão), `Mais antigos`, `Maior valor`, `Menor valor`, `Mais cliques`.
10. THE Frete_Sort padrão SHALL ser `created_at DESC`.
11. WHEN qualquer filtro ou ordenação muda, THE Fretes_List_Page SHALL resetar `page = 1`.
12. THE Fretes_List_Page SHALL preservar todos os filtros e ordenação como query params na URL (`?status=ativo&embarcador=<uuid>&from=2025-01-01&to=2025-03-31&q=soja&sort=value_desc&page=1`).
13. WHEN o admin recarrega a página com query params válidos, THE Fretes_List_Page SHALL aplicar os filtros e ordenação automaticamente.
14. IF um query param recebe valor inválido (ex: `?status=foo`, `?from=not-a-date`), THEN THE Fretes_List_Page SHALL ignorar o param e usar o default correspondente.

### Requirement 3: Página `/admin/fretes/:id` — Detalhe do Frete

**User Story:** Como admin, quero abrir o detalhe de um frete, para inspecionar dados completos, embarcador, motoristas interessados, métricas e histórico de mudanças.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/fretes/:id` protegida por `AdminGuard`.
2. THE Frete_Detail_Page SHALL ser acessível apenas a admins com permissão `FRETE_VIEW`.
3. WHEN o `:id` recebido na URL não é UUID válido, THE Frete_Detail_Page SHALL renderizar `Stealth_404` sem chamar o banco.
4. WHEN o `:id` não existe em `fretes`, THE Frete_Detail_Page SHALL renderizar `Stealth_404`.
5. THE Frete_Detail_Page SHALL chamar `Fretes_Service.getFreteDetail(id, motoristasPage)` que retorna `Frete_Detail_Bundle`.
6. THE Frete_Detail_Page SHALL exibir bloco `Dados do Frete` com: id completo, status, origem (texto + mini-mapa estático com `origin_location`), destino (texto + mini-mapa estático com `destination_location`), `cargo_type`, `vehicle_type`, `weight`, `value` formatado em BRL, `deadline`, `loading_time`, `unloading_time`, `specifications` (com badge `Moderado` quando substituído pelo `Specifications_Placeholder`), `created_at`, `updated_at`.
7. THE Frete_Detail_Page SHALL exibir bloco `Embarcador` com nome, CNPJ formatado, email, telefone e link `Ver perfil` que navega para `/admin/users/<embarcador_id>` (visível apenas se o admin tem `USER_VIEW`).
8. THE Frete_Detail_Page SHALL exibir bloco `Motoristas Interessados` listando registros de `frete_clicks WHERE frete_id = :id` paginado em 10 por página, com nome do motorista, telefone, `clicked_at`, e link `Ver perfil` (visível apenas se o admin tem `USER_VIEW`).
9. THE Frete_Detail_Page SHALL exibir bloco `Métricas` com: `views_count`, `clicks_count`, `days_active = (NOW() - created_at) em dias arredondado para baixo`, `estimated_conversion = clicks_count / NULLIF(views_count, 0) * 100` formatado como porcentagem com 2 casas (exibe `—` se `views_count = 0`).
10. THE Frete_Detail_Page SHALL exibir bloco `Histórico de Mudanças` listando registros de `admin_audit_logs WHERE target_type = 'fretes' AND target_id = :id` ordenados por `created_at DESC`, com data/hora, nome do admin (resolvido via `users`), action e botão `Ver detalhes` que abre modal com `before_data` e `after_data` formatados como JSON. Visível apenas se o admin tem `AUDIT_VIEW`.
11. THE Frete_Detail_Page SHALL exibir bloco `Sinalização` com badge `Sob revisão` quando `flagged_for_review = true`, mostrando `flagged_reason`, `flagged_at` e nome do `flagged_by`.
12. WHEN `getFreteDetail` falha em qualquer sub-query (motoristas, histórico, embarcador), THE Frete_Detail_Page SHALL exibir o bloco correspondente em estado de erro mas continuar renderizando os outros blocos (degradação parcial, padrão herdado de `admin-users`).

### Requirement 4: Ação `Editar Dados do Frete`

**User Story:** Como admin com `FRETE_EDIT`, quero editar dados de um frete, para corrigir informações imprecisas ou ajustar especificações.

#### Acceptance Criteria

1. THE Frete_Detail_Page SHALL exibir botão `Editar` quando o admin tem permissão `FRETE_EDIT`.
2. WHEN o admin sem `FRETE_EDIT` visualiza o detalhe, THE Frete_Detail_Page SHALL ocultar (não apenas desabilitar) o botão `Editar`.
3. THE Edit_Frete_Modal SHALL conter campos editáveis: `origin`, `origin_location` (lat/lng), `destination`, `destination_location` (lat/lng), `cargo_type`, `vehicle_type`, `weight` (decimal positivo), `value` (decimal positivo), `deadline` (date), `loading_time` (int positivo, minutos), `unloading_time` (int positivo, minutos), `specifications` (textarea, max 2000 chars).
4. THE Edit_Frete_Modal SHALL exibir `embarcador_id` em campo readonly (não-editável). IF o admin tenta enviar payload com `embarcador_id` diferente do atual, THEN THE Fretes_Service SHALL falhar com `INVALID_INPUT` e mensagem `Embarcador do frete não pode ser alterado.`.
5. THE Edit_Frete_Modal SHALL pré-preencher os campos com valores atuais do `Frete_Detail_Bundle`.
6. WHEN o admin submete o formulário com dados inválidos (ex: `weight <= 0`, `value <= 0`, `deadline < hoje`, `loading_time < 0`), THE Edit_Frete_Modal SHALL exibir mensagens de erro por campo e NÃO disparar mutação.
7. WHEN o admin submete o formulário com dados válidos, THE Fretes_Service.editFrete SHALL chamar `executeAdminMutation` com `action = 'FRETE_EDIT'`, `target_type = 'fretes'`, `target_id = freteId`, `before = <snapshot anterior>`, `after = <snapshot novo>`, e em seguida `UPDATE fretes SET ... WHERE id = freteId AND updated_at = expectedUpdatedAt`.
8. THE Fretes_Service.editFrete SHALL aceitar parâmetro `expectedUpdatedAt: string` representando o `fretes.updated_at` que o admin viu ao abrir o modal.
9. WHEN o `UPDATE` retorna 0 linhas afetadas, THE Fretes_Service SHALL falhar com `STALE_VERSION` e gerar audit log `FRETE_EDIT_STALE_VERSION`.
10. THE Edit_Frete_Modal SHALL exibir, em caso de `STALE_VERSION`, opção `Recarregar` que fecha o modal e recarrega o `Frete_Detail_Bundle`.
11. WHEN o `UPDATE` é bem-sucedido, THE Frete_Detail_Page SHALL atualizar a UI sem reload completo.

### Requirement 5: Ação `Forçar Encerramento`

**User Story:** Como admin com `FRETE_FORCE_CLOSE`, quero encerrar um frete ativo, para refletir conclusão administrativa do negócio.

#### Acceptance Criteria

1. THE Frete_Detail_Page SHALL exibir botão `Forçar encerramento` quando `fretes.status = 'ativo'` e o admin tem permissão `FRETE_FORCE_CLOSE`.
2. WHEN o admin sem `FRETE_FORCE_CLOSE` visualiza o detalhe, THE Frete_Detail_Page SHALL ocultar o botão `Forçar encerramento`.
3. WHEN o admin clica em `Forçar encerramento`, THE Frete_Detail_Page SHALL exibir modal de confirmação simples com texto `Encerrar este frete? Ele deixará de ser visível para motoristas.`.
4. WHEN o admin confirma, THE Fretes_Service.forceClose SHALL chamar `executeAdminMutation` com `action = 'FRETE_FORCE_CLOSE'`, `before = {status: <atual>}`, `after = {status: 'encerrado'}`, e em seguida `UPDATE fretes SET status = 'encerrado' WHERE id = freteId`.
5. WHEN `fretes.status` já é `'encerrado'` no momento da chamada, THE Fretes_Service.forceClose SHALL gravar audit log `FRETE_FORCE_CLOSE_SKIPPED` com `before = {status: 'encerrado'}` e `after = {reason: 'ALREADY_IN_TARGET_STATE'}`, NÃO executar `UPDATE`, e retornar resultado `{ skipped: true, reason: 'ALREADY_IN_TARGET_STATE' }` sem lançar erro.
6. WHEN `fretes.status` é `'cancelado'`, THE Fretes_Service.forceClose SHALL falhar com `INVALID_STATUS_TRANSITION` e mensagem `Não é possível encerrar um frete cancelado. Reative-o primeiro.`.
7. WHEN o `UPDATE` é bem-sucedido, THE Frete_Detail_Page SHALL atualizar a UI imediatamente sem reload completo e exibir toast `Frete encerrado.`.

### Requirement 6: Ação `Forçar Cancelamento` com Motivo Obrigatório

**User Story:** Como admin com `FRETE_FORCE_CLOSE`, quero cancelar um frete e registrar o motivo, para deixar trilha clara da razão administrativa.

#### Acceptance Criteria

1. THE Frete_Detail_Page SHALL exibir botão `Forçar cancelamento` quando `fretes.status IN ('ativo','encerrado')` e o admin tem permissão `FRETE_FORCE_CLOSE`.
2. WHEN o admin clica em `Forçar cancelamento`, THE Frete_Detail_Page SHALL exibir modal de confirmação com textarea `Motivo` obrigatório (1..1000 chars).
3. WHEN o admin tenta confirmar com `Motivo` vazio (string vazia ou apenas whitespace), THE Cancel_Frete_Modal SHALL exibir erro de validação `Motivo é obrigatório.` e desabilitar o botão de confirmação.
4. WHEN o admin tenta confirmar com `Motivo` > 1000 chars, THE Cancel_Frete_Modal SHALL exibir erro `Motivo deve ter no máximo 1000 caracteres.` e desabilitar o botão.
5. WHEN o admin confirma com `Motivo` válido, THE Fretes_Service.cancelFrete SHALL chamar `executeAdminMutation` com `action = 'FRETE_FORCE_CANCEL'`, `before = {status: <atual>, cancel_reason: null}`, `after = {status: 'cancelado', cancel_reason: <texto>}`, e em seguida `UPDATE fretes SET status = 'cancelado', cancel_reason = <texto>, updated_at = NOW() WHERE id = freteId`.
6. IF `Motivo` ausente na chamada direta ao `Fretes_Service.cancelFrete` (bypass UI), THEN o serviço SHALL falhar com `INVALID_INPUT` antes de qualquer chamada ao banco e antes de qualquer audit log de mutação principal.
7. WHEN `fretes.status` já é `'cancelado'` no momento da chamada, THE Fretes_Service.cancelFrete SHALL gravar audit log `FRETE_FORCE_CANCEL_SKIPPED` e retornar `{ skipped: true, reason: 'ALREADY_IN_TARGET_STATE' }` sem lançar erro.
8. WHEN o `UPDATE` é bem-sucedido, THE Frete_Detail_Page SHALL atualizar a UI sem reload completo e exibir toast `Frete cancelado.`.

### Requirement 7: Ação `Reativar Frete`

**User Story:** Como admin com `FRETE_EDIT`, quero reativar um frete cancelado ou encerrado, para corrigir cancelamento equivocado.

#### Acceptance Criteria

1. THE Frete_Detail_Page SHALL exibir botão `Reativar frete` quando `fretes.status IN ('encerrado','cancelado')` e o admin tem permissão `FRETE_EDIT`.
2. WHEN o admin clica em `Reativar frete`, THE Frete_Detail_Page SHALL exibir modal de confirmação simples com texto `Reativar este frete? Ele voltará a ser visível para motoristas.`.
3. WHEN o admin confirma, THE Fretes_Service.reactivateFrete SHALL chamar `executeAdminMutation` com `action = 'FRETE_REACTIVATE'`, `before = {status: <atual>, cancel_reason: <atual>}`, `after = {status: 'ativo', cancel_reason: null}`, e em seguida `UPDATE fretes SET status = 'ativo', cancel_reason = NULL, updated_at = NOW() WHERE id = freteId`.
4. IF o embarcador do frete (`fretes.embarcador_id`) tem `users.is_active = false` OR `users.ban_reason IS NOT NULL`, THEN THE Fretes_Service.reactivateFrete SHALL falhar com `EMBARCADOR_INACTIVE` antes de chamar a mutação no banco, e a UI SHALL exibir toast `Embarcador está desativado ou banido. Reative o embarcador antes de reativar o frete.`.
5. WHEN `fretes.status` já é `'ativo'` no momento da chamada, THE Fretes_Service.reactivateFrete SHALL gravar audit log `FRETE_REACTIVATE_SKIPPED` e retornar `{ skipped: true, reason: 'ALREADY_IN_TARGET_STATE' }` sem lançar erro.
6. WHEN o `UPDATE` é bem-sucedido, THE Frete_Detail_Page SHALL atualizar a UI sem reload completo e exibir toast `Frete reativado.`.

### Requirement 8: Ação `Excluir Frete` (Hard-Delete com Cascade)

**User Story:** Como admin com `FRETE_DELETE`, quero excluir definitivamente um frete, para casos de spam, conteúdo ilegal ou solicitação LGPD do embarcador.

#### Acceptance Criteria

1. THE Frete_Detail_Page SHALL exibir botão `Excluir frete` apenas quando o admin tem permissão `FRETE_DELETE`.
2. WHEN o admin sem `FRETE_DELETE` visualiza o detalhe, THE Frete_Detail_Page SHALL ocultar o botão `Excluir frete`.
3. WHEN o admin clica em `Excluir frete`, THE Frete_Detail_Page SHALL exibir modal de confirmação dupla: digitar a string `EXCLUIR` no input e clicar `Confirmar exclusão`.
4. THE Delete_Frete_Modal SHALL exibir aviso visual destacado em vermelho com texto `Esta ação é irreversível. O frete e todos os cliques de motoristas serão removidos permanentemente.`.
5. THE Delete_Frete_Modal SHALL exibir contagem prévia de cliques relacionados (`SELECT COUNT(*) FROM frete_clicks WHERE frete_id = :id`) com texto `[N] cliques de motoristas serão excluídos junto.`.
6. WHEN o admin confirma a exclusão, THE Fretes_Service.deleteFrete SHALL chamar `executeAdminMutation` com `action = 'FRETE_DELETE'`, `before = {frete: <snapshot completo>, clicks_count: <contagem>}`, `after = null`, e em seguida invocar a RPC `admin_delete_frete(p_frete_id)`.
7. THE Migration_032 SHALL criar função `admin_delete_frete(p_frete_id uuid) RETURNS jsonb` SECURITY DEFINER que:
   - Verifica se o caller tem permissão `FRETE_DELETE` via `is_admin_with_permission`. IF não, THEN raise `permission_denied`.
   - Executa `DELETE FROM frete_clicks WHERE frete_id = p_frete_id` capturando contagem de linhas afetadas.
   - Executa `DELETE FROM fretes WHERE id = p_frete_id`.
   - Retorna `jsonb_build_object('deleted', true, 'clicks_deleted', <contagem>)`.
8. THE exclusão SHALL ser hard-delete (sem soft-delete). A `frete_clicks` cascade ocorre via DELETE explícito na RPC (não via FK ON DELETE CASCADE) para que a contagem seja capturada e gravada no audit log.
9. WHEN o `DELETE` é bem-sucedido, THE Fretes_Service SHALL gravar audit log adicional `FRETE_DELETE_CASCADE_CLICKS` com `after = {clicks_deleted: <contagem>}` e a UI SHALL redirecionar para `/admin/fretes` com toast `Frete excluído com sucesso. [N] cliques removidos.`.

### Requirement 9: Bulk Actions (Encerrar/Cancelar em Massa)

**User Story:** Como admin com `FRETE_FORCE_CLOSE`, quero selecionar múltiplos fretes e encerrar/cancelar em uma operação, para agilizar moderação em lote.

#### Acceptance Criteria

1. THE Fretes_List_Page SHALL exibir checkbox em cada linha quando o admin tem permissão `FRETE_FORCE_CLOSE`.
2. THE Fretes_List_Page SHALL exibir checkbox no header da tabela para `Selecionar todos da página atual`.
3. THE Fretes_List_Page SHALL exibir barra de bulk actions no topo quando há pelo menos 1 frete selecionado, com botões `Encerrar selecionados` e `Cancelar selecionados` e contador `[N] selecionados`.
4. WHEN o admin clica em `Cancelar selecionados`, THE Fretes_List_Page SHALL exibir modal de confirmação com textarea `Motivo` obrigatório (1..1000 chars), aplicado a todos os fretes do lote.
5. WHEN o admin clica em `Encerrar selecionados`, THE Fretes_List_Page SHALL exibir modal de confirmação simples (sem motivo).
6. WHEN o admin confirma, THE Fretes_Service.bulkClose ou Fretes_Service.bulkCancel SHALL iterar pelos fretes selecionados e chamar `executeAdminMutation` por frete (1 audit log por target), com `action = 'FRETE_FORCE_CLOSE'` ou `'FRETE_FORCE_CANCEL'`, `target_id = freteId`.
7. THE Fretes_Service SHALL processar em paralelo com `Promise.allSettled` e concorrência máxima de 5 requisições simultâneas.
8. THE Fretes_List_Page SHALL exibir progresso `[K] de [N] processados` durante a execução.
9. WHEN um frete no lote já está no estado-alvo (ex: `encerrar` em frete `encerrado`), THE Fretes_Service SHALL pular esse frete, registrar audit log `FRETE_FORCE_CLOSE_SKIPPED` ou `FRETE_FORCE_CANCEL_SKIPPED` com motivo `ALREADY_IN_TARGET_STATE`, e continuar com os outros.
10. WHEN um frete no lote tem `status = 'cancelado'` em operação `bulkClose`, THE Fretes_Service SHALL pular o frete com motivo `INVALID_STATUS_TRANSITION` e registrar `FRETE_FORCE_CLOSE_SKIPPED` com `after = {reason: 'INVALID_STATUS_TRANSITION'}`.
11. WHEN a operação termina, THE Fretes_List_Page SHALL exibir resumo: `[K] sucesso, [F] falhas, [S] pulados.` e oferecer link `Ver detalhes` que abre modal listando os pulados/falhos.
12. THE Fretes_List_Page SHALL desmarcar todos os checkboxes ao final da operação.
13. THE Bulk_Frete_Action SHALL ter limite máximo de 200 fretes por operação. IF o admin seleciona mais de 200, THEN THE Fretes_List_Page SHALL desabilitar os botões de bulk e exibir aviso `Máximo de 200 por operação.`.

### Requirement 10: Moderação de Conteúdo — Sinalizar `specifications`

**User Story:** Como admin com `FRETE_EDIT`, quero substituir conteúdo inadequado em `specifications` por placeholder, para preservar audit trail sem expor o conteúdo.

#### Acceptance Criteria

1. THE Frete_Detail_Page SHALL exibir botão `Moderar conteúdo` no bloco `Dados do Frete` (próximo ao campo `specifications`) quando o admin tem permissão `FRETE_EDIT`.
2. WHEN o admin clica em `Moderar conteúdo`, THE Frete_Detail_Page SHALL exibir modal de confirmação com texto `Substituir o conteúdo de "Especificações" por placeholder de moderação? O conteúdo original ficará registrado no audit log.`.
3. WHEN o admin confirma, THE Fretes_Service.moderateSpecifications SHALL chamar `executeAdminMutation` com `action = 'FRETE_CONTENT_MODERATED'`, `before = {specifications: <texto original>}`, `after = {specifications: '[Conteúdo removido por moderação]'}`, e em seguida `UPDATE fretes SET specifications = '[Conteúdo removido por moderação]', updated_at = NOW() WHERE id = freteId`.
4. THE Specifications_Placeholder SHALL ser a string canônica `[Conteúdo removido por moderação]`.
5. WHEN `fretes.specifications` já é igual ao `Specifications_Placeholder` no momento da chamada, THE Fretes_Service.moderateSpecifications SHALL gravar audit log `FRETE_CONTENT_MODERATED_SKIPPED` e retornar `{ skipped: true, reason: 'ALREADY_MODERATED' }` sem lançar erro.
6. THE Frete_Detail_Page SHALL exibir badge `Moderado` ao lado do campo `specifications` quando seu conteúdo é igual ao `Specifications_Placeholder`.
7. THE permission `FRETE_EDIT` SHALL permitir que `SUPER_ADMIN` e `ADMIN` realizem moderação. Outros papéis (mesmo com `FRETE_FORCE_CLOSE`) NÃO SHALL ter acesso à ação.

### Requirement 11: Moderação de Conteúdo — Marcar como Suspeito

**User Story:** Como admin com `FRETE_EDIT`, quero marcar um frete como suspeito para revisão por outros admins, para indicar que algo precisa de atenção sem alterar o status do frete.

#### Acceptance Criteria

1. THE Migration_032 SHALL adicionar colunas em `fretes`: `flagged_for_review BOOLEAN NOT NULL DEFAULT false`, `flagged_reason TEXT NULL`, `flagged_at TIMESTAMPTZ NULL`, `flagged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`.
2. THE Migration_032 SHALL adicionar constraint `chk_fretes_flag_consistency` em `fretes`: `(flagged_for_review = false AND flagged_reason IS NULL AND flagged_at IS NULL AND flagged_by IS NULL) OR (flagged_for_review = true AND flagged_reason IS NOT NULL AND flagged_at IS NOT NULL)`.
3. THE Migration_032 SHALL adicionar índice parcial `idx_fretes_flagged ON fretes(id) WHERE flagged_for_review = true`.
4. THE Frete_Detail_Page SHALL exibir botão `Sinalizar para revisão` quando `flagged_for_review = false` e o admin tem permissão `FRETE_EDIT`.
5. THE Frete_Detail_Page SHALL exibir botão `Remover sinalização` quando `flagged_for_review = true` e o admin tem permissão `FRETE_EDIT`.
6. WHEN o admin clica em `Sinalizar para revisão`, THE Frete_Detail_Page SHALL exibir modal com textarea `Motivo` obrigatório (1..500 chars).
7. WHEN o admin confirma sinalização com `Motivo` válido, THE Fretes_Service.flagFrete SHALL chamar `executeAdminMutation` com `action = 'FRETE_FLAGGED'`, e em seguida `UPDATE fretes SET flagged_for_review = true, flagged_reason = <texto>, flagged_at = NOW(), flagged_by = <admin_id>, updated_at = NOW() WHERE id = freteId`.
8. WHEN o admin confirma remoção de sinalização, THE Fretes_Service.unflagFrete SHALL chamar `executeAdminMutation` com `action = 'FRETE_UNFLAGGED'`, e em seguida `UPDATE fretes SET flagged_for_review = false, flagged_reason = NULL, flagged_at = NULL, flagged_by = NULL, updated_at = NOW() WHERE id = freteId`.
9. THE Fretes_List_Page SHALL exibir ícone de alerta (badge laranja) na coluna de status quando `flagged_for_review = true`.
10. THE Fretes_List_Page SHALL oferecer filtro adicional `Apenas sinalizados` (checkbox) que aplica `WHERE flagged_for_review = true`. WHEN o filtro é ativado, THE Fretes_List_Page SHALL preservá-lo no query param `?flagged=1`.

### Requirement 12: Export CSV de Lista Filtrada

**User Story:** Como admin com `FRETE_VIEW`, quero exportar a lista filtrada para CSV, para análise externa em planilha.

#### Acceptance Criteria

1. THE Fretes_List_Page SHALL exibir botão `Exportar CSV` quando o admin tem permissão `FRETE_VIEW`.
2. WHEN o admin clica em `Exportar CSV`, THE Fretes_Service SHALL chamar `exportFretesCSV(filters)` que aplica os mesmos filtros, busca e ordenação da listagem visível.
3. THE Fretes_Export_Format SHALL ter cabeçalho fixo: `id,status,origin,destination,cargo_type,vehicle_type,weight,value,deadline,embarcador_id,embarcador_name,views_count,clicks_count,flagged_for_review,cancel_reason,created_at,updated_at`.
4. THE Fretes_Export_Format SHALL escapar campos contendo `,`, `"`, ou newline com aspas duplas e duplicação de aspas internas (RFC 4180).
5. THE Fretes_Export_Format SHALL conter no máximo 10000 linhas. IF o filtro retorna mais de 10000, THEN THE Fretes_Service SHALL exportar apenas as primeiras 10000 (ordenadas por `Frete_Sort` atual) e a UI SHALL exibir aviso `Export limitado a 10000 linhas. Refine os filtros para exportar todos.`.
6. WHEN a exportação termina, THE Fretes_Service SHALL chamar `executeAdminMutation` com `action = 'FRETES_EXPORT'`, `before = null`, `after = {filters, total_exported, requested_limit}`.
7. THE Fretes_List_Page SHALL disparar download do CSV no navegador com nome `fretego-fretes-YYYYMMDD-HHmmss.csv`.
8. THE CSV SHALL ser gerado client-side a partir dos dados em memória; nenhum dado é enviado a servidor externo.

### Requirement 13: RLS Reforçada via `is_admin_with_permission`

**User Story:** Como engenheiro de segurança, quero que o banco garanta que apenas admins com permissão correta possam ler/alterar dados de fretes, independentemente do que o front-end faz.

#### Acceptance Criteria

1. THE Migration_032 SHALL adicionar política `fretes_admin_select` em `fretes` permitindo SELECT quando `is_admin_with_permission('FRETE_VIEW')`.
2. THE Migration_032 SHALL adicionar política `fretes_admin_update` em `fretes` permitindo UPDATE quando `is_admin_with_permission('FRETE_EDIT') OR is_admin_with_permission('FRETE_FORCE_CLOSE')`.
3. THE Migration_032 SHALL adicionar política `fretes_admin_delete` em `fretes` permitindo DELETE quando `is_admin_with_permission('FRETE_DELETE')`.
4. THE Migration_032 SHALL adicionar política `frete_clicks_admin_select` em `frete_clicks` permitindo SELECT quando `is_admin_with_permission('FRETE_VIEW')`.
5. WHERE policies já existem para o app comum (embarcador edita próprio frete, motorista clica em frete), THE Migration_032 SHALL preservá-las intactas e adicionar as policies admin como policies separadas adicionais (idempotência exige `DROP POLICY IF EXISTS`).
6. WHEN um cliente Supabase com `auth.uid()` de um motorista comum tenta `SELECT * FROM fretes`, THE RLS_Engine SHALL retornar apenas fretes ativos visíveis ao app comum (comportamento atual preservado).
7. WHEN um cliente Supabase com `auth.uid()` de um admin SUPORTE (que tem `FRETE_VIEW`) tenta `SELECT * FROM fretes`, THE RLS_Engine SHALL retornar todas as linhas de `fretes` (independente de status).
8. WHEN um cliente Supabase com `auth.uid()` de um admin MODERADOR (que NÃO tem `FRETE_DELETE`) tenta `DELETE FROM fretes WHERE id = X`, THE RLS_Engine SHALL retornar 0 linhas afetadas (silently denied).
9. WHEN um cliente Supabase com `auth.uid()` de um admin SUPORTE (que NÃO tem `FRETE_FORCE_CLOSE` nem `FRETE_EDIT`) tenta `UPDATE fretes SET status = 'encerrado' WHERE id = X`, THE RLS_Engine SHALL retornar 0 linhas afetadas (silently denied).
10. THE Migration_032 SHALL totalizar 12 policies novas: 4 em `fretes` (existing app + 4 admin: select, insert preservada, update admin, delete admin) + 1 em `frete_clicks` (admin select preservando policy de motorista). A contagem `12 policies` reflete `DROP POLICY IF EXISTS` + `CREATE POLICY` para 6 policies (12 statements totais).

### Requirement 14: Audit-by-Construction em Toda Mutação

**User Story:** Como compliance officer, quero que toda mutação de frete gere audit log automaticamente, para que nenhuma alteração passe sem registro.

#### Acceptance Criteria

1. FOR ALL operações de mutação expostas em `Fretes_Service` (`editFrete`, `forceClose`, `cancelFrete`, `reactivateFrete`, `deleteFrete`, `bulkClose`, `bulkCancel`, `flagFrete`, `unflagFrete`, `moderateSpecifications`, `exportFretesCSV`), THE Fretes_Service SHALL invocar `executeAdminMutation` com a `AdminAction` correspondente.
2. THE Fretes_Service SHALL NUNCA chamar `supabase.from('fretes').update(...)`, `supabase.from('fretes').delete(...)` ou `supabase.from('frete_clicks').delete(...)` diretamente sem passar por `executeAdminMutation` (excessão: leitura via `select`).
3. THE audit log SHALL conter `target_type = 'fretes'` e `target_id` igual ao UUID do frete.
4. THE `before_data` SHALL conter snapshot dos campos editáveis antes da mutação. THE `after_data` SHALL conter snapshot após a mutação.
5. THE testes desta spec SHALL incluir teste que verifica: para toda chamada bem-sucedida a `Fretes_Service.<mutação>`, existe exatamente 1 registro novo em `admin_audit_logs` com `action` correspondente (mock de banco). Em caso de falha pós-log, existem 1 log original + 1 log `_ROLLBACK` (total 2).

### Requirement 15: Stealth 404 em Sub-rotas Não Autorizadas

**User Story:** Como engenheiro de segurança, quero que toda sub-rota do módulo de fretes respeite o stealth 404, para que admins sem permissão não saibam que a tela existe.

#### Acceptance Criteria

1. WHEN um admin sem `FRETE_VIEW` acessa `/admin/fretes` ou `/admin/fretes/:id`, THE AdminGuard SHALL renderizar `Stealth_404`.
2. WHEN um admin acessa `/admin/fretes/:id` com `:id` não-UUID, THE Frete_Detail_Page SHALL renderizar `Stealth_404` sem chamar o banco.
3. WHEN um admin acessa `/admin/fretes/:id` com `:id` UUID inexistente, THE Frete_Detail_Page SHALL renderizar `Stealth_404` (e gerar audit log `ADMIN_STEALTH_BLOCK` herdado de `admin-foundation`).
4. THE Admin_Panel SHALL registrar as rotas de fretes em `AdminLayoutRoute` na ordem `fretes` (lista) → `fretes/:id` (detalhe), sem qualquer rota intermediária do tipo `fretes/<segmento>` que pudesse ser confundida com `:id` (não há `fretes/admins`, `fretes/export`, etc.). Caso futuras specs precisem adicionar `fretes/<algo>`, ela SHALL vir antes de `fretes/:id` no roteador.

### Requirement 16: Concorrência e Versionamento Otimista

**User Story:** Como engenheiro, quero que edições concorrentes do mesmo frete sejam detectadas, para evitar sobrescrita silenciosa.

#### Acceptance Criteria

1. THE Fretes_Service.editFrete SHALL aceitar parâmetro `expectedUpdatedAt: string` representando o `fretes.updated_at` que o admin viu ao abrir o modal.
2. WHEN o `UPDATE` é executado, THE Fretes_Service SHALL incluir `WHERE id = freteId AND updated_at = expectedUpdatedAt` no statement.
3. WHEN o `UPDATE` retorna 0 linhas afetadas (versão divergente OU RLS bloqueou), THE Fretes_Service SHALL falhar com `STALE_VERSION` e gerar audit log `FRETE_EDIT_STALE_VERSION`.
4. THE Edit_Frete_Modal SHALL exibir, em caso de `STALE_VERSION`, opção `Recarregar` que fecha o modal e recarrega o `Frete_Detail_Bundle`.
5. THE bulk actions, `forceClose`, `cancelFrete`, `reactivateFrete`, `flagFrete`, `unflagFrete` e `moderateSpecifications` SHALL ser exceção: por serem operações idempotentes ou de transição de estado verificável (`status`, `flagged_for_review`), NÃO requerem `expectedUpdatedAt`.

### Requirement 17: Migration `032_admin_fretes.sql`

**User Story:** Como engenheiro, quero uma migration única, idempotente e reversível para o módulo de fretes, para que o setup possa ser aplicado em dev/staging/prod sem dor.

#### Acceptance Criteria

1. THE Migration_032 SHALL ser arquivada como `supabase/migrations/032_admin_fretes.sql`.
2. THE Migration_032 SHALL aplicar em ordem: alteração de `fretes` (colunas `cancel_reason`, `flagged_for_review`, `flagged_reason`, `flagged_at`, `flagged_by`), constraints de coerência, índice parcial em `flagged_for_review`, função `admin_delete_frete(uuid)` SECURITY DEFINER, policies RLS adicionais em `fretes` e `frete_clicks`.
3. THE Migration_032 SHALL ser idempotente (uso de `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).
4. THE Migration_032 SHALL incluir comentário de cabeçalho explicando objetivo, dependências (migrations 001..031) e nota sobre as colunas novas.
5. THE Migration_032 SHALL ser envolvida em transação `BEGIN; ... COMMIT;`.
6. IF a migration falha em qualquer passo, THEN o estado anterior SHALL ser preservado.
7. THE Migration_032 SHALL incluir, ao final, bloco `-- VERIFY` com queries SELECT que validam: presença das 5 colunas novas, presença das policies novas, presença da RPC `admin_delete_frete`. Esses SELECTs servem como smoke test pós-deploy.
8. THE Migration_032 SHALL incluir validação inicial que falha com mensagem clara IF a migration 030 (admin-foundation) ou 031 (admin-users) NÃO está aplicada.

### Requirement 18: UI em pt-BR e Acessibilidade Básica

**User Story:** Como admin brasileiro, quero todas as mensagens, labels e botões em português do Brasil e com acessibilidade básica, para usar o painel sem fricção.

#### Acceptance Criteria

1. THE Fretes_List_Page e Frete_Detail_Page SHALL ter todos os textos em pt-BR.
2. THE inputs de filtro e formulário SHALL ter `<label>` associado via `htmlFor`/`id`.
3. THE botões com ícones-only SHALL ter `aria-label` em pt-BR.
4. THE modais de confirmação SHALL ter `role="dialog"`, `aria-modal="true"`, foco inicial no botão de cancelar.
5. THE tabela de listagem SHALL ter `<th scope="col">` em todas as colunas e `<caption>` invisível para leitores de tela com texto `Lista de fretes do FreteGO`.
6. THE checkboxes de bulk actions SHALL ter `aria-label` descritivo (ex: `Selecionar frete [origem → destino]`).
7. THE estados de loading SHALL ter `aria-busy="true"` no container.
8. THE estado vazio SHALL ter `role="status"`.
9. THE valores monetários (`value`) SHALL ser formatados em `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
10. THE datas SHALL ser formatadas em `dd/MM/yyyy` (ou `dd/MM/yyyy HH:mm` para timestamps), respeitando timezone do navegador.

## Edge Cases (não-funcionais, mas obrigatórios)

Os comportamentos a seguir SHALL ser cobertos por testes ou documentação explícita:

1. **Encerrar frete já encerrado**: idempotente, gera `FRETE_FORCE_CLOSE_SKIPPED` com `reason: ALREADY_IN_TARGET_STATE`, NÃO toca o banco, retorna `{ skipped: true }` (Req 5.5). Coberto por **CP-1**.
2. **Cancelar frete sem motivo**: bloqueado em UI (botão desabilitado, Req 6.3-6.4) e em `Fretes_Service.cancelFrete` (`INVALID_INPUT`, Req 6.6). Coberto por **CP-2**.
3. **Editar frete que outro admin já alterou**: detectado via `expectedUpdatedAt`, retorna `STALE_VERSION` (Req 16.3) com botão `Recarregar` no modal.
4. **Excluir frete com cliques registrados**: cascade explícito na RPC `admin_delete_frete`, audit log conta `clicks_deleted` (Req 8.7-8.9).
5. **Bulk com fretes de status mistos**: cada frete avaliado individualmente; já no estado-alvo vira skip; transição inválida (`bulkClose` em `cancelado`) também vira skip com motivo `INVALID_STATUS_TRANSITION` (Req 9.9-9.10).
6. **Reativar frete de embarcador desativado/banido**: bloqueado com `EMBARCADOR_INACTIVE` (Req 7.4), independentemente do status atual do frete.
7. **Tentativa de alterar `embarcador_id` na edição**: bloqueada com `INVALID_INPUT` no service e ocultada na UI (campo readonly, Req 4.4). Não há fluxo de transferência de frete entre embarcadores.
8. **Cancelar frete já cancelado**: idempotente, gera `FRETE_FORCE_CANCEL_SKIPPED`, NÃO toca o banco (Req 6.7).
9. **Reativar frete já ativo**: idempotente, gera `FRETE_REACTIVATE_SKIPPED`, NÃO toca o banco (Req 7.5).
10. **Encerrar frete cancelado**: bloqueado com `INVALID_STATUS_TRANSITION` (Req 5.6); admin precisa primeiro reativar.
11. **Moderar `specifications` já moderado**: idempotente, gera `FRETE_CONTENT_MODERATED_SKIPPED` (Req 10.5).
12. **Sinalizar frete sem motivo**: bloqueado em UI (textarea obrigatório, Req 11.6); chamada direta ao service sem `flagged_reason` falha com `INVALID_INPUT`.
13. **Export CSV com filtros que retornam 0 resultados**: download do CSV vazio (apenas cabeçalho), audit log `FRETES_EXPORT` gerado normalmente com `total_exported = 0`.
14. **RLS bloqueia DELETE silenciosamente**: cliente vê 0 linhas afetadas; UI deve detectar isso comparando `count` retornado e exibir erro genérico `Operação não permitida.`.
15. **Filtro de período com `from` ou `to` em data inválida**: query param ignorado e default aplicado (Req 2.14); validação de `from > to` ocorre em UI (Req 2.6).
16. **Acesso a `/admin/fretes/:id` com `:id` UUID válido mas inexistente**: Stealth_404, `ADMIN_STEALTH_BLOCK` registrado (Req 15.3).
17. **Concorrência: dois admins moderando `specifications` ao mesmo tempo**: o segundo cai em skip (`ALREADY_MODERATED`), evitando override silencioso e duplicação de audit logs.

## Correctness Properties (Property-Based Tests)

Estas propriedades DEVEM ser testáveis com fast-check (já em uso). Funções alvo são puras ou facilmente isoláveis com mocks de banco. **CP-1 e CP-2 são obrigatórias**; demais são opcionais (marcadas com `*`).

### CP-1: forceClose é Idempotente em Frete Encerrado (Property — OBRIGATÓRIA)
**Propriedade:** Para todo frete `f` com `f.status = 'encerrado'`, executar `Fretes_Service.forceClose(f.id)` retorna `{ skipped: true, reason: 'ALREADY_IN_TARGET_STATE' }`, NÃO executa `UPDATE` no banco (mock conta `update.callCount === 0`), e gera exatamente 1 registro novo em `admin_audit_logs` com `action = 'FRETE_FORCE_CLOSE_SKIPPED'`. Estado final do banco para `f` permanece inalterado.
**Tipo:** Property (Idempotência).
**Geradores:** `f: Frete` com `status = 'encerrado'` e demais campos arbitrários (`origin`, `destination`, `value`, etc.); número de invocações `n ∈ [1, 5]`.

### CP-2: cancelFrete sem Motivo Falha com INVALID_INPUT (Property — OBRIGATÓRIA)
**Propriedade:** Para toda string `r ∈ {undefined, null, '', '   ', '\t\n'}` (motivos vazios ou apenas whitespace), `Fretes_Service.cancelFrete(freteId, r)` falha com `UsersServiceError | FretesServiceError` de código `INVALID_INPUT` ANTES de qualquer chamada ao banco e ANTES de qualquer audit log de mutação principal. Estado de `fretes` permanece inalterado e nenhum registro novo aparece em `admin_audit_logs` (excluindo logs de leitura prévia).
**Tipo:** Property (Validação de pré-condição).
**Geradores:** `freteId: UUID`, `r ∈ {undefined, null, '', whitespace strings de tamanho 1..20}`.

### CP-3: Round-Trip de Filtros via URL (Property — *opcional)
**Propriedade:** Para todo objeto `f: FretesFilters` válido (`status`, `embarcadorId`, `from`, `to`, `q`, `sort`, `flagged`, `page`), `parseFretesFiltersFromQuery(serializeFretesFiltersToQuery(f))` é deep-equal a `f` (round-trip).
**Tipo:** Round-Trip.
**Geradores:** `status ∈ {'todos','ativo','encerrado','cancelado'}`, `embarcadorId ∈ {undefined, UUID}`, `from/to ∈ {undefined, ISO date}`, `q ∈ string`, `sort ∈ {'created_desc','created_asc','value_desc','value_asc','clicks_desc'}`, `flagged ∈ {true, false}`, `page ∈ ℕ⁺`.

### CP-4: CSV Export Respeita RFC 4180 (Property — *opcional)
**Propriedade:** Para toda lista `L` de `Frete_Row` com strings arbitrárias (incluindo `,`, `"`, `\n`, `\r` em `origin`, `destination`, `cargo_type`, `cancel_reason`), `parseCsv(exportFretesToCsvString(L))` é deep-equal a `L` (round-trip), e cada linha do CSV tem exatamente 17 campos (cabeçalho fixo do `Fretes_Export_Format`).
**Tipo:** Round-Trip.
**Geradores:** `L: Frete_Row[]` com strings que incluem caracteres especiais.

### CP-5: Bulk Pula Fretes Já no Estado-Alvo (Property — *opcional)
**Propriedade:** Para toda lista `freteIds` mista contendo fretes `ativo` e `encerrado`, `bulkClose(freteIds)` retorna `{success: K, skipped: S, failed: F}` onde `S = |{f ∈ freteIds : f.status = 'encerrado'}|` (todos os já-encerrados viram skip), `K = |{f ∈ freteIds : f.status = 'ativo'}|` (todos os ativos viram sucesso), e `F = |{f ∈ freteIds : f.status = 'cancelado'}|` (cancelados viram skip de transição inválida, não failure de erro inesperado).
**Tipo:** Property (Invariante de bulk).
**Geradores:** `freteIds: Frete[]` com mistura aleatória de status; tamanho `n ∈ [0, 200]`.

### CP-6: Permission_Matrix Decide Visibilidade dos Botões (Property — *opcional)
**Propriedade:** Para todo conjunto de papéis `R` e todo `Target_Frete f`, a presença ou ausência dos botões de ação em `Frete_Detail_Page` é exatamente `hasPermissionForRoles(R, action)` para cada ação correspondente:
  - `Editar`, `Reativar frete`, `Sinalizar para revisão`, `Moderar conteúdo` ⇒ `FRETE_EDIT`.
  - `Forçar encerramento`, `Forçar cancelamento` ⇒ `FRETE_FORCE_CLOSE`.
  - `Excluir frete` ⇒ `FRETE_DELETE`.
  - Visibilidade adicional condicionada ao `f.status` (ex: `Reativar` só aparece se status ≠ ativo).
**Tipo:** Property (Invariante de UI).
**Geradores:** `R: AdminRole[]`, `f: Frete`.

### CP-7: Versionamento Otimista Detecta Concorrência em Edit (Property — *opcional)
**Propriedade:** Para toda sequência `[t1, t2]` de timestamps onde `t1 < t2`, executar `editFrete(f, expectedUpdatedAt = t1)` quando o banco já tem `fretes.updated_at = t2` falha com `STALE_VERSION`, e `fretes` permanece inalterado.
**Tipo:** Property (Invariante de consistência).
**Geradores:** `t1, t2: ISO timestamps com t1 < t2`, `f: UUID`.

### CP-8: Toda Mutação Gera Exatamente 1 Audit Log (Property — *opcional)
**Propriedade:** Para toda chamada bem-sucedida a `Fretes_Service.<mutação>(args)` com mock de banco, há exatamente 1 registro novo em `admin_audit_logs` com `action` correspondente. Em caso de falha pós-log, há 1 log original + 1 log `_ROLLBACK` (total 2). Mutações com skip geram 1 log `_SKIPPED` ao invés do principal.
**Tipo:** Property (Invariante).
**Geradores:** `mutação ∈ {editFrete, forceClose, cancelFrete, reactivateFrete, deleteFrete, flagFrete, unflagFrete, moderateSpecifications}`, `args` arbitrários.

### CP-9: Reativar Embarcador Inativo Falha (Property — *opcional)
**Propriedade:** Para todo `Frete f` cujo embarcador `e` tem `e.is_active = false OR e.ban_reason IS NOT NULL`, `Fretes_Service.reactivateFrete(f.id)` falha com `EMBARCADOR_INACTIVE` antes de chamar mutação no banco, independente de `f.status`. Estado de `fretes` permanece inalterado.
**Tipo:** Property (Invariante de pré-condição).
**Geradores:** `e: User` com `is_active ∈ {true, false}` e `ban_reason ∈ {null, string}`; `f: Frete` com status arbitrário.

### CP-10: Estimated_Conversion Está em [0, 100] (Property — *opcional)
**Propriedade:** Para todo par `(views_count, clicks_count) ∈ ℕ × ℕ` com `views_count > 0`, o cálculo `estimated_conversion = clicks_count / views_count * 100` exibido em `Frete_Detail_Page` está em `[0, +∞)` e é exibido com 2 casas decimais. WHEN `views_count = 0`, o valor exibido é `'—'` (string literal). NUNCA é `NaN`, `Infinity` ou negativo.
**Tipo:** Property (Invariante de cálculo).
**Geradores:** `views_count, clicks_count: ℕ` com distribuições incluindo 0 e valores grandes.

### CP-11: Frete_Status_Filter Classifica Corretamente (Property — *opcional)
**Propriedade:** Para todo `Frete_Row f`:
  - `f.status = 'ativo'` ⇒ aparece quando `Frete_Status_Filter ∈ {'todos','ativo'}`.
  - `f.status = 'encerrado'` ⇒ aparece quando `Frete_Status_Filter ∈ {'todos','encerrado'}`.
  - `f.status = 'cancelado'` ⇒ aparece quando `Frete_Status_Filter ∈ {'todos','cancelado'}`.
  Não existe `f` que apareça em filtro de status diferente do seu próprio.
**Tipo:** Property (Invariante de classificação).
**Geradores:** `f: Frete_Row` com `status ∈ {'ativo','encerrado','cancelado'}`.

### CP-12: Permission_Matrix Determinística para FRETE_* (Property — *opcional)
**Propriedade:** Para todo par `(role, action)` onde `role ∈ AdminRole` e `action ∈ {FRETE_VIEW, FRETE_EDIT, FRETE_DELETE, FRETE_FORCE_CLOSE}`, `hasPermission(role, action)` é função pura e o resultado coincide com a tabela esperada:
  - `FRETE_VIEW`: SUPER_ADMIN, ADMIN, SUPORTE, FINANCEIRO, MODERADOR ⇒ true.
  - `FRETE_EDIT`: SUPER_ADMIN, ADMIN ⇒ true; demais ⇒ false.
  - `FRETE_DELETE`: SUPER_ADMIN, ADMIN ⇒ true; demais ⇒ false.
  - `FRETE_FORCE_CLOSE`: SUPER_ADMIN, ADMIN, MODERADOR ⇒ true; demais ⇒ false.
**Tipo:** Property (Determinismo, herdada de admin-foundation, validada no contexto deste módulo).
**Geradores:** exaustivo.

## Padrões de Sucesso

A spec é considerada bem implementada quando:

1. Todos os 18 requisitos têm testes correspondentes (unitários, integração ou E2E).
2. Pelo menos 2 das 12 correctness properties (CP-1..CP-12) passam em PBT com ≥100 iterações; **CP-1 (idempotência de forceClose) e CP-2 (cancelFrete sem motivo)** são obrigatórias.
3. Migration `032_admin_fretes.sql` aplica limpa em banco com migrations 001..031.
4. Todos os textos de UI estão em pt-BR.
5. Tentativa de excluir frete sem `FRETE_DELETE` falha tanto no service quanto no banco (RPC `admin_delete_frete` checa permissão internamente).
6. Tentativa de reativar frete de embarcador inativo falha com `EMBARCADOR_INACTIVE` antes de tocar o banco.
7. Toda mutação em `Fretes_Service` tem audit log correspondente em `admin_audit_logs` (ou par log + log_ROLLBACK em falha, ou log_SKIPPED em idempotência).
8. Stealth_404 é renderizada para acessos a `/admin/fretes/*` por admins sem permissão e para `:id` inexistente ou inválido.
9. Ordem de rotas em `AdminLayoutRoute` preserva `fretes` (lista) antes de `fretes/:id` (detalhe), sem rotas filhas conflitantes do tipo `fretes/<segmento>`.
