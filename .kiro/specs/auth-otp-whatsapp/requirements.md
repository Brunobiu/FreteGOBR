# Documento de Requisitos — Verificação de Cadastro por WhatsApp (Cloud API) com Fallback de E-mail

## Introdução

Esta spec substitui o canal de verificação do cadastro: hoje o código de 6 dígitos
é enviado **por e-mail** (migration 066 + Edge `send-verification-email` via Resend);
passa a ser enviado **por WhatsApp** usando a **WhatsApp Cloud API oficial da Meta**
(template de autenticação), com **fallback automático para e-mail** quando o envio por
WhatsApp falha. O fluxo de cadastro multi-step (dados → código → senha) permanece, muda
apenas o canal de entrega do código e o que é verificado (a posse do **telefone**).

Aplica-se aos dois perfis: **motorista** e **embarcador**. No cadastro do embarcador,
o campo **nome da empresa** sai do formulário e passa a ser preenchido no perfil; a
regra de "cadastro completo para postar frete" (embarcador-onboarding) é ajustada para
considerar o contato verificado por WhatsApp **ou** e-mail.

O canal WhatsApp+OTP é projetado para ser **reutilizável** por outras features (ex.: a
spec `login-sem-senha`), mas esta spec entrega apenas o uso de **verificação de cadastro**.

### Fora de escopo

- Login sem senha / OTP de login (spec separada `login-sem-senha`).
- Biometria no app (spec separada `biometria-app`).
- Envio de WhatsApp transacional para outros eventos (notificações, recibos).
- Migração da automação de marketing (Evolution API) — permanece como está.
- Verificação de CNPJ/documentos do embarcador.

## Glossário

- **Sistema_FreteGO**: aplicação React + TypeScript + Vite + Supabase + Tailwind.
- **Motorista**: usuário `users.user_type = 'motorista'` (também em `motoristas`).
- **Embarcador**: usuário `users.user_type = 'embarcador'` (também em `embarcadores`).
- **Cadastro_MultiStep**: fluxo do `RegisterForm.tsx` em 3 etapas (dados → código → senha).
- **Codigo_OTP**: sequência numérica de 6 dígitos `[0-9]` gerada para verificar a posse do contato.
- **Canal_WhatsApp**: envio do `Codigo_OTP` via WhatsApp Cloud API oficial (template de autenticação).
- **Canal_Email**: envio do `Codigo_OTP` via Edge `send-verification-email` (Resend), já existente.
- **Canal_Efetivo**: canal pelo qual o `Codigo_OTP` foi efetivamente despachado (`whatsapp` ou `email`).
- **Fallback_Email**: tentativa automática pelo `Canal_Email` quando o `Canal_WhatsApp` falha no envio.
- **Tabela_OTP**: nova tabela `signup_otp_verifications` que guarda código (hash), canal, alvo, expiração, tentativas e token.
- **Token_Verificacao**: UUID emitido na confirmação do `Codigo_OTP`, de uso único, consumido no cadastro.
- **Telefone_E164**: telefone normalizado no formato internacional do WhatsApp (ex.: `5511987654321`).
- **Cloud_API**: WhatsApp Business Cloud API da Meta (`graph.facebook.com/.../messages`).
- **Edge_Envio**: nova Edge Function `send-signup-otp` que tenta `Canal_WhatsApp` e, em falha, `Canal_Email`.
- **Phone_Verificado**: estado `users.phone_verified = true` (coluna nova), marcado quando o contato verificado foi o telefone.
- **Email_Verificado**: estado `users.email_verified = true` (coluna existente), marcado quando o contato verificado foi o e-mail.
- **Contato_Verificado**: `Phone_Verificado` OR `Email_Verificado`.
- **Mensagem_Canonica**: mensagem user-facing fixa em pt-BR `Não foi possível enviar o código.` (anti-enumeração/erro genérico).

## Requisitos

### Requisito 1: Envio do código por WhatsApp (Cloud API)

**User Story:** Como pessoa criando conta, eu quero receber o código de verificação no
meu WhatsApp, para concluir o cadastro pelo canal que mais uso.

#### Critérios de Aceitação

1. WHEN o `Codigo_OTP` precisa ser despachado, THE Edge_Envio SHALL enviar uma mensagem de template de autenticação via Cloud_API para o `Telefone_E164` do usuário.
2. THE Edge_Envio SHALL ler as credenciais da Cloud_API (token, phone_number_id, nome e idioma do template) **exclusivamente** do Vault/segredos do servidor, nunca do cliente.
3. THE Edge_Envio SHALL incluir o `Codigo_OTP` como parâmetro do corpo do template e, quando o template tiver botão de copiar código, no componente de botão correspondente.
4. WHEN a Cloud_API responde com sucesso (HTTP 2xx), THE Edge_Envio SHALL registrar `Canal_Efetivo = 'whatsapp'` para a `Tabela_OTP` correspondente.
5. IF as credenciais da Cloud_API não estão configuradas, THEN THE Edge_Envio SHALL pular o `Canal_WhatsApp` e usar diretamente o `Canal_Email` (degradação controlada).
6. THE Edge_Envio SHALL tratar qualquer corpo de resposta da Cloud_API como dado não confiável e NÃO ecoar segredos em logs ou respostas.

### Requisito 2: Fallback automático para e-mail

**User Story:** Como pessoa criando conta, eu quero receber o código por e-mail caso o
WhatsApp falhe, para não ficar travada no cadastro.

#### Critérios de Aceitação

1. WHEN o envio pelo `Canal_WhatsApp` falha (erro de rede, HTTP não-2xx, timeout ou credenciais ausentes), THE Edge_Envio SHALL tentar o `Canal_Email` com o mesmo `Codigo_OTP`.
2. WHEN o `Fallback_Email` é acionado e o envio por e-mail tem sucesso, THE Edge_Envio SHALL registrar `Canal_Efetivo = 'email'`.
3. IF tanto `Canal_WhatsApp` quanto `Canal_Email` falham, THEN THE Edge_Envio SHALL registrar a falha sem expor segredos e o cadastro SHALL permanecer na etapa de código (o usuário pode reenviar).
4. THE Edge_Envio SHALL garantir que o `Codigo_OTP` enviado por WhatsApp e o enviado no `Fallback_Email` sejam **o mesmo código** (não gera código novo no fallback).
5. THE Edge_Envio SHALL exigir um e-mail válido para o `Fallback_Email`; sem e-mail válido, somente o `Canal_WhatsApp` é tentado.

### Requisito 3: Fallback manual ("Não recebi — enviar por e-mail")

**User Story:** Como pessoa criando conta, eu quero um botão para receber o código por
e-mail se o WhatsApp não chegar, porque a entrega do WhatsApp pode demorar.

#### Critérios de Aceitação

1. WHILE a etapa de código está ativa, THE Cadastro_MultiStep SHALL exibir a ação "Não recebi — enviar por e-mail".
2. WHEN o usuário aciona "Não recebi — enviar por e-mail", THE Sistema_FreteGO SHALL solicitar reenvio forçando o `Canal_Email` (`p_force_email = true`).
3. WHEN o reenvio por e-mail é solicitado, THE Sistema_FreteGO SHALL exibir confirmação "Enviamos um novo código para o seu e-mail.".
4. THE Cadastro_MultiStep SHALL manter a ação "Reenviar código" (canal primário) separada da ação de fallback manual.
5. IF o e-mail informado é inválido, THEN THE Sistema_FreteGO SHALL bloquear o fallback manual e indicar que o e-mail precisa ser corrigido.

### Requisito 4: Geração do código (RPC request_signup_otp)

**User Story:** Como Sistema_FreteGO, eu quero gerar e despachar o `Codigo_OTP` de forma
segura keyed pelo telefone, para verificar a posse do número antes de criar a conta.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL expor a RPC `request_signup_otp(p_phone text, p_email text, p_force_email boolean)` como `SECURITY DEFINER` com `SET search_path = public, extensions`.
2. WHEN `request_signup_otp` é chamada, THE Sistema_FreteGO SHALL validar e normalizar `p_phone` para `Telefone_E164`; telefone inválido SHALL resultar em erro `invalid_phone`.
3. WHEN o telefone é válido, THE Sistema_FreteGO SHALL gerar um `Codigo_OTP` de 6 dígitos via `lpad((floor(random()*1000000))::int::text, 6, '0')`.
4. THE Sistema_FreteGO SHALL armazenar na `Tabela_OTP` o hash SHA-256 (base64) do `Codigo_OTP`, o canal-alvo, o `Telefone_E164`, o e-mail (quando informado), `expires_at = now() + 10 minutos`, `attempts = 0`, `consumed = false`.
5. WHEN um novo código é gerado para o mesmo `Telefone_E164`, THE Sistema_FreteGO SHALL invalidar (`consumed = true`) os códigos pendentes anteriores do mesmo alvo.
6. WHEN o código é persistido, THE Sistema_FreteGO SHALL disparar `net.http_post` para a Edge_Envio com `{ phone, email, code, force_email }`.
7. THE RPC SHALL retornar `jsonb_build_object('ok', true)` sem revelar o código nem o `Canal_Efetivo`.
8. THE Sistema_FreteGO SHALL conceder `EXECUTE` da RPC a `anon` e `authenticated` e `REVOKE ALL FROM PUBLIC`.

### Requisito 5: Confirmação do código (RPC confirm_signup_otp)

**User Story:** Como pessoa criando conta, eu quero digitar o código recebido e ter o
contato confirmado, para seguir para a etapa de senha.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL expor `confirm_signup_otp(p_phone text, p_code text)` como `SECURITY DEFINER`.
2. WHEN `confirm_signup_otp` é chamada, THE Sistema_FreteGO SHALL normalizar `p_phone` para `Telefone_E164` e `p_code` removendo não-dígitos antes de comparar.
3. THE Sistema_FreteGO SHALL buscar o registro mais recente não consumido para o `Telefone_E164` e comparar via hash (nunca em texto claro).
4. IF não há registro válido OR `expires_at < now()`, THEN THE Sistema_FreteGO SHALL retornar `{status:'EXPIRED'}` e marcar o registro como consumido quando existir.
5. IF `attempts >= 5`, THEN THE Sistema_FreteGO SHALL retornar `{status:'BLOCKED'}` e invalidar o registro.
6. IF o hash não corresponde, THEN THE Sistema_FreteGO SHALL incrementar `attempts` e retornar `{status:'INVALID'}`.
7. WHEN o código corresponde e é válido, THE Sistema_FreteGO SHALL gerar `Token_Verificacao` (uuid), gravar `verified_at = now()`, `verified_channel`, `token_expires_at = now() + 30 minutos` e retornar `{status:'OK', token, channel}`.
8. THE confirmação SHALL deixar o registro **não consumido** até o cadastro consumir o `Token_Verificacao`.

### Requisito 6: Consumo do token no cadastro (RPC consume_signup_otp_token)

**User Story:** Como Sistema_FreteGO, eu quero validar e consumir o token na criação da
conta, para garantir que o contato foi verificado neste fluxo e impedir reuso.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL expor `consume_signup_otp_token(p_phone text, p_token uuid)` retornando `jsonb` com `{ ok boolean, channel text }`.
2. WHEN chamada, THE Sistema_FreteGO SHALL validar que existe registro para o `Telefone_E164` com `verification_token = p_token`, não consumido, `verified_at IS NOT NULL` e `token_expires_at >= now()`.
3. IF a validação passa, THEN THE Sistema_FreteGO SHALL marcar o registro como `consumed = true` (uso único) e retornar `{ok:true, channel:<verified_channel>}`.
4. IF a validação falha, THEN THE Sistema_FreteGO SHALL retornar `{ok:false}` sem consumir nada.
5. THE `Token_Verificacao` SHALL ser validável **apenas** para o mesmo `Telefone_E164` que o originou.

### Requisito 7: Cadastro do Motorista por WhatsApp

**User Story:** Como motorista, eu quero criar minha conta informando nome, WhatsApp e
e-mail e receber o código no WhatsApp, para entrar rápido no app.

#### Critérios de Aceitação

1. THE Cadastro_MultiStep do motorista SHALL coletar, na etapa 1, nome, WhatsApp (telefone) e e-mail (com confirmação de e-mail).
2. WHEN o motorista conclui a etapa 1 com dados válidos, THE Sistema_FreteGO SHALL chamar `request_signup_otp(phone, email, false)` e avançar para a etapa de código.
3. WHEN o motorista digita os 6 dígitos, THE Sistema_FreteGO SHALL chamar `confirm_signup_otp(phone, code)` e, em `OK`, guardar o `Token_Verificacao` e avançar para a etapa de senha.
4. WHEN o motorista define a senha e aceita os Termos, THE Sistema_FreteGO SHALL criar a conta passando o `Token_Verificacao` para consumo no servidor.
5. WHEN o contato verificado foi o WhatsApp, THE Sistema_FreteGO SHALL persistir `users.phone_verified = true` e `users.email_verified = false`.
6. THE etapa de senha SHALL permanecer idêntica ao fluxo atual (senha + confirmação + aceite dos Termos).

### Requisito 8: Cadastro do Embarcador por WhatsApp e remoção do nome da empresa

**User Story:** Como embarcador, eu quero um cadastro enxuto (nome, WhatsApp, e-mail) com
código no WhatsApp e preencher o nome da empresa depois no perfil.

#### Critérios de Aceitação

1. THE Cadastro_MultiStep do embarcador SHALL coletar, na etapa 1, nome, WhatsApp e e-mail (com confirmação), **sem** o campo "nome da empresa".
2. THE Sistema_FreteGO SHALL usar o mesmo fluxo de código/senha por WhatsApp definido para o motorista (Requisito 7.2–7.6).
3. WHEN a conta do embarcador é criada, THE Sistema_FreteGO SHALL inserir o registro em `embarcadores` com `company_name` nulo/vazio permitido.
4. THE Sistema_FreteGO SHALL permitir ao embarcador informar o nome da empresa na `Página_Perfil_Embarcador` (campo editável existente).
5. THE regra de "cadastro completo para postar frete" SHALL exigir nome da empresa preenchido, mantendo os demais itens já existentes (foto, logo).
6. THE gate de contato para postar frete SHALL aceitar `Contato_Verificado` (Phone_Verificado OR Email_Verificado), não exclusivamente o e-mail.

### Requisito 9: Normalização de Telefone (E.164 BR)

**User Story:** Como Sistema_FreteGO, eu quero normalizar o telefone de forma
determinística, para que o mesmo número sempre gere o mesmo `Telefone_E164`.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL remover todos os caracteres não numéricos do telefone antes de normalizar.
2. WHEN o número tem 10 ou 11 dígitos (DDD + assinante), THE Sistema_FreteGO SHALL prefixar `55` para formar o `Telefone_E164`.
3. WHEN o número já começa com `55` e tem 12 ou 13 dígitos, THE Sistema_FreteGO SHALL tratá-lo como já internacional sem duplicar o prefixo.
4. IF o número resultante não tem entre 12 e 13 dígitos após normalização, THEN THE Sistema_FreteGO SHALL considerá-lo inválido (`invalid_phone`).
5. FOR ALL telefones BR válidos, THE normalização SHALL ser idempotente (normalizar(normalizar(x)) = normalizar(x)).

### Requisito 10: Rate Limiting e Anti-abuso

**User Story:** Como Sistema_FreteGO, eu quero limitar o número de códigos enviados, para
evitar abuso, spam e custo desnecessário.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL limitar a no máximo 5 códigos por `Telefone_E164` em janela de 1 hora.
2. WHEN o limite é atingido, THE `request_signup_otp` SHALL falhar com `rate_limited` e NÃO gerar novo código.
3. THE Sistema_FreteGO SHALL aplicar o mesmo limite ao alvo de e-mail quando o `Fallback_Email`/fallback manual for usado para o mesmo cadastro.
4. THE limite SHALL ser avaliado no servidor (RPC), nunca apenas no cliente.

### Requisito 11: Anti-enumeração

**User Story:** Como Sistema_FreteGO, eu não quero revelar se um telefone/e-mail já tem
conta, para não permitir enumeração de usuários.

#### Critérios de Aceitação

1. WHEN `request_signup_otp` recebe um telefone/e-mail já cadastrado, THE Sistema_FreteGO SHALL retornar `{ok:true}` **sem** enviar código.
2. THE Sistema_FreteGO SHALL usar a `Mensagem_Canonica` para falhas genéricas de envio, sem distinguir causa.
3. THE Sistema_FreteGO SHALL manter o cadastro final como autoridade: contas duplicadas são barradas no INSERT (trigger anti-fraude existente).

### Requisito 12: Segurança de Segredos e RLS

**User Story:** Como Sistema_FreteGO, eu quero que segredos e códigos nunca vazem, para
manter a integridade do canal de autenticação.

#### Critérios de Aceitação

1. THE Tabela_OTP SHALL ter RLS habilitada com política deny-all (`USING (false) WITH CHECK (false)`), acessível somente via RPCs `SECURITY DEFINER`.
2. THE Sistema_FreteGO SHALL armazenar apenas o hash SHA-256 (base64) do `Codigo_OTP`, nunca o código em texto claro.
3. THE Sistema_FreteGO SHALL ler segredos da Cloud_API e da Edge somente do Vault server-side.
4. THE Sistema_FreteGO SHALL NÃO registrar o código, o token, o telefone completo ou segredos em logs (mascarar quando necessário, mantendo apenas os últimos 4 dígitos).
5. THE Edge_Envio SHALL validar o `Authorization: Bearer` (service role OU shared secret) antes de processar, retornando 401 caso contrário.

### Requisito 13: Schema de Banco de Dados (Migration 125)

**User Story:** Como Sistema_FreteGO, eu quero persistir o estado de verificação por
telefone, para avaliar o cadastro em qualquer requisição.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL criar a tabela `signup_otp_verifications` com: `id uuid PK`, `channel text CHECK (channel IN ('whatsapp','email'))`, `phone text`, `email text`, `code_hash text NOT NULL`, `expires_at timestamptz NOT NULL`, `attempts int NOT NULL DEFAULT 0`, `consumed boolean NOT NULL DEFAULT false`, `verified_at timestamptz`, `verified_channel text`, `verification_token uuid`, `token_expires_at timestamptz`, `sent_channel text`, `created_at timestamptz NOT NULL DEFAULT now()`.
2. THE Sistema_FreteGO SHALL criar índices por `(phone, created_at DESC)` e por `verification_token` (parcial, quando não nulo).
3. THE Sistema_FreteGO SHALL adicionar a coluna `users.phone_verified boolean NOT NULL DEFAULT false`.
4. THE Sistema_FreteGO SHALL tornar `embarcadores.company_name` opcional (`DROP NOT NULL` se aplicável), preservando dados existentes.
5. THE Sistema_FreteGO SHALL entregar a migration como `supabase/migrations/125_auth_otp_whatsapp.sql`, idempotente, com bloco `DO $check$` defensivo e par `_rollback.sql` documentado.
6. THE migration SHALL conceder `EXECUTE` das RPCs a `anon, authenticated` e `REVOKE ALL FROM PUBLIC`.

### Requisito 14: Observabilidade e Auditoria

**User Story:** Como operador do Sistema_FreteGO, eu quero registros para auditar envios e
falhas, sem expor segredos.

#### Critérios de Aceitação

1. WHEN um código é enviado, THE Sistema_FreteGO SHALL registrar o evento com alvo mascarado (últimos 4 dígitos) e `Canal_Efetivo`, sem o código.
2. WHEN o `Fallback_Email` é acionado, THE Sistema_FreteGO SHALL registrar a transição de canal para diagnóstico.
3. THE Sistema_FreteGO SHALL manter logs estruturados e nunca incluir token, código ou segredos.

### Requisito 15: Configuração e Degradação Controlada

**User Story:** Como dono do produto, eu quero que o cadastro funcione mesmo antes da
Cloud_API estar aprovada, para não travar o lançamento.

#### Critérios de Aceitação

1. IF a Cloud_API ainda não está configurada (sem segredos no Vault), THEN THE Sistema_FreteGO SHALL operar 100% via `Canal_Email`, mantendo o cadastro funcional.
2. WHEN os segredos da Cloud_API são adicionados ao Vault, THE Sistema_FreteGO SHALL passar a usar o `Canal_WhatsApp` como primário **sem** mudança de código.
3. THE Sistema_FreteGO SHALL documentar as variáveis/segredos necessários (token, phone_number_id, template, idioma) em `docs/`.
4. THE Sistema_FreteGO SHALL tratar limites de mensageria (ex.: tier de 250/dia sem verificação Meta) como falha de envio que aciona o `Fallback_Email`.
