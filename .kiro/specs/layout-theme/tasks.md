# Plano de Implementação: Layout/Theme (Dark → Light Mode)

## Visão Geral

Migração do tema visual do FreteGO de dark mode para light mode, seguindo a estratégia em camadas definida no design: configuração base → componentes de layout → componentes de UI → estados e alertas.

## Tarefas

- [x] 1. Configuração base do tema
  - [x] 1.1 Atualizar tailwind.config.js com paleta de cores light mode
    - Adicionar cores customizadas para fundos claros (gray-50, gray-100)
    - Manter cores de destaque (blue-500, blue-600, green-400, green-600, red-400, yellow-400)
    - Definir cores de texto escuro (gray-700, gray-800, gray-900)
    - _Requisitos: 1.1, 1.2, 1.3_

  - [x] 1.2 Atualizar src/index.css com estilos globais light mode
    - Alterar background-color do :root para cinza claro (#f5f5f5)
    - Alterar color do :root para texto escuro (gray-800)
    - Remover color-scheme: light dark
    - _Requisitos: 2.1, 2.2, 2.3_

- [ ] 2. Checkpoint - Validar configuração base
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Migrar componentes de layout
  - [x] 3.1 Migrar AppHeader.tsx para light mode
    - Substituir bg-gray-900/950 por bg-white
    - Adicionar border-b border-gray-200
    - Substituir text-white por text-gray-800 nos itens de navegação
    - Manter text-blue-500 no logo FreteGO
    - Atualizar dropdown menu para bg-white com border-gray-200
    - _Requisitos: 4.1, 4.2, 4.3, 4.4_

  - [x] 3.2 Migrar HomePage.tsx para light mode
    - Substituir bg-gray-950 por bg-gray-100
    - Substituir text-white por text-gray-800 nos títulos
    - Substituir text-gray-400 por text-gray-600 nos textos secundários
    - Atualizar botões secundários para bg-gray-200 text-gray-800
    - Atualizar cards vazios para bg-white border-gray-200
    - _Requisitos: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.3 Migrar EmbarcadorPage.tsx para light mode
    - Aplicar mesmas substituições de cores da HomePage
    - Atualizar stats cards para bg-white border-gray-200
    - Atualizar modal de formulário para bg-white
    - _Requisitos: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.4 Migrar demais páginas para light mode
    - LoginPage.tsx, RegisterPage.tsx
    - EmbarcadorPerfilPage.tsx, EmbarcadorPlanPage.tsx
    - MotoristaPerfilPage.tsx, MotoristaPlanPage.tsx
    - ConfiguracoesPage.tsx, AdminPage.tsx
    - SecurityDashboardPage.tsx, HoneypotPage.tsx
    - _Requisitos: 3.1, 3.2, 3.3, 3.4_

- [ ] 4. Checkpoint - Validar migração de layout
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Migrar componentes de UI (Cards e Modais)
  - [x] 5.1 Migrar FreteCard.tsx para light mode
    - Substituir bg-gray-900 por bg-white
    - Substituir border-gray-800 por border-gray-200
    - Adicionar shadow-sm para profundidade
    - Atualizar cores de texto
    - _Requisitos: 3.2, 3.3, 3.4_

  - [x] 5.2 Migrar FreteModal.tsx para light mode
    - Substituir bg-gray-900 por bg-white
    - Manter backdrop bg-black/75
    - Atualizar seções internas para bg-gray-50
    - _Requisitos: 6.1, 6.2, 6.3_

  - [x] 5.3 Migrar ChatWidget.tsx para light mode
    - Atualizar container e mensagens para cores claras
    - _Requisitos: 3.2, 6.1_

- [ ] 6. Migrar componentes de UI (Formulários)
  - [x] 6.1 Migrar FreteForm.tsx para light mode
    - Substituir bg-gray-800 por bg-gray-50 nas seções
    - Substituir bg-gray-700 por bg-white nos inputs/selects
    - Substituir border-gray-600/700 por border-gray-300
    - Substituir text-white por text-gray-800
    - Substituir text-gray-400 por text-gray-700 nos labels
    - Substituir placeholder-gray-500 por placeholder-gray-400
    - Manter ring-blue-500 no focus
    - _Requisitos: 5.1, 5.2, 5.3, 5.4_

  - [ ] 6.2 Migrar LoginForm.tsx para light mode
    - Atualizar container principal e formulário
    - Atualizar inputs e labels
    - _Requisitos: 5.1, 5.2, 5.3, 5.4_

  - [ ] 6.3 Migrar RegisterForm.tsx para light mode
    - Aplicar mesmas substituições do LoginForm
    - _Requisitos: 5.1, 5.2, 5.3, 5.4_

  - [x] 6.4 Migrar FreteFilters.tsx para light mode
    - Atualizar selects e inputs de filtro
    - _Requisitos: 5.1, 5.2, 5.3, 5.4_

  - [ ] 6.5 Migrar FreteCalculator.tsx para light mode
    - Atualizar inputs e resultados
    - _Requisitos: 5.1, 5.2, 5.3, 5.4_

  - [ ] 6.6 Migrar DocumentUpload.tsx para light mode
    - Atualizar área de upload e lista de documentos
    - _Requisitos: 5.1, 5.2_

  - [ ] 6.7 Migrar RatingForm.tsx para light mode
    - Atualizar formulário de avaliação
    - _Requisitos: 5.1, 5.2, 5.3, 5.4_

- [ ] 7. Checkpoint - Validar migração de formulários
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Migrar componentes de UI (Demais)
  - [ ] 8.1 Migrar NotificationBell.tsx para light mode
    - Atualizar dropdown de notificações
    - _Requisitos: 3.2, 6.1_

  - [ ] 8.2 Migrar RatingDisplay.tsx para light mode
    - Atualizar exibição de avaliações
    - _Requisitos: 3.3, 3.4_

  - [ ] 8.3 Migrar TripSuggestion.tsx para light mode
    - Atualizar cards de sugestão
    - _Requisitos: 3.2, 3.3_

  - [ ] 8.4 Migrar InteractiveMap.tsx para light mode
    - Atualizar controles e popups do mapa
    - _Requisitos: 3.2_

  - [ ] 8.5 Migrar ErrorBoundary.tsx para light mode
    - Atualizar tela de erro
    - _Requisitos: 8.1_

- [ ] 9. Migrar estados e alertas
  - [ ] 9.1 Atualizar alertas de erro em todos os componentes
    - Substituir bg-red-900/50 por bg-red-50
    - Substituir border-red-700 por border-red-200
    - Substituir text-red-200/300 por text-red-700
    - _Requisitos: 8.1_

  - [ ] 9.2 Atualizar alertas de sucesso em todos os componentes
    - Substituir bg-green-900/50 por bg-green-50
    - Substituir border-green-700 por border-green-200
    - Substituir text-green-200/300 por text-green-700
    - _Requisitos: 8.2_

  - [ ] 9.3 Atualizar alertas de aviso em todos os componentes
    - Substituir bg-yellow-900/50 por bg-yellow-50
    - Substituir border-yellow-700 por border-yellow-200
    - Substituir text-yellow-200/300 por text-yellow-700
    - _Requisitos: 8.3_

  - [ ] 9.4 Atualizar status badges em todos os componentes
    - Adaptar cores para contraste adequado no tema light
    - Ex: bg-green-100 text-green-700 border-green-300 para status ativo
    - _Requisitos: 8.4_

  - [ ] 9.5 Atualizar botões secundários e desabilitados
    - Secundários: bg-gray-200 text-gray-800 hover:bg-gray-300
    - Desabilitados: bg-gray-300 text-gray-500
    - Manter botões primários (blue) e sucesso (green) com texto branco
    - _Requisitos: 7.1, 7.2, 7.3, 7.4_

- [ ] 10. Checkpoint - Validar migração de estados
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Validação e testes
  - [ ]* 11.1 Criar teste de propriedade para contraste de cores
    - Implementar calculateContrastRatio()
    - Validar que todas as combinações texto/fundo têm ratio >= 4.5:1
    - **Property 1: Contraste de Texto Adequado**
    - **Valida: Requisitos 10.1**

  - [ ]* 11.2 Criar smoke tests para configuração
    - Verificar que tailwind.config.js contém cores esperadas
    - Verificar que index.css define estilos corretos
    - _Requisitos: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

  - [ ]* 11.3 Criar testes de exemplo para componentes
    - Verificar que componentes renderizam com classes light mode
    - Verificar indicadores de foco visíveis
    - _Requisitos: 10.2, 10.3_

- [ ] 12. Checkpoint final - Validação completa
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que todas as funcionalidades de navegação funcionam
  - Verificar que todos os formulários funcionam
  - Verificar responsividade em todos os breakpoints
  - _Requisitos: 9.1, 9.2, 9.3, 9.4_

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada tarefa referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Cores de destaque (blue, green, red, yellow) são preservadas
- Focus rings (ring-blue-500) são mantidos para acessibilidade
- Backdrop de modais (bg-black/75) é mantido para destaque
