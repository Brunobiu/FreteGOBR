# Implementation Plan: FreteGO

## Overview

Este plano divide a implementação do FreteGO em 25 fases incrementais e independentes. Cada fase entrega funcionalidade completa e testável, permitindo validação contínua do progresso. O desenvolvimento segue a ordem: infraestrutura → autenticação → funcionalidades core → features avançadas → polish.

## Tasks

- [x] 1. Setup inicial do projeto e configuração do ambiente
  - Criar projeto React com Vite e TypeScript
  - Configurar Tailwind CSS
  - Configurar ESLint, Prettier, e Husky
  - Criar estrutura de pastas (src/components, src/services, src/hooks, src/types, src/utils)
  - Configurar variáveis de ambiente (.env.example)
  - _Requirements: 23.1, 23.2, 23.3_
  - **RODAR TESTES**: `npm test -- --run`

- [x] 2. Configuração do Supabase e banco de dados
  - [x] 2.1 Criar projeto no Supabase
    - Configurar projeto no Supabase Cloud
    - Obter credenciais (URL, anon key, service key)
    - Configurar variáveis de ambiente no projeto
    - _Requirements: 1.1, 1.2_
  
  - [x] 2.2 Criar schema do banco de dados
    - Executar SQL para criar tabelas (users, motoristas, embarcadores, fretes, etc.)
    - Criar índices para performance
    - Configurar extensões necessárias (uuid, postgis)
    - _Requirements: 26.1, 26.2, 26.3_
  
  - [x] 2.3 Implementar Row Level Security (RLS)
    - Criar policies para tabela users
    - Criar policies para tabela fretes
    - Criar policies para tabela documents
    - Criar policies para tabela chat_messages
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  
  - [ ]* 2.4 Escrever testes de property para RLS
    - **Property 4: RLS Document Isolation**
    - **Validates: Requirements 2.1**
  
  - [ ]* 2.5 Escrever testes de property para acesso público
    - **Property 5: Public Frete Access**
    - **Validates: Requirements 2.6**
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 3. Database Functions e Triggers
  - [x] 3.1 Criar função update_embarcador_rating
    - Implementar função SQL para recalcular rating
    - Criar trigger após INSERT/UPDATE em avaliacoes
    - _Requirements: 9.3, 9.4_
  
  - [x] 3.2 Criar função increment_frete_views
    - Implementar função SQL para incrementar views
    - _Requirements: 6.7_
  
  - [x] 3.3 Criar função record_frete_click
    - Implementar função SQL para registrar cliques
    - Prevenir duplicatas com UNIQUE constraint
    - _Requirements: 6.6, 8.2, 8.4_
  
  - [x] 3.4 Criar função find_nearby_fretes
    - Implementar busca geográfica com ST_DWithin
    - Ordenar por distância
    - _Requirements: 11.2, 11.3_
  
  - **RODAR TESTES**: `npm test -- --run`



- [x] 4. Sistema de autenticação - Backend
  - [x] 4.1 Configurar Supabase Auth
    - Habilitar autenticação por telefone/senha
    - Configurar JWT settings
    - Configurar refresh tokens
    - _Requirements: 1.2, 1.4_
  
  - [x] 4.2 Implementar validação de senha
    - Criar função validatePassword com regras (6+ chars, 1+ letra, 1+ número)
    - Criar interface PasswordValidation
    - _Requirements: 1.6, 3.3, 3.4_
  
  - [x]* 4.3 Escrever testes de property para validação de senha
    - **Property 2: Password Validation Rules**
    - **Validates: Requirements 1.6, 3.3, 3.4**
  
  - [x] 4.4 Implementar hash de senha com bcrypt
    - Criar função hashPassword
    - Criar função verifyPassword
    - _Requirements: 1.1_
  
  - [x]* 4.5 Escrever testes de property para hashing
    - **Property 1: Password Hashing Verification**
    - **Validates: Requirements 1.1**
  
  - [x] 4.6 Criar AuthService
    - Implementar register(data: RegisterData)
    - Implementar login(credentials: LoginCredentials)
    - Implementar logout(userId: string)
    - Implementar refreshToken(refreshToken: string)
    - _Requirements: 3.1, 3.2, 3.7, 1.5_
  
  - [ ]* 4.7 Escrever testes unitários para AuthService
    - Testar registro com dados válidos
    - Testar login com credenciais corretas
    - Testar rejeição de senha inválida
    - Testar unicidade de telefone
    - _Requirements: 3.2, 3.3, 3.4_
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 5. Sistema de autenticação - Frontend
  - [x] 5.1 Criar componente LoginForm
    - Implementar formulário com React Hook Form + Zod
    - Validação em tempo real
    - Tratamento de erros
    - _Requirements: 3.7_
  
  - [x] 5.2 Criar componente RegisterForm
    - Seleção de tipo de usuário (motorista/embarcador)
    - Validação de telefone e senha
    - Feedback visual de validação
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [x] 5.3 Criar hook useAuth
    - Gerenciar estado de autenticação
    - Armazenar token no localStorage
    - Auto-refresh de token
    - _Requirements: 1.2, 1.4_
  
  - [x] 5.4 Implementar ProtectedRoute
    - Verificar token antes de renderizar
    - Redirecionar para login se não autenticado
    - _Requirements: 1.3_
  
  - [ ]* 5.5 Escrever testes de integração para fluxo de auth
    - Testar registro completo
    - Testar login e logout
    - Testar proteção de rotas
    - _Requirements: 3.1, 3.7, 1.3_
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 6. Checkpoint - Autenticação funcionando
  - Verificar que registro, login e logout funcionam
  - Verificar que rotas protegidas bloqueiam acesso não autenticado
  - Verificar que RLS está ativo no banco
  - Ensure all tests pass, ask the user if questions arise.
  - **RODAR TESTES**: `npm test -- --run`

- [x] 7. Gestão de documentos - Backend
  - [x] 7.1 Configurar Supabase Storage
    - Criar bucket 'documents' privado
    - Configurar políticas de acesso
    - _Requirements: 1.10, 19.1, 19.2_
  
  - [x] 7.2 Implementar DocumentService
    - Implementar uploadDocument(userId, documentType, file)
    - Implementar getDocumentsByUser(userId)
    - Implementar deleteDocument(documentId)
    - Implementar getSignedUrl(documentId)
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_
  
  - [x] 7.3 Implementar validação de arquivos
    - Validar tipo de arquivo (PDF, JPG, PNG)
    - Validar tamanho máximo (10MB)
    - _Requirements: 19.8, 19.9_
  
  - [x]* 7.4 Escrever testes de property para validação de arquivos
    - **Property 15: File Size Validation**
    - **Property 16: File Format Validation**
    - **Validates: Requirements 19.8, 19.9**
  
  - [ ]* 7.5 Escrever testes de property para signed URLs
    - **Property 7: Signed URL Expiration**
    - **Validates: Requirements 4.8**
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 8. Gestão de documentos - Frontend
  - [x] 8.1 Criar componente DocumentUpload
    - Drag & drop de arquivos
    - Preview de imagens
    - Progress bar de upload
    - Lista de documentos existentes
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_
  
  - [x] 8.2 Integrar upload no perfil do Motorista
    - Seções para CPF, CNH, ANTT, documentos do veículo, foto
    - Validação de formatos
    - Feedback de sucesso/erro
    - _Requirements: 4.1, 4.2, 4.3, 4.5_
  
  - [ ]* 8.3 Escrever testes unitários para DocumentUpload
    - Testar validação de formato
    - Testar validação de tamanho
    - Testar upload bem-sucedido
    - _Requirements: 19.8, 19.9_
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 9. Perfil do Motorista
  - [x] 9.1 Criar componente MotoristaProfile
    - Formulário de edição de perfil
    - Upload de foto de perfil
    - Campos: nome, email, CPF, tipo de veículo
    - _Requirements: 4.4, 4.5, 4.7_
  
  - [x] 9.2 Criar página MotoristaDashboard
    - Header com nome e foto no canto superior direito
    - Navegação para perfil, fretes, calculadora
    - _Requirements: 4.6_
  
  - [ ]* 9.3 Escrever testes de integração para perfil
    - Testar atualização de dados
    - Testar upload de documentos
    - _Requirements: 4.5_
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 10. Perfil do Embarcador
  - [x] 10.1 Criar componente EmbarcadorProfile
    - Formulário de edição de perfil
    - Campos: nome, nome da empresa, WhatsApp, email
    - Upload de foto de perfil
    - _Requirements: 5.1, 5.2, 5.4_
  
  - [x] 10.2 Criar página EmbarcadorDashboard
    - Header com nome da empresa e foto
    - Navegação para perfil, meus fretes, postar frete
    - _Requirements: 5.3_
  
  - [x] 10.3 Criar página de perfil público do Embarcador
    - Exibir nome da empresa, rating, fretes ativos
    - Exibir avaliações recebidas
    - _Requirements: 5.5, 5.6_
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 11. Gestão de Fretes - Backend
  - [x] 11.1 Implementar FreteService
    - Implementar createFrete(embarcadorId, data)
    - Implementar updateFrete(freteId, data)
    - Implementar deleteFrete(freteId)
    - Implementar getFreteById(freteId)
    - Implementar getActiveFretes(filters)
    - Implementar getFretesByEmbarcador(embarcadorId)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [x] 11.2 Implementar sistema de cliques
    - Usar função record_frete_click do banco
    - Prevenir cliques duplicados
    - _Requirements: 6.6, 8.2, 8.4_
  
  - [ ]* 11.3 Escrever testes de property para cliques
    - **Property 8: Frete Click Counter Increment**
    - **Validates: Requirements 6.6**
  
  - [x] 11.4 Implementar analytics de fretes
    - Retornar views_count e clicks_count
    - _Requirements: 6.7_
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 12. Gestão de Fretes - Frontend
  - [x] 12.1 Criar componente FreteForm
    - Formulário completo com todos os campos
    - Validação com Zod
    - Seleção de origem/destino com autocomplete
    - _Requirements: 6.1, 6.8, 6.9_
  
  - [x] 12.2 Criar componente FreteCard
    - Exibir informações resumidas do frete
    - Botão "Ver detalhes"
    - Esconder telefone para visitantes
    - _Requirements: 7.2, 7.3_
  
  - [x] 12.3 Criar componente FreteModal
    - Exibir informações completas
    - Botão "Contratar" (redireciona visitantes para login)
    - Abrir WhatsApp para motoristas autenticados
    - _Requirements: 7.4, 8.1, 8.5_
  
  - [x] 12.4 Criar página de listagem de fretes
    - Grid de FreteCards
    - Paginação
    - _Requirements: 7.1_
  
  - [ ]* 12.5 Escrever testes de integração para gestão de fretes
    - Testar criação de frete
    - Testar edição e exclusão
    - Testar visualização pública
    - _Requirements: 6.1, 6.2, 6.5, 7.1_
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 13. Sistema de filtros
  - [x] 13.1 Criar componente FreteFilters
    - Filtros: origem, destino, tipo de carga, tipo de veículo, peso, valor
    - Aplicar filtros em tempo real
    - Botão "Limpar filtros"
    - _Requirements: 7.5, 7.6, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.9_
  
  - [x] 13.2 Implementar lógica de filtros no backend
    - Aplicar múltiplos filtros com lógica AND
    - Retornar contagem de resultados
    - _Requirements: 21.7, 21.8_
  
  - [x]* 13.3 Escrever testes de property para filtros
    - **Property 9: Filter Matching**
    - **Property 20: Filter Composition (AND Logic)**
    - **Validates: Requirements 7.5, 21.7**
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 14. Checkpoint - Fretes funcionando
  - Verificar que embarcador pode postar, editar e deletar fretes
  - Verificar que visitantes podem ver fretes sem autenticação
  - Verificar que filtros funcionam corretamente
  - Ensure all tests pass, ask the user if questions arise.
  - **RODAR TESTES**: `npm test -- --run`



- [x] 15. Mapa interativo
  - [x] 15.1 Configurar Leaflet
    - Instalar react-leaflet
    - Configurar mapa base (OpenStreetMap)
    - _Requirements: 10.1_
  
  - [x] 15.2 Criar componente InteractiveMap
    - Renderizar mapa com marcadores de fretes
    - Implementar clustering para múltiplos fretes no mesmo local
    - _Requirements: 10.1, 10.6_
  
  - [x] 15.3 Criar componente FreteMarker
    - Popup com resumo do frete ao clicar
    - Link para abrir modal com detalhes completos
    - _Requirements: 10.2, 10.3_
  
  - [x] 15.4 Implementar atualização em tempo real
    - Usar Supabase Realtime para novos fretes
    - Adicionar marcadores dinamicamente
    - _Requirements: 10.4_
  
  - [ ]* 15.5 Escrever testes unitários para mapa
    - Testar renderização de marcadores
    - Testar clustering
    - _Requirements: 10.1, 10.6_
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 16. Sistema de geolocalização
  - [x] 16.1 Implementar GeolocationService
    - Implementar geocodeAddress(address)
    - Implementar reverseGeocode(point)
    - Implementar calculateDistance(point1, point2)
    - Usar API de geocoding (Nominatim ou Google Maps)
    - _Requirements: 25.4, 25.6_
  
  - [x] 16.2 Criar hook useGeolocation
    - Solicitar permissão de localização
    - Armazenar localização atual
    - Permitir entrada manual se negado
    - _Requirements: 25.1, 25.2, 25.3, 25.5_
  
  - [x]* 16.3 Escrever testes de property para geocoding
    - **Property 17: Geocoding Validity**
    - **Validates: Requirements 25.4**
  
  - [ ]* 16.4 Escrever testes unitários para geolocalização
    - Testar solicitação de permissão
    - Testar fallback para entrada manual
    - _Requirements: 25.1, 25.3_
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 17. Sugestão de viagem
  - [x] 17.1 Implementar findNearbyFretes no backend
    - Usar função SQL find_nearby_fretes
    - Ordenar por proximidade
    - Limitar raio de busca (ex: 100km)
    - _Requirements: 11.2, 11.3, 11.6_
  
  - [x] 17.2 Criar componente TripSuggestion
    - Botão "Me sugerir uma viagem"
    - Solicitar localização ao clicar
    - Exibir fretes próximos com distância
    - _Requirements: 11.1, 11.4, 11.5_
  
  - [x]* 17.3 Escrever testes de property para ordenação por distância
    - **Property 12: Distance-Based Sorting**
    - **Validates: Requirements 11.3**
  
  - **RODAR TESTES**: `npm test -- --run`

- [x] 18. Calculadora de frete
  - [x] 18.1 Implementar cálculo de rotas
    - Calcular distância total
    - Estimar tempo de viagem
    - Calcular dias totais (viagem + carga/descarga)
    - Calcular lucro por dia
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6_
  
  - [x] 18.2 Criar componente FreteCalculator
    - Permitir seleção de até 5 fretes
    - Exibir comparação lado a lado
    - Usar localização atual ou manual
    - _Requirements: 12.1, 12.7, 12.8_
  
  - [ ]* 18.3 Escrever testes de property para cálculo de distância
    - **Property 13: Route Distance Calculation Consistency**
    - **Validates: Requirements 12.2**
  
  - [ ]* 18.4 Escrever testes unitários para calculadora
    - Testar cálculo de dias totais
    - Testar cálculo de lucro por dia
    - _Requirements: 12.5, 12.6_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 19. Sistema de avaliação
  - [ ] 19.1 Implementar RatingService
    - Implementar createRating(motoristaId, embarcadorId, rating, comment)
    - Implementar getRatingsByEmbarcador(embarcadorId)
    - Implementar hasRated(motoristaId, embarcadorId)
    - _Requirements: 9.1, 9.2, 9.6_
  
  - [ ] 19.2 Criar componente RatingForm
    - Seleção de estrelas (1-5)
    - Campo opcional para comentário
    - Validação
    - _Requirements: 9.1, 9.2_
  
  - [ ] 19.3 Criar componente RatingDisplay
    - Exibir média de avaliações
    - Listar todas as avaliações com comentários
    - _Requirements: 9.5_
  
  - [ ]* 19.4 Escrever testes de property para cálculo de rating
    - **Property 10: Rating Average Calculation**
    - **Validates: Requirements 9.3**
  
  - [ ]* 19.5 Escrever testes de property para duplicatas
    - **Property 11: Duplicate Rating Prevention**
    - **Validates: Requirements 9.6**
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 20. Checkpoint - Features principais completas
  - Verificar que mapa exibe fretes corretamente
  - Verificar que sugestão de viagem funciona
  - Verificar que calculadora compara rotas
  - Verificar que sistema de avaliação funciona
  - Ensure all tests pass, ask the user if questions arise.
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 21. Chat de suporte - Backend
  - [ ] 21.1 Implementar ChatService
    - Implementar createConversation(userId)
    - Implementar sendMessage(conversationId, senderId, message, isAdmin)
    - Implementar getMessages(conversationId)
    - Implementar markMessagesAsRead(conversationId, userId)
    - Implementar updateConversationStatus(conversationId, status)
    - _Requirements: 13.1, 13.2, 13.5, 13.8_
  
  - [ ] 21.2 Configurar Supabase Realtime para chat
    - Habilitar Realtime no canal de chat_messages
    - Implementar listeners para novas mensagens
    - _Requirements: 13.2, 13.3_
  
  - [ ]* 21.3 Escrever testes de property para persistência de mensagens
    - **Property 14: Chat Message Persistence**
    - **Validates: Requirements 13.7**
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 22. Chat de suporte - Frontend
  - [ ] 22.1 Criar componente ChatWidget
    - Botão flutuante de suporte
    - Badge de notificações não lidas
    - _Requirements: 13.1, 13.4_
  
  - [ ] 22.2 Criar componente ChatWindow
    - Interface de chat com histórico
    - Input para enviar mensagens
    - Indicador "digitando..."
    - Upload opcional de imagens
    - _Requirements: 13.2, 13.5, 13.6, 13.9_
  
  - [ ] 22.3 Criar AdminChatDashboard
    - Lista de conversas ativas
    - Notificações de novas mensagens
    - Filtros por status
    - Marcar como resolvido
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8_
  
  - [ ]* 22.4 Escrever testes de integração para chat
    - Testar envio e recebimento de mensagens
    - Testar notificações
    - Testar marcação como lida
    - _Requirements: 13.2, 13.3, 13.8_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 23. Sistema de notificações
  - [ ] 23.1 Implementar NotificationService
    - Criar notificação para novo frete
    - Criar notificação para clique em frete
    - Criar notificação para resposta de suporte
    - Criar notificação para nova avaliação
    - _Requirements: 18.1, 18.2, 18.3, 18.4_
  
  - [ ] 23.2 Criar componente NotificationBell
    - Badge com contagem de não lidas
    - Dropdown com lista de notificações
    - Marcar como lida ao clicar
    - _Requirements: 18.5, 18.6_
  
  - [ ] 23.3 Implementar navegação por notificações
    - Redirecionar para página relevante ao clicar
    - _Requirements: 18.6_
  
  - [ ]* 23.4 Escrever testes unitários para notificações
    - Testar criação de notificações
    - Testar marcação como lida
    - _Requirements: 18.5, 18.6, 18.7_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 24. Dashboard Admin - Métricas
  - [ ] 24.1 Implementar AnalyticsService
    - Implementar getPlatformMetrics()
    - Implementar getUserGrowth(startDate, endDate)
    - Implementar getFreteGrowth(startDate, endDate)
    - Implementar getOnlineUsers()
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.9_
  
  - [ ] 24.2 Criar componente AdminDashboard
    - Cards com métricas principais
    - Gráficos de crescimento (usar recharts ou similar)
    - Atualização em tempo real
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_
  
  - [ ]* 24.3 Escrever testes unitários para analytics
    - Testar cálculo de métricas
    - Testar agregação de dados
    - _Requirements: 14.1, 14.2, 14.3_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 25. Dashboard Admin - Gerenciamento
  - [ ] 25.1 Criar página de gerenciamento de usuários
    - Lista de todos os usuários
    - Filtros e busca
    - Ações: visualizar, editar, desativar
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
  
  - [ ] 25.2 Criar página de gerenciamento de fretes
    - Lista de todos os fretes
    - Filtros por status, data, valor
    - Ações: visualizar, editar, remover
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_
  
  - [ ] 25.3 Criar página de logs e auditoria
    - Lista de eventos do sistema
    - Filtros por data e tipo
    - Exibir detalhes de cada evento
    - _Requirements: 22.4, 22.5, 22.6_
  
  - [ ]* 25.4 Escrever testes de integração para admin
    - Testar gerenciamento de usuários
    - Testar gerenciamento de fretes
    - _Requirements: 15.5, 15.6, 16.4, 16.5_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 26. Configurações de conta
  - [ ] 26.1 Criar página de configurações
    - Seção para trocar senha
    - Seção para atualizar dados do perfil
    - Seção para gerenciar notificações
    - Opção de excluir conta
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_
  
  - [ ]* 26.2 Escrever testes unitários para configurações
    - Testar troca de senha
    - Testar atualização de perfil
    - _Requirements: 20.1, 20.2_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 27. Segurança e sanitização
  - [ ] 27.1 Implementar sanitização de inputs
    - Prevenir SQL injection
    - Prevenir XSS
    - _Requirements: 1.7_
  
  - [ ] 27.2 Configurar headers de segurança
    - CORS
    - CSP (Content Security Policy)
    - HSTS
    - X-Frame-Options
    - _Requirements: 1.9_
  
  - [ ] 27.3 Implementar rate limiting
    - Limitar requisições por IP
    - Prevenir DDoS
    - _Requirements: 1.8_
  
  - [ ]* 27.4 Escrever testes de property para SQL injection
    - **Property 3: SQL Injection Prevention**
    - **Validates: Requirements 1.7**
  
  - [ ]* 27.5 Escrever testes de segurança
    - Testar acesso não autorizado
    - Testar proteção de rotas
    - _Requirements: 1.3, 2.4_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 28. Logs e auditoria
  - [ ] 28.1 Implementar sistema de logs
    - Registrar logins e tentativas falhas
    - Registrar acessos não autorizados
    - Registrar modificações de dados
    - _Requirements: 22.1, 22.2, 22.3, 22.7_
  
  - [ ] 28.2 Configurar retenção de logs
    - Manter logs por 90 dias
    - _Requirements: 22.8_
  
  - [ ]* 28.3 Escrever testes unitários para logging
    - Testar registro de eventos
    - Testar retenção de logs
    - _Requirements: 22.1, 22.7_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 29. Tratamento de erros
  - [ ] 29.1 Implementar error handlers globais
    - Frontend: ErrorBoundary
    - Backend: middleware de erro
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5_
  
  - [ ] 29.2 Implementar retry logic
    - Retry com exponential backoff para operações de rede
    - Circuit breaker para serviços externos
    - _Requirements: 24.6_
  
  - [ ]* 29.3 Escrever testes unitários para error handling
    - Testar diferentes tipos de erro
    - Testar retry logic
    - _Requirements: 24.1, 24.6_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 30. Serialização e validação
  - [ ] 30.1 Implementar schemas Zod para todos os tipos
    - Schema para User, Motorista, Embarcador, Frete
    - Validação em formulários
    - Validação em API
    - _Requirements: 26.1, 26.2, 26.7_
  
  - [ ]* 30.2 Escrever testes de property para serialização
    - **Property 18: Serialization Round Trip**
    - **Validates: Requirements 26.5**
  
  - [ ]* 30.3 Escrever testes unitários para validação
    - Testar schemas Zod
    - Testar validação de campos
    - _Requirements: 26.1, 26.2_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 31. Checkpoint - Sistema completo
  - Verificar que todas as funcionalidades estão implementadas
  - Verificar que todos os testes passam
  - Verificar segurança e performance
  - Ensure all tests pass, ask the user if questions arise.
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 32. Otimização de performance
  - [ ] 32.1 Implementar lazy loading
    - Lazy load de componentes
    - Lazy load de imagens
    - _Requirements: 23.6_
  
  - [ ] 32.2 Implementar caching
    - Cache de queries com React Query
    - Cache de assets estáticos
    - _Requirements: 23.7_
  
  - [ ] 32.3 Otimizar imagens
    - Compressão de imagens
    - Formatos modernos (WebP)
    - _Requirements: 23.8_
  
  - [ ]* 32.4 Escrever testes de performance
    - Testar tempo de carregamento de páginas
    - Testar tempo de resposta de APIs
    - _Requirements: 23.4, 23.5_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 33. Responsividade
  - [ ] 33.1 Implementar layouts responsivos
    - Mobile-first design
    - Breakpoints para tablet e desktop
    - _Requirements: 23.1, 23.2, 23.3_
  
  - [ ]* 33.2 Escrever testes de responsividade
    - Testar em diferentes tamanhos de tela
    - _Requirements: 23.1, 23.2, 23.3_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 34. Testes E2E
  - [ ]* 34.1 Escrever testes E2E com Playwright
    - Fluxo completo do motorista (registro → busca → contratação)
    - Fluxo completo do embarcador (registro → postar frete → analytics)
    - Fluxo do admin (gerenciamento de usuários e fretes)
    - _Requirements: 3.1, 6.1, 14.1, 15.1, 16.1_
  
  - **RODAR TESTES**: `npm test -- --run`

- [ ] 35. Deploy e CI/CD
  - [ ] 35.1 Configurar deploy no Vercel
    - Conectar repositório GitHub
    - Configurar variáveis de ambiente
    - Configurar domínio
  
  - [ ] 35.2 Configurar CI/CD
    - GitHub Actions para rodar testes
    - Deploy automático em merge para main
    - Preview deploys para PRs
  
  - [ ] 35.3 Configurar monitoramento
    - Error tracking (Sentry ou similar)
    - Analytics (Google Analytics ou similar)
    - Performance monitoring
  
  - **RODAR TESTES**: `npm test -- --run`

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam propriedades universais de corretude
- Unit tests validam exemplos específicos e edge cases
- Testes E2E validam fluxos completos de usuário
