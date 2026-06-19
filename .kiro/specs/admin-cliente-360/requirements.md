# Requirements Document

## Introduction

O módulo **Cliente 360** entrega ao painel admin do FreteGO duas capacidades que andam juntas:
uma **Pesquisa Global** (`Global_Search`) onde o dono localiza qualquer cliente a partir de uma única
barra, e uma **Visão 360 do Cliente** (`Cliente_360_View`) que consolida, em uma única tela, todo o
histórico daquele cliente. Esta spec cobre as partes **2 (Pesquisa Global)** e **3 (Histórico
Completo do Cliente)** do documento de ideias do dono (`Credencial/Ideias`):

2. **Pesquisa Global** — uma única barra de busca no painel onde o administrador localiza qualquer
   cliente digitando **Nome, E-mail, Telefone, ID ou Empresa**, com busca rápida, resultados
   unificados e navegação direta para o cliente.
3. **Histórico Completo do Cliente (visão 360)** — ao abrir um cliente, ver em UMA única tela:
   Dados cadastrais, Plano atual, Data de cadastro, Histórico financeiro, Histórico de suporte,
   Histórico de mensagens, Histórico de login e Observações internas (notas internas do admin sobre
   o cliente).

Esta é a **segunda de quatro specs** derivadas do documento do dono. A primeira é
`suporte-inteligente` (migration 115). Esta spec **não** recria módulos existentes: ela **amplia e
compõe** o que já está em produção, em especial o padrão de detalhe agregado de `admin-users`.

### Governança embutida (parte 2 do documento — não é spec separada)

Esta spec **não** cria spec de governança à parte. Cada funcionalidade entrega a própria camada de
validação e proteção, impede vazamento de dados entre usuários e contas, impede ações sem permissão,
é testável (unit + property + cenários de falha + validações no frontend **e** no backend), trata
erros de forma segura (erro tratado, registrado, sistema segue) e segue arquitetura modular. A spec
adere integralmente aos steerings `testing-governance`, `project-conventions` e `admin-patterns`.

### Reuso obrigatório (não duplicar, não quebrar)

- **admin-users (migration 031)**: a `Cliente_360_View` **amplia** o padrão de detalhe agregado já
  entregue (`getUserDetail` com degradação parcial via `Promise.allSettled` e `bundle.errors[bloco]`,
  a página `/admin/users/:id` e a listagem/busca de usuários). Os blocos novos (plano, financeiro,
  suporte, login, notas) são adicionados ao mesmo bundle, sem recriar os blocos existentes
  (cadastrais, documentos, fretes, avaliações, metadados de chat). A `Global_Search` complementa,
  sem substituir, o `User_Search` da listagem de usuários.
- **admin-financeiro (migration 037) + assinaturas-pagamento (migrations 055/057/060)**: fonte do
  **histórico financeiro** e do **plano atual**. O rótulo do plano (`subscription_status`,
  `is_subscribed`, `trial_ends_at`) está em `users` e é lido com `USER_VIEW`; os detalhes de cobrança
  (`subscriptions`, `subscription_charges`) e os repasses (`financial_repasses`) são lidos por leitura
  gated por `FINANCEIRO_VIEW`, reusando as leituras existentes sem afrouxar a RLS dessas tabelas.
- **notifications-hub (migration 041) + suporte-inteligente (migration 115)**: fonte do **histórico
  de suporte** (`support_tickets` / `support_ticket_messages`) e das conversas de suporte
  (`chat_conversations` / `chat_messages`). O histórico de **mensagens de chat de frete** reusa
  `conversations` / `messages` (migrations 008/023/024).
- **admin-foundation (migration 030) + steering `admin-patterns`**: AdminGuard + Stealth_404, gating
  em duas camadas (UI `useAdminPermission` + RPC `is_admin_with_permission`), `executeAdminMutation`
  (audit-by-construction), degradação parcial em fetch agregado, versionamento otimista
  (`expected_updated_at` + `STALE_VERSION`), idempotência `_SKIPPED`, master admin `Nexus_Vortex99`
  imutável, UI compacta, postura de segurança de RPC.

### Fonte do histórico de login (investigação)

A fonte real disponível é a tabela `login_attempts` (migration `005_security_tables.sql`), com
colunas `phone`, `ip_address`, `user_agent`, `success`, `failure_reason`, `created_at`. Essa tabela
é **chaveada por telefone** (não por `user_id`), tem RLS restrita a service-role (acesso direto
bloqueado) e é podada periodicamente por `cleanup_expired_security_data()` (retenção de ~30 dias).
Não existe hoje uma tabela dedicada de eventos de login bem-sucedido por cliente final;
`admin_audit_logs` registra apenas logins **de admin** (`ADMIN_LOGIN_SUCCESS`). Portanto, o bloco de
histórico de login desta spec deriva de `login_attempts` correlacionada pelo telefone normalizado do
cliente, é baseado em **tentativas** (sucesso/falha) e limitado à janela de retenção. A ausência de
uma fonte de eventos de login bem-sucedido por cliente é declarada como **observação/dependência
futura** (Requirement 12); esta spec não inventa fonte inexistente.

### Migration

A entrega adiciona a **migration 116** (`116_admin_cliente_360.sql` + par documentado
`116_admin_cliente_360_rollback.sql`), próxima numeração livre (115/115b pertencem a
`suporte-inteligente`; 117/118 reservados às próximas specs). Caso seja necessária uma segunda
migration, esta SHALL usar o sufixo de letra `116b_...`, preservando os números seguintes.

### Idioma e convenções

Requisitos, UI e mensagens user-facing em **pt-BR**; action codes, error codes e identifiers em
**inglês** (UPPER_SNAKE). Mensagens canônicas anti-enumeração quando aplicável. As Correctness
Properties (Propriedades de Corretude) desta spec do painel são **obrigatórias** (sem asterisco);
propriedades opcionais, quando houver, são marcadas com `*`.

## Glossary

- **Admin_Panel**: Painel administrativo de `admin-foundation` (migration 030), acessível em
  `/admin/*`.
- **AdminGuard / AdminShell / AdminSidebar / useAdminPermission**: Componentes e hook de fundação
  reusados sem alteração de contrato.
- **Stealth_404**: Página 404 visualmente idêntica à 404 pública, renderizada para acessos não
  autorizados, sem revelar a existência da rota.
- **Master_Admin**: Dono do sistema, `users.admin_username = 'Nexus_Vortex99'` (Bruno Henrique),
  imutável.
- **Cliente**: Usuário comum sob administração, com `users.user_type ∈ {motorista, embarcador}`.
  Usuários com `user_type = 'admin'` **não** são Cliente e nunca aparecem em resultados de busca nem
  têm `Cliente_360_View`.
- **Global_Search**: Subsistema de pesquisa global do painel. Expõe uma barra única de busca e
  retorna `Search_Result` unificados de Clientes.
- **Global_Search_RPC**: Função SQL `admin_global_search(p_query text, p_limit int)`
  `SECURITY DEFINER`, gated por `USER_VIEW`, que executa a Pesquisa Global no servidor.
- **Search_Query**: Texto digitado pelo administrador na barra de busca, antes da sanitização.
- **Sanitized_Query**: `Search_Query` após `trim`, colapso de espaços e escape dos curingas de
  `ILIKE` (`%`, `_`, `\`), usada nas comparações.
- **Search_Field**: Campo-alvo de uma correspondência: `name`, `email`, `phone`, `id` ou
  `company_name` (Empresa).
- **Search_Result**: Item unificado retornado pela Global_Search, contendo ao menos: `id`,
  `user_type`, `name`, `email`, `phone`, `company_name`, `matched_field` e `match_rank`.
- **Match_Rank**: Inteiro determinístico de relevância do `Search_Result` (0 = correspondência exata
  de identidade; 1 = correspondência por prefixo; 2 = correspondência por substring), usado para
  ordenação.
- **Search_Page**: Página dedicada `/admin/busca` que renderiza a lista completa de `Search_Result`
  para um `?q=` compartilhável.
- **Topbar_Search**: Campo de busca da Global_Search posicionado na barra superior do AdminShell,
  com dropdown de resultados rápidos.
- **Cliente_360_View**: Tela única que consolida o histórico do Cliente, renderizada na rota
  `/admin/users/:id` ao **ampliar** a `User_Detail_Page` de `admin-users`.
- **Cliente_360_Service**: Camada de serviço que monta o `Cliente_360_Bundle`, **ampliando**
  `getUserDetail` de `admin-users` com os blocos novos.
- **Cliente_360_Bundle**: Estrutura agregada retornada pela `Cliente_360_Service`, contendo os
  `Detail_Block` e um mapa `errors` de blocos indisponíveis (degradação parcial).
- **Detail_Block**: Cada bloco da `Cliente_360_View`: `cadastrais`, `plano`, `financeiro`,
  `suporte`, `mensagens`, `login`, `notas` (além dos blocos já existentes de `admin-users`:
  documentos, fretes, avaliações).
- **Source_Block**: O `Detail_Block` `cadastrais` (cabeçalho do Cliente), única fonte da entidade;
  é o único bloco que pode lançar `NOT_FOUND`.
- **Partial_Degradation**: Padrão herdado de `getUserDetail`/`getMetrics`: cada `Detail_Block` é
  carregado de forma isolada (`Promise.allSettled`); a falha de um bloco registra
  `errors[bloco]` e renderiza erro apenas naquele bloco, sem derrubar os demais.
- **Plano_Atual**: Estado de assinatura do Cliente. O rótulo (`subscription_status`, `is_subscribed`,
  `trial_ends_at`) provém de `users`; os detalhes (`subscriptions.plan`, `payment_method`,
  `next_charge_at`, `grace_ends_at`) provêm de `subscriptions`.
- **Financial_History_RPC**: Função SQL `admin_user_financial_history(p_user_id uuid, p_limit int)`
  `SECURITY DEFINER`, gated por `FINANCEIRO_VIEW`, que retorna o plano detalhado e as cobranças
  (`subscription_charges`) e repasses (`financial_repasses`) do Cliente sem afrouxar a RLS dessas
  tabelas.
- **Support_History**: Histórico de suporte do Cliente, derivado de `support_tickets` e
  `support_ticket_messages` (migrations 041/115), gated por `SUPORTE_VIEW`.
- **Message_History**: Histórico de mensagens do Cliente: metadados de conversas de frete
  (`conversations`/`messages`) e de suporte (`chat_conversations`/`chat_messages`). Conteúdo de
  mensagem **não** é exposto na `Cliente_360_View`.
- **Login_History**: Histórico de login do Cliente, derivado de `login_attempts` correlacionada pelo
  telefone normalizado, baseado em tentativas (sucesso/falha), limitado à janela de retenção.
- **Login_History_RPC**: Função SQL `admin_user_login_history(p_user_id uuid, p_limit int)`
  `SECURITY DEFINER`, gated por `USER_VIEW`, que lê `login_attempts` (RLS service-role) pelo telefone
  do Cliente.
- **Internal_Note**: Observação interna do admin sobre um Cliente, persistida em `admin_user_notes`.
  É **interna** — nunca visível ao Cliente.
- **Internal_Notes**: Subsistema de CRUD das `Internal_Note`, gated por `USER_NOTE_VIEW` (leitura) e
  `USER_NOTE_EDIT` (mutação).
- **USER_NOTE_VIEW / USER_NOTE_EDIT**: Permissões **novas** desta spec para ler e editar
  `Internal_Note`.
- **Permission_Matrix**: Matriz `(AdminRole, AdminAction) → boolean` em
  `src/services/admin/permissions.ts`, espelhada server-side por `is_admin_with_permission`.
- **executeAdminMutation**: Wrapper de audit-by-construction em `src/services/admin/audit.ts`; toda
  mutação admin desta spec passa por aqui.
- **is_admin_with_permission**: Função SQL (migration 030) que reproduz a Permission_Matrix
  server-side, usada em todas as RPCs `SECURITY DEFINER`.
- **STALE_VERSION**: Erro padrão do projeto quando `expected_updated_at` não corresponde ao
  `updated_at` atual da linha (versionamento otimista).
- **Migration_116**: Arquivo `supabase/migrations/116_admin_cliente_360.sql`, dependente das
  migrations `001..115`, idempotente, com par `116_admin_cliente_360_rollback.sql`.
- **Action codes** (inglês, gravados em `admin_audit_logs`): `USER_NOTE_CREATE`, `USER_NOTE_UPDATE`,
  `USER_NOTE_DELETE`, `USER_NOTE_DELETE_SKIPPED`, `USER_NOTE_VIEW_DENIED`,
  `GLOBAL_SEARCH_VIEW_DENIED`, `USER_VIEW_DENIED`, `FINANCEIRO_VIEW_DENIED`, `SUPORTE_VIEW_DENIED`.
- **Canonical_Anti_Enumeration_Message**: Mensagem user-facing genérica que não revela existência de
  dado/rota a quem não tem permissão (`Stealth_404` na navegação; `permission_denied` na RPC).

## Requirements

### Requirement 1: Barra de Pesquisa Global, rota e gating em duas camadas

**User Story:** Como administrador com `USER_VIEW`, quero uma barra única de busca sempre acessível no
painel, para localizar qualquer cliente sem trocar de tela.

#### Acceptance Criteria

1. WHERE o administrador autenticado satisfaz `is_admin_with_permission('USER_VIEW')`, THE AdminShell
   SHALL renderizar a Topbar_Search na barra superior do painel.
2. WHERE o administrador autenticado não satisfaz `is_admin_with_permission('USER_VIEW')`, THE
   AdminShell SHALL ocultar a Topbar_Search.
3. THE Admin_Panel SHALL registrar a rota `/admin/busca` renderizando a Search_Page.
4. WHEN um administrador com `USER_VIEW` acessa `/admin/busca`, THE AdminGuard SHALL renderizar a
   Search_Page.
5. IF um usuário sem `USER_VIEW` acessa `/admin/busca`, THEN THE AdminGuard SHALL renderizar
   Stealth_404.
6. WHEN `auth.uid()` é nulo em qualquer chamada da Global_Search_RPC, THE Global_Search SHALL negar a
   leitura com `permission_denied`.
7. THE Search_Page SHALL omitir o `<h1>` grande no topo da página, seguindo o padrão compacto do
   painel.
8. WHEN o administrador submete a Topbar_Search (tecla Enter ou ação "Ver todos os resultados"), THE
   Global_Search SHALL navegar para `/admin/busca?q=<Search_Query>` preservando o termo na URL.
9. WHEN o administrador recarrega `/admin/busca?q=<termo>` com `q` presente, THE Search_Page SHALL
   reexecutar a busca automaticamente com aquele termo.

### Requirement 2: Pesquisa unificada por Nome, E-mail, Telefone, ID e Empresa

**User Story:** Como administrador, quero digitar um único termo e localizar o cliente por nome,
e-mail, telefone, ID ou empresa, para encontrar qualquer pessoa rapidamente.

#### Acceptance Criteria

1. WHEN o administrador digita um `Search_Query`, THE Global_Search SHALL disparar a busca após 300ms
   de debounce, evitando uma busca por caractere.
2. THE Global_Search_RPC SHALL derivar a `Sanitized_Query` aplicando `trim`, colapso de espaços
   internos e escape dos curingas de `ILIKE` (`%`, `_`, `\`) antes de qualquer comparação.
3. WHEN a `Sanitized_Query` tem menos de 2 caracteres e não é um ID, THE Global_Search_RPC SHALL
   retornar um conjunto vazio de `Search_Result` sem erro.
4. WHEN a `Sanitized_Query` é texto, THE Global_Search_RPC SHALL casar (case-insensitive) contra
   `users.name`, `users.email` e `embarcadores.company_name` usando `ILIKE` com a `Sanitized_Query`.
5. WHEN a `Sanitized_Query` contém apenas dígitos com tamanho maior ou igual a 8, THE
   Global_Search_RPC SHALL casar também contra a versão normalizada (somente dígitos) de
   `users.phone` e `users.cpf`.
6. WHEN a `Sanitized_Query` é um UUID válido, THE Global_Search_RPC SHALL casar `users.id` de forma
   exata e SHALL atribuir `Match_Rank` 0 a essa correspondência.
7. THE Global_Search_RPC SHALL restringir o resultado a `users.user_type ∈ {motorista, embarcador}`,
   excluindo qualquer usuário com `user_type = 'admin'`.
8. THE Global_Search_RPC SHALL aceitar `p_limit` e SHALL fixá-lo no intervalo `[1, 50]`, aplicando
   `20` como valor padrão quando ausente ou fora do intervalo.
9. THE Global_Search SHALL exibir, em cada `Search_Result`, nome, tipo (`motorista`/`embarcador`),
   e-mail, telefone e empresa (quando houver) e SHALL indicar qual `Search_Field` correspondeu.
10. WHEN nenhum Cliente corresponde à `Sanitized_Query`, THE Global_Search SHALL exibir o estado
    vazio `Nenhum cliente encontrado.` sem erro.

### Requirement 3: Ordenação determinística por relevância

**User Story:** Como administrador, quero que os resultados venham ordenados por relevância de forma
estável, para que a mesma busca produza sempre a mesma lista.

#### Acceptance Criteria

1. THE Global_Search_RPC SHALL atribuir `Match_Rank` 0 a correspondências exatas de `id`, `email` ou
   `phone` normalizado.
2. THE Global_Search_RPC SHALL atribuir `Match_Rank` 1 a correspondências por prefixo de `name` ou
   `company_name`.
3. THE Global_Search_RPC SHALL atribuir `Match_Rank` 2 às demais correspondências por substring.
4. THE Global_Search_RPC SHALL ordenar os `Search_Result` por `Match_Rank` ascendente e, em empate,
   por `name` ascendente e, persistindo o empate, por `id` ascendente, produzindo ordenação total e
   determinística.
5. WHEN o mesmo `Search_Query` é executado sobre o mesmo conjunto de dados, THE Global_Search_RPC
   SHALL retornar exatamente a mesma sequência ordenada de `Search_Result`.

### Requirement 4: Isolamento, privacidade e auditoria da Pesquisa Global

**User Story:** Como engenharia de segurança, quero que a Pesquisa Global jamais exponha clientes a
quem não tem permissão de vê-los, para que não haja vazamento de PII.

#### Acceptance Criteria

1. WHERE o caller não satisfaz `is_admin_with_permission('USER_VIEW')`, THE Global_Search_RPC SHALL
   recusar a execução com `permission_denied` e SHALL não retornar nenhum `Search_Result`.
2. WHEN a Global_Search_RPC recusa por falta de permissão, THE Global_Search_RPC SHALL gravar audit
   log negativo `GLOBAL_SEARCH_VIEW_DENIED` com `before` nulo e `after` contendo `user_id` e
   `reason`, antes de abortar.
3. THE Global_Search_RPC SHALL rodar `SECURITY DEFINER` com `SET search_path = public`, `REVOKE ALL
   FROM PUBLIC` e `GRANT EXECUTE TO authenticated`, nunca exposta ao role `anon`.
4. IF a checagem de permissão falha, THEN THE Global_Search SHALL negar a busca independentemente do
   papel do caller, mantendo deny-by-default e sem conceder exceção por papel.
5. THE Global_Search_RPC SHALL não registrar o `Search_Query` bruto, PII bruta nem segredos em logs
   estruturados.
6. WHEN a Global_Search_RPC retorna `Search_Result`, THE Global_Search SHALL expor apenas dados de
   Clientes que o caller com `USER_VIEW` já tem permissão de visualizar.

### Requirement 5: Navegação dos resultados para a Visão 360

**User Story:** Como administrador, quero clicar em um resultado e cair direto na visão completa do
cliente, para não precisar procurar de novo.

#### Acceptance Criteria

1. WHEN o administrador seleciona um `Search_Result` na Topbar_Search ou na Search_Page, THE
   Global_Search SHALL navegar para `/admin/users/<id>`, abrindo a Cliente_360_View daquele Cliente.
2. THE Topbar_Search SHALL exibir no dropdown no máximo 8 `Search_Result` de maior relevância e SHALL
   oferecer a ação "Ver todos os resultados" que navega para `/admin/busca?q=<termo>`.
3. WHEN o administrador navega via teclado pelo dropdown da Topbar_Search, THE Topbar_Search SHALL
   permitir selecionar um `Search_Result` com Enter e fechar o dropdown com Esc.
4. THE Search_Page SHALL renderizar cada `Search_Result` como link para `/admin/users/<id>`.

### Requirement 6: Visão 360 — rota, gating e amplificação do detalhe existente

**User Story:** Como administrador com `USER_VIEW`, quero abrir um cliente e ver todo o histórico em
uma única tela, sem que esta spec quebre a página de detalhe de usuário já existente.

#### Acceptance Criteria

1. THE Cliente_360_View SHALL ser renderizada na rota existente `/admin/users/:id`, ampliando a
   `User_Detail_Page` de `admin-users` sem remover os blocos já entregues (cadastrais, documentos,
   fretes, avaliações, metadados de chat).
2. THE Cliente_360_View SHALL ser acessível apenas a administradores com `USER_VIEW`.
3. IF um usuário sem `USER_VIEW` acessa `/admin/users/:id`, THEN THE AdminGuard SHALL renderizar
   Stealth_404.
4. WHEN o `:id` não é um UUID válido, ou não existe em `users`, ou tem `user_type = 'admin'`, THE
   Cliente_360_View SHALL renderizar Stealth_404.
5. THE Cliente_360_Service SHALL retornar um `Cliente_360_Bundle` que estende o bundle de
   `getUserDetail` com os blocos `plano`, `financeiro`, `suporte`, `mensagens`, `login` e `notas`.
6. THE Cliente_360_View SHALL apresentar todos os `Detail_Block` em uma única tela, organizados de
   forma compacta, sem `<h1>` grande no topo.
7. WHEN `auth.uid()` é nulo em qualquer leitura agregada da Cliente_360_View, THE Cliente_360_Service
   SHALL negar a leitura com `permission_denied`.

### Requirement 7: Degradação parcial por bloco na Visão 360

**User Story:** Como administrador, quero que a falha de um bloco não derrube a tela inteira, para que
eu sempre veja os dados que estão disponíveis.

#### Acceptance Criteria

1. THE Cliente_360_Service SHALL carregar cada `Detail_Block` de forma isolada via
   `Promise.allSettled`, conforme o padrão `Partial_Degradation` herdado de `getUserDetail`.
2. IF o carregamento de um `Detail_Block` que não é o `Source_Block` falha, THEN THE
   Cliente_360_Service SHALL registrar `errors[bloco]` e SHALL retornar os demais blocos normalmente.
3. WHEN `errors[bloco]` está presente para um `Detail_Block`, THE Cliente_360_View SHALL renderizar o
   estado de erro apenas naquele bloco, com opção de tentar novamente, mantendo os demais blocos
   renderizados.
4. THE Source_Block (`cadastrais`) SHALL ser o único `Detail_Block` autorizado a lançar `NOT_FOUND`;
   nenhum outro bloco SHALL propagar `NOT_FOUND` que derrube a página.
5. WHEN o Source_Block falha por inexistência da entidade, THE Cliente_360_View SHALL renderizar
   Stealth_404 em vez de uma tela parcialmente vazia.
6. WHEN `errors[bloco]` está presente para um `Detail_Block` dentre `suporte`, `financeiro`,
   `mensagens`, `login` e `notas`, THE Cliente_360_View SHALL exibir apenas a mensagem de erro daquele
   bloco e SHALL suprimir o estado vazio do mesmo bloco enquanto o erro persistir.

### Requirement 8: Bloco Dados cadastrais, Data de cadastro e Plano atual

**User Story:** Como administrador, quero ver, de imediato, os dados cadastrais, a data de cadastro e
o plano atual do cliente, para entender o contexto sem clicar em outras telas.

#### Acceptance Criteria

1. THE Cliente_360_View SHALL exibir o bloco `cadastrais` com nome, tipo, telefone, e-mail, CPF
   (motorista) ou CNPJ e empresa (embarcador), status e foto, reusando os dados já providos por
   `getUserDetail`.
2. THE Cliente_360_View SHALL exibir a data de cadastro do Cliente a partir de `users.created_at`.
3. THE Cliente_360_View SHALL exibir o bloco `plano` com o rótulo do `Plano_Atual` derivado de
   `users.subscription_status`, `users.is_subscribed` e `users.trial_ends_at`, lidos com `USER_VIEW`.
4. WHERE o administrador satisfaz `is_admin_with_permission('FINANCEIRO_VIEW')`, THE Cliente_360_View
   SHALL enriquecer o bloco `plano` com os detalhes de `subscriptions` (`plan`, `payment_method`,
   `status`, `next_charge_at`, `grace_ends_at`) obtidos pela Financial_History_RPC.
5. WHERE o administrador não satisfaz `is_admin_with_permission('FINANCEIRO_VIEW')`, THE
   Cliente_360_View SHALL ocultar os detalhes de cobrança do bloco `plano`, exibindo apenas o rótulo
   do `Plano_Atual`.
6. WHEN o Cliente não possui assinatura registrada em `subscriptions`, THE Cliente_360_View SHALL
   exibir o bloco `plano` com o rótulo derivado de `users` e indicar a ausência de assinatura paga.

### Requirement 9: Bloco Histórico financeiro

**User Story:** Como administrador com `FINANCEIRO_VIEW`, quero ver o histórico financeiro do cliente
na mesma tela, para acompanhar cobranças e repasses sem abrir o módulo financeiro.

#### Acceptance Criteria

1. THE Financial_History_RPC SHALL validar `is_admin_with_permission('FINANCEIRO_VIEW')` e SHALL
   gravar audit log negativo `FINANCEIRO_VIEW_DENIED` quando o caller falha o gating, antes de
   abortar com `permission_denied`.
2. WHERE o administrador satisfaz `is_admin_with_permission('FINANCEIRO_VIEW')`, THE Cliente_360_View
   SHALL exibir o bloco `financeiro` com as cobranças de `subscription_charges` do Cliente (valor,
   método de pagamento, status, período, data de pagamento) ordenadas por data decrescente.
3. WHERE o Cliente participa de repasses em `financial_repasses` (como embarcador ou motorista), THE
   Cliente_360_View SHALL listar esses repasses (valor bruto, comissão, líquido, status) no bloco
   `financeiro`.
4. WHERE o administrador não satisfaz `is_admin_with_permission('FINANCEIRO_VIEW')`, THE
   Cliente_360_View SHALL ocultar (não apenas desabilitar) o bloco `financeiro` por completo.
5. THE Financial_History_RPC SHALL rodar `SECURITY DEFINER` com `SET search_path = public` para ler
   `subscriptions`, `subscription_charges` e `financial_repasses` do Cliente sem afrouxar a RLS
   `select own` dessas tabelas para os demais roles.
6. THE Financial_History_RPC SHALL aceitar `p_limit` e fixá-lo em intervalo seguro, aplicando um
   padrão quando ausente ou fora do intervalo.
7. IF o bloco `financeiro` falha em carregar para um administrador com permissão, THEN THE
   Cliente_360_View SHALL exibir erro isolado nesse bloco sem derrubar a tela (Partial_Degradation).

### Requirement 10: Bloco Histórico de suporte

**User Story:** Como administrador com `SUPORTE_VIEW`, quero ver o histórico de suporte do cliente na
visão 360, para entender atendimentos passados sem abrir o console de suporte.

#### Acceptance Criteria

1. WHERE o administrador satisfaz `is_admin_with_permission('SUPORTE_VIEW')`, THE Cliente_360_View
   SHALL exibir o bloco `suporte` com os `support_tickets` do Cliente (assunto, status, prioridade,
   data de criação e data de atualização), reusando as tabelas de `notifications-hub`/
   `suporte-inteligente`.
2. THE bloco `suporte` SHALL exibir, por atendimento, a contagem de `support_ticket_messages` e o
   marcador de status conforme o mapeamento de estados de `suporte-inteligente`.
3. WHERE o administrador não satisfaz `is_admin_with_permission('SUPORTE_VIEW')`, THE Cliente_360_View
   SHALL ocultar o bloco `suporte` por completo.
4. WHERE o administrador satisfaz `is_admin_with_permission('SUPORTE_VIEW')`, THE bloco `suporte`
   SHALL oferecer link para `/admin/suporte/<ticket_id>` de cada atendimento.
5. WHEN o Cliente não possui atendimentos, THE bloco `suporte` SHALL exibir o estado vazio `Nenhum
   atendimento registrado.`.
6. IF a leitura do bloco `suporte` falha, THEN THE Cliente_360_View SHALL exibir erro isolado nesse
   bloco sem derrubar a tela (Partial_Degradation).

### Requirement 11: Bloco Histórico de mensagens

**User Story:** Como administrador, quero ver os metadados das conversas do cliente na visão 360, para
dimensionar a interação sem ler o conteúdo privado das mensagens.

#### Acceptance Criteria

1. THE Cliente_360_View SHALL exibir o bloco `mensagens` agregando metadados das conversas de chat de
   frete (`conversations`/`messages`, onde `motorista_id = :id` ou `embarcador_id = :id`) e das
   conversas de suporte (`chat_conversations`/`chat_messages`).
2. THE bloco `mensagens` SHALL exibir, por conversa, o total de mensagens, a data da última mensagem
   e a data da última resposta de admin, sem expor o conteúdo das mensagens.
3. THE Cliente_360_View SHALL não exibir o conteúdo bruto das mensagens de chat no bloco `mensagens`.
4. WHERE o administrador satisfaz `is_admin_with_permission('SUPORTE_REPLY')`, THE bloco `mensagens`
   SHALL oferecer link para abrir a conversa no console de suporte; caso contrário, o link SHALL
   ficar indisponível.
5. WHEN o Cliente não possui conversas, THE bloco `mensagens` SHALL ser exibido (não ocultado) com o
   estado vazio `Nenhuma conversa registrada.`.
6. IF a leitura do bloco `mensagens` falha, THEN THE Cliente_360_View SHALL exibir erro isolado nesse
   bloco sem derrubar a tela (Partial_Degradation).

### Requirement 12: Bloco Histórico de login

**User Story:** Como administrador com `USER_VIEW`, quero ver as tentativas de login do cliente, para
investigar acessos e problemas de autenticação.

#### Acceptance Criteria

1. THE Login_History_RPC SHALL validar `is_admin_with_permission('USER_VIEW')` e SHALL gravar audit
   log negativo `USER_VIEW_DENIED` quando o caller falha o gating, antes de abortar com
   `permission_denied`.
2. THE Login_History_RPC SHALL correlacionar as linhas de `login_attempts` pelo telefone normalizado
   (somente dígitos) do Cliente obtido em `users.phone`.
3. THE Cliente_360_View SHALL exibir o bloco `login` com data/hora, resultado (sucesso ou falha),
   motivo de falha quando houver, IP e user-agent de cada tentativa, ordenados por data decrescente, e
   SHALL manter o bloco `login` visível (não ocultado) com os dados disponíveis mesmo quando o Cliente
   não possui telefone cadastrado.
4. THE Login_History_RPC SHALL rodar `SECURITY DEFINER` com `SET search_path = public` para ler
   `login_attempts` (cuja RLS é restrita a service-role), sem afrouxar a RLS dessa tabela.
5. WHEN o Cliente não possui `phone` cadastrado, THE bloco `login` SHALL exibir a estrutura do bloco
   com o texto placeholder `Sem telefone cadastrado para correlacionar logins.`, sem ocultar a seção
   inteira.
6. THE Cliente_360_View SHALL indicar, no bloco `login`, que o histórico é baseado em tentativas e
   limitado à janela de retenção de `login_attempts` (aproximadamente 30 dias).
7. IF a leitura do bloco `login` falha, THEN THE Cliente_360_View SHALL exibir erro isolado nesse
   bloco sem derrubar a tela (Partial_Degradation).

### Requirement 13: Observações internas — tabela, RLS e leitura

**User Story:** Como administrador com `USER_NOTE_VIEW`, quero registrar e ler observações internas
sobre o cliente, para guardar contexto que nunca pode chegar ao cliente.

#### Acceptance Criteria

1. THE Migration_116 SHALL criar a tabela `admin_user_notes` com ao menos: `id` (uuid pk), `user_id`
   (uuid, FK `users(id)` `ON DELETE CASCADE`, alvo do Cliente), `author_id` (uuid, FK `users(id)`,
   admin autor), `body` (text), `created_at` e `updated_at` (timestamptz).
2. THE Permission_Matrix SHALL definir as ações novas `USER_NOTE_VIEW` e `USER_NOTE_EDIT`, e a função
   `is_admin_with_permission` SHALL reconhecê-las com a mesma concessão por papel.
3. THE Permission_Matrix SHALL conceder `USER_NOTE_VIEW` e `USER_NOTE_EDIT` apenas a `SUPER_ADMIN` e
   `ADMIN`, negando a `SUPORTE`, `FINANCEIRO` e `MODERADOR` por construção (deny-by-default).
4. THE Migration_116 SHALL habilitar RLS em `admin_user_notes` admitindo SELECT apenas para
   administradores que satisfaçam `is_admin_with_permission('USER_NOTE_VIEW')`.
5. THE Migration_116 SHALL impedir, via RLS, qualquer SELECT, INSERT, UPDATE ou DELETE de
   `admin_user_notes` por role `anon` ou por usuário não-admin (incluindo o próprio Cliente).
6. WHERE o administrador satisfaz `is_admin_with_permission('USER_NOTE_VIEW')`, THE Cliente_360_View
   SHALL exibir o bloco `notas` com as `Internal_Note` do Cliente (corpo, autor, data) ordenadas por
   data decrescente.
7. WHERE o administrador não satisfaz `is_admin_with_permission('USER_NOTE_VIEW')`, THE
   Cliente_360_View SHALL ocultar o bloco `notas` por completo.
8. THE Internal_Notes SHALL garantir que nenhuma `Internal_Note` seja exposta em qualquer superfície
   acessível ao Cliente, em nenhuma rota pública ou autenticada não-admin.

### Requirement 14: Observações internas — CRUD, versionamento e idempotência

**User Story:** Como administrador com `USER_NOTE_EDIT`, quero criar, editar e remover observações
internas com segurança, para manter o histórico interno consistente entre admins.

#### Acceptance Criteria

1. WHERE o administrador satisfaz `is_admin_with_permission('USER_NOTE_EDIT')`, THE Cliente_360_View
   SHALL exibir os controles de criar, editar e remover `Internal_Note`; caso contrário, SHALL
   ocultá-los.
2. WHEN um administrador com `USER_NOTE_EDIT` cria uma `Internal_Note`, THE Internal_Notes SHALL
   validar `body` com tamanho entre 1 e 5000 caracteres e SHALL registrar audit log `USER_NOTE_CREATE`
   via `executeAdminMutation`.
3. IF o `body` viola a validação de tamanho, THEN THE Internal_Notes SHALL recusar a operação com erro
   de validação descritivo em pt-BR e NÃO SHALL persistir a `Internal_Note`, aplicando essa validação
   de tamanho sempre, independentemente do estado do sistema e sem qualquer bypass por validação
   desabilitada.
4. WHEN um administrador com `USER_NOTE_EDIT` edita uma `Internal_Note`, THE Internal_Notes SHALL
   persistir a mudança usando `expected_updated_at` e SHALL registrar audit log `USER_NOTE_UPDATE` via
   `executeAdminMutation`.
5. IF o `expected_updated_at` informado diverge do `updated_at` atual da `Internal_Note`, THEN THE
   Internal_Notes SHALL recusar a edição com `STALE_VERSION` sem mutar.
6. WHEN um administrador com `USER_NOTE_EDIT` remove uma `Internal_Note`, THE Internal_Notes SHALL
   registrar audit log `USER_NOTE_DELETE` via `executeAdminMutation`.
7. WHEN a `Internal_Note` alvo já não existe, THE Internal_Notes SHALL tratar a remoção como
   idempotente exclusivamente nesse caso de inexistência, retornando
   `{ skipped: true, reason: 'ALREADY_REMOVED' }` e gravando `USER_NOTE_DELETE_SKIPPED`, sem nova
   mutação.
8. IF a checagem de `USER_NOTE_EDIT` falha para o caller, THEN as RPCs de mutação de `Internal_Note`
   SHALL recusar com `permission_denied` e gravar audit log negativo `USER_NOTE_VIEW_DENIED`,
   independentemente do papel do caller.
9. THE RPCs de mutação de `Internal_Note` SHALL chamar a proteção do Master_Admin antes de qualquer
   escrita, recusando notas cujo `user_id` alvo seja o Master_Admin com a precedência de imutabilidade
   do projeto.
10. IF a remoção de uma `Internal_Note` encontra qualquer condição de erro distinta da inexistência
    da nota alvo, THEN THE Internal_Notes SHALL falhar a operação normalmente, propagando o erro sem
    tratá-lo como sucesso nem como skip idempotente.

### Requirement 15: Privacidade, precedência de permissão e não-vazamento

**User Story:** Como engenharia de segurança, quero que a visão 360 exponha PII e dados de pagamento
apenas a admin com a permissão correta e respeite a precedência de `permission_denied`, para que não
haja vazamento entre contas nem em logs.

#### Acceptance Criteria

1. THE Cliente_360_Service SHALL exigir `USER_VIEW` para qualquer bloco e SHALL exigir adicionalmente
   `FINANCEIRO_VIEW` para o bloco `financeiro`, `SUPORTE_VIEW` para o bloco `suporte` e
   `USER_NOTE_VIEW` para o bloco `notas`.
2. WHERE um bloco requer permissão que o caller não possui, THE Cliente_360_Service SHALL omitir os
   dados desse bloco do `Cliente_360_Bundle`, sem retornar PII parcial daquele bloco.
3. IF uma RPC desta spec encontra simultaneamente falta de permissão e erro de validação de input,
   THEN THE RPC SHALL responder `permission_denied`, dando precedência à falha de permissão sobre a
   de validação.
4. THE Cliente_360_Service e as RPCs desta spec SHALL não registrar PII bruta (e-mail, telefone, CPF,
   CNPJ), conteúdo de mensagens nem segredos em logs estruturados, traces ou audit logs.
5. THE RPCs desta spec SHALL garantir que um Cliente nunca acesse dados de outro Cliente: toda leitura
   server-side é mediada por gating de admin (`is_admin_with_permission`) ou por RLS `own-row`, sem
   cruzamento entre contas.
6. WHERE o caller é anônimo (`auth.uid()` nulo), THE RPCs desta spec SHALL recusar com
   `permission_denied`, exceto onde o caso de uso explicitamente suportasse `anon` (não há, nesta
   spec).

### Requirement 16: Migration 116, idempotência e rollback

**User Story:** Como engenheiro, quero aplicar a migration 116 sem efeitos colaterais em
reexecuções, para manter o banco consistente e reversível.

#### Acceptance Criteria

1. THE Migration_116 SHALL ser nomeada `supabase/migrations/116_admin_cliente_360.sql` e SHALL ser
   envelopada em `BEGIN; ... COMMIT;`.
2. THE Migration_116 SHALL ser idempotente: reexecução não causa erro nem duplica objetos, usando
   `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` e
   `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
3. THE Migration_116 SHALL incluir blocos `DO $check$` defensivos validando que `is_admin_with_permission(text)`,
   `admin_audit_logs`, `users`, `subscriptions`, `subscription_charges`, `support_tickets`,
   `conversations` e `login_attempts` existem, levantando exceção clara quando ausentes.
4. THE Migration_116 SHALL criar a tabela `admin_user_notes`, suas policies RLS, a Global_Search_RPC,
   a Financial_History_RPC, a Login_History_RPC e as RPCs de CRUD de `Internal_Note`, todas seguindo a
   postura de segurança de RPC do projeto (`SET search_path = public`, `auth.uid()` checado,
   `is_admin_with_permission` quando aplicável, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated`).
5. WHERE for necessária uma segunda migration, THE entrega SHALL usar o sufixo `116b_...`, preservando
   os números 117 e 118 para specs futuras.
6. THE Migration_116 SHALL ser acompanhada de `116_admin_cliente_360_rollback.sql` documentado e não
   auto-aplicado, que reverte as RPCs, policies e a tabela `admin_user_notes` introduzidas.
7. THE Migration_116 SHALL incluir um bloco `-- VERIFY` comentado com SELECTs de smoke test.
8. THE Migration_116 SHALL não reescrever nem destruir dados das tabelas reusadas (`users`,
   `subscriptions`, `subscription_charges`, `support_tickets`, `conversations`, `login_attempts`,
   `financial_repasses`).

### Requirement 17: Governança — validação, estabilidade, arquitetura e testes

**User Story:** Como mantenedor da plataforma, quero que esta feature seja entregue com validação,
estabilidade, arquitetura modular e testes completos, para que vá para produção sem comprometer o que
já existe.

#### Acceptance Criteria

1. THE Cliente_360 SHALL validar todo input (tipo, formato, regra de negócio, sanitização e
   consistência) no frontend **e** no backend, recusando entradas inválidas em ambas as camadas.
2. WHEN um formulário de `Internal_Note` é submetido com input inválido, THE Cliente_360_View SHALL
   bloquear o envio efetivo ao backend (nenhum dado inválido é persistido) **e** exibir mensagem de
   erro em pt-BR, ambos, apresentando os erros de validação inline; embora a UI POSSA manter o botão
   de submit habilitado para permitir a tentativa, a submissão efetiva ao backend SHALL permanecer
   bloqueada enquanto a validação de input falhar, e o backend SHALL revalidar e rejeitar o input
   inválido (defesa em profundidade, conforme 17.1), preservando a regra do steering
   `testing-governance` (envio bloqueado E mensagem de erro em pt-BR, ambos).
3. IF qualquer operação desta spec encontra erro, THEN THE Cliente_360 SHALL tratar o erro de forma
   segura, registrá-lo de forma estruturada (sem PII bruta nem segredos) e manter o restante do
   sistema operável, sem interrupção desnecessária.
4. WHILE múltiplas fontes de dados de blocos estão indisponíveis simultaneamente, THE Cliente_360_View
   SHALL manter a degradação controlada, renderizando os blocos disponíveis sem falha total da tela.
5. THE Cliente_360 SHALL ser implementado de forma modular (service, RPCs, componentes de bloco
   isolados), reusando os helpers canônicos de `src/services/admin/` e `src/__tests__/_helpers/` sem
   reimplementá-los.
6. THE Cliente_360 SHALL incluir testes automatizados unit + property (para as Correctness
   Properties), cenários de falha (caminhos negativos, limites, falha de bloco) e validações de
   frontend e backend, conforme o steering `testing-governance`.
7. THE Cliente_360 SHALL atualizar a Regression_Suite incorporando os novos testes, de modo que
   qualquer falha bloqueie merge e deploy.
8. THE Cliente_360 SHALL não reduzir a cobertura mínima dos Critical_Modules tocados, conforme
   `tests/coverage.config.ts`.

## Propriedades de Corretude (Correctness Properties)

As propriedades abaixo são **obrigatórias** (sem asterisco) e serão formalizadas em `design.md` e
implementadas como property tests (`cp<N>_<nome>.property.test.ts`). As opcionais levam `*`.

- **CP-1 — Determinismo da busca**: para todo `Search_Query` e conjunto de dados fixos, a
  Global_Search_RPC retorna sempre a mesma sequência ordenada de `Search_Result` (Requirement 3.5,
  ordenação total por `Match_Rank`, `name`, `id`).
- **CP-2 — Isolamento da busca**: nenhum `Search_Result` inclui usuário com `user_type = 'admin'`, e
  toda chamada sem `USER_VIEW` retorna `permission_denied` sem vazar `Search_Result` (Requirement
  2.7, 4.1, 4.6).
- **CP-3 — Sanitização e fronteiras da query**: para toda `Search_Query`, a `Sanitized_Query` escapa
  os curingas de `ILIKE` (`%`, `_`, `\`) e a busca trata query vazia/curta retornando conjunto vazio
  sem erro (Requirement 2.2, 2.3).
- **CP-4 — Degradação parcial por bloco**: para qualquer combinação de blocos que falham, a falha de
  um `Detail_Block` distinto do `Source_Block` não derruba os demais, e apenas o `Source_Block` lança
  `NOT_FOUND` (Requirement 7).
- **CP-5 — Precedência de `permission_denied`**: para toda RPC desta spec, na presença simultânea de
  falta de permissão e erro de validação, o resultado é `permission_denied` (Requirement 15.3).
- **CP-6 — Notas internas nunca expostas a não-admin**: para toda leitura por role `anon`,
  `authenticated` não-admin ou pelo próprio Cliente, `admin_user_notes` retorna zero linhas via RLS
  (Requirement 13.5, 13.8).
- **CP-7 — Idempotência e versionamento das notas**: remover uma `Internal_Note` inexistente retorna
  `{ skipped: true, reason: 'ALREADY_REMOVED' }` sem mutar; qualquer outra condição de erro na remoção
  falha normalmente (sem skip); editar com `expected_updated_at` divergente retorna `STALE_VERSION`;
  N remoções produzem exatamente 1 `USER_NOTE_DELETE` e (N-1) `USER_NOTE_DELETE_SKIPPED`
  (Requirement 14.5, 14.7, 14.10).
- **CP-8 — Privacidade por bloco**: o bloco `financeiro` só compõe o `Cliente_360_Bundle` com
  `FINANCEIRO_VIEW`, o `suporte` com `SUPORTE_VIEW` e o `notas` com `USER_NOTE_VIEW`; sem a permissão,
  o bloco é omitido sem PII parcial (Requirement 9.3, 10.3, 13.7, 15.2).
- **CP-9\*** — *Correlação de login por telefone*: a Login_History_RPC retorna apenas tentativas cujo
  `phone` normalizado é igual ao do Cliente, dentro da janela de retenção (Requirement 12.2).
