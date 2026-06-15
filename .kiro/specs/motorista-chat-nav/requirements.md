# Requirements Document

## Introduction

Esta feature adiciona um acesso visível e permanente ao chat do motorista na barra
de navegação inferior (`MotoristaBottomNav`). Hoje o motorista consegue iniciar uma
conversa com um embarcador a partir de um frete, mas não há um ponto de entrada fixo
para voltar à lista de conversas e continuar uma conversa existente — o acesso só
ocorre via notificação ou link de frete. Isso faz com que o motorista "perca" a
conversa depois de enviar uma mensagem.

A solução introduz um ícone de Chat na bottom nav do motorista, posicionado entre
"Início" e "Mapa", que navega para a tela de mensagens existente (`MensagensPage`,
rota `/mensagens`). O ícone exibe um badge de notificação cuja contagem representa o
número de CONVERSAS com mensagens não lidas (não o número de mensagens). O badge
atualiza em tempo real e é zerado/decrementado conforme o motorista lê as conversas.

O escopo é restrito ao app do MOTORISTA. A `MotoristaBottomNav` é exclusiva do
motorista; embarcador e admin não são afetados.

## Glossary

- **Bottom_Nav**: O componente `MotoristaBottomNav`, barra de navegação inferior
  flutuante exibida apenas para usuários do tipo motorista.
- **Chat_Slot**: O novo item/ícone de Chat adicionado à `Bottom_Nav`, posicionado
  entre os itens "Início" e "Mapa".
- **Mensagens_Page**: A tela existente de mensagens do motorista (`MensagensPage`),
  acessível pela rota `/mensagens`, que lista as conversas e permite abrir cada uma.
- **Conversation**: Uma conversa de frete entre o motorista e um embarcador,
  representada por um registro em `conversations`.
- **Unread_Conversation**: Uma `Conversation` que possui ao menos uma mensagem cujo
  remetente não é o motorista e cujo `read_at` é nulo (mensagem não lida pelo motorista).
- **Conversation_Badge_Count**: A quantidade de `Unread_Conversation` distintas do
  motorista. É o valor exibido no badge do `Chat_Slot`.
- **Chat_Badge**: O indicador visual sobreposto ao `Chat_Slot` que comunica a
  existência e a quantidade (`Conversation_Badge_Count`) de conversas não lidas.
- **Chat_Service**: O serviço `src/services/chatFrete.ts`, responsável pelos dados
  de conversas e mensagens do chat de frete.
- **Unread_Count_Event**: O evento global de janela `fretego-chat-unread-count`,
  já existente, usado para propagar atualizações de contagem de não lidas.
- **Realtime_Channel**: A inscrição em tempo real do Supabase em `INSERT`/`UPDATE`
  da tabela `messages`, já utilizada pelo projeto.
- **Motorista**: Usuário autenticado cujo `userType` é `motorista`.

## Requirements

### Requirement 1: Posicionamento do ícone de Chat na bottom nav

**User Story:** Como motorista, quero ver um ícone de Chat na barra de navegação
inferior entre "Início" e "Mapa", para ter um acesso fixo e visível às minhas conversas.

#### Acceptance Criteria

1. WHERE o usuário autenticado é um Motorista, THE Bottom_Nav SHALL exibir o Chat_Slot como um item de navegação com ícone e rótulo "Chat".
2. THE Bottom_Nav SHALL posicionar o Chat_Slot imediatamente após o item "Início" e imediatamente antes do item "Mapa".
3. THE Bottom_Nav SHALL exibir os itens na ordem: "Início", "Chat", "Mapa", "ANTT", "Marketplace", "Menu".
4. THE Bottom_Nav SHALL distribuir os 6 itens em uma única linha horizontal sem sobreposição entre os itens.
5. THE Chat_Slot SHALL apresentar um rótulo de acessibilidade em pt-BR que identifica o item como acesso ao chat.
6. WHILE a rota atual é `/mensagens`, THE Bottom_Nav SHALL aplicar ao Chat_Slot o estado visual de item ativo usado pelos demais itens.

### Requirement 2: Navegação para a tela de mensagens

**User Story:** Como motorista, quero tocar no ícone de Chat e ir para a lista de
conversas, para abrir e continuar qualquer conversa existente.

#### Acceptance Criteria

1. WHEN o Motorista toca no Chat_Slot, THE Bottom_Nav SHALL navegar para a rota `/mensagens`.
2. WHEN a Mensagens_Page é exibida, THE Mensagens_Page SHALL listar as Conversations do Motorista ordenadas pela conversa atualizada mais recentemente primeiro.
3. WHEN o Motorista seleciona uma Conversation na lista, THE Mensagens_Page SHALL abrir o histórico de mensagens daquela Conversation.
4. WHILE a rota atual já é `/mensagens`, WHEN o Motorista toca no Chat_Slot, THE Bottom_Nav SHALL manter o Motorista na Mensagens_Page sem recarregar a aplicação.

### Requirement 3: Contagem do badge por conversa (não por mensagem)

**User Story:** Como motorista, quero que o badge do Chat mostre quantas conversas
têm mensagens novas, para entender quantos contatos diferentes estão me aguardando.

#### Acceptance Criteria

1. THE Chat_Service SHALL fornecer um método que retorna o Conversation_Badge_Count do Motorista, definido como o número de Unread_Conversation distintas.
2. WHEN um único embarcador envia múltiplas mensagens não lidas em uma mesma Conversation, THE Chat_Badge SHALL contabilizar essa Conversation como 1 no Conversation_Badge_Count.
3. WHEN N embarcadores distintos possuem mensagens não lidas em N Conversations distintas, THE Chat_Badge SHALL exibir o valor N no Conversation_Badge_Count.
4. WHILE o Conversation_Badge_Count é maior que zero, THE Chat_Badge SHALL exibir o valor do Conversation_Badge_Count sobreposto ao Chat_Slot.
5. WHERE o Conversation_Badge_Count excede 9, THE Chat_Badge SHALL exibir o texto "9+".
6. THE Conversation_Badge_Count SHALL considerar como não lida somente a mensagem cujo remetente não é o Motorista e cujo `read_at` é nulo.

### Requirement 4: Contagem de mensagens não lidas dentro da conversa

**User Story:** Como motorista, quero ver dentro da tela de mensagens quantas
mensagens não lidas cada conversa tem, para saber o volume de cada contato.

#### Acceptance Criteria

1. WHILE uma Conversation possui mensagens não lidas pelo Motorista, THE Mensagens_Page SHALL exibir, no item da lista daquela Conversation, a quantidade de mensagens não lidas daquela Conversation específica.
2. THE Mensagens_Page SHALL calcular a quantidade exibida no item da lista como o número de mensagens daquela Conversation cujo remetente não é o Motorista e cujo `read_at` é nulo.
3. IF uma Conversation não possui mensagens não lidas pelo Motorista, THEN THE Mensagens_Page SHALL omitir o contador de não lidas no item daquela Conversation.

### Requirement 5: Atualização do badge em tempo real

**User Story:** Como motorista, quero que o badge do Chat atualize sozinho quando
chega mensagem nova, para não precisar recarregar o app.

#### Acceptance Criteria

1. WHEN uma nova mensagem cujo remetente não é o Motorista é inserida em uma Conversation que não estava em estado não lido, THE Chat_Badge SHALL incrementar o Conversation_Badge_Count em 1 sem recarregar a aplicação.
2. WHEN uma nova mensagem cujo remetente não é o Motorista é inserida em uma Conversation que já estava em estado não lido, THE Chat_Badge SHALL manter o Conversation_Badge_Count inalterado.
3. WHEN o Unread_Count_Event é disparado com um novo valor de conversas não lidas, THE Chat_Badge SHALL refletir o valor recebido.
4. THE Chat_Badge SHALL atualizar o Conversation_Badge_Count usando o Realtime_Channel já existente, sem introduzir polling periódico.
5. WHEN o Motorista abre uma Unread_Conversation e suas mensagens são marcadas como lidas, THE Chat_Badge SHALL decrementar o Conversation_Badge_Count em 1.
6. WHEN a ação de marcar mensagens como lidas zera todas as Unread_Conversation do Motorista, THE Chat_Badge SHALL exibir o Chat_Slot sem badge.

### Requirement 6: Estado sem conversas ou sem não lidas

**User Story:** Como motorista, quero que o ícone de Chat fique limpo quando não há
mensagens novas, para não receber alertas falsos.

#### Acceptance Criteria

1. WHILE o Motorista não possui nenhuma Unread_Conversation, THE Chat_Badge SHALL exibir o Chat_Slot sem badge.
2. WHILE o Motorista não possui nenhuma Conversation, THE Chat_Badge SHALL exibir o Chat_Slot sem badge.
3. IF o cálculo do Conversation_Badge_Count falha por erro de rede ou serviço, THEN THE Chat_Badge SHALL exibir o Chat_Slot sem badge e SHALL preservar a navegação do Chat_Slot para `/mensagens`.

### Requirement 7: Restrição de escopo ao app do motorista

**User Story:** Como product owner, quero que o ícone de Chat exista apenas no app do
motorista, para não impactar embarcador e admin.

#### Acceptance Criteria

1. WHERE o usuário autenticado não é um Motorista, THE Bottom_Nav SHALL não ser renderizada e, consequentemente, não exibir o Chat_Slot.
2. THE Chat_Slot SHALL consultar o Conversation_Badge_Count somente para o identificador do Motorista autenticado.
3. THE Conversation_Badge_Count SHALL considerar apenas Conversations nas quais o Motorista autenticado é participante.
