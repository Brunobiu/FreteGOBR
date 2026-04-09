# Documento de Requisitos - Frete Form Enhancement

## Introdução

Aprimoramento do formulário de criação de fretes (FreteForm) do FreteGO para incluir campos detalhados conforme especificação do cliente. O objetivo é capturar informações completas sobre tipo de carga, espécie, peso/volume, tipo de frete, opções adicionais, seleção categorizada de veículos, carrocerias e dados de pagamento.

## Glossário

- **FreteForm**: Componente React de formulário para criação/edição de fretes
- **Sistema**: Aplicação FreteGO (React + TypeScript + Supabase)
- **Embarcador**: Usuário que publica fretes na plataforma
- **Tipo_de_Carga**: Classificação principal da carga (Geral, Granel, Perigosa, etc.)
- **Espécie**: Formato físico da carga (Pallets, Sacas, Container, etc.)
- **Tipo_de_Frete**: Modalidade de ocupação do veículo (Completa ou Complemento)
- **Carroceria**: Tipo de carroceria do veículo (Baú, Sider, Graneleiro, etc.)
- **Peso_Cubado**: Peso calculado baseado no volume da carga

## Requisitos

### Requisito 1: Seleção de Tipo de Carga

**User Story:** Como embarcador, eu quero selecionar o tipo de carga de uma lista padronizada, para que motoristas entendam a natureza da carga.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir dropdown de Tipo de Carga com as opções: Carga Geral, Granel Pressurizada, Conteinerizada, Frigorificada, Neogranel, Perigosa
2. WHEN o embarcador selecionar "Perigosa", THE Sistema SHALL exibir campo adicional para número ONU
3. WHEN o embarcador selecionar "Frigorificada", THE Sistema SHALL exibir campo para temperatura requerida
4. THE Sistema SHALL validar que Tipo de Carga foi selecionado antes de permitir submissão

### Requisito 2: Seleção de Espécie da Carga

**User Story:** Como embarcador, eu quero especificar a espécie/formato da carga, para que motoristas saibam como a carga será acondicionada.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir dropdown de Espécie com as opções: Animais, Big Bag, Bobina, Caixas, Container, Diversos, Fardos, Granel, Madeira, Pallets, Sacas, Tambores, Veículos
2. THE Sistema SHALL permitir seleção de apenas uma espécie por frete
3. THE Sistema SHALL validar que Espécie foi selecionada antes de permitir submissão

### Requisito 3: Unidade de Medida de Peso

**User Story:** Como embarcador, eu quero escolher a unidade de medida do peso, para que eu possa informar o peso na unidade mais conveniente.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir opções de rádio para Unidade de Medida: "Por toneladas" e "Por quilos"
2. THE Sistema SHALL usar "Por toneladas" como valor padrão
3. WHEN o embarcador alterar a unidade, THE Sistema SHALL atualizar os labels dos campos de peso correspondentemente

### Requisito 4: Campos de Peso e Volume

**User Story:** Como embarcador, eu quero informar detalhes de peso e volume da carga, para que motoristas possam avaliar a compatibilidade com seus veículos.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir campo de texto para "Produto" (nome/descrição da carga)
2. THE FreteForm SHALL exibir campo numérico para "Peso total" com sufixo da unidade selecionada
3. THE FreteForm SHALL exibir campo numérico para "Volumes" (quantidade de volumes)
4. THE FreteForm SHALL exibir campo numérico para "Peso Cubado"
5. THE FreteForm SHALL exibir campo numérico para "Metragem cúbica" (m³)
6. THE FreteForm SHALL exibir campos de dimensões: Comprimento, Largura e Altura (em metros)
7. THE Sistema SHALL validar que Peso total é maior que zero
8. THE Sistema SHALL aceitar valores decimais nos campos numéricos

### Requisito 5: Tipo de Frete

**User Story:** Como embarcador, eu quero indicar se o frete é carga completa ou complemento, para que motoristas saibam a disponibilidade de espaço.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir opções de rádio para Tipo de Frete: "Completa" (carga completa) e "Complemento" (carga parcial)
2. THE Sistema SHALL usar "Completa" como valor padrão
3. WHEN o embarcador selecionar "Complemento", THE Sistema SHALL exibir campo para percentual de ocupação estimado

### Requisito 6: Opções Adicionais

**User Story:** Como embarcador, eu quero especificar requisitos adicionais do frete, para que motoristas saibam os equipamentos necessários.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir checkbox para "Lona" (necessidade de lona)
2. THE FreteForm SHALL exibir checkbox para "Rastreador" (necessidade de rastreador)
3. THE FreteForm SHALL exibir checkbox para "Seguro" (necessidade de seguro adicional)
4. THE Sistema SHALL permitir seleção múltipla das opções adicionais
5. THE Sistema SHALL usar "não selecionado" como valor padrão para todas as opções

### Requisito 7: Seleção Categorizada de Veículos

**User Story:** Como embarcador, eu quero selecionar veículos por categoria, para que eu possa escolher facilmente os tipos adequados à minha carga.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir veículos organizados em três categorias: Leves, Médios e Pesados
2. THE FreteForm SHALL incluir na categoria Leves: VUC, 3/4, Toco
3. THE FreteForm SHALL incluir na categoria Médios: Truck, Bitruck
4. THE FreteForm SHALL incluir na categoria Pesados: Carreta, Bitrem, Rodotrem, Vanderleia
5. THE Sistema SHALL permitir seleção múltipla de veículos
6. THE Sistema SHALL validar que pelo menos um veículo foi selecionado
7. WHEN o embarcador clicar no nome da categoria, THE Sistema SHALL selecionar/desselecionar todos os veículos daquela categoria

### Requisito 8: Seleção de Carrocerias

**User Story:** Como embarcador, eu quero especificar os tipos de carroceria aceitos, para que motoristas com veículos compatíveis possam se candidatar.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir carrocerias organizadas em três categorias: Fechada, Aberta e Especial
2. THE FreteForm SHALL incluir na categoria Fechada: Baú, Baú Frigorífico, Sider
3. THE FreteForm SHALL incluir na categoria Aberta: Grade Baixa, Graneleiro, Caçamba
4. THE FreteForm SHALL incluir na categoria Especial: Tanque, Cegonha, Prancha
5. THE Sistema SHALL permitir seleção múltipla de carrocerias
6. THE Sistema SHALL validar que pelo menos uma carroceria foi selecionada
7. WHEN o embarcador clicar no nome da categoria, THE Sistema SHALL selecionar/desselecionar todas as carrocerias daquela categoria

### Requisito 9: Dados de Pagamento - Valor

**User Story:** Como embarcador, eu quero informar o valor do frete ou indicar que será negociado, para que motoristas saibam a expectativa de pagamento.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir opções de rádio: "Já sei o valor" e "A combinar"
2. WHEN o embarcador selecionar "Já sei o valor", THE Sistema SHALL exibir campo numérico para valor em Reais (R$)
3. WHEN o embarcador selecionar "Já sei o valor", THE Sistema SHALL exibir opções de forma de cálculo: "Por tonelada", "Por km", "Valor fechado"
4. THE Sistema SHALL validar que valor é maior que zero quando "Já sei o valor" estiver selecionado
5. THE Sistema SHALL usar "A combinar" como valor padrão

### Requisito 10: Dados de Pagamento - Forma de Pagamento

**User Story:** Como embarcador, eu quero especificar as formas de pagamento aceitas, para que motoristas saibam as condições financeiras.

#### Critérios de Aceitação

1. THE FreteForm SHALL exibir checkboxes para formas de pagamento: Adiantamento, Saldo na entrega, À vista, Faturado
2. THE Sistema SHALL permitir seleção múltipla de formas de pagamento
3. THE Sistema SHALL validar que pelo menos uma forma de pagamento foi selecionada
4. WHEN o embarcador selecionar "Adiantamento", THE Sistema SHALL exibir campo para percentual de adiantamento
5. WHEN o embarcador selecionar "Faturado", THE Sistema SHALL exibir campo para prazo de faturamento em dias

### Requisito 11: Validação e Submissão do Formulário

**User Story:** Como embarcador, eu quero que o sistema valide todos os campos obrigatórios, para que eu não publique fretes com informações incompletas.

#### Critérios de Aceitação

1. THE Sistema SHALL validar campos obrigatórios: Origem, Destino, Tipo de Carga, Espécie, Produto, Peso total, Veículos, Carrocerias, Forma de pagamento
2. IF algum campo obrigatório estiver vazio, THEN THE Sistema SHALL exibir mensagem de erro específica para cada campo
3. IF todos os campos obrigatórios estiverem preenchidos, THEN THE Sistema SHALL permitir submissão do formulário
4. WHEN o formulário for submetido com sucesso, THE Sistema SHALL exibir mensagem de confirmação
5. IF ocorrer erro na submissão, THEN THE Sistema SHALL exibir mensagem de erro e manter os dados preenchidos

### Requisito 12: Organização Visual do Formulário

**User Story:** Como embarcador, eu quero um formulário organizado em seções claras, para que eu possa preencher as informações de forma intuitiva.

#### Critérios de Aceitação

1. THE FreteForm SHALL organizar campos em seções: Origem/Destino, Carga, Peso e Volume, Veículos e Carrocerias, Pagamento, Opções Adicionais
2. THE FreteForm SHALL exibir indicador visual de campos obrigatórios (asterisco)
3. THE FreteForm SHALL manter consistência visual com o design system existente (Tailwind CSS, tema escuro)
4. THE FreteForm SHALL ser responsivo e funcionar adequadamente em dispositivos móveis
