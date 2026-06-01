# Requirements Document

## Introduction

Esta spec entrega o módulo **Financeiro** do painel administrativo do FreteGO, acessível em
`/admin/financeiro`. É uma spec NOVA e SEPARADA da spec antiga `admin-financeiro` (que trata de
comissão por frete e foi deixada de lado). O objetivo deste módulo, no escopo MVP, é dar ao admin
visibilidade de **quem está pagando** e **quem está em atraso** (em arrears) e a capacidade de
**notificar os usuários em atraso** reusando o sistema de notificações interno já em produção.

Ponto central de escopo: **este módulo trabalha apenas com STATUS de assinatura, não com
transações reais de dinheiro**. A visão de "entrada e saída" (dinheiro que entra/sai) depende de um
gateway de pagamento real (Asaas) que ainda não existe e está **fora de escopo**. Enquanto não há
cobrança real, `users.is_subscribed` é `false` para todos, e a verdade sobre "em atraso" é derivada
do trial expirado (motorista não-assinante com `trial_ends_at <= now()`), exatamente o predicado
`is_motorista_trial_blocked` da migration 044.

O módulo se assenta sobre fundações já em produção, sem reinventá-las:

- **admin-foundation (migration 030)**: RBAC `is_admin_with_permission`, `Permission_Matrix`
  (`src/services/admin/permissions.ts`), `executeAdminMutation` (audit-by-construction), `Stealth_404`,
  versionamento otimista (`updated_at` + `STALE_VERSION`), RPC `SECURITY DEFINER` com
  `SET search_path=public` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`, padrão de
  export CSV (BOM UTF-8 + `;` + RFC 4180 + truncamento 10000 linhas) e UI compacta.
- **trial-e-bloqueio (migration 044)**: colunas `users.subscription_status`, `users.trial_ends_at`,
  `users.is_subscribed`; predicado `is_motorista_trial_blocked(uuid)`; RPC de listagem
  `admin_list_trial_motoristas` (referência de padrão, porém motorista/trial-only e gated por
  `USER_VIEW`).
- **notifications-hub (migration 041)**: tabela `notifications` e o índice único parcial
  `uq_notifications_user_plan_unread ON notifications (user_id, type) WHERE read_at IS NULL AND
  type LIKE 'plan_%'`, que garante naturalmente a idempotência de avisos `plan_*` não-lidos por
  usuário. A notificação dos usuários em atraso REUSA esta tabela/índice; **não** cria um novo canal.
- **admin-notify-user (migration 034)**: RPC `admin_notify_user` como referência de inserção em
  `notifications` a partir do painel admin.

A entrega adiciona: a **migration 046** (`046_financeiro.sql` + par de rollback documentado), o
service `src/services/admin/financeiro.ts`, componentes em `src/components/admin/financeiro/`, a
página `/admin/financeiro` e o registro da rota no `AdminGuard`.

## Glossary

- **Financeiro_Module**: o módulo administrativo entregue por esta spec (rota, service, componentes,
  RPCs).
- **Financeiro_Page**: a página React em `/admin/financeiro` que renderiza KPIs, filtros, listagem e
  ações de notificação.
- **Subscription_Status**: o rótulo informativo de domínio fechado em `users.subscription_status`
  (`trial` | `active` | `past_due` | `canceled` | `blocked`), introduzido na migration 044. NÃO é a
  fonte de verdade do bloqueio/atraso.
- **Financial_Status**: a classificação financeira AUTORITATIVA computada no servidor a partir de
  `is_subscribed`, `trial_ends_at` e `now()`. Domínio fechado: `active` (assinante pagante),
  `trial` (em período de teste vigente), `past_due` (em atraso — trial expirado e não-assinante),
  `canceled` (cancelado) e `blocked` (bloqueado). No estado atual sem cobrança real, `past_due`
  coincide com o predicado `is_motorista_trial_blocked`.
- **Overdue_Predicate**: a regra que define "em atraso". Um motorista está em atraso quando
  `user_type = 'motorista' AND is_subscribed = false AND trial_ends_at IS NOT NULL AND
  trial_ends_at <= now()`. Equivale a `is_motorista_trial_blocked(uuid)` (migration 044).
- **Financeiro_List_RPC**: a RPC de leitura `admin_list_financeiro_motoristas` que retorna a
  listagem paginada com `financial_status` computado no servidor e os contadores de KPI.
- **Notify_Overdue_RPC**: a RPC `admin_notify_overdue_motorista` que envia (ou pula
  idempotentemente) uma notificação `plan_past_due` a um motorista em atraso.
- **Notifications_Hub**: o sistema de notificações internas (in-app) já em produção (migration 041),
  baseado na tabela `notifications`.
- **Permission_Matrix**: a matriz de permissões RBAC em `src/services/admin/permissions.ts`,
  espelhada por `is_admin_with_permission` no SQL.
- **AdminGuard**: o componente de proteção de rotas admin que aplica `Stealth_404`.
- **Stealth_404**: a renderização de uma página 404 idêntica à pública quando o acesso é negado, sem
  revelar a existência da rota.
- **Migration_046**: a migration `supabase/migrations/046_financeiro.sql` entregue por esta spec
  (próxima numeração livre após a 045, reservada por `admin-settings`).
- **CSV_Exporter**: o componente/função de exportação CSV que segue o padrão herdado (BOM UTF-8,
  separador `;`, escape RFC 4180, truncamento 10000 linhas).

## Premissas e decisões (a confirmar pelo usuário)

- **A1 — População da listagem (motoristas)**: a listagem é restrita a `user_type = 'motorista'`,
  por serem o único tipo de usuário com ciclo de assinatura/trial e sujeito a cobrança futura.
  Embarcadores/admins têm `trial_ends_at` nulo e `subscription_status` sem significado financeiro,
  por isso ficam de fora. Caso o usuário queira incluir outros tipos, é uma extensão simples do
  filtro da RPC.
- **A2 — Gating de permissão (sem nova action)**: a leitura (página, listagem, KPIs, CSV) é gated
  por `FINANCEIRO_VIEW` e a ação de notificar (individual e em lote) é gated por `FINANCEIRO_EDIT`.
  Ambas já existem na `Permission_Matrix` desde a migration 030 (papel `FINANCEIRO` possui as duas;
  `SUPER_ADMIN`/`ADMIN` também). NÃO é adicionada nenhuma action nova. Preferiu-se `FINANCEIRO_*` a
  `USER_VIEW/USER_EDIT` (usados pelas RPCs de trial) por encaixe semântico, por já constarem na
  matriz e por evitar acoplar o módulo financeiro às permissões de gestão de usuários. A
  notifications-hub também já gateia criação de broadcast por `FINANCEIRO_EDIT`, mantendo coerência.
- **A3 — Tipo de notificação `plan_past_due`**: a notificação de atraso usa `type = 'plan_past_due'`
  (prefixo `plan_`) justamente para herdar a idempotência do índice único parcial
  `uq_notifications_user_plan_unread`, garantindo no máximo UMA notificação de atraso não-lida por
  motorista.

## Requirements

### Requirement 1: Acesso à rota com RBAC em duas camadas e Stealth_404

**User Story:** Como administrador financeiro, quero acessar `/admin/financeiro` apenas se tiver
permissão, para que a existência e o conteúdo do módulo permaneçam ocultos de quem não é autorizado.

#### Acceptance Criteria

1. WHEN um usuário autenticado com a permissão `FINANCEIRO_VIEW` navega para `/admin/financeiro`,
   THE AdminGuard SHALL renderizar a Financeiro_Page.
2. IF o usuário não está autenticado ou não possui a permissão `FINANCEIRO_VIEW`, THEN THE AdminGuard
   SHALL renderizar o Stealth_404 com conteúdo idêntico ao da página 404 pública, sem exibir mensagem
   de acesso negado nem qualquer indicação de que a rota `/admin/financeiro` existe.
3. IF a sessão não está autenticada (`auth.uid()` ausente), THEN THE Financeiro_List_RPC SHALL
   rejeitar a chamada com erro `permission_denied` e código `42501`, sem retornar linhas nem KPIs.
4. IF a Financeiro_List_RPC é chamada por um usuário autenticado sem `FINANCEIRO_VIEW`, THEN THE
   Financeiro_List_RPC SHALL registrar um log `FINANCEIRO_VIEW_DENIED` em `admin_audit_logs` com
   `before_data` nulo e `after_data` contendo `{ user_id, reason }`, onde `user_id` é o `auth.uid()`
   do chamador e `reason` é `permission_denied`, e SHALL rejeitar a chamada com código `42501` sem
   retornar linhas nem KPIs.
5. WHILE o usuário autenticado na Financeiro_Page não possui `FINANCEIRO_EDIT`, THE Financeiro_Module
   SHALL não renderizar os botões de notificar (individual e em lote).
6. IF a verificação da permissão `FINANCEIRO_VIEW` falha ou não pode ser resolvida (erro ou
   indisponibilidade da checagem), THEN THE AdminGuard SHALL renderizar o Stealth_404 (fail-closed),
   sem renderizar conteúdo da Financeiro_Page.
7. WHILE a permissão `FINANCEIRO_VIEW` ainda está sendo resolvida, THE AdminGuard SHALL não renderizar
   conteúdo da Financeiro_Page nem dados financeiros.

### Requirement 2: Listagem de motoristas com status financeiro computado no servidor

**User Story:** Como administrador financeiro, quero ver uma lista paginada de motoristas com o
status de assinatura de cada um, para identificar quem está ativo, em trial ou em atraso.

#### Acceptance Criteria

1. WHEN a Financeiro_Page é carregada por um usuário com `FINANCEIRO_VIEW`, THE Financeiro_List_RPC
   SHALL retornar um objeto JSON com as chaves `rows`, `total`, `limit`, `offset` e `kpis`, onde
   `total` é a contagem de motoristas que satisfazem os filtros aplicados antes da paginação, `rows`
   contém no máximo `limit` linhas, e `limit` e `offset` refletem os valores efetivamente aplicados.
2. THE Financeiro_List_RPC SHALL incluir em cada linha os campos `id`, `name`, `phone`,
   `subscription_status`, `is_subscribed`, `trial_ends_at`, `financial_status`, `days_left` e
   `updated_at`.
3. THE Financeiro_List_RPC SHALL computar `financial_status` no servidor usando `now()` como
   autoridade temporal, segundo o Overdue_Predicate e o estado de assinatura, sem depender do rótulo
   armazenado `subscription_status` como fonte de verdade.
4. THE Financeiro_List_RPC SHALL restringir as linhas a `user_type = 'motorista'`.
5. THE Financeiro_List_RPC SHALL ordenar a página de forma determinística e total, usando
   `updated_at` em ordem decrescente como critério primário e `id` em ordem crescente como critério
   de desempate final, de modo que, para a mesma população e os mesmos parâmetros, a ordem das
   linhas seja sempre idêntica.
6. THE Financeiro_List_RPC SHALL aceitar `p_limit` no intervalo `[1, 100]` com valor padrão `10`, e
   `p_offset` maior ou igual a `0` com valor padrão `0`.
7. IF `p_limit` está fora de `[1, 100]` ou `p_offset` é menor que `0`, THEN THE Financeiro_List_RPC
   SHALL rejeitar a chamada com erro `INVALID_INPUT` e código `P0001`.
8. THE Financeiro_Page SHALL oferecer um seletor de paginação com as opções `10`, `50` e `100`, com
   valor padrão `10`.
9. THE Financeiro_List_RPC SHALL computar `days_left` como o número inteiro de dias completos entre
   `now()` e `trial_ends_at`, sendo nulo quando `trial_ends_at` é nulo e menor ou igual a `0` quando
   `trial_ends_at` é igual ou anterior a `now()`.

### Requirement 3: Filtros por status, "somente em atraso" e busca

**User Story:** Como administrador financeiro, quero filtrar a lista por status e buscar por nome ou
telefone, para focar rapidamente nos motoristas em atraso.

#### Acceptance Criteria

1. WHERE um valor de filtro de status pertencente ao domínio fechado
   `active | trial | past_due | canceled | blocked` é informado (não vazio, não nulo e diferente de
   `todos`), THE Financeiro_List_RPC SHALL retornar apenas as linhas cujo `financial_status` é
   exatamente igual ao status informado.
2. IF o filtro de status informado está fora do domínio fechado e não é vazio nem `todos`, THEN THE
   Financeiro_List_RPC SHALL rejeitar a chamada com erro `INVALID_INPUT` e código `P0001`.
3. WHEN o filtro de status é vazio, nulo ou igual a `todos`, THE Financeiro_List_RPC SHALL retornar
   linhas de todos os status.
4. WHERE o filtro "somente em atraso" está ativo, THE Financeiro_List_RPC SHALL retornar apenas as
   linhas cujo `financial_status` é igual a `past_due`.
5. WHEN um termo de busca com comprimento entre 2 e 100 caracteres (após remoção de espaços nas
   extremidades) é informado, THE Financeiro_List_RPC SHALL retornar apenas as linhas cujo `name`
   ou `phone` contém o termo como subcadeia, sem diferenciar maiúsculas de minúsculas.
6. WHEN o termo de busca tem menos de 2 caracteres após remoção de espaços, THE Financeiro_List_RPC
   SHALL ignorar o filtro de busca.
7. IF o termo de busca, após remoção de espaços nas extremidades, excede 100 caracteres, THEN THE
   Financeiro_List_RPC SHALL rejeitar a chamada com erro `INVALID_INPUT` e código `P0001`.
8. WHEN mais de um entre o filtro de status, o filtro "somente em atraso" e o termo de busca está
   ativo na mesma chamada, THE Financeiro_List_RPC SHALL aplicar os filtros de forma conjuntiva
   (AND), retornando apenas as linhas que satisfazem simultaneamente todas as condições ativas.
9. WHEN a Financeiro_List_RPC retorna com um ou mais filtros ativos, THE Financeiro_List_RPC SHALL
   definir `total` como a quantidade de linhas que satisfazem os filtros ativos sobre toda a
   população de motoristas, antes da aplicação de `limit` e `offset`.
10. THE Financeiro_Page SHALL apresentar os filtros em um popover acionado por um botão com o ícone
    `SlidersHorizontal`, sem expandir um painel inline largo.

### Requirement 4: KPIs de contagem por status financeiro

**User Story:** Como administrador financeiro, quero ver contadores resumidos de motoristas ativos,
em trial e em atraso, para ter uma visão imediata da saúde financeira da base.

#### Acceptance Criteria

1. WHEN a Financeiro_List_RPC retorna, THE Financeiro_List_RPC SHALL incluir em `kpis` os
   contadores inteiros não-negativos `total_active`, `total_trial` e `total_past_due`.
2. THE Financeiro_List_RPC SHALL computar cada contador de KPI sobre toda a população de motoristas
   (`user_type = 'motorista'`), independentemente da paginação (`p_limit`/`p_offset`) e
   independentemente dos filtros de status, de busca e "somente em atraso" aplicados à listagem.
3. THE Financeiro_List_RPC SHALL derivar os contadores de KPI do mesmo Overdue_Predicate e da mesma
   classificação `financial_status` usados na listagem, de modo que `total_active`, `total_trial` e
   `total_past_due` sejam iguais, respectivamente, ao número de motoristas classificados como
   `active`, `trial` e `past_due` sobre toda a população.
4. THE Financeiro_List_RPC SHALL retornar valores de `total_active`, `total_trial` e
   `total_past_due` invariantes em relação à paginação e aos filtros, de modo que, para uma mesma
   população de motoristas avaliada no mesmo `now()`, quaisquer duas chamadas com `p_limit`,
   `p_offset`, filtro de status, termo de busca ou "somente em atraso" distintos produzam os mesmos
   três contadores.
5. THE Financeiro_Page SHALL exibir os KPIs como cards compactos, com label `text-[10px] uppercase
   tracking-wider text-gray-500` e valor `text-base sm:text-lg font-semibold`.

### Requirement 5: Determinação determinística do status "em atraso"

**User Story:** Como administrador financeiro, quero que a classificação de "em atraso" seja
consistente e baseada em uma regra única, para confiar que os números refletem a realidade.

#### Acceptance Criteria

1. THE Financeiro_Module SHALL determinar `financial_status` de um motorista por uma ordem de
   precedência total e mutuamente exclusiva, avaliada com `now()` do servidor como autoridade
   temporal, atribuindo exatamente um valor do domínio fechado `active | trial | past_due |
   canceled | blocked` por registro, na seguinte ordem: (1) `active` quando `is_subscribed = true`;
   senão (2) `past_due` quando `trial_ends_at IS NOT NULL AND trial_ends_at <= now()`; senão
   (3) `blocked` quando `subscription_status = 'blocked'`; senão (4) `canceled` quando
   `subscription_status = 'canceled'`; senão (5) `trial`.
2. WHEN `is_subscribed = true`, THE Financeiro_Module SHALL classificar o motorista como `active`,
   independentemente do valor do rótulo armazenado `subscription_status`.
3. THE Financeiro_Module SHALL classificar um motorista como `past_due` se e somente se
   `is_subscribed = false AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()`, usando `now()`
   do servidor como autoridade temporal.
4. WHEN `is_subscribed = false AND (trial_ends_at IS NULL OR trial_ends_at > now()) AND
   subscription_status NOT IN ('canceled', 'blocked')`, THE Financeiro_Module SHALL classificar o
   motorista como `trial`.
5. WHEN `is_subscribed = false`, o Overdue_Predicate é falso (`trial_ends_at IS NULL OR
   trial_ends_at > now()`) e o rótulo armazenado `subscription_status` é `blocked` ou `canceled`,
   THE Financeiro_Module SHALL definir `financial_status` igual a esse rótulo (`blocked` ou
   `canceled`, respectivamente).
6. THE Financeiro_Module SHALL computar `financial_status` como uma função pura e determinística do
   registro do usuário e do instante de avaliação `now()`, sem aleatoriedade nem estado oculto, de
   modo que, para um mesmo registro de usuário, qualquer reavaliação no mesmo `now()` produza sempre
   o mesmo resultado e a única causa de mudança ao longo do tempo seja a passagem de `now()` em
   relação a `trial_ends_at`.
7. THE Financeiro_Module SHALL reutilizar a semântica do predicado `is_motorista_trial_blocked` da
   migration 044 para a classificação `past_due`, sem redefinir a regra de bloqueio.

### Requirement 6: Notificar um motorista em atraso individualmente

**User Story:** Como administrador financeiro, quero notificar um motorista em atraso individualmente,
para lembrá-lo da pendência usando o sistema de notificações interno.

#### Acceptance Criteria

1. WHEN um usuário com `FINANCEIRO_EDIT` aciona a notificação de um motorista em atraso, THE
   Notify_Overdue_RPC SHALL inserir exatamente uma linha em `notifications` com `user_id = p_user_id`
   e `type = 'plan_past_due'`.
2. IF o motorista alvo não está em atraso segundo o Overdue_Predicate avaliado em `now()`, THEN THE
   Notify_Overdue_RPC SHALL não inserir notificação e SHALL retornar
   `{ skipped: true, reason: 'NOT_OVERDUE' }`.
3. IF já existe uma notificação `plan_past_due` não-lida para o motorista alvo, THEN THE
   Notify_Overdue_RPC SHALL não inserir uma notificação duplicada e SHALL retornar
   `{ skipped: true, reason: 'ALREADY_NOTIFIED' }`.
4. WHEN a notificação é criada com sucesso, THE Notify_Overdue_RPC SHALL retornar
   `{ notified: true, notification_id }`, onde `notification_id` é o id da linha inserida em
   `notifications`.
5. IF a Notify_Overdue_RPC é chamada por um usuário autenticado sem `FINANCEIRO_EDIT`, THEN THE
   Notify_Overdue_RPC SHALL registrar `FINANCEIRO_NOTIFY_DENIED` em `admin_audit_logs` com
   `before_data` nulo e `after_data` contendo `{ user_id, reason }` (onde `user_id` é o `auth.uid()`
   do chamador e `reason` é `permission_denied`), e SHALL rejeitar com código `42501` sem inserir
   notificação.
6. IF o `p_user_id` informado não corresponde a um motorista existente, THEN THE Notify_Overdue_RPC
   SHALL rejeitar com erro `NOT_FOUND` e código `P0001`, sem inserir notificação.
7. THE Notify_Overdue_RPC SHALL reutilizar a tabela `notifications` da Notifications_Hub, sem criar
   um novo canal de notificação.
8. IF a sessão não está autenticada (`auth.uid()` ausente), THEN THE Notify_Overdue_RPC SHALL
   rejeitar a chamada com erro `permission_denied` e código `42501`, antes de qualquer escrita.
9. THE Notify_Overdue_RPC SHALL avaliar as condições na seguinte ordem de precedência, inserindo a
   notificação somente quando todas passam: (1) autenticação (`auth.uid()` presente); (2) permissão
   `FINANCEIRO_EDIT`; (3) existência do motorista alvo; (4) Overdue_Predicate verdadeiro em `now()`;
   (5) inexistência de notificação `plan_past_due` não-lida para o alvo.
10. WHILE há chamadas concorrentes para notificar o mesmo motorista em atraso, THE Notify_Overdue_RPC
    SHALL garantir no máximo UMA notificação `plan_past_due` não-lida para esse motorista, de modo
    que exatamente uma chamada retorne `{ notified: true }` e as demais retornem
    `{ skipped: true, reason: 'ALREADY_NOTIFIED' }`.

### Requirement 7: Notificar em lote os motoristas em atraso

**User Story:** Como administrador financeiro, quero notificar em lote os motoristas em atraso, para
cobrar vários de uma vez sem sobrecarregar o sistema.

#### Acceptance Criteria

1. WHEN um usuário com `FINANCEIRO_EDIT` aciona a notificação em lote de um conjunto de 1 a 200
   motoristas selecionados, THE Financeiro_Module SHALL chamar a Notify_Overdue_RPC exatamente uma
   vez por motorista do conjunto, usando um pool de concorrência de no máximo 5 chamadas
   simultâneas.
2. IF o conjunto selecionado para notificação em lote está vazio ou excede 200 motoristas, THEN THE
   Financeiro_Module SHALL bloquear a operação na interface antes de qualquer chamada à
   Notify_Overdue_RPC e SHALL exibir uma indicação informando que o lote aceita de 1 a 200
   motoristas, sem enviar nenhuma notificação.
3. THE Financeiro_Module SHALL contabilizar como `notificados` cada motorista cuja chamada à
   Notify_Overdue_RPC retorna `{ notified: true }`, como `pulados` cada motorista cuja chamada
   retorna `{ skipped: true }` (motivo `NOT_OVERDUE` ou `ALREADY_NOTIFIED`), e como `falhas` cada
   motorista cuja chamada é rejeitada com erro.
4. IF uma ou mais chamadas à Notify_Overdue_RPC são rejeitadas com erro durante o processamento do
   lote, THEN THE Financeiro_Module SHALL continuar processando os motoristas restantes do conjunto
   e SHALL contabilizar cada chamada rejeitada em `falhas`, sem abortar o lote.
5. WHEN a notificação em lote termina, THE Financeiro_Module SHALL apresentar os totais de
   `notificados`, `pulados` e `falhas` referentes ao conjunto processado.
6. THE Financeiro_Module SHALL contabilizar cada motorista do conjunto processado em exatamente uma
   das categorias `notificados`, `pulados` ou `falhas`, de modo que a soma das três seja igual ao
   tamanho do conjunto processado, independentemente da ordem de processamento das chamadas.
7. WHEN o mesmo conjunto de motoristas em atraso é notificado novamente sem que as notificações
   `plan_past_due` anteriores tenham sido lidas, THE Financeiro_Module SHALL contabilizar os
   reenvios como `pulados` com motivo `ALREADY_NOTIFIED`, sem criar notificações duplicadas.

### Requirement 8: Exportação CSV da listagem

**User Story:** Como administrador financeiro, quero exportar a lista filtrada em CSV, para analisar
os dados fora do painel.

#### Acceptance Criteria

1. WHEN um usuário com `FINANCEIRO_VIEW` solicita a exportação, THE CSV_Exporter SHALL gerar um
   arquivo CSV com prefixo BOM UTF-8 (`\uFEFF`) e separador `;`.
2. WHEN a exportação é gerada, THE CSV_Exporter SHALL produzir uma linha de cabeçalho seguida de uma
   linha por motorista que satisfaz os filtros ativos da listagem corrente (status, "somente em
   atraso" e busca), com uma coluna para cada campo da listagem definido na Req 2, na mesma ordem,
   usando o `financial_status` computado pelo Overdue_Predicate.
3. THE CSV_Exporter SHALL escapar campos que contêm `"`, `;`, `\n` ou `\r` segundo a RFC 4180,
   envolvendo o campo em aspas duplas e duplicando aspas internas.
4. THE CSV_Exporter SHALL usar `\r\n` como quebra de linha entre registros.
5. IF o número de linhas a exportar (incluindo o cabeçalho) excede 10000, THEN THE CSV_Exporter
   SHALL truncar o arquivo em exatamente 10000 linhas, preservando a linha de cabeçalho e as
   primeiras 9999 linhas de dados na mesma ordem determinística da listagem (Req 2.5), e SHALL
   registrar `truncated: true` no log de auditoria `FINANCEIRO_EXPORT_CSV` (Req 9) da exportação.
6. THE CSV_Exporter SHALL nomear o arquivo no padrão `financeiro_<YYYYMMDD>_<HHmm>.csv`, onde
   `<YYYYMMDD>` e `<HHmm>` representam a data e a hora do instante da exportação no fuso
   `America/Sao_Paulo`, com `YYYY` de 4 dígitos e `MM`, `DD`, `HH` (`00`–`23`) e `mm` de 2 dígitos
   preenchidos com zero à esquerda.

### Requirement 9: Auditoria das ações de notificação

**User Story:** Como administrador responsável por compliance, quero que toda ação de notificação
seja auditada, para haver rastreabilidade de quem cobrou quem e quando.

#### Acceptance Criteria

1. WHEN uma notificação de atraso é criada com sucesso, THE Financeiro_Module SHALL registrar a ação
   com o código `FINANCEIRO_NOTIFY_OVERDUE` via `executeAdminMutation`, com `admin_id = auth.uid()`,
   `target_type = 'users'`, `target_id` igual ao id do motorista notificado e `created_at` do
   instante do registro.
2. WHEN a notificação de atraso é criada com sucesso, THE Financeiro_Module SHALL incluir no
   `after_data` do log `FINANCEIRO_NOTIFY_OVERDUE` o `notification_id` da notificação criada
   (Req 6.4).
3. IF a criação da notificação de atraso falha após o início da mutação, THEN THE Financeiro_Module
   SHALL registrar a falha via `executeAdminMutation` preservando `admin_id` e `created_at`,
   indicando a falha em `after_data`, sem deixar notificação persistida, e SHALL propagar o erro.
4. WHEN uma notificação de atraso é pulada por idempotência ou por o alvo não estar em atraso, THE
   Notify_Overdue_RPC SHALL registrar `FINANCEIRO_NOTIFY_OVERDUE_SKIPPED` em `admin_audit_logs` com
   `admin_id = auth.uid()`, `target_type = 'users'`, `target_id` igual ao id do motorista alvo e o
   motivo (`ALREADY_NOTIFIED` ou `NOT_OVERDUE`), sem produzir uma mutação.
5. WHEN a exportação CSV é concluída, THE Financeiro_Module SHALL registrar a ação com o código
   `FINANCEIRO_EXPORT_CSV` em `admin_audit_logs`, com `admin_id = auth.uid()`, `created_at` do
   instante da exportação e, em `after_data`, a quantidade de linhas exportadas e o indicador
   booleano `truncated` (Req 8.5).
6. THE Financeiro_Module SHALL usar action codes em inglês no formato UPPER_SNAKE para todas as
   ações auditadas.

### Requirement 10: Migration 046 idempotente com posture de segurança

**User Story:** Como mantenedor da plataforma, quero que a migration do módulo financeiro seja
idempotente e segura, para poder reaplicá-la sem risco.

#### Acceptance Criteria

1. THE Migration_046 SHALL ser nomeada `supabase/migrations/046_financeiro.sql`, sendo a próxima
   numeração livre após a 045 (reservada por `admin-settings`), sem buracos.
2. THE Migration_046 SHALL envelopar todo o seu conteúdo em um único par `BEGIN; ... COMMIT;`,
   aplicando todas as alterações como uma única transação.
3. WHEN a Migration_046 é reexecutada duas ou mais vezes consecutivas sobre um banco em que já foi
   aplicada com sucesso, THE Migration_046 SHALL concluir com `COMMIT` sem erro e produzir o mesmo
   estado de schema da primeira aplicação, usando exclusivamente DDL idempotente
   (`CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS` e, quando houver semente,
   `INSERT ... ON CONFLICT DO NOTHING`).
4. IF qualquer instrução da Migration_046 falha durante a aplicação, THEN THE Migration_046 SHALL
   reverter a transação por inteiro (`ROLLBACK`), não deixando nenhuma alteração parcial de schema
   no banco.
5. THE Migration_046 SHALL conter, antes de qualquer DDL, um bloco `DO $check$` que verifica a
   presença da migration 030 (`is_admin_with_permission`), da migration 041 (`notifications` com o
   índice único parcial sobre `type LIKE 'plan_%'`) e da migration 044
   (`is_motorista_trial_blocked`).
6. IF qualquer uma dessas dependências (migration 030, 041 ou 044) não está aplicada no ambiente,
   THEN o bloco `DO $check$` da Migration_046 SHALL abortar a aplicação antes de qualquer DDL,
   revertendo a transação e levantando um erro que indica qual dependência está ausente.
7. THE Migration_046 SHALL definir a Financeiro_List_RPC e a Notify_Overdue_RPC como
   `SECURITY DEFINER` com `SET search_path = public`, e SHALL aplicar `REVOKE ALL FROM PUBLIC`
   seguido de `GRANT EXECUTE TO authenticated` para cada uma dessas RPCs.
8. THE Migration_046 SHALL ser acompanhada de um arquivo `046_financeiro_rollback.sql` que documenta
   os `DROP` reversos das RPCs e índices criados, mantido como documentação e não aplicado
   automaticamente.
9. THE Migration_046 SHALL conter, ao final, um bloco `-- VERIFY` permanentemente comentado, que não
   é executado na aplicação da migration e cujos SELECTs servem de smoke test manual da existência
   das RPCs e do índice de notificação.
10. WHERE o índice único parcial `uq_notifications_user_plan_unread` existe (criado na migration
    041), THE Notify_Overdue_RPC SHALL inserir notificações com `ON CONFLICT DO NOTHING` sobre esse
    índice, garantindo a idempotência no nível do banco.
11. IF o índice único parcial `uq_notifications_user_plan_unread` não existe no ambiente, THEN THE
    Notify_Overdue_RPC SHALL garantir a idempotência apenas pela pré-checagem de notificação
    `plan_past_due` não-lida (Req 6.3), sem depender de `ON CONFLICT`.

### Requirement 11: Interface compacta, responsiva e acessível

**User Story:** Como administrador, quero que a tela financeira siga o padrão visual compacto do
painel e funcione no celular, para ter uma experiência consistente e acessível.

#### Acceptance Criteria

1. THE Financeiro_Page SHALL seguir o padrão compacto do painel admin, sem renderizar um elemento
   `<h1>` de título no topo da página, e SHALL renderizar os botões de ação com as classes
   `text-xs px-2.5 py-1`.
2. WHILE a largura de viewport é menor que 768px, THE Financeiro_Page SHALL renderizar a listagem
   como uma lista de cards em coluna única, sem apresentar a tabela.
3. WHILE a largura de viewport é maior ou igual a 768px, THE Financeiro_Page SHALL renderizar a
   listagem como tabela.
4. THE Financeiro_Page SHALL identificar cada linha (na tabela) ou cada card (no mobile) cujo
   `financial_status = 'past_due'` por meio de um indicador visual distinto que NÃO dependa
   exclusivamente de cor — incluindo um rótulo textual ou um ícone acompanhado de texto alternativo
   — de modo que o estado "em atraso" permaneça perceptível mesmo sem distinção de cor.
5. THE Financeiro_Page SHALL atender ao contraste mínimo WCAG 2.1 nível AA: razão de no mínimo
   4,5:1 para texto normal e de no mínimo 3:1 para texto grande (≥ 18pt, ou ≥ 14pt em negrito), para
   ícones e rótulos de status e para bordas de componentes de interface.
6. THE Financeiro_Page SHALL tornar os botões de ação, o seletor de paginação e o popover de filtros
   operáveis por teclado, com indicador de foco visível com contraste mínimo de 3:1 em relação às
   cores adjacentes.

## Fora de escopo

- **Gateway de pagamento real (Asaas) e transações de dinheiro real** (entrada/saída efetiva de
  valores). Este módulo trabalha apenas com STATUS de assinatura. A visão de "entrada e saída"
  monetária real virá em uma spec futura quando o gateway estiver integrado.
- **Notificação por WhatsApp e e-mail** (Evolution API). A notificação aqui é exclusivamente in-app
  via Notifications_Hub. O canal WhatsApp/e-mail depende de uma spec futura (Evolution API).
- **Comissão por frete / repasses** — escopo da antiga spec `admin-financeiro` (migration 037), que
  foi deixada de lado e NÃO faz parte deste módulo.
- **Notas fiscais / faturas / emissão de boletos**.
- **Conciliação bancária**.
- **Cobrança automática, régua de cobrança agendada ou jobs recorrentes** de notificação. Aqui a
  notificação é disparada manualmente pelo admin (individual ou em lote).
- **Alteração da `Permission_Matrix`** — nenhuma action nova é adicionada (ver Premissa A2).

## Propriedades de correção (obrigatórias)

Estas propriedades DEVEM ser cobertas por testes baseados em propriedade (fast-check). São
obrigatórias (sem asterisco).

- **CP-1 — Determinismo e correção do Overdue_Predicate**: para qualquer registro de motorista
  gerado e um instante `now` fixo, a classificação `past_due` é verdadeira se e somente se
  `is_subscribed = false AND trial_ends_at != null AND trial_ends_at <= now`; e a função é
  determinística (mesma entrada e mesmo `now` ⇒ mesmo resultado). _Cobre Req 5._
- **CP-2 — Consistência KPI ↔ listagem (metamórfica)**: para qualquer população de motoristas, o
  contador `total_past_due` é igual ao número de registros classificados como `past_due` sobre toda
  a população; e o resultado do filtro "somente em atraso" contém exatamente os registros com
  `financial_status = 'past_due'`, com `len(filtrados) <= len(população)`. _Cobre Req 3, Req 4._
- **CP-3 — Idempotência da notificação (f(f(x)) = f(x))**: notificar o mesmo motorista em atraso
  múltiplas vezes, enquanto a notificação anterior permanece não-lida, resulta em no máximo UMA
  notificação `plan_past_due` não-lida para esse motorista. _Cobre Req 6, Req 7, Req 10._
- **CP-4 — Conservação e confluência do lote**: para qualquer conjunto de até 200 motoristas, a soma
  `notificados + pulados + falhas` é igual ao tamanho do conjunto (nenhum perdido ou contado em
  duplicidade), e o resultado agregado independe da ordem de processamento das chamadas. _Cobre
  Req 7._
- **CP-5 — Round-trip do escape CSV (RFC 4180)**: para qualquer lista de linhas com campos
  arbitrários, ao gerar o CSV pelo CSV_Exporter e em seguida fazê-lo passar por um parser RFC 4180
  de referência, os valores dos campos reproduzem exatamente os valores originais. _Cobre Req 8._
