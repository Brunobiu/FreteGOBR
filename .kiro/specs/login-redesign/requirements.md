# Documento de Requisitos - Login Redesign

## Introdução

Este documento especifica os requisitos para o redesign visual da página de login do FreteGO. O objetivo é substituir o layout atual (tela dividida com marketing à esquerda e formulário à direita em fundo escuro) por um design moderno com imagem de fundo temática (caminhão/estrada), overlay semi-transparente para legibilidade e card centralizado para o formulário.

## Glossário

- **Sistema_FreteGO**: Aplicação web de gerenciamento de fretes desenvolvida em React + TypeScript + Vite + Supabase + Tailwind CSS
- **Página_Login**: Componente LoginPage.tsx que renderiza a tela de autenticação
- **Formulário_Login**: Componente LoginForm.tsx que contém os campos de telefone e senha
- **Imagem_Background**: Foto temática de caminhão/estrada usada como fundo da página de login
- **Overlay_Escuro**: Camada semi-transparente sobre a imagem de fundo para garantir legibilidade
- **Card_Formulário**: Container com fundo sólido que envolve o formulário de login
- **Breakpoint_Mobile**: Largura de tela menor que 768px (md no Tailwind)
- **Breakpoint_Desktop**: Largura de tela igual ou maior que 768px

## Requisitos

### Requisito 1: Imagem de Fundo na Página de Login

**User Story:** Como usuário, eu quero ver uma imagem temática de caminhão/estrada ao acessar a página de login, para ter uma experiência visual mais atraente e conectada ao contexto de transporte.

#### Critérios de Aceitação

1. WHEN a Página_Login é carregada, THE Sistema_FreteGO SHALL exibir uma Imagem_Background que cubra toda a viewport
2. THE Imagem_Background SHALL ser posicionada com object-cover para manter proporções sem distorção
3. THE Imagem_Background SHALL ser carregada de forma otimizada (lazy loading ou preload conforme necessidade)
4. IF a Imagem_Background falhar ao carregar, THEN THE Sistema_FreteGO SHALL exibir um fundo sólido de fallback (cinza claro conforme tema light)

### Requisito 2: Overlay Semi-Transparente

**User Story:** Como usuário, eu quero que o texto e formulário sejam legíveis sobre a imagem de fundo, para conseguir usar a página sem dificuldade visual.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL exibir um Overlay_Escuro sobre a Imagem_Background
2. THE Overlay_Escuro SHALL ter opacidade entre 40% e 60% (bg-black/40 a bg-black/60)
3. THE Overlay_Escuro SHALL cobrir toda a área da Imagem_Background
4. THE Overlay_Escuro SHALL garantir contraste mínimo de 4.5:1 entre texto do card e o fundo visível

### Requisito 3: Card do Formulário com Fundo Sólido

**User Story:** Como usuário, eu quero que o formulário de login esteja em um card com fundo sólido, para ter boa legibilidade dos campos e botões.

#### Critérios de Aceitação

1. THE Card_Formulário SHALL ter fundo sólido branco ou cinza claro (bg-white ou bg-gray-50)
2. THE Card_Formulário SHALL ter bordas arredondadas (rounded-xl ou rounded-2xl)
3. THE Card_Formulário SHALL ter sombra para destacar do fundo (shadow-lg ou shadow-xl)
4. THE Card_Formulário SHALL ter padding adequado (p-6 a p-8)
5. THE Card_Formulário SHALL conter o logo FreteGO, título "Entrar", campos de telefone e senha, botão de submit e link de cadastro

### Requisito 4: Layout Responsivo Desktop

**User Story:** Como usuário em desktop, eu quero que o card de login esteja centralizado sobre a imagem de fundo, para ter uma experiência visual equilibrada.

#### Critérios de Aceitação

1. WHILE a largura da tela é maior ou igual ao Breakpoint_Desktop, THE Card_Formulário SHALL estar centralizado horizontal e verticalmente na viewport
2. WHILE a largura da tela é maior ou igual ao Breakpoint_Desktop, THE Card_Formulário SHALL ter largura máxima de 400-450px
3. WHILE a largura da tela é maior ou igual ao Breakpoint_Desktop, THE Imagem_Background SHALL ser visível ao redor do card

### Requisito 5: Layout Responsivo Mobile

**User Story:** Como usuário em dispositivo móvel, eu quero que a página de login seja usável e visualmente agradável, para conseguir fazer login facilmente em telas menores.

#### Critérios de Aceitação

1. WHILE a largura da tela é menor que o Breakpoint_Mobile, THE Card_Formulário SHALL ocupar largura total com margens laterais mínimas (mx-4)
2. WHILE a largura da tela é menor que o Breakpoint_Mobile, THE Imagem_Background SHALL ser visível como fundo do card (através do overlay)
3. WHILE a largura da tela é menor que o Breakpoint_Mobile, THE Card_Formulário SHALL ter fundo semi-transparente (bg-white/95 ou bg-white/90) para mostrar a imagem por trás
4. WHILE a largura da tela é menor que o Breakpoint_Mobile, THE Sistema_FreteGO SHALL manter todos os elementos do formulário acessíveis e usáveis

### Requisito 6: Preservação de Funcionalidade do Formulário

**User Story:** Como usuário, eu quero que todas as funcionalidades de login continuem funcionando após o redesign, para não perder a capacidade de autenticação.

#### Critérios de Aceitação

1. WHILE o redesign é aplicado, THE Formulário_Login SHALL manter validação de telefone (10-11 dígitos)
2. WHILE o redesign é aplicado, THE Formulário_Login SHALL manter validação de senha obrigatória
3. WHILE o redesign é aplicado, THE Formulário_Login SHALL manter formatação automática do telefone
4. WHILE o redesign é aplicado, THE Formulário_Login SHALL manter proteção honeypot contra bots
5. WHILE o redesign é aplicado, THE Formulário_Login SHALL manter exibição de erros de validação e autenticação
6. WHILE o redesign é aplicado, THE Formulário_Login SHALL manter estado de loading durante submit
7. WHILE o redesign é aplicado, THE Formulário_Login SHALL manter link para página de cadastro funcional

### Requisito 7: Consistência com Tema Light

**User Story:** Como usuário, eu quero que a página de login siga o tema light do sistema, para ter consistência visual com as demais páginas.

#### Critérios de Aceitação

1. THE Card_Formulário SHALL usar cores de texto escuro (text-gray-800, text-gray-700) conforme tema light
2. THE Card_Formulário SHALL usar inputs com fundo branco e borda gray-300 conforme tema light
3. THE Card_Formulário SHALL manter botão primário azul (bg-blue-600) com texto branco
4. THE Card_Formulário SHALL usar labels em text-gray-700 conforme tema light
5. WHEN um erro é exibido, THE Formulário_Login SHALL usar estilo light mode (bg-red-50, border-red-200, text-red-700)

### Requisito 8: Acessibilidade

**User Story:** Como usuário, eu quero que a página de login seja acessível, para conseguir usar independente de limitações visuais ou de dispositivo.

#### Critérios de Aceitação

1. THE Sistema_FreteGO SHALL garantir contraste mínimo de 4.5:1 em todos os textos do Card_Formulário
2. THE Sistema_FreteGO SHALL manter indicadores de foco visíveis (ring-blue-500) em todos os elementos interativos
3. THE Imagem_Background SHALL ter atributo alt descritivo ou role="presentation" se decorativa
4. THE Formulário_Login SHALL manter labels associados aos inputs para leitores de tela
