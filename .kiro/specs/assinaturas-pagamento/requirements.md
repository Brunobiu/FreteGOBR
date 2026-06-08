# Requirements Document

## Introduction

Esta feature implementa a cobrança de mensalidade dos motoristas do FreteGO por meio do gateway
de pagamento Asaas, evoluindo o mecanismo de trial já existente (spec `trial-e-bloqueio`,
migration 044). Apenas o Motorista paga. O Embarcador permanece gratuito.

O Motorista pode contratar um de três planos (Mensal, Trimestral, Semestral), pagando o total do
plano em parcela única no momento da contratação, com renovação automática recorrente apenas ao
vencimento do ciclo contratado. O cartão de crédito permite recorrência automática (o Asaas cobra
sozinho a cada ciclo). PIX e boleto também são suportados como métodos de pagamento.

Quando um pagamento falha, o Motorista é notificado e ganha um prazo de tolerância de 5 dias
(estado `past_due`), durante o qual mantém acesso completo. Se não pagar nesse prazo, o Motorista
é suspenso: passa a ver o feed de fretes, mas perde toda interação (clicar, conversar, curtir,
obter contato). Ao pagar, a assinatura reativa e renova um ciclo.

O contador de dias do trial passa a ser exibido no selo do app ("FREE · N dias restantes"),
trocando para o selo do plano pago ("Plus"/"Profissional") quando o Motorista assina. O sistema
notifica automaticamente o Motorista quando faltam 1 a 2 dias para o fim do trial e em cada falha
de pagamento, sempre apenas o usuário afetado, nunca em massa. O Motorista enxerga seu histórico
de cobranças e recebe notificação de cada cobrança realizada.

No painel admin, a área "Financeiro" de comissão sobre fretes encerrados é ocultada do menu (o
código permanece intacto, apenas escondido) e em seu lugar surge a área "Assinaturas", que mostra
a movimentação de assinaturas dos motoristas agrupada em A Vencer, Pagas e Vencidas/Inadimplentes,
com busca, filtros e paginação 10/50/100, sob gating de permissão admin.

O webhook do Asaas é recebido por uma Edge Function que valida a autenticidade do evento antes de
processar e é totalmente idempotente (processar o mesmo evento duas vezes não duplica efeito).

**Escopo FUTURO, explicitamente FORA de implementação nesta spec:** o modelo de conta "Empresa",
que futuramente vincula N embarcadores e é cobrada por quantidade de embarcadores. Esta spec
APENAS reserva espaço no modelo de dados para esse vínculo (Requirement 14); nenhuma cobrança,
tela, RPC ou regra de Empresa é implementada aqui.

**Outras restrições de escopo:**

- A chave de API do Asaas é secreta, reside somente no servidor (Edge Function / Supabase Vault) e
  nunca é exposta ao cliente. A integração inicia em ambiente sandbox/teste do Asaas.
- A cobrança real continua sendo via Asaas; esta spec não implementa um processador de pagamento
  próprio.

## Glossary

- **Subscription_System**: Conjunto lógico responsável por criar, renovar, suspender, reativar e
  cancelar assinaturas de motoristas, e por derivar o estado de acesso a partir dos campos de
  assinatura.
- **Motorista**: Usuário com `users.user_type = 'motorista'`. Único tipo de usuário que paga
  assinatura nesta spec.
- **Embarcador**: Usuário com `users.user_type = 'embarcador'`. Permanece gratuito.
- **Admin**: Usuário com `users.user_type = 'admin'`, incluindo o Master Admin imutável
  (`users.admin_username = 'Nexus_Vortex99'`).
- **Asaas**: Gateway de pagamento externo (conta existente) que processa PIX, boleto e cartão de
  crédito, e dispara webhooks de eventos de pagamento.
- **Asaas_Gateway**: Camada de servidor (Edge Functions) que encapsula a comunicação com o Asaas,
  detendo a chave de API secreta.
- **Asaas_Webhook_Handler**: Edge Function que recebe, valida a autenticidade e processa de forma
  idempotente os eventos enviados pelo Asaas.
- **Plan**: Plano de assinatura do Motorista. Domínio fechado: `mensal`, `trimestral`, `semestral`.
- **payment_method**: Método de pagamento de uma cobrança. Domínio fechado: `credit_card`, `pix`,
  `boleto`.
- **Subscription**: Registro da assinatura de um Motorista (plano, método, estado, datas de ciclo,
  identificadores do Asaas).
- **Charge**: Registro de uma cobrança individual da assinatura (valor, data, status, método,
  identificador do Asaas).
- **subscription_status**: Coluna `text` existente em `users`, domínio fechado
  (`trial`, `active`, `past_due`, `canceled`, `blocked`). Rótulo informativo de estado.
- **trial_ends_at**: Coluna `timestamptz` existente em `users` que marca o fim do trial gratuito
  de 30 dias do Motorista.
- **is_subscribed**: Coluna `boolean` existente em `users` que indica assinatura paga ativa.
- **access_state**: Estado de acesso derivado do Motorista. Domínio:
  `trial`, `active`, `past_due`, `suspended`, `canceled`.
- **grace_period**: Janela de tolerância de 5 dias após uma falha/vencimento de pagamento, durante
  a qual o Motorista permanece no estado `past_due` com acesso completo.
- **suspended**: access_state derivado em que o Motorista, após esgotado o grace_period sem
  pagamento, vê o feed de fretes mas não realiza nenhuma ação interativa.
- **billing_cycle**: Período pago de uma contratação (1, 3 ou 6 meses, conforme o Plan), ao fim do
  qual ocorre a próxima cobrança.
- **next_charge_at**: Coluna `timestamptz` que marca o instante da próxima cobrança da assinatura.
- **TrialBadge**: Componente de selo existente no header do app do Motorista.
- **useTrialStatus**: Hook React existente que expõe o estado de trial/assinatura do usuário atual.
- **trialStatus**: Módulo de núcleo puro existente (`src/utils/trialStatus.ts`) que espelha em
  TypeScript a lógica de bloqueio do servidor.
- **is_motorista_trial_blocked**: Função SQL existente (migration 044) usada na RLS de fretes e nos
  guards de interação; sua semântica é evoluída por esta spec.
- **toggle_frete_like**: RPC SQL existente de curtida/contato de frete pelo Motorista.
- **Notifications_Hub**: Sistema de notificações existente (tabela `notifications`, migration 041)
  reutilizado para os avisos de vencimento e cobrança.
- **Billing_Notifier**: Lógica automatizada que dispara notificações de vencimento de trial e de
  falha/realização de cobrança apenas ao Motorista afetado.
- **device_tokens**: Tabela existente (migration 042) de tokens de push, com a Edge Function
  `send-push-notification`.
- **Admin_Subscriptions_Panel**: Área "Assinaturas" do painel admin que exibe a movimentação de
  assinaturas dos motoristas.
- **Admin_Financeiro_Comissao**: Área "Financeiro" existente (migration 037) de comissão sobre
  fretes encerrados, a ser ocultada do menu admin.
- **executeAdminMutation**: Wrapper existente de audit-by-construction para mutações admin.
- **is_admin_with_permission**: Função SQL existente de RBAC server-side do painel admin.
- **permission_denied**: Erro canônico de autorização do projeto, com precedência sobre qualquer
  erro de validação simultâneo.
- **Company_Account**: Conta "Empresa" futura (fora de escopo de implementação) que vincula N
  embarcadores e é cobrada por quantidade de embarcadores.

## Requirements

### Requirement 1: Catálogo de Planos e Cálculo de Total

**User Story:** Como motorista, quero ver os três planos com seus valores e total, para que eu
escolha o que melhor cabe no meu orçamento.

#### Acceptance Criteria

1. THE Subscription_System SHALL disponibilizar exatamente três planos com identificadores
   `mensal`, `trimestral` e `semestral`.
2. THE Subscription_System SHALL definir o plano `mensal` com valor mensal de R$ 39,90, duração de
   1 mês e total de R$ 39,90.
3. THE Subscription_System SHALL definir o plano `trimestral` com valor mensal de R$ 34,90, duração
   de 3 meses e total de R$ 104,70.
4. THE Subscription_System SHALL definir o plano `semestral` com valor mensal de R$ 29,90, duração
   de 6 meses e total de R$ 179,40.
5. THE Subscription_System SHALL calcular o total de um plano como o valor mensal multiplicado pela
   quantidade de meses da duração do plano.
6. THE Subscription_System SHALL marcar o plano `semestral` como plano recomendado em destaque.
7. WHERE a tela de planos é exibida ao Motorista, THE Subscription_System SHALL apresentar os
   valores em formato monetário pt-BR (separador decimal vírgula e prefixo "R$").

### Requirement 2: Contratação de Assinatura e Cobrança em Parcela Única

**User Story:** Como motorista, quero contratar um plano e pagar o total de uma vez, para que eu
ative minha assinatura imediatamente.

#### Acceptance Criteria

1. WHEN um Motorista autenticado contrata um Plan com um payment_method válido, THE
   Subscription_System SHALL criar uma Subscription vinculada a esse Motorista com o Plan e o
   payment_method escolhidos.
2. WHEN uma Subscription é criada, THE Subscription_System SHALL solicitar ao Asaas_Gateway uma
   cobrança de parcela única no valor do total do Plan contratado.
3. WHEN a cobrança da contratação é confirmada como paga, THE Subscription_System SHALL definir
   `users.is_subscribed` como `true` e `users.subscription_status` como `active`.
4. WHEN uma Subscription torna-se `active`, THE Subscription_System SHALL definir `next_charge_at`
   como a data de contratação acrescida da duração em meses do Plan contratado.
5. IF um usuário que não é Motorista tenta contratar uma Subscription, THEN THE Subscription_System
   SHALL rejeitar a operação com `permission_denied`.
6. IF o payment_method informado não pertence ao domínio `credit_card`, `pix` ou `boleto`, THEN THE
   Subscription_System SHALL rejeitar a contratação com erro de validação e exibir mensagem em
   pt-BR.
7. WHEN uma cobrança de contratação é registrada, THE Subscription_System SHALL persistir uma
   Charge correspondente com valor, data, payment_method e status.

### Requirement 3: Cadastro de Cartão para Recorrência Automática

**User Story:** Como motorista, quero cadastrar meu cartão de crédito, para que o Asaas cobre
automaticamente a cada ciclo sem que eu precise agir.

#### Acceptance Criteria

1. WHEN um Motorista contrata um Plan com payment_method `credit_card`, THE Asaas_Gateway SHALL
   registrar o cartão como meio de cobrança recorrente da Subscription no Asaas.
2. WHERE a Subscription usa payment_method `credit_card`, THE Subscription_System SHALL marcar a
   Subscription como de recorrência automática.
3. THE Asaas_Gateway SHALL transmitir os dados de cartão diretamente ao Asaas sem persistir o
   número completo do cartão na base de dados do FreteGO.
4. WHEN o billing_cycle de uma Subscription com recorrência automática vence, THE Subscription_System
   SHALL depender da cobrança automática do Asaas para o ciclo seguinte, sem exigir ação do
   Motorista.
5. IF o registro do cartão no Asaas falha, THEN THE Subscription_System SHALL rejeitar a ativação da
   Subscription e exibir mensagem de erro em pt-BR ao Motorista.

### Requirement 4: Renovação Recorrente ao Vencimento

**User Story:** Como motorista que pagou vários meses, quero ser cobrado novamente só quando o
período vencer, para que eu não pague em duplicidade.

#### Acceptance Criteria

1. THE Subscription_System SHALL agendar a próxima cobrança de uma Subscription `active` somente
   para o instante `next_charge_at`, ao fim do billing_cycle contratado.
2. WHEN uma cobrança de renovação é confirmada como paga, THE Subscription_System SHALL avançar
   `next_charge_at` em mais um billing_cycle igual à duração do Plan vigente.
3. WHEN uma cobrança de renovação é confirmada como paga, THE Subscription_System SHALL manter
   `users.subscription_status` como `active` e `users.is_subscribed` como `true`.
4. THE Subscription_System SHALL registrar uma Charge para cada cobrança de renovação realizada.
5. WHILE a data atual é anterior a `next_charge_at`, THE Subscription_System SHALL não gerar nova
   cobrança de renovação para a Subscription.

### Requirement 5: Falha de Pagamento e Tolerância de 5 Dias

**User Story:** Como motorista, quero um prazo de 5 dias para regularizar um pagamento que falhou,
para que eu não perca acesso imediatamente por um problema pontual.

#### Acceptance Criteria

1. WHEN o Asaas_Webhook_Handler recebe um evento de pagamento vencido ou falho de uma Subscription,
   THE Subscription_System SHALL definir `users.subscription_status` como `past_due`.
2. WHEN uma Subscription entra em `past_due`, THE Subscription_System SHALL registrar o instante de
   início do grace_period e definir o fim do grace_period como esse instante acrescido de 5 dias.
3. WHILE uma Subscription está em `past_due` dentro do grace_period, THE Subscription_System SHALL
   conceder ao Motorista acesso completo às funcionalidades interativas.
4. WHEN uma Subscription entra em `past_due`, THE Billing_Notifier SHALL notificar o Motorista
   afetado sobre a falha de pagamento e o prazo de regularização.
5. IF um pagamento de uma Subscription em `past_due` é confirmado dentro do grace_period, THEN THE
   Subscription_System SHALL retornar `users.subscription_status` para `active` e renovar um
   billing_cycle.
6. IF o grace_period de uma Subscription em `past_due` se esgota sem confirmação de pagamento, THEN
   THE Subscription_System SHALL transitar o Motorista para o access_state `suspended`.

### Requirement 6: Suspensão — Vê Fretes mas Não Interage

**User Story:** Como plataforma, quero que um motorista inadimplente além da tolerância ainda veja
os fretes mas não interaja, para que ele perceba o valor do serviço e seja incentivado a pagar.

#### Acceptance Criteria

1. WHILE um Motorista está em access_state `suspended`, THE Subscription_System SHALL permitir a
   visualização do feed de fretes.
2. WHILE um Motorista está em access_state `suspended`, THE Subscription_System SHALL impedir que o
   Motorista curta um frete, obtenha contato, abra ou envie mensagem no chat, ou realize qualquer
   ação interativa.
3. WHEN um Motorista `suspended` tenta executar uma ação interativa no cliente, THE
   Subscription_System SHALL bloquear a ação na camada de UI e exibir um aviso em pt-BR com chamada
   para regularizar a assinatura.
4. WHEN uma requisição de um Motorista `suspended` tenta executar uma ação interativa protegida no
   servidor, THE Subscription_System SHALL rejeitar a operação retornando `permission_denied`.
5. IF um Motorista `suspended` requisita uma ação protegida e há simultaneamente um erro de
   validação de entrada, THEN THE Subscription_System SHALL retornar `permission_denied` com
   precedência sobre o erro de validação.
6. WHEN a RLS de fretes avalia uma requisição de leitura de um Motorista `suspended`, THE
   Subscription_System SHALL permitir a leitura do feed de fretes, em contraste com o motorista de
   trial expirado cujo feed é ocultado.
7. WHERE o usuário da requisição é Embarcador ou Admin, THE Subscription_System SHALL não aplicar
   nenhuma restrição de suspensão.

### Requirement 7: Reativação ao Pagar

**User Story:** Como motorista suspenso, quero recuperar o acesso completo assim que eu pagar, para
que eu volte a usar a plataforma imediatamente.

#### Acceptance Criteria

1. WHEN o Asaas_Webhook_Handler confirma o pagamento de um Motorista `suspended`, THE
   Subscription_System SHALL definir `users.subscription_status` como `active` e `users.is_subscribed`
   como `true`.
2. WHEN um Motorista `suspended` é reativado por pagamento, THE Subscription_System SHALL avançar
   `next_charge_at` em um billing_cycle igual à duração do Plan vigente a partir da confirmação do
   pagamento.
3. WHEN um Motorista é reativado, THE Subscription_System SHALL restaurar o acesso a todas as ações
   interativas tanto na camada de UI quanto no servidor.
4. WHEN um Motorista é reativado por pagamento, THE Billing_Notifier SHALL notificar o Motorista
   afetado sobre a reativação da assinatura.
5. WHEN uma reativação registra uma cobrança paga, THE Subscription_System SHALL persistir a Charge
   correspondente.

### Requirement 8: Cancelamento de Assinatura

**User Story:** Como motorista, quero cancelar minha assinatura, para que eu deixe de ser cobrado
quando não quiser mais o serviço.

#### Acceptance Criteria

1. WHEN um Motorista autenticado solicita o cancelamento da sua Subscription, THE Subscription_System
   SHALL solicitar ao Asaas_Gateway o cancelamento da recorrência no Asaas.
2. WHEN uma Subscription é cancelada, THE Subscription_System SHALL definir `users.subscription_status`
   como `canceled`.
3. WHEN uma Subscription é cancelada, THE Subscription_System SHALL cessar o agendamento de novas
   cobranças de renovação para essa Subscription.
4. IF um Motorista solicita o cancelamento de uma Subscription que já está `canceled`, THEN THE
   Subscription_System SHALL tratar a solicitação como idempotente e não gerar efeito adicional.

### Requirement 9: Contador de Dias do Trial no Selo do App

**User Story:** Como motorista em teste, quero ver os dias restantes do trial no selo, para que eu
acompanhe quanto tempo gratuito me resta antes de assinar.

#### Acceptance Criteria

1. WHERE o usuário atual é Motorista não assinante em trial com `days_left` maior que 0, THE
   TrialBadge SHALL exibir o texto "FREE · {days_left} dias restantes".
2. WHILE o trial avança, THE TrialBadge SHALL decrementar o valor de dias restantes exibido a cada
   dia, conforme o cálculo de `days_left` do módulo trialStatus.
3. WHERE o usuário atual é Motorista assinante de um Plan pago, THE TrialBadge SHALL exibir o selo
   do plano pago em vez do selo "FREE".
4. WHERE o usuário atual é Embarcador ou Admin, THE TrialBadge SHALL permanecer oculto.
5. THE TrialBadge SHALL ser responsivo e legível em telas menores que 768px.

### Requirement 10: Notificação Automática de Vencimento e Cobrança (Anti-Disparo em Massa)

**User Story:** Como motorista, quero ser avisado quando meu trial está acabando, quando uma
cobrança é feita e quando um pagamento falha, para que eu nunca seja cobrado sem saber.

#### Acceptance Criteria

1. WHEN faltam entre 1 e 2 dias para o fim do trial de um Motorista, THE Billing_Notifier SHALL
   criar uma notificação no Notifications_Hub destinada somente a esse Motorista.
2. WHEN uma cobrança de uma Subscription é realizada, THE Billing_Notifier SHALL persistir uma
   notificação no Notifications_Hub e notificar o Motorista titular da Subscription com o valor e a
   data da cobrança.
3. THE Billing_Notifier SHALL destinar cada notificação automática exclusivamente ao Motorista
   afetado pelo evento, sem disparar para outros usuários.
4. THE Billing_Notifier SHALL criar no máximo uma notificação por Motorista por evento de
   vencimento ou ciclo de cobrança, garantindo idempotência via o índice único parcial de
   notificações de plano não lidas.
5. WHERE o Motorista possui device_tokens registrados, THE Billing_Notifier SHALL acionar o envio
   de push via a Edge Function existente de push, além da notificação persistida.
6. IF a criação da notificação para um evento já notificado é tentada novamente, THEN THE
   Billing_Notifier SHALL não criar uma notificação duplicada.

### Requirement 11: Histórico de Cobranças do Motorista

**User Story:** Como motorista, quero ver o histórico das minhas cobranças, para que eu acompanhe o
que já paguei e quando.

#### Acceptance Criteria

1. WHEN um Motorista autenticado acessa seu histórico de cobranças, THE Subscription_System SHALL
   listar as Charges da sua própria Subscription com valor, data, payment_method e status.
2. THE Subscription_System SHALL apresentar os valores das Charges em formato monetário pt-BR.
3. WHEN uma requisição lê o histórico de cobranças, THE Subscription_System SHALL retornar somente
   Charges pertencentes ao Motorista autenticado.
4. IF um Motorista tenta acessar Charges de outro usuário, THEN THE Subscription_System SHALL negar
   o acesso retornando `permission_denied`.
5. WHERE o Motorista ainda não possui nenhuma Charge, THE Subscription_System SHALL exibir um estado
   vazio com mensagem em pt-BR.

### Requirement 12: Webhook Seguro e Idempotente do Asaas

**User Story:** Como plataforma, quero processar os eventos de pagamento do Asaas de forma autêntica
e idempotente, para que o estado das assinaturas reflita os pagamentos sem fraude nem duplicidade.

#### Acceptance Criteria

1. WHEN o Asaas_Webhook_Handler recebe um evento, THE Asaas_Webhook_Handler SHALL validar a
   autenticidade do evento por meio do token ou assinatura do webhook antes de qualquer
   processamento.
2. IF a validação de autenticidade do evento falha, THEN THE Asaas_Webhook_Handler SHALL rejeitar o
   evento sem alterar o estado de qualquer Subscription.
3. WHEN o Asaas_Webhook_Handler recebe um evento já processado anteriormente, THE
   Asaas_Webhook_Handler SHALL reconhecer o evento sem produzir efeito adicional sobre o estado das
   assinaturas.
4. WHEN o Asaas_Webhook_Handler recebe um evento de pagamento confirmado ou recebido, THE
   Subscription_System SHALL atualizar a Subscription correspondente para o estado pago conforme os
   Requirements 2, 4 e 7.
5. WHEN o Asaas_Webhook_Handler recebe um evento de pagamento vencido, THE Subscription_System SHALL
   atualizar a Subscription correspondente conforme o Requirement 5.
6. THE Asaas_Gateway SHALL manter a chave de API do Asaas somente no servidor, sem expô-la ao
   cliente.
7. WHERE o ambiente é de desenvolvimento ou teste, THE Asaas_Gateway SHALL operar contra o ambiente
   sandbox do Asaas.

### Requirement 13: Área Admin de Assinaturas e Ocultação do Financeiro de Comissão

**User Story:** Como administrador, quero acompanhar a movimentação de assinaturas dos motoristas em
uma área dedicada, para que eu enxergue quem está a vencer, em dia e inadimplente.

#### Acceptance Criteria

1. THE Admin_Subscriptions_Panel SHALL ocultar a área Admin_Financeiro_Comissao do menu do painel
   admin sem remover o código dessa área.
2. THE Admin_Subscriptions_Panel SHALL exibir a movimentação de assinaturas dos motoristas agrupada
   em "A Vencer", "Pagas" e "Vencidas/Inadimplentes".
3. THE Admin_Subscriptions_Panel SHALL classificar como "Vencidas/Inadimplentes" os motoristas com
   `subscription_status` igual a `past_due` ou em access_state `suspended`.
4. THE Admin_Subscriptions_Panel SHALL permitir busca, filtros e paginação com seletor de 10, 50 ou
   100 itens, com padrão de 10.
5. WHEN um Admin com permissão acessa o Admin_Subscriptions_Panel, THE Admin_Subscriptions_Panel
   SHALL exibir a movimentação de assinaturas.
6. IF um Admin sem a permissão necessária tenta acessar o Admin_Subscriptions_Panel, THEN THE
   Admin_Subscriptions_Panel SHALL retornar a resposta de Stealth_404.
7. WHEN uma RPC server-side do Admin_Subscriptions_Panel é chamada sem a permissão necessária, THE
   Admin_Subscriptions_Panel SHALL registrar audit log negativo e rejeitar com `permission_denied`.

### Requirement 14: Preparação do Modelo de Dados de Empresa (Fora de Escopo de Implementação)

**User Story:** Como plataforma, quero reservar espaço no modelo de dados para a futura conta
Empresa, para que a evolução futura não exija reestruturação do esquema de assinaturas.

#### Acceptance Criteria

1. THE Subscription_System SHALL reservar no modelo de dados uma estrutura de vínculo entre uma
   Company_Account e múltiplos Embarcadores, prevista para uso futuro.
2. THE Subscription_System SHALL deixar a estrutura de vínculo de Company_Account sem efeito sobre o
   comportamento de cobrança implementado nesta spec.
3. THE Subscription_System SHALL não implementar cobrança, telas, RPCs ou regras de negócio de
   Company_Account nesta spec.
4. WHERE a estrutura de Company_Account existe no modelo de dados, THE Subscription_System SHALL
   documentar explicitamente que essa estrutura está fora do escopo de implementação desta feature.

### Requirement 15: Postura de Segurança das RPCs de Assinatura

**User Story:** Como plataforma, quero que toda RPC de assinatura siga o padrão de segurança do
projeto, para que o acesso seja controlado e auditável de forma consistente.

#### Acceptance Criteria

1. THE Subscription_System SHALL definir toda RPC SECURITY DEFINER de assinatura com
   `SET search_path = public`.
2. IF `auth.uid()` é nulo em uma RPC de assinatura, THEN THE Subscription_System SHALL rejeitar a
   chamada com `permission_denied`.
3. THE Subscription_System SHALL aplicar `REVOKE ALL FROM PUBLIC` e `GRANT EXECUTE TO authenticated`
   em toda RPC de assinatura.
4. WHEN uma RPC de assinatura sujeita a gating é chamada sem a permissão necessária, THE
   Subscription_System SHALL retornar `permission_denied` com precedência sobre qualquer erro de
   validação simultâneo.
5. THE Subscription_System SHALL impedir, via RLS, qualquer acesso cruzado de um Motorista aos dados
   de Subscription ou Charge de outro usuário.
