# Design Document

> Feature 1 — Termos de Uso e Política de Privacidade (FreteGO)

## Overview

Duas páginas públicas (`/termos`, `/privacidade`) renderizadas por um componente compartilhado `LegalPage`, alimentado por um módulo de conteúdo versionado (`src/data/legal/`). O conteúdo é estático (texto + metadados de versão), sem necessidade de banco de dados — a versão é exposta programaticamente para a Feature 2 consumir.

Não há mutação de dados nem chamadas a Supabase nesta feature. É puramente frontend (rotas + componente + conteúdo + rodapé), o que a torna rápida e de baixo risco.

## Architecture

```
src/
  data/legal/
    index.ts                 # LEGAL_DOCS: metadados (version, updatedAt) + getters
    termsContent.tsx         # conteúdo JSX dos Termos de Uso
    privacyContent.tsx       # conteúdo JSX da Política de Privacidade
  components/
    SiteFooter.tsx           # rodapé global com links legais (NOVO)
    legal/
      LegalPage.tsx          # layout compartilhado das páginas legais
      LegalSectionNav.tsx    # índice de âncoras (opcional, desktop)
  pages/
    TermosPage.tsx           # wrapper: <LegalPage doc="terms" />
    PrivacidadePage.tsx      # wrapper: <LegalPage doc="privacy" />
App.tsx                      # rotas públicas /termos e /privacidade
```

### Fluxo de renderização

```
/termos  ──> TermosPage ──> LegalPage(doc=terms) ──┐
                                                    ├─> lê LEGAL_DOCS[doc]
/privacidade ─> PrivacidadePage ─> LegalPage(privacy)┘   (version, updatedAt, Content)
                                                         renderiza header + conteúdo + footer
```

## Components and Interfaces

### Legal content module (`src/data/legal/index.ts`)

```ts
export type LegalDocKey = 'terms' | 'privacy';

export interface LegalDocMeta {
  key: LegalDocKey;
  title: string;          // "Termos de Uso"
  /** Versão canônica (data ISO) consumida pela Feature 2. */
  version: string;        // ex.: '2026-06-05'
  updatedAt: string;      // exibição: '05 de junho de 2026'
  route: string;          // '/termos'
}

export const LEGAL_DOCS: Record<LegalDocKey, LegalDocMeta> = {
  terms:   { key: 'terms',   title: 'Termos de Uso',           version: '2026-06-05', updatedAt: '05 de junho de 2026', route: '/termos' },
  privacy: { key: 'privacy', title: 'Política de Privacidade', version: '2026-06-05', updatedAt: '05 de junho de 2026', route: '/privacidade' },
};

/** Versão combinada usada pela Feature 2 ao registrar o aceite. */
export function currentLegalVersion(): string {
  return `terms@${LEGAL_DOCS.terms.version}|privacy@${LEGAL_DOCS.privacy.version}`;
}
```

### LegalPage (`components/legal/LegalPage.tsx`)

```tsx
interface LegalPageProps {
  doc: LegalDocKey;
}
// - useDocumentTitle(`${meta.title} — FreteGO`)
// - header: h1 com título + linha "Última atualização: {updatedAt} · v{version}"
// - corpo: <article> com o Content do documento (prose styling)
// - SiteFooter ao final
```

Estilo: container `max-w-3xl mx-auto px-4 py-8`, tipografia `prose`-like com classes Tailwind (títulos `text-xl/lg`, parágrafos `text-sm text-gray-700 leading-relaxed`). Coluna única em mobile (Requirement 1.5).

### SiteFooter (`components/SiteFooter.tsx`)

```tsx
// Rodapé reutilizável com:
//  - links: Termos de Uso (/termos), Política de Privacidade (/privacidade)
//  - copyright: © {ano} FreteGO
// Usado em: LoginPage, RegisterPage, HomePage pública e nas LegalPages.
```

### Rotas (App.tsx)

```tsx
<Route path="/termos" element={<LazyRoute><TermosPage /></LazyRoute>} />
<Route path="/privacidade" element={<LazyRoute><PrivacidadePage /></LazyRoute>} />
```

Rotas públicas (sem `ProtectedRoute`).

## Data Models

Nenhum modelo de banco. Os únicos "dados" são os metadados estáticos em `LEGAL_DOCS` (versão + data). O conteúdo textual vive em componentes JSX versionados no git, que servem como trilha de auditoria de mudanças (histórico do repositório).

## Error Handling

- Rota legal sempre resolve (conteúdo estático embutido no bundle); não há estado de erro de rede.
- Se `doc` inválido for passado ao `LegalPage` (impossível via rotas tipadas), renderiza um fallback "Documento não encontrado" com link para a home.

## Testing Strategy

- **Unit**: `currentLegalVersion()` retorna string estável no formato `terms@<v>|privacy@<v>`; `LEGAL_DOCS` tem `version` e `updatedAt` não-vazios para ambos os docs.
- **Render**: `LegalPage` exibe o título, a data de atualização e a versão; define `document.title`.
- **Footer**: `SiteFooter` renderiza links com `href` corretos (`/termos`, `/privacidade`) e o ano corrente.
- **Acessibilidade**: a página tem exatamente um `h1`.

## Correctness Properties

### Property 1: Versão sempre exposta e estável
**Validates: Requirements 3.1, 3.3**
Para cada documento em `LEGAL_DOCS`, `version` e `updatedAt` são strings não-vazias, e `currentLegalVersion()` inclui as versões de ambos os documentos de forma determinística (mesma saída para o mesmo estado).

### Property 2: Rotas legais são públicas e idempotentes
**Validates: Requirements 1.1, 2.1**
Navegar para `/termos` ou `/privacidade` sem sessão autenticada renderiza a Legal_Page correspondente; recarregar a página produz o mesmo conteúdo (sem dependência de estado de sessão).

### Property 3: Links do rodapé apontam para as rotas corretas
**Validates: Requirements 4.1, 4.3, 4.4**
O `SiteFooter` sempre renderiza um link cujo destino é exatamente `LEGAL_DOCS.terms.route` e outro para `LEGAL_DOCS.privacy.route`.

## Decisões e Trade-offs

1. **Conteúdo em JSX versionado, não no banco.** Simplicidade e trilha de auditoria via git. Trade-off: alterar texto exige deploy — aceitável para documento legal (mudança rara e que deve ser revisada em PR).
2. **Versão como data ISO.** Fácil de ler, ordenar e comparar; serve de chave natural para o registro de aceite da Feature 2.
3. **SiteFooter próprio em vez de reusar footers locais.** Hoje cada página tem seu footer ad-hoc. Um componente único evita divergência e centraliza os links legais. Trade-off: pequena refatoração das páginas públicas para adotá-lo.
