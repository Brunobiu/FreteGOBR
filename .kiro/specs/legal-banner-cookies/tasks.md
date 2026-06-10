# Implementation Plan

> Feature 3 — Banner de Cookies (FreteGO)

## Overview

Plano incremental para o banner de cookies LGPD. Feature client-side: store em localStorage, Context provider, banner + painel, e gating do PixelProvider existente. Sem banco de dados.

## Task Dependency Graph

```
1 (store + tipos)
   └─> 2 (CookieConsentProvider + hook)
        ├─> 3 (CookieBanner)
        ├─> 4 (CookiePreferencesModal)
        └─> 5 (gating do PixelProvider)
3,4 ─> 6 (montar provider+banner no App)
todas ─> 7 (testes + validação)
```

```json
{
  "waves": [
    { "wave": 1, "tasks": [1], "description": "Store de consentimento + tipos (base)." },
    { "wave": 2, "tasks": [2], "description": "Provider + hook (depende do store)." },
    { "wave": 3, "tasks": [3, 4, 5], "description": "Banner, painel e gating do Pixel (dependem do provider)." },
    { "wave": 4, "tasks": [6], "description": "Montagem no App." },
    { "wave": 5, "tasks": [7], "description": "Testes e validação final." }
  ]
}
```

## Tasks

- [x] 1. Criar store de consentimento (localStorage, versionado)
  - Criar `src/services/cookieConsent.ts` com tipos (`CookieCategory`, `ConsentState`), `CONSENT_VERSION`, `STORAGE_KEY`, e funções `readConsent()`, `writeConsent()`, `needsDecision()` (true se ausente/versão divergente/corrompido), forçando `necessary=true`. try/catch em todo acesso ao localStorage.
  - _Requirements: 2.3, 2.5, 2.6_

- [x] 2. Criar CookieConsentProvider e hook useCookieConsent
  - Criar `src/components/cookies/CookieConsentProvider.tsx` com Context expondo `consent`, `needsDecision`, `acceptAll()`, `savePreferences()`, `has()`.
  - _Requirements: 2.1, 2.2, 2.4, 2.6_

- [x] 3. Criar CookieBanner
  - Criar `src/components/cookies/CookieBanner.tsx`: fixo bottom-0, texto curto + link `/privacidade`, botões "Aceitar" (acceptAll) e "Configurar" (abre painel); visível só quando needsDecision; não bloqueia navegação; responsivo + navegável por teclado.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.1, 5.2, 5.3_

- [x] 4. Criar CookiePreferencesModal
  - Criar `src/components/cookies/CookiePreferencesModal.tsx`: lista categorias (necessary fixo on/desabilitado; analytics e marketing toggláveis), botão "Salvar preferências" (savePreferences), ESC fecha sem salvar, foco inicial no painel.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.4_

- [x] 5. Gatear o PixelProvider pelo consentimento de marketing
  - Ajustar `PixelProvider` para consumir `useCookieConsent()`: não carregar/disparar enquanto `has('marketing')` for false; carregar quando concedido; revogação para de inicializar nas próximas cargas.
  - _Requirements: 4.1, 4.2, 4.3, 4.5_

- [x] 6. Montar provider e banner no App
  - Envolver o app com `CookieConsentProvider` (acima do PixelProvider) e renderizar `<CookieBanner />` globalmente.
  - _Requirements: 1.1, 4.4_

- [x] 7. Testes e validação final
  - Store: necessary sempre true (Property 1); needsDecision true quando ausente/versão divergente/corrompido (Property 2); persistência reflete escolha (Property 4); estável entre recargas (Property 5).
  - Gating: Pixel monta sse marketing=true (Property 3).
  - Rodar `npx tsc --noEmit`, `npm run test:run`, `npm run build`; confirmar verde.
  - _Requirements: 2.6, 1.1, 4.1, 2.1, 2.2_

## Notes

- Nunca assumir consentimento: localStorage indisponível/corrompido ⇒ banner reaparece (comportamento seguro).
- `necessary` é imutável e sempre concedido (sessão, segurança, tema).
- Integra com a Feature 1 (link `/privacidade` no banner).
