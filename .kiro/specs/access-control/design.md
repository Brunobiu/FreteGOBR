# Documento de Design - Access Control

## Visão Geral

Sistema de controle de acesso baseado em níveis de perfil para visibilidade de informações sensíveis.

## Arquitetura

### Níveis de Acesso

```
┌─────────────────────────────────────────────────────────┐
│ NÍVEL 1: Usuário Anônimo (não autenticado)              │
│ - Ver lista de fretes                                   │
│ - Ver origem, destino, tipo de carga, veículo          │
│ - NÃO ver valor do frete                               │
│ - NÃO ver contato do embarcador                        │
├─────────────────────────────────────────────────────────┤
│ NÍVEL 2: Conta Básica (autenticado, perfil < 100%)     │
│ - Tudo do Nível 1                                      │
│ - Ver valor do frete                                   │
│ - Ver descrição completa                               │
│ - NÃO ver contato do embarcador                        │
├─────────────────────────────────────────────────────────┤
│ NÍVEL 3: Perfil Completo (autenticado, perfil = 100%)  │
│ - Tudo do Nível 2                                      │
│ - Ver contato do embarcador                            │
│ - Botão WhatsApp com mensagem pré-preenchida           │
│ - Botão Chat interno                                   │
└─────────────────────────────────────────────────────────┘
```

### Componentes Modificados

```
src/components/
├── FreteCard.tsx           # Ocultar valor para anônimos
├── FreteModal.tsx          # Controlar exibição de contato
├── ContactButtons.tsx      # NOVO: Botões WhatsApp/Chat condicionais
├── ProfileIncompleteAlert.tsx  # NOVO: Alerta de perfil incompleto
```

### Hook de Verificação de Acesso

```typescript
// src/hooks/useAccessLevel.ts
export type AccessLevel = 'anonymous' | 'basic' | 'complete';

export function useAccessLevel(): {
  level: AccessLevel;
  isAuthenticated: boolean;
  profileCompletion: number;
  canViewValue: boolean;
  canViewContact: boolean;
  missingDocuments: string[];
}
```

### Serviço de Verificação

```typescript
// src/services/accessControl.ts
export async function checkProfileCompletion(userId: string): Promise<{
  percentage: number;
  isComplete: boolean;
  missingDocuments: string[];
}>;

export async function getEmbarcadorContact(freteId: string, userId: string): Promise<{
  name: string;
  company: string;
  whatsapp: string;
} | { error: 'profile_incomplete'; percentage: number }>;
```

### Mensagem WhatsApp

```typescript
export function generateWhatsAppMessage(frete: Frete): string {
  return encodeURIComponent(
    `Olá, vi seu frete de ${frete.origin} para ${frete.destination} no FreteGO e tenho interesse.\n\n` +
    `Frete: ${window.location.origin}/frete/${frete.id}`
  );
}

export function getWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/55${phone}?text=${message}`;
}
```

## Propriedades de Corretude

1. **Ocultação de Valor**: Usuários anônimos NUNCA devem ver valor do frete
2. **Ocultação de Contato**: Perfis incompletos NUNCA devem ver contato do embarcador
3. **Verificação Backend**: Todas as verificações devem ser feitas também no backend
4. **Consistência**: O nível de acesso deve ser consistente entre frontend e backend
