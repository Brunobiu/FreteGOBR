# Requirements Document

## Introduction

Esta feature adiciona ao **lado do motorista** da tela de conversa de frete
(`src/pages/MensagensPage.tsx`) um botão **"Enviar documentos"**, posicionado à
esquerda do botão **WhatsApp** já existente, na mesma linha (layout dividido 50/50).
Ao clicar, abre-se um modal sobre a conversa com uma lista de **checkboxes** dos
documentos que o motorista **já enviou no próprio cadastro** (CNH, foto segurando
CNH, CRLV do cavalo/carretas, RNTRC/ANTT, fotos do caminhão, comprovante de
endereço, documento do proprietário, contrato de arrendamento e os CT-e das
referências profissionais). O motorista seleciona um ou vários e, com **um clique
em "Enviar"**, os documentos são enviados para dentro da conversa como anexos
(mensagens com arquivo), reaproveitando o pipeline de anexos do chat.

O botão "Enviar documentos" segue **exatamente o mesmo gating** do botão WhatsApp:
só fica liberado depois que **os dois lados** trocaram o mínimo de mensagens
(limiar de 3 por lado, computado pela RPC `get_conversation_chat_state`). O texto
de incentivo (nudge) acima dos botões muda de "Converse um pouco para liberar o
WhatsApp." para **"Converse um pouco para liberar os botões."** no lado do motorista
(que passa a ter dois botões).

### Princípios e restrições

- **Aditiva e cirúrgica**: reaproveita a infraestrutura existente (RPC de gating,
  bucket `documents`, bucket `chat-attachments`, `sendFreteAttachment`). **Não há
  mudança de schema, nova migration nem nova RPC.** O fluxo do embarcador e o
  comportamento atual do WhatsApp permanecem inalterados (sem regressão).
- **Segurança em primeiro lugar**: o motorista só pode enviar **os próprios
  documentos**. Isso é garantido por defesa em profundidade nas RLS já existentes
  (download do bucket `documents` restrito ao dono; upload do bucket
  `chat-attachments` restrito à própria pasta de remetente e a participantes da
  conversa). Nenhum caminho da feature permite ler ou enviar documento de outra
  pessoa.
- **Apenas documentos/arquivos** são enviados — nada de texto livre (sem legenda).
  Referências profissionais só aparecem como enviáveis **quando possuem um arquivo
  de CT-e**; o texto (empresa/telefone) da referência **não** é enviado.
- UI, rótulos e mensagens em **pt-BR**; tema escuro via `html[data-theme='dark']`;
  layout **mobile-first** (o modal aparece sobre a conversa, inclusive em telas
  `<768px`).

## Glossary

- **Conversation_Screen**: a área de conversa ativa em `src/pages/MensagensPage.tsx`
  (cabeçalho, mensagens e barra inferior) de uma conversa selecionada.
- **Handoff_Bar**: a barra exibida logo acima da `Input_Bar`, que hoje contém o
  nudge e o botão WhatsApp (componente `WhatsappHandoffBar`). Esta feature a
  estende para conter dois botões no lado do motorista.
- **Input_Bar**: a barra inferior de digitação/anexo/áudio da Conversation_Screen.
- **Unlock_Gate**: a regra de liberação resolvida pela RPC SECURITY DEFINER
  `get_conversation_chat_state`, que retorna `whatsapp.unlocked = true` quando
  **ambos** os lados atingiram o `Message_Threshold`.
- **Message_Threshold**: o limiar de mensagens por lado que libera o gating
  (atualmente `3`, constante na RPC). É a fonte única; a feature **não** redefine
  esse valor.
- **Unlocked**: condição em que `Unlock_Gate` retornou `unlocked = true` para a
  conversa aberta.
- **WhatsApp_Button**: o botão verde já existente que abre o WhatsApp do peer.
- **Documents_Button**: o novo botão **"Enviar documentos"**, exibido apenas no
  Motorista_Side, à esquerda do WhatsApp_Button.
- **Nudge_Text**: o texto de incentivo exibido acima dos botões da Handoff_Bar.
- **Send_Documents_Modal**: o modal aberto pelo Documents_Button, sobreposto à
  conversa, com a lista de documentos selecionáveis e o botão de envio.
- **Driver_Document**: um documento que o motorista já enviou no cadastro — uma
  linha em `documents` (bucket privado `documents`), exceto `profile_photo`.
- **Reference_CTe**: o arquivo de CT-e (PDF/imagem) anexado a uma referência
  profissional (`motorista_references.cte_file_path`), guardado no bucket
  `documents` na pasta do próprio motorista. Existe somente quando a referência
  tem `cte_file_path` preenchido.
- **Sendable_Document**: item enviável unificado — um Driver_Document **ou** um
  Reference_CTe — que possui um caminho de arquivo no bucket `documents`
  pertencente ao motorista.
- **Document_Catalog**: a lista de Sendable_Document exibida no Send_Documents_Modal,
  agrupada e rotulada em pt-BR.
- **Chat_Attachment**: uma mensagem de chat com arquivo anexado, gravada via
  `sendFreteAttachment` no bucket `chat-attachments`.
- **Motorista_Side / Embarcador_Side**: o usuário autenticado na conversa é,
  respectivamente, o motorista (`userType === 'motorista'`) ou o embarcador.
- **Document_Service**: o módulo `src/services/documents.ts`
  (`getDocumentsByUser`, `getSignedUrl`).
- **Send_Service**: o novo módulo de envio (`sendDriverDocuments`) que baixa o
  arquivo do bucket `documents` e o reenvia ao chat via `sendFreteAttachment`.

## Requirements

### Requirement 1: Barra de ação com dois botões no lado do motorista

**User Story:** Como motorista, quero ver, na mesma linha do botão WhatsApp, um
botão "Enviar documentos" à esquerda, para enviar minha documentação rapidamente
sem sair da conversa.

#### Acceptance Criteria

1. WHILE o usuário autenticado é o Motorista_Side AND a Handoff_Bar é exibida, THE Conversation_Screen SHALL exibir o Documents_Button à esquerda e o WhatsApp_Button à direita, na mesma linha, com larguras equivalentes (divisão 50/50).
2. THE Documents_Button SHALL exibir o rótulo `Enviar documentos`.
3. WHILE o usuário autenticado é o Embarcador_Side, THE Conversation_Screen SHALL exibir somente o WhatsApp_Button, mantendo o layout atual da Handoff_Bar sem o Documents_Button.
4. THE Nudge_Text SHALL ser exibido acima da linha dos botões (não na mesma linha).
5. THE Handoff_Bar SHALL ser renderizada de forma legível em telas com largura inferior a 768px.
6. WHILE o tema escuro está ativo (`html[data-theme='dark']`), THE Handoff_Bar e o Documents_Button SHALL aplicar as cores do tema escuro.

### Requirement 2: Gating do Documents_Button idêntico ao do WhatsApp_Button

**User Story:** Como motorista, quero que o botão "Enviar documentos" só libere
depois de algumas mensagens dos dois lados, igual ao WhatsApp, para evitar envios
fora de uma negociação real.

#### Acceptance Criteria

1. WHILE a conversa está em condição Unlocked, THE Documents_Button SHALL estar habilitado e acionável.
2. WHILE a conversa **não** está em condição Unlocked, THE Documents_Button SHALL estar desabilitado e não acionável.
3. THE Documents_Button SHALL derivar seu estado de liberação da **mesma** fonte do WhatsApp_Button (o campo `whatsapp.unlocked` retornado por `get_conversation_chat_state`), sem introduzir um limiar próprio.
4. WHEN o número de mensagens da conversa muda e o `Unlock_Gate` é recalculado, THE Conversation_Screen SHALL atualizar simultaneamente o estado de liberação do Documents_Button e do WhatsApp_Button.
5. IF a recuperação do `Unlock_Gate` falha (estado indisponível), THEN THE Documents_Button SHALL permanecer desabilitado (fail-safe: não liberar por engano).

### Requirement 3: Texto de incentivo (nudge) para liberar os botões

**User Story:** Como motorista, quero entender que preciso conversar um pouco para
liberar os botões, para saber o que fazer.

#### Acceptance Criteria

1. WHILE o Motorista_Side vê a Handoff_Bar AND a conversa **não** está Unlocked, THE Nudge_Text SHALL exibir exatamente `Converse um pouco para liberar os botões.`
2. WHILE o Motorista_Side vê a Handoff_Bar AND a conversa está Unlocked, THE Nudge_Text SHALL exibir uma mensagem em pt-BR indicando que WhatsApp e envio de documentos já estão liberados.
3. WHILE o Embarcador_Side vê a Handoff_Bar, THE Nudge_Text SHALL preservar o texto atual referente apenas ao WhatsApp (sem regressão).

### Requirement 4: Abrir o modal de envio de documentos

**User Story:** Como motorista, quero abrir um modal sobre a conversa ao clicar em
"Enviar documentos", para escolher o que enviar.

#### Acceptance Criteria

1. WHEN o Motorista_Side aciona o Documents_Button em condição Unlocked, THE Conversation_Screen SHALL abrir o Send_Documents_Modal sobreposto à conversa.
2. WHILE o Send_Documents_Modal está aberto, THE Send_Documents_Modal SHALL exibir um título em pt-BR e um controle para fechar (botão de fechar e tecla Esc).
3. WHEN o motorista fecha o Send_Documents_Modal sem enviar, THE Conversation_Screen SHALL retornar à conversa sem enviar nenhum documento.
4. WHILE o Send_Documents_Modal está aberto, THE Send_Documents_Modal SHALL ter papel de diálogo modal acessível (`role="dialog"`, `aria-modal`, foco gerenciado) e SHALL impedir interação com a conversa ao fundo.

### Requirement 5: Montar o catálogo apenas com os documentos do próprio motorista

**User Story:** Como motorista, quero ver no modal apenas os meus documentos já
cadastrados, organizados e identificados, para selecionar com clareza.

#### Acceptance Criteria

1. WHEN o Send_Documents_Modal abre, THE Document_Service SHALL recuperar os Driver_Document do motorista autenticado (`getDocumentsByUser(userId)` com o `userId` da própria sessão) e os Reference_CTe das referências do motorista.
2. THE Document_Catalog SHALL incluir um item para cada Driver_Document, exceto documentos do tipo `profile_photo` (foto de perfil/avatar não é documento enviável).
3. THE Document_Catalog SHALL incluir um item para cada referência profissional **que possua** Reference_CTe (`cte_file_path` não nulo), e SHALL omitir referências sem arquivo de CT-e.
4. THE Document_Catalog SHALL exibir cada item com um rótulo em pt-BR (ex.: `CNH`, `CRLV do cavalo`, `Contrato de arrendamento`, `Referência: <empresa> (CT-e)`), reaproveitando os rótulos canônicos do projeto.
5. THE Send_Documents_Modal SHALL agrupar visualmente os itens por categoria (ex.: Perfil, Tração, Carroceria, Outros, Referências), na ordem canônica do projeto.
6. WHERE o motorista não possui nenhum Sendable_Document, THE Send_Documents_Modal SHALL exibir um estado vazio em pt-BR orientando concluir o cadastro de documentos, e SHALL manter a ação de envio desabilitada.
7. WHERE existe um Sendable_Document do tipo imagem, THE Send_Documents_Modal SHALL exibir uma pré-visualização (miniatura) e, para PDF/demais, um ícone de arquivo identificável.
8. IF a recuperação dos documentos falha, THEN THE Send_Documents_Modal SHALL exibir um aviso de erro em pt-BR com opção de tentar novamente, sem travar a conversa.

### Requirement 6: Seleção por checkbox e envio com um clique

**User Story:** Como motorista, quero marcar um ou vários documentos e enviar todos
com um clique, podendo também enviar só um (ex.: só a CNH ou só uma placa).

#### Acceptance Criteria

1. THE Send_Documents_Modal SHALL exibir um checkbox por item do Document_Catalog, permitindo seleção independente de cada documento.
2. THE Send_Documents_Modal SHALL permitir selecionar e desmarcar qualquer subconjunto de itens, incluindo um único item.
3. WHILE nenhum item está selecionado, THE Send_Documents_Modal SHALL manter a ação "Enviar" desabilitada.
4. WHEN o motorista aciona "Enviar" com N itens selecionados (N ≥ 1), THE Send_Service SHALL enviar para a conversa exatamente os N documentos selecionados — nem mais, nem menos.
5. THE Send_Documents_Modal SHALL refletir o número de itens selecionados no rótulo da ação de envio (ex.: `Enviar (3)`).
6. WHILE o envio está em andamento, THE Send_Documents_Modal SHALL indicar progresso e SHALL impedir disparos duplicados da ação de envio.

### Requirement 7: Entregar os documentos na conversa como anexos

**User Story:** Como motorista, quero que os documentos selecionados apareçam na
conversa como anexos, visíveis para os dois lados, para que o embarcador possa
abri-los.

#### Acceptance Criteria

1. WHEN o Send_Service envia um Sendable_Document, THE Send_Service SHALL criar uma mensagem de Chat_Attachment na conversa para aquele documento, reaproveitando `sendFreteAttachment`.
2. THE Send_Service SHALL enviar o documento **sem texto livre** (conteúdo textual vazio), apenas o arquivo com seu nome/rótulo.
3. THE Send_Service SHALL classificar o anexo como `image` quando o arquivo for imagem e `file` caso contrário (ex.: PDF), para a renderização correta no chat.
4. WHEN um Chat_Attachment é criado, THE Conversation_Screen SHALL exibi-lo na lista de mensagens em tempo real para o remetente e para o peer (via realtime existente).
5. WHEN todos os documentos selecionados foram enviados com sucesso, THE Send_Documents_Modal SHALL fechar e retornar à conversa.

### Requirement 8: Tratamento de falhas parciais no envio

**User Story:** Como motorista, quero saber se algum documento não foi enviado, sem
perder os que já foram, para reenviar apenas o que falhou.

#### Acceptance Criteria

1. WHEN um ou mais documentos selecionados falham no envio enquanto outros têm sucesso, THE Send_Service SHALL concluir os bem-sucedidos e SHALL reportar quais falharam.
2. WHEN há falha parcial, THE Send_Documents_Modal SHALL permanecer aberto exibindo, em pt-BR, quais documentos não foram enviados e a opção de tentar novamente os que falharam.
3. IF o download de um documento do bucket `documents` é negado ou falha, THEN THE Send_Service SHALL marcar **apenas aquele** item como falho e SHALL continuar com os demais.
4. THE Send_Service SHALL garantir que uma falha de envio de um item não crie uma mensagem de Chat_Attachment incompleta (em caso de falha após upload, o anexo órfão é removido — comportamento já provido por `sendFreteAttachment`).
5. WHEN o envio é disparado fora de condição Unlocked (estado divergente), THE Send_Service SHALL não enviar e THE Send_Documents_Modal SHALL informar que os botões ainda não estão liberados.

### Requirement 9: Segurança — somente os documentos do próprio motorista

**User Story:** Como motorista (e como plataforma), quero garantir que ninguém
consiga enviar documentos de outra pessoa pela conversa, para proteger dados
sensíveis.

#### Acceptance Criteria

1. THE Send_Service SHALL obter o arquivo de cada documento exclusivamente do bucket `documents`, na pasta do próprio motorista, cujo acesso de leitura é restrito ao dono pela RLS existente.
2. THE Send_Service SHALL gravar o anexo no bucket `chat-attachments` somente no caminho `<conversation_id>/<sender_id>/...` com `sender_id` igual ao usuário autenticado, conforme exigido pela RLS do bucket.
3. WHERE o usuário autenticado não é participante da conversa, THE sistema SHALL impedir tanto a leitura do estado da conversa quanto a gravação de anexos (garantido pela RPC `get_conversation_chat_state` e pelas RLS de `chat-attachments`).
4. THE feature SHALL NOT expor caminhos de arquivo, URLs assinadas ou dados de documentos de outro usuário em nenhuma resposta, log ou trace.
5. THE Send_Service SHALL operar sem privilégios de servidor adicionais (sem service-role, sem nova RPC SECURITY DEFINER), apoiando-se nas RLS de `documents` e `chat-attachments` como fronteiras de segurança (defesa em profundidade).

### Requirement 10: Não regressão e ausência de mudança de schema

**User Story:** Como mantenedor, quero que esta feature não afete o código e os
dados existentes, para evitar quebras.

#### Acceptance Criteria

1. THE feature SHALL NOT alterar o schema do banco, SHALL NOT adicionar migration e SHALL NOT criar/alterar RPC.
2. THE comportamento do WhatsApp_Button (liberação, link `wa.me`, mensagem pré-preenchida) SHALL permanecer inalterado.
3. THE fluxo de anexos existente da Input_Bar (texto, imagem, áudio, arquivo, drag-and-drop) SHALL permanecer inalterado.
4. WHILE a conversa está com o frete indisponível (input bloqueado), THE Handoff_Bar — e portanto o Documents_Button — SHALL permanecer oculta, como já ocorre hoje com o WhatsApp_Button.
5. THE Embarcador_Side SHALL continuar com exatamente a mesma experiência atual (sem Documents_Button).
