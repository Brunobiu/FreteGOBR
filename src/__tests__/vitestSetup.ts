// Setup global do Vitest (roda antes de cada arquivo de teste).
//
// Polyfills de APIs do navegador que o jsdom não implementa, mas que componentes
// do app usam no boot (ex.: `IntersectionObserver` no SocialRail/DeferUntilVisible).
// Instalar aqui — e não inline em cada teste — evita que os testes dependam da
// ordem de execução: antes, `landingPage.test.tsx`/`fretesAoVivoPage.test.tsx`
// definiam o stub no `window` global e ele "vazava" para os demais arquivos,
// deixando `publicPagesExpansion.test.tsx` flaky (passava só quando rodava depois).

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

if (!('IntersectionObserver' in globalThis)) {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    MockIntersectionObserver;
}
