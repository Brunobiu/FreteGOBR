# Requirements Document

> Feature 2 — Aceite Obrigatório dos Termos (FreteGO)

## Introduction

Esta feature adiciona ao cadastro de motorista e embarcador um **checkbox obrigatório** de aceite dos Termos de Uso e da Política de Privacidade (criados na Feature 1). Sem marcar o checkbox, o cadastro não avança. O sistema persiste a **data/hora exata do aceite** e a **versão dos documentos** aceita, criando uma trilha de conformidade LGPD que comprova consentimento informado.

Depende da Feature 1 (`currentLegalVersion()` e rotas `/termos`, `/privacidade`). O cadastro hoje é feito via `RegisterForm` (React Hook Form + Zod) chamando um fluxo de signup que persiste em `public.users` (+ `motoristas`/`embarcadores`).

Convenções: UI em pt-BR; colunas SQL e identifiers em inglês (`terms_accepted_at`, `terms_version`). Mensagens de erro user-facing em pt-BR.

## Glossary

- **Accept_Checkbox**: Checkbox obrigatório no formulário de cadastro com o texto de aceite e links para Termos e Privacidade.
- **Accept_Text**: O rótulo "Li e aceito os Termos de Uso e a Política de Privacidade", com Termos e Privacidade como links.
- **Terms_Acceptance_Record**: Conjunto de campos persistidos que comprovam o aceite: timestamp e versão.
- **Accepted_At**: Timestamp (UTC) exato em que o usuário marcou o aceite e concluiu o cadastro.
- **Accepted_Version**: A Legal_Version vigente no momento do aceite (de `currentLegalVersion()` da Feature 1).
- **Register_Flow**: O fluxo de cadastro existente (`RegisterForm` → signup → persistência em `users`).
- **Signup_Mutation**: A operação que cria a conta e grava o Terms_Acceptance_Record.

## Requirements

### Requirement 1: Checkbox de aceite obrigatório no cadastro

**User Story:** Como visitante me cadastrando, quero declarar que li e aceito os termos, para concluir meu cadastro de forma consciente.

#### Acceptance Criteria

1. THE Accept_Checkbox SHALL ser exibido no formulário de cadastro tanto para motorista quanto para embarcador.
2. THE Accept_Checkbox SHALL exibir o Accept_Text com a palavra "Termos de Uso" como link para `/termos` e "Política de Privacidade" como link para `/privacidade`.
3. WHEN um link dentro do Accept_Text for clicado, THE sistema SHALL abrir a Legal_Page correspondente sem perder os dados já preenchidos no formulário.
4. WHILE o Accept_Checkbox estiver desmarcado, THE Register_Flow SHALL manter o botão de concluir cadastro bloqueado ou impedir o avanço da submissão.
5. WHEN o usuário tentar submeter o cadastro com o Accept_Checkbox desmarcado, THE Register_Flow SHALL exibir a mensagem de erro em pt-BR `Você precisa aceitar os Termos de Uso e a Política de Privacidade.` e NÃO SHALL criar a conta.
6. THE Accept_Checkbox SHALL iniciar desmarcado por padrão (sem pré-seleção).

### Requirement 2: Persistência do registro de aceite

**User Story:** Como responsável pela conformidade, quero registrar quando e qual versão dos termos foi aceita, para comprovar consentimento conforme a LGPD.

#### Acceptance Criteria

1. WHEN o cadastro for concluído com sucesso, THE Signup_Mutation SHALL persistir o Accepted_At com o timestamp UTC do aceite.
2. WHEN o cadastro for concluído com sucesso, THE Signup_Mutation SHALL persistir o Accepted_Version igual ao valor retornado por `currentLegalVersion()` no momento do aceite.
3. THE Terms_Acceptance_Record SHALL ser gravado na mesma transação/fluxo que cria o usuário, de modo que nenhuma conta exista sem registro de aceite.
4. IF a gravação do Terms_Acceptance_Record falhar, THEN THE Signup_Mutation SHALL falhar o cadastro e NÃO SHALL deixar a conta criada sem aceite.
5. THE Accepted_At SHALL ser definido pelo servidor (fonte de tempo confiável), não pelo relógio do cliente.
6. THE Terms_Acceptance_Record SHALL ser imutável após criado pelo fluxo de cadastro (não editável pelo próprio usuário).

### Requirement 3: Esquema de dados do aceite

**User Story:** Como desenvolvedor, quero colunas claras para o aceite, para consultar e auditar consentimentos.

#### Acceptance Criteria

1. THE banco SHALL conter uma coluna `terms_accepted_at` (timestamptz, nullable para contas legadas) associada ao usuário.
2. THE banco SHALL conter uma coluna `terms_version` (text, nullable para contas legadas) associada ao usuário.
3. WHERE uma conta tiver sido criada antes desta feature, THE sistema SHALL permitir `terms_accepted_at` e `terms_version` nulos sem quebrar o login.
4. THE migration SHALL ser idempotente e acompanhada de um par de rollback documentado, conforme convenções do projeto.

### Requirement 4: Validação consistente cliente e servidor

**User Story:** Como engenheiro, quero que o aceite seja validado nos dois lados, para que ninguém burle o checkbox no cliente.

#### Acceptance Criteria

1. THE Register_Flow SHALL validar no cliente que o Accept_Checkbox está marcado antes de submeter.
2. THE Signup_Mutation SHALL revalidar no servidor que um Accepted_Version não-vazio foi fornecido antes de criar a conta.
3. IF a Signup_Mutation receber um aceite ausente ou vazio, THEN THE Signup_Mutation SHALL rejeitar a criação com um error code específico e NÃO SHALL criar a conta.
4. FOR ALL submissões de cadastro, THE Register_Flow SHALL impedir a criação de conta sem o par (Accepted_At, Accepted_Version) preenchido.
