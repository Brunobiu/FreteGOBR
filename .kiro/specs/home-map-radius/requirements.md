# Requirements Document — Home Map Radius

## Introdução

Esta feature transforma a `HomePage` do FreteGO em um painel
operacional com mapa fixo para o motorista. Hoje o mapa é
opcional (botão "Ver mapa" alterna entre lista e mapa). A entrega
substitui esse botão, no ramo motorista, por um banner de mapa
permanente acima do grid de fretes, integra a geolocalização do
dispositivo, adiciona um filtro de raio (50/100/200/500 km),
plota pins clicáveis para a origem dos fretes, calcula a distância
motorista→origem do frete via Haversine no cliente e exibe um
banner orientativo quando a permissão de localização está negada.

A feature **só é visível** para usuários autenticados como
motorista (`user.userType === 'motorista'`). Visitantes (deslogados)
e embarcadores continuam vendo a `HomePage` exatamente como hoje:
mesmo header, mesmos filtros, mesma grid/tabela, sem mapa fixo.

A entrega cobre nove frentes:

1. **Mapa fixo no topo** da `HomePage` apenas para motoristas, com
   botão expandir/recolher (220 px desktop / 180 px mobile, ou 60vh
   quando expandido).
2. **Geolocalização do dispositivo** via `navigator.geolocation`,
   reusando o hook `useGeolocation` existente, com banner de
   re-prompt em caso de permissão negada.
3. **Filtro por raio** (50, 100, 200, 500 km) com persistência em
   `localStorage` e default de 100 km.
4. **Pins de fretes** plotados na origem, clicáveis (abrem o
   `FreteModal` existente), com popup mostrando rota, valor
   formatado e distância motorista→origem.
5. **Distância calculada no cliente** via Haversine puro em
   `src/utils/geoDistance.ts` (sem nova chamada ao backend).
6. **Fallback sem localização** — sem geolocalização ativa, a home
   continua mostrando todos os fretes (sem filtro de raio) e exibe
   banner orientativo.
7. **Pedágio** — apenas atualização de `.kiro/PARA_DEPOIS.md` com as
   opções pesquisadas (TollGuru, QualP, AWS Location Service) e
   estratégia de mitigação curto prazo. Sem implementação de API
   nesta spec.
8. **Responsividade mobile** — mapa em 180 px, chips de raio
   horizontais, banner de permissão legível em ≤375 px.
9. **Carregamento dinâmico** — `MapaFretes` carregado via
   `React.lazy` + `Suspense` para não inflar o bundle de
   visitantes/embarcadores.

Tudo deve preservar 100% dos fluxos do embarcador e do visitante,
sem alterar `EmbarcadorPerfilPage.tsx`, `EmbarcadorPage.tsx`,
`embarcador.ts`, `FreteForm.tsx`, `LogoUploadField.tsx` nem
`verification.ts`. Modificações em `src/services/fretes.ts` são
permitidas **apenas se puramente aditivas** (nova função, sem
alterar assinaturas existentes); nenhuma alteração em assinaturas
de funções já consumidas.

## Glossário

### Sistemas, componentes e arquivos

- **HomePage**: página `src/pages/HomePage.tsx`. Hoje renderiza
  para todos os usuários (visitante, motorista, embarcador) o mesmo
  layout. Esta feature divide o render em dois ramos baseados em
  `user?.userType === 'motorista'`.
- **MapaFretes**: NOVO componente `src/components/MapaFretes.tsx`
  que encapsula mapa Leaflet, pins, controle de raio,
  expandir/recolher e banner de permissão. Consumido apenas pelo
  ramo motorista da `HomePage`.
- **MapaFretesLazy**: import dinâmico de `MapaFretes` via
  `React.lazy(() => import('./MapaFretes'))` na `HomePage`,
  envolvido em `<Suspense fallback={...}>`.
- **InteractiveMap**: componente existente
  `src/components/InteractiveMap.tsx`. NÃO modificado por esta
  feature. Continua sendo usado pelo modo "Ver mapa" original
  apenas no ramo não-motorista (se mantido) ou descontinuado
  do ramo motorista (substituído pelo `MapaFretes`).
- **AppHeader**: componente existente `src/components/AppHeader.tsx`.
  NÃO modificado. O `MapaFretes` é renderizado abaixo dele.
- **FreteModal**: componente existente
  `src/components/FreteModal.tsx`. NÃO modificado. Reusado pelo
  `MapaFretes` ao clicar em um pin (mesma função
  `handleFreteClick` já existente na `HomePage`).
- **FreteCard / FreteTable**: componentes existentes. NÃO
  modificados. Continuam renderizando a lista filtrada por raio
  (quando localização ativa) ou a lista completa (fallback).
- **FreteFiltersComponent**: componente existente
  `src/components/FreteFilters.tsx`. NÃO modificado. Continua
  funcionando em conjunto com o filtro de raio (composição
  client-side).
- **GeolocationService**: serviço existente
  `src/services/geolocation.ts`. REUSADO sem alteração de
  assinaturas. Já expõe `calculateDistance` (Haversine) que pode
  ser reaproveitado, ou um novo módulo `geoDistance.ts` é criado
  conforme decisão de design.
- **useGeolocationHook**: hook existente `src/hooks/useGeolocation.ts`.
  REUSADO sem alteração de API pública. Já expõe `point`, `status`
  (`'idle' | 'loading' | 'success' | 'denied' | 'error'`),
  `requestLocation()` e `error`.
- **GeoDistanceUtil**: NOVO módulo `src/utils/geoDistance.ts` com
  função pura `haversineDistanceKm(p1, p2)`. Criado se não existir
  utilitário público equivalente em `src/utils/`. Hoje existe
  `calculateDistance` em `src/services/geolocation.ts`; o design
  decidirá entre extrair para `utils/` ou reusar a função do
  service.
- **FretesService**: módulo `src/services/fretes.ts`. Mudanças
  apenas aditivas (se necessárias). Nenhuma assinatura existente
  alterada.
- **LeafletLib**: dependência `leaflet@1.9.4` + `react-leaflet@5.0.0`
  já instaladas em `package.json`. Não há novas dependências.
- **OpenStreetMapTiles**: tile server público
  `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`. Sem chave,
  sem cobrança.
- **ParaDepoisDoc**: arquivo `.kiro/PARA_DEPOIS.md`. Recebe nova
  entrada no topo (acima das existentes) sobre API de pedágio.

### Constantes e formatos

- **MapHeight_Compacto_Desktop**: 220 px.
- **MapHeight_Compacto_Mobile**: 180 px.
- **MapHeight_Expandido**: `60vh` (60% da altura do viewport).
- **MapZoom_Padrao**: zoom inicial calculado para enquadrar um raio
  de 100 km com folga; em prática, nível de zoom Leaflet 8 (a
  exatidão exata é derivada via `fitBounds` em torno do círculo
  de raio).
- **MobileBreakpoint**: 768 px (`md` do Tailwind). Igual ao
  `useIsMobile` já em uso.
- **TouchMinTarget**: 44 px (`min-h-[44px]`) para botões em mobile.
- **RadiusOptions_km**: lista fixa `[50, 100, 200, 500]`.
- **RadiusDefault_km**: 100.
- **LocalStorageRadiusKey**: `'fretego-motorista-radius'`. O valor
  armazenado é uma string contendo o número (ex.: `"100"`).
- **EarthRadius_km**: 6371 (constante usada na fórmula de
  Haversine).
- **PinColor_Ativo**: paleta verde da plataforma (Tailwind
  `green-500`/`green-600`); o ícone do Leaflet usa imagem PNG ou
  `divIcon` HTML — decisão de implementação no design.
- **PinColor_Encerrado**: paleta cinza da plataforma (`gray-400`).
- **GeolocationTimeout_ms**: 10000 (já configurado no hook
  existente).
- **GeolocationMaxAge_ms**: 60000 (já configurado no hook
  existente).
- **PermissionDeniedExtraMessage**: "Permissão bloqueada — habilite
  nas configurações do navegador.".
- **PermissionPromptMessage**: "Ative a localização para ver fretes
  próximos a você".
- **PermissionPromptButtonLabel**: "Ativar localização".

### Tipos e listas pré-definidas

- **MotoristaUserCheck**: predicado
  `user?.userType === 'motorista'`. Verdadeiro apenas quando o
  usuário autenticado tem tipo motorista. Falso para visitante
  (deslogado), embarcador e admin.
- **GeolocationStatus**: estados retornados por `useGeolocation`:
  `'idle' | 'loading' | 'success' | 'denied' | 'error'`.
- **MapState_Compacto**: estado padrão do mapa (220/180 px).
- **MapState_Expandido**: estado após clique em "Expandir mapa"
  (60vh).
- **PedagioParaDepoisOptions**:
  - **TollGuru** — API US$260/mês para 20k chamadas; cobertura BR.
  - **QualP** — líder do mercado BR; sem self-service; contato
    comercial direto.
  - **AWS Location Service `CalculateRoute`** — pay-per-use
    (~US$0.50/1000 requests) com opção de incluir pedágios.
  - **Estratégia curto prazo (mitigação)** — tabela estática de
    pedágios das principais BRs (GO/SP/MG/MT/MS) por número de
    eixos como aproximação inicial, sem API.

## Requirements

### Requirement 1 — Mapa fixo apenas no ramo motorista

**User Story:** Como motorista logado, quero ver um mapa fixo no
topo da home com os fretes plotados, para visualizar a
distribuição geográfica das ofertas sem precisar clicar em "Ver
mapa".

#### Acceptance Criteria

1. WHERE `MotoristaUserCheck === true`,
   THE HomePage SHALL renderizar o componente `MapaFretes`
   imediatamente abaixo do `AppHeader` e acima do bloco de
   filtros/grid de fretes.
2. WHERE `MotoristaUserCheck === false` (visitante ou embarcador),
   THE HomePage SHALL NÃO renderizar o componente `MapaFretes`,
   preservando o layout e os comportamentos atuais (botão "Ver
   mapa" original ou ausência dele).
3. WHEN o estado do mapa é `MapState_Compacto` em viewport
   ≥ `MobileBreakpoint`,
   THE MapaFretes SHALL renderizar com altura
   `MapHeight_Compacto_Desktop`.
4. WHEN o estado do mapa é `MapState_Compacto` em viewport
   < `MobileBreakpoint`,
   THE MapaFretes SHALL renderizar com altura
   `MapHeight_Compacto_Mobile`.
5. THE MapaFretes SHALL renderizar um botão "Expandir mapa" no canto
   superior direito do mapa quando o estado é `MapState_Compacto`.
6. WHEN o motorista clica em "Expandir mapa",
   THE MapaFretes SHALL alterar o estado para `MapState_Expandido` e
   redimensionar para `MapHeight_Expandido`, e o rótulo do botão
   SHALL mudar para "Recolher mapa".
7. WHEN o motorista clica em "Recolher mapa",
   THE MapaFretes SHALL voltar ao estado `MapState_Compacto` com a
   altura correspondente ao viewport (Req 1.3 ou 1.4) e o rótulo do
   botão SHALL voltar para "Expandir mapa".
8. THE HomePage SHALL NÃO renderizar mais o botão "Ver mapa" no
   ramo motorista (substituído pelo mapa fixo); para visitante e
   embarcador o botão permanece como hoje.

### Requirement 2 — Solicitação automática de geolocalização

**User Story:** Como motorista, quero que o app solicite minha
localização ao abrir a home, para o mapa centralizar em mim e
mostrar fretes próximos.

#### Acceptance Criteria

1. WHEN a `HomePage` é montada com `MotoristaUserCheck === true`,
   THE HomePage SHALL chamar `requestLocation()` do
   `useGeolocationHook` exatamente uma vez por montagem.
2. WHILE `useGeolocationHook.status === 'loading'`,
   THE MapaFretes SHALL exibir um indicador de carregamento
   (spinner ou skeleton) no lugar do mapa.
3. WHEN `useGeolocationHook.status === 'success'`,
   THE MapaFretes SHALL centralizar o mapa nas coordenadas
   `useGeolocationHook.point` e ajustar o zoom para enquadrar um
   raio de `RadiusDefault_km` (ou o raio atualmente selecionado, se
   diferente) com folga.
4. IF `useGeolocationHook.status === 'denied'`,
   THEN THE MapaFretes SHALL exibir um banner amarelo dentro
   (ou imediatamente abaixo) do mapa contendo o texto
   `PermissionPromptMessage` e um botão rotulado
   `PermissionPromptButtonLabel`.
5. IF o motorista clica em `PermissionPromptButtonLabel`,
   THEN THE MapaFretes SHALL chamar novamente
   `useGeolocationHook.requestLocation()` para tentar re-prompt.
6. IF a permissão foi negada anteriormente E o navegador retorna
   imediatamente `PERMISSION_DENIED` no novo `getCurrentPosition`
   (sem prompt nativo),
   THEN THE MapaFretes SHALL exibir, abaixo do banner amarelo, a
   mensagem extra `PermissionDeniedExtraMessage`.
7. IF `useGeolocationHook.status === 'error'` (timeout, indisponível
   ou outro erro não-permission),
   THEN THE MapaFretes SHALL exibir o mesmo banner amarelo do
   `denied` (Req 2.4) com o mesmo botão
   `PermissionPromptButtonLabel`, sem a mensagem extra
   `PermissionDeniedExtraMessage`.
8. WHILE `useGeolocationHook.status === 'idle'` por mais de 200 ms,
   THE MapaFretes SHALL exibir o indicador de carregamento (Req
   2.2) ou o banner de permissão (Req 2.4) — a escolha entre os
   dois é determinada pelo design e deve ser consistente; nunca
   exibir mapa vazio sem nenhum estado.

### Requirement 3 — Filtro por raio com persistência em localStorage

**User Story:** Como motorista, quero escolher entre 50/100/200/500
km como raio de busca, para focar nos fretes mais próximos a mim, e
quero que minha escolha seja lembrada entre sessões.

#### Acceptance Criteria

1. THE MapaFretes SHALL renderizar um controle de raio com
   exatamente as opções definidas em `RadiusOptions_km` (50, 100,
   200, 500), nessa ordem.
2. WHEN o motorista abre a `HomePage` pela primeira vez (sem valor
   em `LocalStorageRadiusKey`),
   THE MapaFretes SHALL inicializar o raio selecionado em
   `RadiusDefault_km` (100 km).
3. WHEN o motorista seleciona uma opção do controle de raio,
   THE MapaFretes SHALL atualizar o raio selecionado e gravar o
   valor numérico (em km) em `localStorage[LocalStorageRadiusKey]`
   imediatamente, antes de re-renderizar o mapa e a lista.
4. WHEN a `HomePage` é montada e existe valor válido em
   `localStorage[LocalStorageRadiusKey]`,
   THE MapaFretes SHALL hidratar o raio selecionado a partir desse
   valor, desde que pertença a `RadiusOptions_km`.
5. IF `localStorage[LocalStorageRadiusKey]` contém valor não numérico,
   valor numérico fora de `RadiusOptions_km`, ou o `localStorage`
   está indisponível,
   THEN THE MapaFretes SHALL ignorar o valor armazenado e usar
   `RadiusDefault_km`.
6. WHEN o raio selecionado muda,
   THE MapaFretes SHALL atualizar o ajuste de zoom para enquadrar o
   novo raio (centro = posição do motorista) com folga, sem perder
   a posição central.
7. THE MapaFretes SHALL renderizar o controle de raio em viewport
   ≥ `MobileBreakpoint` como botões/pílulas horizontais ou um
   `<select>` (decisão de design); em viewport < `MobileBreakpoint`
   SHALL renderizar como chips horizontais clicáveis com labels
   "50", "100", "200", "500" (sufixo "km" pode ser implícito no
   rótulo do controle).
8. THE MapaFretes SHALL exibir visualmente qual opção do raio está
   atualmente selecionada com contraste suficiente (cor de fundo
   diferente, ou borda destacada, ou checkmark — decisão de
   design).

### Requirement 4 — Filtro client-side da lista de fretes por raio

**User Story:** Como motorista, quero que a lista (cards e tabela)
mostre apenas fretes cuja origem está dentro do raio escolhido,
para não perder tempo com ofertas longe demais.

#### Acceptance Criteria

1. WHEN `useGeolocationHook.status === 'success'` E o raio
   selecionado é `R` km,
   THE HomePage SHALL filtrar a lista de fretes renderizada
   (cards + tabela) mantendo apenas os fretes cujo
   `haversineDistanceKm(motoristaPoint, frete.originLocation) <= R`.
2. WHEN `useGeolocationHook.status !== 'success'` (idle, loading,
   denied ou error),
   THE HomePage SHALL renderizar a lista completa de fretes ativos
   (sem aplicar filtro de raio), preservando o comportamento
   atual.
3. THE HomePage SHALL aplicar o filtro de raio APÓS os filtros do
   `FreteFiltersComponent` (origem, destino, tipo de carga,
   veículo, etc.); a ordem dos filtros é: filtros do
   `FreteFiltersComponent` → filtro de raio → render.
4. WHEN o filtro de raio remove fretes da lista,
   THE HomePage SHALL atualizar o contador "X frete(s)" para
   refletir a contagem após o filtro de raio.
5. THE HomePage SHALL memoizar a lista filtrada por raio com
   `useMemo`, recomputando-a apenas quando mudar
   `motoristaPoint`, o raio selecionado ou a lista de fretes
   carregada do servidor.
6. IF um frete possui `originLocation.latitude === 0` E
   `originLocation.longitude === 0`, OU `NaN` em qualquer um dos
   dois,
   THEN THE HomePage SHALL excluir o frete do filtro por raio
   (tratar como sem coordenadas válidas) — quando o filtro de raio
   está ativo, esses fretes NÃO aparecem na lista.
7. WHEN `useGeolocationHook.status !== 'success'`,
   THE HomePage SHALL incluir os fretes com coordenadas inválidas
   na lista (mesmo comportamento atual).

### Requirement 5 — Pins de fretes plotados na origem

**User Story:** Como motorista, quero ver pins no mapa para cada
frete dentro do raio, com cores diferenciando ativos e encerrados,
e quero clicar em um pin para abrir o modal de detalhes.

#### Acceptance Criteria

1. THE MapaFretes SHALL plotar um pin (`Marker`) para cada frete da
   lista filtrada por raio (Req 4.1) que possua coordenadas válidas
   em `frete.originLocation` (`latitude` e `longitude` numéricos,
   diferentes de zero, não-NaN).
2. THE MapaFretes SHALL posicionar cada pin nas coordenadas
   `[frete.originLocation.latitude, frete.originLocation.longitude]`.
3. THE MapaFretes SHALL renderizar pins com cor `PinColor_Ativo`
   para fretes com `status === 'ativo'`.
4. THE MapaFretes SHALL renderizar pins com cor `PinColor_Encerrado`
   para fretes com `status === 'encerrado'`.
5. WHEN o motorista clica em um pin,
   THE MapaFretes SHALL invocar a callback recebida via prop
   (`onFreteClick(frete)`) que, no consumidor `HomePage`, dispara
   o mesmo `handleFreteClick` já usado pelo `FreteCard`,
   incrementando `viewsCount` e abrindo o `FreteModal`.
6. THE MapaFretes SHALL exibir, ao passar o mouse sobre o pin (ou
   ao clicar uma vez antes do redirecionamento ao modal — decisão
   de design), um popup/tooltip contendo:
   - Linha 1: rota formatada como `{frete.origin} → {frete.destination}`.
   - Linha 2: valor formatado em BRL (mesma formatação usada pelo
     `FreteCard`: `Intl.NumberFormat('pt-BR', { style: 'currency',
     currency: 'BRL' })`).
   - Linha 3: distância motorista→origem do frete em km, com 1 casa
     decimal e separador `pt-BR` (ex.: "12,4 km de você").
7. WHERE `useGeolocationHook.status !== 'success'`,
   THE MapaFretes SHALL omitir a linha 3 (distância) do popup, pois
   não há posição do motorista para calcular distância.
8. THE MapaFretes SHALL atualizar o conjunto de pins
   reativamente quando a lista filtrada por raio muda (raio
   alterado, novos fretes via realtime, motorista
   movimentou-se).

### Requirement 6 — Distância calculada via Haversine no cliente

**User Story:** Como time, quero que a distância motorista→origem
do frete seja calculada no front-end sem chamadas extras ao
backend, para manter performance e custo zero.

#### Acceptance Criteria

1. WHERE não existe utilitário público
   `haversineDistanceKm(p1, p2)` em `src/utils/geoDistance.ts`,
   THE Feature SHALL criar `src/utils/geoDistance.ts` exportando a
   função pura `haversineDistanceKm(p1: GeographicPoint, p2:
   GeographicPoint): number`.
2. THE GeoDistanceUtil SHALL retornar a distância em quilômetros,
   usando a fórmula de Haversine com `EarthRadius_km = 6371`.
3. THE GeoDistanceUtil SHALL ser puro (sem efeitos colaterais, sem
   IO, sem dependências de DOM/React/Supabase) e dar o mesmo
   resultado para os mesmos inputs (idempotente em chamadas
   sucessivas).
4. THE GeoDistanceUtil SHALL ser simétrico:
   `haversineDistanceKm(a, b) === haversineDistanceKm(b, a)` para
   qualquer par `a`, `b` de `GeographicPoint` válido (a igualdade
   é validada com tolerância numérica para evitar discrepâncias de
   ponto flutuante).
5. THE GeoDistanceUtil SHALL retornar `0` quando `a.latitude ===
   b.latitude` E `a.longitude === b.longitude`.
6. THE GeoDistanceUtil SHALL retornar um número finito não-negativo
   para qualquer par de inputs com latitudes em [-90, 90] e
   longitudes em [-180, 180].
7. THE Feature SHALL utilizar `haversineDistanceKm` no filtro de
   raio (Req 4.1) e no popup de pin (Req 5.6), sem realizar
   nenhuma chamada de rede para cálculo de distância.
8. WHERE já existe a função `calculateDistance` em
   `src/services/geolocation.ts` com a mesma fórmula,
   THE Feature SHALL reusar essa função (re-exportando ou
   importando) em vez de duplicar a lógica; a decisão entre criar
   `utils/geoDistance.ts` ou reusar `services/geolocation.ts` é do
   design, contanto que apenas uma implementação exista no projeto
   após a entrega.

### Requirement 7 — Fallback sem localização ativa

**User Story:** Como motorista que negou a permissão de localização,
quero continuar vendo todos os fretes ativos, sem ser bloqueado, mas
com orientação clara de como ativar a localização.

#### Acceptance Criteria

1. WHEN `useGeolocationHook.status === 'denied'` OU `'error'` OU
   `'idle'` após o request inicial,
   THE HomePage SHALL renderizar a lista completa de fretes ativos
   (sem filtro de raio aplicado), preservando o comportamento da
   versão sem mapa.
2. WHEN `useGeolocationHook.status === 'denied'` OU `'error'`,
   THE MapaFretes SHALL exibir o banner amarelo descrito em Req 2.4
   dentro ou imediatamente abaixo da área do mapa.
3. WHEN `useGeolocationHook.status === 'denied'` OU `'error'`,
   THE MapaFretes SHALL exibir o mapa centralizado em uma posição
   neutra (Brasil central, lat ≈ -14.235, lng ≈ -51.9253) com zoom
   amplo, sem pins de fretes.
4. THE HomePage SHALL NÃO bloquear o uso da feature para o
   motorista sem geolocalização: cards, tabela, paginação,
   `FreteModal`, filtros do `FreteFiltersComponent` e cálculo
   financeiro do diesel continuam funcionando exatamente como hoje.

### Requirement 8 — Atualização de PARA_DEPOIS.md com pesquisa de pedágio

**User Story:** Como time, quero registrar formalmente as opções de
API de pedágio pesquisadas e a estratégia de mitigação, para que
uma futura entrega já tenha o contexto pronto.

#### Acceptance Criteria

1. THE Feature SHALL adicionar uma nova entrada em
   `.kiro/PARA_DEPOIS.md` posicionada **acima** das entradas
   existentes (entradas mais recentes ficam no topo, conforme
   convenção do arquivo).
2. THE NewParaDepoisEntry SHALL seguir o formato
   `## YYYY-MM-DD — <título curto>` usado pelas entradas
   existentes.
3. THE NewParaDepoisEntry SHALL referenciar como título a
   substituição do placeholder atual de pedágio por integração com
   uma API real (ex.: "API de pedágios — opções pesquisadas").
4. THE NewParaDepoisEntry SHALL listar as quatro opções definidas
   em `PedagioParaDepoisOptions` com nome, modelo de cobrança e
   observação curta de cobertura/maturidade.
5. THE NewParaDepoisEntry SHALL incluir uma subseção
   "Estratégia curto prazo (mitigação)" descrevendo a tabela
   estática de pedágios das principais BRs (GO/SP/MG/MT/MS) por
   número de eixos como aproximação inicial sem API.
6. THE Feature SHALL NÃO implementar nenhuma chamada a TollGuru,
   QualP, AWS Location Service, nem nenhum outro provider de
   pedágio nesta spec.
7. THE Feature SHALL preservar todas as entradas atuais de
   `PARA_DEPOIS.md` (incluindo a entrada existente "API de
   pedágios" da `2026-05-22`); a nova entrada complementa,
   substituindo (sobrescrevendo) a entrada antiga apenas se o
   design decidir consolidá-las — caso contrário coexistem.

### Requirement 9 — Responsividade mobile (≤ 768 px)

**User Story:** Como motorista usando o app no celular, quero o
mapa funcionar bem em telas pequenas, com pinch-zoom natural,
chips de raio horizontais e banners legíveis.

#### Acceptance Criteria

1. WHEN renderizada em viewport < `MobileBreakpoint`,
   THE MapaFretes SHALL ocupar a largura total disponível com
   altura `MapHeight_Compacto_Mobile` no estado compacto e
   `MapHeight_Expandido` no estado expandido.
2. THE MapaFretes SHALL preservar o pinch-zoom nativo do Leaflet em
   touch devices, sem desabilitar `dragging`, `touchZoom` nem
   `doubleClickZoom`.
3. WHEN renderizada em viewport < `MobileBreakpoint`,
   THE MapaFretes SHALL renderizar o controle de raio como chips
   horizontais clicáveis (`50` | `100` | `200` | `500`), em uma
   única linha, com `min-h-[44px]` (≥ `TouchMinTarget`) por chip.
4. WHEN renderizada em viewport ≤ 375 px,
   THE MapaFretes SHALL exibir o banner de permissão em uma única
   linha de texto OU em duas linhas com quebra natural, sem
   overflow horizontal e sem cortar palavras-chave (
   `PermissionPromptMessage`, `PermissionPromptButtonLabel`).
5. THE MapaFretes SHALL aplicar `text-base sm:text-sm` (16 px no
   mobile, 14 px no desktop) em chips de raio e textos do banner,
   garantindo ausência de zoom acidental no foco do iOS.
6. THE MapaFretes SHALL aplicar `min-h-[44px]` (≥ `TouchMinTarget`)
   em todos os botões introduzidos por esta feature em viewport
   < `MobileBreakpoint`: chips de raio, "Ativar localização",
   "Expandir mapa" / "Recolher mapa".
7. THE MapaFretes SHALL evitar overflow horizontal em viewports
   ≤ 375 px (todos os elementos devem caber dentro da largura
   visível).

### Requirement 10 — Carregamento dinâmico do mapa (lazy)

**User Story:** Como time, quero que o mapa carregue só quando for
realmente usado, para não inflar o bundle inicial dos
visitantes/embarcadores que não veem o mapa.

#### Acceptance Criteria

1. THE HomePage SHALL importar `MapaFretes` via
   `React.lazy(() => import('./MapaFretes'))` em vez de import
   estático.
2. THE HomePage SHALL envolver a renderização de `MapaFretes` em
   `<Suspense fallback={...}>` com um fallback visual leve
   (skeleton ou spinner) que ocupe a mesma área do mapa para
   evitar layout shift.
3. WHERE `MotoristaUserCheck === false`,
   THE HomePage SHALL NÃO acionar o import do chunk do
   `MapaFretes` (o `React.lazy` deve ser invocado apenas dentro
   do branch motorista, ou condicionalmente envolvido em uma
   árvore que só renderiza para motorista).
4. THE Feature SHALL NÃO adicionar `leaflet` nem `react-leaflet`
   ao bundle inicial (entry chunk) gerado pelo `vite build`; ambos
   devem permanecer em chunks separados carregados apenas pelo
   ramo motorista — verificação manual via inspeção dos chunks
   gerados na seção 8 do design.

### Requirement 11 — Não-regressão de embarcador, visitante e fluxos existentes

**User Story:** Como sistema FreteGO, quero garantir que nada do
embarcador, do visitante e dos fluxos de motorista existentes
regrida.

#### Acceptance Criteria

1. THE Feature SHALL NÃO alterar nenhum dos arquivos:
   `src/pages/EmbarcadorPerfilPage.tsx`,
   `src/pages/EmbarcadorPage.tsx`,
   `src/services/embarcador.ts`,
   `src/components/FreteForm.tsx`,
   `src/components/LogoUploadField.tsx`,
   `src/services/verification.ts`.
2. THE Feature SHALL preservar todas as assinaturas públicas em
   `src/services/fretes.ts`. Mudanças permitidas em `fretes.ts`
   são apenas aditivas: novas funções exportadas, novos tipos,
   novos campos opcionais em interfaces, sem remoção/renomeação
   nem alteração de tipo de retorno de funções existentes.
3. THE Feature SHALL NÃO alterar a assinatura pública nem o
   comportamento observável de `useGeolocation`,
   `getActiveFretes`, `incrementFreteViews`, `FreteFilters`,
   `FreteCard`, `FreteTable`, `FreteModal`, `AppHeader`,
   `ViewToggle`, `DieselDashboardInput`, `useViewPreference`,
   `useIsMobile`, `useDocumentTitle`, `useAuth` ou
   `getMotoristaCalcContext`.
4. THE Feature SHALL NÃO modificar `src/components/InteractiveMap.tsx`
   (mapa do botão "Ver mapa" original); o componente continua no
   código e pode ser usado em outros pontos, mas não é referenciado
   pelo ramo motorista da `HomePage` após esta entrega.
5. WHEN o usuário visitante (deslogado) abre `/`,
   THE HomePage SHALL renderizar exatamente o mesmo conteúdo de
   antes desta feature (sem mapa fixo, sem chips de raio, sem
   banner de localização).
6. WHEN o usuário embarcador autenticado abre `/`,
   THE HomePage SHALL renderizar exatamente o mesmo conteúdo de
   antes desta feature (sem mapa fixo, sem chips de raio, sem
   banner de localização, sem `DieselDashboardInput`).
7. WHEN os testes existentes (`auth.test.ts`,
   `inputValidator.property.test.ts`, `passwordHash.test.ts`,
   `passwordValidation.test.ts`, `pisValidation.property.test.ts`,
   `plateValidation.property.test.ts`,
   `tripSuggestion.property.test.ts`,
   `yearValidation.property.test.ts`,
   `sectionCounter.property.test.ts`,
   `calculoFrete.property.test.ts`,
   `freteFilters.property.test.ts`,
   `geolocation.property.test.ts`,
   `fileValidation.property.test.ts`,
   `textCase.property.test.ts`,
   `phoneFormat.property.test.ts`,
   `cep.property.test.ts`,
   `security/*`) são executados após esta implementação,
   THE Test_Suite SHALL apresentar 100% dos casos passando (sem
   novos `failing` introduzidos por esta feature).

### Requirement 12 — Performance

**User Story:** Como motorista logado, quero que a home carregue
em menos de 1.5s mesmo com 100+ fretes ativos, para não esperar
ao começar o dia.

#### Acceptance Criteria

1. WHEN o motorista logado abre `/` com 100 fretes ativos
   carregados,
   THE HomePage SHALL exibir o esqueleto inicial (header + skeleton
   de mapa + filtros) em até 1500 ms desde a navegação até o
   primeiro paint útil, em conexão típica (LTE/4G ou banda larga
   doméstica).
2. THE HomePage SHALL memoizar a lista filtrada por raio com
   `useMemo` (Req 4.5), evitando recálculo da fórmula de Haversine
   para cada frete em todos os re-renders.
3. THE MapaFretes SHALL renderizar pins apenas para fretes da lista
   filtrada por raio (Req 4.1), evitando processar pins fora do
   raio atual.
4. THE MapaFretes SHALL atualizar o conjunto de pins via mutação
   incremental do Leaflet (`react-leaflet` faz isso por debaixo
   ao usar `<Marker key={frete.id} />`), mantendo `key` estável
   por `frete.id` para que pins existentes não sejam recriados
   quando apenas a lista muda parcialmente.
5. THE HomePage SHALL NÃO realizar nenhuma chamada de rede extra
   (fora as já existentes para `getActiveFretes`, realtime de
   `fretes-realtime`, `getMotoristaCalcContext`,
   `incrementFreteViews`) em decorrência desta feature; o cálculo
   de distância e o filtro de raio são integralmente client-side.
