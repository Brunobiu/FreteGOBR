# Requirements Document

## Introduction

Esta spec de **finalização/fechamento** consolida tudo o que ainda falta, de forma factual e baseada
em **auditoria real do código** (e não em checkboxes desatualizados de outras specs), para levar o
FreteGO ao estado **"pronto para lançar"** sem quebrar nada do que já funciona.

O FreteGO é uma plataforma de fretes: front-end web em React 18 + TypeScript (strict) + Vite +
TailwindCSS; back-end Supabase (Postgres + Auth + Storage + Edge Functions Deno); app Android via
Capacitor. Hospedagem na Vercel; pagamentos via Asaas; e-mail via Resend; push via Firebase FCM; IA
via Claude/Gemini.

A auditoria do código identificou seis grandes áreas de trabalho restante, ordenadas da maior entrega
de produto à validação operacional:

1. **Admin Settings** — a **única** spec genuinamente não implementada (0%). Não existe migration, nem
   service, nem página, nem rota efetiva (a rota cai em `Stealth_404`), nem testes. Já existem apenas
   as permissões `SETTINGS_VIEW`/`SETTINGS_EDIT` (migration 030) e o item de sidebar
   `/admin/settings`. É a maior entrega desta spec.
2. **Reforço de Testes** — itens de código viáveis derivados da spec `testes` (harness Supabase,
   helpers de auditoria, testes de integração, RLS, injeção, rate-limit, validação de saída,
   observabilidade testável) e extensões de CI (jobs de migrations e env-check, workflows e2e e
   performance, relatório de testes). Itens dependentes de infraestrutura (branch Supabase efêmero,
   secrets no CI) são documentados como requisito mas explicitamente marcados como **dependentes de
   infra**.
3. **Testes Opcionais de Robustez** — property tests que ainda não existem e agregam robustez a
   módulos já implementados (security-hardening, embarcador-onboarding, motorista-perfil-extras,
   schema-alignment-fixes, admin-financeiro CP-2 `markAsPaid` idempotente). São opcionais por
   natureza e marcados como tal.
4. **Polimentos Menores** — cards mobile single-column nas tabelas admin de notificações e atualização
   de documentação do notifications-hub.
5. **Validação Pré-Lançamento (manual/runtime)** — smoke tests manuais e aplicação de migrations em
   ambiente Supabase. São execuções de runtime, **não** código, e ficam numa categoria separada e
   claramente marcada.
6. **Não-Regressão** — garantia explícita de que toda mudança é aditiva e que a suíte completa
   continua verde, sem quebrar funcionalidades existentes.

### Regra-mãe desta spec

Foco **pesado em testes**: cada funcionalidade nova entrega testes dedicados (unit + property quando
houver invariante), conforme `testing-governance.md`. Toda mudança é **aditiva** e a **não-regressão**
é verificada rodando a suíte completa. Idioma de UI/comentários em **pt-BR**; action codes, error
codes e identifiers em inglês, conforme `project-conventions.md`. Todos os padrões admin
(`admin-patterns.md`) são reaproveitados sem reinvenção.

### Numeração de migrations (correção factual)

A última migration aplicada é a **083**. A próxima numeração livre real é a **084**. A migration 045
(originalmente planejada para admin-settings) **foi pulada** — a sequência salta de 044 para 047.
Portanto, **a migration de Admin Settings desta spec é a 084**, e **não** a 045 indicada na spec
original de admin-settings.

### Fora de escopo (explícito)

- **admin-financeiro (módulo de comissão)** — está sendo **aposentado** e substituído por assinaturas
  Asaas (o item "Financeiro" já está escondido no sidebar). Nenhum teste, refatoração ou correção do
  módulo de **comissão** do admin-financeiro entra nesta spec. A única exceção pontual e opcional é o
  property test CP-2 `markAsPaid` idempotente, listado como opcional de robustez.
- **Integração real da Evolution API / automação de WhatsApp** (envio de mensagens, webhooks, teste de
  conexão). Admin Settings apenas **armazena** os parâmetros e segredos.
- **Funcionalidades de IA propriamente ditas** — apenas a categoria de settings é reservada.
- **Consumo** dos parâmetros de trial/preços de plano pelas features existentes — esta spec apenas os
  torna editáveis e legíveis.
- Execução real de testes que dependem de **branch Supabase efêmero + secrets de CI** — documentada
  como requisito de capacidade, mas marcada como dependente de infra (a entrega é o código/config, não
  a execução verde no CI provisionado).

## Glossary

- **FreteGO_Platform**: A plataforma completa de fretes (web + back-end Supabase + app Android).
- **Launch_Readiness**: Estado em que todas as entregas de código desta spec estão concluídas,
  testadas e não-regressivas, restando apenas itens de Validação Pré-Lançamento manuais.
- **Admin_Panel**: Painel administrativo em `/admin/*`, fundação da migration 030 (admin-foundation).
- **AdminGuard / AdminProvider / AdminLayoutRoute / AdminShell / AdminSidebar**: Componentes de
  fundação do painel admin, reusados sem alteração de contrato.
- **Stealth_404**: Página 404 visualmente idêntica à 404 pública, renderizada para acessos não
  autorizados, sem revelar a existência da rota.
- **Permission_Matrix**: Matriz `(AdminRole, AdminAction) -> boolean` em
  `src/services/admin/permissions.ts`. `SETTINGS_VIEW`/`SETTINGS_EDIT` já existem desde a migration
  030; esta spec não adiciona action nova.
- **SETTINGS_VIEW / SETTINGS_EDIT**: Permissões de leitura e alteração das configurações da
  plataforma, concedidas a `SUPER_ADMIN` e `ADMIN`; negadas a `SUPORTE`, `FINANCEIRO` e `MODERADOR`.
- **executeAdminMutation**: Wrapper de audit-by-construction em `src/services/admin/audit.ts`. Toda
  mutação admin não-idempotente passa por aqui.
- **is_admin_with_permission**: Função SQL (migration 030) que reproduz a Permission_Matrix
  server-side, usada em todas as RPCs `SECURITY DEFINER`.
- **Settings_Module**: O módulo Configurações entregue por esta spec em `/admin/settings`.
- **Settings_Store**: Tabela `platform_settings` (chave-valor tipado por categoria) que guarda o estado
  vigente de cada configuração.
- **Settings_Service**: Service em `src/services/admin/settings.ts` com a lógica de leitura e mutação.
- **Settings_Page**: Página `/admin/settings` no padrão compacto pós-cleanup.
- **Setting_Category**: Domínio fechado de categoria: `'integrations'`, `'trial'`, `'plans'`, `'ai'`,
  `'general'`.
- **Setting_Key**: Identificador único e estável de uma configuração (inglês, snake_case), ex.:
  `trial_duration_days`, `plan_price_mensal`, `evolution_api_base_url`.
- **Setting_Value_Type**: Tipo do valor: `'string'`, `'integer'`, `'money'`, `'boolean'`, `'secret'`,
  `'enum'`.
- **Secret_Setting**: Configuração marcada como segredo, cujo valor bruto é guardado server-side via
  Vault e nunca retornado integralmente ao cliente.
- **Vault**: Extensão `supabase_vault` (já em uso na migration 042b) para guardar segredos
  criptografados server-side.
- **Masked_Value**: Representação não sensível de um Secret_Setting (últimos 4 caracteres visíveis,
  ex.: `••••••••3f9a`) mais um indicador `is_set`.
- **STALE_VERSION**: Erro tipado lançado quando `expected_updated_at` não corresponde ao `updated_at`
  atual do registro (versionamento otimista).
- **Migration_084**: `supabase/migrations/084_admin_settings.sql`, idempotente, com par de rollback
  documentado (`084_admin_settings_rollback.sql`); próxima numeração livre real.
- **Compact_Layout_Pattern**: Padrão de UI compacta do painel admin (sem `<h1>` grande, filtros em
  popover, paginação `10/50/100`, botões `text-xs px-2.5 py-1`, mobile em cards single-column).
- **Test_System**: O conjunto de testes automatizados, ferramentas e validações contínuas do FreteGO.
- **Supabase_Test_Harness**: Helper em `tests/_helpers/supabaseHarness.ts` que provisiona e limpa
  estado de teste contra um Supabase de teste.
- **Audit_Assertions**: Helper em `src/__tests__/_helpers/auditAssertions.ts` que verifica a
  persistência efetiva de registros em `admin_audit_logs`.
- **RLS_Engine**: Row-Level Security do Postgres/Supabase que restringe acesso a dados por usuário.
- **Property_Test**: Teste baseado em propriedades com fast-check (`numRuns >= 100`), seguindo as
  convenções do projeto (sem `fc.stringOf`; PII via `fc.constantFrom`; `vi.mock` hoisted com
  `globalThis.__spy`).
- **Regression_Suite**: A coleção completa de testes automatizados executada para detectar quebras de
  funcionalidades existentes.
- **CI_Pipeline**: O workflow de integração contínua em GitHub Actions (`.github/workflows/`).
- **Infra_Dependent**: Marcação de um requisito cuja **execução** depende de infraestrutura externa
  (branch Supabase efêmero, secrets no CI); a entrega é o código/configuração, não a execução
  provisionada.
- **Manual_Validation**: Categoria de itens de validação executados manualmente em runtime (smoke
  tests, aplicação de migrations em ambiente), e não entregáveis de código.
- **Action codes** (inglês, gravados em `admin_audit_logs`): `SETTINGS_UPDATED`,
  `SETTINGS_SECRET_UPDATED`, `SETTINGS_SECRET_CLEARED`, `SETTINGS_SECRET_CLEARED_SKIPPED`,
  `SETTINGS_VIEW_DENIED`.

---

## Requirements

## Área 1 — Admin Settings (maior entrega)

### Requirement 1: Módulo Configurações — rota, gating e padrão compacto

**User Story:** Como admin com `SETTINGS_VIEW`, quero acessar `/admin/settings` para visualizar as
configurações da plataforma seguindo o padrão visual compacto dos demais módulos, para que o módulo
deixe de cair em 404.

#### Acceptance Criteria

1. THE Admin_Panel SHALL registrar a rota `/admin/settings` renderizando a Settings_Page.
2. WHEN um admin com `SETTINGS_VIEW` acessa `/admin/settings`, THE AdminGuard SHALL renderizar a
   Settings_Page.
3. IF um admin sem `SETTINGS_VIEW` acessa `/admin/settings`, THEN THE AdminGuard SHALL renderizar
   Stealth_404.
4. WHERE o usuário atual tem perfil `SUPORTE`, `FINANCEIRO` ou `MODERADOR`, THE AdminGuard SHALL
   renderizar Stealth_404 ao acessar `/admin/settings`.
5. THE Settings_Page SHALL omitir o `<h1>` grande no topo, seguindo o Compact_Layout_Pattern.
6. THE AdminSidebar SHALL manter o item Configurações apontando para `/admin/settings`, gated por
   `SETTINGS_VIEW`.
7. WHERE existem múltiplas Setting_Category, THE Settings_Page SHALL agrupar as configurações em seções
   identificáveis: Integrações, Trial, Planos, IA e Geral.

### Requirement 2: Visualização das configurações por categoria

**User Story:** Como admin com `SETTINGS_VIEW`, quero ver os valores atuais de cada configuração
agrupados por categoria, para que eu acompanhe o estado da plataforma.

#### Acceptance Criteria

1. WHEN um admin com `SETTINGS_VIEW` abre a Settings_Page, THE Settings_Service SHALL retornar o estado
   vigente de todas as configurações não-secretas com seus valores atuais.
2. THE Settings_Service SHALL retornar, para cada configuração, a Setting_Key, a Setting_Category, o
   Setting_Value_Type, o valor atual e o `updated_at`.
3. WHERE uma configuração é um Secret_Setting, THE Settings_Service SHALL retornar o Masked_Value e o
   indicador `is_set` em vez do valor bruto.
4. THE Settings_Service SHALL validar `is_admin_with_permission('SETTINGS_VIEW')` no servidor antes de
   retornar qualquer valor de configuração.
5. IF um admin sem `SETTINGS_VIEW` invoca a leitura no servidor, THEN THE Settings_Service SHALL negar
   a leitura e registrar `SETTINGS_VIEW_DENIED` em `admin_audit_logs` com `before` nulo e `after`
   contendo `user_id` e `reason`.
6. WHEN o caller é anônimo, com `auth.uid()` nulo, THE Settings_Service SHALL negar a leitura.
7. WHERE a leitura de uma categoria falha de forma isolada, THE Settings_Page SHALL renderizar as
   demais categorias normalmente e exibir um estado de erro com botão Tentar novamente apenas na
   categoria afetada.

### Requirement 3: Edição com RBAC, auditoria e versionamento otimista

**User Story:** Como admin com `SETTINGS_EDIT`, quero alterar valores de configuração com
rastreabilidade completa, para que cada mudança fique auditada e protegida contra escrita concorrente.

#### Acceptance Criteria

1. WHERE o usuário atual não tem `SETTINGS_EDIT`, THE Settings_Page SHALL ocultar os controles de
   edição e o botão Salvar, exibindo as configurações em modo somente leitura.
2. WHEN um admin com `SETTINGS_EDIT` salva uma alteração não-secreta, THE Settings_Service SHALL
   persistir o novo valor através de `executeAdminMutation` com `action` igual a `SETTINGS_UPDATED`,
   `targetType` igual a `platform_settings` e `targetId` igual à Setting_Key.
3. WHEN uma alteração de configuração é de fato persistida, THE Settings_Service SHALL registrar no
   audit log o snapshot `before` e `after`, omitindo valores brutos de Secret_Setting em ambos; quando
   nenhuma alteração é salva, nenhum audit log de alteração é gravado.
4. THE Settings_Service SHALL aplicar versionamento otimista usando `updated_at` na atualização de cada
   configuração.
5. WHEN a edição de uma configuração é aberta, THE Settings_Page SHALL ler imediatamente o `updated_at`
   vigente e enviá-lo de volta na chamada de salvamento.
6. IF o `expected_updated_at` enviado não corresponde ao `updated_at` atual do registro, THEN THE
   Settings_Service SHALL rejeitar a atualização com o erro `STALE_VERSION` sem mutar o valor.
7. WHEN o salvamento retorna `STALE_VERSION`, THE Settings_Page SHALL exibir o toast
   `Outro admin atualizou. Recarregando.` e recarregar os valores vigentes.
8. THE rpc server-side de atualização SHALL validar `is_admin_with_permission('SETTINGS_EDIT')` e
   registrar `SETTINGS_VIEW_DENIED` em `admin_audit_logs` quando a permissão falhar.
9. WHEN o caller é anônimo, com `auth.uid()` nulo, THE rpc de atualização SHALL retornar
   `permission_denied`.
10. WHEN o salvamento conclui com sucesso, THE Settings_Page SHALL exibir o toast `Configuração salva.`
    e recarregar o valor atualizado, incluindo o novo `updated_at`.

### Requirement 4: Armazenamento e mascaramento seguro de segredos

**User Story:** Como plataforma, quero que segredos de integração sejam guardados com segurança no
servidor e nunca devolvidos integralmente ao cliente, para que credenciais não vazem pelo painel.

#### Acceptance Criteria

1. WHEN um admin com `SETTINGS_EDIT` salva um Secret_Setting, THE Settings_Service SHALL armazenar o
   valor bruto server-side via Vault, sem persistir o valor bruto em colunas legíveis de
   `platform_settings`.
2. WHEN a leitura de configurações inclui um Secret_Setting, THE Settings_Service SHALL retornar o
   Masked_Value com os últimos 4 caracteres visíveis e o indicador `is_set`, sem retornar o valor
   bruto.
3. THE Settings_Service SHALL gravar o audit log de alteração de segredo com `action` igual a
   `SETTINGS_SECRET_UPDATED`, registrando apenas metadados não sensíveis (`is_set` e últimos 4
   caracteres), sem o valor bruto.
4. WHEN um admin com `SETTINGS_EDIT` remove um Secret_Setting já definido, THE Settings_Service SHALL
   apagar o valor server-side, definir `is_set` como falso e gravar o audit log com `action` igual a
   `SETTINGS_SECRET_CLEARED`.
5. WHILE um Secret_Setting tem `is_set` igual a falso, THE Settings_Page SHALL exibir o campo como
   vazio com o rótulo `Não configurado`.
6. WHILE um Secret_Setting tem `is_set` igual a verdadeiro, THE Settings_Page SHALL exibir o
   Masked_Value e um controle para Substituir ou Remover o segredo.
7. WHEN um admin envia o campo de Secret_Setting em branco numa operação de salvamento que não é de
   remoção, THE Settings_Service SHALL preservar o valor server-side existente sem alterá-lo.
8. WHEN a remoção de um Secret_Setting já removido é chamada novamente, THE Settings_Service SHALL ser
   idempotente, gravando `SETTINGS_SECRET_CLEARED_SKIPPED` e retornando um resultado de skip neutro,
   sem mutar o estado.
9. THE leitura do valor bruto de um Secret_Setting SHALL ser restrita ao uso server-side por processos
   de integração, e não SHALL ser exposta por nenhuma RPC consumível pelo cliente do painel.

### Requirement 5: Categoria Integrações com campos reservados da Evolution API

**User Story:** Como admin com `SETTINGS_EDIT`, quero registrar os parâmetros e o segredo da futura
integração Evolution API num local seguro, para que a integração possa ser ativada em spec futura sem
alteração de código.

#### Acceptance Criteria

1. THE Settings_Store SHALL conter na categoria `integrations` as chaves `evolution_api_base_url`,
   `evolution_api_key`, `evolution_instance_name` e `evolution_connection_status`.
2. THE Settings_Service SHALL tratar `evolution_api_key` como Secret_Setting, aplicando o armazenamento
   e mascaramento definidos no Requirement 4.
3. WHEN um admin salva `evolution_api_base_url`, THE Settings_Service SHALL validar que o valor é uma
   URL absoluta com esquema `https`.
4. IF `evolution_api_base_url` não é uma URL `https` válida, THEN THE Settings_Page SHALL exibir erro
   inline e desabilitar o botão Salvar dessa configuração.
5. THE Settings_Service SHALL tratar `evolution_connection_status` como valor somente leitura no
   painel, com domínio fechado `'disconnected'`, `'connecting'`, `'connected'`, `'error'` e valor
   inicial `'disconnected'`.
6. THE Settings_Store SHALL permitir o registro de novas Setting_Key na categoria `integrations` sem
   exigir alteração de schema, mantendo o armazenamento genérico de chave-valor tipado.
7. THE Settings_Page SHALL exibir um aviso informativo de que a integração Evolution API ainda não está
   ativa e que os valores são apenas armazenados para uso futuro.

### Requirement 6: Categoria Parâmetros de Trial

**User Story:** Como admin com `SETTINGS_EDIT`, quero ajustar a duração do período de teste sem alterar
código, para que eu controle a política de trial pela plataforma.

#### Acceptance Criteria

1. THE Settings_Store SHALL conter `trial_duration_days` na categoria `trial`, do tipo `integer`, com
   valor inicial igual a 30.
2. WHEN um admin salva `trial_duration_days`, THE Settings_Service SHALL validar que o valor é um
   inteiro entre 1 e 365 inclusive.
3. IF o valor de `trial_duration_days` está fora do intervalo de 1 a 365, THEN THE Settings_Page SHALL
   exibir erro inline e desabilitar o botão Salvar dessa configuração.
4. THE Settings_Service SHALL expor `trial_duration_days` na leitura de configurações para que features
   consumidoras possam ler o valor vigente.

### Requirement 7: Categoria Preços de Planos

**User Story:** Como admin com `SETTINGS_EDIT`, quero editar os preços dos planos exibidos na tela de
bloqueio, para que os valores possam ser atualizados sem alteração de código.

#### Acceptance Criteria

1. THE Settings_Store SHALL conter `plan_price_mensal`, `plan_price_trimestral` e `plan_price_semestral`
   na categoria `plans`, do tipo `money` em centavos, com valores iniciais 3900, 8700 e 15000
   respectivamente.
2. WHEN um admin salva um preço de plano, THE Settings_Service SHALL validar que o valor é um inteiro
   maior ou igual a 0 e menor ou igual a 1000000 centavos.
3. IF um preço de plano está fora do intervalo de 0 a 1000000 centavos, THEN THE Settings_Page SHALL
   exibir erro inline e desabilitar o botão Salvar dessa configuração.
4. THE Settings_Page SHALL exibir e editar os preços de plano em reais com duas casas decimais,
   convertendo de e para centavos.
5. FOR ALL valores monetários inteiros de centavos gerados pelo Property_Test, THE Settings_Service
   SHALL satisfazer a propriedade de round-trip `reaisToCents(centsToReais(c)) == c`.
6. THE Settings_Service SHALL expor os preços de plano vigentes na leitura para que a tela de bloqueio
   possa lê-los.

### Requirement 8: Categoria Configurações de IA (placeholder)

**User Story:** Como admin, quero uma área reservada para configurações de IA, para que o módulo já
acomode esses settings quando forem detalhados.

#### Acceptance Criteria

1. THE Settings_Store SHALL reservar a categoria `ai` para configurações de IA.
2. THE Settings_Page SHALL sempre exibir a seção IA, com conteúdo variável conforme existam ou não
   configurações definidas, incluindo um aviso informativo de que as configurações de IA serão
   detalhadas em uma entrega futura.
3. WHERE não existe nenhuma configuração definida na categoria `ai`, THE Settings_Page SHALL exibir a
   seção IA em estado vazio sem gerar erro.
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

**User Story:** Como sistema, quero validar cada valor de configuração conforme seu tipo no cliente e
no servidor, para que dados inválidos não sejam persistidos.

#### Acceptance Criteria

1. THE Settings_Service SHALL validar o valor de cada configuração contra seu Setting_Value_Type no
   servidor antes de persistir.
2. IF um valor enviado não corresponde ao Setting_Value_Type da configuração, THEN THE Settings_Service
   SHALL rejeitar a operação com um erro de validação e não SHALL persistir o valor.
3. WHERE uma configuração é do tipo `enum`, THE Settings_Service SHALL rejeitar valores fora do domínio
   fechado definido para aquela Setting_Key.
4. WHEN um admin tenta salvar uma Setting_Key inexistente no Settings_Store, THE Settings_Service SHALL
   rejeitar a operação sem criar registros novos.
5. THE Settings_Page SHALL replicar as validações de tipo e intervalo no cliente para feedback inline,
   mantendo o servidor como autoridade final.
6. FOR ALL valores válidos e inválidos por tipo gerados pelo Property_Test, THE Settings_Service SHALL
   aceitar consistentemente os válidos e rejeitar os inválidos com o mesmo veredito no cliente e no
   servidor.

### Requirement 11: Migration 084 e idempotência

**User Story:** Como engenheiro, quero aplicar a migration de Admin Settings sem efeitos colaterais em
reexecuções e com a numeração correta, para que o deploy seja seguro e reversível.

#### Acceptance Criteria

1. THE Migration_084 SHALL ser nomeada `supabase/migrations/084_admin_settings.sql`, ocupando a próxima
   numeração livre real após 083.
2. THE Migration_084 SHALL ser envelopada em `BEGIN; ... COMMIT;`.
3. THE Migration_084 SHALL ser idempotente em reexecução, usando `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` antes de
   `CREATE POLICY` e `INSERT ... ON CONFLICT DO NOTHING` para os seeds.
4. THE Migration_084 SHALL incluir bloco `DO $check$` defensivo validando que
   `is_admin_with_permission` e `admin_audit_logs` existem, levantando exceção clara caso ausentes.
5. THE Migration_084 SHALL semear os valores iniciais conhecidos: `trial_duration_days` igual a 30;
   `plan_price_mensal` igual a 3900; `plan_price_trimestral` igual a 8700; `plan_price_semestral` igual
   a 15000; `evolution_connection_status` igual a `disconnected`; e os contatos de suporte e chaves
   reservadas da Evolution API, sem sobrescrever valores já existentes.
6. THE Migration_084 SHALL definir as RPCs de leitura e mutação como `SECURITY DEFINER` com
   `SET search_path = public`, validação de `auth.uid()`, `is_admin_with_permission`,
   `REVOKE ALL FROM PUBLIC` e `GRANT EXECUTE TO authenticated`.
7. THE Migration_084 SHALL ser acompanhada de `084_admin_settings_rollback.sql` que documenta os `DROP`
   reversos, não auto-aplicado.
8. THE Migration_084 SHALL conter um bloco `-- VERIFY` comentado com SELECTs de smoke test.

### Requirement 12: Testes do módulo Configurações

**User Story:** Como mantenedor, quero o módulo Configurações coberto por testes unit e property, para
que ele atenda a governança de testes antes do lançamento.

#### Acceptance Criteria

1. THE Test_System SHALL conter testes unitários para os helpers puros do Settings_Service
   (`validateSettingValue`, `maskSecret`, `validateEvolutionBaseUrl`, `validateEmail`,
   `reaisToCents`, `centsToReais`) cobrindo entradas válidas, inválidas, vazias e extremas.
2. THE Property_Test SHALL verificar a invariante CP-1 de que nenhum valor bruto de Secret_Setting
   aparece em retorno de leitura nem em snapshots de auditoria.
3. THE Property_Test SHALL verificar a invariante CP-2 de validação por `Setting_Value_Type` (aceita
   válidos, rejeita inválidos) com `numRuns >= 100`.
4. THE Property_Test SHALL verificar a invariante CP-3 de round-trip centavos↔reais com
   `numRuns >= 100`.
5. THE Test_System SHALL conter testes do caminho negativo de gating, verificando que ausência de
   permissão resulta em `permission_denied` e registro de `SETTINGS_VIEW_DENIED`.
6. THE Property_Test SHALL seguir as convenções fast-check do projeto, não usando `fc.stringOf`,
   gerando PII via `fc.constantFrom` e expondo spies via `globalThis.__spy` com `vi.mock` hoisted.

### Requirement 13: Acessibilidade e responsividade do módulo Configurações

**User Story:** Como admin usando teclado, leitor de tela ou dispositivo móvel, quero gerenciar as
configurações com a mesma cobertura, para que o módulo seja acessível.

#### Acceptance Criteria

1. THE Settings_Page SHALL associar cada campo de configuração a um rótulo via `htmlFor` ou
   `aria-label`.
2. THE Settings_Page SHALL ser responsiva e legível em telas menores que 768px, empilhando as seções em
   coluna única.
3. THE Settings_Page SHALL exibir os toasts de sucesso e erro com `role` igual a `status` ou `alert`,
   conforme apropriado.
4. WHERE um controle de ação é apenas ícone, THE Settings_Page SHALL prover `aria-label` descritivo.
5. THE Settings_Page SHALL manter contraste mínimo WCAG AA nos textos e controles interativos.

---

## Área 2 — Reforço de Testes (código viável)

### Requirement 14: Supabase Test Harness e helper de auditoria

**User Story:** Como mantenedor, quero um harness de testes Supabase e um helper de asserção de
auditoria, para que testes de integração e RLS tenham base reutilizável e determinística.

#### Acceptance Criteria

1. THE Test_System SHALL prover um Supabase_Test_Harness em `tests/_helpers/supabaseHarness.ts` que
   inicializa um cliente de teste, semeia Test_Fixtures e limpa o estado ao final de cada execução.
2. THE Supabase_Test_Harness SHALL expor utilitários para criar usuários de teste com papéis distintos
   e para autenticar como cada um.
3. THE Test_System SHALL prover um helper Audit_Assertions em `src/__tests__/_helpers/auditAssertions.ts`
   que aprova a verificação somente quando o registro está efetivamente PERSISTIDO em
   `admin_audit_logs` com `action`, `target_type` e `target_id`.
4. THE Audit_Assertions SHALL expor uma asserção que verifica a presença de `<MODULE>_VIEW_DENIED` com
   `before` nulo no caminho negativo de RPCs gated.
5. THE Test_System SHALL reusar os helpers canônicos existentes em `src/__tests__/_helpers/`
   (`generators.ts`, `authAssertions.ts`, `antiEnumeration.ts`, `logAssertions.ts`) sem
   reimplementá-los.

### Requirement 15: Testes de integração de fluxos núcleo

**User Story:** Como mantenedor, quero testes de integração para os fluxos núcleo da plataforma, para
que regressões em cadastro, frete, chat, billing, uploads, LGPD e jobs sejam detectadas.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL exercitar o fluxo de autenticação (cadastro, login, logout,
   recuperação de senha) verificando as mensagens canônicas anti-enumeração em pt-BR.
2. THE Integration_Test_Suite SHALL exercitar o ciclo de vida do frete (publicação, edição com
   versionamento otimista, candidatura, fechamento) verificando `STALE_VERSION` em edição com
   `expected_updated_at` desatualizado.
3. THE Integration_Test_Suite SHALL exercitar o chat (abertura de conversa, envio e ordem cronológica
   de mensagens) verificando bloqueio por RLS_Engine para usuário sem vínculo.
4. THE Integration_Test_Suite SHALL exercitar billing/webhooks com provedor mockado, verificando
   rejeição de assinatura inválida com `WEBHOOK_SIGNATURE_INVALID` e idempotência em entrega
   duplicada.
5. THE Integration_Test_Suite SHALL exercitar uploads, verificando rejeição de MIME inválido com
   `INVALID_FILE_TYPE` e rejeição de arquivo malicioso após a conclusão do upload.
6. THE Integration_Test_Suite SHALL exercitar LGPD/auditoria (exportação, exclusão, persistência de
   audit log) usando o Audit_Assertions.
7. THE Integration_Test_Suite SHALL exercitar jobs assíncronos e integrações externas com dublês,
   verificando retry ou degradação parcial sem perda de dados.
8. WHERE a execução dos testes de integração depende de branch Supabase efêmero e secrets no CI, THE
   Test_System SHALL marcar esses testes como Infra_Dependent, entregando o código de teste mesmo que a
   execução verde provisionada dependa de infraestrutura externa.

### Requirement 16: Harness de RLS e isolamento entre usuários

**User Story:** Como engenheiro de segurança, quero um harness de RLS que valide isolamento entre
usuários, para que nenhum usuário acesse dados de outro.

#### Acceptance Criteria

1. THE Security_Test_Suite SHALL prover um harness de RLS que autentica como dois usuários distintos e
   tenta acessos cruzados.
2. WHEN o usuário A tenta ler dados do usuário B, THE Security_Test_Suite SHALL verificar que o
   RLS_Engine bloqueia o acesso.
3. WHEN o usuário A tenta atualizar ou excluir registros do usuário B, THE Security_Test_Suite SHALL
   verificar que a operação é negada.
4. FOR ALL pares de usuários distintos gerados pelo Property_Test, THE Security_Test_Suite SHALL
   verificar a invariante de isolamento de que nenhum usuário lê linhas de outro em tabelas com RLS.
5. THE Security_Test_Suite SHALL verificar que o Master Admin `Nexus_Vortex99` é imutável a mutações
   admin.
6. WHERE a execução do harness de RLS depende de Supabase real com RLS aplicado, THE Test_System SHALL
   marcar esses testes como Infra_Dependent.

### Requirement 17: Vetores de injeção, rate-limit e força bruta

**User Story:** Como engenheiro de segurança, quero testes de injeção, rate limiting e anti-força-bruta,
para que entradas maliciosas e abuso sejam contidos.

#### Acceptance Criteria

1. THE Security_Test_Suite SHALL testar vetores de SQL Injection, XSS e CSRF em campos de entrada e
   endpoints que alteram estado, verificando neutralização.
2. FOR ALL payloads maliciosos gerados pelo Property_Test, THE Security_Test_Suite SHALL verificar que
   a entrada é rejeitada e nenhum efeito colateral persiste.
3. WHEN o número de tentativas de login excede o limite configurado, THE Security_Test_Suite SHALL
   verificar resposta com status HTTP 429.
4. THE Security_Test_Suite SHALL testar enumeração de usuários e verificar que respostas são
   indistinguíveis para identidades existentes e inexistentes.
5. WHERE a execução desses testes depende de runtime de Edge Functions ou rate limiter real, THE
   Test_System SHALL marcar esses testes como Infra_Dependent.

### Requirement 18: Validação de saída, contratos e observabilidade testável

**User Story:** Como mantenedor, quero testes de validação de saída, contratos e observabilidade, para
que respostas sejam consistentes e logs estruturados não vazem segredos.

#### Acceptance Criteria

1. THE Data_Validator SHALL validar a estrutura JSON de cada resposta de API testada contra seu schema
   esperado.
2. THE Test_System SHALL verificar que respostas não incluem campos sensíveis fora do contrato
   definido.
3. FOR ALL respostas geradas durante os testes, THE Property_Test SHALL verificar que hashes de senha e
   secrets nunca aparecem no payload, reusando `logAssertions.expectNoSecrets`.
4. THE Test_System SHALL verificar que logs estruturados seguem o formato esperado, reusando
   `logAssertions.expectStructuredLog`.
5. WHEN uma mudança de schema compatível ocorre, THE Contract_Test_Suite SHALL não falhar; quando a
   mudança é incompatível, THE Contract_Test_Suite SHALL falhar.

### Requirement 19: Configuração de Playwright e k6

**User Story:** Como mantenedor, quero Playwright (E2E desktop+mobile) e k6 (performance) configurados,
para que a plataforma tenha base para testes E2E e de carga.

#### Acceptance Criteria

1. THE Test_System SHALL prover configuração de Playwright cobrindo viewport desktop e viewport mobile
   (`<768px`).
2. THE E2E_Test_Suite SHALL conter ao menos um fluxo principal automatizado verificando que submissão
   inválida bloqueia o envio E exibe mensagem de erro em pt-BR.
3. THE E2E_Test_Suite SHALL verificar que listagem do painel admin vira cards single-column em mobile.
4. THE Performance_Test_Suite SHALL prover configuração de k6 medindo tempo de resposta de endpoints
   críticos sob carga representativa.
5. WHERE a execução de Playwright e k6 depende de ambiente provisionado e secrets, THE Test_System SHALL
   marcar essas execuções como Infra_Dependent, entregando configuração e scripts independentemente da
   execução provisionada.

### Requirement 20: Extensões de CI

**User Story:** Como mantenedor, quero estender o CI com jobs de migrations e env-check e workflows de
e2e e performance, para que a pipeline cubra mais garantias antes do deploy.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL conter um job de migrations que executa `scripts/validate-migrations.ts`
   verificando numeração incremental sem buracos e presença de par `_rollback.sql`.
2. THE CI_Pipeline SHALL conter um job de env-check que executa `scripts/validate-env.ts` verificando a
   presença das variáveis de ambiente requeridas.
3. THE CI_Pipeline SHALL conter um workflow `e2e.yml` que executa o E2E_Test_Suite via Playwright.
4. THE CI_Pipeline SHALL conter um workflow `performance.yml` que executa o Performance_Test_Suite via
   k6.
5. THE Test_System SHALL prover `scripts/test-report.ts` que consolida os resultados de teste em um
   relatório legível.
6. WHEN qualquer teste da Regression_Suite falha, THE CI_Pipeline SHALL bloquear o merge e o deploy.
7. IF a falha é um problema de infraestrutura da própria pipeline, THEN THE CI_Pipeline SHALL não
   bloquear o merge automaticamente.
8. THE validate-migrations script SHALL reconhecer o salto conhecido de 045 e 046 (migrations puladas)
   sem reportar falso positivo de buraco, validando apenas que novas migrations seguem a partir de 084.

---

## Área 3 — Testes Opcionais de Robustez

### Requirement 21: Property tests opcionais de security-hardening

**User Story:** Como mantenedor, quero property tests opcionais para os utilitários de
security-hardening já implementados, para que ganhem robustez adicional.

#### Acceptance Criteria

1. WHERE o time opta por reforço de robustez, THE Property_Test SHALL cobrir `FileValidatorAdvanced`
   (magic bytes), `inputLimits`, `CSRFTokenManager`, `antiEnumeration`, `SessionManager`,
   `jwtRevocation`, `BruteForceProtector`, `passwordValidation`, `rateLimiter`, `auditLogger`,
   `honeypot` e `urlSanitizer`.
2. THE Property_Test SHALL usar `numRuns >= 100` e seguir as convenções fast-check do projeto.
3. WHERE esses testes são opcionais, THE Test_System SHALL marcá-los como opcionais no plano de tarefas
   (sufixo `*`), sem bloquear o Launch_Readiness.

### Requirement 22: Property tests opcionais de onboarding e perfil

**User Story:** Como mantenedor, quero property tests opcionais para embarcador-onboarding e
motorista-perfil-extras, para que regras já implementadas ganhem robustez.

#### Acceptance Criteria

1. WHERE o time opta por reforço, THE Property_Test SHALL cobrir `verification`, `onboardingProgress` e
   `maskTarget` de embarcador-onboarding.
2. WHERE o time opta por reforço, THE Property_Test SHALL cobrir `souEuProprietario` de
   motorista-perfil-extras.
3. WHERE esses testes são opcionais, THE Test_System SHALL marcá-los como opcionais no plano de tarefas
   (sufixo `*`).

### Requirement 23: Property tests opcionais de schema-alignment e admin-financeiro CP-2

**User Story:** Como mantenedor, quero property tests opcionais para schema-alignment-fixes e o CP-2
`markAsPaid` idempotente, para fechar lacunas pontuais de robustez sem entrar no escopo de comissão.

#### Acceptance Criteria

1. WHERE o time opta por reforço, THE Property_Test SHALL cobrir `documentTypeValidation`,
   `registerRollback` e `chatErrorMapping` de schema-alignment-fixes.
2. WHERE o time opta por reforço, THE Property_Test SHALL cobrir a idempotência de `markAsPaid` (CP-2),
   verificando que aplicar duas vezes produz o mesmo resultado que aplicar uma vez.
3. THE Test_System SHALL excluir do escopo qualquer teste do módulo de comissão do admin-financeiro
   além do CP-2 `markAsPaid` idempotente, dado o aposentamento do módulo de comissão.
4. WHERE esses testes são opcionais, THE Test_System SHALL marcá-los como opcionais no plano de tarefas
   (sufixo `*`).

---

## Área 4 — Polimentos Menores

### Requirement 24: Cards mobile nas tabelas admin de notificações

**User Story:** Como admin em dispositivo móvel, quero que as tabelas de tickets e broadcast virem
cards single-column, para que a leitura em telas pequenas siga o padrão compacto.

#### Acceptance Criteria

1. WHERE a `AdminTicketsPage` é renderizada em tela menor que 768px, THE Admin_Panel SHALL exibir a
   listagem como cards single-column.
2. WHERE a `AdminBroadcastPage` é renderizada em tela menor que 768px, THE Admin_Panel SHALL exibir a
   listagem como cards single-column.
3. THE Admin_Panel SHALL preservar o comportamento de tabela em telas de 768px ou mais, sem regressão
   visual.

### Requirement 25: Atualização de documentação do notifications-hub

**User Story:** Como mantenedor, quero a documentação do notifications-hub atualizada, para que ROADMAP
e guia de testes manuais reflitam o estado real.

#### Acceptance Criteria

1. THE FreteGO_Platform SHALL atualizar o ROADMAP do notifications-hub para refletir o estado entregue.
2. THE FreteGO_Platform SHALL atualizar o GUIA_TESTES_MANUAIS do notifications-hub para refletir os
   fluxos atuais.
3. THE atualização de documentação SHALL ser limitada a documentação, sem alterar comportamento de
   código.

---

## Área 5 — Validação Pré-Lançamento (manual/runtime)

> **Nota:** Os requisitos desta área são **Manual_Validation** — execuções de runtime, não
> entregáveis de código. São listados para rastreabilidade do checklist de lançamento e claramente
> marcados como manuais.

### Requirement 26: Aplicação de migrations em ambiente

**User Story:** Como operador, quero aplicar e verificar a migration 084 em ambiente Supabase, para que
o módulo Configurações funcione em produção.

#### Acceptance Criteria

1. THE Manual_Validation SHALL incluir a aplicação da Migration_084 no ambiente Supabase alvo.
2. THE Manual_Validation SHALL incluir a execução do bloco `-- VERIFY` da Migration_084 confirmando
   tabela, seeds e RPCs criados.
3. WHERE a aplicação falhar, THE Manual_Validation SHALL incluir a execução do par
   `084_admin_settings_rollback.sql` documentado.
4. THE Manual_Validation SHALL registrar que estes passos são manuais e não substituem os testes
   automatizados.

### Requirement 27: Smoke tests manuais pré-lançamento

**User Story:** Como operador, quero um roteiro de smoke tests manuais dos fluxos críticos, para que o
lançamento seja validado em runtime real.

#### Acceptance Criteria

1. THE Manual_Validation SHALL incluir um roteiro de smoke test do módulo Configurações cobrindo
   leitura, edição, segredo (definir/substituir/remover) e versionamento otimista.
2. THE Manual_Validation SHALL incluir smoke tests dos fluxos críticos de cadastro, frete, chat,
   billing e uploads em ambiente real.
3. THE Manual_Validation SHALL ser claramente marcada como manual e separada das tarefas de código no
   plano de tarefas.

---

## Área 6 — Não-Regressão

### Requirement 28: Mudanças aditivas e não-regressão verificada

**User Story:** Como dono do produto, quero garantia de que nada do que já funciona quebra, para que o
lançamento seja seguro.

#### Acceptance Criteria

1. THE FreteGO_Platform SHALL implementar todas as mudanças desta spec de forma aditiva, sem alterar
   contratos públicos existentes salvo quando explicitamente exigido por um requisito desta spec.
2. WHEN qualquer entrega de código desta spec é concluída, THE Test_System SHALL executar a suíte
   completa e verificar que os testes preexistentes continuam passando.
3. IF um teste preexistente passa a falhar após uma mudança desta spec, THEN THE Test_System SHALL
   reportar o teste afetado e o exemplo que falhou, e a mudança SHALL ser corrigida antes de prosseguir.
4. THE Regression_Suite SHALL incorporar todos os novos testes obrigatórios desta spec.
5. THE FreteGO_Platform SHALL preservar a numeração incremental de migrations sem buracos a partir de
   084, reconhecendo o salto histórico conhecido de 045 e 046.
6. THE FreteGO_Platform SHALL manter o Master Admin `Nexus_Vortex99` imutável em todas as mutações
   admin introduzidas ou tocadas por esta spec.
