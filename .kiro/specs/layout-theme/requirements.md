# Documento de Requisitos - Layout/Theme

## Introdução

Este documento especifica os requisitos para a migração do tema visual do FreteGO de dark mode (fundo escuro) para light mode (cinza claro). A mudança deve ser aplicada em todas as páginas do sistema, mantendo a funcionalidade existente e garantindo uma experiência visual consistente e profissional.

## Glossário

- **Sistema_FreteGO**: Aplicação web de gerenciamento de fretes desenvolvida em React + TypeScript
- **Tema_Light**: Esquema de cores com fundo cinza claro (não branco puro), textos escuros e elementos visuais adaptados
- **Tema_Dark**: Esquema de cores atual com fundo escuro (gray-950, gray-900, gray-800), textos claros
- **Componente_UI**: Elemento visual reutilizável da interface (cards, botões, inputs, modais, headers)
- **Tailwind_Config**: Arquivo de configuração do Tailwind CSS que define cores e estilos globais
- **CSS_Global**: Arquivo src/index.css com estilos base da aplicação

## Requisitos

### Requisito 1: Configuração de Cores do Tema Light

**User Story:** Como desenvolvedor, eu quero configurar uma paleta de cores light mode no Tailwind, para que todos os componentes possam usar cores consistentes.

#### Critérios de Aceitação

1. THE Tailwind_Config SHALL definir uma paleta de cores customizada para o tema light com tons de cinza claro (gray-50 a gray-200 para fundos)
2. THE Tailwind_Config SHALL manter as cores de destaque existentes (blue-500, blue-600, green-400, green-600, red-400, yellow-400)
3. THE Tailwind_Config SHALL definir cores de texto escuro (gray-700, gray-800, gray-900) para contraste adequado

### Requisito 2: Atualização dos Estilos Globais

**User Story:** Como usuário, eu quero que a aplicação tenha um fundo cinza claro consistente, para que a interface seja mais clara e legível.

#### Critérios de Aceitação

1. THE CSS_Global SHALL definir o fundo base da aplicação como cinza claro (aproximadamente #f5f5f5 ou gray-100)
2. THE CSS_Global SHALL definir a cor de texto padrão como escura (gray-800 ou similar)
3. THE CSS_Global SHALL remover configurações de dark mode do :root

### Requisito 3: Migração de Componentes de Página

**User Story:** Como usuário, eu quero que todas as páginas do sistema usem o tema light, para ter uma experiência visual consistente.

#### Critérios de Aceitação

1. WHEN uma página é renderizada, THE Sistema_FreteGO SHALL exibir fundo cinza claro (gray-100 ou gray-50) em vez de gray-950
2. WHEN um card é renderizado, THE Componente_UI SHALL usar fundo branco ou gray-50 com borda gray-200 em vez de bg-gray-900 e border-gray-800
3. WHEN texto principal é renderizado, THE Componente_UI SHALL usar cor escura (gray-800 ou gray-900) em vez de text-white
4. WHEN texto secundário é renderizado, THE Componente_UI SHALL usar cor gray-600 em vez de text-gray-400

### Requisito 4: Migração do Header

**User Story:** Como usuário, eu quero que o header da aplicação use o tema light, para manter consistência visual.

#### Critérios de Aceitação

1. THE AppHeader SHALL usar fundo branco ou gray-50 com borda inferior gray-200
2. THE AppHeader SHALL usar texto escuro (gray-800) para itens de navegação
3. THE AppHeader SHALL manter a cor azul (blue-500) para o logo FreteGO
4. WHEN o menu dropdown é aberto, THE AppHeader SHALL exibir fundo branco com borda gray-200

### Requisito 5: Migração de Formulários e Inputs

**User Story:** Como usuário, eu quero que os formulários sejam legíveis no tema light, para facilitar o preenchimento de dados.

#### Critérios de Aceitação

1. WHEN um input é renderizado, THE Componente_UI SHALL usar fundo branco com borda gray-300 e texto gray-800
2. WHEN um input recebe foco, THE Componente_UI SHALL exibir ring azul (ring-blue-500) mantendo o padrão atual
3. WHEN um placeholder é exibido, THE Componente_UI SHALL usar cor gray-400 para contraste adequado
4. WHEN um label é renderizado, THE Componente_UI SHALL usar cor gray-700

### Requisito 6: Migração de Modais

**User Story:** Como usuário, eu quero que os modais usem o tema light, para manter consistência com o resto da aplicação.

#### Critérios de Aceitação

1. WHEN um modal é aberto, THE Componente_UI SHALL exibir fundo branco com borda gray-200
2. THE Componente_UI SHALL manter o backdrop escuro semi-transparente para destaque do modal
3. WHEN seções internas do modal são renderizadas, THE Componente_UI SHALL usar fundo gray-50 ou gray-100

### Requisito 7: Migração de Botões

**User Story:** Como usuário, eu quero que os botões mantenham boa visibilidade no tema light, para facilitar a interação.

#### Critérios de Aceitação

1. THE Componente_UI SHALL manter botões primários em azul (bg-blue-600) com texto branco
2. THE Componente_UI SHALL manter botões de sucesso em verde (bg-green-600) com texto branco
3. WHEN um botão secundário é renderizado, THE Componente_UI SHALL usar fundo gray-200 com texto gray-800 em vez de bg-gray-800 com text-white
4. WHEN um botão está desabilitado, THE Componente_UI SHALL usar fundo gray-300 com texto gray-500

### Requisito 8: Migração de Estados e Alertas

**User Story:** Como usuário, eu quero que alertas e estados sejam visíveis no tema light, para identificar informações importantes.

#### Critérios de Aceitação

1. WHEN um alerta de erro é exibido, THE Componente_UI SHALL usar fundo red-50 com borda red-200 e texto red-700
2. WHEN um alerta de sucesso é exibido, THE Componente_UI SHALL usar fundo green-50 com borda green-200 e texto green-700
3. WHEN um alerta de aviso é exibido, THE Componente_UI SHALL usar fundo yellow-50 com borda yellow-200 e texto yellow-700
4. WHEN um status badge é renderizado, THE Componente_UI SHALL adaptar cores para contraste adequado no tema light

### Requisito 9: Preservação de Funcionalidade

**User Story:** Como usuário, eu quero que todas as funcionalidades continuem funcionando após a mudança de tema, para não perder recursos do sistema.

#### Critérios de Aceitação

1. WHILE o tema é alterado, THE Sistema_FreteGO SHALL manter todas as funcionalidades de navegação existentes
2. WHILE o tema é alterado, THE Sistema_FreteGO SHALL manter todas as funcionalidades de formulários existentes
3. WHILE o tema é alterado, THE Sistema_FreteGO SHALL manter todas as interações de clique e hover existentes
4. WHILE o tema é alterado, THE Sistema_FreteGO SHALL manter a responsividade em todos os breakpoints

### Requisito 10: Acessibilidade e Contraste

**User Story:** Como usuário, eu quero que o tema light tenha contraste adequado, para garantir legibilidade.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL garantir ratio de contraste mínimo de 4.5:1 entre texto e fundo
2. THE Sistema_FreteGO SHALL manter indicadores visuais de foco visíveis em todos os elementos interativos
3. THE Sistema_FreteGO SHALL usar cores que não dependam apenas de cor para transmitir informação (ícones, texto)
