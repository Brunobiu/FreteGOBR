# Requirements Document

## Introduction

Esta spec entrega o módulo **Configurações** do painel administrativo do FreteGO, acessível em
`/admin/settings`. O item de menu já existe na `AdminSidebar` apontando para essa rota (gated por
`SETTINGS_VIEW`), porém a rota e a página nunca foram construídas e atualmente resultam em 404. As
permissões `SETTINGS_VIEW` e `SETTINGS_EDIT` já estão reservadas em
`src/services/admin/permissions.ts` (concedidas a `SUPER_ADMIN` e `ADMIN`; negadas a `SUPORTE`,
`FINANCEIRO` e `MODERADOR`).

O objetivo é prover um local único e seguro para **configurações da plataforma**: um armazenamento
de settings (tipado por categoria), uma página de administração que segue os padrões compactos do
painel, gating de RBAC em duas camadas (`SETTINGS_VIEW` para visualizar, `SETTINGS_EDIT` para
alterar), auditoria por construção via `executeAdminMutation`, versionamento otimista com
`STALE_VERSION` e tratamento seguro de segredos de integração (armazenamento server-side e
mascaramento na leitura).

O módulo organiza as configurações em categorias:

1. **Integrações** — armazenamento genérico de credenciais/parâmetros de integrações externas,
   com um conjunto inicial de campos reservados (placeholder) para a futura integração
   **Evolution API** (automação de WhatsApp): URL base da API, chave/token da API (segredo), nome
   da instância e status de conexão. O armazenamento é genérico o bastante para acomodar futuras
   integrações sem nova migration de schema.
2. **Parâmetros de Trial** — duração do período de teste (hoje fixa em 30 dias no código da feature
   `trial-e-bloqueio`), editável pelo admin sem alteração de código.
3. **Preços de Planos** — valores exibidos na tela de bloqueio (`TrialExpiredPage`), hoje fixos em
   código (Mensal R$ 39,00; Trimestral R$ 87,00; Semestral R$ 150,00), editáveis pelo admin.
4. **Configurações de IA** — área estruturada/placeholder para settings relacionados a IA, a serem
   detalhados em spec futura.
5. **Geral** — configurações gerais da plataforma (ex.: contato de suporte, toggles de
   funcionalidade).

A stack permanece TypeScript (strict) + React 18 + Vite + TailwindCSS + Supabase + Vitest +
fast-check. Esta spec adiciona a **migration 045** (`045_admin_settings.sql` + par de rollback
documentado), o service `src/services/admin/settings.ts`, componentes em
`src/components/admin/settings/`, a página `/admin/settings` e o registro da rota no `AdminGuard`.

### Fora de escopo (não construído nesta spec)

Esta spec entrega **somente** o módulo Configurações em si: o armazenamento de settings, a UI de
gestão, o RBAC, a auditoria, o versionamento otimista e o mascaramento de segredos. Estão
explicitamente **FORA** de escopo (specs futuras):

- A integração **Evolution API / automação de WhatsApp** em si (envio de mensagens, webhooks,
  gerenciamento de instância, teste de conexão real). Esta spec apenas **armazena** os parâmetros
  e segredos dessa integração; nenhuma chamada à Evolution API é feita.
- As **funcionalidades de IA** propriamente ditas. Esta spec apenas reserva a área de settings.
- O módulo de **CRM**.
- O **consumo** dos parâmetros de trial e preços de plano pelas features existentes
  (`trial-e-bloqueio`, `TrialExpiredPage`). Esta spec apenas torna esses valores **editáveis e
  legíveis**; a refatoração das features que hoje têm valores fixos para lerem do store é tratada
  em ajuste posterior.
- Rotação automática de segredos, integração com cofre externo de terceiros, versionamento
  histórico de cada alteração de setting (mantém-se apenas o estado atual + audit log).

## Glossary

- **Admin_Panel**: Painel administrativo entregue em `admin-foundation` (migration 030), acessível
  em `/admin/*`.
- **AdminGuard / AdminProvider / AdminLayoutRoute / AdminShell / AdminSidebar**: Componentes de
  fundação do painel, reusados sem alteração de contrato.
- **Stealth_404**: Página 404 visualmente idêntica à 404 pública, renderizada para acessos não
  autorizados, sem revelar a existência da rota.
- **Permission_Matrix**: Matriz `(AdminRole, AdminAction) -> boolean` em
  `src/services/admin/permissions.ts`. `SETTINGS_VIEW` e `SETTINGS_EDIT` já existem desde a
  migration 030. Esta spec **não** adiciona action nova.
- **SETTINGS_VIEW**: Permissão de leitura das configurações. Concedida a `SUPER_ADMIN` e `ADMIN`.
- **SETTINGS_EDIT**: Permissão de alteração das configurações. Concedida a `SUPER_ADMIN` e `ADMIN`.
- **executeAdminMutation**: Wrapper de audit-by-construction em `src/services/admin/audit.ts`. Toda
  alteração de configuração passa por aqui.
- **is_admin_with_permission**: Função SQL (migration 030) que reproduz a `Permission_Matrix`
  server-side, usada em todas as RPCs `SECURITY DEFINER`.
- **Settings_Store**: Armazenamento de configurações da plataforma. Tabela `platform_settings`
  modelada como registros de chave-valor tipados por categoria, contendo o estado vigente de cada
  configuração.
- **Setting_Category**: Domínio fechado da categoria de uma configuração:
  `'integrations'`, `'trial'`, `'plans'`, `'ai'`, `'general'`.
- **Setting_Key**: Identificador único e estável de uma configuração dentro de uma categoria
  (em inglês, snake_case), ex.: `trial_duration_days`, `plan_price_mensal`,
  `evolution_api_base_url`.
- **Secret_Setting**: Configuração marcada como segredo (ex.: chave/token de integração). O valor
  bruto é armazenado server-side via Supabase Vault e **nunca** é retornado integralmente ao
  cliente após o salvamento.
- **Vault**: Extensão `supabase_vault` (já em uso na migration 042b) usada para guardar segredos
  de forma criptografada server-side.
- **Masked_Value**: Representação não sensível de um `Secret_Setting` retornada ao cliente, no
  formato de máscara com os últimos 4 caracteres visíveis (ex.: `••••••••3f9a`) mais um indicador
  booleano `is_set`.
- **Evolution_Integration_Settings**: Conjunto inicial de `Setting_Key` reservados na categoria
  `integrations` para a futura integração Evolution API: `evolution_api_base_url` (texto),
  `evolution_api_key` (segredo), `evolution_instance_name` (texto) e `evolution_connection_status`
  (texto somente leitura, domínio fechado).
- **Trial_Settings**: Configurações da categoria `trial`, inicialmente `trial_duration_days`
  (inteiro, dias).
- **Plan_Price_Settings**: Configurações da categoria `plans`, inicialmente `plan_price_mensal`,
  `plan_price_trimestral`, `plan_price_semestral` (valores monetários em centavos, inteiros).
- **AI_Settings**: Configurações da categoria `ai`, reservadas como placeholder estruturado.
- **General_Settings**: Configurações da categoria `general`, ex.: `support_contact_email`,
  `support_contact_phone`, e toggles de funcionalidade booleanos.
- **Setting_Value_Type**: Tipo do valor de uma configuração: `'string'`, `'integer'`, `'money'`,
  `'boolean'`, `'secret'`, `'enum'`.
- **STALE_VERSION**: Erro tipado lançado quando o `expected_updated_at` enviado não corresponde ao
  `updated_at` atual do registro (versionamento otimista).
- **Settings_Service**: Service em `src/services/admin/settings.ts` com a lógica de leitura e
  mutação das configurações.
- **Settings_Page**: Página `/admin/settings` que renderiza as categorias de configuração em
  layout compacto (padrão pós-cleanup).
- **Compact_Layout_Pattern**: Padrão de UI compacta do painel admin: sem `<h1>` grande, filtros em
  popover via ícone `SlidersHorizontal`, paginação `10/50/100` (default 10) onde houver listas,
  botões `text-xs px-2.5 py-1`.
- **Migration_045**: `supabase/migrations/045_admin_settings.sql`, idempotente, com par de rollback
  documentado (`045_admin_settings_rollback.sql`), próxima numeração livre após 044.
- **Action codes** (inglês, gravados em `admin_audit_logs`): `SETTINGS_UPDATED`,
  `SETTINGS_SECRET_UPDATED`, `SETTINGS_SECRET_CLEARED`, `SETTINGS_VIEW_DENIED`.

## Requirements

### Requirement 1: Rota /admin/settings, gating e padrão compacto

**User Story:** Como admin com `SETTINGS_VIEW`, quero acessar `/admin/settings` para visualizar as
configurações da plataforma, seguindo o padrão visual compacto dos demais módulos admin.

#### Acceptance Criteria

1. THE Admin_Panel SHALL registrar a rota `/admin/settings` renderizando a Settings_Page.
2. WHEN um admin com `SETTINGS_VIEW` acessa `/admin/settings`, THE AdminGuard SHALL renderizar a
   Settings_Page.
3. IF um admin sem `SETTINGS_VIEW` acessa `/admin/settings`, THEN THE AdminGuard SHALL renderizar
   Stealth_404.
4. WHERE o usuário atual tem perfil `SUPORTE`, `FINANCEIRO` ou `MODERADOR`, THE AdminGuard SHALL
   renderizar Stealth_404 ao acessar `/admin/settings`.
5. THE Settings_Page SHALL omitir o `<h1>` grande no topo da página, seguindo o
   Compact_Layout_Pattern.
6. THE AdminSidebar SHALL manter o item Configurações apontando para `/admin/settings`, gated por
   `SETTINGS_VIEW`.
7. WHERE existem múltiplas Setting_Category, THE Settings_Page SHALL agrupar as configurações por
   categoria em seções identificáveis (Integrações, Trial, Planos, IA, Geral).

### Requirement 2: Visualização das configurações por categoria

**User Story:** Como admin com `SETTINGS_VIEW`, quero ver os valores atuais de cada configuração
agrupados por categoria, para que eu acompanhe o estado da plataforma.

#### Acceptance Criteria

1. WHEN um admin com `SETTINGS_VIEW` abre a Settings_Page, THE Settings_Service SHALL retornar o
   estado vigente de todas as configurações não-secretas com seus valores atuais.
2. THE Settings_Service SHALL retornar, para cada configuração, a Setting_Key, a Setting_Category,
   o Setting_Value_Type, o valor atual e o `updated_at`.
3. WHERE uma configuração é um Secret_Setting, THE Settings_Service SHALL retornar o Masked_Value e
   o indicador `is_set` em vez do valor bruto.
4. THE Settings_Service SHALL validar `is_admin_with_permission('SETTINGS_VIEW')` no servidor antes
   de retornar qualquer valor de configuração.
5. IF um admin sem `SETTINGS_VIEW` invoca a leitura de configurações no servidor, THEN THE
   Settings_Service SHALL negar a leitura e registrar `SETTINGS_VIEW_DENIED` em `admin_audit_logs`
   com `before` nulo e `after` contendo `user_id` e `reason`.
6. WHEN o caller é anônimo, com `auth.uid()` nulo, THE Settings_Service SHALL negar a leitura.
7. WHERE a leitura de uma categoria falha de forma isolada, THE Settings_Page SHALL renderizar as
   demais categorias normalmente e exibir um estado de erro com botão Tentar novamente apenas na
   categoria afetada.

### Requirement 3: Edição de configurações com RBAC, auditoria e versionamento otimista

**User Story:** Como admin com `SETTINGS_EDIT`, quero alterar valores de configuração com
rastreabilidade completa, para que cada mudança fique auditada e protegida contra escrita
concorrente.

#### Acceptance Criteria

1. WHERE o usuário atual não tem `SETTINGS_EDIT`, THE Settings_Page SHALL ocultar os controles de
   edição e o botão Salvar, exibindo as configurações em modo somente leitura.
2. WHEN um admin com `SETTINGS_EDIT` salva uma alteração de configuração, THE Settings_Service
   SHALL persistir o novo valor através de `executeAdminMutation` com `action` igual a
   `SETTINGS_UPDATED`, `targetType` igual a `platform_settings` e `targetId` igual à Setting_Key.
3. WHEN uma alteração de configuração é de fato persistida, THE Settings_Service SHALL registrar no
   audit log o snapshot `before` e `after` da alteração, omitindo valores brutos de Secret_Setting
   tanto em `before` quanto em `after`; quando nenhuma alteração é salva, nenhum audit log de
   alteração é gravado.
4. THE Settings_Service SHALL aplicar versionamento otimista usando `updated_at` na atualização de
   cada configuração.
5. WHEN a edição de uma configuração é aberta, THE Settings_Page SHALL ler imediatamente o
   `updated_at` vigente dessa configuração e enviar esse valor de volta na chamada de salvamento.
6. IF o `expected_updated_at` enviado não corresponde ao `updated_at` atual do registro, THEN THE
   Settings_Service SHALL rejeitar a atualização com o erro `STALE_VERSION` sem mutar o valor.
7. WHEN o salvamento retorna `STALE_VERSION`, THE Settings_Page SHALL exibir o toast
   `Outro admin atualizou. Recarregando.` e recarregar os valores vigentes.
8. THE rpc server-side de atualização de configuração SHALL validar
   `is_admin_with_permission('SETTINGS_EDIT')` e registrar `SETTINGS_VIEW_DENIED` em
   `admin_audit_logs` quando a permissão falhar.
9. WHEN o caller é anônimo, com `auth.uid()` nulo, THE rpc de atualização SHALL retornar
   `permission_denied`.
10. WHEN o salvamento conclui com sucesso, THE Settings_Page SHALL exibir o toast
    `Configuração salva.` e recarregar o valor atualizado, incluindo o novo `updated_at`.

### Requirement 4: Armazenamento e mascaramento seguro de segredos de integração

**User Story:** Como plataforma, quero que segredos de integração sejam guardados com segurança no
servidor e nunca devolvidos integralmente ao cliente, para que credenciais não vazem pelo painel.

#### Acceptance Criteria

1. WHEN um admin com `SETTINGS_EDIT` salva um Secret_Setting, THE Settings_Service SHALL armazenar
   o valor bruto server-side via Vault, sem persistir o valor bruto em colunas legíveis de
   `platform_settings`.
2. WHEN a leitura de configurações inclui um Secret_Setting, THE Settings_Service SHALL retornar o
   Masked_Value com os últimos 4 caracteres visíveis e o indicador `is_set`, sem retornar o valor
   bruto.
3. THE Settings_Service SHALL gravar o audit log de alteração de segredo com `action` igual a
   `SETTINGS_SECRET_UPDATED`, registrando apenas metadados não sensíveis, como `is_set` e os
   últimos 4 caracteres, sem o valor bruto.
4. WHEN um admin com `SETTINGS_EDIT` remove um Secret_Setting já definido, THE Settings_Service
   SHALL apagar o valor server-side, definir `is_set` como falso e gravar o audit log com `action`
   igual a `SETTINGS_SECRET_CLEARED`.
5. WHILE um Secret_Setting tem `is_set` igual a falso, THE Settings_Page SHALL exibir o campo como
   vazio com o rótulo `Não configurado`.
6. WHILE um Secret_Setting tem `is_set` igual a verdadeiro, THE Settings_Page SHALL exibir o
   Masked_Value e um controle para Substituir ou Remover o segredo.
7. WHEN um admin envia o campo de Secret_Setting em branco em uma operação de salvamento que não é
   de remoção, THE Settings_Service SHALL preservar o valor server-side existente sem alterá-lo.
8. THE leitura do valor bruto de um Secret_Setting SHALL ser restrita ao uso server-side por
   processos de integração, e não SHALL ser exposta por nenhuma RPC consumível pelo cliente do
   painel.

### Requirement 5: Categoria Integrações com campos reservados da Evolution API

**User Story:** Como admin com `SETTINGS_EDIT`, quero registrar os parâmetros e o segredo da futura
integração Evolution API em um local seguro, para que a integração possa ser ativada em spec
futura sem alteração de código.

#### Acceptance Criteria

1. THE Settings_Store SHALL conter as Evolution_Integration_Settings na categoria `integrations`:
   `evolution_api_base_url`, `evolution_api_key`, `evolution_instance_name` e
   `evolution_connection_status`.
2. THE Settings_Service SHALL tratar `evolution_api_key` como Secret_Setting, aplicando o
   armazenamento e mascaramento definidos no Requirement 4.
3. WHEN um admin salva `evolution_api_base_url`, THE Settings_Service SHALL validar que o valor é
   uma URL absoluta com esquema `https`.
4. IF `evolution_api_base_url` não é uma URL `https` válida, THEN THE Settings_Page SHALL exibir
   erro inline e desabilitar o botão Salvar dessa configuração.
5. THE Settings_Service SHALL tratar `evolution_connection_status` como valor somente leitura no
   painel, com domínio fechado `'disconnected'`, `'connecting'`, `'connected'`, `'error'` e valor
   inicial `'disconnected'`.
6. THE Settings_Store SHALL permitir o registro de novas Setting_Key na categoria `integrations`
   sem exigir alteração de schema, mantendo o armazenamento genérico de chave-valor tipado.
7. THE Settings_Page SHALL exibir um aviso informativo de que a integração Evolution API ainda não
   está ativa e que os valores são apenas armazenados para uso futuro.

### Requirement 6: Categoria Parâmetros de Trial

**User Story:** Como admin com `SETTINGS_EDIT`, quero ajustar a duração do período de teste sem
alterar código, para que eu controle a política de trial pela plataforma.

#### Acceptance Criteria

1. THE Settings_Store SHALL conter `trial_duration_days` na categoria `trial`, do tipo `integer`,
   com valor inicial igual a 30.
2. WHEN um admin salva `trial_duration_days`, THE Settings_Service SHALL validar que o valor é um
   inteiro entre 1 e 365 inclusive.
3. IF o valor de `trial_duration_days` está fora do intervalo de 1 a 365, THEN THE Settings_Page
   SHALL exibir erro inline e desabilitar o botão Salvar dessa configuração.
4. THE Settings_Service SHALL expor `trial_duration_days` na leitura de configurações para que
   features consumidoras possam ler o valor vigente.

### Requirement 7: Categoria Preços de Planos

**User Story:** Como admin com `SETTINGS_EDIT`, quero editar os preços dos planos exibidos na tela
de bloqueio, para que os valores possam ser atualizados sem alteração de código.

#### Acceptance Criteria

1. THE Settings_Store SHALL conter `plan_price_mensal`, `plan_price_trimestral` e
   `plan_price_semestral` na categoria `plans`, do tipo `money` em centavos, com valores iniciais
   3900, 8700 e 15000 respectivamente.
2. WHEN um admin salva um preço de plano, THE Settings_Service SHALL validar que o valor é um
   inteiro maior ou igual a 0 e menor ou igual a 1000000 centavos.
3. IF um preço de plano está fora do intervalo de 0 a 1000000 centavos, THEN THE Settings_Page
   SHALL exibir erro inline e desabilitar o botão Salvar dessa configuração.
4. THE Settings_Page SHALL exibir e editar os preços de plano em reais com duas casas decimais,
   convertendo de e para centavos.
5. THE Settings_Service SHALL expor os preços de plano vigentes na leitura de configurações para
   que a tela de bloqueio possa lê-los.

### Requirement 8: Categoria Configurações de IA (placeholder)

**User Story:** Como admin, quero uma área reservada para configurações de IA, para que o módulo já
acomode esses settings quando forem detalhados.

#### Acceptance Criteria

1. THE Settings_Store SHALL reservar a categoria `ai` para configurações de IA.
2. THE Settings_Page SHALL sempre exibir a seção IA, com conteúdo variável conforme existam ou não
   configurações definidas, incluindo um aviso informativo de que as configurações de IA serão
   detalhadas em uma entrega futura.
3. WHERE não existe nenhuma configuração definida na categoria `ai`, THE Settings_Page SHALL exibir
   a seção IA em estado vazio sem gerar erro.
4. THE Settings_Store SHALL permitir o registro de novas Setting_Key na categoria `ai` sem exigir
   alteração de schema.

### Requirement 9: Categoria Geral

**User Story:** Como admin com `SETTINGS_EDIT`, quero gerenciar configurações gerais da plataforma,
como contato de suporte e toggles de funcionalidade, para que eu ajuste comportamentos globais.

#### Acceptance Criteria

1. THE Settings_Store SHALL conter na categoria `general` as configurações `support_contact_email`
   (tipo `string`) e `support_contact_phone` (tipo `string`).
2. WHEN um admin salva `support_contact_email`, THE Settings_Service SHALL validar que o valor é um
   e-mail em formato válido ou uma string vazia.
3. IF `support_contact_email` é não vazio e não está em formato de e-mail válido, THEN THE
   Settings_Page SHALL exibir erro inline e desabilitar o botão Salvar dessa configuração.
4. THE Settings_Store SHALL suportar configurações do tipo `boolean` na categoria `general` para
   toggles de funcionalidade.
5. WHEN um admin alterna um toggle de funcionalidade do tipo `boolean`, THE Settings_Service SHALL
   persistir o novo valor através de `executeAdminMutation` com `action` igual a `SETTINGS_UPDATED`.

### Requirement 10: Validação de valores por tipo

**User Story:** Como sistema, quero validar cada valor de configuração conforme seu tipo no cliente
e no servidor, para que dados inválidos não sejam persistidos.

#### Acceptance Criteria

1. THE Settings_Service SHALL validar o valor de cada configuração contra seu Setting_Value_Type no
   servidor antes de persistir.
2. IF um valor enviado não corresponde ao Setting_Value_Type da configuração, THEN THE
   Settings_Service SHALL rejeitar a operação com um erro de validação e não SHALL persistir o
   valor.
3. WHERE uma configuração é do tipo `enum`, THE Settings_Service SHALL rejeitar valores fora do
   domínio fechado definido para aquela Setting_Key.
4. WHEN um admin tenta salvar uma Setting_Key inexistente no Settings_Store, THE Settings_Service
   SHALL rejeitar a operação sem criar registros novos.
5. THE Settings_Page SHALL replicar as validações de tipo e intervalo no cliente para feedback
   inline, mantendo o servidor como autoridade final.

### Requirement 11: Migration 045 e idempotência

**User Story:** Como engenheiro, quero aplicar a migration 045 sem efeitos colaterais em
reexecuções, para que o deploy seja seguro e reversível.

#### Acceptance Criteria

1. THE Migration_045 SHALL ser nomeada `supabase/migrations/045_admin_settings.sql`.
2. THE Migration_045 SHALL ser envelopada em `BEGIN; ... COMMIT;`.
3. THE Migration_045 SHALL ser idempotente em reexecução, usando `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` antes de
   `CREATE POLICY` e `INSERT ... ON CONFLICT DO NOTHING` para os seeds iniciais.
4. THE Migration_045 SHALL incluir bloco `DO $check$` defensivo validando que
   `is_admin_with_permission` e `admin_audit_logs` existem, levantando exceção clara caso ausentes.
5. THE Migration_045 SHALL semear os valores iniciais das configurações conhecidas:
   `trial_duration_days` igual a 30; `plan_price_mensal` igual a 3900; `plan_price_trimestral`
   igual a 8700; `plan_price_semestral` igual a 15000; `evolution_connection_status` igual a
   `disconnected`, sem sobrescrever valores já existentes.
6. THE Migration_045 SHALL definir as RPCs de leitura e mutação como `SECURITY DEFINER` com
   `SET search_path = public`, `REVOKE ALL FROM PUBLIC` e `GRANT EXECUTE TO authenticated`.
7. THE Migration_045 SHALL ser acompanhada de `045_admin_settings_rollback.sql` que documenta os
   `DROP` reversos, não auto-aplicado.
8. THE Migration_045 SHALL conter um bloco `-- VERIFY` comentado com SELECTs de smoke test.

### Requirement 12: Acessibilidade e responsividade

**User Story:** Como admin usando teclado, leitor de tela ou dispositivo móvel, quero gerenciar as
configurações com a mesma cobertura, para que o módulo seja acessível.

#### Acceptance Criteria

1. THE Settings_Page SHALL associar cada campo de configuração a um rótulo via `htmlFor` ou
   `aria-label`.
2. THE Settings_Page SHALL ser responsiva e legível em telas menores que 768px, empilhando as
   seções em coluna única.
3. THE Settings_Page SHALL exibir os toasts de sucesso e erro com `role` igual a `status` ou
   `alert`, conforme apropriado.
4. WHERE um controle de ação é apenas ícone, THE Settings_Page SHALL prover `aria-label` descritivo.
5. THE Settings_Page SHALL manter contraste mínimo WCAG AA nos textos e controles interativos.
