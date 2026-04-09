# Documento de Design - Dashboard Redesign

## Visão Geral

Este documento descreve a arquitetura técnica para implementar o redesign do dashboard do FreteGO, adicionando visualização em tabela como alternativa aos cards existentes.

## Arquitetura

### Novos Componentes

```
src/components/
├── FreteTable.tsx          # Componente principal da tabela
├── FreteTableRow.tsx       # Linha individual da tabela
├── ViewToggle.tsx          # Botão de alternância cards/tabela
└── TablePagination.tsx     # Controles de paginação
```

### Páginas Modificadas

```
src/pages/
├── HomePage.tsx            # Adicionar toggle e tabela para motoristas
└── EmbarcadorPage.tsx      # Adicionar toggle, tabela e ações de edição
```

## Design dos Componentes

### 1. ViewToggle

```typescript
interface ViewToggleProps {
  currentView: 'cards' | 'table';
  onViewChange: (view: 'cards' | 'table') => void;
}
```

Responsabilidades:
- Renderizar botões de alternância com ícones
- Indicar visualmente o modo ativo
- Chamar callback ao trocar modo

### 2. FreteTable

```typescript
interface FreteTableProps {
  fretes: Frete[];
  isLoading: boolean;
  onFreteClick: (frete: Frete) => void;
  onEdit?: (frete: Frete) => void;      // Apenas para embarcador
  onDelete?: (freteId: string) => void; // Apenas para embarcador
  showActions?: boolean;                 // Controla exibição de editar/excluir
}

interface SortConfig {
  column: keyof Frete | null;
  direction: 'asc' | 'desc';
}
```

Responsabilidades:
- Renderizar tabela com colunas: Origem, Destino, Tipo de Carga, Veículo, Status, Data, Ações
- Gerenciar ordenação por coluna
- Gerenciar paginação interna (10 itens/página)
- Aplicar estilos de status (cores)
- Renderizar ações condicionais

### 3. FreteTableRow

```typescript
interface FreteTableRowProps {
  frete: Frete;
  onView: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  showActions: boolean;
}
```

Responsabilidades:
- Renderizar uma linha da tabela
- Formatar dados (data, status)
- Renderizar botões de ação

### 4. TablePagination

```typescript
interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}
```

Responsabilidades:
- Exibir navegação de páginas
- Exibir informações de paginação
- Gerenciar estado de botões (disabled)

## Fluxo de Dados

```
┌─────────────────────────────────────────────────────────┐
│                    HomePage/EmbarcadorPage              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ State:                                           │   │
│  │ - fretes: Frete[]                               │   │
│  │ - viewMode: 'cards' | 'table'                   │   │
│  │ - selectedFrete: Frete | null                   │   │
│  │ - editingFrete: Frete | null (embarcador only)  │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│         ┌────────────────┼────────────────┐            │
│         ▼                ▼                ▼            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ ViewToggle  │  │FreteFilters │  │ FreteTable  │    │
│  │             │  │  (existing) │  │ or Cards    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                           │            │
│                          ┌────────────────┼────────┐   │
│                          ▼                ▼        ▼   │
│                   ┌───────────┐    ┌─────────┐ ┌─────┐│
│                   │FreteModal │    │FreteForm│ │Delete│
│                   │ (details) │    │ (edit)  │ │Confirm│
│                   └───────────┘    └─────────┘ └─────┘│
└─────────────────────────────────────────────────────────┘
```

## Persistência de Preferências

```typescript
// Hook para gerenciar preferência de visualização
function useViewPreference(key: string): [ViewMode, (mode: ViewMode) => void] {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(key);
    return (saved as ViewMode) || 'cards';
  });

  const updateViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(key, mode);
  };

  return [viewMode, updateViewMode];
}
```

## Responsividade

```typescript
// Hook para detectar mobile
function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}
```

Lógica de exibição:
- Mobile (< 768px): Sempre cards, toggle oculto
- Desktop (>= 768px): Respeita preferência do usuário

## Estilos da Tabela

```typescript
// Cores de status
const statusStyles = {
  ativo: 'bg-green-900/50 text-green-300',
  encerrado: 'bg-gray-700/50 text-gray-300',
  cancelado: 'bg-red-900/50 text-red-300',
};

// Classes Tailwind da tabela
const tableClasses = {
  table: 'w-full bg-gray-900 border border-gray-800 rounded-lg overflow-hidden',
  header: 'bg-gray-800 text-gray-300 text-xs uppercase tracking-wider',
  headerCell: 'px-4 py-3 text-left cursor-pointer hover:bg-gray-700',
  row: 'border-t border-gray-800 hover:bg-gray-800/50 transition-colors',
  cell: 'px-4 py-3 text-sm text-white',
  actionButton: 'px-2 py-1 text-xs rounded transition-colors',
};
```

## Modificações no FreteForm

Para suportar edição, o FreteForm precisa aceitar dados iniciais:

```typescript
interface FreteFormProps {
  embarcadorId: string;
  onSubmit: (data: CreateFreteData | UpdateFreteData) => Promise<void>;
  onCancel: () => void;
  initialData?: Frete;  // NOVO: dados para edição
  mode?: 'create' | 'edit';  // NOVO: modo do formulário
}
```

## Propriedades de Corretude

### Propriedade 1: Consistência de Dados entre Visualizações
- PARA TODOS os fretes exibidos, os dados na tabela DEVEM ser idênticos aos dados nos cards
- Verificar: origem, destino, tipo de carga, veículo, status, data

### Propriedade 2: Persistência de Filtros
- QUANDO alternar entre cards e tabela, os filtros aplicados DEVEM permanecer ativos
- O número de resultados DEVE ser o mesmo em ambas visualizações

### Propriedade 3: Ordenação Estável
- PARA QUALQUER coluna ordenável, ordenar ASC e depois DESC DEVE retornar a ordem inversa exata
- Ordenar pela mesma coluna duas vezes DEVE inverter a direção

### Propriedade 4: Paginação Correta
- PARA QUALQUER lista de N fretes com P itens por página, o total de páginas DEVE ser ceil(N/P)
- A soma de itens em todas as páginas DEVE ser igual a N

### Propriedade 5: Responsividade Automática
- QUANDO largura < 768px, visualização DEVE ser cards independente da preferência salva
- QUANDO largura >= 768px, visualização DEVE respeitar preferência do localStorage

## Casos de Borda

1. Lista vazia: Exibir mensagem "Nenhum frete encontrado"
2. Erro de carregamento: Exibir mensagem de erro com opção de retry
3. Frete excluído durante visualização: Atualizar lista automaticamente
4. Mudança de tamanho de tela durante uso: Transição suave entre modos
5. localStorage indisponível: Usar 'cards' como padrão

## Acessibilidade

- Tabela com `role="table"` e headers com `scope="col"`
- Botões de ação com `aria-label` descritivo
- Indicadores de ordenação com `aria-sort`
- Navegação por teclado na paginação
- Contraste adequado para cores de status
