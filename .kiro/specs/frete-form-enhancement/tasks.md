# Tarefas de Implementação - Frete Form Enhancement

## Tarefa 1: Atualizar Tipos e Constantes

- [ ] 1.1 Adicionar novos tipos em `src/types/index.ts`
  - CargoType, CargoSpecies, WeightUnit, FreightType
  - VehicleCategory, VehicleOption, BodyTypeCategory, BodyTypeOption
  - PriceCalculation, PaymentMethod, AdditionalOptions, PaymentData
  - CargoDimensions, EnhancedFreteData
- [ ] 1.2 Criar arquivo `src/constants/freteOptions.ts` com constantes
  - CARGO_TYPES, CARGO_SPECIES
  - VEHICLE_OPTIONS, VEHICLE_CATEGORIES
  - BODY_TYPE_OPTIONS, BODY_TYPE_CATEGORIES
  - PAYMENT_METHODS, PRICE_CALCULATIONS

## Tarefa 2: Criar Migração do Banco de Dados

- [ ] 2.1 Criar `supabase/migrations/006_frete_form_enhancement.sql`
  - Adicionar colunas: cargo_species, product, onu_number, temperature
  - Adicionar colunas: weight_unit, volumes, cubed_weight, cubic_meters
  - Adicionar colunas: dimension_length, dimension_width, dimension_height
  - Adicionar colunas: freight_type, occupancy_percentage, body_types
  - Adicionar colunas: requires_lona, requires_tracker, requires_insurance
  - Adicionar colunas: value_known, price_calculation, payment_methods
  - Adicionar colunas: advance_percentage, invoice_days

## Tarefa 3: Criar Componente VehicleSelector

- [ ] 3.1 Criar `src/components/VehicleSelector.tsx`
  - Props: selectedVehicles, onChange, error
  - Exibir veículos organizados por categoria (Leves, Médios, Pesados)
  - Implementar toggle de categoria (selecionar/desselecionar todos)
  - Estilização consistente com design system (Tailwind, tema escuro)
  - Exibir contador de veículos selecionados

## Tarefa 4: Criar Componente BodyTypeSelector

- [ ] 4.1 Criar `src/components/BodyTypeSelector.tsx`
  - Props: selectedBodyTypes, onChange, error
  - Exibir carrocerias organizadas por categoria (Fechada, Aberta, Especial)
  - Implementar toggle de categoria (selecionar/desselecionar todos)
  - Estilização consistente com design system

## Tarefa 5: Criar Componente PaymentSection

- [ ] 5.1 Criar `src/components/PaymentSection.tsx`
  - Props: payment (PaymentData), onChange, errors
  - Radio buttons: "Já sei o valor" / "A combinar"
  - Campo de valor (R$) condicional
  - Radio buttons de forma de cálculo condicional
  - Checkboxes de formas de pagamento
  - Campos condicionais: % adiantamento, prazo faturamento

## Tarefa 6: Refatorar FreteForm - Seção de Carga

- [ ] 6.1 Substituir dropdown de Tipo de Carga existente
  - Usar novos valores: Carga Geral, Granel Pressurizada, etc.
  - Adicionar campo condicional para número ONU (carga perigosa)
  - Adicionar campo condicional para temperatura (frigorificada)
- [ ] 6.2 Adicionar dropdown de Espécie
  - Animais, Big Bag, Bobina, Caixas, etc.
- [ ] 6.3 Adicionar campo de Produto (texto)

## Tarefa 7: Refatorar FreteForm - Seção de Peso e Volume

- [ ] 7.1 Adicionar radio buttons de Unidade de Medida
  - "Por toneladas" (padrão), "Por quilos"
- [ ] 7.2 Adicionar campos numéricos
  - Peso total (com sufixo dinâmico)
  - Volumes (quantidade)
  - Peso Cubado
  - Metragem cúbica (m³)
- [ ] 7.3 Adicionar campos de Dimensões
  - Comprimento, Largura, Altura (em metros)

## Tarefa 8: Refatorar FreteForm - Seção de Tipo de Frete

- [ ] 8.1 Adicionar radio buttons de Tipo de Frete
  - "Completa" (padrão), "Complemento"
- [ ] 8.2 Adicionar campo condicional de % ocupação
  - Exibir apenas quando "Complemento" selecionado

## Tarefa 9: Refatorar FreteForm - Seção de Veículos e Carrocerias

- [ ] 9.1 Substituir seleção de veículos existente por VehicleSelector
  - Remover lista plana atual
  - Integrar componente categorizado
- [ ] 9.2 Adicionar BodyTypeSelector
  - Posicionar abaixo de VehicleSelector

## Tarefa 10: Refatorar FreteForm - Seção de Opções Adicionais

- [ ] 10.1 Adicionar checkboxes de opções adicionais
  - Lona (sim/não)
  - Rastreador (sim/não)
  - Seguro (sim/não)

## Tarefa 11: Refatorar FreteForm - Seção de Pagamento

- [ ] 11.1 Integrar componente PaymentSection
  - Posicionar antes de Agendamento
  - Conectar estado do formulário

## Tarefa 12: Atualizar Validação do Formulário

- [ ] 12.1 Implementar validação de campos obrigatórios
  - Origem, Destino, Tipo de Carga, Espécie, Produto
  - Peso total, Veículos, Carrocerias, Forma de pagamento
- [ ] 12.2 Implementar validação de campos condicionais
  - ONU obrigatório para carga perigosa
  - Valor obrigatório quando "Já sei o valor"
- [ ] 12.3 Exibir mensagens de erro específicas por campo

## Tarefa 13: Atualizar Serviço de Fretes

- [ ] 13.1 Atualizar interface CreateFreteData em `src/services/fretes.ts`
  - Adicionar novos campos
- [ ] 13.2 Atualizar função createFrete
  - Mapear novos campos para colunas do banco
- [ ] 13.3 Atualizar função updateFrete
  - Suportar atualização dos novos campos
- [ ] 13.4 Atualizar função mapFreteFromDb
  - Mapear novas colunas para objeto Frete

## Tarefa 14: Atualizar Submissão do Formulário

- [ ] 14.1 Atualizar handleSubmit no FreteForm
  - Coletar todos os novos campos
  - Formatar dados para CreateFreteData
  - Tratar campos opcionais/condicionais

## Tarefa 15: Testes e Validação

- [ ] 15.1 Testar seleção de veículos por categoria
  - Verificar toggle de categoria
  - Verificar seleção individual
- [ ] 15.2 Testar seleção de carrocerias por categoria
  - Verificar toggle de categoria
  - Verificar seleção individual
- [ ] 15.3 Testar campos condicionais
  - ONU para carga perigosa
  - Temperatura para frigorificada
  - % ocupação para complemento
  - Campos de pagamento condicionais
- [ ] 15.4 Testar validação de formulário
  - Campos obrigatórios
  - Valores numéricos válidos
- [ ] 15.5 Testar submissão completa
  - Criar frete com todos os campos
  - Verificar persistência no banco
- [ ] 15.6 Testar responsividade mobile
  - Verificar layout em telas pequenas
  - Verificar usabilidade dos seletores
