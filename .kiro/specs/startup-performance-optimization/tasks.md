# Implementation Plan: Startup Performance Optimization

## Overview

Plano incremental e retrocompatível derivado do design (4 pilares: auth otimista, Shell +
Skeleton localizado, Data_Cache em memória opt-in, code splitting incremental). A ordem segue
a estratégia test-driven: a **lógica pura testável** (deriveKey, Data_Cache, loadOrchestrator,
agregação paralela) é entregue e validada por property tests **antes** da integração nas telas.
Cada pilar é entregue de forma independente, sem quebrar o `Behavior_Baseline`.

Convenções respeitadas (steering do projeto):
- Linguagem: TypeScript strict (stack atual). Nenhuma dependência de runtime nova.
- Property tests em `src/__tests__/` com convenção `cp<N>_<nome>.property.test.ts`, `{ numRuns: 100 }`.
- CPs obrigatórios **nunca** marcados com `*`. Sub-tarefas de teste opcionais (unit/exemplo/render/negativos) marcadas com `*`.
- Contratos de serviços/API/RPC preservados; cache é opt-in envolvendo chamadas existentes.

## Tasks

- [x] 1. Implementar derivação de chave de cache estável
  - [x] 1.1 Criar `src/services/cache/cacheKey.ts` com `deriveKey(namespace, params)`
    - Canonicalizar `params` (ordenar chaves de objeto recursivamente, normalizar `undefined`)
    - Produzir chave `"namespace|<json-canonico>"` independente da ordem das propriedades
    - _Requirements: 6.1, 6.2_

  - [x] 1.2 Escrever property test de estabilidade de chave
    - Arquivo: `src/__tests__/cp7_cacheKeyStability.property.test.ts`
    - **Property 11: Chave de cache estável e independente da ordem dos parâmetros**
    - **Validates: Requirements 6.1, 6.2**
    - Geradores: `fc.constantFrom`/objetos com chaves embaralhadas; NÃO usar `fc.stringOf`
    - _Requirements: 6.1, 6.2, 13.2, 13.5_

  - [ ]* 1.3 Escrever testes unitários de borda para `deriveKey`
    - Params `undefined`/vazio, tipos aninhados, valores que diferem produzem chaves diferentes
    - _Requirements: 13.1_

- [x] 2. Implementar o núcleo do Data_Cache em memória
  - [x] 2.1 Criar `src/services/cache/dataCache.ts` (`getOrFetch`, `peek`, `set`, `invalidate`, `invalidateNamespace`, `clear`)
    - `Cache_Entry { value, storedAt, expiresAt }`; validade `now < expiresAt`
    - Dedupe/coalescência via `Map<key, Promise>` para requisições em voo
    - TTL por chamada; em erro do fetcher, remover in-flight e NÃO armazenar entry (propagar erro como hoje)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 12.6_

  - [x] 2.2 Escrever property test de cache hit e coalescência
    - Arquivo: `src/__tests__/cp4_dataCacheHitAndCoalesce.property.test.ts`
    - **Property 7: Cache hit não dispara requisição**
    - **Property 8: Coalescência de requisições concorrentes**
    - **Validates: Requirements 6.1, 6.2, 7.1, 7.2, 7.3**
    - _Requirements: 13.2, 13.5_

  - [x] 2.3 Escrever property test de invalidação e expiração
    - Arquivo: `src/__tests__/cp5_dataCacheInvalidation.property.test.ts`
    - **Property 9: Invalidação e expiração forçam nova busca**
    - **Validates: Requirements 6.3, 6.4, 6.6**
    - _Requirements: 13.2, 13.5_

  - [x] 2.4 Escrever property test de equivalência e idempotência de leitura
    - Arquivo: `src/__tests__/cp6_dataCacheEquivalence.property.test.ts`
    - **Property 10: Equivalência e idempotência de leitura**
    - **Validates: Requirements 6.5, 13.2**
    - _Requirements: 13.2, 13.5_

  - [ ]* 2.5 Escrever testes unitários do cache
    - Expiração por TTL, `invalidate`/`invalidateNamespace`/`set`/`clear`, remoção de in-flight em erro
    - _Requirements: 13.1, 13.3_

- [x] 3. Implementar o orquestrador de ordem de carregamento
  - [x] 3.1 Criar `src/services/loadOrchestrator.ts` (`STAGE_PRIORITY`, `nextStartableStages`)
    - Enum ordenável `auth(0) < shell(1) < primary(2) < secondary(3)`
    - Função pura que libera estágios respeitando predecessores e a regra de degradação 3.4
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Escrever property test da invariante de ordem
    - Arquivo: `src/__tests__/cp2_loadOrchestratorOrder.property.test.ts`
    - **Property 4: Invariante da ordem de carregamento**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 13.4**
    - _Requirements: 13.4, 13.5_

- [x] 4. Implementar agregação paralela de resultados independentes
  - [x] 4.1 Criar `src/utils/aggregateSettled.ts` (agregador puro sobre `Promise.allSettled`)
    - Reúne resultados bem-sucedidos e isola falhas por bloco; resultado independente da ordem de resolução
    - _Requirements: 4.1, 4.3, 4.4, 3.6_

  - [x] 4.2 Escrever property test de agregação paralela
    - Arquivo: `src/__tests__/cp3_parallelAggregation.property.test.ts`
    - **Property 5: Falhas parciais não bloqueiam sucessos**
    - **Property 6: Independência de ordem do estado agregado**
    - **Validates: Requirements 4.3, 3.6, 4.4**
    - _Requirements: 13.3, 13.4, 13.5_

- [x] 5. Checkpoint - Núcleo de lógica pura validado
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implementar auth otimista não bloqueante
  - [x] 6.1 Criar helper `verifySessionForBootstrap()` (em `src/hooks/useAuth.tsx` ou helper auth)
    - Retorna `{ kind: 'valid' | 'invalid' | 'network-error' }` distinguindo sessão inválida de erro de transporte
    - NÃO alterar `getCurrentUser` (preserva contrato)
    - _Requirements: 1.3, 1.4, 12.6_

  - [x] 6.2 Tornar a hidratação do `AuthProvider` otimista
    - Hidratar `user`/`isAuthenticated` da Cached_Session de forma síncrona; `isLoading=false` no mesmo ciclo
    - Disparar verificação em background sem `await` bloqueante; inválido ⇒ `clearAuthData`; network-error ⇒ preservar sessão
    - Sem Cached_Session ⇒ `user=null`, `isLoading=false`, sem `Supabase_Query`
    - Preservar integralmente o auto-refresh de token a cada 50 minutos
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

  - [x] 6.3 Escrever property test de hidratação otimista de auth
    - Arquivo: `src/__tests__/cp1_authOptimisticHydration.property.test.ts`
    - **Property 1: Hidratação otimista de auth**
    - **Property 2: Verificação inválida limpa a sessão**
    - **Property 3: Erro de rede preserva a sessão**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
    - `vi.mock` hoisted: expor spies via `(globalThis as Record<string, unknown>).__nomeDoSpy`
    - _Requirements: 13.2, 13.3, 13.5_

  - [ ]* 6.4 Escrever testes de exemplo/render para auth
    - Caminho negativo de rede preserva sessão; auto-refresh 50min via fake timers
    - _Requirements: 1.6, 13.3_

- [x] 7. Implementar carregamento resiliente de chunks
  - [x] 7.1 Criar `src/utils/lazyWithRetry.tsx`
    - `React.lazy` com 1 retry de `import()`; persistindo a falha, estado de erro recuperável local sem derrubar o app
    - _Requirements: 5.5_

  - [ ]* 7.2 Escrever testes negativos de chunk
    - Falha de `import()` que recupera no retry; falha persistente exibe erro recuperável
    - _Requirements: 5.5, 13.3_

- [x] 8. Converter Eager_Components em Lazy_Components com segurança
  - [x] 8.1 Aplicar `lazyWithRetry` em rotas/components elegíveis em `src/App.tsx`
    - Converter `LoginPage`, `RegisterPage`, `NotFoundPage`, `LandingPage` (e HomePage com cuidado) preservando rotas e navegação
    - Alinhar o fallback do `LazyRoute` ao fundo das telas internas (sem alterar conteúdo/rotas)
    - Preservar todas as rotas (públicas, protegidas, admin, honeypot)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 2.5, 12.2_

  - [ ]* 8.2 Escrever testes de resolução de rotas
    - Cada rota do baseline resolve para o componente esperado após lazy
    - _Requirements: 5.4, 5.6, 12.2_

- [x] 9. Criar Skeletons de região
  - [x] 9.1 Criar `FreteListSkeleton` e skeletons de região
    - Placeholders restritos à região de Primary_Content/Secondary_Data, substituindo a tela cheia `WelcomeLoading`
    - _Requirements: 2.3, 9.1_

- [x] 10. Aplicar Shell + Skeleton e paralelização na HomePage
  - [x] 10.1 Renderizar o Shell sempre visível e mover o indicador para a região do feed
    - Shell (header, carrosséis, toolbar, filtros) interativo; só a grade de fretes mostra `FreteListSkeleton`
    - Evitar tela branca e substituição da tela inteira por loader de tela cheia
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 9.1, 9.2, 9.3, 9.4_

  - [x] 10.2 Paralelizar fetches independentes via `Promise.allSettled` usando `aggregateSettled`
    - Encadear apenas quando houver dependência real; falhas parciais não bloqueiam sucessos; dados finais equivalentes ao baseline
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 3.5, 3.6_

  - [ ]* 10.3 Escrever testes de render da HomePage
    - Shell presente com Primary/Secondary pendentes; skeleton restrito à região; degradação só na região afetada
    - _Requirements: 2.1, 2.2, 2.3, 9.1, 9.2, 9.3, 9.4_

- [x] 11. Checkpoint - Shell, auth otimista e splitting integrados
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Integrar o Data_Cache nos serviços (opt-in, sem mudar contratos)
  - [x] 12.1 Envolver `getActiveFretes` com `dataCache.getOrFetch` + invalidação por escrita
    - Namespace `fretes:active`, TTL curto; valor equivalente ao retorno direto; invalidar em escrita de frete
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 12.5, 12.6_

  - [x] 12.2 Envolver `getMotoristaCalcContext` com `dataCache.getOrFetch`
    - Namespace `motorista:calcContext`, TTL médio; invalidar ao salvar veículo/diesel; preservar resultados de cálculo
    - _Requirements: 6.1, 6.5, 12.5, 12.6_

  - [x] 12.3 Envolver `getLikedFreteIds` com `dataCache.getOrFetch` + invalidação no toggle de like
    - Namespace `likes:idsByUser`, TTL médio; invalidar na escrita de like
    - _Requirements: 6.1, 6.4, 6.5, 12.6_

  - [x] 12.4 Envolver `getCommunityPublicProfile` com `dataCache.getOrFetch`
    - Namespace `community:publicProfile`, TTL longo; invalidar em mudança de perfil público
    - _Requirements: 6.1, 6.4, 6.5, 12.6_

  - [x] 12.5 Conectar invalidação por `Realtime_Channel` preservando o debounce de 500ms da HomePage
    - Handler de realtime invalida o namespace antes do refetch silencioso; preservar comportamento de tempo real do baseline
    - _Requirements: 6.6, 7.4, 12.5_

  - [x] 12.6 Limpar o Data_Cache no logout
    - Chamar `dataCache.clear()` no fluxo de logout para evitar vazamento entre sessões
    - _Requirements: 6.4, 12.1_

  - [ ]* 12.7 Escrever testes unitários de equivalência por serviço
    - Cache retorna o mesmo dado que a fonte; invalidação por escrita/realtime força refetch
    - _Requirements: 13.1, 13.2_

- [x] 13. Implementar carregamento sob demanda abaixo da dobra e lazy de imagens
  - [x] 13.1 Criar `src/components/perf/DeferUntilVisible.tsx`
    - Monta `children` ao se aproximar da viewport via `IntersectionObserver`; reserva espaço para evitar layout shift
    - _Requirements: 8.1, 8.4_

  - [x] 13.2 Aplicar `loading="lazy"` + `decoding="async"` em imagens não críticas
    - Preservar `width`/`height`/aspect-ratio; carregar ao entrar na área visível
    - _Requirements: 8.2, 8.3, 8.4_

  - [ ]* 13.3 Escrever testes de exemplo com `IntersectionObserver` mockado
    - Defer monta ao aproximar da viewport; imagens com lazy preservam dimensões
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 14. Ajustar o Build_Pipeline (`manualChunks`)
  - [x] 14.1 Ajustar `manualChunks` em `vite.config.ts`
    - Preservar grupos `vendor`, `supabase`, `leaflet`, `forms`; isolar libs pesadas não críticas; nenhum chunk crítico importa `leaflet`/mapas estaticamente
    - _Requirements: 11.1, 11.2, 5.1_

- [x] 15. Produzir o Audit_Report (entregável de documentação)
  - [x] 15.1 Criar o documento de auditoria de performance referenciando pontos do código
    - Listar Supabase_Query desnecessárias/duplicadas, renderizações e oportunidades de memoização, Eager_Components convertíveis e gargalos priorizados por impacto, com referências a arquivos/pontos específicos
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 16. Verificação final de build e não-regressão
  - [x] 16.1 Rodar `npm run build` + `tsc` e a Regression_Suite completa
    - Build/tsc sem novos erros; execução equivalente ao baseline; toda a Regression_Suite (cache, auth, ordem, agregação, rotas, cálculos, RBAC) verde
    - _Requirements: 11.3, 11.4, 12.7_

- [ ] 17. Checkpoint final - Tudo verde
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tarefas marcadas com `*` são opcionais para MVP (unit/exemplo/render/negativos). Os
  property tests dos Correctness Properties (CP1–CP7) são **obrigatórios** e por isso **não**
  recebem `*`, conforme `testing-governance.md` e `project-conventions.md`.
- Cada tarefa referencia requisitos específicos para rastreabilidade; tarefas de teste de
  propriedade referenciam explicitamente a Property do design e seus requisitos.
- O cache é opt-in por serviço: assinaturas observáveis não mudam; em qualquer falha o fetcher
  original é chamado (fail-safe ao baseline).
- Property tests ficam em `src/__tests__/` (rodam no pre-commit e CI); a verificação de build e
  a Regression_Suite garantem a não-regressão final.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1", "6.1", "7.1", "9.1", "13.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "2.4", "3.2", "4.2", "6.2", "7.2", "13.2"] },
    { "id": 2, "tasks": ["1.3", "2.5", "6.3", "6.4", "8.1", "10.1", "13.3"] },
    { "id": 3, "tasks": ["8.2", "10.2", "12.1", "12.2", "12.3", "12.4"] },
    { "id": 4, "tasks": ["10.3", "12.5", "12.6", "12.7", "14.1"] },
    { "id": 5, "tasks": ["15.1"] },
    { "id": 6, "tasks": ["16.1"] }
  ]
}
```
