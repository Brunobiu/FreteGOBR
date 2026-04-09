# Documento de Requisitos - Motorista Documents

## Introdução

Implementação do sistema completo de documentos do motorista para o FreteGO, conforme especificação do cliente. O sistema deve suportar 9 categorias de documentos com múltiplos campos, validação de arquivos, workflow de aprovação pelo admin e controle de status por documento.

## Glossário

- **Sistema**: Aplicação FreteGO (React + TypeScript + Supabase)
- **Motorista**: Usuário do tipo motorista que faz upload de documentos
- **Admin**: Usuário administrador que aprova/rejeita documentos
- **CRLV**: Certificado de Registro e Licenciamento de Veículo
- **RNTRC**: Registro Nacional de Transportadores Rodoviários de Cargas (ANTT)
- **CNH**: Carteira Nacional de Habilitação
- **PIS**: Programa de Integração Social
- **Status_Documento**: Estado do documento (pendente, aprovado, rejeitado)

## Requisitos

### Requisito 1: Documentos do Cavalo e Carretas (CRLV)

**User Story:** Como motorista, eu quero enviar os documentos CRLV do meu cavalo e carretas, para que meu cadastro esteja completo.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir seção "DOC Cavalo/Carretas" com campo para CRLV Cavalo
2. THE Sistema SHALL exibir campos para CRLV Carreta 1, 2, 3 e 4
3. THE Sistema SHALL exibir botão "Adicionar mais" para campos de carreta adicionais
4. THE Sistema SHALL permitir upload de arquivos PDF, JPG ou PNG
5. THE Sistema SHALL validar que cada arquivo não exceda 5MB

### Requisito 2: Documentos ANTT (RNTRC)

**User Story:** Como motorista, eu quero enviar os documentos RNTRC, para comprovar minha regularidade junto à ANTT.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir seção "ANTT" com campos para RNTRC Cavalo, Carreta 1 e Carreta 2
2. THE Sistema SHALL permitir upload de arquivos PDF, JPG ou PNG
3. THE Sistema SHALL validar que cada arquivo não exceda 5MB

### Requisito 3: Documento CNH

**User Story:** Como motorista, eu quero enviar minha CNH, para comprovar minha habilitação.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir seção "CNH" com campo único para upload
2. THE Sistema SHALL permitir upload de arquivo PDF, JPG ou PNG
3. THE Sistema SHALL validar que o arquivo não exceda 5MB

### Requisito 4: Foto Segurando CNH

**User Story:** Como motorista, eu quero enviar uma foto minha segurando a CNH, para validar minha identidade.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir seção "Foto segurando CNH" com campo único
2. THE Sistema SHALL permitir upload de arquivo JPG ou PNG apenas
3. THE Sistema SHALL validar que o arquivo não exceda 5MB

### Requisito 5: Foto em Frente ao Caminhão

**User Story:** Como motorista, eu quero enviar uma foto minha em frente ao caminhão.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir seção "Foto em frente ao caminhão"
2. THE Sistema SHALL permitir upload de arquivo JPG ou PNG apenas
3. THE Sistema SHALL validar que o arquivo não exceda 5MB

### Requisito 6: Comprovante de Endereço

**User Story:** Como motorista, eu quero enviar comprovantes de endereço.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir seção com campos para "Proprietário" e "Motorista (se diferente)"
2. THE Sistema SHALL permitir upload de arquivos PDF, JPG ou PNG
3. THE Sistema SHALL validar que cada arquivo não exceda 5MB

### Requisito 7: Foto do Caminhão Completo

**User Story:** Como motorista, eu quero enviar uma foto do caminhão completo.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir seção "Foto do caminhão completo"
2. THE Sistema SHALL permitir upload de arquivo JPG ou PNG apenas
3. THE Sistema SHALL validar que o arquivo não exceda 5MB

### Requisito 8: Número PIS

**User Story:** Como motorista, eu quero informar meu número PIS.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir seção "Número PIS" com campo de texto
2. THE Sistema SHALL validar que o número PIS contenha 11 dígitos numéricos

### Requisito 9: Status de Documentos

**User Story:** Como motorista, eu quero visualizar o status de cada documento enviado.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir status: "Pendente", "Aprovado" ou "Rejeitado"
2. THE Sistema SHALL exibir indicador visual diferenciado para cada status
3. WHEN um documento for rejeitado, THE Sistema SHALL exibir o motivo
4. THE Sistema SHALL calcular percentual de completude baseado em documentos aprovados

### Requisito 10: Restrição de Deleção

**User Story:** Como admin, eu quero que documentos aprovados não possam ser deletados pelo motorista.

#### Critérios de Aceitação

1. WHILE um documento estiver "Aprovado", THE Sistema SHALL ocultar botão de deletar para o motorista
2. WHILE um documento estiver "Pendente" ou "Rejeitado", THE Sistema SHALL permitir deleção
3. THE Sistema SHALL permitir que apenas o Admin delete documentos aprovados

### Requisito 11: Aprovação pelo Admin

**User Story:** Como admin, eu quero aprovar ou rejeitar documentos dos motoristas.

#### Critérios de Aceitação

1. THE Sistema SHALL exibir lista de documentos pendentes na área administrativa
2. THE Sistema SHALL permitir que o Admin visualize cada documento
3. THE Sistema SHALL permitir aprovar ou rejeitar com motivo
4. WHEN o Admin aprovar/rejeitar, THE Sistema SHALL atualizar o status imediatamente
