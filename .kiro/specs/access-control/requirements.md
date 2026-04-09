# Documento de Requisitos - Access Control

## Introdução

Implementação do sistema de controle de acesso baseado em perfil completo para o FreteGO. O sistema controla a visibilidade de informações sensíveis (valor do frete, contato do embarcador) baseado no nível de completude do perfil do motorista.

## Glossário

- **Sistema**: Aplicação FreteGO
- **Motorista**: Usuário que visualiza e aceita fretes
- **Embarcador**: Usuário que publica fretes
- **Perfil_Completo**: Perfil com 100% dos documentos obrigatórios aprovados
- **Perfil_Básico**: Perfil com cadastro básico mas sem documentos aprovados
- **Usuário_Anônimo**: Visitante não autenticado

## Requisitos

### Requisito 1: Listagem Pública de Fretes

**User Story:** Como visitante, eu quero ver a lista de fretes disponíveis, para conhecer a plataforma antes de me cadastrar.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir lista de fretes ativos para usuários não autenticados
2. THE Sistema SHALL ocultar o valor do frete para usuários não autenticados
3. THE Sistema SHALL exibir "Faça login para ver o valor" no lugar do valor
4. THE Sistema SHALL exibir origem, destino, tipo de carga e veículo para todos

### Requisito 2: Visualização de Valor (Conta Básica)

**User Story:** Como motorista com conta básica, eu quero ver o valor dos fretes, para avaliar se são interessantes.

#### Critérios de Aceitação

1. WHEN o motorista estiver autenticado, THE Sistema SHALL exibir o valor do frete
2. THE Sistema SHALL exibir a descrição completa do frete
3. THE Sistema SHALL ocultar informações de contato do embarcador

### Requisito 3: Acesso Completo (Perfil 100%)

**User Story:** Como motorista com perfil 100% completo, eu quero ver todas as informações do frete, para poder entrar em contato com o embarcador.

#### Critérios de Aceitação

1. WHEN o motorista tiver perfil 100% completo, THE Sistema SHALL exibir botão de WhatsApp
2. WHEN o motorista tiver perfil 100% completo, THE Sistema SHALL exibir botão de chat interno
3. THE Sistema SHALL preencher automaticamente mensagem inicial no WhatsApp
4. THE Sistema SHALL exibir nome e empresa do embarcador

### Requisito 4: Mensagem de Perfil Incompleto

**User Story:** Como motorista com perfil incompleto, eu quero saber o que falta para ter acesso completo.

#### Critérios de Aceitação

1. WHEN o motorista tentar acessar contato com perfil incompleto, THE Sistema SHALL exibir mensagem explicativa
2. THE Sistema SHALL exibir percentual atual de completude
3. THE Sistema SHALL exibir link para completar o perfil
4. THE Sistema SHALL listar documentos pendentes

### Requisito 5: Botão WhatsApp com Mensagem Pré-preenchida

**User Story:** Como motorista com perfil completo, eu quero enviar mensagem rápida pelo WhatsApp.

#### Critérios de Aceitação

1. THE Sistema SHALL abrir WhatsApp Web/App com número do embarcador
2. THE Sistema SHALL preencher mensagem: "Olá, vi seu frete de [origem] para [destino] no FreteGO e tenho interesse."
3. THE Sistema SHALL incluir link do frete na mensagem

### Requisito 6: Botão Chat Interno

**User Story:** Como motorista com perfil completo, eu quero iniciar conversa pelo chat interno.

#### Critérios de Aceitação

1. THE Sistema SHALL abrir widget de chat com embarcador
2. THE Sistema SHALL criar conversa vinculada ao frete específico
3. THE Sistema SHALL notificar embarcador sobre nova mensagem

### Requisito 7: Verificação de Perfil no Backend

**User Story:** Como sistema, eu quero validar o acesso no backend, para garantir segurança.

#### Critérios de Aceitação

1. THE Sistema SHALL verificar completude do perfil antes de retornar dados sensíveis
2. THE Sistema SHALL retornar erro 403 se perfil incompleto tentar acessar contato
3. THE Sistema SHALL registrar tentativas de acesso não autorizado
