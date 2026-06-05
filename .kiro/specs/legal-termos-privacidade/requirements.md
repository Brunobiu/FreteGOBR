# Requirements Document

> Feature 1 — Termos de Uso e Política de Privacidade (FreteGO)

## Introduction

Esta feature cria duas páginas públicas no FreteGO — **Termos de Uso** e **Política de Privacidade** — adequadas a um marketplace de frete brasileiro que coleta dados pessoais sensíveis de motoristas e embarcadores (CPF, RG, CNH, RNTRC, documentos do veículo, CNPJ, localização). O conteúdo deve estar em conformidade com a LGPD (Lei 13.709/2018).

As páginas são acessíveis sem login, têm layout limpo e responsivo, exibem a data da última atualização e uma versão do documento, e são linkadas a partir do rodapé do site. Esta feature é a base das Features 2 (aceite obrigatório), 3 (cookies) e 4 (exclusão de dados).

Convenções de idioma: conteúdo e UI em **pt-BR**; identifiers, slugs de rota e nomes de tipo em **inglês** (`LegalDocument`, `legal_version`), conforme `project-conventions.md`.

## Glossary

- **Legal_Page**: Página pública que renderiza um documento legal (Termos de Uso ou Política de Privacidade).
- **Terms_Page**: A Legal_Page de Termos de Uso, na rota `/termos`.
- **Privacy_Page**: A Legal_Page de Política de Privacidade, na rota `/privacidade`.
- **Legal_Version**: Identificador de versão de um documento legal (ex.: `2026-06-05`), usado para rastrear qual versão estava vigente. Consumido pela Feature 2.
- **Last_Updated_Date**: Data da última atualização exibida no topo do documento.
- **Site_Footer**: Rodapé global do site, presente nas páginas públicas, que contém os links para as Legal_Pages.
- **Legal_Content_Source**: Fonte do conteúdo dos documentos legais (arquivo versionado no código).

## Requirements

### Requirement 1: Página pública de Termos de Uso

**User Story:** Como visitante, quero acessar os Termos de Uso sem precisar de login, para entender as regras de uso da plataforma antes de me cadastrar.

#### Acceptance Criteria

1. THE Terms_Page SHALL ser acessível publicamente na rota `/termos` sem exigir autenticação.
2. THE Terms_Page SHALL renderizar o conteúdo dos Termos de Uso a partir do Legal_Content_Source.
3. THE Terms_Page SHALL exibir a Last_Updated_Date no topo do documento.
4. THE Terms_Page SHALL exibir a Legal_Version vigente do documento.
5. WHEN a Terms_Page for aberta em viewport mobile (`<768px`), THE Terms_Page SHALL renderizar o conteúdo legível em coluna única sem rolagem horizontal.
6. THE Terms_Page SHALL conter seções cobrindo: objeto do serviço, cadastro e elegibilidade, obrigações de motoristas e embarcadores, conduta proibida, responsabilidades e limitação de responsabilidade, propriedade intelectual, rescisão, e foro/legislação aplicável.

### Requirement 2: Página pública de Política de Privacidade conforme LGPD

**User Story:** Como titular de dados, quero acessar a Política de Privacidade sem login, para saber quais dados pessoais são coletados e como são tratados.

#### Acceptance Criteria

1. THE Privacy_Page SHALL ser acessível publicamente na rota `/privacidade` sem exigir autenticação.
2. THE Privacy_Page SHALL renderizar o conteúdo da Política de Privacidade a partir do Legal_Content_Source.
3. THE Privacy_Page SHALL exibir a Last_Updated_Date e a Legal_Version no topo do documento.
4. THE Privacy_Page SHALL listar as categorias de dados pessoais coletadas, incluindo CPF, RG, CNH, RNTRC, dados do veículo, CNPJ e localização.
5. THE Privacy_Page SHALL descrever as finalidades do tratamento de cada categoria de dado e a base legal correspondente (LGPD art. 7º).
6. THE Privacy_Page SHALL informar os direitos do titular previstos na LGPD (acesso, correção, exclusão, portabilidade, revogação de consentimento) e como exercê-los.
7. THE Privacy_Page SHALL informar o canal de contato do controlador de dados (encarregado/DPO ou email de privacidade).
8. THE Privacy_Page SHALL descrever o período de retenção dos dados e as condições de compartilhamento com terceiros.
9. WHERE a Privacy_Page mencionar exclusão de dados, THE Privacy_Page SHALL referenciar o prazo de até 30 dias (alinhado à Feature 4).

### Requirement 3: Versionamento e fonte de conteúdo dos documentos legais

**User Story:** Como responsável legal, quero que cada documento tenha uma versão e data rastreáveis, para que o aceite do usuário (Feature 2) registre qual versão foi aceita.

#### Acceptance Criteria

1. THE Legal_Content_Source SHALL definir, para cada documento, uma Legal_Version e uma Last_Updated_Date como dados estruturados.
2. WHEN o conteúdo de um documento legal for alterado, THE Legal_Content_Source SHALL exigir a atualização da Legal_Version e da Last_Updated_Date correspondentes.
3. THE Legal_Version SHALL ser exposta de forma programática para consumo pela Feature 2 (aceite obrigatório).
4. THE Legal_Content_Source SHALL ser a única fonte de verdade do texto exibido nas Legal_Pages.

### Requirement 4: Acesso pelo rodapé do site

**User Story:** Como visitante, quero encontrar os links para Termos e Privacidade no rodapé, para acessá-los de qualquer página pública.

#### Acceptance Criteria

1. THE Site_Footer SHALL exibir um link para a Terms_Page e um link para a Privacy_Page.
2. THE Site_Footer SHALL estar presente nas páginas públicas do site (no mínimo login, cadastro e home pública).
3. WHEN um usuário clicar no link de Termos no Site_Footer, THE sistema SHALL navegar para `/termos`.
4. WHEN um usuário clicar no link de Privacidade no Site_Footer, THE sistema SHALL navegar para `/privacidade`.
5. THE Site_Footer SHALL exibir o aviso de copyright com o ano corrente.

### Requirement 5: Acessibilidade e navegação

**User Story:** Como usuário com tecnologia assistiva, quero que as páginas legais sejam navegáveis e legíveis, para conseguir ler os documentos.

#### Acceptance Criteria

1. THE Legal_Page SHALL usar hierarquia semântica de cabeçalhos (um `h1` por página e subtítulos em ordem).
2. THE Legal_Page SHALL ter contraste de texto adequado para leitura conforme diretrizes de acessibilidade.
3. WHEN a Legal_Page tiver um índice de seções, THE índice SHALL permitir navegação por âncoras para cada seção.
4. THE Legal_Page SHALL definir um título de documento (`document.title`) descritivo para cada página.
