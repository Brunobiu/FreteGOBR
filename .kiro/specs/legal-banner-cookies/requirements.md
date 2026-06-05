# Requirements Document

> Feature 3 — Banner de Cookies (FreteGO)

## Introduction

Esta feature exibe, na primeira visita ao site, um **banner de cookies** fixo na parte inferior da tela, com opções de **Aceitar** e **Configurar**. A preferência do usuário é persistida localmente para não reexibir o banner. O comportamento segue a LGPD: cookies não-essenciais (ex.: analytics/marketing) só são ativados após consentimento; cookies estritamente necessários ao funcionamento não exigem consentimento.

O projeto já tem um `PixelProvider` (marketing/Meta Pixel) — o consentimento desta feature deve **gate**ar o carregamento desse pixel: sem consentimento de marketing, o pixel não carrega.

Convenções: UI em pt-BR; identifiers e categorias em inglês (`CookieConsent`, `analytics`, `marketing`).

## Glossary

- **Cookie_Banner**: Banner fixo na parte inferior da tela exibido até o usuário registrar uma preferência.
- **Consent_State**: A preferência registrada do usuário sobre categorias de cookies.
- **Cookie_Category**: Categoria de cookie — `necessary` (sempre ativo), `analytics`, `marketing`.
- **Accept_All_Action**: Ação do botão "Aceitar" que concede consentimento a todas as categorias.
- **Configure_Action**: Ação do botão "Configurar" que abre o painel de preferências por categoria.
- **Consent_Store**: Persistência local do Consent_State (localStorage) com chave e versão.
- **Pixel_Provider**: O provedor de marketing existente (`PixelProvider`) cujo carregamento é gated pelo consentimento de `marketing`.
- **Consent_Version**: Versão do esquema/política de consentimento; permite re-perguntar se a política mudar.

## Requirements

### Requirement 1: Exibição do banner na primeira visita

**User Story:** Como visitante de primeira viagem, quero ver um aviso sobre cookies, para decidir o que permitir.

#### Acceptance Criteria

1. WHEN um usuário visitar o site e não houver Consent_State registrado, THE Cookie_Banner SHALL ser exibido fixo na parte inferior da tela.
2. THE Cookie_Banner SHALL conter um texto curto explicando o uso de cookies e um link para a Política de Privacidade (`/privacidade`).
3. THE Cookie_Banner SHALL exibir um botão "Aceitar" (Accept_All_Action) e um botão "Configurar" (Configure_Action).
4. WHILE o Cookie_Banner estiver visível, THE banner SHALL permanecer acessível sem bloquear a navegação essencial do site.
5. WHEN já existir um Consent_State válido registrado, THE Cookie_Banner SHALL NÃO ser exibido.

### Requirement 2: Registro e persistência da preferência

**User Story:** Como visitante, quero que minha escolha seja lembrada, para não ver o banner toda vez.

#### Acceptance Criteria

1. WHEN o usuário acionar o Accept_All_Action, THE Consent_Store SHALL persistir consentimento para `analytics` e `marketing` (além de `necessary`) e ocultar o banner.
2. WHEN o usuário salvar preferências no painel de Configure_Action, THE Consent_Store SHALL persistir exatamente as categorias escolhidas e ocultar o banner.
3. THE Consent_Store SHALL persistir o Consent_State com a Consent_Version e um timestamp da escolha.
4. WHEN o usuário retornar ao site com Consent_State válido, THE sistema SHALL NÃO reexibir o banner.
5. IF a Consent_Version registrada for diferente da versão atual, THEN THE Cookie_Banner SHALL ser reexibido para nova escolha.
6. THE `necessary` SHALL sempre constar como concedido, independentemente da escolha (cookies essenciais).

### Requirement 3: Painel de configuração por categoria

**User Story:** Como visitante consciente, quero escolher quais categorias permitir, para controlar minha privacidade.

#### Acceptance Criteria

1. WHEN o Configure_Action for acionado, THE sistema SHALL exibir um painel listando as Cookie_Categories com descrição de cada uma.
2. THE painel SHALL apresentar `necessary` como sempre ativo e não desmarcável.
3. THE painel SHALL permitir marcar/desmarcar `analytics` e `marketing` individualmente.
4. THE painel SHALL ter um botão de salvar que aplica e persiste as escolhas.
5. WHEN o usuário salvar sem marcar `analytics`/`marketing`, THE Consent_Store SHALL registrar essas categorias como negadas.

### Requirement 4: Gating de cookies não-essenciais (LGPD)

**User Story:** Como titular de dados, quero que rastreadores só rodem após meu consentimento, para que minha privacidade seja respeitada.

#### Acceptance Criteria

1. WHILE não houver consentimento de `marketing`, THE Pixel_Provider SHALL NÃO carregar nem disparar eventos de marketing.
2. WHEN o consentimento de `marketing` for concedido, THE Pixel_Provider SHALL passar a carregar/disparar normalmente.
3. WHILE não houver consentimento de `analytics`, THE sistema SHALL NÃO inicializar scripts de analytics não-essenciais.
4. THE cookies/recursos da categoria `necessary` SHALL funcionar independentemente de consentimento (sessão, segurança, preferência de tema).
5. WHEN o usuário revogar uma categoria previamente concedida, THE sistema SHALL parar de inicializar os recursos daquela categoria nas próximas cargas de página.

### Requirement 5: Acessibilidade e responsividade

**User Story:** Como usuário em qualquer dispositivo, quero interagir com o banner facilmente, para registrar minha escolha.

#### Acceptance Criteria

1. THE Cookie_Banner SHALL ser responsivo, legível em viewport mobile (`<768px`) sem rolagem horizontal.
2. THE Cookie_Banner e o painel SHALL ser navegáveis por teclado, com foco visível nos botões.
3. THE Cookie_Banner SHALL ter contraste adequado e rótulos de botão descritivos.
4. WHEN o painel de configuração estiver aberto, THE foco SHALL ser gerenciado de forma acessível (foco inicial no painel; ESC fecha sem salvar).
