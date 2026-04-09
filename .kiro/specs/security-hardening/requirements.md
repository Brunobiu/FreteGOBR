# Requirements Document: Security Hardening - FreteGO

## Introduction

Este documento define os requisitos de segurança para o sistema FreteGO, uma plataforma de fretes que conecta motoristas e embarcadores. O sistema já possui autenticação básica, RLS (Row-Level Security), upload de documentos, chat e notificações implementados. Este projeto visa fortalecer a segurança em 5 fases incrementais: validação de entrada, autenticação avançada, preparação para pagamentos, infraestrutura segura, e testes de segurança.

O sistema utiliza React + TypeScript + Vite no frontend e Supabase (PostgreSQL + Auth + Storage) no backend. Os usuários incluem Motoristas, Embarcadores e Administradores.

## Glossary

- **FreteGO_System**: A plataforma completa de fretes incluindo frontend, backend e banco de dados
- **Input_Validator**: Componente responsável por sanitizar e validar todas as entradas de usuário
- **File_Validator**: Componente responsável por validar arquivos por magic bytes e MIME type
- **Auth_Service**: Serviço de autenticação do Supabase com extensões customizadas
- **Session_Manager**: Componente que gerencia sessões de usuário e tokens JWT
- **Rate_Limiter**: Componente que controla taxa de requisições por IP e por usuário
- **Audit_Logger**: Sistema que registra eventos de segurança e ações de usuários
- **RLS_Engine**: Row-Level Security engine do PostgreSQL/Supabase
- **Payment_Placeholder**: Interface de UI preparada para futura integração de pagamentos
- **Brute_Force_Protector**: Sistema que detecta e bloqueia tentativas de força bruta
- **URL_Sanitizer**: Componente que valida e sanitiza URLs externas
- **Honeypot**: Armadilha para detectar bots e atacantes
- **Magic_Bytes**: Primeiros bytes de um arquivo que identificam seu tipo real
- **MIME_Type**: Tipo de mídia declarado pelo arquivo
- **SQL_Injection**: Ataque que injeta código SQL malicioso em queries
- **XSS**: Cross-Site Scripting - injeção de scripts maliciosos
- **CSRF**: Cross-Site Request Forgery - requisições forjadas
- **JWT**: JSON Web Token usado para autenticação
- **Bcrypt**: Algoritmo de hashing de senhas
- **DoS**: Denial of Service - ataque de negação de serviço
- **Webhook**: Callback HTTP para notificações de eventos
- **Multi_Tenant**: Arquitetura onde múltiplos clientes compartilham infraestrutura
- **PII**: Personally Identifiable Information - dados pessoais sensíveis

## Requirements

### Requirement 1: Input Sanitization and SQL Injection Prevention

**User Story:** As a system administrator, I want all user inputs to be sanitized, so that SQL injection attacks are prevented.

#### Acceptance Criteria

1. WHEN a user submits any form input, THE Input_Validator SHALL sanitize the input before processing
2. WHEN a SQL query is constructed, THE FreteGO_System SHALL use parameterized queries exclusively
3. THE Input_Validator SHALL reject inputs containing SQL keywords in unexpected contexts
4. WHEN an injection attempt is detected, THE Audit_Logger SHALL record the attempt with user ID and IP address
5. FOR ALL text inputs, special characters SHALL be escaped or encoded before database operations

### Requirement 2: XSS Prevention

**User Story:** As a user, I want my data to be safe from script injection, so that malicious code cannot execute in my browser.

#### Acceptance Criteria

1. WHEN user-generated content is displayed, THE FreteGO_System SHALL escape all HTML special characters
2. THE FreteGO_System SHALL sanitize all rich text inputs before storage
3. WHEN rendering user content, THE FreteGO_System SHALL use Content Security Policy headers
4. THE FreteGO_System SHALL validate and sanitize all URL parameters before use
5. WHEN displaying chat messages, THE FreteGO_System SHALL prevent script tag execution

### Requirement 3: CSRF Protection

**User Story:** As a user, I want protection against forged requests, so that attackers cannot perform actions on my behalf.

#### Acceptance Criteria

1. WHEN a state-changing request is made, THE FreteGO_System SHALL validate CSRF tokens
2. THE Session_Manager SHALL generate unique CSRF tokens per session
3. WHEN a CSRF token is invalid, THE FreteGO_System SHALL reject the request with 403 status
4. THE FreteGO_System SHALL include SameSite cookie attributes for session cookies
5. WHEN an API request is made, THE FreteGO_System SHALL validate the Origin header

### Requirement 4: Magic Bytes File Validation

**User Story:** As a system administrator, I want files validated by their actual content, so that malicious files cannot bypass extension-based checks.

#### Acceptance Criteria

1. WHEN a file is uploaded, THE File_Validator SHALL read the file's magic bytes
2. THE File_Validator SHALL compare magic bytes against expected signatures for PDF, JPG, and PNG
3. WHEN magic bytes do not match the declared MIME type, THE File_Validator SHALL reject the file
4. THE File_Validator SHALL validate both magic bytes AND MIME type AND file extension
5. WHEN a file validation fails, THE FreteGO_System SHALL return a descriptive error message
6. THE File_Validator SHALL maintain a whitelist of allowed magic byte signatures

### Requirement 5: Input Length Limits

**User Story:** As a system administrator, I want maximum input lengths enforced, so that database pollution and DoS attacks are prevented.

#### Acceptance Criteria

1. THE FreteGO_System SHALL define maximum character limits for all text fields
2. WHEN an input exceeds the maximum length, THE Input_Validator SHALL reject it before database operations
3. THE FreteGO_System SHALL enforce a maximum of 500 characters for frete descriptions
4. THE FreteGO_System SHALL enforce a maximum of 200 characters for user names
5. THE FreteGO_System SHALL enforce a maximum of 1000 characters for chat messages
6. THE FreteGO_System SHALL enforce a maximum of 500 characters for rating comments
7. WHEN a length limit is exceeded, THE FreteGO_System SHALL return a 400 error with the specific limit

### Requirement 6: Anti-Enumeration for Authentication

**User Story:** As a security engineer, I want identical responses for invalid credentials, so that attackers cannot enumerate valid users.

#### Acceptance Criteria

1. WHEN login fails due to invalid phone, THE Auth_Service SHALL return "Credenciais inválidas"
2. WHEN login fails due to invalid password, THE Auth_Service SHALL return "Credenciais inválidas"
3. THE Auth_Service SHALL use the same response time for both invalid phone and invalid password
4. THE Auth_Service SHALL NOT reveal whether a phone number is registered
5. WHEN a password reset is requested, THE Auth_Service SHALL return success regardless of phone existence

### Requirement 7: Bcrypt Cost Factor Validation

**User Story:** As a security engineer, I want password hashing to use adequate cost factor, so that brute force attacks are computationally expensive.

#### Acceptance Criteria

1. THE Auth_Service SHALL use Bcrypt with a minimum cost factor of 12
2. WHEN a password is hashed, THE Auth_Service SHALL verify the cost factor is at least 12
3. THE FreteGO_System SHALL document the current Bcrypt cost factor in configuration
4. WHEN system performance allows, THE Auth_Service SHALL increase cost factor to 14

### Requirement 8: Single Session Control (Session Invalidation)

**User Story:** As a user, I want only one active session at a time, so that if I log in on a new device, my old session is automatically invalidated.

#### Acceptance Criteria

1. WHEN a user logs in, THE Session_Manager SHALL invalidate all previous sessions for that user
2. THE Session_Manager SHALL store only the most recent session token per user
3. WHEN a second login occurs, THE Session_Manager SHALL revoke the first session's JWT
4. WHEN an invalidated session attempts a request, THE FreteGO_System SHALL return 401 Unauthorized
5. THE Session_Manager SHALL maintain a session_version field that increments on each login
6. WHEN validating a token, THE Session_Manager SHALL verify the session_version matches the current version

### Requirement 9: JWT Token Revocation on Logout

**User Story:** As a user, I want my session to be completely invalidated on logout, so that my token cannot be reused.

#### Acceptance Criteria

1. WHEN a user logs out, THE Session_Manager SHALL add the JWT to a revocation blacklist
2. THE Session_Manager SHALL store revoked tokens until their expiration time
3. WHEN a revoked token is used, THE FreteGO_System SHALL reject the request with 401 status
4. THE Session_Manager SHALL clean up expired tokens from the blacklist daily
5. THE Session_Manager SHALL use Redis or database table for blacklist storage

### Requirement 10: Payment UI Placeholders (No Functional Implementation)

**User Story:** As a product manager, I want payment UI prepared for future integration, so that we can quickly enable payments when ready.

#### Acceptance Criteria

1. THE FreteGO_System SHALL create a "Meu Plano" page for Motorista users
2. THE FreteGO_System SHALL create a "Meu Plano" page for Embarcador users
3. THE Payment_Placeholder SHALL display "Em breve" message for payment features
4. THE Payment_Placeholder SHALL include commented code structure for webhook validation
5. THE Payment_Placeholder SHALL include commented code structure for atomic transactions
6. THE Payment_Placeholder SHALL include commented code structure for refund logic
7. THE Payment_Placeholder SHALL document multi-tenant transaction isolation requirements

### Requirement 11: Secrets Scanning

**User Story:** As a security engineer, I want to ensure no secrets are hardcoded, so that credentials are not exposed in source code.

#### Acceptance Criteria

1. THE FreteGO_System SHALL scan all source files for hardcoded API keys
2. THE FreteGO_System SHALL scan all source files for hardcoded passwords
3. THE FreteGO_System SHALL scan all source files for hardcoded JWT secrets
4. WHEN a potential secret is found, THE FreteGO_System SHALL report the file and line number
5. THE FreteGO_System SHALL validate that all secrets use environment variables
6. THE FreteGO_System SHALL fail CI/CD pipeline if secrets are detected

### Requirement 12: Rate Limiting by IP

**User Story:** As a system administrator, I want rate limiting per IP address, so that brute force and scraping attacks are prevented.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL limit login attempts to 5 per IP per 15 minutes
2. THE Rate_Limiter SHALL limit API requests to 100 per IP per minute
3. WHEN rate limit is exceeded, THE FreteGO_System SHALL return 429 Too Many Requests
4. THE Rate_Limiter SHALL include Retry-After header in 429 responses
5. THE Rate_Limiter SHALL use sliding window algorithm for accurate counting
6. THE Rate_Limiter SHALL store rate limit data in Redis or memory cache

### Requirement 13: Rate Limiting by User

**User Story:** As a system administrator, I want rate limiting per authenticated user, so that compromised accounts cannot abuse the system.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL limit frete creation to 10 per user per hour
2. THE Rate_Limiter SHALL limit document uploads to 20 per user per hour
3. THE Rate_Limiter SHALL limit chat messages to 100 per user per hour
4. WHEN user rate limit is exceeded, THE FreteGO_System SHALL return 429 with user-specific message
5. THE Rate_Limiter SHALL reset user limits hourly

### Requirement 14: Brute Force Protection with Account Lockout

**User Story:** As a security engineer, I want accounts locked after failed attempts, so that brute force attacks are blocked regardless of timing.

#### Acceptance Criteria

1. WHEN a user has 5 failed login attempts, THE Brute_Force_Protector SHALL lock the account for 30 minutes
2. THE Brute_Force_Protector SHALL count failed attempts regardless of time between attempts
3. WHEN an account is locked, THE Brute_Force_Protector SHALL send an email alert to the user
4. THE Brute_Force_Protector SHALL log all lockout events to Audit_Logger
5. WHEN a locked account attempts login, THE FreteGO_System SHALL return "Conta temporariamente bloqueada"
6. THE Brute_Force_Protector SHALL reset failed attempt counter after successful login

### Requirement 15: External URL Sanitization

**User Story:** As a user, I want external URLs validated, so that I am not redirected to malicious sites.

#### Acceptance Criteria

1. WHEN user content contains URLs, THE URL_Sanitizer SHALL validate the URL format
2. THE URL_Sanitizer SHALL block URLs with javascript: protocol
3. THE URL_Sanitizer SHALL block URLs with data: protocol
4. THE URL_Sanitizer SHALL add rel="noopener noreferrer" to external links
5. WHEN displaying external URLs, THE FreteGO_System SHALL show a warning before redirect
6. THE URL_Sanitizer SHALL maintain a blacklist of known malicious domains

### Requirement 16: RLS Validation Across All Tables

**User Story:** As a security engineer, I want RLS verified on all tables, so that data access is properly restricted.

#### Acceptance Criteria

1. THE RLS_Engine SHALL enforce policies on users table
2. THE RLS_Engine SHALL enforce policies on motoristas table
3. THE RLS_Engine SHALL enforce policies on embarcadores table
4. THE RLS_Engine SHALL enforce policies on fretes table
5. THE RLS_Engine SHALL enforce policies on documents table
6. THE RLS_Engine SHALL enforce policies on chat_messages table
7. THE RLS_Engine SHALL enforce policies on chat_conversations table
8. THE RLS_Engine SHALL enforce policies on notifications table
9. THE RLS_Engine SHALL enforce policies on audit_logs table
10. THE RLS_Engine SHALL enforce policies on avaliacoes table
11. THE RLS_Engine SHALL enforce policies on frete_clicks table

### Requirement 17: Audit Logging for Security Events

**User Story:** As a security engineer, I want comprehensive audit logs, so that security incidents can be investigated.

#### Acceptance Criteria

1. WHEN a user logs in, THE Audit_Logger SHALL record user_id, timestamp, and IP address
2. WHEN a login fails, THE Audit_Logger SHALL record phone, timestamp, IP address, and failure reason
3. WHEN a user accesses another user's data (unauthorized attempt), THE Audit_Logger SHALL record the attempt
4. WHEN a file is uploaded, THE Audit_Logger SHALL record user_id, file_type, file_size, and timestamp
5. WHEN a frete is created, THE Audit_Logger SHALL record embarcador_id, frete_id, and timestamp
6. WHEN a frete is deleted, THE Audit_Logger SHALL record who deleted it and when
7. WHEN an admin action is performed, THE Audit_Logger SHALL record admin_id, action_type, target_id, and timestamp
8. THE Audit_Logger SHALL store logs in audit_logs table with 90-day retention
9. THE Audit_Logger SHALL include request_id for correlation across services

### Requirement 18: Vulnerability Testing - Unauthorized Access

**User Story:** As a security engineer, I want automated tests for unauthorized access, so that access control bugs are caught early.

#### Acceptance Criteria

1. THE FreteGO_System SHALL test that User A cannot read User B's documents
2. THE FreteGO_System SHALL test that User A cannot update User B's profile
3. THE FreteGO_System SHALL test that User A cannot delete User B's fretes
4. THE FreteGO_System SHALL test that non-admin users cannot access admin endpoints
5. THE FreteGO_System SHALL test that unauthenticated users cannot access protected resources
6. THE FreteGO_System SHALL test that motoristas cannot create fretes (embarcador-only action)
7. THE FreteGO_System SHALL test that embarcadores cannot rate other embarcadores

### Requirement 19: Penetration Testing Simulation

**User Story:** As a security engineer, I want simulated penetration tests, so that common attack vectors are validated.

#### Acceptance Criteria

1. THE FreteGO_System SHALL test SQL injection attempts on all input fields
2. THE FreteGO_System SHALL test XSS injection attempts in chat messages
3. THE FreteGO_System SHALL test CSRF attacks on state-changing endpoints
4. THE FreteGO_System SHALL test file upload with malicious payloads
5. THE FreteGO_System SHALL test authentication bypass via query parameter manipulation
6. THE FreteGO_System SHALL test privilege escalation attempts
7. THE FreteGO_System SHALL test rate limit bypass attempts
8. THE FreteGO_System SHALL document all test results in security report

### Requirement 20: Honeypot Implementation

**User Story:** As a security engineer, I want honeypots to detect attackers, so that malicious activity triggers alerts.

#### Acceptance Criteria

1. THE FreteGO_System SHALL create a hidden /admin-legacy route that triggers alerts when accessed
2. THE FreteGO_System SHALL create hidden form fields that trigger alerts when filled
3. WHEN a honeypot is triggered, THE Audit_Logger SHALL record IP address, user_agent, and timestamp
4. WHEN a honeypot is triggered, THE FreteGO_System SHALL send alert to security team
5. THE FreteGO_System SHALL block IP addresses that trigger honeypots more than 3 times
6. THE Honeypot SHALL be invisible to legitimate users (CSS display:none and aria-hidden)

### Requirement 21: WAF Recommendation Documentation

**User Story:** As a DevOps engineer, I want WAF recommendations documented, so that we can implement it when ready.

#### Acceptance Criteria

1. THE FreteGO_System SHALL document Cloudflare WAF configuration recommendations
2. THE FreteGO_System SHALL document recommended WAF rules for SQL injection
3. THE FreteGO_System SHALL document recommended WAF rules for XSS
4. THE FreteGO_System SHALL document recommended WAF rules for DDoS protection
5. THE FreteGO_System SHALL document cost estimates for WAF implementation
6. THE FreteGO_System SHALL document integration steps with current infrastructure

### Requirement 22: Docker Hardening Documentation

**User Story:** As a DevOps engineer, I want Docker security best practices documented, so that containers are hardened when deployed.

#### Acceptance Criteria

1. THE FreteGO_System SHALL document use of non-root users in containers
2. THE FreteGO_System SHALL document read-only filesystem recommendations
3. THE FreteGO_System SHALL document secrets management with Docker secrets
4. THE FreteGO_System SHALL document network isolation recommendations
5. THE FreteGO_System SHALL document image scanning requirements
6. THE FreteGO_System SHALL document minimal base image recommendations (Alpine, Distroless)

### Requirement 23: Password Validation Enhancement

**User Story:** As a user, I want strong password requirements, so that my account is protected from weak passwords.

#### Acceptance Criteria

1. THE Auth_Service SHALL require passwords to be at least 8 characters (increased from 6)
2. THE Auth_Service SHALL require at least one uppercase letter
3. THE Auth_Service SHALL require at least one lowercase letter
4. THE Auth_Service SHALL require at least one number
5. THE Auth_Service SHALL require at least one special character
6. THE Auth_Service SHALL reject passwords that match common password lists
7. WHEN password validation fails, THE Auth_Service SHALL return specific requirements not met

### Requirement 24: Session Timeout

**User Story:** As a security engineer, I want sessions to expire after inactivity, so that unattended sessions are automatically closed.

#### Acceptance Criteria

1. THE Session_Manager SHALL expire sessions after 30 minutes of inactivity
2. THE Session_Manager SHALL track last_activity_at timestamp for each session
3. WHEN a session expires, THE Session_Manager SHALL require re-authentication
4. THE Session_Manager SHALL warn users 5 minutes before session expiration
5. WHEN user performs any action, THE Session_Manager SHALL update last_activity_at

### Requirement 25: Content Security Policy Headers

**User Story:** As a security engineer, I want CSP headers configured, so that XSS attacks are mitigated at the browser level.

#### Acceptance Criteria

1. THE FreteGO_System SHALL set Content-Security-Policy header on all responses
2. THE FreteGO_System SHALL restrict script-src to 'self' and trusted CDNs
3. THE FreteGO_System SHALL restrict style-src to 'self' and trusted CDNs
4. THE FreteGO_System SHALL set img-src to 'self' and Supabase storage domain
5. THE FreteGO_System SHALL set frame-ancestors to 'none'
6. THE FreteGO_System SHALL set upgrade-insecure-requests directive

### Requirement 26: Secure HTTP Headers

**User Story:** As a security engineer, I want security headers configured, so that common web vulnerabilities are mitigated.

#### Acceptance Criteria

1. THE FreteGO_System SHALL set X-Content-Type-Options: nosniff
2. THE FreteGO_System SHALL set X-Frame-Options: DENY
3. THE FreteGO_System SHALL set X-XSS-Protection: 1; mode=block
4. THE FreteGO_System SHALL set Strict-Transport-Security with max-age of 31536000
5. THE FreteGO_System SHALL set Referrer-Policy: strict-origin-when-cross-origin
6. THE FreteGO_System SHALL set Permissions-Policy to restrict unnecessary features

### Requirement 27: Input Validation for Numeric Fields

**User Story:** As a developer, I want numeric inputs validated, so that invalid data cannot cause errors or exploits.

#### Acceptance Criteria

1. WHEN a numeric field is submitted, THE Input_Validator SHALL verify it is a valid number
2. THE Input_Validator SHALL reject negative numbers for fields like weight and price
3. THE Input_Validator SHALL enforce minimum and maximum bounds for numeric fields
4. THE Input_Validator SHALL reject NaN, Infinity, and -Infinity values
5. WHEN validation fails, THE FreteGO_System SHALL return specific error message with valid range

### Requirement 28: Email Validation and Sanitization

**User Story:** As a developer, I want email addresses validated, so that only valid emails are stored.

#### Acceptance Criteria

1. WHEN an email is submitted, THE Input_Validator SHALL validate format using RFC 5322 standard
2. THE Input_Validator SHALL normalize email addresses to lowercase
3. THE Input_Validator SHALL trim whitespace from email addresses
4. THE Input_Validator SHALL reject emails with dangerous characters
5. THE Input_Validator SHALL validate email domain has valid MX records (optional enhancement)

### Requirement 29: Phone Number Validation

**User Story:** As a developer, I want phone numbers validated, so that only valid Brazilian phone numbers are accepted.

#### Acceptance Criteria

1. WHEN a phone number is submitted, THE Input_Validator SHALL validate Brazilian phone format
2. THE Input_Validator SHALL accept formats: (XX) XXXXX-XXXX and (XX) XXXX-XXXX
3. THE Input_Validator SHALL normalize phone numbers to digits only for storage
4. THE Input_Validator SHALL validate area code is valid for Brazil
5. WHEN validation fails, THE FreteGO_System SHALL return "Telefone inválido" error

### Requirement 30: File Size Bomb Protection

**User Story:** As a system administrator, I want protection against file size bombs, so that decompression attacks are prevented.

#### Acceptance Criteria

1. WHEN a file is uploaded, THE File_Validator SHALL check compressed vs uncompressed size ratio
2. THE File_Validator SHALL reject files with compression ratio exceeding 100:1
3. THE File_Validator SHALL limit maximum uncompressed size to 50MB
4. WHEN a suspicious file is detected, THE Audit_Logger SHALL record the attempt
5. THE File_Validator SHALL scan for nested archives (zip within zip)

### Requirement 31: Database Connection Security

**User Story:** As a database administrator, I want secure database connections, so that data in transit is encrypted.

#### Acceptance Criteria

1. THE FreteGO_System SHALL use SSL/TLS for all database connections
2. THE FreteGO_System SHALL verify database server certificates
3. THE FreteGO_System SHALL use connection pooling with maximum connection limits
4. THE FreteGO_System SHALL set connection timeout to 30 seconds
5. THE FreteGO_System SHALL log database connection errors to Audit_Logger

### Requirement 32: API Response Data Minimization

**User Story:** As a security engineer, I want API responses to include only necessary data, so that sensitive information is not leaked.

#### Acceptance Criteria

1. WHEN returning user data, THE FreteGO_System SHALL exclude password hashes
2. WHEN returning user data, THE FreteGO_System SHALL exclude internal IDs when not needed
3. THE FreteGO_System SHALL exclude email addresses from public frete listings
4. THE FreteGO_System SHALL exclude phone numbers from public embarcador profiles
5. WHEN an error occurs, THE FreteGO_System SHALL return generic error messages to clients
6. THE FreteGO_System SHALL log detailed error information server-side only

### Requirement 33: Dependency Vulnerability Scanning

**User Story:** As a DevOps engineer, I want dependencies scanned for vulnerabilities, so that known security issues are detected.

#### Acceptance Criteria

1. THE FreteGO_System SHALL run npm audit on every build
2. THE FreteGO_System SHALL fail CI/CD pipeline if high or critical vulnerabilities are found
3. THE FreteGO_System SHALL generate vulnerability reports weekly
4. THE FreteGO_System SHALL automatically create tickets for vulnerabilities requiring updates
5. THE FreteGO_System SHALL maintain a whitelist of accepted vulnerabilities with justification

### Requirement 34: Secure Password Reset Flow

**User Story:** As a user, I want a secure password reset process, so that my account cannot be hijacked.

#### Acceptance Criteria

1. WHEN a password reset is requested, THE Auth_Service SHALL send a time-limited token (15 minutes)
2. THE Auth_Service SHALL generate cryptographically random reset tokens
3. THE Auth_Service SHALL invalidate reset tokens after use
4. THE Auth_Service SHALL limit password reset requests to 3 per hour per phone number
5. WHEN a reset token is used, THE Auth_Service SHALL invalidate all existing sessions
6. THE Auth_Service SHALL send email notification when password is changed

### Requirement 35: Multi-Factor Authentication Preparation

**User Story:** As a product manager, I want MFA infrastructure prepared, so that we can enable it quickly when needed.

#### Acceptance Criteria

1. THE FreteGO_System SHALL create database schema for MFA secrets
2. THE FreteGO_System SHALL create UI placeholders for MFA setup
3. THE FreteGO_System SHALL document TOTP implementation requirements
4. THE FreteGO_System SHALL document SMS-based MFA requirements
5. THE FreteGO_System SHALL create commented code structure for MFA verification
6. THE FreteGO_System SHALL document backup codes generation process

### Requirement 36: Geolocation Data Privacy

**User Story:** As a user, I want my location data protected, so that my privacy is maintained.

#### Acceptance Criteria

1. THE FreteGO_System SHALL request location permission explicitly
2. THE FreteGO_System SHALL allow users to deny location access
3. WHEN location is denied, THE FreteGO_System SHALL provide manual address entry
4. THE FreteGO_System SHALL not store precise GPS coordinates longer than necessary
5. THE FreteGO_System SHALL anonymize location data in analytics
6. THE FreteGO_System SHALL document location data retention policy

### Requirement 37: GDPR and LGPD Compliance Preparation

**User Story:** As a legal compliance officer, I want data protection compliance prepared, so that we meet LGPD requirements.

#### Acceptance Criteria

1. THE FreteGO_System SHALL implement user data export functionality
2. THE FreteGO_System SHALL implement user data deletion functionality
3. THE FreteGO_System SHALL document data retention policies for all data types
4. THE FreteGO_System SHALL create privacy policy page
5. THE FreteGO_System SHALL create terms of service page
6. THE FreteGO_System SHALL implement consent tracking for data processing
7. THE FreteGO_System SHALL log all data access requests in Audit_Logger

### Requirement 38: Secure File Download

**User Story:** As a user, I want secure document downloads, so that only authorized users can access files.

#### Acceptance Criteria

1. WHEN a document is requested, THE FreteGO_System SHALL verify user authorization
2. THE FreteGO_System SHALL use signed URLs with expiration for document access
3. THE FreteGO_System SHALL set signed URL expiration to 1 hour
4. THE FreteGO_System SHALL log all document access attempts
5. WHEN an unauthorized access is attempted, THE FreteGO_System SHALL return 403 Forbidden
6. THE FreteGO_System SHALL set Content-Disposition header to prevent inline execution

### Requirement 39: Admin Action Confirmation

**User Story:** As an administrator, I want critical actions to require confirmation, so that accidental destructive operations are prevented.

#### Acceptance Criteria

1. WHEN an admin deletes a user, THE FreteGO_System SHALL require confirmation dialog
2. WHEN an admin deletes a frete, THE FreteGO_System SHALL require confirmation dialog
3. WHEN an admin disables an account, THE FreteGO_System SHALL require reason input
4. THE FreteGO_System SHALL log all admin confirmations with timestamp
5. THE FreteGO_System SHALL implement "undo" functionality for reversible admin actions

### Requirement 40: Security Monitoring Dashboard

**User Story:** As a security engineer, I want a security monitoring dashboard, so that threats are visible in real-time.

#### Acceptance Criteria

1. THE FreteGO_System SHALL display failed login attempts in last 24 hours
2. THE FreteGO_System SHALL display rate limit violations in last 24 hours
3. THE FreteGO_System SHALL display honeypot triggers in last 24 hours
4. THE FreteGO_System SHALL display file upload rejections in last 24 hours
5. THE FreteGO_System SHALL display top IP addresses by failed requests
6. THE FreteGO_System SHALL display security events timeline
7. THE FreteGO_System SHALL send alerts when thresholds are exceeded
