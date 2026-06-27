# Documento de Requisitos — Login sem Senha (código por WhatsApp ou E-mail)

## Introdução

Esta spec adiciona uma opção de **login sem senha** ("Entrar sem senha") na tela de login.
A pessoa informa **WhatsApp ou e-mail**, recebe um **código de 6 dígitos** pelo canal que
digitou e entra **sem precisar da senha**. É o mecanismo principal de recuperação de acesso
do motorista (público leigo): esqueceu a senha → entra por código.

O login por senha atual **permanece** funcionando; o login sem senha é uma opção adicional.
Esta spec **reutiliza** o canal de OTP (WhatsApp Cloud API + fallback de e-mail) entregue
pela spec `auth-otp-whatsapp` — portanto **depende dela**.

### Fora de escopo

- Cadastro/verificação de cadastro (spec `auth-otp-whatsapp`).
- Biometria no app (spec `biometria-app`).
- Remoção do login por senha (ele continua).

## Glossário

- **Sistema_FreteGO**: aplicação React + TypeScript + Vite + Supabase.
- **Tela_Login**: `LoginPage.tsx` / `LoginForm.tsx`.
- **Login_Sem_Senha**: fluxo de autenticação por código, sem senha.
- **Identificador**: valor digitado pela pessoa — e-mail **ou** telefone (WhatsApp).
- **Canal_OTP**: WhatsApp (quando o `Identificador` é telefone) ou e-mail (quando é e-mail), com o fallback definido na spec `auth-otp-whatsapp`.
- **Codigo_Login**: código numérico de 6 dígitos para o `Login_Sem_Senha`.
- **Tabela_Login_OTP**: nova tabela `login_otp_codes` (códigos de login, separada da de cadastro).
- **Edge_Sessao**: nova Edge Function `login-otp-verify` que valida o `Codigo_Login` e emite a sessão.
- **Sessao_Supabase**: par access/refresh token do Supabase Auth que autentica o usuário.
- **Token_Hash_Magico**: `hashed_token` retornado por `auth.admin.generateLink({type:'magiclink'})`, trocado por sessão via `verifyOtp`.
- **Mensagem_Canonica_Login**: mensagem fixa pt-BR `Se houver uma conta, enviamos um código.` (anti-enumeração).

## Requisitos

### Requisito 1: Ponto de Entrada na Tela de Login

**User Story:** Como pessoa que esqueceu a senha, eu quero uma opção "Entrar sem senha" na
tela de login, para entrar com um código em vez da senha.

#### Critérios de Aceitação

1. THE Tela_Login SHALL exibir a ação "Entrar sem senha" ao lado (à esquerda) do botão "Entrar".
2. THE opção SHALL estar disponível tanto para o perfil motorista quanto embarcador.
3. WHEN a pessoa aciona "Entrar sem senha", THE Sistema_FreteGO SHALL exibir um campo único para `Identificador` (e-mail ou WhatsApp) e um botão "Entrar".
4. THE Tela_Login SHALL permitir voltar do modo sem senha para o login por senha sem recarregar a página.
5. THE login por senha SHALL continuar funcionando como antes (esta opção é adicional).

### Requisito 2: Detecção de Canal pelo Identificador

**User Story:** Como pessoa entrando sem senha, eu quero que o sistema reconheça
automaticamente se digitei e-mail ou telefone, para receber o código no canal certo.

#### Critérios de Aceitação

1. WHEN o `Identificador` contém `@`, THE Sistema_FreteGO SHALL tratá-lo como e-mail e usar o `Canal_OTP` e-mail.
2. WHEN o `Identificador` é composto só por dígitos/máscara de telefone, THE Sistema_FreteGO SHALL tratá-lo como telefone e usar o `Canal_OTP` WhatsApp (com fallback de e-mail da conta, quando houver).
3. IF o `Identificador` não é um e-mail válido nem um telefone válido, THEN THE Sistema_FreteGO SHALL exibir "Informe um e-mail ou WhatsApp válido" e não enviar código.
4. THE Sistema_FreteGO SHALL reutilizar a normalização E.164 (`phoneE164`) e a validação de e-mail já existentes.

### Requisito 3: Envio do Código de Login (RPC request_login_otp)

**User Story:** Como Sistema_FreteGO, eu quero gerar e enviar o `Codigo_Login` somente para
contas existentes, sem revelar se a conta existe.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL expor `request_login_otp(p_identifier text)` como `SECURITY DEFINER`.
2. WHEN chamada, THE Sistema_FreteGO SHALL resolver o `Identificador` para um usuário (e-mail direto, ou telefone via `resolve_login_email`).
3. IF a conta existe, THEN THE Sistema_FreteGO SHALL gerar `Codigo_Login` (6 dígitos), gravar hash em `Tabela_Login_OTP` (`expires_at = now() + 10 min`, `attempts = 0`), invalidar pendentes do mesmo usuário e disparar o envio pelo `Canal_OTP` correspondente.
4. IF a conta NÃO existe, THEN THE Sistema_FreteGO SHALL retornar sucesso **sem** enviar código (anti-enumeração).
5. THE Sistema_FreteGO SHALL aplicar rate limit de no máximo 5 códigos por usuário/identificador em 1 hora.
6. THE Sistema_FreteGO SHALL retornar sempre uma resposta neutra compatível com a `Mensagem_Canonica_Login`.
7. THE RPC SHALL ter `GRANT EXECUTE TO anon, authenticated` e `REVOKE ALL FROM PUBLIC`.

### Requisito 4: Verificação do Código e Emissão de Sessão (Edge_Sessao)

**User Story:** Como pessoa entrando sem senha, eu quero digitar o código e ser autenticada,
para acessar o sistema sem senha.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL expor a Edge_Sessao `login-otp-verify` (anon, `verify_jwt = false`) que recebe `{ identifier, code }`.
2. WHEN chamada, THE Edge_Sessao SHALL validar o `Codigo_Login` no servidor via RPC `verify_login_otp(p_identifier, p_code)` (`SECURITY DEFINER`), que trata EXPIRED/BLOCKED/INVALID/OK por hash.
3. WHEN o código é válido, THE Edge_Sessao SHALL obter o e-mail da identidade do usuário e gerar o `Token_Hash_Magico` via `auth.admin.generateLink({ type: 'magiclink', email })`.
4. THE Edge_Sessao SHALL retornar `{ ok: true, token_hash }` ao cliente, **sem** retornar segredos.
5. WHEN o cliente recebe `token_hash`, THE Sistema_FreteGO SHALL chamar `supabase.auth.verifyOtp({ token_hash, type: 'email' })` para estabelecer a `Sessao_Supabase`.
6. WHEN a sessão é estabelecida, THE Sistema_FreteGO SHALL redirecionar conforme o tipo de usuário (embarcador → `/embarcador`; motorista → `/`).
7. IF o código é inválido/expirado/bloqueado, THEN THE Edge_Sessao SHALL retornar erro neutro sem revelar detalhes da conta.
8. THE `Codigo_Login` SHALL ser de uso único: ao emitir a sessão, o registro é marcado consumido.

### Requisito 5: Segurança do Login sem Senha

**User Story:** Como Sistema_FreteGO, eu quero que o login por código seja seguro, para não
abrir brecha de sequestro de conta.

#### Critérios de Aceitação

1. THE Tabela_Login_OTP SHALL ter RLS deny-all, acessível apenas via RPCs `SECURITY DEFINER`.
2. THE Sistema_FreteGO SHALL armazenar apenas o hash do `Codigo_Login`, nunca o código em claro.
3. THE Sistema_FreteGO SHALL bloquear (`BLOCKED`) após 5 tentativas inválidas e invalidar o código.
4. THE Sistema_FreteGO SHALL expirar o `Codigo_Login` em 10 minutos.
5. THE emissão de sessão (`generateLink`) SHALL ocorrer **somente** na Edge_Sessao com service role; o cliente nunca recebe service role nem gera link.
6. THE Sistema_FreteGO SHALL aplicar checagem de blacklist (telefone/e-mail) no mesmo padrão do login por senha.
7. THE Sistema_FreteGO SHALL responder com a `Mensagem_Canonica_Login` para identificador inexistente, mantendo paridade de tempo de resposta (anti-enumeração + anti-timing).
8. WHERE a conta está inativa/banida, THE Sistema_FreteGO SHALL recusar a emissão de sessão com a mesma mensagem do login por senha.

### Requisito 6: UX da Etapa de Código

**User Story:** Como pessoa entrando sem senha, eu quero uma experiência clara de digitação
do código, com reenvio, para concluir mesmo se o primeiro código falhar.

#### Critérios de Aceitação

1. WHEN o código é solicitado, THE Tela_Login SHALL exibir o campo de 6 dígitos (mesmo componente `OtpInput` do cadastro) e indicar para onde o código foi enviado (mascarado).
2. THE Tela_Login SHALL oferecer "Reenviar código" com cooldown de 60 segundos.
3. WHILE o telefone foi usado, THE Tela_Login SHALL oferecer a ação "Não recebi — enviar por e-mail" quando a conta tiver e-mail (reuso do fallback da spec `auth-otp-whatsapp`).
4. IF o código é inválido, THEN THE Tela_Login SHALL exibir "Código incorreto. Tente novamente." e permitir nova tentativa até o bloqueio.
5. IF o código expira, THEN THE Tela_Login SHALL exibir "Código expirado. Solicite um novo código.".

### Requisito 7: Schema de Banco (Migration 126)

**User Story:** Como Sistema_FreteGO, eu quero persistir os códigos de login com segurança,
isolados dos códigos de cadastro.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL criar `login_otp_codes` com: `id uuid PK`, `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `channel text CHECK (channel IN ('whatsapp','email'))`, `code_hash text NOT NULL`, `expires_at timestamptz NOT NULL`, `attempts int NOT NULL DEFAULT 0`, `consumed boolean NOT NULL DEFAULT false`, `created_at timestamptz NOT NULL DEFAULT now()`.
2. THE Sistema_FreteGO SHALL criar índice por `(user_id, consumed, created_at DESC)`.
3. THE Sistema_FreteGO SHALL habilitar RLS deny-all em `login_otp_codes`.
4. THE Sistema_FreteGO SHALL entregar `supabase/migrations/126_login_otp.sql` idempotente com par `_rollback.sql`.
5. THE Sistema_FreteGO SHALL conceder `EXECUTE` das RPCs `request_login_otp` e `verify_login_otp` a `anon, authenticated` e `REVOKE ALL FROM PUBLIC`.

### Requisito 8: Observabilidade e Auditoria

**User Story:** Como operador, eu quero auditar tentativas de login sem senha, sem expor
segredos.

#### Critérios de Aceitação

1. WHEN um `Codigo_Login` é solicitado para conta existente, THE Sistema_FreteGO SHALL registrar o evento com identificador mascarado e canal.
2. WHEN uma sessão é emitida via `Login_Sem_Senha`, THE Sistema_FreteGO SHALL registrar o sucesso (sem código/token).
3. THE Sistema_FreteGO SHALL nunca registrar o código, o `Token_Hash_Magico` ou segredos.
