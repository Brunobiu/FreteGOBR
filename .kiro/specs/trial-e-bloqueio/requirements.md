# Requirements Document

## Introduction

Esta feature implementa o período de teste gratuito (trial) de 30 dias para motoristas no
FreteGO, com contador visual de dias restantes no header e bloqueio de acesso quando o trial
expira sem assinatura ativa. A feature também adiciona uma proteção anti-fraude no cadastro
(impedir reuso de CPF, telefone ou e-mail já cadastrados para reabrir o trial) e o reflexo
completo no painel admin (visualizar status de trial dos motoristas, estender trial manualmente,
identificar quem está prestes a expirar).

Apenas usuários do tipo `motorista` possuem trial e estão sujeitos a bloqueio. Embarcadores e
administradores nunca têm contador nem bloqueio.

**IMPORTANTE — Não escopo desta spec:** Esta feature implementa SOMENTE o trial, o bloqueio e o
anti-fraude no cadastro. A cobrança real é tratada em specs futuras. Estão explicitamente FORA
desta spec:

- Integração com gateway de pagamento Asaas, checkout, webhook e cobrança recorrente real
  (spec futura: `assinatura-asaas`).
- Planos pagos funcionais e fluxo de cancelamento de assinatura (spec futura: `assinatura-asaas`).
- Dashboard financeiro de receita, MRR e inadimplência (spec futura: `admin-financeiro-assinaturas`).
- Os campos de banco específicos do Asaas/plano (id de assinatura, id de cliente, plano escolhido)
  NÃO são criados nesta spec.

Nesta spec, o botão "Assinar" da tela de bloqueio leva à página de planos existente
(`/motorista/plano`), que permanece como placeholder ("Em Breve"). Os preços são exibidos apenas
como informação na tela de bloqueio/planos; nenhuma cobrança é realizada.

## Glossary

- **Trial_System**: Conjunto lógico responsável por calcular o estado de trial de um motorista
  (dias restantes, expirado, assinante) com base nos campos da tabela `users`.
- **Trial**: Período de teste gratuito de 30 dias corridos concedido a cada motorista, contado a
  partir de `users.created_at`.
- **Motorista**: Usuário com `users.user_type = 'motorista'`.
- **Embarcador**: Usuário com `users.user_type = 'embarcador'`.
- **Admin**: Usuário com `users.user_type = 'admin'`, incluindo o Master Admin imutável
  (`users.admin_username = 'Nexus_Vortex99'`).
- **trial_ends_at**: Coluna `timestamptz` em `users` que marca o instante de expiração do trial.
  Default `users.created_at + INTERVAL '30 days'`.
- **subscription_status**: Coluna `text` em `users` com domínio fechado
  (`'trial'`, `'active'`, `'past_due'`, `'canceled'`, `'blocked'`). Default `'trial'`.
- **is_subscribed**: Coluna `boolean` em `users`, default `false`. Indica assinatura paga ativa.
  Nesta spec permanece `false` para todos (sem cobrança real).
- **days_left**: Número inteiro de dias restantes do trial, calculado como
  `max(0, ceil((trial_ends_at - now) / 1 dia))`.
- **TrialBadge**: Componente visual exibido no header (`AppHeader`) que mostra os dias restantes
  do trial para um motorista não-assinante em trial.
- **TrialExpiredPage**: Página/tela de bloqueio exibida quando o trial de um motorista expirou e
  o motorista não é assinante.
- **useTrialStatus**: Hook React que retorna o estado de trial do usuário atual:
  `{ daysLeft, isExpired, isSubscribed, status }`.
- **ProtectedRoute**: Componente existente de roteamento que protege rotas autenticadas; será
  estendido para checar bloqueio de trial em rotas de motorista.
- **Anti_Fraud_Validator**: Lógica de validação executada antes da criação da conta que rejeita
  cadastros cujo CPF, telefone ou e-mail já estejam em uso por outra conta.
- **Admin_Trial_Panel**: Conjunto de funcionalidades do painel admin para visualizar e gerenciar
  o status de trial dos motoristas.
- **executeAdminMutation**: Wrapper existente de audit-by-construction para mutações admin.
- **is_admin_with_permission**: Função SQL existente de RBAC server-side do painel admin.

## Requirements

### Requirement 1: Concessão do Trial no Cadastro de Motorista

**User Story:** Como motorista recém-cadastrado, quero receber automaticamente 30 dias de teste
gratuito, para que eu possa experimentar a plataforma antes de assinar.

#### Acceptance Criteria

1. WHEN um Motorista é criado na tabela `users`, THE Trial_System SHALL definir
   `trial_ends_at` como `created_at + INTERVAL '30 days'`.
2. WHEN um Motorista é criado na tabela `users`, THE Trial_System SHALL definir
   `subscription_status` como `'trial'`.
3. WHEN um Motorista é criado na tabela `users`, THE Trial_System SHALL definir
   `is_subscribed` como `false`.
4. WHERE o usuário criado é Embarcador ou Admin, THE Trial_System SHALL deixar `trial_ends_at`
   sem efeito sobre acesso, sem aplicar contador nem bloqueio em nenhuma circunstância.

### Requirement 2: Cálculo de Dias Restantes do Trial

**User Story:** Como motorista em teste, quero saber exatamente quantos dias me restam, para que
eu possa decidir quando assinar.

#### Acceptance Criteria

1. THE Trial_System SHALL calcular `days_left` como `max(0, ceil((trial_ends_at - now) / 86400000 ms))`.
2. WHILE `trial_ends_at` é maior que `now`, THE Trial_System SHALL retornar `days_left` maior ou
   igual a 1.
3. IF `trial_ends_at` é menor ou igual a `now`, THEN THE Trial_System SHALL retornar `days_left`
   igual a 0.
4. THE Trial_System SHALL retornar `isExpired` como verdadeiro somente quando `trial_ends_at` é
   menor ou igual a `now` E `is_subscribed` é `false`.

### Requirement 3: Hook de Estado de Trial (useTrialStatus)

**User Story:** Como desenvolvedor do front-end, quero um hook único que exponha o estado de
trial do usuário atual, para que eu possa reutilizar a mesma lógica no header, nas rotas e nas
telas.

#### Acceptance Criteria

1. THE useTrialStatus SHALL retornar um objeto contendo `daysLeft` (número), `isExpired`
   (booleano), `isSubscribed` (booleano) e `status` (valor de `subscription_status`).
2. WHERE o usuário atual é Motorista, THE useTrialStatus SHALL calcular `daysLeft` conforme o
   Requirement 2 e SHALL retornar `isExpired` como `true` quando `trial_ends_at` é menor ou igual
   a `now` E `is_subscribed` é `false`, conforme o Requirement 2.4.
3. WHERE o usuário atual é Embarcador ou Admin, THE useTrialStatus SHALL retornar `isExpired`
   como `false` e `daysLeft` como `0`, sem aplicar o cálculo do Requirement 2.
4. WHERE existem dados de usuário em cache local (`fretego_user`), THE useTrialStatus SHALL
   derivar o tipo de usuário a partir desses dados em cache para calcular o estado de trial.
5. IF não existe usuário autenticado E não existem dados de usuário em cache local, THEN THE
   useTrialStatus SHALL retornar `isExpired` como `false` e `daysLeft` como `0`.

### Requirement 4: Contador Visual no Header (TrialBadge)

**User Story:** Como motorista em teste, quero ver um contador discreto no header com os dias
restantes, para que eu acompanhe meu período gratuito sem atrapalhar o uso.

#### Acceptance Criteria

1. WHERE o usuário atual é Motorista com `is_subscribed` igual a `false` E `days_left` maior que
   0, THE TrialBadge SHALL exibir o texto "Teste grátis: {days_left} dias".
2. WHERE o usuário atual é Embarcador ou Admin, THE TrialBadge SHALL permanecer oculto.
3. WHERE o usuário atual é Motorista com `is_subscribed` igual a `true`, THE TrialBadge SHALL
   permanecer oculto.
4. WHILE `days_left` é maior que 10, THE TrialBadge SHALL exibir o contador em verde.
5. WHILE `days_left` está entre 5 e 10 inclusive, THE TrialBadge SHALL exibir o contador em
   amarelo.
6. WHILE `days_left` é menor que 5 E maior que 1, THE TrialBadge SHALL exibir o contador em
   vermelho.
7. WHILE `days_left` é igual a 1, THE TrialBadge SHALL exibir o contador em vermelho com efeito
   de destaque pulsante.
8. WHERE `days_left` é igual a 0, THE TrialBadge SHALL permanecer oculto, sendo o estado tratado
   pela tela de bloqueio (Requirement 5).
9. THE TrialBadge SHALL ser responsivo e legível em telas menores que 768px.

### Requirement 5: Bloqueio de Acesso do Motorista com Trial Expirado

**User Story:** Como plataforma, quero bloquear motoristas cujo trial expirou e que não
assinaram, para que o acesso às funcionalidades dependa de uma assinatura.

#### Acceptance Criteria

1. WHILE um Motorista tem `trial_ends_at` menor ou igual a `now` E `is_subscribed` igual a
   `false`, THE Trial_System SHALL classificar o Motorista como bloqueado.
2. WHEN um Motorista bloqueado acessa uma rota protegida de motorista, THE ProtectedRoute SHALL
   exibir a TrialExpiredPage em vez do conteúdo da rota.
3. THE TrialExpiredPage SHALL exibir a mensagem "Seu teste expirou. Assine para continuar.".
4. THE TrialExpiredPage SHALL exibir um botão "Assinar" que navega para `/motorista/plano`.
5. THE TrialExpiredPage SHALL exibir os valores informativos dos planos: Mensal R$ 39,00 por mês;
   Trimestral R$ 87,00 (R$ 29,00 por mês, pago de uma vez); Semestral R$ 150,00 (R$ 25,00 por
   mês, pago de uma vez).
6. WHEN um Motorista bloqueado tenta visualizar fretes disponíveis, THE Trial_System SHALL
   impedir a visualização e apresentar a TrialExpiredPage.
7. WHEN um Motorista bloqueado tenta abrir ou enviar mensagem no chat, THE Trial_System SHALL
   impedir a ação e apresentar a TrialExpiredPage.
8. WHEN um Motorista bloqueado tenta aceitar um novo frete, THE Trial_System SHALL impedir o
   aceite e apresentar a TrialExpiredPage.
9. THE TrialExpiredPage SHALL ser responsiva em telas menores que 768px.

### Requirement 6: Continuidade de Fretes em Andamento

**User Story:** Como motorista que já aceitou um frete antes de expirar, quero poder concluir
esse frete mesmo após o bloqueio, para que eu não deixe uma entrega pela metade.

#### Acceptance Criteria

1. WHERE um Motorista bloqueado possui um frete já aceito antes da expiração do trial, THE
   Trial_System SHALL permitir as ações necessárias para concluir esse frete.
2. WHERE um Motorista bloqueado possui um frete em andamento, THE Trial_System SHALL permitir o
   acesso ao chat vinculado a esse frete específico.
3. WHEN um Motorista bloqueado tenta aceitar um frete adicional, THE Trial_System SHALL impedir o
   novo aceite mesmo que existam fretes em andamento.

### Requirement 7: Isenção de Embarcadores e Administradores

**User Story:** Como embarcador ou administrador, quero usar a plataforma sem contador nem
bloqueio de trial, para que meu acesso nunca seja interrompido por esse mecanismo.

#### Acceptance Criteria

1. WHERE o usuário atual é Embarcador, THE Trial_System SHALL conceder acesso livre sem aplicar
   bloqueio de trial.
2. WHERE o usuário atual é Admin, THE Trial_System SHALL conceder acesso livre sem aplicar
   bloqueio de trial.
3. WHEN um Admin acessa o painel administrativo, THE Trial_System SHALL permitir o acesso
   independentemente de qualquer valor de `trial_ends_at` ou `subscription_status`.
4. WHERE o usuário atual é Embarcador ou Admin, THE TrialBadge SHALL permanecer oculto conforme
   o Requirement 4.

### Requirement 8: Anti-Fraude no Cadastro

**User Story:** Como plataforma, quero impedir que uma pessoa crie várias contas para ganhar
trial repetidamente, para que o período gratuito não seja explorado de forma abusiva.

#### Acceptance Criteria

1. WHEN um novo cadastro é submetido, THE Anti_Fraud_Validator SHALL verificar a existência de
   CPF, telefone e e-mail antes de criar a conta.
2. IF o CPF informado já está cadastrado em outra conta, THEN THE Anti_Fraud_Validator SHALL
   rejeitar o cadastro com a mensagem "Este CPF/telefone/e-mail já está cadastrado.".
3. IF o telefone informado já está cadastrado em outra conta, THEN THE Anti_Fraud_Validator SHALL
   rejeitar o cadastro com a mensagem "Este CPF/telefone/e-mail já está cadastrado.".
4. IF o e-mail informado já está cadastrado em outra conta, THEN THE Anti_Fraud_Validator SHALL
   rejeitar o cadastro com a mensagem "Este CPF/telefone/e-mail já está cadastrado.".
5. WHEN há duplicidade de CPF, telefone ou e-mail em uma submissão de cadastro, THE
   Anti_Fraud_Validator SHALL sempre impedir a criação de qualquer registro em `users` para essa
   submissão, independentemente do resultado de qualquer checagem de disponibilidade isolada.
6. WHERE o CPF, o telefone e o e-mail informados não constam em nenhuma conta existente, THE
   Anti_Fraud_Validator SHALL permitir o prosseguimento do cadastro.
7. WHEN uma checagem de disponibilidade isolada de CPF, telefone ou e-mail é consultada, THE
   Anti_Fraud_Validator SHALL retornar um resultado booleano de disponibilidade sem criar conta,
   sendo esse resultado distinto e independente do efeito de bloqueio de criação definido nos
   critérios 8.2 a 8.5.

### Requirement 9: Reforço de Bloqueio no Servidor (Defense-in-Depth)

**User Story:** Como plataforma, quero que o bloqueio de trial seja reforçado no servidor além do
cliente, para que motoristas bloqueados não acessem dados protegidos manipulando o front-end.

#### Acceptance Criteria

1. WHEN uma requisição de motorista bloqueado tenta ler fretes disponíveis no servidor, THE
   Trial_System SHALL negar o acesso aos dados protegidos.
2. WHEN uma requisição de motorista bloqueado tenta criar um novo aceite de frete no servidor,
   THE Trial_System SHALL rejeitar a operação.
3. WHERE o usuário da requisição é Embarcador ou Admin, THE Trial_System SHALL não aplicar
   nenhuma restrição de trial no servidor.
4. WHERE existe um frete já aceito antes da expiração do trial, THE Trial_System SHALL permitir no
   servidor as operações de leitura e atualização vinculadas a esse frete específico
   independentemente do papel do usuário da requisição.

### Requirement 10: Visualização de Status de Trial no Painel Admin

**User Story:** Como administrador, quero ver o status de trial de cada motorista, para que eu
acompanhe quem está em teste, quem expirou e quem está prestes a expirar.

#### Acceptance Criteria

1. WHEN um Admin com permissão acessa a listagem de motoristas, THE Admin_Trial_Panel SHALL
   exibir para cada Motorista o status de trial (em trial, expirado) e os dias restantes.
2. THE Admin_Trial_Panel SHALL permitir filtrar motoristas por status de trial.
3. WHEN um Admin solicita a lista de motoristas prestes a expirar, THE Admin_Trial_Panel SHALL
   listar os motoristas cujo `days_left` é menor ou igual a 5 e maior que 0.
4. IF um Admin sem a permissão necessária tenta acessar o Admin_Trial_Panel, THEN THE
   Admin_Trial_Panel SHALL retornar a resposta de Stealth_404.
5. WHERE o Admin_Trial_Panel exibe dados de trial, THE Admin_Trial_Panel SHALL respeitar o estilo
   de UI compacto do painel admin (paginação 10/50/100, filtros em popover).
6. IF a conformidade com o estilo de UI compacto não pode ser mantida, THEN THE Admin_Trial_Panel
   SHALL ainda assim exibir os dados de trial, priorizando a exibição do dado sobre a conformidade
   de estilo.

### Requirement 11: Extensão Manual de Trial pelo Admin

**User Story:** Como administrador, quero estender manualmente o trial de um motorista
específico, para que eu possa conceder mais tempo em casos justificados.

#### Acceptance Criteria

1. WHEN um Admin com permissão define um novo `trial_ends_at` para um Motorista, THE
   Admin_Trial_Panel SHALL atualizar `trial_ends_at` desse Motorista através de
   `executeAdminMutation` com registro em audit log.
2. THE Admin_Trial_Panel SHALL aplicar versionamento otimista usando `updated_at` na atualização
   de `trial_ends_at`.
3. IF o valor de `updated_at` enviado não corresponde ao valor atual do registro, THEN THE
   Admin_Trial_Panel SHALL rejeitar a atualização com o erro `STALE_VERSION`.
4. WHEN um Admin estende o trial de um Motorista bloqueado para uma data futura, THE Trial_System
   SHALL classificar o Motorista como não bloqueado a partir da próxima avaliação de estado.
5. IF um Admin tenta estender o trial do Master Admin imutável, THEN THE Admin_Trial_Panel SHALL
   abortar a operação antes de qualquer alteração.
6. THE rpc server-side de extensão de trial SHALL validar a permissão via
   `is_admin_with_permission` e registrar audit log negativo quando a permissão falhar.
