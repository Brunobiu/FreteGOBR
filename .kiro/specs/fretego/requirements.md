# Requirements Document - FreteGO

## Introduction

FreteGO é um marketplace de frete brasileiro que conecta embarcadores e motoristas. O sistema permite que visitantes naveguem fretes publicamente, mas exige criação de conta para ações de contato. A plataforma deve ser robusta, segura e escalável desde o início, com autenticação JWT, proteção de dados via Row Level Security (RLS), e sistema completo de testes.

## Glossary

- **System**: O sistema FreteGO completo (frontend + backend)
- **Visitor**: Usuário não autenticado navegando o site
- **Motorista**: Usuário autenticado que busca e contrata fretes
- **Embarcador**: Usuário autenticado que posta fretes
- **Admin**: Administrador da plataforma com acesso total
- **Frete**: Anúncio de carga disponível para transporte
- **Auth_System**: Sistema de autenticação Supabase com JWT
- **RLS**: Row Level Security do Supabase
- **Chat_System**: Sistema de chat de suporte em tempo real
- **Document_Storage**: Sistema de armazenamento seguro de documentos
- **Dashboard**: Interface administrativa ou de usuário
- **Analytics**: Métricas e estatísticas da plataforma

## Requirements

### Requirement 1: Autenticação e Segurança

**User Story:** Como usuário do sistema, quero que minha conta e dados estejam protegidos, para que apenas eu e administradores autorizados possam acessá-los.

#### Acceptance Criteria

1. WHEN a user creates an account, THE Auth_System SHALL hash the password using bcrypt before storage
2. WHEN a user logs in with valid credentials, THE Auth_System SHALL generate a JWT token with appropriate claims
3. WHEN a user accesses a protected route without valid token, THE System SHALL reject the request and return 401 status
4. WHEN a JWT token expires, THE Auth_System SHALL use refresh tokens to generate new access tokens
5. WHEN a user logs out, THE Auth_System SHALL invalidate all active tokens for that user
6. THE System SHALL enforce password rules requiring minimum 6 characters with at least 1 letter and 1 number
7. WHEN a user attempts SQL injection, THE System SHALL sanitize inputs and prevent execution
8. THE System SHALL implement rate limiting to prevent DDoS attacks
9. THE System SHALL configure CORS, CSP, HSTS, and X-Frame-Options headers
10. WHEN a user uploads a document, THE Document_Storage SHALL validate file type and store in private bucket

### Requirement 2: Row Level Security (RLS)

**User Story:** Como usuário, quero que apenas eu possa acessar meus dados privados, para garantir privacidade e segurança.

#### Acceptance Criteria

1. WHEN a Motorista queries their documents, THE RLS SHALL return only documents owned by that Motorista
2. WHEN an Embarcador queries their fretes, THE RLS SHALL return only fretes created by that Embarcador
3. WHEN an Admin queries any table, THE RLS SHALL grant full access to all records
4. WHEN a Motorista attempts to update another Motorista's data, THE RLS SHALL reject the operation
5. WHEN a user attempts to access documents they don't own, THE RLS SHALL return empty result set
6. THE RLS SHALL allow public read access to active fretes for all users including visitors

### Requirement 3: Cadastro de Usuários

**User Story:** Como visitante, quero criar uma conta como Motorista ou Embarcador, para que eu possa usar as funcionalidades da plataforma.

#### Acceptance Criteria

1. WHEN a visitor chooses to register, THE System SHALL present options for Motorista or Embarcador account types
2. WHEN a user submits registration with phone and password, THE System SHALL validate phone uniqueness
3. WHEN a user enters a password with less than 6 characters, THE System SHALL reject with validation error
4. WHEN a user enters a password without letters or numbers, THE System SHALL reject with validation error
5. WHEN registration is successful, THE System SHALL create user record and send confirmation
6. THE System SHALL validate phone number format before account creation
7. WHEN a user provides valid phone and password, THE Auth_System SHALL create authenticated session

### Requirement 4: Perfil do Motorista

**User Story:** Como Motorista, quero gerenciar meu perfil completo com documentos, para que embarcadores possam verificar minhas credenciais.

#### Acceptance Criteria

1. WHEN a Motorista uploads CNH document, THE Document_Storage SHALL store securely and associate with Motorista ID
2. WHEN a Motorista uploads ANTT document, THE Document_Storage SHALL store securely and associate with Motorista ID
3. WHEN a Motorista uploads multiple vehicle documents, THE Document_Storage SHALL accept and store all files
4. WHEN a Motorista uploads profile photo, THE System SHALL store and display in dashboard
5. WHEN a Motorista updates profile data, THE System SHALL validate and persist changes immediately
6. WHEN a Motorista views their profile, THE System SHALL display name in top right corner with photo
7. THE System SHALL allow Motorista to specify vehicle type in profile
8. WHEN a Motorista accesses document URLs, THE Document_Storage SHALL generate signed URLs with expiration

### Requirement 5: Perfil do Embarcador

**User Story:** Como Embarcador, quero gerenciar meu perfil e informações da empresa, para que motoristas possam me identificar e entrar em contato.

#### Acceptance Criteria

1. WHEN an Embarcador creates profile, THE System SHALL require company name and WhatsApp number
2. WHEN an Embarcador updates profile data, THE System SHALL validate and persist changes immediately
3. WHEN an Embarcador views their dashboard, THE System SHALL display company name in top right corner with photo
4. WHEN an Embarcador uploads profile photo, THE System SHALL store and display in dashboard
5. THE System SHALL maintain rating average and total ratings count for each Embarcador
6. WHEN a visitor views Embarcador public profile, THE System SHALL display company name, ratings, and active fretes

### Requirement 6: Gestão de Fretes pelo Embarcador

**User Story:** Como Embarcador, quero postar e gerenciar fretes, para que motoristas possam encontrar e contratar meus serviços.

#### Acceptance Criteria

1. WHEN an Embarcador creates a frete, THE System SHALL require origin, destination, cargo type, vehicle type, weight, value, and deadline
2. WHEN an Embarcador submits frete with valid data, THE System SHALL create record and display in public listings
3. WHEN an Embarcador views their dashboard, THE System SHALL display all their active and closed fretes
4. WHEN an Embarcador edits a frete, THE System SHALL validate changes and update record
5. WHEN an Embarcador deletes a frete, THE System SHALL change status to cancelled
6. WHEN a Motorista clicks on a frete, THE System SHALL increment clicks_count for that frete
7. WHEN an Embarcador views frete analytics, THE System SHALL display total views and clicks
8. THE System SHALL allow Embarcador to specify loading and unloading time estimates
9. THE System SHALL store geographic coordinates for origin and destination

### Requirement 7: Visualização Pública de Fretes

**User Story:** Como Visitor, quero navegar e visualizar fretes disponíveis, para que eu possa avaliar oportunidades antes de criar conta.

#### Acceptance Criteria

1. WHEN a Visitor accesses the fretes page, THE System SHALL display all active fretes without requiring authentication
2. WHEN a Visitor views a frete, THE System SHALL show origin, destination, cargo type, vehicle type, weight, and value
3. WHEN a Visitor views a frete, THE System SHALL hide Embarcador phone number
4. WHEN a Visitor clicks "Contratar" button, THE System SHALL redirect to login/registration page
5. WHEN a Visitor applies filters, THE System SHALL return fretes matching filter criteria
6. THE System SHALL allow filtering by origin city, destination city, cargo type, vehicle type, weight range, and value range
7. WHEN a Visitor views the map, THE System SHALL display markers for each active frete location

### Requirement 8: Contratação de Fretes pelo Motorista

**User Story:** Como Motorista, quero contratar fretes e entrar em contato com embarcadores, para que eu possa realizar transportes.

#### Acceptance Criteria

1. WHEN a Motorista clicks "Contratar" on a frete, THE System SHALL open WhatsApp with pre-filled message to Embarcador
2. WHEN a Motorista clicks on a frete, THE System SHALL record the click with Motorista ID and timestamp
3. WHEN a Motorista views frete details, THE System SHALL display complete information including Embarcador contact
4. WHEN a Motorista contracts a frete, THE System SHALL increment clicks_count for analytics
5. THE System SHALL generate WhatsApp message with frete details and Motorista information

### Requirement 9: Sistema de Avaliação

**User Story:** Como Motorista, quero avaliar embarcadores após completar fretes, para que outros motoristas possam tomar decisões informadas.

#### Acceptance Criteria

1. WHEN a Motorista submits a rating, THE System SHALL accept values from 1 to 5 stars
2. WHEN a Motorista submits a rating with comment, THE System SHALL store both rating and comment
3. WHEN a rating is submitted, THE System SHALL recalculate Embarcador average rating
4. WHEN a rating is submitted, THE System SHALL increment Embarcador total ratings count
5. WHEN a user views Embarcador public profile, THE System SHALL display average rating and all comments
6. THE System SHALL prevent duplicate ratings from same Motorista for same Embarcador

### Requirement 10: Mapa Interativo

**User Story:** Como usuário, quero visualizar fretes em um mapa interativo, para que eu possa identificar oportunidades geograficamente.

#### Acceptance Criteria

1. WHEN a user views the map, THE System SHALL display markers for each active frete at origin location
2. WHEN a user clicks a map marker, THE System SHALL display frete summary in popup
3. WHEN a user clicks frete summary in popup, THE System SHALL open detailed modal
4. THE System SHALL update map markers in real-time when new fretes are posted
5. THE System SHALL use geographic coordinates to position markers accurately
6. WHEN multiple fretes exist at same location, THE System SHALL cluster markers

### Requirement 11: Sugestão de Viagem

**User Story:** Como Motorista, quero receber sugestões de fretes próximos à minha localização, para que eu possa encontrar oportunidades convenientes.

#### Acceptance Criteria

1. WHEN a Motorista clicks "Me sugerir uma viagem", THE System SHALL request browser geolocation permission
2. WHEN geolocation is granted, THE System SHALL calculate distance from Motorista to each frete origin
3. WHEN distances are calculated, THE System SHALL return fretes sorted by proximity
4. WHEN a Motorista denies geolocation, THE System SHALL prompt for manual location entry
5. THE System SHALL display suggested fretes with distance information
6. THE System SHALL limit suggestions to fretes within reasonable distance threshold

### Requirement 12: Calculadora de Frete

**User Story:** Como Motorista, quero comparar múltiplas rotas simultaneamente, para que eu possa escolher o frete mais vantajoso.

#### Acceptance Criteria

1. WHEN a Motorista selects up to 5 fretes, THE System SHALL enable comparison mode
2. WHEN comparison is activated, THE System SHALL calculate total distance for each route
3. WHEN comparison is activated, THE System SHALL calculate estimated travel time for each route
4. WHEN comparison is activated, THE System SHALL display loading and unloading time for each route
5. WHEN comparison is activated, THE System SHALL calculate total days required for each route
6. WHEN comparison is activated, THE System SHALL display value per frete
7. THE System SHALL present comparison results side-by-side for easy evaluation
8. THE System SHALL use Motorista current location or manual location as starting point

### Requirement 13: Chat de Suporte

**User Story:** Como Motorista ou Embarcador, quero entrar em contato com suporte, para que eu possa resolver problemas e tirar dúvidas.

#### Acceptance Criteria

1. WHEN a user clicks support button, THE Chat_System SHALL open chat modal
2. WHEN a user sends a message, THE Chat_System SHALL deliver to Admin in real-time
3. WHEN Admin responds, THE Chat_System SHALL deliver to user in real-time
4. WHEN a new message arrives, THE Chat_System SHALL display notification badge
5. WHEN a user views chat history, THE Chat_System SHALL load all previous messages in conversation
6. THE Chat_System SHALL display "typing..." indicator when other party is typing
7. THE Chat_System SHALL persist conversation history in database
8. WHEN a user opens chat, THE Chat_System SHALL mark messages as read
9. THE Chat_System SHALL allow optional image and document uploads

### Requirement 14: Dashboard Admin - Métricas

**User Story:** Como Admin, quero visualizar métricas da plataforma, para que eu possa monitorar crescimento e saúde do sistema.

#### Acceptance Criteria

1. WHEN Admin views dashboard, THE System SHALL display total active users count
2. WHEN Admin views dashboard, THE System SHALL display total inactive users count
3. WHEN Admin views dashboard, THE System SHALL display total Motoristas count
4. WHEN Admin views dashboard, THE System SHALL display total Embarcadores count
5. WHEN Admin views dashboard, THE System SHALL display active fretes count
6. WHEN Admin views dashboard, THE System SHALL display completed fretes count
7. WHEN Admin views dashboard, THE System SHALL display real-time online users count
8. THE System SHALL update metrics in real-time or with minimal delay
9. THE System SHALL display growth charts for users and fretes over time

### Requirement 15: Dashboard Admin - Gerenciamento de Usuários

**User Story:** Como Admin, quero gerenciar usuários da plataforma, para que eu possa moderar e manter qualidade do serviço.

#### Acceptance Criteria

1. WHEN Admin views users list, THE System SHALL display all Motoristas and Embarcadores
2. WHEN Admin applies filters, THE System SHALL return users matching filter criteria
3. WHEN Admin searches by name or phone, THE System SHALL return matching users
4. WHEN Admin clicks on user, THE System SHALL display complete profile information
5. WHEN Admin edits user data, THE System SHALL validate and persist changes
6. WHEN Admin deactivates user, THE System SHALL set is_active to false and prevent login
7. THE System SHALL allow Admin to view user documents and uploaded files
8. THE System SHALL display user activity history and login logs

### Requirement 16: Dashboard Admin - Gerenciamento de Fretes

**User Story:** Como Admin, quero gerenciar fretes da plataforma, para que eu possa moderar conteúdo e remover anúncios inadequados.

#### Acceptance Criteria

1. WHEN Admin views fretes list, THE System SHALL display all fretes regardless of status
2. WHEN Admin applies filters, THE System SHALL return fretes matching status, date, or value criteria
3. WHEN Admin clicks on frete, THE System SHALL display complete frete information
4. WHEN Admin edits frete data, THE System SHALL validate and persist changes
5. WHEN Admin removes frete, THE System SHALL change status to cancelled
6. THE System SHALL display frete analytics including views and clicks
7. THE System SHALL allow Admin to view Embarcador information for each frete

### Requirement 17: Dashboard Admin - Chat de Suporte

**User Story:** Como Admin, quero gerenciar conversas de suporte, para que eu possa ajudar usuários eficientemente.

#### Acceptance Criteria

1. WHEN Admin views support dashboard, THE Chat_System SHALL display all active conversations
2. WHEN a new message arrives, THE Chat_System SHALL notify Admin with badge and sound
3. WHEN Admin clicks on conversation, THE Chat_System SHALL open chat interface with full history
4. WHEN Admin sends message, THE Chat_System SHALL deliver to user in real-time
5. WHEN Admin marks conversation as resolved, THE Chat_System SHALL update status
6. THE Chat_System SHALL display conversation status (open, in progress, resolved)
7. THE Chat_System SHALL allow Admin to filter conversations by status
8. THE Chat_System SHALL display user information alongside conversation

### Requirement 18: Sistema de Notificações

**User Story:** Como usuário, quero receber notificações sobre eventos importantes, para que eu possa responder rapidamente.

#### Acceptance Criteria

1. WHEN a new frete matching Motorista preferences is posted, THE System SHALL send notification to Motorista
2. WHEN a Motorista clicks on Embarcador frete, THE System SHALL send notification to Embarcador
3. WHEN Admin responds in support chat, THE System SHALL send notification to user
4. WHEN a Motorista submits rating, THE System SHALL send notification to Embarcador
5. THE System SHALL display unread notifications count in badge
6. WHEN a user clicks notification, THE System SHALL navigate to relevant page and mark as read
7. THE System SHALL persist notifications in database for history

### Requirement 19: Gerenciamento de Documentos

**User Story:** Como Motorista, quero fazer upload de documentos obrigatórios, para que embarcadores possam verificar minhas credenciais.

#### Acceptance Criteria

1. WHEN a Motorista uploads CPF, THE Document_Storage SHALL validate file type and store securely
2. WHEN a Motorista uploads CNH, THE Document_Storage SHALL validate file type and store securely
3. WHEN a Motorista uploads ANTT, THE Document_Storage SHALL validate file type and store securely
4. WHEN a Motorista uploads vehicle documents, THE Document_Storage SHALL accept multiple files
5. WHEN a Motorista uploads photo with vehicle, THE Document_Storage SHALL validate image format
6. THE Document_Storage SHALL generate signed URLs with 1-hour expiration for document access
7. WHEN a Motorista deletes document, THE Document_Storage SHALL remove file and database record
8. THE System SHALL validate file size limits before upload
9. THE System SHALL accept only PDF, JPG, PNG file formats for documents

### Requirement 20: Configurações de Conta

**User Story:** Como usuário, quero gerenciar configurações da minha conta, para que eu possa manter informações atualizadas e seguras.

#### Acceptance Criteria

1. WHEN a user changes password, THE System SHALL validate new password against rules
2. WHEN a user updates profile data, THE System SHALL validate and persist changes
3. WHEN a user updates notification preferences, THE System SHALL save preferences
4. WHEN a user requests account deletion, THE System SHALL display confirmation dialog
5. WHEN a user confirms account deletion, THE System SHALL deactivate account and anonymize data
6. THE System SHALL allow user to update phone number with verification
7. THE System SHALL allow user to update email address with verification

### Requirement 21: Busca e Filtros Avançados

**User Story:** Como usuário, quero buscar e filtrar fretes por múltiplos critérios, para que eu possa encontrar oportunidades específicas rapidamente.

#### Acceptance Criteria

1. WHEN a user enters origin city, THE System SHALL return fretes with matching origin
2. WHEN a user enters destination city, THE System SHALL return fretes with matching destination
3. WHEN a user selects cargo type, THE System SHALL return fretes with matching cargo type
4. WHEN a user selects vehicle type, THE System SHALL return fretes requiring that vehicle type
5. WHEN a user sets weight range, THE System SHALL return fretes within weight range
6. WHEN a user sets value range, THE System SHALL return fretes within value range
7. WHEN multiple filters are applied, THE System SHALL return fretes matching all criteria
8. THE System SHALL display filter results count before applying
9. THE System SHALL allow clearing all filters at once

### Requirement 22: Logs e Auditoria

**User Story:** Como Admin, quero visualizar logs de sistema e auditoria, para que eu possa monitorar segurança e diagnosticar problemas.

#### Acceptance Criteria

1. WHEN a user logs in, THE System SHALL record login event with timestamp and IP address
2. WHEN a user fails login attempt, THE System SHALL record failed attempt with details
3. WHEN a user accesses protected resource without authorization, THE System SHALL log security event
4. WHEN Admin views audit logs, THE System SHALL display all important system events
5. WHEN Admin filters logs by date range, THE System SHALL return events within range
6. WHEN Admin filters logs by event type, THE System SHALL return matching events
7. THE System SHALL log all data modifications with user ID and timestamp
8. THE System SHALL retain logs for minimum 90 days

### Requirement 23: Responsividade e Performance

**User Story:** Como usuário, quero que o sistema funcione bem em qualquer dispositivo, para que eu possa acessar de desktop ou mobile.

#### Acceptance Criteria

1. WHEN a user accesses from mobile device, THE System SHALL display mobile-optimized layout
2. WHEN a user accesses from tablet, THE System SHALL display tablet-optimized layout
3. WHEN a user accesses from desktop, THE System SHALL display desktop-optimized layout
4. WHEN a page loads, THE System SHALL display initial content within 2 seconds
5. WHEN a user navigates between pages, THE System SHALL transition within 500ms
6. THE System SHALL lazy-load images and components not in viewport
7. THE System SHALL cache static assets for improved performance
8. THE System SHALL compress images before serving to client

### Requirement 24: Tratamento de Erros

**User Story:** Como usuário, quero receber mensagens de erro claras, para que eu possa entender e resolver problemas.

#### Acceptance Criteria

1. WHEN a network error occurs, THE System SHALL display user-friendly error message
2. WHEN a validation error occurs, THE System SHALL display specific field error messages
3. WHEN a server error occurs, THE System SHALL display generic error and log details
4. WHEN a user loses internet connection, THE System SHALL display offline indicator
5. WHEN a user submits invalid form, THE System SHALL highlight invalid fields with error messages
6. THE System SHALL provide retry mechanism for failed operations
7. THE System SHALL log all errors with stack traces for debugging
8. WHEN a critical error occurs, THE System SHALL notify Admin via alert system

### Requirement 25: Localização e Geolocalização

**User Story:** Como usuário, quero que o sistema use minha localização, para que eu possa encontrar fretes próximos automaticamente.

#### Acceptance Criteria

1. WHEN a Motorista first accesses system, THE System SHALL request geolocation permission
2. WHEN geolocation permission is granted, THE System SHALL store current location
3. WHEN geolocation permission is denied, THE System SHALL prompt for manual location entry
4. WHEN a user manually enters location, THE System SHALL geocode address to coordinates
5. THE System SHALL allow user to update location at any time
6. WHEN calculating distances, THE System SHALL use stored or current location as reference
7. THE System SHALL display location accuracy indicator when using GPS
8. THE System SHALL update location periodically when user is active

### Requirement 26: Serialização e Persistência de Dados

**User Story:** Como desenvolvedor, quero que dados sejam serializados corretamente, para que não haja perda de informação entre cliente e servidor.

#### Acceptance Criteria

1. WHEN the System serializes user data to JSON, THE System SHALL include all required fields
2. WHEN the System deserializes JSON to user object, THE System SHALL validate data structure
3. WHEN the System stores frete data, THE System SHALL preserve geographic coordinates precision
4. WHEN the System retrieves frete data, THE System SHALL reconstruct complete object
5. FOR ALL valid system objects, serializing then deserializing SHALL produce equivalent object
6. THE System SHALL handle null and undefined values correctly during serialization
7. THE System SHALL validate JSON schema before deserialization
