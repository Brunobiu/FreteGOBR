# Implementation Plan

> Feature 1 — Termos de Uso e Política de Privacidade (FreteGO)

## Overview

Plano incremental para as páginas públicas de Termos de Uso e Política de Privacidade. Feature puramente frontend (rotas, componente compartilhado, conteúdo versionado, rodapé). Sem migrations nem mudanças de banco.

## Task Dependency Graph

```
1 (módulo de conteúdo/versão)
   ├─> 2 (LegalPage)
   ├─> 3 (conteúdo Termos)
   └─> 4 (conteúdo Privacidade)
2,3,4 ─> 5 (páginas wrapper + rotas)
1 ─────> 6 (SiteFooter)
5,6 ───> 7 (adotar footer nas páginas públicas)
todas ─> 8 (testes + validação)
```

```json
{
  "waves": [
    { "wave": 1, "tasks": [1], "description": "Módulo de conteúdo e versionamento (base)." },
    { "wave": 2, "tasks": [2, 3, 4, 6], "description": "LegalPage, conteúdos e SiteFooter (dependem do módulo)." },
    { "wave": 3, "tasks": [5, 7], "description": "Páginas wrapper + rotas e adoção do footer." },
    { "wave": 4, "tasks": [8], "description": "Testes e validação final." }
  ]
}
```

## Tasks

- [x] 1. Criar módulo de conteúdo e versionamento legal
  - Criar `src/data/legal/index.ts` com `LegalDocKey`, `LegalDocMeta`, `LEGAL_DOCS` (terms/privacy com version e updatedAt) e `currentLegalVersion()`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 2. Criar componente compartilhado LegalPage
  - Criar `src/components/legal/LegalPage.tsx` recebendo `doc: LegalDocKey`; renderiza h1 + "Última atualização" + versão + corpo (article) + rodapé; `useDocumentTitle` por documento; coluna única em mobile.
  - _Requirements: 1.3, 1.4, 1.5, 2.3, 5.1, 5.2, 5.4_

- [x] 3. Escrever conteúdo dos Termos de Uso
  - Criar `src/data/legal/termsContent.tsx` com seções: objeto do serviço, cadastro/elegibilidade, obrigações de motoristas e embarcadores, conduta proibida, responsabilidades/limitação, propriedade intelectual, rescisão, foro/legislação.
  - _Requirements: 1.2, 1.6_

- [x] 4. Escrever conteúdo da Política de Privacidade (LGPD)
  - Criar `src/data/legal/privacyContent.tsx` cobrindo: categorias de dados (CPF, RG, CNH, RNTRC, veículo, CNPJ, localização), finalidades + base legal, direitos do titular e como exercê-los, contato do controlador/DPO, retenção, compartilhamento; menção ao prazo de exclusão de até 30 dias.
  - _Requirements: 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

- [x] 5. Criar páginas wrapper e registrar rotas públicas
  - Criar `src/pages/TermosPage.tsx` e `src/pages/PrivacidadePage.tsx` (cada uma renderiza `<LegalPage doc=... />`).
  - Registrar rotas públicas `/termos` e `/privacidade` em `App.tsx` (sem ProtectedRoute, lazy).
  - _Requirements: 1.1, 2.1_

- [x] 6. Criar componente SiteFooter
  - Criar `src/components/SiteFooter.tsx` com links para `/termos` e `/privacidade` (via `LEGAL_DOCS[*].route`) e copyright com ano corrente.
  - _Requirements: 4.1, 4.3, 4.4, 4.5_

- [x] 7. Adotar o SiteFooter nas páginas públicas
  - Incluir `<SiteFooter />` em LoginPage, RegisterPage e na home pública, além das próprias LegalPages.
  - _Requirements: 4.2_

- [x] 8. Testes e validação final
  - Testes: `currentLegalVersion()` estável (Property 1); `LEGAL_DOCS` com version/updatedAt não-vazios; LegalPage exibe título/data/versão e define document.title; SiteFooter com hrefs corretos e ano (Property 3); um único h1 por página.
  - Rodar `npx tsc --noEmit`, `npm run test:run` e `npm run build`; confirmar verde.
  - _Requirements: 1.3, 1.4, 3.1, 3.3, 4.1, 5.1_

## Notes

- Conteúdo legal vive em JSX versionado (trilha de auditoria via git); alterar texto exige bump de `version` + `updatedAt` (Requirement 3.2).
- `currentLegalVersion()` é o ponto de integração com a Feature 2 (aceite obrigatório).
- Sem banco de dados nesta feature.
