# Design Document

> Feature 3 — Banner de Cookies (FreteGO)

## Overview

Banner fixo no rodapé exibido até o usuário registrar uma preferência de cookies, persistida em `localStorage`. Um `CookieConsentProvider` (Context) expõe o estado de consentimento para o app; o `PixelProvider` existente passa a consumir esse estado e só carrega quando `marketing` está concedido. Tudo client-side, sem banco.

A LGPD é atendida por construção: cookies não-essenciais ficam atrás de consentimento explícito; `necessary` sempre ativo.

## Architecture

```
App
 └─ CookieConsentProvider (Context)         <- estado global de consentimento
     ├─ lê/escreve Consent_Store (localStorage, versionado)
     ├─ <PixelProvider>  ── usa useCookieConsent(): só carrega se marketing=true
     ├─ ...resto do app...
     └─ <CookieBanner />                     <- visível se não há consentimento
          └─ <CookiePreferencesModal />      <- painel "Configurar"
```

### Estado e persistência

```ts
type CookieCategory = 'necessary' | 'analytics' | 'marketing';

interface ConsentState {
  version: number;                 // CONSENT_VERSION
  decidedAt: string;               // ISO timestamp
  categories: Record<CookieCategory, boolean>;
}

const CONSENT_VERSION = 1;
const STORAGE_KEY = 'fretego-cookie-consent';
```

Leitura no boot: se não há `ConsentState` ou `version` diferente de `CONSENT_VERSION`, o banner aparece (Requirements 1.1, 2.5). `necessary` é sempre forçado `true` (Requirement 2.6).

## Components and Interfaces

### CookieConsentProvider + hook

```ts
interface CookieConsentContext {
  consent: ConsentState | null;          // null = ainda não decidiu
  needsDecision: boolean;                 // true => mostrar banner
  acceptAll(): void;                      // analytics+marketing+necessary
  savePreferences(p: Partial<Record<CookieCategory, boolean>>): void;
  has(category: CookieCategory): boolean; // necessary sempre true
}
export function useCookieConsent(): CookieConsentContext;
```

- `acceptAll()` grava todas as categorias `true` + timestamp + version (Requirement 2.1).
- `savePreferences()` grava as escolhidas; `necessary` sempre `true` (Requirement 2.2, 2.6).
- `has('marketing')` é o gate do Pixel.

### CookieBanner (`components/cookies/CookieBanner.tsx`)

```tsx
// Visível quando needsDecision. Fixo bottom-0, z alto mas abaixo de modais críticos.
// Texto curto + link /privacidade + botões "Aceitar" e "Configurar".
// Não bloqueia navegação (Requirement 1.4).
```

### CookiePreferencesModal (`components/cookies/CookiePreferencesModal.tsx`)

```tsx
// Lista categorias: necessary (toggle fixo on, desabilitado), analytics, marketing.
// Botão "Salvar preferências" => savePreferences. ESC fecha sem salvar (Requirement 5.4).
```

### Integração com PixelProvider

```tsx
// Dentro do PixelProvider (ou wrapper):
const { has } = useCookieConsent();
if (!has('marketing')) return <>{children}</>; // não injeta pixel (Requirement 4.1)
// quando marketing concedido, carrega normalmente (Requirement 4.2)
```

## Data Models

Nenhuma tabela. Único dado é o `ConsentState` em `localStorage` (chave `fretego-cookie-consent`, versionado por `CONSENT_VERSION`).

## Error Handling

- `localStorage` indisponível (modo privativo/SSR): tratar leitura/escrita com try/catch; se não der pra persistir, o banner pode reaparecer — comportamento seguro (nunca assume consentimento).
- JSON corrompido no storage: tratar como "sem consentimento" e reexibir o banner.
- Versão divergente: reexibe banner (Requirement 2.5).

## Testing Strategy

- **Unit (store)**: serialização/leitura do ConsentState; `necessary` sempre true; versão divergente ⇒ needsDecision true; JSON corrompido ⇒ needsDecision true.
- **Provider**: `acceptAll` concede analytics+marketing; `savePreferences({analytics:true})` deixa marketing=false; `has('necessary')` sempre true.
- **Gating**: com `marketing=false`, o Pixel não é montado; com `true`, é montado.
- **Render**: banner aparece quando needsDecision; some após decisão; navegável por teclado.

## Correctness Properties

### Property 1: Necessary sempre concedido
**Validates: Requirements 2.6, 4.4**
Para qualquer ConsentState persistido por qualquer caminho (acceptAll ou savePreferences com qualquer combinação), `categories.necessary === true`.

### Property 2: Banner aparece sse e somente se não há decisão válida
**Validates: Requirements 1.1, 1.5, 2.4, 2.5**
`needsDecision` é verdadeiro exatamente quando não há ConsentState OU a `version` difere de `CONSENT_VERSION` OU o storage está corrompido.

### Property 3: Marketing gating do Pixel
**Validates: Requirements 4.1, 4.2**
O Pixel_Provider carrega se e somente se `has('marketing') === true`. Sem consentimento de marketing, nenhum evento/pixel é injetado.

### Property 4: Persistência reflete exatamente a escolha
**Validates: Requirements 2.1, 2.2, 3.5**
Após `savePreferences(p)`, para cada categoria não-`necessary`, o estado persistido é igual ao valor escolhido em `p` (default `false` quando ausente).

### Property 5: Decisão é estável entre recargas
**Validates: Requirements 2.4**
Dado um ConsentState válido na versão corrente, recarregar a página não reexibe o banner e preserva as categorias concedidas.

## Decisões e Trade-offs

1. **localStorage, não cookie próprio.** Consentimento é estado de UI do cliente; localStorage é simples e suficiente. Trade-off: não compartilhado entre subdomínios — aceitável (app é single-domain).
2. **Versionamento do consentimento.** Permite re-perguntar se a política de cookies mudar, sem migração.
3. **Gating via Context consumido pelo PixelProvider.** Centraliza a decisão; o pixel não precisa saber de localStorage, só do hook. Cumpre LGPD por construção.
4. **`necessary` imutável.** Garante que recursos essenciais (sessão, tema, segurança) nunca dependam de consentimento.
