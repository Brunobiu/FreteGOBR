# Requirements Document

## Introduction

Esta feature refina a tela de conversa de frete já existente (`src/pages/MensagensPage.tsx`,
service `src/services/chatFrete.ts`), inspirada na tela de chat do OLX. A funcionalidade de
chat (header com avatar/nome, bolhas de mensagem, tiquinhos de leitura, indicador "digitando…",
barra de input com texto + anexo + áudio + drag-and-drop) **já existe e NÃO deve ser
reconstruída**. O escopo aqui é principalmente de **design/UX** mais **uma nova regra de
negócio**: o gating da conversa conforme o frete esteja ativo ou inativo.

Os três focos são:

1. **Card do Frete (estilo OLX)**: promover a origem→destino — hoje uma linha minúscula dentro
   do cabeçalho — para um card destacado e visível logo abaixo do cabeçalho da conversa,
   análogo ao card do produto/anúncio no OLX.
2. **Selo de status Ativo/Desativado**: exibir, na mesma região do card, um selo visual verde
   (ativo) ou vermelho (inativo/encerrado/cancelado) indicando o estado do frete da conversa.
3. **Bloqueio do input quando inativo**: quando o frete não está mais ativo, substituir a barra
   de input por uma mensagem em pt-BR, mantendo o histórico visível mas impedindo digitar,
   enviar, anexar e gravar áudio — análogo ao comportamento do OLX para anúncios encerrados.

A tela `/mensagens` é **compartilhada entre motorista e embarcador**; todos os requisitos valem
para ambos os lados da conversa. Convenções do projeto: UI e mensagens em pt-BR; tema escuro via
`html[data-theme='dark']`; layout mobile-first.

## Glossary

- **Conversation_Screen**: a área de conversa ativa em `src/pages/MensagensPage.tsx` (seção
  direita / tela cheia no mobile) que exibe o cabeçalho, mensagens e barra de input de uma
  conversa selecionada.
- **Frete_Card**: novo card destacado exibido logo abaixo do cabeçalho da Conversation_Screen,
  contendo a origem→destino do frete vinculado à conversa e, quando disponível, informações
  adicionais do frete (ex: valor) e o Status_Badge.
- **Status_Badge**: selo/etiqueta visual que indica o estado do frete da conversa, com cor verde
  para frete ativo e vermelha para frete inativo.
- **Frete_Status**: o estado do frete vinculado à conversa, conforme o tipo `FreteStatus` do
  projeto, com os valores `'ativo'`, `'encerrado'` e `'cancelado'` (ver `src/services/fretes.ts`).
- **Frete_Ativo**: condição em que `Frete_Status === 'ativo'`.
- **Frete_Inativo**: condição em que `Frete_Status` é `'encerrado'` ou `'cancelado'`.
- **Status_Indisponivel**: condição em que não há `Frete_Status` recuperável para a conversa —
  por exemplo conversas de Frete Comunidade (source `'comunidade'`) ou conversas sem frete
  vinculado (`freteId === null`), ou quando a busca do status falha.
- **Input_Bar**: a barra inferior da Conversation_Screen, composta por campo de texto, botão de
  anexo (documento/foto) e botão de gravação de áudio (microfone).
- **Blocked_Notice**: a mensagem em pt-BR que substitui a Input_Bar quando o frete está inativo.
- **Message_History**: a lista de mensagens já trocadas na conversa, exibida na área rolável da
  Conversation_Screen.
- **Chat_Service**: o módulo de serviço `src/services/chatFrete.ts` responsável por carregar
  conversas, peer e mensagens.

## Requirements

### Requirement 1: Exibir o Frete_Card com origem e destino

**User Story:** Como usuário do chat (motorista ou embarcador), quero ver um card destacado com a
origem e o destino do frete da conversa, para identificar rapidamente sobre qual frete estamos
conversando.

#### Acceptance Criteria

1. WHEN uma conversa com frete vinculado é aberta na Conversation_Screen, THE Conversation_Screen SHALL exibir o Frete_Card logo abaixo do cabeçalho da conversa e acima da Message_History.
2. THE Frete_Card SHALL exibir a origem e o destino do frete no formato `origem → destino`.
3. WHERE o frete da conversa possui valor disponível, THE Frete_Card SHALL exibir o valor do frete.
4. WHEN o Frete_Card é exibido, THE Conversation_Screen SHALL remover a linha de origem→destino redundante do cabeçalho da conversa.
5. WHILE o tema escuro está ativo (`html[data-theme='dark']`), THE Frete_Card SHALL aplicar as cores do tema escuro.
6. THE Frete_Card SHALL ser renderizado em layout mobile-first legível em telas com largura inferior a 768px.

### Requirement 2: Exibir o Status_Badge conforme o estado do frete

**User Story:** Como usuário do chat, quero ver um selo indicando se o frete está ativo ou
desativado, para saber se ainda é possível negociar aquele frete.

#### Acceptance Criteria

1. WHEN uma conversa é aberta e o Frete_Status é recuperado, THE Frete_Card SHALL exibir o Status_Badge na mesma região da origem→destino.
2. WHILE o frete está em condição Frete_Ativo, THE Status_Badge SHALL ser exibido na cor verde com o texto `Ativo`.
3. WHILE o frete está em condição Frete_Inativo, THE Status_Badge SHALL ser exibido na cor vermelha com o texto `Desativado`.
4. THE Status_Badge SHALL ser exibido de forma idêntica para o motorista e para o embarcador da mesma conversa.
5. WHERE a condição Status_Indisponivel se aplica, THE Status_Badge SHALL ser omitido.

### Requirement 3: Recuperar o Frete_Status da conversa

**User Story:** Como usuário do chat, quero que o sistema saiba o estado atual do frete da
conversa, para que o selo e o bloqueio reflitam a realidade.

#### Acceptance Criteria

1. WHEN uma conversa com frete vinculado é aberta, THE Chat_Service SHALL recuperar o Frete_Status do frete vinculado à conversa.
2. WHEN o Frete_Status recuperado é igual a `'ativo'`, THE Conversation_Screen SHALL tratar a conversa como Frete_Ativo.
3. WHEN o Frete_Status recuperado é igual a `'encerrado'` ou `'cancelado'`, THE Conversation_Screen SHALL tratar a conversa como Frete_Inativo.
4. IF a conversa não possui frete vinculado (`freteId` nulo) OR a conversa é de origem `'comunidade'`, THEN THE Conversation_Screen SHALL tratar a conversa como Status_Indisponivel.
5. IF a recuperação do Frete_Status falha, THEN THE Conversation_Screen SHALL tratar a conversa como Status_Indisponivel.

### Requirement 4: Bloquear o input quando o frete está inativo

**User Story:** Como usuário do chat, quero que o envio de novas mensagens seja bloqueado quando o
frete não está mais ativo, para refletir que a negociação daquele frete foi encerrada.

#### Acceptance Criteria

1. WHILE a conversa está em condição Frete_Inativo, THE Conversation_Screen SHALL substituir a Input_Bar pelo Blocked_Notice.
2. WHILE a conversa está em condição Frete_Inativo, THE Conversation_Screen SHALL impedir a digitação de texto no campo de mensagem.
3. WHILE a conversa está em condição Frete_Inativo, THE Conversation_Screen SHALL impedir o envio de mensagens de texto.
4. WHILE a conversa está em condição Frete_Inativo, THE Conversation_Screen SHALL impedir o envio de anexos por botão e por drag-and-drop.
5. WHILE a conversa está em condição Frete_Inativo, THE Conversation_Screen SHALL impedir o início de gravação de áudio.
6. THE Blocked_Notice SHALL exibir o texto em pt-BR `Este frete não está mais ativo.`
7. THE bloqueio do input SHALL ser aplicado de forma idêntica para o motorista e para o embarcador da mesma conversa.

### Requirement 5: Preservar o histórico mesmo com a conversa bloqueada

**User Story:** Como usuário do chat, quero continuar lendo as mensagens já trocadas mesmo quando o
frete está inativo, para consultar o que foi combinado.

#### Acceptance Criteria

1. WHILE a conversa está em condição Frete_Inativo, THE Conversation_Screen SHALL exibir a Message_History completa.
2. WHILE a conversa está em condição Frete_Inativo, THE Conversation_Screen SHALL permitir a rolagem da Message_History.
3. WHILE a conversa está em condição Frete_Inativo, THE Conversation_Screen SHALL permitir abrir os anexos existentes nas mensagens.

### Requirement 6: Manter a barra de input funcional quando o frete está ativo

**User Story:** Como usuário do chat, quero usar a barra de input normalmente quando o frete está
ativo, para enviar texto, anexos e áudios como já faço hoje.

#### Acceptance Criteria

1. WHILE a conversa está em condição Frete_Ativo, THE Conversation_Screen SHALL exibir a Input_Bar com campo de texto, botão de anexo e botão de gravação de áudio.
2. WHILE a conversa está em condição Status_Indisponivel, THE Conversation_Screen SHALL exibir a Input_Bar habilitada.
3. WHILE a conversa está em condição Frete_Ativo, THE Conversation_Screen SHALL permitir digitar, enviar texto, enviar anexos e gravar áudio.

### Requirement 7: Atualizar selo e bloqueio quando o frete muda de estado

**User Story:** Como usuário do chat com a conversa aberta, quero que o selo e o bloqueio reflitam o
estado atual do frete, para não enviar mensagens em um frete recém-desativado.

#### Acceptance Criteria

1. WHEN a Conversation_Screen é aberta, THE Conversation_Screen SHALL recuperar o Frete_Status vigente e refleti-lo no Status_Badge e no estado da Input_Bar.
2. WHERE a atualização em tempo real do Frete_Status está habilitada, WHEN o Frete_Status muda de `'ativo'` para `'encerrado'` ou `'cancelado'` enquanto a conversa está aberta, THE Conversation_Screen SHALL atualizar o Status_Badge para vermelho e substituir a Input_Bar pelo Blocked_Notice.
