# Documento de Requisitos - Chat/WhatsApp Integration

## Introdução

Implementação do sistema de comunicação entre motoristas e embarcadores no FreteGO, incluindo chat interno e integração com WhatsApp.

## Glossário

- **Sistema**: Aplicação FreteGO
- **Chat_Interno**: Sistema de mensagens dentro da plataforma
- **Conversa**: Thread de mensagens entre motorista e embarcador sobre um frete
- **WhatsApp_Integration**: Botão que abre WhatsApp com mensagem pré-preenchida

## Requisitos

### Requisito 1: Iniciar Conversa pelo Frete

**User Story:** Como motorista, eu quero iniciar uma conversa sobre um frete específico.

#### Critérios de Aceitação

1. WHEN o motorista clicar em "Chat" no modal do frete, THE Sistema SHALL criar uma conversa vinculada ao frete
2. THE Sistema SHALL abrir o widget de chat com a conversa
3. THE Sistema SHALL exibir informações do frete no cabeçalho da conversa
4. IF já existir conversa sobre o frete, THEN THE Sistema SHALL abrir a conversa existente

### Requisito 2: Widget de Chat

**User Story:** Como usuário, eu quero um widget de chat acessível em qualquer página.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir ícone de chat no canto inferior direito
2. WHEN o usuário clicar no ícone, THE Sistema SHALL abrir painel de conversas
3. THE Sistema SHALL exibir lista de conversas ativas
4. THE Sistema SHALL exibir badge com número de mensagens não lidas
5. THE Sistema SHALL permitir minimizar/maximizar o widget

### Requisito 3: Envio e Recebimento de Mensagens

**User Story:** Como usuário, eu quero enviar e receber mensagens em tempo real.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir enviar mensagens de texto
2. THE Sistema SHALL exibir mensagens em tempo real (Supabase Realtime)
3. THE Sistema SHALL exibir timestamp de cada mensagem
4. THE Sistema SHALL indicar status de leitura (enviado, entregue, lido)
5. THE Sistema SHALL ordenar mensagens por data/hora

### Requisito 4: Notificações de Novas Mensagens

**User Story:** Como usuário, eu quero ser notificado quando receber novas mensagens.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir notificação visual (badge) para mensagens não lidas
2. THE Sistema SHALL tocar som de notificação (configurável)
3. THE Sistema SHALL atualizar título da página com contador de não lidas
4. THE Sistema SHALL marcar mensagens como lidas quando a conversa for aberta

### Requisito 5: Histórico de Conversas

**User Story:** Como usuário, eu quero ver o histórico de todas as minhas conversas.

#### Critérios de Aceitação

1. THE Sistema SHALL listar todas as conversas do usuário
2. THE Sistema SHALL exibir última mensagem e timestamp de cada conversa
3. THE Sistema SHALL ordenar conversas por atividade mais recente
4. THE Sistema SHALL permitir buscar conversas por nome ou frete

### Requisito 6: Integração WhatsApp

**User Story:** Como motorista, eu quero entrar em contato pelo WhatsApp.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir botão "WhatsApp" no modal do frete
2. WHEN o motorista clicar, THE Sistema SHALL abrir WhatsApp Web/App
3. THE Sistema SHALL preencher número do embarcador
4. THE Sistema SHALL preencher mensagem: "Olá, vi seu frete de [origem] para [destino] no FreteGO e tenho interesse."

### Requisito 7: Segurança e Privacidade

**User Story:** Como usuário, eu quero que minhas conversas sejam privadas.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir acesso apenas aos participantes da conversa
2. THE Sistema SHALL usar RLS para proteger mensagens no banco
3. THE Sistema SHALL não expor números de telefone para perfis incompletos
