# Plano de Implementação: Login Redesign

## Visão Geral

Redesign da página de login do FreteGO para incluir imagem de fundo temática, overlay semi-transparente e card centralizado com formulário. A implementação segue a estratégia de refatorar o LoginForm para conter apenas o card e mover o layout para LoginPage.

## Tarefas

- [ ] 1. Preparação de assets
  - [ ] 1.1 Adicionar imagem de fundo para a página de login
    - Obter/criar imagem temática de caminhão/estrada (1920x1080px mínimo)
    - Otimizar imagem (WebP ou JPG comprimido, máx 300KB)
    - Salvar em public/login-bg.jpg
    - _Requisitos: 1.1, 1.2, 1.3_

- [ ] 2. Refatorar LoginForm.tsx
  - [ ] 2.1 Remover layout externo do LoginForm
    - Remover div wrapper com min-h-screen e bg-gray-950
    - Remover seção de marketing (lado esquerdo)
    - Manter apenas o card do formulário como elemento raiz
    - _Requisitos: 3.1, 3.2, 3.3, 3.4_

  - [ ] 2.2 Aplicar estilos light mode no card
    - Alterar fundo do card para bg-white (desktop) e bg-white/95 (mobile)
    - Adicionar rounded-2xl e shadow-xl
    - Alterar padding para p-8
    - Definir max-w-md e w-full
    - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 2.3 Adicionar logo FreteGO no card
    - Adicionar título "FreteGO" em text-blue-500 centralizado
    - Posicionar acima do título "Entrar"
    - _Requisitos: 3.5_

  - [ ] 2.4 Atualizar estilos de texto para tema light
    - Título "Entrar": text-gray-800
    - Labels: text-gray-700
    - Textos secundários: text-gray-600
    - _Requisitos: 7.1, 7.4_

  - [ ] 2.5 Atualizar estilos de inputs para tema light
    - Fundo: bg-white
    - Borda: border-gray-300
    - Texto: text-gray-800
    - Placeholder: placeholder-gray-400
    - Focus: ring-blue-500 (mantido)
    - _Requisitos: 7.2_

  - [ ] 2.6 Atualizar estilos de erro para tema light
    - Container: bg-red-50 border-red-200
    - Texto: text-red-700
    - _Requisitos: 7.5_

  - [ ] 2.7 Atualizar link de cadastro
    - Cor: text-blue-600 hover:text-blue-700
    - _Requisitos: 7.3_

- [ ] 3. Checkpoint - Validar refatoração do LoginForm
  - Verificar que o card renderiza corretamente isolado
  - Verificar que todas as funcionalidades do formulário funcionam
  - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [ ] 4. Atualizar LoginPage.tsx
  - [ ] 4.1 Criar estrutura com imagem de fundo
    - Adicionar wrapper com min-h-screen e position relative
    - Adicionar img com absolute inset-0, object-cover
    - Adicionar role="presentation" ou alt descritivo
    - _Requisitos: 1.1, 1.2, 8.3_

  - [ ] 4.2 Adicionar overlay semi-transparente
    - Adicionar div com absolute inset-0 e bg-black/50
    - Posicionar entre imagem e conteúdo
    - _Requisitos: 2.1, 2.2, 2.3_

  - [ ] 4.3 Implementar container centralizado
    - Adicionar div com relative, min-h-screen, flex, items-center, justify-center
    - Adicionar padding p-4 para espaçamento
    - _Requisitos: 4.1, 4.2_

  - [ ] 4.4 Implementar fallback para erro de imagem
    - Adicionar estado para controlar erro de carregamento
    - Exibir fundo sólido bg-gray-200 se imagem falhar
    - _Requisitos: 1.4_

- [ ] 5. Implementar responsividade
  - [ ] 5.1 Ajustar card para mobile
    - Mobile: bg-white/95 para semi-transparência
    - Mobile: w-full com mx-4 para margens
    - Desktop: bg-white sólido
    - Desktop: max-w-md centralizado
    - Usar classes condicionais md:bg-white bg-white/95
    - _Requisitos: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4_

- [ ] 6. Checkpoint - Validar layout completo
  - Testar em viewport desktop (>= 768px)
  - Testar em viewport mobile (< 768px)
  - Verificar que imagem de fundo aparece corretamente
  - Verificar que overlay está visível
  - Verificar centralização do card
  - _Requisitos: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4_

- [ ] 7. Validação de funcionalidades
  - [ ] 7.1 Testar fluxo de login completo
    - Verificar validação de telefone (10-11 dígitos)
    - Verificar validação de senha obrigatória
    - Verificar formatação automática do telefone
    - Verificar exibição de erros
    - Verificar estado de loading
    - Verificar redirecionamento após login
    - _Requisitos: 6.1, 6.2, 6.3, 6.5, 6.6_

  - [ ] 7.2 Testar proteção honeypot
    - Verificar que campo honeypot está presente e oculto
    - _Requisitos: 6.4_

  - [ ] 7.3 Testar navegação para cadastro
    - Verificar que link "Não tem conta? Cadastre-se" funciona
    - _Requisitos: 6.7_

- [ ] 8. Validação de acessibilidade
  - [ ] 8.1 Verificar contraste de cores
    - Validar contraste >= 4.5:1 em todos os textos do card
    - Usar ferramenta de contraste (WebAIM ou similar)
    - _Requisitos: 2.4, 8.1_

  - [ ] 8.2 Verificar indicadores de foco
    - Testar navegação por teclado (Tab)
    - Verificar que ring-blue-500 está visível em todos os elementos
    - _Requisitos: 8.2_

  - [ ] 8.3 Verificar atributos de acessibilidade
    - Verificar que imagem tem role="presentation" ou alt
    - Verificar que labels estão associados aos inputs
    - _Requisitos: 8.3, 8.4_

- [ ] 9. Checkpoint final
  - Executar testes existentes para garantir não-regressão
  - Verificar que não há erros no console
  - Validar em diferentes navegadores (Chrome, Firefox, Safari)
  - _Requisitos: 6.1-6.7, 8.1-8.4_

## Notas

- A imagem de fundo pode ser temporariamente uma URL do Unsplash durante desenvolvimento
- O overlay com bg-black/50 (50% opacidade) é um bom ponto de partida, ajustar se necessário
- A semi-transparência do card em mobile (bg-white/95) permite ver a imagem por trás
- Manter todas as funcionalidades existentes do formulário é crítico
- Testar em dispositivos reais se possível para validar responsividade
