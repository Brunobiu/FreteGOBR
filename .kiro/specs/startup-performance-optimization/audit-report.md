# Relatório de Auditoria de Performance de Inicialização — FreteGO

**Feature:** `startup-performance-optimization`
**Entregável:** Audit_Report (Requirement 10 — task 15.1)
**Escopo:** Fluxo de inicialização (Bootstrap → First_Useful_Paint → Primary_Content →
Secondary_Data), com foco em `Supabase_Query`, renderizações, `Eager_Components` e gargalos
de abertura.

> Este documento é apenas análise/documentação. Nenhum código foi alterado por ele. Cada item
> referencia arquivos e pontos específicos do código-base (Req 10.5). As linhas são
> aproximadas e podem variar com edições futuras; quando possível, ancore pela assinatura da
> função/símbolo citado.

---

## 1. Sumário executivo

Esta feature já mitigou os três maiores gargalos de abertura identificados:

1. **Auth bloqueante** — o `AuthProvider` deixou de prender o primeiro paint aguardando
   `getCurrentUser()`; agora hidrata de forma otimista a partir da `Cached_Session`
   (`src/hooks/useAuth.tsx`).
2. **Bundle inicial pesado** — quase todas as rotas e o widget global foram convertidos de
   `Eager_Components` para `Lazy_Components` via `lazyWithRetry` (`src/App.tsx`).
3. **Refetch a cada navegação** — as 4 principais leituras da HomePage passaram por uma camada
   de `Data_Cache` em memória com TTL + dedupe + invalidação por escrita/realtime
   (`src/services/{fretes,motorista,likes,communityPublic}.ts`).

Restam oportunidades de menor impacto (memoização de `FreteCard`, aplicação efetiva do
`DeferUntilVisible`, ajuste fino do `manualChunks`), detalhadas adiante e priorizadas na
seção 6.

---

## 2. Supabase_Query desnecessárias ou duplicadas (Req 10.1)

### 2.1 Inventário do fluxo de inicialização (HomePage autenticada como motorista)

Ao abrir a rota raiz/`/fretes` como motorista, a HomePage dispara, no mesmo ciclo de render,
quatro leituras independentes mais a assinatura realtime:

| Query | Origem no código | Disparo |
|-------|------------------|---------|
| `getActiveFretes(filters)` | `src/pages/HomePage.tsx` → `loadFretes` (≈ l. 240-246) chamando `src/services/fretes.ts` `getActiveFretes` (≈ l. 380) | `useEffect` do feed (≈ l. 280) |
| `getMotoristaCalcContext(userId)` | `src/pages/HomePage.tsx` `useEffect` (≈ l. 178-188) → `src/services/motorista.ts` (≈ l. 334) | `useEffect [isMotorista, user]` |
| `getLikedFreteIds(userId)` | `src/pages/HomePage.tsx` `useEffect` (≈ l. 205-208) → `src/services/likes.ts` (≈ l. 121) | `useEffect [isMotorista, user]` |
| `getCommunityPublicProfile()` | `src/pages/HomePage.tsx` `useEffect` (≈ l. 104-106) → `src/services/communityPublic.ts` (≈ l. 50) | `useEffect []` (mount) |
| Realtime `fretes-realtime` | `src/pages/HomePage.tsx` `supabase.channel('fretes-realtime')` (≈ l. 318-330) | mesmo `useEffect` do feed |

Além dessas, o Bootstrap historicamente disparava `getCurrentUser()` no `AuthProvider`.

### 2.2 ANTES (Behavior_Baseline) — problemas identificados

- **B1 — Verificação de sessão bloqueava o paint.** O `AuthProvider` iniciava com
  `isLoading = true` e **sempre** aguardava `getCurrentUser()` (rede) antes de liberar o
  render. Mesmo com sessão salva, o usuário via "Carregando..." durante a ida ao servidor.
  Ponto: `src/hooks/useAuth.tsx` (estado inicial de `isLoading`/efeito de verificação).
- **B2 — Refetch integral a cada navegação.** `getActiveFretes`, `getMotoristaCalcContext`,
  `getLikedFreteIds` e `getCommunityPublicProfile` iam à rede em **toda** entrada/reentrada na
  HomePage, sem reaproveitar resultado recente. Trocar de tela e voltar refazia as 4 queries.
- **B3 — Sem coalescência.** Duas montagens próximas (ex.: StrictMode em dev, navegação rápida)
  podiam disparar requisições idênticas concorrentes sem deduplicação.
- **B4 — Realtime podia servir/observar dado obsoleto.** O refetch silencioso do canal
  `fretes-realtime` não tinha camada de cache para invalidar coerentemente.

### 2.3 DEPOIS — o que esta feature já mitigou

- **B1 resolvido:** hidratação síncrona da `Cached_Session` em `readCachedUser()` e
  `useState(() => readCachedUser())`; verificação movida para background não bloqueante via
  `verifySessionForBootstrap()`. Ref.: `src/hooks/useAuth.tsx` (`readCachedUser`, efeito de
  verificação ≈ l. 80-120) e `src/services/authSession.ts`. Sem `Cached_Session`,
  `isLoading=false` sem nenhuma `Supabase_Query` (Req 1.5).
- **B2 resolvido (opt-in, sem mudar contrato):** as 4 leituras agora passam por
  `dataCache.getOrFetch` com TTL por namespace:
  - `fretes:active`, TTL 30s — `src/services/fretes.ts` (`FRETES_ACTIVE_NAMESPACE` l. 17,
    `FRETES_TTL_MS` l. 25, `getActiveFretes` l. 380).
  - `motorista:calcContext`, TTL 5min — `src/services/motorista.ts` (`CALC_CONTEXT_NAMESPACE`
    l. 24, `CALC_CONTEXT_TTL_MS` l. 34, `getMotoristaCalcContext` l. 334).
  - `likes:idsByUser`, TTL 5min — `src/services/likes.ts` (`LIKES_IDS_NAMESPACE` l. 19,
    `LIKES_TTL_MS` l. 27, `getLikedFreteIds` l. 121).
  - `community:publicProfile`, TTL 30min — `src/services/communityPublic.ts`
    (`COMMUNITY_PUBLIC_PROFILE_NAMESPACE` l. 25, `COMMUNITY_PROFILE_TTL_MS` l. 28).
- **B3 resolvido:** dedupe/coalescência via `Map<key, Promise>` em
  `src/services/cache/dataCache.ts` (`getOrFetch`, in-flight ≈ l. 62-108). Chave estável por
  `deriveKey` (`src/services/cache/cacheKey.ts`).
- **B4 resolvido:** invalidação por escrita e por realtime:
  - escrita de frete/realtime → `invalidateActiveFretesCache()` chamado **antes** do refetch
    silencioso no handler do canal (`src/pages/HomePage.tsx` ≈ l. 293-300).
  - toggle de like → `dataCache.invalidate(...)` em `src/services/likes.ts` (≈ l. 67).
  - salvar veículo/diesel → `invalidateMotoristaCalcContext` em `src/services/motorista.ts`
    (≈ l. 48).
  - logout → `dataCache.clear()` em `clearAuthData` (`src/hooks/useAuth.tsx`), evitando
    vazamento entre sessões.

### 2.4 Ainda pode ser melhorado

- **M1 — `getCommunityPublicProfile` carregado para todos os perfis.** O `useEffect []`
  (`src/pages/HomePage.tsx` ≈ l. 104) dispara mesmo para embarcador/visitante, embora o
  `communityProfile` seja consumido sobretudo no fluxo de cards do motorista
  (`FreteCard`/`FreteModal`). Avaliar condicionar a `isMotorista` (impacto baixo; o TTL longo
  de 30min já amortiza navegações repetidas).
- **M2 — Persistência cross-sessão.** O `Data_Cache` vive só em memória de módulo. Reaberturas
  de app frio (Capacitor/refresh) refazem as queries. Um cache persistente de leitura (ex.:
  `localStorage`/`IndexedDB` com TTL) para `community:publicProfile` reduziria o tempo até o
  conteúdo no cold start. Tratar como recomendação futura (risco de staleness — manter
  fail-safe).
- **M3 — `incrementFreteViews` por clique.** `src/pages/HomePage.tsx` `handleFreteClick`
  (≈ l. 330) e `onSelectFreteRetorno` chamam `incrementFreteViews` a cada abertura — é escrita
  esperada (telemetria), não duplicação; apenas registrado aqui para completude do inventário.

---

## 3. Renderizações desnecessárias e oportunidades de memoização (Req 10.2)

### 3.1 Já implementado nesta feature / já presente no baseline

- **HomePage memoiza derivações e handlers.** `src/pages/HomePage.tsx`:
  - `visibleFretes` via `useMemo` com deps `[isMotorista, fretes, motoristaPoint, radiusKm]`
    (≈ l. 380) — evita reexecutar `filterFretesByRadius` a cada render.
  - handlers estáveis via `useCallback`: `goToPage` (≈ l. 78), `handleRadiusChange` (≈ l. 145),
    `handleLikeToggle` (≈ l. 210), `handleCommoditySelect` (≈ l. 230), `loadFretes` (≈ l. 240),
    `handleFilterChange` (≈ l. 320).

### 3.2 Oportunidades (recomendações futuras)

- **R1 — `FreteCard` sem `React.memo` (impacto médio em listas grandes).**
  `src/components/FreteCard.tsx` exporta `export default function FreteCard(...)` (l. 43) sem
  memoização. Na grade (`currentFretes.map(...)` em `src/pages/HomePage.tsx`), qualquer
  re-render do pai (ex.: `setToast`, mudança de página, atualização de like) re-renderiza
  todos os cards visíveis. Embora a paginação limite a 9 itens por página
  (`itemsPerPage = 9`), envolver `FreteCard` em `React.memo` com comparação das props
  relevantes (`frete.id`, `initialLiked`, `motoristaCalc`, `communityProfile`) cortaria
  re-renders redundantes. **Pré-requisito:** garantir que `onClick`/`onLikeToggle`/`onLikeBlocked`
  sejam referências estáveis — `onLikeToggle` já é `useCallback`, mas `onClick={() => handleFreteClick(frete)}`
  e `onLikeBlocked={(msg) => ...}` são recriados por item a cada render, o que anularia o
  `memo`. Recomenda-se estabilizar esses callbacks antes de aplicar `React.memo`.
- **R2 — `communityProfile` propagado a cada card.** Passado como prop em todos os
  `FreteCard`/`FreteModal`. É estável após o fetch, então não causa re-render por si, mas
  reforça o valor de R1 (memo do card).
- **R3 — `setToast` dispara re-render da HomePage inteira.** Toasts (`src/pages/HomePage.tsx`
  estado `toast`) re-renderizam toda a árvore do feed. Com R1 aplicado, o custo fica contido;
  alternativamente, isolar o toast em um componente próprio com seu próprio estado. Impacto
  baixo.

---

## 4. Eager_Components e imports pesados convertíveis (Req 10.3)

### 4.1 Já implementado nesta feature

- **Rotas e widget global convertidos para `Lazy_Components`** via `lazyWithRetry`
  (`src/utils/lazyWithRetry.tsx`) em `src/App.tsx`:
  - `FreteChatWidget` (l. 17), `HomePage` (l. 22), `LandingPage` (l. 23), `NotFoundPage`
    (l. 24), `LoginPage` (l. 25), `RegisterPage` (l. 28) e **todas** as páginas de motorista,
    embarcador, tickets, admin e honeypot (l. 33-68).
  - Cada `import()` ganha 1 retry automático e um error boundary local `LazyBoundary`
    (`src/utils/lazyWithRetry.tsx` l. 169+), evitando tela branca em falha de chunk (Req 5.5).
  - `LazyRoute` (`src/App.tsx` l. 71-85) fornece fallback visível alinhado ao fundo das telas
    internas (`bg-gray-100`), sem tela branca.
- **Leaflet isolado do bundle inicial:**
  - `manualChunks.leaflet` em `vite.config.ts` (l. ~16) separa `leaflet` + `react-leaflet`.
  - `InteractiveMap` é `lazy(() => import('../components/InteractiveMap'))` em
    `src/pages/HomePage.tsx` (≈ l. 52), montado só quando `showMap` fica `true`.
  - O motorista usa `MapaToolbar`, que lazy-carrega o próprio mapa.
- **Imports fire-and-forget** de módulos não críticos: `pushNotifications` é importado
  dinamicamente em `saveAuthData`/`clearAuthData` (`src/hooks/useAuth.tsx`), fora do caminho
  crítico de login.

### 4.2 Imports ainda estáticos no caminho crítico (recomendações futuras)

- **R4 — `leaflet/dist/leaflet.css` importado no `main.tsx` (impacto baixo/médio).**
  `src/main.tsx` (l. 8) faz `import 'leaflet/dist/leaflet.css'` de forma estática, entrando no
  CSS inicial mesmo quando o mapa nunca é aberto. Avaliar mover o import do CSS para dentro do
  componente `InteractiveMap`/`MapaToolbar` (lazy), garantindo que o estilo do mapa só carregue
  com o chunk do mapa. Validar que não há regressão visual no carregamento sob demanda.
- **R5 — Eager imports da HomePage (impacto baixo).** A HomePage importa estaticamente
  `AnunciosCarousel`, `CommoditiesCarousel`, `FreteTable`, `FreteModal`, `RadiusSelector`,
  `DieselDashboardInput` etc. (`src/pages/HomePage.tsx` topo). Como a própria HomePage já é um
  chunk lazy, esses ficam fora do bundle inicial do app; porém componentes claramente "abaixo
  da dobra" ou condicionais (ex.: `FreteTable`, usado só na view de tabela do embarcador)
  poderiam ser `lazy` dentro do chunk da HomePage para reduzir seu tamanho. Baixa prioridade.
- **R6 — Provadores/efeitos globais no `main.tsx`.** `installGlobalErrorCapture()`
  (`src/main.tsx` l. 15) roda em module scope no bootstrap. É leve e idempotente; apenas
  registrado para completude — sem ação recomendada.

---

## 5. Recursos carregáveis sob demanda e gargalos de abertura (Req 10.4)

### 5.1 Já implementado nesta feature

- **Imagens com `loading="lazy"` + `decoding="async"`** (task 13.2), preservando dimensões para
  evitar layout shift, aplicadas amplamente, incluindo no caminho de abertura:
  - `src/components/FreteCard.tsx` (l. ~95), `src/components/AnunciosCarousel.tsx` (l. ~132),
    `src/components/CommoditiesCarousel.tsx` (l. ~146), `src/components/AppHeader.tsx`
    (l. ~242), `src/components/MotoristaBottomNav.tsx` (l. ~251), `src/components/FreteModal.tsx`
    (l. ~322/356/493), além de telas de perfil/admin/mensagens.
- **Skeleton localizado em vez de loader de tela cheia.** `FreteListSkeleton`
  (`src/components/FreteListSkeleton.tsx`) é renderizado apenas na região do feed quando
  `isLoading` (`src/pages/HomePage.tsx` ≈ l. 440), mantendo header, carrosséis, toolbar e
  filtros interativos (Req 2.3, 9.1-9.4). Substituiu a antiga troca da tela inteira por
  `WelcomeLoading`.
- **`DeferUntilVisible` disponível** (`src/components/perf/DeferUntilVisible.tsx`) para montar
  conteúdo abaixo da dobra via `IntersectionObserver`, com fallback que reserva espaço
  (Req 8.1, 8.4).

### 5.2 Gargalos de abertura priorizados

Ver tabela consolidada na seção 6.

### 5.3 Recomendações de carregamento sob demanda (futuras)

- **R7 — `DeferUntilVisible` ainda não está aplicado na HomePage.** O componente existe mas a
  busca por usos (`grep DeferUntilVisible`) só o encontra em sua própria definição e na lista
  de tarefas — ele não envolve nenhum bloco abaixo da dobra ainda. Candidatos: `AnunciosCarousel`
  e `CommoditiesCarousel` (`src/pages/HomePage.tsx` no ramo motorista), que aparecem antes do
  feed mas podem estar parcialmente fora da viewport inicial em telas menores. Aplicar
  `DeferUntilVisible` (ou pelo menos confirmar que as imagens internas já são `loading="lazy"`,
  o que é o caso). Impacto baixo/médio.
- **R8 — `InteractiveMap` (embarcador).** Já é sob demanda (`showMap`); manter. Nenhuma ação.

---

## 6. Tabela de priorização por impacto (Req 10.4)

| ID | Item | Categoria | Status | Impacto | Esforço | Arquivo/Ponto |
|----|------|-----------|--------|---------|---------|---------------|
| B1 | Auth bloqueava o primeiro paint | Query/Bootstrap | ✅ Implementado | Alto | — | `src/hooks/useAuth.tsx`, `src/services/authSession.ts` |
| B2 | Refetch integral a cada navegação | Query/Cache | ✅ Implementado | Alto | — | `src/services/{fretes,motorista,likes,communityPublic}.ts` |
| Bundle | Rotas eager no bundle inicial | Code splitting | ✅ Implementado | Alto | — | `src/App.tsx`, `src/utils/lazyWithRetry.tsx` |
| Shell | Loader de tela cheia bloqueando UI | Render/UX | ✅ Implementado | Alto | — | `src/pages/HomePage.tsx`, `src/components/FreteListSkeleton.tsx` |
| B4 | Realtime servia dado obsoleto | Cache/Realtime | ✅ Implementado | Médio | — | `src/pages/HomePage.tsx` (≈ l. 293-300) |
| R1 | `FreteCard` sem `React.memo` | Render | 🔲 Futuro | Médio | Médio | `src/components/FreteCard.tsx` (l. 43) + estabilizar callbacks na HomePage |
| R4 | CSS do leaflet estático no bootstrap | Code splitting | 🔲 Futuro | Médio | Baixo | `src/main.tsx` (l. 8) |
| R7 | `DeferUntilVisible` não aplicado | Sob demanda | 🔲 Futuro | Baixo/Médio | Baixo | `src/pages/HomePage.tsx` (carrosséis) |
| M1 | `getCommunityPublicProfile` para todos | Query | 🔲 Futuro | Baixo | Baixo | `src/pages/HomePage.tsx` (≈ l. 104) |
| M2 | Cache só em memória (cold start) | Cache | 🔲 Futuro | Baixo/Médio | Médio | `src/services/cache/dataCache.ts` |
| R5 | Eager imports condicionais na HomePage | Code splitting | 🔲 Futuro | Baixo | Baixo | `src/pages/HomePage.tsx` (topo) |
| R3 | `setToast` re-renderiza o feed | Render | 🔲 Futuro | Baixo | Baixo | `src/pages/HomePage.tsx` (estado `toast`) |

Legenda: ✅ = entregue nesta feature; 🔲 = recomendação futura (fora do escopo desta feature ou
de menor prioridade).

---

## 7. Já implementado nesta feature vs. Recomendações futuras

### 7.1 Já implementado nesta feature

- Auth otimista não bloqueante (`src/hooks/useAuth.tsx`, `src/services/authSession.ts`).
- `Data_Cache` em memória com `deriveKey`, TTL, dedupe, invalidação e `clear` no logout
  (`src/services/cache/dataCache.ts`, `src/services/cache/cacheKey.ts`) integrado opt-in nas 4
  leituras-chave da HomePage.
- Invalidação por escrita e por `Realtime_Channel` preservando o debounce de 500ms
  (`src/pages/HomePage.tsx`).
- Conversão eager→lazy de praticamente todas as rotas + widget global, com retry de chunk e
  error boundary local (`src/App.tsx`, `src/utils/lazyWithRetry.tsx`).
- Shell sempre visível + `FreteListSkeleton` restrito à região do feed
  (`src/pages/HomePage.tsx`, `src/components/FreteListSkeleton.tsx`).
- `loading="lazy"` + `decoding="async"` em imagens não críticas (amplo).
- `manualChunks` preservando `vendor`/`supabase`/`leaflet`/`forms`; leaflet fora do caminho
  crítico (`vite.config.ts`, `InteractiveMap` lazy).
- `DeferUntilVisible` disponível (`src/components/perf/DeferUntilVisible.tsx`).

### 7.2 Recomendações futuras (priorizadas)

1. **R1 (médio):** memoizar `FreteCard` com `React.memo`, estabilizando antes os callbacks
   `onClick`/`onLikeBlocked` na HomePage.
2. **R4 (médio):** mover `import 'leaflet/dist/leaflet.css'` do `main.tsx` para o chunk lazy do
   mapa.
3. **R7 (baixo/médio):** aplicar `DeferUntilVisible` aos carrosséis abaixo da dobra na HomePage.
4. **M1 (baixo):** condicionar `getCommunityPublicProfile` a `isMotorista`.
5. **M2 (baixo/médio):** avaliar cache de leitura persistente para `community:publicProfile`
   (cold start), com fail-safe contra staleness.
6. **R5/R3 (baixo):** lazy de componentes condicionais da HomePage e isolamento do toast.

> Todas as recomendações futuras devem respeitar a regra-mãe de **não-regressão** (Req 12):
> adotar a alternativa que preserva o `Behavior_Baseline` sempre que houver risco.

---

## 8. Rastreabilidade de requisitos

| Requirement | Onde é atendido neste relatório |
|-------------|----------------------------------|
| 10.1 — Supabase_Query desnecessárias/duplicadas | Seção 2 (inventário, ANTES/DEPOIS, M1-M3) |
| 10.2 — Renderizações e memoização | Seção 3 (R1-R3) |
| 10.3 — Eager_Components e imports pesados | Seção 4 (R4-R6) |
| 10.4 — Recursos sob demanda e gargalos priorizados | Seções 5 e 6 (tabela de impacto) |
| 10.5 — Referências a arquivos/pontos específicos | Todas as seções (caminhos + linhas aproximadas) |
