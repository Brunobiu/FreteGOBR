# Documento de Requisitos - Dashboard Redesign

## Introdução

Redesign do dashboard do FreteGO para adicionar visualização em tabela (estilo Cargill) como alternativa à visualização atual em cards. O objetivo é melhorar a experiência do usuário com uma visão mais compacta e profissional dos fretes, mantendo a flexibilidade de alternar entre modos de visualização.

## Glossário

- **Dashboard**: Página principal que exibe a lista de fretes (HomePage para motoristas, EmbarcadorPage para embarcadores)
- **FreteTable**: Novo componente de tabela para exibição de fretes
- **ViewToggle**: Componente para alternar entre visualização em cards e tabela
- **Sistema**: Aplicação FreteGO (React + TypeScript)
- **Embarcador**: Usuário que publica fretes
- **Motorista**: Usuário que visualiza e aceita fretes

## Requisitos

### Requisito 1: Alternância de Visualização

**User Story:** Como usuário, eu quero alternar entre visualização em cards e tabela, para que eu possa escolher o formato mais adequado às minhas necessidades.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir um botão de alternância entre modos "Cards" e "Tabela" no cabeçalho do dashboard
2. WHEN o usuário clicar no botão de alternância, THE Sistema SHALL trocar imediatamente o modo de visualização sem recarregar a página
3. THE Sistema SHALL persistir a preferência de visualização do usuário no localStorage
4. WHEN o usuário retornar ao dashboard, THE Sistema SHALL restaurar o último modo de visualização selecionado

### Requisito 2: Visualização em Tabela

**User Story:** Como usuário, eu quero visualizar fretes em formato de tabela, para que eu possa comparar múltiplos fretes de forma mais eficiente.

#### Critérios de Aceitação

1. THE FreteTable SHALL exibir as seguintes colunas: Origem, Destino, Tipo de Carga, Veículo, Status, Data, Ações
2. THE FreteTable SHALL ordenar os fretes por data de criação (mais recentes primeiro) por padrão
3. WHEN o usuário clicar no cabeçalho de uma coluna, THE FreteTable SHALL ordenar os dados por aquela coluna
4. THE FreteTable SHALL exibir indicador visual de ordenação ativa (seta para cima/baixo)
5. THE FreteTable SHALL aplicar cores diferenciadas para cada status (ativo: verde, encerrado: cinza, cancelado: vermelho)

### Requisito 3: Paginação da Tabela

**User Story:** Como usuário, eu quero navegar entre páginas de resultados, para que eu possa visualizar grandes quantidades de fretes de forma organizada.

#### Critérios de Aceitação

1. THE FreteTable SHALL exibir no máximo 10 fretes por página
2. THE FreteTable SHALL exibir controles de paginação abaixo da tabela (Anterior, números de página, Próxima)
3. THE FreteTable SHALL exibir o total de resultados e a página atual
4. WHEN o usuário aplicar filtros, THE FreteTable SHALL resetar para a primeira página
5. WHEN não houver fretes para exibir, THE FreteTable SHALL mostrar mensagem "Nenhum frete encontrado"

### Requisito 4: Ações na Linha da Tabela

**User Story:** Como usuário, eu quero executar ações diretamente na linha da tabela, para que eu possa gerenciar fretes de forma mais rápida.

#### Critérios de Aceitação

1. THE FreteTable SHALL exibir botão "Ver detalhes" em cada linha para todos os usuários
2. WHEN o usuário for embarcador visualizando seus próprios fretes, THE FreteTable SHALL exibir botões "Editar" e "Excluir" na coluna de ações
3. WHEN o usuário clicar em "Ver detalhes", THE Sistema SHALL abrir o modal FreteModal com informações completas do frete
4. WHEN o usuário clicar em "Editar", THE Sistema SHALL abrir o formulário de edição do frete
5. WHEN o usuário clicar em "Excluir", THE Sistema SHALL exibir confirmação antes de excluir o frete
6. IF o usuário confirmar exclusão, THEN THE Sistema SHALL remover o frete e atualizar a tabela

### Requisito 5: Filtros Integrados

**User Story:** Como usuário, eu quero filtrar fretes na visualização em tabela, para que eu possa encontrar fretes específicos rapidamente.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir o componente FreteFilters acima da tabela
2. WHEN filtros forem aplicados, THE FreteTable SHALL atualizar automaticamente os resultados
3. THE FreteTable SHALL manter os filtros ativos ao alternar entre visualização cards e tabela
4. THE Sistema SHALL exibir contador de filtros ativos e opção "Limpar filtros"

### Requisito 6: Responsividade Mobile

**User Story:** Como usuário mobile, eu quero uma experiência otimizada para telas pequenas, para que eu possa usar o sistema em qualquer dispositivo.

#### Critérios de Aceitação

1. WHILE a largura da tela for menor que 768px, THE Sistema SHALL exibir automaticamente a visualização em cards
2. WHILE a largura da tela for menor que 768px, THE Sistema SHALL ocultar o botão de alternância de visualização
3. WHEN a largura da tela mudar de mobile para desktop, THE Sistema SHALL restaurar a preferência de visualização do usuário
4. THE FreteCard SHALL manter o layout responsivo existente em dispositivos mobile

### Requisito 7: Edição de Frete (Embarcador)

**User Story:** Como embarcador, eu quero editar meus fretes existentes, para que eu possa corrigir informações ou atualizar dados.

#### Critérios de Aceitação

1. WHEN o embarcador clicar em "Editar" em um frete ativo, THE Sistema SHALL abrir o formulário FreteForm preenchido com os dados atuais
2. THE Sistema SHALL permitir edição de: origem, destino, tipo de carga, veículo, peso, valor, prazo, especificações
3. WHEN o embarcador salvar alterações, THE Sistema SHALL atualizar o frete e fechar o formulário
4. IF ocorrer erro na atualização, THEN THE Sistema SHALL exibir mensagem de erro e manter o formulário aberto
5. THE Sistema SHALL permitir edição apenas de fretes com status "ativo"
