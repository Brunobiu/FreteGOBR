# Requirements Document: admin-foundation

## Introduction

Esta spec define a **fundação do painel administrativo** (Super-Admin / Backoffice) do FreteGO. O objetivo é entregar a infraestrutura de segurança e UX que sustenta todas as telas administrativas futuras (dashboard, gestão de usuários, fretes, financeiro, blacklist, CRM, suporte, configurações, auditoria), sem implementar o conteúdo dessas telas.

O painel é estritamente separado do app principal: tem rota própria (`/admin`), login próprio (`/admin/login`), sessão própria no `localStorage`, MFA obrigatório (TOTP), controle de acesso baseado em papéis (RBAC) com 5 papéis distintos, trilha de auditoria completa de toda ação crítica, layout corporativo distinto (dark com acentos azul/verde), e detecção básica de comportamento suspeito reaproveitando o `BruteForceProtector` existente.

A stack continua sendo React + Vite + TypeScript + TailwindCSS + Supabase. Esta spec adiciona a migration `030_admin_foundation.sql`, novos componentes em `src/components/admin/`, novas páginas em `src/pages/admin/`, novos serviços em `src/services/admin/` e um novo hook `useAdminPermission`.

**Fora de escopo desta spec:** conteúdo dos cards/gráficos do dashboard, CRUD de usuários/fretes/financeiro/blacklist, telas de CRM e suporte, e configurações específicas. Tudo isso vira spec separada que **depende** desta.

## Glossary

- **Admin_Panel**: O painel administrativo completo, acessível em `/admin/*`, separado do app FreteGO comum.
- **Admin_App**: O app FreteGO comum (motorista/embarcador), em rotas que não começam com `/admin`.
- **Super_Admin**: Usuário com a coluna `users.is_superuser = true`. Único tipo de usuário autorizado a acessar o `Admin_Panel`. Não confundir com `users.user_type = 'admin'` (que é um tipo de conta legado e não dá acesso ao painel).
- **Admin_Role**: Papel atribuído a um Super_Admin via tabela `admin_roles`. Valores possíveis: `SUPER_ADMIN`, `ADMIN`, `SUPORTE`, `FINANCEIRO`, `MODERADOR`.
- **Admin_Action**: Identificador canônico de uma ação executável no painel (ex: `USER_DELETE`, `FRETE_FORCE_CLOSE`, `FINANCEIRO_VIEW`, `AUDIT_VIEW`).
- **Permission_Matrix**: Mapeamento determinístico `(Admin_Role, Admin_Action) → boolean` que define se o papel pode executar a ação.
- **Admin_Auth_Service**: Serviço de autenticação dedicado ao painel. Reutiliza Supabase Auth, mas adiciona validação de `is_superuser`, fluxo TOTP e gravação de sessão em chave isolada do `localStorage`.
- **Admin_Session**: Sessão do painel armazenada em `localStorage` sob a chave `fretego_admin_session`, separada de `fretego_session`. Tem timeout de inatividade próprio (30 min).
- **MFA_TOTP**: Multi-Factor Authentication usando Time-based One-Time Password (RFC 6238), compatível com Google Authenticator, Authy e 1Password.
- **TOTP_Secret**: Segredo base32 de 160 bits gerado no setup do MFA, criptografado em repouso na tabela `admin_mfa_secrets`.
- **Backup_Code**: Código de uso único (10 códigos por admin) gerado no setup do MFA. Permite acesso quando o admin perde o dispositivo TOTP. Cada código consumido é marcado como usado.
- **Admin_Audit_Logger**: Helper que registra toda `Admin_Action` em `admin_audit_logs`, separado do `audit_logs` geral do sistema.
- **Admin_Audit_Log**: Registro em `admin_audit_logs` contendo `admin_id`, `action`, `target_type`, `target_id`, `before_data`, `after_data`, `ip`, `user_agent`, `created_at`.
- **Admin_Shell**: Layout do painel (sidebar fixa desktop / drawer mobile + header com nome, papel, logout e timer de sessão).
- **Admin_Brute_Force_Protector**: Reutilização do `BruteForceProtector` existente, com chave `admin:{phone}` para isolar contadores do app comum.
- **Encrypted_Field**: Campo de banco com conteúdo cifrado por chave simétrica derivada de variável de ambiente `ADMIN_MFA_KEY` (AES-256-GCM via `pgcrypto` ou Edge Function).
- **Stealth_404**: Página 404 visualmente idêntica à 404 padrão do app, retornada quando um não-Super_Admin acessa qualquer rota `/admin/*`, para não revelar a existência do painel.

## Requirements

### Requirement 1: Coluna `is_superuser` em `users`

**User Story:** Como engenheiro de plataforma, quero uma flag booleana dedicada para identificar Super_Admins, para que o acesso ao painel seja independente do `user_type` do app.

#### Acceptance Criteria

1. THE Migration_030 SHALL adicionar a coluna `is_superuser BOOLEAN NOT NULL DEFAULT false` na tabela `users`.
2. THE Migration_030 SHALL criar índice parcial `idx_users_is_superuser` em `users(id) WHERE is_superuser = true`.
3. WHEN um usuário é criado via fluxo normal de registro, THE Auth_Service SHALL gravar `is_superuser = false`.
4. WHERE `users.is_superuser = true`, THE RLS_Engine SHALL permitir que o próprio usuário leia sua linha em `admin_roles` e `admin_mfa_secrets`.
5. IF um cliente tenta atualizar `users.is_superuser` via API, THEN THE RLS_Engine SHALL rejeitar a operação com erro de política.
6. THE Migration_030 SHALL marcar `is_superuser = true` apenas para os IDs explicitamente listados em um bloco `-- BOOTSTRAP` comentado, deixando claro que a promoção inicial é manual via SQL.

### Requirement 2: Rota `/admin` com Stealth 404

**User Story:** Como Super_Admin, quero que a rota `/admin` seja invisível para usuários comuns, para que atacantes não saibam que o painel existe.

#### Acceptance Criteria

1. WHEN um usuário não autenticado acessa qualquer rota sob `/admin/*` (exceto `/admin/login`), THE Admin_Panel SHALL renderizar a `Stealth_404`.
2. WHEN um usuário autenticado com `is_superuser = false` acessa qualquer rota sob `/admin/*`, THE Admin_Panel SHALL renderizar a `Stealth_404`.
3. THE Stealth_404 SHALL ter exatamente o mesmo conteúdo HTML, classes Tailwind e título de aba que a página 404 padrão do `Admin_App` em rotas inexistentes (ex: `/foo-bar-inexistente`).
4. WHEN a `Stealth_404` é renderizada por tentativa de acesso a `/admin/*` por não-Super_Admin, THE Admin_Audit_Logger SHALL registrar a tentativa com `action = 'ADMIN_STEALTH_BLOCK'`, `target_type = 'route'`, `target_id = <pathname>`, sem identificar o usuário no front.
5. THE Stealth_404 SHALL retornar status code 404 quando servida por SSR ou Edge Function (no client-side, garantida via `<title>` e `meta` idênticos).
6. IF a URL contiver query params ou fragments, THEN THE Stealth_404 SHALL ignorá-los e renderizar conteúdo idêntico.

### Requirement 3: Login Customizado em `/admin/login`

**User Story:** Como Super_Admin, quero uma tela de login dedicada com identidade visual de painel admin, para deixar claro que estou em modo administrativo e separar o fluxo do login do app comum.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/login` acessível por usuários não autenticados.
2. THE Admin_Login_Page SHALL receber telefone e senha em formato idêntico ao `LoginPage` do `Admin_App`.
3. WHEN credenciais são submetidas, THE Admin_Auth_Service SHALL autenticar via Supabase Auth usando `${phone}@example.com`, igual ao app comum.
4. WHEN a autenticação Supabase é bem-sucedida E `users.is_superuser = false`, THE Admin_Auth_Service SHALL fazer signOut imediato e retornar `Credenciais inválidas` (mesma mensagem que credenciais erradas, anti-enumeração).
5. WHEN a autenticação Supabase é bem-sucedida E `users.is_superuser = true` E `users.is_active = false`, THE Admin_Auth_Service SHALL retornar `Credenciais inválidas` e fazer signOut.
6. WHEN a autenticação Supabase é bem-sucedida E o usuário é Super_Admin ativo, THE Admin_Auth_Service SHALL prosseguir para o passo de MFA.
7. THE Admin_Login_Page SHALL ter tema visualmente distinto do `LoginPage` comum (fundo escuro, acentos azul/verde, badge "Painel Administrativo").
8. WHEN o login admin falha, THE Admin_Brute_Force_Protector SHALL incrementar o contador na chave `admin:{phone}`.
9. THE Admin_Auth_Service SHALL impor tempo mínimo de resposta de 500ms em todas as falhas para mitigar timing attacks.

### Requirement 4: MFA TOTP — Setup no Primeiro Login

**User Story:** Como Super_Admin no meu primeiro login, quero configurar TOTP com QR code e receber backup codes, para proteger minha conta com segundo fator.

#### Acceptance Criteria

1. WHEN um Super_Admin autentica com sucesso E não existe registro em `admin_mfa_secrets` para seu `user_id`, THE Admin_Panel SHALL redirecionar para `/admin/mfa-setup`.
2. THE MFA_Setup_Page SHALL gerar um `TOTP_Secret` de 160 bits codificado em base32 usando `otplib`.
3. THE MFA_Setup_Page SHALL exibir QR code (gerado via `qrcode`) com URI no formato `otpauth://totp/FreteGO%20Admin:{phone}?secret={base32}&issuer=FreteGO%20Admin&algorithm=SHA1&digits=6&period=30`.
4. THE MFA_Setup_Page SHALL exibir o `TOTP_Secret` em texto plano como fallback para quem não consegue escanear o QR.
5. THE MFA_Setup_Page SHALL gerar 10 `Backup_Codes` aleatórios de 10 caracteres alfanuméricos cada (formato `XXXX-XXXX-XX`).
6. THE MFA_Setup_Page SHALL exigir que o admin digite um código TOTP de 6 dígitos válido antes de confirmar o setup.
7. WHEN o código TOTP de confirmação é válido, THE Admin_Auth_Service SHALL gravar em `admin_mfa_secrets` o `TOTP_Secret` cifrado e os hashes (bcrypt cost 10) dos 10 `Backup_Codes`.
8. THE MFA_Setup_Page SHALL exibir os 10 `Backup_Codes` em texto plano UMA ÚNICA VEZ e exigir confirmação ("Salvei meus códigos") antes de prosseguir.
9. IF o admin recarrega ou navega para fora antes de confirmar, THEN THE Admin_Auth_Service SHALL invalidar o `TOTP_Secret` gerado e exigir reinício do setup.
10. THE TOTP_Secret SHALL ser armazenado cifrado com AES-256-GCM usando chave derivada de `ADMIN_MFA_KEY` (variável de ambiente, nunca commitada).
11. THE Backup_Codes SHALL ser armazenados como hashes bcrypt, nunca em texto plano após a tela inicial.

### Requirement 5: MFA TOTP — Verificação em Logins Subsequentes

**User Story:** Como Super_Admin, quero digitar o código TOTP a cada login, para garantir que mesmo um vazamento de senha não dê acesso ao painel.

#### Acceptance Criteria

1. WHEN um Super_Admin com MFA já configurado autentica com sucesso (telefone + senha), THE Admin_Panel SHALL redirecionar para `/admin/mfa-verify`.
2. THE MFA_Verify_Page SHALL aceitar 2 modos: código TOTP de 6 dígitos OU `Backup_Code` no formato `XXXX-XXXX-XX`.
3. WHEN um código TOTP é submetido, THE Admin_Auth_Service SHALL validar contra o `TOTP_Secret` decifrado, com janela de tolerância de ±1 período (30s antes/depois).
4. WHEN um `Backup_Code` é submetido E seu hash bcrypt corresponde a uma entrada não-usada em `admin_mfa_secrets.backup_codes`, THE Admin_Auth_Service SHALL marcar essa entrada como usada (`used_at = NOW()`) e permitir o login.
5. IF o código TOTP ou `Backup_Code` é inválido, THEN THE Admin_Auth_Service SHALL incrementar `Admin_Brute_Force_Protector` na chave `admin:{phone}` e retornar `Código inválido`.
6. WHEN um `Backup_Code` é consumido, THE Admin_Audit_Logger SHALL registrar `action = 'ADMIN_MFA_BACKUP_CODE_USED'`.
7. WHEN restam 3 ou menos `Backup_Codes` não-usados, THE Admin_Panel SHALL exibir aviso no header pedindo regeneração.
8. THE MFA_Verify_Page SHALL ter expiração de 5 minutos: se o admin não submeter código nesse prazo, THE Admin_Auth_Service SHALL invalidar o passo intermediário e exigir novo login com senha.
9. WHILE a sessão admin está em estado "aguardando MFA", THE Admin_Panel SHALL bloquear acesso a qualquer rota `/admin/*` exceto `/admin/mfa-verify`.

### Requirement 6: MFA — Regeneração e Reset

**User Story:** Como Super_Admin, quero regenerar meus backup codes e, em último caso, resetar meu MFA, para recuperar acesso quando perco o dispositivo.

#### Acceptance Criteria

1. WHERE o admin está autenticado com MFA válido, THE Admin_Settings_Page SHALL oferecer ação `Regenerar Backup Codes`.
2. WHEN backup codes são regenerados, THE Admin_Auth_Service SHALL invalidar todos os 10 codes anteriores e gerar 10 novos.
3. WHEN backup codes são regenerados, THE Admin_Audit_Logger SHALL registrar `action = 'ADMIN_MFA_BACKUP_CODES_REGENERATED'`.
4. THE Admin_Panel SHALL exigir reentrada da senha antes de permitir regenerar backup codes.
5. IF um Super_Admin perde tanto o dispositivo TOTP quanto os backup codes, THEN o reset do MFA SHALL ser feito exclusivamente via SQL direto no banco por outro `SUPER_ADMIN`, gerando registro em `admin_audit_logs` com `action = 'ADMIN_MFA_RESET'`.
6. THE Admin_Panel SHALL NOT expor endpoint de "reset MFA via email/SMS" para evitar que o canal de recuperação vire vetor de ataque.

### Requirement 7: Tabela `admin_roles` e Atribuição de Papéis

**User Story:** Como SUPER_ADMIN, quero atribuir papéis específicos a cada Super_Admin, para limitar o que cada um pode fazer no painel.

#### Acceptance Criteria

1. THE Migration_030 SHALL criar tabela `admin_roles(id uuid PK, user_id uuid FK users.id, role text CHECK IN ('SUPER_ADMIN','ADMIN','SUPORTE','FINANCEIRO','MODERADOR'), granted_by uuid FK users.id, granted_at timestamptz, revoked_at timestamptz)`.
2. THE Migration_030 SHALL criar índice único parcial em `(user_id, role) WHERE revoked_at IS NULL`.
3. THE Admin_Panel SHALL permitir que um usuário Super_Admin tenha múltiplos papéis ativos simultaneamente.
4. WHEN as permissões de um admin são consultadas, THE Permission_Matrix SHALL retornar a união das permissões de todos os papéis ativos (sem `revoked_at`).
5. THE RLS_Engine SHALL exigir que apenas usuários com papel `SUPER_ADMIN` ativo possam inserir, atualizar ou revogar registros em `admin_roles`.
6. WHEN um papel é atribuído ou revogado, THE Admin_Audit_Logger SHALL registrar a ação com `before_data` e `after_data`.
7. IF um admin perde todos os seus papéis ativos (todos com `revoked_at`), THEN THE Admin_Auth_Service SHALL invalidar a sessão admin no próximo request e redirecionar para `Stealth_404`.

### Requirement 8: Permission_Matrix Determinística

**User Story:** Como engenheiro, quero que a checagem `(papel, ação) → permitido?` seja uma função pura e determinística, para que a lógica seja testável e auditável.

#### Acceptance Criteria

1. THE Permission_Matrix SHALL ser implementada como objeto/Map TypeScript em `src/services/admin/permissions.ts`, sem efeitos colaterais.
2. THE Permission_Matrix SHALL definir, no mínimo, as seguintes ações: `USER_VIEW`, `USER_EDIT`, `USER_DELETE`, `USER_TOGGLE_ACTIVE`, `FRETE_VIEW`, `FRETE_EDIT`, `FRETE_DELETE`, `FRETE_FORCE_CLOSE`, `FINANCEIRO_VIEW`, `FINANCEIRO_EDIT`, `BLACKLIST_VIEW`, `BLACKLIST_EDIT`, `CRM_VIEW`, `CRM_EDIT`, `SUPORTE_VIEW`, `SUPORTE_REPLY`, `SETTINGS_VIEW`, `SETTINGS_EDIT`, `AUDIT_VIEW`, `ADMIN_ROLE_GRANT`, `ADMIN_ROLE_REVOKE`.
3. THE Permission_Matrix SHALL atribuir a `SUPER_ADMIN` permissão para TODAS as ações listadas.
4. THE Permission_Matrix SHALL atribuir a `ADMIN` todas as ações exceto `USER_DELETE`, `ADMIN_ROLE_GRANT`, `ADMIN_ROLE_REVOKE`.
5. THE Permission_Matrix SHALL atribuir a `FINANCEIRO` apenas: `USER_VIEW`, `FRETE_VIEW`, `FINANCEIRO_VIEW`, `FINANCEIRO_EDIT`, `AUDIT_VIEW`.
6. THE Permission_Matrix SHALL atribuir a `SUPORTE` apenas: `USER_VIEW`, `USER_TOGGLE_ACTIVE`, `FRETE_VIEW`, `SUPORTE_VIEW`, `SUPORTE_REPLY`, `CRM_VIEW`.
7. THE Permission_Matrix SHALL atribuir a `MODERADOR` apenas: `USER_VIEW`, `FRETE_VIEW`, `FRETE_FORCE_CLOSE`, `BLACKLIST_VIEW`, `BLACKLIST_EDIT`.
8. FOR ALL pares `(role, action)`, THE Permission_Matrix SHALL retornar exatamente um valor booleano (sem `undefined`, sem `null`).
9. FOR ALL `action` não definidas na matriz, THE Permission_Matrix SHALL retornar `false` (deny by default).

### Requirement 9: Hook `useAdminPermission`

**User Story:** Como dev de UI, quero um hook React simples para checar permissões na renderização, para esconder ou desabilitar botões conforme o papel do admin logado.

#### Acceptance Criteria

1. THE useAdminPermission_Hook SHALL ter assinatura `useAdminPermission(action: AdminAction): boolean`.
2. WHEN chamado fora de um componente React filho de `AdminProvider`, THE useAdminPermission_Hook SHALL lançar erro com mensagem `useAdminPermission deve ser usado dentro de <AdminProvider>`.
3. WHEN o admin logado não tem nenhum papel ativo, THE useAdminPermission_Hook SHALL retornar `false` para qualquer ação.
4. WHEN o admin logado tem múltiplos papéis ativos, THE useAdminPermission_Hook SHALL retornar `true` se QUALQUER um dos papéis permite a ação.
5. THE useAdminPermission_Hook SHALL ser memoizado por `(action, roles_atuais)` para evitar recomputação desnecessária.
6. THE useAdminPermission_Hook SHALL refletir mudanças em tempo real quando os papéis do admin são atualizados via realtime do Supabase em `admin_roles`.

### Requirement 10: Tabela `admin_audit_logs`

**User Story:** Como compliance officer, quero registro detalhado de toda ação administrativa, para investigar incidentes e atender LGPD.

#### Acceptance Criteria

1. THE Migration_030 SHALL criar tabela `admin_audit_logs(id uuid PK default gen_random_uuid(), admin_id uuid FK users.id NOT NULL, action text NOT NULL, target_type text, target_id text, before_data jsonb, after_data jsonb, ip text, user_agent text, created_at timestamptz NOT NULL default now())`.
2. THE Migration_030 SHALL criar índices em `created_at desc`, `admin_id`, `action`, e `(target_type, target_id)`.
3. THE RLS_Engine SHALL permitir SELECT em `admin_audit_logs` apenas para admins com permissão `AUDIT_VIEW`.
4. THE RLS_Engine SHALL permitir INSERT em `admin_audit_logs` apenas via função SECURITY DEFINER `log_admin_action()`, nunca direto pelo client.
5. THE RLS_Engine SHALL NEGAR UPDATE e DELETE em `admin_audit_logs` para todos os roles, incluindo `SUPER_ADMIN` (logs são imutáveis).
6. THE Migration_030 SHALL configurar política de retenção de 365 dias via job de limpeza separado (não bloqueante neste spec).

### Requirement 11: Helper `logAdminAction`

**User Story:** Como dev, quero uma função única e ergonômica para gerar audit log de qualquer ação crítica, para que ninguém esqueça de logar.

#### Acceptance Criteria

1. THE Admin_Audit_Logger SHALL expor função `logAdminAction({ action, targetType, targetId, before, after }): Promise<void>`.
2. WHEN `logAdminAction` é chamada, THE Admin_Audit_Logger SHALL injetar automaticamente `admin_id` (da `Admin_Session`), `ip` (via `X-Forwarded-For` ou `'client-side'`) e `user_agent` (via `navigator.userAgent`).
3. WHEN `before` e `after` são objetos, THE Admin_Audit_Logger SHALL serializá-los como JSONB válido.
4. IF a serialização JSON falha (ex: objeto circular), THEN THE Admin_Audit_Logger SHALL gravar `before_data = {error: 'serialization_failed', preview: <toString>}` e continuar.
5. THE Admin_Audit_Logger SHALL ser chamada por TODA mutação que altere estado em qualquer tabela do sistema executada pelo painel admin (ban de usuário, encerramento forçado de frete, atribuição de papel, regeneração de MFA, edição de configuração).
6. WHEN `logAdminAction` falha (rede, RLS), THE Admin_Audit_Logger SHALL retornar erro para o caller, e a operação principal SHALL ser revertida em transação para que NENHUMA mutação ocorra sem audit log correspondente.
7. THE Admin_Audit_Logger SHALL serializar `before_data` e `after_data` de forma que `JSON.parse(JSON.stringify(x))` retorne objeto equivalente em estrutura (round-trip de serialização).

### Requirement 12: Tela `/admin/audit`

**User Story:** Como compliance officer, quero uma tela onde eu posso buscar logs por admin, data e ação, para investigar atividades suspeitas rapidamente.

#### Acceptance Criteria

1. THE Admin_Panel SHALL expor a rota `/admin/audit` acessível apenas a admins com permissão `AUDIT_VIEW`.
2. THE Audit_Page SHALL listar registros de `admin_audit_logs` ordenados por `created_at DESC` com paginação de 50 por página.
3. THE Audit_Page SHALL oferecer filtros por: `admin_id` (dropdown com todos os Super_Admins), `action` (dropdown com ações conhecidas), intervalo de datas (`created_at`).
4. WHEN o filtro de intervalo de datas é aplicado, THE Audit_Page SHALL validar que `data_inicial <= data_final`.
5. THE Audit_Page SHALL exibir, em cada linha: data/hora, nome do admin, ação, target, e botão "ver detalhes" que abre modal com `before_data` e `after_data` formatados como JSON.
6. WHEN um filtro retorna mais de 1000 resultados, THE Audit_Page SHALL exibir aviso "Mais de 1000 resultados, refine os filtros" e listar apenas os 1000 primeiros.
7. THE Audit_Page SHALL permitir export CSV dos resultados filtrados (até 10000 linhas por export).
8. WHEN o admin clica em "exportar CSV", THE Admin_Audit_Logger SHALL registrar a própria ação de export com `action = 'AUDIT_EXPORT'`.

### Requirement 13: Sessão Admin Isolada

**User Story:** Como Super_Admin, quero que minha sessão admin seja independente da sessão do app comum, para poder estar logado nos dois ao mesmo tempo sem conflito e para que o timeout admin seja mais curto.

#### Acceptance Criteria

1. THE Admin_Auth_Service SHALL armazenar a sessão sob a chave `localStorage` `fretego_admin_session`, separada de `fretego_session`.
2. THE Admin_Session SHALL conter: `userId`, `accessToken`, `refreshToken`, `expiresAt`, `lastActivityAt`, `roles[]`, `mfaVerified: boolean`.
3. WHEN há atividade do mouse, teclado, scroll ou touch dentro de qualquer rota `/admin/*`, THE Admin_Session SHALL atualizar `lastActivityAt` (throttled a 1 update por minuto).
4. WHEN `Date.now() - lastActivityAt > 30 minutos`, THE Admin_Auth_Service SHALL invalidar a `Admin_Session` e redirecionar para `/admin/login`.
5. WHEN faltam 5 minutos para o timeout, THE Admin_Shell SHALL exibir aviso modal com countdown e botão "Continuar logado".
6. WHEN o admin clica em "Continuar logado", THE Admin_Auth_Service SHALL atualizar `lastActivityAt = Date.now()` E exigir reentrada do código TOTP atual.
7. THE Admin_Session SHALL ser independente: logout do app comum NÃO invalida a sessão admin, e logout admin NÃO invalida a sessão do app comum.
8. WHEN o usuário acessa `/admin/*` em outra aba do navegador, THE Admin_Session SHALL ser compartilhada via `localStorage` (mesma sessão).
9. IF a flag `is_active = false` é setada em `users` para um Super_Admin com sessão ativa, THEN THE Admin_Auth_Service SHALL invalidar a `Admin_Session` no próximo request (verificação a cada navegação de rota).
10. IF todos os papéis de um admin são revogados, THEN THE Admin_Auth_Service SHALL invalidar a `Admin_Session` no próximo request.

### Requirement 14: Layout / Shell do Painel

**User Story:** Como Super_Admin, quero um layout corporativo distinto do app, com sidebar, header e indicadores claros de modo admin, para nunca confundir ambiente.

#### Acceptance Criteria

1. THE Admin_Shell SHALL renderizar sidebar fixa à esquerda em viewports `>= 1024px` com itens: Dashboard, Usuários, Fretes, Financeiro, Blacklist, CRM, Suporte, Configurações, Auditoria.
2. THE Admin_Shell SHALL renderizar drawer (overlay com botão hamburger no header) em viewports `< 1024px`.
3. THE Admin_Shell SHALL ocultar (não apenas desabilitar) os itens da sidebar para os quais o admin não tem permissão de view (`USER_VIEW`, `FRETE_VIEW`, `FINANCEIRO_VIEW`, `BLACKLIST_VIEW`, `CRM_VIEW`, `SUPORTE_VIEW`, `SETTINGS_VIEW`, `AUDIT_VIEW`).
4. THE Admin_Shell SHALL exibir header próprio com: nome do admin logado, lista de papéis ativos, botão logout, e timer regressivo do timeout de sessão atualizado a cada segundo.
5. THE Admin_Shell SHALL aplicar tema dark com cores `bg-slate-900` (fundo), `bg-slate-800` (sidebar), acentos `blue-500` e `emerald-500`, distintos do tema do `Admin_App`.
6. THE Admin_Shell SHALL exibir badge fixo no canto superior esquerdo com texto "PAINEL ADMIN" e ícone de cadeado.
7. THE Admin_Shell SHALL ser totalmente responsivo (sem scroll horizontal em viewports >= 360px).
8. WHEN o timer de sessão atinge zero, THE Admin_Shell SHALL exibir tela de bloqueio fullscreen "Sessão expirada" e redirecionar para `/admin/login` em 3s.
9. THE Admin_Shell SHALL preservar o estado de scroll da rota anterior ao navegar pela sidebar.

### Requirement 15: Lockout de Login Admin (Brute Force)

**User Story:** Como engenheiro de segurança, quero que tentativas de força bruta no login admin acionem lockout temporário, mesmo após a credencial correta, para mitigar ataques.

#### Acceptance Criteria

1. THE Admin_Brute_Force_Protector SHALL usar a chave `admin:{phone}` para isolar contadores das tentativas no app comum.
2. WHEN uma tentativa de login admin falha (senha errada OU TOTP errado OU backup code errado), THE Admin_Brute_Force_Protector SHALL incrementar o contador.
3. WHEN o contador atinge 5 tentativas falhadas, THE Admin_Brute_Force_Protector SHALL bloquear novos logins admin para esse telefone por 30 minutos.
4. WHILE a chave `admin:{phone}` está em lockout, THE Admin_Auth_Service SHALL retornar `Conta temporariamente bloqueada. Tente novamente em N minutos.` E NÃO autenticar o usuário, MESMO que a senha e o TOTP estejam corretos.
5. WHEN um login admin é bem-sucedido (senha + MFA), THE Admin_Brute_Force_Protector SHALL resetar o contador e remover o lockout.
6. WHEN um lockout admin é acionado, THE Admin_Audit_Logger SHALL registrar `action = 'ADMIN_LOCKOUT'`.
7. WHEN um lockout admin é acionado, THE Admin_Panel SHALL exibir aviso visual no `/admin/dashboard` (na próxima sessão bem-sucedida) com a contagem de tentativas falhadas das últimas 24h.

### Requirement 16: Log de IP e User Agent em Cada Login Admin

**User Story:** Como compliance officer, quero saber de onde cada admin logou, para investigar acessos suspeitos.

#### Acceptance Criteria

1. WHEN um login admin é bem-sucedido, THE Admin_Audit_Logger SHALL registrar `action = 'ADMIN_LOGIN_SUCCESS'` com `ip` e `user_agent`.
2. WHEN um login admin falha (senha, TOTP, backup code, lockout), THE Admin_Audit_Logger SHALL registrar `action = 'ADMIN_LOGIN_FAILURE'` com `ip`, `user_agent` e motivo em `after_data.reason`.
3. THE Admin_Audit_Logger SHALL truncar `user_agent` em 512 caracteres antes de gravar.
4. THE Admin_Audit_Logger SHALL armazenar `ip` como string (IPv4 ou IPv6); IF não houver IP detectável, THEN THE Admin_Audit_Logger SHALL gravar `'client-side'`.
5. THE Admin_Dashboard SHALL exibir card "Tentativas falhadas nas últimas 24h" lendo `admin_audit_logs` com `action = 'ADMIN_LOGIN_FAILURE'`.

### Requirement 17: Tabela `admin_mfa_secrets`

**User Story:** Como Super_Admin, quero que meu segredo TOTP e backup codes fiquem armazenados de forma segura, para que ninguém possa burlar meu MFA mesmo com acesso ao banco.

#### Acceptance Criteria

1. THE Migration_030 SHALL criar tabela `admin_mfa_secrets(user_id uuid PK FK users.id, totp_secret_encrypted bytea NOT NULL, backup_codes jsonb NOT NULL, created_at timestamptz NOT NULL default now(), updated_at timestamptz NOT NULL default now())`.
2. THE backup_codes SHALL ter formato JSONB array: `[{hash: string, used_at: timestamptz | null}, ...]` com exatamente 10 elementos.
3. THE RLS_Engine SHALL permitir SELECT em `admin_mfa_secrets` APENAS pelo próprio `user_id` (auth.uid() = user_id).
4. THE RLS_Engine SHALL NEGAR UPDATE direto em `admin_mfa_secrets`; updates SHALL ser feitos exclusivamente via funções SECURITY DEFINER (`set_mfa_secret`, `regenerate_backup_codes`, `consume_backup_code`).
5. THE RLS_Engine SHALL permitir DELETE em `admin_mfa_secrets` apenas para usuários com papel `SUPER_ADMIN` ativo.
6. WHEN o registro é deletado (reset MFA), THE Admin_Audit_Logger SHALL registrar `action = 'ADMIN_MFA_RESET'`.
7. THE Migration_030 SHALL adicionar trigger `BEFORE UPDATE` para atualizar `updated_at = NOW()`.

### Requirement 18: Round-Trip de Serialização do TOTP_Secret

**User Story:** Como engenheiro, quero garantir que o TOTP_Secret pode ser cifrado, decifrado, e usado corretamente, para que admins não fiquem trancados fora por bug de codificação.

#### Acceptance Criteria

1. THE MFA_Crypto_Helper SHALL expor funções `encryptTotpSecret(plain: string): Uint8Array` e `decryptTotpSecret(cipher: Uint8Array): string`.
2. FOR ALL strings base32 válidas `s` (A-Z, 2-7, comprimento múltiplo de 8, até 256 chars), `decryptTotpSecret(encryptTotpSecret(s)) === s` (round-trip).
3. THE MFA_Crypto_Helper SHALL usar AES-256-GCM com IV aleatório de 12 bytes prependido ao ciphertext.
4. IF o ciphertext é truncado, alterado ou cifrado com outra chave, THEN `decryptTotpSecret` SHALL lançar erro `MFA_DECRYPT_FAILED`.
5. THE MFA_Crypto_Helper SHALL expor função `formatBackupCode(raw: string): string` que insere hífens no padrão `XXXX-XXXX-XX` E `parseBackupCode(formatted: string): string` que remove hífens e normaliza para uppercase.
6. FOR ALL strings de 10 caracteres alfanuméricos uppercase `c`, `parseBackupCode(formatBackupCode(c)) === c` (round-trip).
7. THE MFA_Crypto_Helper SHALL aceitar formatos com ou sem hífen na entrada de `parseBackupCode` (ex: `ABCD-EFGH-IJ`, `ABCDEFGHIJ`, `abcd-efgh-ij` todos retornam `ABCDEFGHIJ`).

### Requirement 19: Aviso Visual de Tentativas Falhadas no Dashboard

**User Story:** Como Super_Admin, quero ver imediatamente no dashboard quando houver tentativas suspeitas, para reagir rápido a ataques.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL exibir card de alerta destacado quando o número de eventos `ADMIN_LOGIN_FAILURE` nas últimas 24h for `>= 10`.
2. THE Admin_Dashboard SHALL exibir card de alerta destacado quando houver pelo menos 1 evento `ADMIN_LOCKOUT` nas últimas 24h.
3. THE Admin_Dashboard SHALL exibir card de alerta destacado quando houver pelo menos 1 evento `ADMIN_STEALTH_BLOCK` nas últimas 24h originado de IP que NÃO consta nos `ADMIN_LOGIN_SUCCESS` recentes do mesmo período.
4. THE alert cards SHALL ter cor de fundo `bg-red-900` e ícone de alerta.
5. THE alert cards SHALL linkar para `/admin/audit` com filtro pré-aplicado para a ação relevante.
6. WHEN não há eventos suspeitos nas últimas 24h, THE Admin_Dashboard SHALL exibir card neutro `bg-emerald-900` com texto "Nenhuma atividade suspeita".

### Requirement 20: Provider e Integração de Rotas

**User Story:** Como dev, quero um único provider que monta toda a infraestrutura admin (sessão, papéis, permissões), para que cada página admin não precise rebuildar essa lógica.

#### Acceptance Criteria

1. THE AdminProvider_Component SHALL ser exportado de `src/components/admin/AdminProvider.tsx`.
2. THE AdminProvider_Component SHALL prover via Context: `adminUser`, `roles`, `hasPermission(action)`, `logout()`, `sessionTimeRemaining`.
3. THE AdminProvider_Component SHALL ser obrigatório em todas as rotas `/admin/*` exceto `/admin/login` e `/admin/mfa-setup` e `/admin/mfa-verify`.
4. WHEN um componente filho de `AdminProvider` chama `logout()`, THE AdminProvider_Component SHALL: invalidar `Admin_Session`, registrar `action = 'ADMIN_LOGOUT'`, e redirecionar para `/admin/login`.
5. THE AdminRouter SHALL ser configurado em `src/App.tsx` (ou arquivo dedicado) usando `react-router` v6.
6. THE AdminRouter SHALL aplicar `AdminGuard` em todas as rotas `/admin/*` exceto `/admin/login`, `/admin/mfa-setup`, `/admin/mfa-verify`.
7. THE AdminGuard SHALL verificar (em ordem): sessão admin válida → `is_superuser = true` → `is_active = true` → tem pelo menos 1 papel ativo → MFA verificado nesta sessão. Falha em qualquer etapa SHALL renderizar `Stealth_404`.

### Requirement 21: Migration `030_admin_foundation.sql`

**User Story:** Como engenheiro, quero uma migration única, idempotente e reversível, para que o setup do painel admin possa ser aplicado em dev/staging/prod sem dor.

#### Acceptance Criteria

1. THE Migration_030 SHALL ser arquivada como `supabase/migrations/030_admin_foundation.sql`.
2. THE Migration_030 SHALL aplicar em ordem: alteração de `users`, criação de `admin_roles`, criação de `admin_mfa_secrets`, criação de `admin_audit_logs`, funções SECURITY DEFINER (`log_admin_action`, `set_mfa_secret`, `regenerate_backup_codes`, `consume_backup_code`), políticas RLS, índices.
3. THE Migration_030 SHALL ser idempotente: rodar duas vezes SHALL NÃO produzir erro nem duplicar índices/políticas (uso de `IF NOT EXISTS`, `CREATE OR REPLACE`, `DO $$ ... $$` quando necessário).
4. THE Migration_030 SHALL incluir comentário de cabeçalho explicando objetivo, dependências (migrations 001..029), e instrução de bootstrap manual de Super_Admins.
5. THE Migration_030 SHALL incluir, ao final, bloco comentado `-- BOOTSTRAP` com SQL pronto para promover usuários a `is_superuser = true` (a ser descomentado e editado manualmente).
6. IF a migration falha em qualquer passo, THEN o estado anterior SHALL ser preservado (envolver em transação `BEGIN; ... COMMIT;`).

## Edge Cases (não-funcionais, mas obrigatórios)

Os comportamentos a seguir SHALL ser cobertos por testes ou documentação explícita:

1. **Super_Admin perde dispositivo TOTP E backup codes**: único caminho de recuperação é reset manual via SQL por outro `SUPER_ADMIN`. Documentar em `.kiro/specs/admin-foundation/RECOVERY.md` (a ser criado na fase de tasks).
2. **Super_Admin é desativado (`is_active = false`) com sessão ativa**: a sessão SHALL ser invalidada na próxima requisição/navegação (Req 13).
3. **Todos os papéis do admin são revogados em runtime**: sessão SHALL ser invalidada na próxima navegação (Req 7, Req 13).
4. **Admin abre o painel em duas abas**: ambas compartilham a mesma `Admin_Session` via `localStorage` (Req 13).
5. **Admin perde conexão durante MFA setup**: o `TOTP_Secret` gerado em memória SHALL ser invalidado e o setup recomeçado (Req 4).
6. **Backup codes acabam (todos com `used_at` setado)**: admin SHALL ser forçado a regenerar antes do próximo logout (aviso bloqueante).
7. **Relógio do servidor TOTP fora de sincronia**: tolerância de ±1 período (30s) na verificação (Req 5).
8. **Atacante descobre `/admin/login` e tenta brute force**: lockout em 5 tentativas + log de IP/UA (Req 15, 16).
9. **Atacante tenta acessar `/admin/dashboard` sem login**: Stealth 404 idêntica (Req 2).
10. **Erro de serialização JSON em `before_data`/`after_data`**: log gravado com placeholder de erro, operação NÃO é revertida só por isso (Req 11).
11. **Falha de rede ao gravar audit log**: operação principal SHALL ser revertida (Req 11.6).
12. **Migração rodada em banco já parcialmente migrado**: idempotente (Req 21).
13. **Super_Admin com 0 papéis ativos tenta logar**: bloqueado (Req 7.7), Stealth 404.

## Correctness Properties (Property-Based Tests)

Estas propriedades DEVEM ser testáveis com fast-check (já em uso no projeto). Funções alvo são puras ou facilmente isoláveis com mocks de banco.

### CP-1: Stealth 404 para Não-Super_Admin (Property)
**Propriedade:** Para todo usuário `u` com `u.is_superuser = false` e toda rota `r` que começa com `/admin/` (exceto `/admin/login`), `AdminGuard(u, r)` retorna o componente `Stealth_404`.
**Tipo:** Property (Invariante).
**Geradores:** `u: User` com `is_superuser ∈ {false, undefined}`, `r ∈ rotas_admin_geradas`.

### CP-2: Toda Mutação Admin Gera Audit Log (Property)
**Propriedade:** Para toda chamada à função `executeAdminMutation(action, payload)`, existe exatamente 1 registro novo em `admin_audit_logs` com `action` correspondente, criado dentro do mesmo intervalo de transação.
**Tipo:** Property (Invariante).
**Geradores:** `action ∈ AdminAction`, `payload: arbitrário`.

### CP-3: Permission_Matrix Determinística (Property)
**Propriedade:** Para todo par `(role, action)` onde `role ∈ AdminRole` e `action ∈ AdminAction`, `hasPermission(role, action)` é **função pura**: chamadas repetidas com mesmo input produzem mesmo output booleano.
**Tipo:** Property (Determinismo).
**Geradores:** `role`, `action` exaustivos.

### CP-4: União de Permissões para Múltiplos Papéis (Property)
**Propriedade:** Para todo conjunto de papéis `R ⊆ AdminRole`, `hasPermissionForRoles(R, a) === R.some(r => hasPermission(r, a))`.
**Tipo:** Property (Metamórfica).
**Geradores:** `R: AdminRole[]`, `a: AdminAction`.

### CP-5: Lockout Bloqueia Mesmo com Credencial Correta (Property)
**Propriedade:** Após `N >= 5` tentativas falhadas para `phone p` em janela < 30min, qualquer `loginAdmin(p, senha_correta, totp_correto)` falha com `ACCOUNT_LOCKED` por pelo menos 30 minutos.
**Tipo:** Property (Invariante temporal).
**Geradores:** `p: phone`, `N ∈ [5, 20]`, mock de tempo.

### CP-6: Round-Trip de Cifragem do TOTP_Secret (Property)
**Propriedade:** Para toda string base32 válida `s` (A-Z, 2-7, comprimento múltiplo de 8, 16 ≤ |s| ≤ 256), `decryptTotpSecret(encryptTotpSecret(s)) === s`.
**Tipo:** Round-Trip.
**Geradores:** strings base32.

### CP-7: Round-Trip de Backup Code Format (Property)
**Propriedade:** Para toda string `c` de 10 caracteres alfanuméricos uppercase, `parseBackupCode(formatBackupCode(c)) === c`.
**Tipo:** Round-Trip.
**Geradores:** strings `[A-Z0-9]{10}`.

### CP-8: Round-Trip JSON de Audit Data (Property)
**Propriedade:** Para todo objeto `o` JSON-serializável (sem ciclos, sem funções, sem `undefined` em arrays), `deserializeAuditData(serializeAuditData(o))` é estruturalmente igual a `o` (deep-equal).
**Tipo:** Round-Trip.
**Geradores:** objetos JSON arbitrários via `fc.jsonValue()`.

### CP-9: Backup Code Idempotência de Consumo (Property)
**Propriedade:** Consumir o mesmo backup code duas vezes: a primeira chamada retorna `{ok: true}` e marca `used_at`, a segunda retorna `{ok: false, reason: 'already_used'}` sem alterar nada.
**Tipo:** Idempotência (operação que não pode ser repetida).
**Geradores:** códigos válidos, mocks de banco.

### CP-10: TOTP Tolerância de Janela (Property)
**Propriedade:** Para todo `secret`, todo `t ∈ {now-30, now, now+30}` (em segundos), `verifyTotp(secret, generateTotp(secret, t), now) === true`. Para `t = now ± 60`, retorna `false`.
**Tipo:** Property (limite de tolerância).
**Geradores:** secrets, deltas de tempo.

### CP-11: Stealth 404 Idêntica à 404 Padrão (Property)
**Propriedade:** Para toda rota `r` em `/admin/*` acessada por não-Super_Admin e toda rota `r'` inexistente fora de `/admin`, o HTML renderizado tem mesmo `document.title`, mesmo conteúdo de `<main>`, e mesmas classes CSS no root (comparação de snapshot).
**Tipo:** Property (Invariante visual).
**Geradores:** rotas em `/admin/*`, rotas inexistentes arbitrárias.

### CP-12: Audit Log é Imutável (Property)
**Propriedade:** Para todo registro `l` inserido em `admin_audit_logs`, qualquer tentativa de UPDATE ou DELETE em `l` (via cliente Supabase com qualquer role admin) retorna erro RLS, e `l` permanece inalterado no banco.
**Tipo:** Property (Invariante de integridade).
**Geradores:** logs arbitrários, roles arbitrárias.

### CP-13: Sessão Admin Invalida ao Desativar Super_Admin (Property)
**Propriedade:** Para todo Super_Admin com `Admin_Session` ativa, setar `users.is_active = false` invalida a sessão na próxima chamada a `validateAdminSession()` (retorna `{isValid: false, reason: 'inactive'}`).
**Tipo:** Property (Invariante de estado).
**Geradores:** sessões válidas com diferentes timestamps.

### CP-14: Deny by Default em Permission_Matrix (Property)
**Propriedade:** Para toda string `action` que NÃO está no enum `AdminAction`, `hasPermission(role, action) === false` para todo `role`.
**Tipo:** Property (Invariante de segurança).
**Geradores:** strings arbitrárias filtradas para não bater com enum.

## Padrões de Sucesso

A spec é considerada bem implementada quando:

1. Todos os 21 requisitos têm testes correspondentes (unitários, integração ou E2E).
2. Todas as 14 correctness properties (CP-1 a CP-14) passam em PBT com pelo menos 100 iterações.
3. Migration `030_admin_foundation.sql` aplica limpa em banco zerado E em banco com migrations 001..029.
4. Todos os textos de UI estão em pt-BR.
5. Stealth 404 passa em snapshot test contra a 404 padrão.
6. Lighthouse `/admin/login` em mobile (Moto G4) tem score de Performance >= 80.
