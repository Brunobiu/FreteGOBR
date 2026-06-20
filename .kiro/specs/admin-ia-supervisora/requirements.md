# Requirements Document

## Introduction

A **IA Supervisora** (`Supervisor_AI`) entrega ao painel admin do FreteGO um "diretor técnico
permanente" do SaaS: uma camada interna que **observa, analisa, registra, sugere, responde e
notifica** sobre a saúde e a operação do sistema, para que o dono — administrador único inicial —
consiga administrar a plataforma praticamente sozinho. Esta é a **quarta e última spec** derivada do
documento de ideias do dono (`Credencial/Ideias`), cobrindo os complementos **"Administrador
Inteligente do Sistema (IA Supervisora)"** e **"IA Supervisora com Notificações Proativas"**:

- **Painel Inteligente** — uma área de chat onde o admin pergunta em linguagem natural ("como está o
  sistema hoje?", "quantos pagaram hoje?", "quais instâncias estão desconectadas?") e a IA responde
  consultando dados **atualizados e agregados** do sistema.
- **Monitoramento permanente** — acompanhamento contínuo de banco, filas, jobs, integrações,
  instâncias de WhatsApp e processos automáticos, registrando anormalidades.
- **Central de Diagnóstico** — área admin-only onde erros/avisos/eventos técnicos ficam registrados
  (o cliente **nunca** vê erro técnico), cada um com data/hora, módulo, operação, descrição,
  severidade, possível causa e sugestão de correção.
- **Autoanálise + Sugestões de Melhoria** — a IA analisa os registros para identificar padrões
  (erros repetidos, lentidão recorrente, processos travados, abandono de etapa) e gera relatórios e
  sugestões acionáveis.
- **Notificações proativas** — a IA toma a iniciativa de avisar o admin sobre eventos importantes,
  classificando por prioridade (crítico = alerta imediato; informativo = agrupado em resumo).
- **Resumo inteligente periódico** — resumos automáticos ("Hoje: 37 novos usuários, 12 assinaturas,
  4 campanhas concluídas, 2 alertas que precisam da sua atenção").

As três specs anteriores são `suporte-inteligente` (migration 115, partes 1/4/5/6/10),
`admin-cliente-360` (migration 116, partes 2/3) e `admin-central-operacao` (migration 117, partes
7/8/9). Esta spec **não** recria nenhum desses módulos: ela **compõe e amplia** o que já está em
produção — em especial as métricas/alertas/logs de `admin-central-operacao`, o hub de notificações de
`notifications-hub` e a abstração de IA de `admin-assistant`.

### Decisões de escopo do v1 (defaults aprovados pelo dono)

1. **Autonomia read-only**: no v1 a `Supervisor_AI` **observa, responde, resume, detecta anomalias e
   sugere** — mas **nunca executa ações de negócio nem ações destrutivas** automaticamente (não pausa
   campanha, não bane usuário, não muta dados de cliente). Quando identifica algo acionável, ela
   **sugere** e o admin decide. Esse é o limite de segurança do `Supervisor_AI`.
2. **Canal proativo do v1**: as notificações proativas usam **apenas o painel interno (in-app)**,
   reusando `notifications-hub`. Os canais **WhatsApp/Telegram/e-mail** ficam declarados como
   `Future_Channel` (fase 2).
3. **Provider de IA**: o chat reusa a `Provider_Abstraction` de `admin-assistant` (chave **no
   Vault**, nunca no frontend). Sem provider configurado, o chat degrada para "IA indisponível"
   enquanto a parte determinística (diagnóstico, anomalias por regra, resumo) continua funcionando.

### Governança embutida (Complemento "Segurança, Qualidade e Testes" do documento)

Esta spec **não** cria uma spec de governança à parte. Cada funcionalidade entrega a própria camada
de validação e proteção, impede vazamento de dados entre usuários/contas, impede ações sem permissão,
é testável (unit + property + cenários de falha + validações no frontend **e** no backend), trata
erros de forma segura (erro tratado, registrado, sistema segue) e segue arquitetura modular. Adere
integralmente aos steerings `testing-governance`, `project-conventions` e `admin-patterns`.

### Reuso obrigatório (não duplicar, não quebrar)

- **admin-central-operacao (migration 117)**: fonte primária dos agregados que a IA usa para
  responder e resumir (`admin_operations_metrics`), dos alertas operacionais (`system_alerts`) e dos
  logs (`admin_logs_list`). A `Supervisor_AI` **lê e compõe** essas fontes; **não** recria nem
  reescreve. As situações de alerta de 117 (WhatsApp desconectado, campanha pausada/erro, integração,
  assinatura vencendo, cliente aguardando) entram como sinais de monitoramento.
- **admin-assistant (migration 047)**: a `Provider_Abstraction` (multi-provider, chave no Vault,
  thresholds) é reusada para o chat. Esta spec **não** recria o provider nem expõe a chave.
- **notifications-hub (migration 041)**: canal in-app das notificações proativas. A `Supervisor_AI`
  publica notificações ao admin pelo hub existente, sem recriá-lo.
- **admin-foundation (migration 030) + `admin_audit_logs` + steering `admin-patterns`**: AdminGuard +
  Stealth_404, gating em duas camadas (UI `useAdminPermission` + RPC `is_admin_with_permission`),
  `executeAdminMutation`/`logAdminAction` (audit-by-construction) para ack/dismiss de insights,
  versionamento otimista (`expected_updated_at` + `STALE_VERSION`), idempotência `_SKIPPED`, postura
  de segurança de RPC (§10), master admin `Nexus_Vortex99` imutável e UI compacta (sem `<h1>`, filtros
  em popover, paginação `10/50/100`).
- **whatsapp-automation (092+)/suporte-inteligente (115)/assinaturas (055)**: fontes de sinais de
  monitoramento (filas/jobs, atendimentos, assinaturas), lidas como agregados/estados — sem PII.

### Fonte de dados e dependências futuras declaradas

A `Supervisor_AI` **não inventa fontes inexistentes**. Quando um sinal do documento não tem fonte
disponível hoje, a dependência é declarada e a superfície degrada de forma honesta:

- **Métricas de recursos de infraestrutura** (CPU/memória/serviço consumindo muito): a plataforma
  hospedada (Supabase/Vercel) não expõe isso ao SQL da aplicação. O v1 monitora o que é **consultável**
  — padrões de erro nos `Supervisor_Diagnostics`, alertas/logs de 117 e estados de fila/jobs do
  WhatsApp. Métricas de recurso ficam como `Future_Signal`.
- **Canais WhatsApp/Telegram/e-mail** das notificações proativas: `Future_Channel` (fase 2); o v1
  usa só o painel interno.
- **"Usuários online"**: dependência futura já declarada em 117 (sem `Presence_Source`, exibe
  `indisponível`); a IA reflete o mesmo, sem fabricar número.
- **Provider de IA não configurado**: o chat responde "IA indisponível no momento" (degradação
  controlada); diagnóstico, detecção de anomalias por regra e resumo periódico seguem funcionando.

### Migration

A entrega adiciona a **migration 118** (`118_admin_ia_supervisora.sql` + par documentado
`118_admin_ia_supervisora_rollback.sql`), próxima numeração livre após a 117.

---

## Glossário (identifiers em inglês, mensagens user-facing em pt-BR)

- **Supervisor_AI**: a camada de IA Supervisora interna (read-only) desta spec.
- **Supervisor_Console**: a superfície admin em `/admin/supervisor` (Painel Inteligente + Diagnóstico
  + Insights + Resumo).
- **Supervisor_Chat**: o chat em linguagem natural do Painel Inteligente.
- **Supervisor_Context**: o pacote de **agregados não sensíveis** (contagens, estados, marcadores)
  montado server-side e enviado ao provider de IA para fundamentar a resposta. **Nunca** contém PII,
  conteúdo de mensagens nem segredos.
- **Supervisor_Diagnostic**: registro técnico da Central de Diagnóstico (tabela `supervisor_diagnostics`)
  — `module`, `operation`, `severity`, `description`, `probable_cause`, `suggested_fix`, `occurred_at`,
  `dedup_key`. Admin-only; cliente nunca vê.
- **Supervisor_Insight**: registro de autoanálise (tabela `supervisor_insights`) — `insight_type`
  (`ANOMALY`/`SUGGESTION`/`SUMMARY`/`SECURITY`), `severity`, `state`, `title`, `detail`, `dedup_key`.
- **Insight_Severity**: domínio fechado `CRITICAL` / `WARNING` / `INFO`.
- **Insight_State**: domínio fechado `OPEN` / `ACKNOWLEDGED` / `DISMISSED` (`DISMISSED` terminal).
- **Severity_Classifier**: função pura determinística evento/diagnóstico → `Insight_Severity` +
  prioridade + decisão de notificação (imediata vs agrupada).
- **Anomaly_Detector**: função pura determinística que, sobre uma janela de diagnósticos/eventos,
  produz o conjunto de anomalias ativas (ex.: mesmo `error_code` ≥ `threshold` na janela; pico de taxa
  de erro; fila travada), com `Insight_Dedup_Key` estável. Sinal de fonte ausente ⇒ **nenhuma**
  anomalia daquele tipo (sem fabricar).
- **Insight_Dedup_Key**: chave determinística `insight_type:scope:subject` (no máximo um insight ativo
  por situação).
- **Summary_Builder**: função pura que monta o `Periodic_Summary` (texto pt-BR) a partir de agregados
  — sem PII.
- **Notification_Router**: regra determinística — `CRITICAL` ⇒ notificação **imediata** in-app;
  `WARNING`/`INFO` ⇒ **agrupados** no `Periodic_Summary` (sem interromper o admin à toa).
- **Periodic_Summary**: `Supervisor_Insight` do tipo `SUMMARY` gerado periodicamente (pg_cron).
- **Question_Context_Plan**: mapa determinístico de **intenção** da pergunta → blocos de agregados a
  incluir no `Supervisor_Context` (ex.: "faturamento" → bloco assinaturas; "whatsapp" → bloco
  instâncias/jobs).
- **Provider_Abstraction**: a abstração multi-provider de `admin-assistant` (chave no Vault).
- **Future_Channel** / **Future_Signal**: dependências declaradas (fase 2 / fonte indisponível hoje).
- **Action codes** (inglês, em `admin_audit_logs`): `SUPERVISOR_DIAGNOSTIC_RECORDED`,
  `SUPERVISOR_INSIGHT_GENERATED`, `SUPERVISOR_INSIGHT_ACK`, `SUPERVISOR_INSIGHT_DISMISS`,
  `SUPERVISOR_INSIGHT_ACK_SKIPPED`, `SUPERVISOR_INSIGHT_DISMISS_SKIPPED`, `SUPERVISOR_CHAT_QUERY`,
  `SUPERVISOR_VIEW_DENIED`.
- **Permissões novas**: `SUPERVISOR_VIEW` (ler console/chat/diagnóstico/insights/resumo) e
  `SUPERVISOR_MANAGE` (reconhecer/descartar insights). Concedidas por construção a `SUPER_ADMIN`
  (wildcard) e `ADMIN` (allow-all menos deny-list); negadas a `FINANCEIRO`/`SUPORTE`/`MODERADOR`.

---

## Requirements

### Requirement 1 — Acesso e gating do Supervisor_Console

**User Story:** Como administrador, quero que a IA Supervisora seja uma área protegida do painel, para
que apenas administradores autorizados vejam a saúde técnica do sistema.

#### Acceptance Criteria

1. WHEN um caller sem `SUPERVISOR_VIEW` acessa qualquer rota de `/admin/supervisor`, THE
   Supervisor_Console SHALL renderizar `Stealth_404` (idêntico ao 404 público), sem revelar a rota.
2. WHEN o item de menu "Supervisor" é avaliado para um caller sem `SUPERVISOR_VIEW`, THE AdminSidebar
   SHALL ocultá-lo.
3. THE Supervisor_Console SHALL aplicar gating em duas camadas: UI (`useAdminPermission`) **e** RPC
   (`is_admin_with_permission`); o servidor decide e o front nunca autoriza sozinho.
4. IF `auth.uid()` é nulo em qualquer RPC desta spec, THEN a RPC SHALL recusar com `permission_denied`
   (ERRCODE 42501).

### Requirement 2 — Painel Inteligente (chat read-only)

**User Story:** Como administrador, quero conversar com a IA em linguagem natural e receber respostas
baseadas em dados atualizados do sistema, sem precisar navegar por várias telas.

#### Acceptance Criteria

1. WHEN o admin envia uma pergunta no `Supervisor_Chat`, THE Supervisor_AI SHALL responder usando o
   `Supervisor_Context` (agregados atualizados) montado server-side.
2. THE Supervisor_Chat SHALL ser **read-only**: NUNCA executa mutação de dado de negócio nem ação
   destrutiva; quando algo é acionável, a resposta SHALL apresentar uma **sugestão** ao admin.
3. THE Supervisor_Context enviado ao provider SHALL conter apenas agregados não sensíveis (contagens,
   estados, marcadores) e SHALL NÃO conter PII (e-mail, telefone, CPF, CNPJ), conteúdo de mensagens
   nem segredos.
4. WHEN o provider de IA não está configurado ou falha, THE Supervisor_Chat SHALL responder com uma
   mensagem pt-BR de indisponibilidade (degradação controlada), sem derrubar a página nem vazar erro
   técnico ao cliente.
5. WHEN uma consulta de chat é executada, THE Supervisor_AI SHALL registrar `SUPERVISOR_CHAT_QUERY`
   em `admin_audit_logs` com metadados não sensíveis (sem o conteúdo bruto que possa conter PII).
6. THE chat SHALL ser gated por `SUPERVISOR_VIEW` em duas camadas.

### Requirement 3 — Central de Diagnóstico (admin-only)

**User Story:** Como administrador, quero um lugar único com todos os erros e eventos técnicos do
sistema, para diagnosticar problemas sem que o cliente jamais veja detalhes técnicos.

#### Acceptance Criteria

1. THE Diagnostic_Center SHALL registrar cada `Supervisor_Diagnostic` com, quando disponível: data/
   hora, módulo afetado, operação executada, descrição, severidade, possível causa e sugestão de
   correção.
2. THE `supervisor_diagnostics` SHALL ter RLS admin-only: SELECT gated por `SUPERVISOR_VIEW`; o
   cliente final e usuários não-admin recebem **zero** linhas.
3. WHEN ocorre uma falha técnica em qualquer módulo, THE sistema SHALL exibir ao usuário uma mensagem
   amigável em pt-BR, enquanto os detalhes técnicos ficam **apenas** no `Diagnostic_Center`.
4. THE escrita em `supervisor_diagnostics` SHALL ocorrer somente via RPC `SECURITY DEFINER`
   (`supervisor_record_diagnostic`, invocável por service-role/monitor); DML direto é negado pela RLS.
5. THE `Supervisor_Diagnostic.detail` SHALL NÃO conter PII bruta nem segredos (sanitização antes de
   persistir/exibir).
6. THE registro de diagnóstico SHALL ser idempotente por `dedup_key` da situação (não duplicar o
   mesmo problema ativo).

### Requirement 4 — Severidade e priorização determinística

**User Story:** Como administrador, quero que os eventos sejam classificados por gravidade para eu
saber o que precisa de atenção imediata.

#### Acceptance Criteria

1. THE Severity_Classifier SHALL ser **total e determinístico**: para a mesma entrada, sempre a mesma
   `Insight_Severity` (`CRITICAL`/`WARNING`/`INFO`).
2. THE Severity_Classifier SHALL marcar como `CRITICAL` situações críticas (financeiro/técnico/
   integração fora do ar, fila travada, vazamento suspeito) conforme um mapa fixo.
3. WHEN a severidade é `CRITICAL`, THE Notification_Router SHALL decidir **notificação imediata**;
   WHEN `WARNING`/`INFO`, SHALL decidir **agrupar** no `Periodic_Summary`.

### Requirement 5 — Autoanálise e detecção de anomalias

**User Story:** Como administrador, quero que a IA identifique padrões problemáticos sozinha (erros
repetidos, lentidão, processos travados) e me alerte.

#### Acceptance Criteria

1. THE Anomaly_Detector SHALL ser **determinístico**: para o mesmo snapshot de diagnósticos/eventos,
   sempre o mesmo conjunto de anomalias.
2. WHEN o mesmo `error_code`/situação ocorre acima de um `threshold` numa janela, THE Anomaly_Detector
   SHALL produzir uma anomalia daquele tipo, com `Insight_Dedup_Key` estável.
3. IF a fonte de um sinal está ausente (módulo não presente), THEN o Anomaly_Detector SHALL **omitir**
   anomalias daquele tipo (sem fabricar registros).
4. THE reconciliação de anomalias SHALL ser idempotente: reaplicar sobre o mesmo estado não cria 2º
   insight ativo para a mesma situação; situações extintas são auto-resolvidas/encerradas.

### Requirement 6 — Sugestões de melhoria

**User Story:** Como administrador, quero que a IA não só aponte problemas, mas também sugira
melhorias acionáveis.

#### Acceptance Criteria

1. WHEN a IA identifica um padrão acionável (tarefa repetitiva, fluxo com abandono, consulta lenta,
   funcionalidade com muitos erros), THE Supervisor_AI SHALL gerar um `Supervisor_Insight` do tipo
   `SUGGESTION` com título e descrição em pt-BR, sem PII.
2. THE sugestão SHALL ser **informativa**: nunca dispara ação automática; o admin decide.

### Requirement 7 — Notificações proativas (in-app, v1)

**User Story:** Como administrador, quero ser avisado proativamente quando algo importante acontece,
sem precisar entrar no sistema para descobrir.

#### Acceptance Criteria

1. WHEN um `Supervisor_Insight` `CRITICAL` é gerado, THE Supervisor_AI SHALL publicar uma notificação
   **imediata** no painel interno (via `notifications-hub`).
2. WHEN insights `WARNING`/`INFO` são gerados, THE Supervisor_AI SHALL **agrupá-los** no
   `Periodic_Summary` (sem interromper o admin a cada evento).
3. THE notificações proativas do v1 SHALL usar **apenas** o canal in-app; canais
   WhatsApp/Telegram/e-mail são `Future_Channel`.
4. THE notificações SHALL NÃO conter PII nem segredos.

### Requirement 8 — Resumo inteligente periódico

**User Story:** Como administrador, quero um resumo periódico da situação da empresa para ter uma
visão rápida.

#### Acceptance Criteria

1. THE Summary_Builder SHALL gerar, periodicamente (pg_cron), um `Periodic_Summary` a partir de
   agregados (cadastros, assinaturas, campanhas, atendimentos, alertas abertos), em pt-BR.
2. THE Summary_Builder SHALL ser **determinístico** e SHALL NÃO conter PII.
3. THE geração periódica SHALL ser idempotente por janela (não duplicar o resumo do mesmo período).

### Requirement 9 — Ciclo de vida de insights (reconhecer/descartar)

**User Story:** Como administrador, quero reconhecer ou descartar insights para organizar o que já
tratei.

#### Acceptance Criteria

1. THE ack/dismiss de um `Supervisor_Insight` SHALL usar versionamento otimista (`expected_updated_at`):
   versão divergente ⇒ `STALE_VERSION`, sem mutar.
2. WHEN reconhecer um insight já `ACKNOWLEDGED` ou descartar um já `DISMISSED`, THE RPC SHALL retornar
   `_SKIPPED` (sem mutar) e gravar `SUPERVISOR_INSIGHT_ACK_SKIPPED`/`_DISMISS_SKIPPED`.
3. THE estado `DISMISSED` SHALL ser terminal (não retorna a `OPEN`/`ACKNOWLEDGED`).
4. THE ack/dismiss SHALL ser gated por `SUPERVISOR_MANAGE`; mutação real grava audit positivo
   `SUPERVISOR_INSIGHT_ACK`/`SUPERVISOR_INSIGHT_DISMISS` (audit-by-construction).
5. IF a checagem de permissão falha simultaneamente a um erro de validação de input, THEN a RPC SHALL
   responder `permission_denied` (precedência sobre a validação).

### Requirement 10 — Listagem, ordenação e paginação

**User Story:** Como administrador, quero listar diagnósticos e insights com filtros e ordenação
estável.

#### Acceptance Criteria

1. THE listagens SHALL ordenar de forma **total e determinística** (insights: severidade ↑, depois
   `created_at` ↓, depois `id`; diagnósticos: `occurred_at` ↓, depois `id`).
2. THE listagens SHALL paginar com `p_limit ∈ {10,50,100}` (default 10) e oferecer filtros
   (tipo/severidade/estado para insights; módulo/severidade/datas para diagnósticos) em popover.
3. THE filtros de formulário inválidos SHALL bloquear o envio **e** exibir mensagem pt-BR (validação
   no frontend); o backend revalida.

### Requirement 11 — Segurança, isolamento e não-vazamento

**User Story:** Como administrador, quero garantia de que a IA Supervisora nunca vaze dados entre
contas nem exponha segredos.

#### Acceptance Criteria

1. THE `supervisor_diagnostics` e `supervisor_insights` SHALL ter RLS admin-only (SELECT sob
   `SUPERVISOR_VIEW`; DML direto negado); `anon`/Cliente/não-admin recebem zero linhas.
2. THE `Supervisor_Context`, `Supervisor_Diagnostic.detail`, `Supervisor_Insight.detail`,
   `Periodic_Summary` e as notificações SHALL NÃO conter PII bruta nem segredos.
3. IF a IA identifica risco de vazamento ou mistura de dados entre usuários/instâncias, THEN SHALL
   registrar um `Supervisor_Insight` `SECURITY` e notificar o admin — sem expor os dados sensíveis.
4. THE RPCs SHALL rodar `SECURITY DEFINER` com `SET search_path = public`, `REVOKE ALL FROM PUBLIC` +
   `GRANT EXECUTE TO authenticated` (geração/cron também `service_role`); nunca expostas ao `anon`.

### Requirement 12 — RBAC / Permission_Matrix

**User Story:** Como dono, quero que só administradores plenos acessem a IA Supervisora.

#### Acceptance Criteria

1. THE `is_admin_with_permission('SUPERVISOR_VIEW')` e `('SUPERVISOR_MANAGE')` SHALL ser verdadeiro
   **somente** para `SUPER_ADMIN` e `ADMIN`; falso para `FINANCEIRO`/`SUPORTE`/`MODERADOR` e `anon`.
2. THE re-asserção de `is_admin_with_permission` SHALL **preservar** o corpo vigente on-disk
   (030 + deny-list + ações de 115/116/117); as ações novas são reconhecidas **por construção** (sem
   ramo dedicado).
3. THE caminho negativo de RPC gated SHALL registrar `SUPERVISOR_VIEW_DENIED` (`before` nulo,
   `after = {user_id, reason}`).

### Requirement 13 — Master_Admin imutável e estabilidade

**User Story:** Como dono, quero que a IA Supervisora seja segura e estável: nunca toque dados
protegidos e nunca derrube o sistema por causa de uma falha própria.

#### Acceptance Criteria

1. THE mutações desta spec (ack/dismiss de insights) SHALL NÃO tocar a tabela `users`, preservando a
   imutabilidade do Master_Admin (`Nexus_Vortex99`) por construção.
2. IF a geração de insight, o registro de diagnóstico, a chamada ao provider ou uma fonte de
   monitoramento falha, THEN o sistema SHALL tratar de forma segura (registrar e seguir), sem abortar
   a operação principal nem o `Supervisor_Console`.
3. THE falha de audit logging SHALL NÃO bloquear a mutação administrativa (decisão `testing-governance`).

### Requirement 14 — Migration idempotente e rollback

#### Acceptance Criteria

1. THE migration 118 SHALL ser idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY/TRIGGER
   IF EXISTS`), envolvida em `BEGIN; ... COMMIT;`, com bloco defensivo `DO $check$` das dependências
   (030/041/047/117) e bloco `-- VERIFY` comentado.
2. THE migration 118 SHALL vir acompanhada de par `118_admin_ia_supervisora_rollback.sql` documentado
   (não auto-aplicado).
3. THE agendamento pg_cron (resumo + anomaly scan) SHALL ser **defensivo** (não falha sem a extensão).

### Requirement 15 — Validação em duas pontas, Regression_Suite e cobertura

#### Acceptance Criteria

1. THE validação SHALL ocorrer no **frontend e no backend** (mesma regra).
2. THE testes unit/property/falha desta spec SHALL ser incorporados à Regression_Suite (qualquer
   falha, inclusive flaky pós-retry, bloqueia merge/deploy).
3. THE núcleo puro SHALL ser registrado como `Critical_Module` em `tests/coverage.config.ts` com
   threshold mínimo; abaixo do mínimo o build falha.

---

## Correctness Properties (resumo; detalhe no design)

- **CP1** — Determinismo/totalidade do `Severity_Classifier` (Req 4).
- **CP2** — Determinismo do `Anomaly_Detector` + omissão sem fonte (Req 5.1–5.3).
- **CP3** — Dedup/idempotência da reconciliação de insights (Req 5.4, 3.6).
- **CP4** — Idempotência/versionamento de ack/dismiss (`Insight_Lifecycle`) (Req 9).
- **CP5** — Determinismo do `Summary_Builder` + sem PII (Req 8).
- **CP6** — Precedência de `permission_denied` (Req 9.5, 1.4, 12).
- **CP7** — Isolamento e não-vazamento de PII/segredos no `Supervisor_Context`/`detail`/`summary`
  (Req 2.3, 3.5, 11.2).
- **CP8** — Ordenação determinística de diagnósticos e insights (Req 10.1).
- **CP9** — Totalidade/determinismo do `Question_Context_Plan` (Req 2.1).

CP1–CP9 são obrigatórias (sem asterisco). Cada uma é coberta por **um** teste de propriedade
fast-check (mín. 100 iterações), reusando os helpers canônicos de `src/__tests__/_helpers/`.
