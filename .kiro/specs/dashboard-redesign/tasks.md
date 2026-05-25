# Tarefas de Implementação - Dashboard Redesign

## Tarefa 1: Criar Hooks de Suporte

- [x] 1.1 Criar hook `useViewPreference` em `src/hooks/useViewPreference.ts`
  - Gerenciar estado de visualização (cards/table)
  - Persistir preferência no localStorage
  - Retornar [viewMode, setViewMode]
- [x] 1.2 Criar hook `useIsMobile` em `src/hooks/useIsMobile.ts`
  - Detectar largura da tela < 768px
  - Atualizar em resize
  - Retornar boolean

## Tarefa 2: Criar Componente ViewToggle

- [x] 2.1 Criar `src/components/ViewToggle.tsx`
  - Props: currentView, onViewChange
  - Dois botões com ícones (grid para cards, list para tabela)
  - Estilo visual indicando modo ativo
  - Classes Tailwind consistentes com design system

## Tarefa 3: Criar Componente TablePagination

- [x] 3.1 Criar `src/components/TablePagination.tsx`
  - Props: currentPage, totalPages, totalItems, itemsPerPage, onPageChange
  - Botões Anterior/Próxima com estado disabled
  - Exibir "Página X de Y" e "Total: N itens"
  - Navegação por números de página (máximo 5 visíveis)

## Tarefa 4: Criar Componente FreteTable

- [x] 4.1 Criar `src/components/FreteTableRow.tsx`
  - Props: frete, onView, onEdit?, onDelete?, showActions
  - Renderizar células: origem, destino, cargoType, vehicleType, status, deadline
  - Formatar data em pt-BR
  - Aplicar cores de status
  - Botões de ação condicionais
- [x] 4.2 Criar `src/components/FreteTable.tsx`
  - Props: fretes, isLoading, onFreteClick, onEdit?, onDelete?, showActions?
  - Cabeçalho com colunas clicáveis para ordenação
  - Indicador visual de ordenação (seta)
  - Estado interno: sortConfig, currentPage
  - Integrar TablePagination (10 itens/página)
  - Estado vazio: "Nenhum frete encontrado"
  - Estado loading: skeleton ou spinner

## Tarefa 5: Atualizar HomePage

- [x] 5.1 Integrar hooks useViewPreference e useIsMobile
  - Chave localStorage: 'fretego-view-preference-home'
  - Forçar cards quando isMobile
- [x] 5.2 Adicionar ViewToggle no header
  - Ocultar quando isMobile
  - Posicionar ao lado do botão "Ver mapa"
- [x] 5.3 Renderização condicional cards/tabela
  - Manter FreteFilters acima de ambos
  - Passar mesmos dados para ambas visualizações
  - FreteTable sem ações de editar/excluir (showActions=false)

## Tarefa 6: Atualizar EmbarcadorPage

- [x] 6.1 Integrar hooks useViewPreference e useIsMobile
  - Chave localStorage: 'fretego-view-preference-embarcador'
  - Forçar cards quando isMobile
- [x] 6.2 Adicionar ViewToggle no header
  - Ocultar quando isMobile
  - Posicionar ao lado do botão "Postar Frete"
- [x] 6.3 Renderização condicional cards/tabela
  - FreteTable com showActions=true
  - Passar handlers onEdit e onDelete
- [x] 6.4 Implementar estado e modal de edição
  - Estado: editingFrete: Frete | null
  - Abrir FreteForm com dados do frete ao clicar "Editar"
  - Chamar updateFrete ao salvar

## Tarefa 7: Atualizar FreteForm para Suportar Edição

- [x] 7.1 Adicionar props initialData e mode ao FreteForm
  - initialData?: Frete
  - mode?: 'create' | 'edit' (default: 'create')
- [x] 7.2 Preencher campos com initialData quando mode='edit'
  - Usar useEffect para popular estado inicial
- [x] 7.3 Ajustar texto do botão submit
  - 'create': "Publicar Frete"
  - 'edit': "Salvar Alterações"
- [x] 7.4 Chamar updateFrete ao invés de createFrete quando mode='edit'

## Tarefa 8: Adicionar Filtros à EmbarcadorPage

- [x] 8.1 Integrar FreteFilters na EmbarcadorPage
  - Posicionar acima da lista/tabela
  - Filtrar fretes localmente (já carregados)
- [x] 8.2 Manter filtros ao alternar visualização
  - Estado de filtros no componente pai
  - Passar fretes filtrados para cards e tabela

## Tarefa 9: Testes e Validação

- [x] 9.1 Testar alternância de visualização
  - Verificar persistência no localStorage
  - Verificar transição suave
- [x] 9.2 Testar responsividade
  - Verificar comportamento em < 768px
  - Verificar restauração de preferência em >= 768px
- [x] 9.3 Testar ordenação da tabela
  - Verificar todas as colunas ordenáveis
  - Verificar inversão de direção
- [x] 9.4 Testar paginação
  - Verificar navegação entre páginas
  - Verificar reset ao aplicar filtros
- [x] 9.5 Testar ações do embarcador
  - Verificar edição de frete
  - Verificar exclusão com confirmação
