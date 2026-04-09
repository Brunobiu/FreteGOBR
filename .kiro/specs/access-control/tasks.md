# Plano de Implementação - Access Control

## Tarefas

- [ ] 1. Criar hook useAccessLevel
  - [ ] 1.1 Criar src/hooks/useAccessLevel.ts
    - Retornar level: 'anonymous' | 'basic' | 'complete'
    - Calcular profileCompletion baseado em documentos aprovados
    - Retornar canViewValue e canViewContact
    - Retornar lista de documentos faltantes

- [ ] 2. Criar serviço de controle de acesso
  - [ ] 2.1 Criar src/services/accessControl.ts
    - Função checkProfileCompletion
    - Função getEmbarcadorContact (com verificação de perfil)
    - Função generateWhatsAppMessage
    - Função getWhatsAppUrl

- [ ] 3. Atualizar FreteCard
  - [ ] 3.1 Ocultar valor para usuários anônimos
  - [ ] 3.2 Exibir "Faça login para ver o valor" quando não autenticado
  - [ ] 3.3 Usar hook useAccessLevel para determinar visibilidade

- [ ] 4. Criar componente ContactButtons
  - [ ] 4.1 Criar src/components/ContactButtons.tsx
    - Botão WhatsApp (abre wa.me com mensagem)
    - Botão Chat Interno (abre ChatWidget)
    - Exibir apenas se canViewContact = true

- [ ] 5. Criar componente ProfileIncompleteAlert
  - [ ] 5.1 Criar src/components/ProfileIncompleteAlert.tsx
    - Exibir percentual de completude
    - Listar documentos pendentes
    - Link para página de perfil

- [ ] 6. Atualizar FreteModal
  - [ ] 6.1 Integrar ContactButtons
  - [ ] 6.2 Integrar ProfileIncompleteAlert quando perfil incompleto
  - [ ] 6.3 Ocultar informações de contato para perfis incompletos

- [ ] 7. Implementar verificação no backend
  - [ ] 7.1 Criar função RPC check_profile_completion no Supabase
  - [ ] 7.2 Criar função RPC get_embarcador_contact com verificação
  - [ ] 7.3 Retornar erro 403 se perfil incompleto

- [ ] 8. Atualizar HomePage
  - [ ] 8.1 Passar informações de acesso para FreteCard
  - [ ] 8.2 Exibir banner de login para usuários anônimos

- [ ] 9. Testes e validação
  - [ ] 9.1 Testar visualização como usuário anônimo
  - [ ] 9.2 Testar visualização como conta básica
  - [ ] 9.3 Testar visualização como perfil completo
  - [ ] 9.4 Testar botão WhatsApp com mensagem pré-preenchida
  - [ ] 9.5 Testar verificação no backend
  - [ ] 9.6 Testar tentativa de acesso não autorizado
