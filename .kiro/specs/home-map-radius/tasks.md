# Plano de Implementação — Home Map Radius

## Visão Geral

Este plano traduz o design aprovado em uma sequência incremental
de tarefas de codificação. A ordem segue a estratégia
**"de dentro para fora"**: primeiro os utilitários puros (sem
React, sem DOM), depois o componente de mapa lazy, depois o
wiring na `HomePage`, depois o backlog de pedágio em
`PARA_DEPOIS.md`, e por fim os PBTs e o smoke manual.

Cada tarefa principal referencia explicitamente os requirements
e/ou seções do design que valida. Sub-tarefas marcadas com `*` são
opcionais (testes de propriedade) e podem ser puladas em uma
execução de MVP.

> Convert the feature design into a series of prompts for a
> code-generation LLM that will implement each step with incremental
> progress. Make sure that each prompt builds on the previous prompts,
> and ends with wiring things together. There should be no hanging or
> orphaned code that isn't integrated into a previous step. Focus
> ONLY on tasks that involve writing, modifying, or testing code.

---

## Tarefas

- [x] 1. Criar `src/utils/geoDistance.ts` com utilitários puros
  - Criar arquivo novo seguindo o padrão de
    `src/utils/calculoFrete.ts` e `src/utils/phoneFormat.ts`
    (puro, sem React, sem Supabase, sem DOM além do guard de
    `typeof window`).
  - _Refs: Requirements 3, 4, 6; Design Section 3 (Reqs 3, 4, 6),
    Design Section 6_

  - [x] 1.1 Constantes públicas `RADIUS_OPTIONS_KM`,
        `RADIUS_DEFAULT_KM`, `RADIUS_STORAGE_KEY`
    - `RADIUS_OPTIONS_KM = [50, 100, 200, 500] as const`.
    - `type RadiusOption = (typeof RADIUS_OPTIONS_KM)[number]`.
    - `RADIUS_DEFAULT_KM: RadiusOption = 100`.
    - `RADIUS_STORAGE_KEY = 'fretego-motorista-radius'`.
    - JSDoc curto explicando cada constante.
    - _Refs: Requirements 3.1, 3.2; Design Decision 1_

  - [x] 1.2 Re-export `haversineDistanceKm` a partir de
        `services/geolocation.ts`
    - `import { calculateDistance } from '../services/geolocation'`.
    - `export const haversineDistanceKm: (p1: GeographicPoint, p2: GeographicPoint) => number = calculateDistance`.
    - JSDoc explicando que esta é a fachada pública para os
      consumidores novos da feature, sem duplicar a lógica de
      Haversine que já existe no service.
    - _Refs: Requirements 6.7, 6.8; Design Decision 1_

  - [x] 1.3 Função pura `filterFretesByRadius(fretes,
        motoristaPoint, radiusKm)`
    - Assinatura genérica:
      `<T extends { originLocation: GeographicPoint }>(fretes: T[],
      motoristaPoint: GeographicPoint | null, radiusKm: number): T[]`.
    - Quando `motoristaPoint === null`: retornar `fretes` (mesma
      referência).
    - Quando `motoristaPoint !== null`: filtrar mantendo apenas
      fretes cujo `originLocation` seja válido (lat/lng finitos e
      não ambos zero) E
      `haversineDistanceKm(motoristaPoint, f.originLocation) <= radiusKm`.
    - Helper interno `hasValidLocation(p)` checa
      `Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
      && !(p.latitude === 0 && p.longitude === 0)`.
    - _Refs: Requirements 4.1, 4.2, 4.6, 4.7, 7.1_

  - [x] 1.4 Helper `readStoredRadius(raw: string | null):
        RadiusOption`
    - Se `raw === null` → retornar `RADIUS_DEFAULT_KM`.
    - Se `Number(raw)` não for finito → retornar
      `RADIUS_DEFAULT_KM`.
    - Se o número parsado pertencer a `RADIUS_OPTIONS_KM` → retornar
      esse valor (cast para `RadiusOption`).
    - Caso contrário → retornar `RADIUS_DEFAULT_KM`.
    - Pura, sem leitura direta do `localStorage` (HomePage faz a
      leitura e passa o `raw`).
    - _Refs: Requirements 3.4, 3.5_

  - [x] 1.5 Helper `writeStoredRadius(value: RadiusOption): void`
    - Guard `typeof window === 'undefined'` retorna sem efeito.
    - `try { window.localStorage.setItem(RADIUS_STORAGE_KEY,
      String(value)) } catch { }` — engole erros (Safari privado,
      quota cheia).
    - _Refs: Requirements 3.3, 3.5_

- [x] 2. Criar `src/components/MapaFretes.tsx` (componente lazy)
  - Criar arquivo novo. **Primeira linha** do arquivo:
    `import 'leaflet/dist/leaflet.css'` — para garantir que o CSS
    cai no chunk lazy junto com o JS.
  - _Refs: Requirements 1, 2, 3, 5, 7, 9, 10; Design Section 3
    (Reqs 1, 2, 3, 5, 7, 9), Design Section 5_

  - [x] 2.1 Definir `MapaFretesProps` e estado base
    - Props: `fretes`, `motoristaPoint`, `radiusKm`,
      `onRadiusChange`, `onFreteClick`, `geolocationStatus`,
      `onRequestLocation`.
    - Estado local: `const [expanded, setExpanded] = useState(false)`.
    - `default export function MapaFretes(props: MapaFretesProps)`.
    - _Refs: Requirements 1.5, 1.6, 1.7_

  - [x] 2.2 Helper `pinIcon(status)` com `L.divIcon` SVG inline
    - Retorna um `L.DivIcon` com SVG do pin colorido (`#16a34a`
      para `'ativo'`, `#9ca3af` para outros valores).
    - `iconSize: [22, 28]`, `iconAnchor: [11, 28]`,
      `popupAnchor: [0, -24]`, `className: 'mapafretes-pin'`.
    - _Refs: Requirements 5.3, 5.4_

  - [x] 2.3 Subcomponente `MapAutoCenter({ point, radiusKm })`
    - Usa `useMap()` do react-leaflet.
    - `useEffect` em `[point, radiusKm, map]`: se `point` truthy,
      criar `L.circle([point.latitude, point.longitude],
      { radius: radiusKm * 1000 })` e chamar
      `map.fitBounds(circle.getBounds(), { padding: [40, 40] })`.
    - Retorna `null`.
    - _Refs: Requirements 2.3, 3.6_

  - [x] 2.4 Bloco "Banner de permissão" (renderizado quando geo
        denied/error)
    - Container amarelo com texto `'Ative a localização para ver
      fretes próximos a você'`.
    - Botão "Ativar localização" → chama `props.onRequestLocation()`.
    - Quando `geolocationStatus === 'denied'`, exibir mensagem
      extra em segunda linha: `'Permissão bloqueada — habilite
      nas configurações do navegador.'`.
    - Classes: `flex flex-col sm:flex-row items-start sm:items-center
      gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md
      text-sm sm:text-xs`. Botão: `min-h-[44px] px-3 bg-yellow-600
      text-white rounded`.
    - _Refs: Requirements 2.4, 2.5, 2.6, 2.7, 7.2, 9.4, 9.6_

  - [x] 2.5 Bloco "Chips de raio" horizontal
    - `RADIUS_OPTIONS_KM.map((r) => <button ...>{r} km</button>)`.
    - Click chama `props.onRadiusChange(r)`.
    - Estilo selecionado: `bg-blue-600 text-white border-blue-600`.
    - Estilo não-selecionado: `bg-white text-gray-700
      border-gray-300 hover:bg-gray-50`.
    - Cada botão `min-h-[44px] px-3 rounded-full border text-base
      sm:text-sm`.
    - Container: `flex gap-2 overflow-x-auto`.
    - _Refs: Requirements 3.1, 3.7, 3.8, 9.3, 9.5, 9.6_

  - [x] 2.6 Bloco "Mapa Leaflet" com `MapContainer` + `TileLayer`
    - `MapContainer` com altura via classe Tailwind condicional:
      `expanded ? 'h-[60vh]' : 'h-[180px] md:h-[220px]'`.
    - Container externo: `relative w-full rounded-lg overflow-hidden
      border border-gray-200`.
    - Centro inicial: `motoristaPoint ?? { latitude: -14.235,
      longitude: -51.9253 }`. Zoom: 4 quando sem ponto, 8 quando
      com ponto (o `MapAutoCenter` recalcula via `fitBounds`).
    - `TileLayer` com URL OSM padrão e attribution já usado em
      `InteractiveMap.tsx`.
    - `<MapAutoCenter point={motoristaPoint} radiusKm={radiusKm} />`
      dentro do `MapContainer`.
    - _Refs: Requirements 1.3, 1.4, 7.3, 9.1, 9.2_

  - [x] 2.7 Bloco "Pins" com `<Marker>` por frete
    - Filtrar `fretes` localmente excluindo `originLocation`
      inválido (lat/lng zerados ou NaN). Idealmente isso já vem
      filtrado da HomePage via `filterFretesByRadius`, mas a
      defesa em profundidade evita pin solto em (0,0).
    - Para cada frete válido:
      `<Marker key={f.id} position={[f.originLocation.latitude,
      f.originLocation.longitude]} icon={pinIcon(f.status)}
      eventHandlers={{ click: () => props.onFreteClick(f) }}>`.
    - Dentro do `<Marker>`, `<Popup>` com 3 linhas:
      1. `{f.origin} → {f.destination}` (font-semibold).
      2. valor formatado em BRL via `Intl.NumberFormat('pt-BR',
         { style: 'currency', currency: 'BRL' })`.
      3. Quando `motoristaPoint` truthy, `'X,Y km de você'` com
         `haversineDistanceKm(motoristaPoint, f.originLocation)`
         formatado em `pt-BR` com 1 casa decimal.
    - _Refs: Requirements 5.1, 5.2, 5.5, 5.6, 5.7, 5.8, 12.4_

  - [x] 2.8 Botão "Expandir mapa" / "Recolher mapa"
    - Posicionado `absolute top-2 right-2` no container do mapa.
    - Texto alterna conforme `expanded`.
    - `onClick` faz `setExpanded(v => !v)`.
    - Classes: `min-h-[44px] px-3 bg-white border border-gray-300
      rounded-md text-sm hover:bg-gray-50 shadow-sm`.
    - _Refs: Requirements 1.5, 1.6, 1.7, 9.6_

  - [x] 2.9 Esqueleto/spinner enquanto geo está em loading/idle
    - Quando `geolocationStatus === 'loading'` ou `'idle'`,
      renderizar overlay simples (pode ser
      `<div className="absolute inset-0 bg-white/70 flex items-center
      justify-center text-gray-500 text-sm">Localizando...</div>`)
      sobre o mapa.
    - Não esconder o mapa — apenas overlay leve para sinalizar.
    - _Refs: Requirements 2.2, 2.8_

- [x] 3. Estender `src/pages/HomePage.tsx` com o ramo motorista
  - Imports: `lazy`, `Suspense` do `react`; `useGeolocation`;
    constantes e helpers de `../utils/geoDistance`.
  - _Refs: Requirements 1, 2, 3, 4, 7, 10, 11, 12; Design Section
    3 (Reqs 1, 2, 3, 4, 7, 10)_

  - [x] 3.1 Lazy import de `MapaFretes` e fallback `MapaSkeleton`
    - `const MapaFretes = lazy(() => import('../components/MapaFretes'))`.
    - Função interna `MapaSkeleton()` retornando
      `<div className="w-full h-[180px] md:h-[220px] rounded-lg
      bg-gray-100 animate-pulse mb-6" />`.
    - _Refs: Requirements 10.1, 10.2, 10.3_

  - [x] 3.2 Hook `useGeolocation` no ramo motorista
    - `const geo = useGeolocation()`.
    - `useEffect` que dispara `geo.requestLocation()` exatamente
      uma vez quando `isMotorista === true`. Usar comentário
      `// eslint-disable-next-line react-hooks/exhaustive-deps`
      e dependência `[isMotorista]`.
    - _Refs: Requirements 2.1_

  - [x] 3.3 Estado `radiusKm` com hidratação de localStorage
    - `const [radiusKm, setRadiusKm] = useState<RadiusOption>(() =>
      readStoredRadius(typeof window === 'undefined' ? null :
      window.localStorage.getItem(RADIUS_STORAGE_KEY)))`.
    - `const handleRadiusChange = useCallback((next: RadiusOption)
      => { setRadiusKm(next); writeStoredRadius(next); }, [])`.
    - _Refs: Requirements 3.2, 3.3, 3.4, 3.5_

  - [x] 3.4 `useMemo` calculando `visibleFretes`
    - `const motoristaPoint = geo.status === 'success' && geo.point
      ? geo.point : null`.
    - `const visibleFretes = useMemo(() =>
      filterFretesByRadius(fretes, motoristaPoint, radiusKm),
      [fretes, motoristaPoint, radiusKm])`.
    - Substituir TODOS os usos de `fretes` no render do ramo
      motorista (cards, tabela, paginação, contador) por
      `visibleFretes`. Para visitante/embarcador, continuar usando
      `fretes` como hoje.
    - _Refs: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 12.2,
      12.3_

  - [x] 3.5 Renderizar `<Suspense>` + `<MapaFretes>` no ramo
        motorista
    - Posicionar imediatamente abaixo de `<AppHeader />` (e do
      header com cálculo financeiro), antes do
      `FreteFiltersComponent`.
    - `{isMotorista && <Suspense fallback={<MapaSkeleton />}>
      <MapaFretes fretes={visibleFretes} motoristaPoint={motoristaPoint}
      radiusKm={radiusKm} onRadiusChange={handleRadiusChange}
      onFreteClick={handleFreteClick}
      geolocationStatus={geo.status}
      onRequestLocation={geo.requestLocation} /></Suspense>}`.
    - _Refs: Requirements 1.1, 1.2, 1.3, 1.4, 10.1, 10.2, 10.3,
      10.4_

  - [x] 3.6 Remover botão "Ver mapa" no ramo motorista
    - Envolver o `<button>Ver mapa</button>` (e o estado
      `showMap`) em `{!isMotorista && (...)}`.
    - O `<InteractiveMap>` (mostrado quando `showMap === true`)
      também fica condicionado a `{!isMotorista && showMap && (...)}`.
    - Para visitantes/embarcadores, o comportamento permanece
      bit a bit idêntico ao código atual.
    - _Refs: Requirements 1.8, 11.4, 11.5, 11.6_

  - [x] 3.7 Atualizar contador "X frete(s)" para refletir a lista
        filtrada
    - No header da página, trocar `{fretes.length}` por
      `{(isMotorista ? visibleFretes : fretes).length}`.
    - Aplicar a mesma troca em qualquer outro lugar que mostre
      contagem (ex.: `FreteFiltersComponent` recebe
      `totalResults`).
    - _Refs: Requirement 4.4_

- [x] 4. Atualizar `.kiro/PARA_DEPOIS.md`
  - _Refs: Requirement 8; Design Section 3 (Req 8), Design Decision 5_

  - [x] 4.1 Substituir a entrada antiga
        `## 2026-05-22 — API de pedágios`
    - Remover o bloco antigo (título + parágrafo de descrição).
    - Inserir, no mesmo local (topo do arquivo, acima das outras
      entradas), a nova entrada com data atual e título
      `## YYYY-MM-DD — API de pedágios — opções pesquisadas e
      estratégia curto prazo` (substituir `YYYY-MM-DD` pela data
      do dia da implementação).
    - _Refs: Requirements 8.1, 8.2, 8.3, 8.7_

  - [x] 4.2 Conteúdo da nova entrada
    - Parágrafo introdutório igual ao do design.
    - Subseção `### Opções pesquisadas` com bullets para
      `TollGuru`, `QualP`, `AWS Location Service CalculateRoute`
      e `Tabela estática de pedágios`.
    - Subseção `### Estratégia curto prazo (mitigação)` com a
      descrição da tabela estática das BRs (GO/SP/MG/MT/MS) por
      número de eixos.
    - _Refs: Requirements 8.4, 8.5_

  - [x] 4.3 Preservar as outras 3 entradas existentes
    - `Forma de pagamento integrada`, `Dashboard administrativo do
      dono`, `Sistema de aprovação de documentos` permanecem na
      mesma ordem após a nova entrada.
    - Conferir que nada além da entrada de pedágio foi alterado.
    - _Refs: Requirement 8.7_

- [ ]* 5. Testes de propriedade (opcionais, mas recomendados)
  - _Refs: Design Section 8 (PBT)_

  - [x]* 5.1 `src/__tests__/geoDistance.property.test.ts`
    - Importar `filterFretesByRadius`, `haversineDistanceKm`,
      `RADIUS_OPTIONS_KM` de `../utils/geoDistance`.
    - Geradores `fc`:
      - `pointArb` com lat em `[-90, 90]` e lng em `[-180, 180]`.
      - `freteArb` com `id` arbitrário, `originLocation` via
        `pointArb`, `status` `'ativo'|'encerrado'|'cancelado'`.
      - `radiusArb` em `[1, 1000]`.
    - **Property 1 (invariante e fallback nulo):**
      - Para `motoristaPoint === null`,
        `filterFretesByRadius(F, null, R) === F` (referência ou
        deep equal).
      - Para `motoristaPoint` válido, todos os elementos do
        retorno satisfazem
        `haversineDistanceKm(motoristaPoint, f.originLocation) <= R`
        E têm `originLocation` válido.
    - **Property 2 (monotonicidade em R):**
      - Para `R1 <= R2`,
        `filterFretesByRadius(F, M, R1)` é subconjunto preservando
        ordem de `filterFretesByRadius(F, M, R2)`.
    - **Property 3 (Haversine puro):**
      - Simetria com tolerância `< 0.001`.
      - `haversineDistanceKm(p, p) < 0.001`.
      - `haversineDistanceKm(p1, p2) >= 0` e finito.
    - Mínimo 100 iterações por property.
    - **Validates: Requirements 4.1, 4.2, 4.6, 4.7, 6.3, 6.4, 6.5,
      6.6, 7.1, 3.6**

  - [x]* 5.2 `src/__tests__/radiusStorage.property.test.ts`
    - Importar `readStoredRadius`, `RADIUS_OPTIONS_KM`,
      `RADIUS_DEFAULT_KM` de `../utils/geoDistance`.
    - **Property 4a (raio sempre válido):**
      - Para qualquer `fc.string()` ou `null`,
        `RADIUS_OPTIONS_KM.includes(readStoredRadius(raw))` é
        `true`.
    - **Property 4b (round-trip):**
      - Para `fc.constantFrom(...RADIUS_OPTIONS_KM)`,
        `readStoredRadius(String(R)) === R`.
    - Mínimo 100 iterações por property.
    - **Validates: Requirements 3.3, 3.4, 3.5**

- [ ] 6. Smoke tests manuais (caminho-feliz)
  - _Refs: Design Section 8_

  - [ ] 6.1 Visitante deslogado em `/`
    - Home igual a hoje (filtros, cards/tabela, botão "Ver mapa"
      funcional, sem mapa fixo, sem chips de raio, sem banner
      amarelo de localização).
    - _Refs: Requirements 1.2, 11.5_

  - [ ] 6.2 Embarcador logado em `/`
    - Mesmo conteúdo de hoje (sem mapa fixo, sem chips de raio,
      sem `DieselDashboardInput`, sem banner amarelo de
      localização).
    - _Refs: Requirements 1.2, 11.6_

  - [ ] 6.3 Motorista logado em `/` (desktop, browser permite
        localização)
    - Mapa fixo aparece no topo, abaixo do header.
    - Browser pede permissão; aceitar.
    - Mapa centraliza no motorista, chips de raio aparecem com
      `100` selecionado.
    - Pins aparecem para fretes ativos dentro do raio.
    - Lista (cards/tabela) reflete apenas fretes dentro do raio.
    - _Refs: Requirements 1.1, 1.3, 2.1, 2.3, 3.1, 3.2, 4.1, 5.1,
      5.3_

  - [ ] 6.4 Trocar raio: 50 → 100 → 200 → 500
    - Cada clique atualiza pins e lista. `localStorage` reflete o
      último valor.
    - Recarregar página → último raio escolhido persiste.
    - _Refs: Requirements 3.3, 3.4, 3.6, 4.1_

  - [ ] 6.5 Motorista nega permissão
    - Mapa centraliza no Brasil, sem pins.
    - Banner amarelo aparece com botão "Ativar localização" e
      mensagem extra "Permissão bloqueada — habilite nas
      configurações do navegador.".
    - Lista mostra todos os fretes ativos (sem filtro de raio).
    - _Refs: Requirements 2.4, 2.6, 7.1, 7.2, 7.3_

  - [ ] 6.6 Motorista clica em "Ativar localização" depois de
        negar
    - Re-prompt é tentado; se browser bloqueou, banner permanece.
    - _Refs: Requirements 2.5_

  - [ ] 6.7 Click em pin abre `FreteModal`
    - `viewsCount` incrementa (mesmo `handleFreteClick` do
      `FreteCard`).
    - Modal exibe os mesmos detalhes que abrindo via card.
    - _Refs: Requirements 5.5_

  - [ ] 6.8 Popup do pin
    - Hover ou clique antes de fechar exibe rota, valor em BRL e
      distância em km com 1 casa decimal e separador `pt-BR`.
    - Quando geo inativa, a linha de distância não aparece.
    - _Refs: Requirements 5.6, 5.7_

  - [ ] 6.9 Expandir/recolher mapa
    - Botão alterna altura compacta ↔ 60vh.
    - Rótulo do botão alterna "Expandir mapa" ↔ "Recolher mapa".
    - _Refs: Requirements 1.5, 1.6, 1.7_

  - [ ] 6.10 Mobile (DevTools 375 px) logado como motorista
    - Mapa em 180 px de altura compacta.
    - Chips de raio horizontais sem overflow, com altura ≥ 44 px.
    - Banner em coluna; sem cortes em "Ativar localização".
    - Pinch-zoom do mapa funciona.
    - _Refs: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ] 6.11 Verificação dos chunks após `npm run build`
    - Existe um chunk `MapaFretes-*.js` separado em
      `dist/assets/`.
    - `grep -l "leaflet" dist/assets/index-*.js` retorna vazio
      (entry sem leaflet).
    - Network tab confirma que o chunk de mapa só é baixado
      quando o motorista acessa `/`.
    - _Refs: Requirements 10.1, 10.2, 10.3, 10.4_

  - [ ] 6.12 Conferência de `.kiro/PARA_DEPOIS.md`
    - Entrada antiga "API de pedágios" foi substituída pela
      versão expandida com 4 opções + estratégia.
    - As outras 3 entradas existentes seguem inalteradas.
    - _Refs: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [ ] 7. Smoke não-regressão
  - _Refs: Requirement 11_

  - [ ] 7.1 Login como embarcador → home renderiza tabela/cards
        normalmente
    - Sem mapa fixo, sem chips, sem banner.

  - [ ] 7.2 Cadastrar novo frete via `FreteForm` (não tocado)

  - [ ] 7.3 Editar perfil em `EmbarcadorPerfilPage` (não tocado)

  - [ ] 7.4 Upload de logo via `LogoUploadField` (não tocado)

  - [ ] 7.5 Verificação de e-mail do embarcador (modal não tocado)

  - [ ] 7.6 Login como motorista — fluxos das specs anteriores
        intactos
    - Cálculo financeiro do diesel, capitalização de nome, OTP de
      e-mail, placa Mercosul, modelo "Outro", ano fab/modelo,
      upload de câmera, PIS amarelo/vermelho, contador de docs,
      `DieselDashboardInput` debounced, `showCalcBanner` quando
      km/l ou diesel faltam, CEP/CNPJ/referências da spec
      `motorista-perfil-extras` — TODOS continuam funcionando.

  - [ ] 7.7 Visitante deslogado clica em "Ver mapa"
    - O `InteractiveMap` original abre normalmente.

  - [ ] 7.8 `npm test` passa sem novos failing
    - Suite completa (`auth`, `inputValidator`, `passwordHash`,
      `passwordValidation`, `pisValidation`, `plateValidation`,
      `tripSuggestion`, `yearValidation`, `sectionCounter`,
      `calculoFrete`, `freteFilters`, `geolocation`,
      `fileValidation`, `textCase`, `phoneFormat`, `cep`,
      `security/*`) verde, mais os 2 novos PBTs criados em
      tarefa 5 (se executados).

---

## Notas

- Tarefas marcadas com `*` são opcionais (testes de propriedade);
  podem ser puladas em uma execução de MVP, mas idealmente devem
  ser implementadas para garantir as 4 propriedades formais do
  design.
- Cada tarefa referencia explicitamente os requirements (granular)
  ou seções do design para rastreabilidade.
- A ordem de execução (1 → 7) é incremental: utils puros →
  componente lazy → wiring na HomePage → backlog → testes →
  validação manual.
- Testes de propriedade ficam **próximos** das implementações que
  validam (utilitário puro `geoDistance`).
- A implementação efetiva é executada abrindo este `tasks.md` e
  clicando em "Start task" ao lado de cada item.
