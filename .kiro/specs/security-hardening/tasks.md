# Implementation Plan: Security Hardening - FreteGO

## Overview

Este plano implementa o fortalecimento de segurança do FreteGO em 5 fases incrementais, cobrindo validação de entrada, autenticação avançada, preparação para pagamentos, infraestrutura segura e testes de segurança.

## Tasks

### Fase 1: Validação de Entrada e Defesa Básica

- [x] 1. Criar InputValidator com sanitização SQL/XSS
  - [x] 1.1 Criar arquivo `src/utils/inputValidator.ts` com classe InputValidator
    - Implementar detecção de SQL keywords (SELECT, INSERT, UPDATE, DELETE, DROP, etc.)
    - Implementar detecção de padrões XSS (script tags, event handlers, javascript:)
    - Implementar método `sanitizeHTML()` para escapar caracteres especiais
    - Implementar método `validateText()` com regras de validação
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.4, 2.5_
  
  - [-] 1.2 Escrever property test para InputValidator
    - **Property 1: Input Sanitization**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.4, 2.5**
    - Testar que inputs com SQL keywords são rejeitados ou sanitizados
    - Testar que inputs com XSS patterns são sanitizados
    - `npm run test -- src/__tests__/inputValidator.property.test.ts`

- [x] 2. Criar FileValidatorAdvanced com magic bytes
  - [x] 2.1 Criar arquivo `src/utils/fileValidatorAdvanced.ts`
    - Implementar leitura de magic bytes (primeiros 8 bytes do arquivo)
    - Definir signatures para PDF (0x25, 0x50, 0x44, 0x46), JPEG (0xFF, 0xD8, 0xFF), PNG
    - Implementar validação de MIME type vs magic bytes
    - Implementar validação de extensão vs tipo detectado
    - Implementar verificação de tamanho máximo (10MB)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  
  - [ ]* 2.2 Escrever property test para FileValidatorAdvanced
    - **Property 3: File Validation by Magic Bytes**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
    - Testar que arquivos com magic bytes inválidos são rejeitados
    - Testar que MIME type deve corresponder aos magic bytes
    - `npm run test -- src/__tests__/fileValidatorAdvanced.property.test.ts`

- [x] 3. Implementar limites de caracteres em todos os campos
  - [x] 3.1 Criar constantes de limites em `src/utils/inputValidator.ts`
    - Definir MAX_FRETE_DESCRIPTION = 500
    - Definir MAX_USER_NAME = 200
    - Definir MAX_CHAT_MESSAGE = 1000
    - Definir MAX_RATING_COMMENT = 500
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6_
  
  - [x] 3.2 Integrar validação de limites nos formulários existentes
    - Atualizar FreteForm.tsx com validação de descrição
    - Atualizar ChatWidget.tsx com validação de mensagem
    - Atualizar RatingForm.tsx com validação de comentário
    - _Requirements: 5.2, 5.7_
  
  - [ ]* 3.3 Escrever property test para validação de limites
    - **Property 4: Input Length Validation**
    - **Validates: Requirements 5.2, 5.7**
    - `npm run test -- src/__tests__/inputLimits.property.test.ts`

- [x] 4. Criar CSRFTokenManager
  - [x] 4.1 Criar arquivo `src/services/csrfTokenManager.ts`
    - Implementar `generateToken()` usando crypto.getRandomValues
    - Implementar `getToken()` com armazenamento em sessionStorage
    - Implementar `validateToken()` para comparação
    - Implementar `addTokenToHeaders()` para requisições
    - Implementar `rotateToken()` após operações sensíveis
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
  
  - [ ]* 4.2 Escrever property test para CSRFTokenManager
    - **Property 2: CSRF Token Uniqueness and Validation**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5**
    - Testar que tokens gerados são únicos
    - Testar que tokens inválidos são rejeitados
    - `npm run test -- src/__tests__/csrfToken.property.test.ts`

- [x] 5. Checkpoint Fase 1 - Validação de Entrada
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que InputValidator está funcionando
  - Verificar que FileValidatorAdvanced valida magic bytes
  - Verificar que limites de caracteres estão aplicados
  - Verificar que CSRFTokenManager gera tokens únicos


### Fase 2: Autenticação e Gestão de Identidade

- [x] 6. Implementar anti-enumeração no login
  - [x] 6.1 Atualizar `src/services/auth.ts` com respostas uniformes
    - Retornar "Credenciais inválidas" para telefone inválido
    - Retornar "Credenciais inválidas" para senha inválida
    - Usar mesmo tempo de resposta para ambos os casos
    - Não revelar se telefone está registrado
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  
  - [ ]* 6.2 Escrever property test para anti-enumeração
    - **Property 22: Anti-Enumeration for Authentication**
    - **Validates: Requirements 6.1, 6.2, 6.4**
    - `npm run test -- src/__tests__/antiEnumeration.property.test.ts`

- [x] 7. Validar Bcrypt cost factor
  - [x] 7.1 Atualizar `src/utils/passwordHash.ts`
    - Verificar que cost factor é pelo menos 12
    - Adicionar constante BCRYPT_COST_FACTOR = 12
    - Documentar configuração atual
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Criar SessionManager com sessão única
  - [x] 8.1 Criar arquivo `src/services/sessionManager.ts`
    - Implementar `createSession()` que invalida sessões anteriores
    - Implementar `incrementSessionVersion()` no banco
    - Implementar `validateSession()` verificando session_version
    - Implementar `updateActivity()` para tracking de atividade
    - Implementar `checkSessionWarning()` para aviso 5 min antes de expirar
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  
  - [ ]* 8.2 Escrever property test para SessionManager
    - **Property 5: Single Session Enforcement**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**
    - Testar que novo login invalida sessões anteriores
    - Testar que sessão com version antiga é rejeitada
    - `npm run test -- src/__tests__/sessionManager.property.test.ts`

- [x] 9. Implementar revogação de JWT (blacklist)
  - [x] 9.1 Adicionar funcionalidade de blacklist ao SessionManager
    - Implementar `revokeSession()` que adiciona token à blacklist
    - Implementar `isTokenBlacklisted()` para verificação
    - Implementar limpeza de tokens expirados
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [ ]* 9.2 Escrever property test para JWT revocation
    - **Property 6: JWT Revocation on Logout**
    - **Validates: Requirements 9.1, 9.2, 9.3**
    - Testar que token revogado é rejeitado
    - `npm run test -- src/__tests__/jwtRevocation.property.test.ts`

- [x] 10. Criar BruteForceProtector
  - [x] 10.1 Criar arquivo `src/services/bruteForceProtector.ts`
    - Implementar `recordAttempt()` para registrar tentativas
    - Implementar `checkLockout()` para verificar bloqueio
    - Bloquear conta após 5 tentativas falhas por 30 minutos
    - Implementar `resetAttempts()` após login bem-sucedido
    - Implementar logging de eventos de lockout
    - _Requirements: 14.1, 14.2, 14.4, 14.5, 14.6_
  
  - [ ]* 10.2 Escrever property test para BruteForceProtector
    - **Property 9: Brute Force Protection**
    - **Validates: Requirements 14.1, 14.2, 14.4, 14.5, 14.6**
    - Testar que 5 falhas bloqueiam a conta
    - Testar que login bem-sucedido reseta contador
    - `npm run test -- src/__tests__/bruteForce.property.test.ts`

- [x] 11. Melhorar validação de senha
  - [x] 11.1 Atualizar `src/utils/passwordValidation.ts`
    - Exigir mínimo 8 caracteres (aumentar de 6)
    - Exigir pelo menos uma letra maiúscula
    - Exigir pelo menos uma letra minúscula
    - Exigir pelo menos um número
    - Exigir pelo menos um caractere especial
    - Retornar requisitos específicos não atendidos
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.7_
  
  - [ ]* 11.2 Escrever property test para validação de senha
    - **Property 13: Password Validation Enhancement**
    - **Validates: Requirements 23.1, 23.2, 23.3, 23.4, 23.5, 23.7**
    - `npm run test -- src/__tests__/passwordValidation.property.test.ts`

- [x] 12. Checkpoint Fase 2 - Autenticação
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que anti-enumeração está funcionando
  - Verificar que sessão única está implementada
  - Verificar que brute force protection bloqueia após 5 tentativas
  - Verificar que validação de senha está mais rigorosa


### Fase 3: Preparação para Pagamentos (UI apenas)

- [x] 13. Criar página "Meu Plano" para Motorista
  - [x] 13.1 Criar arquivo `src/pages/MotoristaPlanPage.tsx`
    - Criar layout da página com título "Meu Plano"
    - Exibir mensagem "Em breve" para funcionalidades de pagamento
    - Criar seção de planos disponíveis (placeholder)
    - Criar seção de histórico de pagamentos (placeholder)
    - _Requirements: 10.1, 10.3_
  
  - [x] 13.2 Adicionar rota para MotoristaPlanPage
    - Adicionar rota `/motorista/plano` em App.tsx
    - Adicionar link no menu de navegação do motorista
    - _Requirements: 10.1_

- [x] 14. Criar página "Meu Plano" para Embarcador
  - [x] 14.1 Criar arquivo `src/pages/EmbarcadorPlanPage.tsx`
    - Criar layout da página com título "Meu Plano"
    - Exibir mensagem "Em breve" para funcionalidades de pagamento
    - Criar seção de planos disponíveis (placeholder)
    - Criar seção de histórico de pagamentos (placeholder)
    - _Requirements: 10.2, 10.3_
  
  - [x] 14.2 Adicionar rota para EmbarcadorPlanPage
    - Adicionar rota `/embarcador/plano` em App.tsx
    - Adicionar link no menu de navegação do embarcador
    - _Requirements: 10.2_

- [x] 15. Criar código comentado para webhooks e transações atômicas
  - [x] 15.1 Criar arquivo `src/services/paymentPlaceholder.ts`
    - Adicionar código comentado para validação de webhook
    - Adicionar código comentado para transações atômicas
    - Adicionar código comentado para lógica de reembolso
    - Documentar requisitos de isolamento multi-tenant
    - _Requirements: 10.4, 10.5, 10.6, 10.7_

- [x] 16. Checkpoint Fase 3 - Preparação para Pagamentos
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que páginas "Meu Plano" estão acessíveis
  - Verificar que mensagem "Em breve" está exibida
  - Verificar que código comentado está documentado

### Fase 4: Infraestrutura Segura

- [x] 17. Criar RateLimiter por IP e por usuário
  - [x] 17.1 Criar arquivo `src/services/rateLimiter.ts`
    - Implementar limite de login: 5 por IP por 15 minutos
    - Implementar limite de API: 100 por IP por minuto
    - Implementar limite de criação de frete: 10 por usuário por hora
    - Implementar limite de upload: 20 por usuário por hora
    - Implementar limite de chat: 100 por usuário por hora
    - Implementar sliding window algorithm
    - Retornar 429 com header Retry-After quando excedido
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 13.1, 13.2, 13.3, 13.4, 13.5_
  
  - [ ]* 17.2 Escrever property test para RateLimiter
    - **Property 7: Rate Limiting by IP**
    - **Property 8: Rate Limiting by User**
    - **Validates: Requirements 12.1-12.4, 13.1-13.5**
    - `npm run test -- src/__tests__/rateLimiter.property.test.ts`

- [x] 18. Criar AuditLogger
  - [x] 18.1 Criar arquivo `src/services/auditLogger.ts`
    - Implementar `logSecurityEvent()` para eventos de segurança
    - Implementar `logUserAction()` para ações de usuário
    - Implementar `logLogin()` e `logLogout()`
    - Implementar `logFileUpload()`
    - Implementar `logUnauthorizedAccess()`
    - Implementar `logSQLInjectionAttempt()` e `logXSSAttempt()`
    - Implementar `logRateLimitViolation()`
    - Implementar `logHoneypotTrigger()`
    - Configurar retenção de 90 dias
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9_
  
  - [ ]* 18.2 Escrever property test para AuditLogger
    - **Property 11: Audit Logging Completeness**
    - **Validates: Requirements 17.1-17.9**
    - `npm run test -- src/__tests__/auditLogger.property.test.ts`

- [x] 19. Criar HoneypotDetector
  - [x] 19.1 Criar arquivo `src/services/honeypotDetector.ts`
    - Implementar `recordTrigger()` para registrar acionamentos
    - Implementar `isBlocked()` para verificar IPs bloqueados
    - Bloquear IP após 3 acionamentos
    - Implementar `createFieldHoneypot()` para campos ocultos
    - Implementar `validateField()` para detectar bots
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_
  
  - [x] 19.2 Adicionar honeypot route `/admin-legacy`
    - Criar rota oculta que aciona alerta quando acessada
    - Registrar IP, user_agent e timestamp
    - _Requirements: 20.1, 20.3_
  
  - [x] 19.3 Adicionar honeypot fields nos formulários
    - Adicionar campo oculto em LoginForm.tsx
    - Adicionar campo oculto em RegisterForm.tsx
    - Usar CSS display:none e aria-hidden
    - _Requirements: 20.2, 20.6_
  
  - [ ]* 19.4 Escrever property test para HoneypotDetector
    - **Property 12: Honeypot Detection and Blocking**
    - **Validates: Requirements 20.1-20.5**
    - `npm run test -- src/__tests__/honeypot.property.test.ts`

- [x] 20. Implementar headers de segurança
  - [x] 20.1 Criar arquivo `src/utils/securityHeaders.ts`
    - Definir Content-Security-Policy header
    - Definir X-Content-Type-Options: nosniff
    - Definir X-Frame-Options: DENY
    - Definir X-XSS-Protection: 1; mode=block
    - Definir Strict-Transport-Security com max-age 31536000
    - Definir Referrer-Policy: strict-origin-when-cross-origin
    - Definir Permissions-Policy
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 26.1, 26.2, 26.3, 26.4, 26.5, 26.6_
  
  - [x] 20.2 Configurar headers no vercel.json
    - Adicionar headers de segurança na configuração do Vercel
    - _Requirements: 25.1, 26.1_

- [x] 21. Criar URL Sanitizer
  - [x] 21.1 Adicionar validação de URL ao InputValidator
    - Implementar `validateURL()` com validação de formato
    - Bloquear protocolo javascript:
    - Bloquear protocolo data:
    - Bloquear protocolo file:
    - Adicionar rel="noopener noreferrer" em links externos
    - _Requirements: 15.1, 15.2, 15.3, 15.4_
  
  - [ ]* 21.2 Escrever property test para URL Sanitizer
    - **Property 10: URL Sanitization**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.6**
    - `npm run test -- src/__tests__/urlSanitizer.property.test.ts`

- [x] 22. Criar migrations SQL para novas tabelas
  - [x] 22.1 Criar arquivo `supabase/migrations/005_security_tables.sql`
    - Adicionar coluna session_version na tabela users
    - Criar tabela session_blacklist
    - Criar tabela rate_limits
    - Criar tabela login_attempts
    - Criar tabela account_lockouts
    - Criar tabela honeypot_triggers
    - Criar tabela blocked_ips
    - Criar tabela mfa_secrets (preparação)
    - Criar índices necessários
    - _Requirements: 8.5, 9.5, 12.6, 35.1_

- [x] 23. Criar documentação de WAF e Docker
  - [x] 23.1 Criar arquivo `docs/WAF_RECOMMENDATIONS.md`
    - Documentar configuração recomendada do Cloudflare WAF
    - Documentar regras para SQL injection
    - Documentar regras para XSS
    - Documentar regras para DDoS protection
    - Documentar estimativas de custo
    - Documentar passos de integração
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6_
  
  - [x] 23.2 Criar arquivo `docs/DOCKER_HARDENING.md`
    - Documentar uso de usuários não-root
    - Documentar filesystem read-only
    - Documentar gerenciamento de secrets
    - Documentar isolamento de rede
    - Documentar scanning de imagens
    - Documentar imagens base mínimas (Alpine, Distroless)
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6_

- [x] 24. Checkpoint Fase 4 - Infraestrutura Segura
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que RateLimiter está funcionando
  - Verificar que AuditLogger registra eventos
  - Verificar que HoneypotDetector detecta bots
  - Verificar que headers de segurança estão configurados
  - Verificar que migrations SQL estão corretas


### Fase 5: Testes de Segurança

- [x] 25. Testes de acesso não autorizado
  - [x] 25.1 Criar arquivo `src/__tests__/security/unauthorizedAccess.test.ts`
    - Testar que User A não pode ler documentos de User B
    - Testar que User A não pode atualizar perfil de User B
    - Testar que User A não pode deletar fretes de User B
    - Testar que não-admin não pode acessar endpoints admin
    - Testar que usuários não autenticados não acessam recursos protegidos
    - Testar que motoristas não podem criar fretes
    - Testar que embarcadores não podem avaliar outros embarcadores
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_
    - `npm run test -- src/__tests__/security/unauthorizedAccess.test.ts`

- [x] 26. Testes de penetração simulados
  - [x] 26.1 Criar arquivo `src/__tests__/security/penetrationTests.test.ts`
    - Testar SQL injection em todos os campos de input
    - Testar XSS injection em mensagens de chat
    - Testar CSRF attacks em endpoints state-changing
    - Testar upload de arquivos com payloads maliciosos
    - Testar bypass de autenticação via query parameters
    - Testar tentativas de privilege escalation
    - Testar bypass de rate limit
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_
    - `npm run test -- src/__tests__/security/penetrationTests.test.ts`
  
  - [x] 26.2 Criar arquivo `docs/SECURITY_TEST_REPORT.md`
    - Documentar resultados de todos os testes
    - Documentar vulnerabilidades encontradas
    - Documentar remediações aplicadas
    - _Requirements: 19.8_

- [x] 27. Dashboard de monitoramento de segurança
  - [x] 27.1 Criar arquivo `src/pages/SecurityDashboardPage.tsx`
    - Exibir tentativas de login falhas nas últimas 24 horas
    - Exibir violações de rate limit nas últimas 24 horas
    - Exibir acionamentos de honeypot nas últimas 24 horas
    - Exibir rejeições de upload de arquivo nas últimas 24 horas
    - Exibir top IPs por requisições falhas
    - Exibir timeline de eventos de segurança
    - _Requirements: 40.1, 40.2, 40.3, 40.4, 40.5, 40.6_
  
  - [x] 27.2 Implementar sistema de alertas
    - Criar notificações quando thresholds são excedidos
    - Integrar com AuditLogger para dados em tempo real
    - _Requirements: 40.7_
  
  - [x] 27.3 Adicionar rota para SecurityDashboardPage
    - Adicionar rota `/admin/security` em App.tsx
    - Restringir acesso apenas para administradores
    - _Requirements: 40.1_

- [x] 28. Validação de RLS em todas as tabelas
  - [x] 28.1 Criar arquivo `src/__tests__/security/rlsValidation.test.ts`
    - Testar RLS na tabela users
    - Testar RLS na tabela motoristas
    - Testar RLS na tabela embarcadores
    - Testar RLS na tabela fretes
    - Testar RLS na tabela documents
    - Testar RLS na tabela chat_messages
    - Testar RLS na tabela chat_conversations
    - Testar RLS na tabela notifications
    - Testar RLS na tabela audit_logs
    - Testar RLS na tabela avaliacoes
    - Testar RLS na tabela frete_clicks
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11_
    - `npm run test -- src/__tests__/security/rlsValidation.test.ts`

- [x] 29. Checkpoint Final - Testes de Segurança
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que todos os testes de acesso não autorizado passam
  - Verificar que todos os testes de penetração passam
  - Verificar que dashboard de segurança está funcional
  - Verificar que RLS está validado em todas as tabelas
  - Revisar relatório de segurança

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at the end of each phase
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- O projeto usa TypeScript + React + Vite no frontend e Supabase no backend
- Todas as implementações devem seguir os padrões existentes no codebase
- Testes devem ser executados com `npm run test` ou `vitest --run`

