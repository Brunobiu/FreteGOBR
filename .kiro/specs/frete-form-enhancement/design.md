# Documento de Design - Frete Form Enhancement

## Visão Geral

Este documento descreve a arquitetura técnica para implementar o aprimoramento do formulário de fretes do FreteGO, adicionando campos detalhados de carga, veículos categorizados, carrocerias e dados de pagamento.

## Arquitetura

### Arquivos Modificados

```
src/components/
├── FreteForm.tsx           # Componente principal (refatorado)
src/services/
├── fretes.ts               # Atualizar interfaces de dados
src/types/
├── index.ts                # Adicionar novos tipos
```

### Novos Arquivos

```
src/components/
├── VehicleSelector.tsx     # Seletor categorizado de veículos
├── BodyTypeSelector.tsx    # Seletor categorizado de carrocerias
├── PaymentSection.tsx      # Seção de dados de pagamento
```

## Tipos e Interfaces

### Novos Tipos em `src/types/index.ts`

```typescript
// Tipos de Carga
export type CargoType = 
  | 'carga_geral'
  | 'granel_pressurizada'
  | 'conteinerizada'
  | 'frigorificada'
  | 'neogranel'
  | 'perigosa';

// Espécies de Carga
export type CargoSpecies = 
  | 'animais'
  | 'big_bag'
  | 'bobina'
  | 'caixas'
  | 'container'
  | 'diversos'
  | 'fardos'
  | 'granel'
  | 'madeira'
  | 'pallets'
  | 'sacas'
  | 'tambores'
  | 'veiculos';

// Unidade de Medida
export type WeightUnit = 'toneladas' | 'quilos';

// Tipo de Frete
export type FreightType = 'completa' | 'complemento';

// Categorias de Veículos
export type VehicleCategory = 'leves' | 'medios' | 'pesados';

export interface VehicleOption {
  value: string;
  label: string;
  category: VehicleCategory;
}

// Categorias de Carrocerias
export type BodyTypeCategory = 'fechada' | 'aberta' | 'especial';

export interface BodyTypeOption {
  value: string;
  label: string;
  category: BodyTypeCategory;
}

// Forma de Cálculo do Valor
export type PriceCalculation = 'por_tonelada' | 'por_km' | 'valor_fechado';

// Formas de Pagamento
export type PaymentMethod = 'adiantamento' | 'saldo_entrega' | 'a_vista' | 'faturado';

// Opções Adicionais
export interface AdditionalOptions {
  lona: boolean;
  rastreador: boolean;
  seguro: boolean;
}

// Dados de Pagamento
export interface PaymentData {
  knowsValue: boolean;
  value?: number;
  priceCalculation?: PriceCalculation;
  paymentMethods: PaymentMethod[];
  advancePercentage?: number;
  invoiceDays?: number;
}

// Dimensões da Carga
export interface CargoDimensions {
  length?: number;  // comprimento em metros
  width?: number;   // largura em metros
  height?: number;  // altura em metros
}

// Dados Completos do Frete (Enhanced)
export interface EnhancedFreteData {
  // Localização (existente)
  origin: string;
  originLocation: GeographicPoint;
  destination: string;
  destinationLocation: GeographicPoint;
  
  // Carga (novo)
  cargoType: CargoType;
  cargoSpecies: CargoSpecies;
  product: string;
  onuNumber?: string;        // para carga perigosa
  temperature?: number;       // para frigorificada
  
  // Peso e Volume (novo)
  weightUnit: WeightUnit;
  totalWeight: number;
  volumes?: number;
  cubedWeight?: number;
  cubicMeters?: number;
  dimensions?: CargoDimensions;
  
  // Tipo de Frete (novo)
  freightType: FreightType;
  occupancyPercentage?: number;  // para complemento
  
  // Veículos e Carrocerias (aprimorado)
  vehicles: string[];
  bodyTypes: string[];
  
  // Opções Adicionais (novo)
  additionalOptions: AdditionalOptions;
  
  // Pagamento (novo)
  payment: PaymentData;
  
  // Agendamento (existente)
  loadingTime: number;
  unloadingTime: number;
  
  // Especificações (existente)
  specifications?: string;
}
```

## Constantes de Dados

### Veículos Categorizados

```typescript
export const VEHICLE_OPTIONS: VehicleOption[] = [
  // Leves
  { value: 'vuc', label: 'VUC', category: 'leves' },
  { value: '3_4', label: '3/4', category: 'leves' },
  { value: 'toco', label: 'Toco', category: 'leves' },
  // Médios
  { value: 'truck', label: 'Truck', category: 'medios' },
  { value: 'bitruck', label: 'Bitruck', category: 'medios' },
  // Pesados
  { value: 'carreta', label: 'Carreta', category: 'pesados' },
  { value: 'bitrem', label: 'Bitrem', category: 'pesados' },
  { value: 'rodotrem', label: 'Rodotrem', category: 'pesados' },
  { value: 'vanderleia', label: 'Vanderleia', category: 'pesados' },
];

export const VEHICLE_CATEGORIES = {
  leves: { label: 'Leves', vehicles: ['vuc', '3_4', 'toco'] },
  medios: { label: 'Médios', vehicles: ['truck', 'bitruck'] },
  pesados: { label: 'Pesados', vehicles: ['carreta', 'bitrem', 'rodotrem', 'vanderleia'] },
};
```

### Carrocerias Categorizadas

```typescript
export const BODY_TYPE_OPTIONS: BodyTypeOption[] = [
  // Fechada
  { value: 'bau', label: 'Baú', category: 'fechada' },
  { value: 'bau_frigorifico', label: 'Baú Frigorífico', category: 'fechada' },
  { value: 'sider', label: 'Sider', category: 'fechada' },
  // Aberta
  { value: 'grade_baixa', label: 'Grade Baixa', category: 'aberta' },
  { value: 'graneleiro', label: 'Graneleiro', category: 'aberta' },
  { value: 'cacamba', label: 'Caçamba', category: 'aberta' },
  // Especial
  { value: 'tanque', label: 'Tanque', category: 'especial' },
  { value: 'cegonha', label: 'Cegonha', category: 'especial' },
  { value: 'prancha', label: 'Prancha', category: 'especial' },
];

export const BODY_TYPE_CATEGORIES = {
  fechada: { label: 'Fechada', types: ['bau', 'bau_frigorifico', 'sider'] },
  aberta: { label: 'Aberta', types: ['grade_baixa', 'graneleiro', 'cacamba'] },
  especial: { label: 'Especial', types: ['tanque', 'cegonha', 'prancha'] },
};
```

### Tipos de Carga e Espécies

```typescript
export const CARGO_TYPES = [
  { value: 'carga_geral', label: 'Carga Geral' },
  { value: 'granel_pressurizada', label: 'Granel Pressurizada' },
  { value: 'conteinerizada', label: 'Conteinerizada' },
  { value: 'frigorificada', label: 'Frigorificada' },
  { value: 'neogranel', label: 'Neogranel' },
  { value: 'perigosa', label: 'Perigosa' },
];

export const CARGO_SPECIES = [
  { value: 'animais', label: 'Animais' },
  { value: 'big_bag', label: 'Big Bag' },
  { value: 'bobina', label: 'Bobina' },
  { value: 'caixas', label: 'Caixas' },
  { value: 'container', label: 'Container' },
  { value: 'diversos', label: 'Diversos' },
  { value: 'fardos', label: 'Fardos' },
  { value: 'granel', label: 'Granel' },
  { value: 'madeira', label: 'Madeira' },
  { value: 'pallets', label: 'Pallets' },
  { value: 'sacas', label: 'Sacas' },
  { value: 'tambores', label: 'Tambores' },
  { value: 'veiculos', label: 'Veículos' },
];
```

## Design dos Componentes

### 1. VehicleSelector

```typescript
interface VehicleSelectorProps {
  selectedVehicles: string[];
  onChange: (vehicles: string[]) => void;
  error?: string;
}
```

Responsabilidades:
- Exibir veículos organizados por categoria (Leves, Médios, Pesados)
- Permitir seleção/desseleção individual
- Permitir seleção/desseleção de categoria inteira
- Indicar visualmente itens selecionados
- Exibir contador de selecionados

### 2. BodyTypeSelector

```typescript
interface BodyTypeSelectorProps {
  selectedBodyTypes: string[];
  onChange: (bodyTypes: string[]) => void;
  error?: string;
}
```

Responsabilidades:
- Exibir carrocerias organizadas por categoria (Fechada, Aberta, Especial)
- Permitir seleção/desseleção individual
- Permitir seleção/desseleção de categoria inteira
- Indicar visualmente itens selecionados

### 3. PaymentSection

```typescript
interface PaymentSectionProps {
  payment: PaymentData;
  onChange: (payment: PaymentData) => void;
  errors?: Record<string, string>;
}
```

Responsabilidades:
- Gerenciar toggle "Já sei o valor" / "A combinar"
- Exibir campo de valor condicionalmente
- Exibir opções de forma de cálculo
- Gerenciar checkboxes de formas de pagamento
- Exibir campos condicionais (% adiantamento, prazo faturamento)

## Estrutura do FreteForm Refatorado

```typescript
interface FreteFormProps {
  embarcadorId: string;
  onSubmit: (data: EnhancedFreteData) => Promise<void>;
  onCancel?: () => void;
  initialData?: EnhancedFreteData;
  mode?: 'create' | 'edit';
}

// Estado interno do formulário
interface FormState {
  // Localização
  origemUF: string;
  origemCidade: string;
  destinoUF: string;
  destinoCidade: string;
  
  // Carga
  cargoType: CargoType | '';
  cargoSpecies: CargoSpecies | '';
  product: string;
  onuNumber: string;
  temperature: string;
  
  // Peso e Volume
  weightUnit: WeightUnit;
  totalWeight: string;
  volumes: string;
  cubedWeight: string;
  cubicMeters: string;
  dimensionLength: string;
  dimensionWidth: string;
  dimensionHeight: string;
  
  // Tipo de Frete
  freightType: FreightType;
  occupancyPercentage: string;
  
  // Veículos e Carrocerias
  selectedVehicles: string[];
  selectedBodyTypes: string[];
  
  // Opções Adicionais
  lona: boolean;
  rastreador: boolean;
  seguro: boolean;
  
  // Pagamento
  knowsValue: boolean;
  value: string;
  priceCalculation: PriceCalculation;
  paymentMethods: PaymentMethod[];
  advancePercentage: string;
  invoiceDays: string;
  
  // Agendamento
  agendamentoCarga: string;
  agendamentoDescarga: string;
  
  // Especificações
  specifications: string;
}
```

## Layout do Formulário

```
┌─────────────────────────────────────────────────────────┐
│ SEÇÃO 1: ORIGEM E DESTINO                               │
│ ┌─────────────────────┐ ┌─────────────────────┐        │
│ │ Origem (UF/Cidade)  │ │ Destino (UF/Cidade) │        │
│ └─────────────────────┘ └─────────────────────┘        │
├─────────────────────────────────────────────────────────┤
│ SEÇÃO 2: DADOS DA CARGA                                 │
│ ┌───────────────┐ ┌───────────────┐                    │
│ │ Tipo de Carga │ │ Espécie       │                    │
│ └───────────────┘ └───────────────┘                    │
│ ┌─────────────────────────────────┐                    │
│ │ Produto (nome/descrição)        │                    │
│ └─────────────────────────────────┘                    │
│ [Campos condicionais: ONU / Temperatura]               │
├─────────────────────────────────────────────────────────┤
│ SEÇÃO 3: PESO E VOLUME                                  │
│ ○ Por toneladas  ○ Por quilos                          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│ │Peso total│ │ Volumes  │ │Peso cubado│ │    m³    │   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│ Dimensões: ┌────┐ x ┌────┐ x ┌────┐                    │
│            │ C  │   │ L  │   │ A  │                    │
│            └────┘   └────┘   └────┘                    │
├─────────────────────────────────────────────────────────┤
│ SEÇÃO 4: TIPO DE FRETE                                  │
│ ○ Completa (carga completa)  ○ Complemento (parcial)   │
│ [Campo condicional: % ocupação]                        │
├─────────────────────────────────────────────────────────┤
│ SEÇÃO 5: VEÍCULOS ACEITOS                               │
│ ┌─────────────────────────────────────────────────┐    │
│ │ [✓] LEVES: VUC, 3/4, Toco                       │    │
│ │ [ ] MÉDIOS: Truck, Bitruck                      │    │
│ │ [✓] PESADOS: Carreta, Bitrem, Rodotrem, Vanderleia│  │
│ └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│ SEÇÃO 6: CARROCERIAS ACEITAS                            │
│ ┌─────────────────────────────────────────────────┐    │
│ │ [✓] FECHADA: Baú, Baú Frigorífico, Sider        │    │
│ │ [ ] ABERTA: Grade Baixa, Graneleiro, Caçamba    │    │
│ │ [ ] ESPECIAL: Tanque, Cegonha, Prancha          │    │
│ └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│ SEÇÃO 7: OPÇÕES ADICIONAIS                              │
│ ☐ Lona    ☐ Rastreador    ☐ Seguro                     │
├─────────────────────────────────────────────────────────┤
│ SEÇÃO 8: PAGAMENTO                                      │
│ ○ Já sei o valor  ○ A combinar                         │
│ [Se "Já sei o valor":]                                 │
│ ┌──────────────┐  ○ Por tonelada ○ Por km ○ Fechado   │
│ │ R$ 0,00      │                                       │
│ └──────────────┘                                       │
│ Formas de pagamento:                                   │
│ ☐ Adiantamento [___%]  ☐ Saldo na entrega             │
│ ☐ À vista              ☐ Faturado [___ dias]          │
├─────────────────────────────────────────────────────────┤
│ SEÇÃO 9: AGENDAMENTO                                    │
│ ┌──────────────┐ ┌──────────────┐                      │
│ │ Carga: D0    │ │ Descarga: D0 │                      │
│ └──────────────┘ └──────────────┘                      │
├─────────────────────────────────────────────────────────┤
│ SEÇÃO 10: ESPECIFICAÇÕES ADICIONAIS                     │
│ ┌─────────────────────────────────────────────────┐    │
│ │ [textarea]                                       │    │
│ └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│                    [Cancelar]  [Publicar Frete]        │
└─────────────────────────────────────────────────────────┘
```

## Atualização do Serviço de Fretes

### Interface CreateFreteData Atualizada

```typescript
export interface CreateFreteData {
  embarcadorId: string;
  origin: string;
  originLocation: GeographicPoint;
  destination: string;
  destinationLocation: GeographicPoint;
  
  // Carga
  cargoType: string;
  cargoSpecies: string;
  product: string;
  onuNumber?: string;
  temperature?: number;
  
  // Peso e Volume
  weightUnit: string;
  weight: number;
  volumes?: number;
  cubedWeight?: number;
  cubicMeters?: number;
  dimensionLength?: number;
  dimensionWidth?: number;
  dimensionHeight?: number;
  
  // Tipo de Frete
  freightType: string;
  occupancyPercentage?: number;
  
  // Veículos e Carrocerias
  vehicleType: string;  // JSON array ou comma-separated
  bodyTypes: string;    // JSON array ou comma-separated
  
  // Opções Adicionais
  requiresLona: boolean;
  requiresTracker: boolean;
  requiresInsurance: boolean;
  
  // Pagamento
  valueKnown: boolean;
  value: number;
  priceCalculation?: string;
  paymentMethods: string;  // JSON array
  advancePercentage?: number;
  invoiceDays?: number;
  
  // Agendamento
  loadingTime: number;
  unloadingTime: number;
  deadline: Date;
  
  specifications?: string;
}
```

## Migração do Banco de Dados

Novos campos necessários na tabela `fretes`:

```sql
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS cargo_species VARCHAR(50);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS product VARCHAR(255);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS onu_number VARCHAR(20);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS temperature DECIMAL(5,2);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS weight_unit VARCHAR(20) DEFAULT 'toneladas';
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS volumes INTEGER;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS cubed_weight DECIMAL(10,2);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS cubic_meters DECIMAL(10,2);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS dimension_length DECIMAL(6,2);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS dimension_width DECIMAL(6,2);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS dimension_height DECIMAL(6,2);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS freight_type VARCHAR(20) DEFAULT 'completa';
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS occupancy_percentage INTEGER;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS body_types TEXT;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS requires_lona BOOLEAN DEFAULT FALSE;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS requires_tracker BOOLEAN DEFAULT FALSE;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS requires_insurance BOOLEAN DEFAULT FALSE;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS value_known BOOLEAN DEFAULT FALSE;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS price_calculation VARCHAR(20);
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS payment_methods TEXT;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS advance_percentage INTEGER;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS invoice_days INTEGER;
```

## Propriedades de Corretude

### Propriedade 1: Validação de Campos Obrigatórios
- PARA TODOS os campos obrigatórios, o formulário NÃO DEVE permitir submissão se estiverem vazios
- Campos obrigatórios: origem, destino, cargoType, cargoSpecies, product, totalWeight, vehicles, bodyTypes, paymentMethods

### Propriedade 2: Campos Condicionais
- QUANDO cargoType = 'perigosa', campo onuNumber DEVE ser exibido e obrigatório
- QUANDO cargoType = 'frigorificada', campo temperature DEVE ser exibido
- QUANDO freightType = 'complemento', campo occupancyPercentage DEVE ser exibido
- QUANDO knowsValue = true, campos value e priceCalculation DEVEM ser exibidos
- QUANDO paymentMethods inclui 'adiantamento', campo advancePercentage DEVE ser exibido
- QUANDO paymentMethods inclui 'faturado', campo invoiceDays DEVE ser exibido

### Propriedade 3: Seleção de Categoria
- QUANDO clicar no nome da categoria de veículos, TODOS os veículos daquela categoria DEVEM ser selecionados/desselecionados
- QUANDO clicar no nome da categoria de carrocerias, TODAS as carrocerias daquela categoria DEVEM ser selecionadas/desselecionadas

### Propriedade 4: Consistência de Unidade
- QUANDO weightUnit mudar, os labels dos campos de peso DEVEM refletir a unidade selecionada
- O valor numérico NÃO DEVE ser convertido automaticamente

### Propriedade 5: Valores Numéricos
- TODOS os campos numéricos DEVEM aceitar apenas valores >= 0
- Campos de peso, volume e valor DEVEM aceitar decimais

## Casos de Borda

1. Carga perigosa sem número ONU: Bloquear submissão
2. Valor informado como zero quando "Já sei o valor": Exibir aviso
3. Nenhum veículo selecionado: Bloquear submissão
4. Nenhuma carroceria selecionada: Bloquear submissão
5. Adiantamento 100%: Permitir (pagamento total antecipado)
6. Dimensões parciais: Permitir (nem todas obrigatórias)

## Acessibilidade

- Labels associados a todos os inputs via `htmlFor`
- Campos obrigatórios marcados com `aria-required="true"`
- Mensagens de erro associadas via `aria-describedby`
- Grupos de radio/checkbox com `role="group"` e `aria-labelledby`
- Navegação por teclado em seletores de categoria
- Contraste adequado para indicadores de seleção
