# Requirements Document

## Introduction

Esta feature substitui o item **Chat** da barra inferior de
navegação do motorista (`MotoristaBottomNav`) por um item **Mapa**
que abre uma página fullscreen com mapa Leaflet centrado no
motorista, círculo de raio configurável (50/100/200/500 km) e pinos
para os fretes ativos cuja origem está dentro do raio. Ao clicar
num pino, o mapa traça a rota origem → destino do frete via OSRM
(reusando `getRouteGeometry`) com fallback de linha reta, e os
demais pinos perdem opacidade para destacar o selecionado. O mapa
suporta gesto de rotação com dois dedos via plugin `leaflet-rotate`,
com fallback gracioso se a lib falhar.

A feature é exclusiva do **ramo motorista** (`user.userType ===
'motorista'`). Embarcador e visitante não veem o `MotoristaBottomNav`,
portanto não enxergam essa entrada.

A entrega cobre nove frentes:

1. **Bottom nav** — substituir Chat por Mapa, remover prop
   `chatBadge`, manter os 4 slots e o botão central flutuante
   (megafone) intactos.
2. **Roteamento** — nova rota `/motorista/mapa` que renderiza a
   página fullscreen, integrada ao `App.tsx` existente.
3. **Página fullscreen** — `MotoristaMapaPage` ocupa 100% da
   viewport (header próprio com botão Voltar; sem `AppHeader`
   nem `MotoristaBottomNav` na rota do mapa).
4. **Localização** — reusa `useEffectiveLocation` (GPS + override
   manual). Sem localização ativa, mapa centra em Brasil
   (-14.235, -51.9253) com zoom 4 e banner pedindo permissão; pinos
   não são plotados nesse estado.
5. **Raio** — reusa `RADIUS_OPTIONS_KM`, `readStoredRadius`,
   `writeStoredRadius` e `RADIUS_STORAGE_KEY` em compartilhamento
   com o feed (`HomePage`). Mudança no mapa propaga para o feed e
   vice-versa via mesmo `localStorage`.
6. **Círculo + viewport** — desenha um `L.Circle` do raio em torno
   do ponto efetivo e ajusta o zoom via `fitBounds` para que o
   raio caiba na viewport com folga padrão.
7. **Pinos + fade** — pinos para fretes filtrados por
   `filterFretesByRadius`. Quando há frete selecionado, todos os
   demais pinos ficam com opacidade ≈30%. Clique no mapa (fora de
   pino) limpa a seleção e restaura opacidade total.
8. **Rota OSRM** — clique num pino dispara `getRouteGeometry` e
   desenha a rota real. Enquanto carrega, mostra linha tracejada
   reta (fallback) entre origem e destino. Em falha do OSRM, mantém
   a linha reta como rota final.
9. **Rotação 2 dedos** — adiciona dependência `leaflet-rotate`
   carregada lazy junto com o mapa. Em falha de import ou
   inicialização, o mapa abre sem rotação e loga warn no console;
   nunca crasha o app.

Tudo deve preservar 100% dos fluxos do embarcador, do visitante e
do feed do motorista. O `MapaToolbar` na `HomePage` continua
funcionando exatamente como hoje, incluindo o botão "Ver mapa"
modal (`MapaFretes` invocado pelo `MapaToolbar`) — esta feature
**não substitui** o modal existente, apenas adiciona uma nova
entrada via bottom nav.

## Glossary

### Sistemas, componentes e arquivos

- **MotoristaBottomNav**: componente existente
  `src/components/MotoristaBottomNav.tsx`. MODIFICADO por esta
  feature: o terceiro slot deixa de ser **Chat** (com badge) e
  passa a ser **Mapa**, navegando para `/motorista/mapa`.
- **MotoristaMapaPage**: NOVA página
  `src/pages/MotoristaMapaPage.tsx` que renderiza o mapa
  fullscreen. Não usa `AppHeader` nem `MotoristaBottomNav`.
- **MotoristaMapaFullscreen**: NOVO componente
  `src/components/MotoristaMapaFullscreen.tsx` que encapsula o
  mapa Leaflet, círculo de raio, pinos, rota OSRM, fade nos pinos
  não-selecionados e plugin de rotação. Carregado via
  `React.lazy` pela `MotoristaMapaPage`.
- **MotoristaMapaPageLazy**: import dinâmico de
  `MotoristaMapaPage` via
  `React.lazy(() => import('./pages/MotoristaMapaPage'))` no
  `App.tsx`, envolvido em `<Suspense fallback={...}>`.
- **MapaFretes**: componente existente
  `src/components/MapaFretes.tsx`. NÃO modificado por esta
  feature. Continua sendo o modal aberto pelo `MapaToolbar` na
  `HomePage`. A nova `MotoristaMapaFullscreen` é um componente
  **independente**, não uma variante.
- **MapaToolbar**: componente existente
  `src/components/MapaToolbar.tsx`. NÃO modificado. Continua
  funcionando na `HomePage` como hoje, abrindo o modal
  `MapaFretes`.
- **HomePage**: página `src/pages/HomePage.tsx`. Mudança apenas
  na renderização do `MotoristaBottomNav` (passa a não receber
  `chatBadge`, prop removida do componente). Resto inalterado.
- **App**: arquivo `src/App.tsx`. MODIFICADO: adiciona a rota
  `/motorista/mapa` apontando para `MotoristaMapaPageLazy`,
  protegida pelos mesmos guards de autenticação já em uso para
  rotas de motorista (se aplicável; do contrário, abre a verificação
  no próprio componente). Demais rotas inalteradas.
- **EffectiveLocationHook**: hook existente
  `src/hooks/useEffectiveLocation.ts`. REUSADO sem alteração.
  Devolve `point`, `address`, `source`, `geoStatus`, `geoError`,
  `requestLocation`, `clearLocation`.
- **GeoDistanceUtil**: módulo existente
  `src/utils/geoDistance.ts`. REUSADO sem alteração: exporta
  `RADIUS_OPTIONS_KM`, `RADIUS_DEFAULT_KM`, `RADIUS_STORAGE_KEY`,
  `RadiusOption`, `filterFretesByRadius`, `readStoredRadius`,
  `writeStoredRadius`, `haversineDistanceKm`.
- **GeolocationService**: módulo existente
  `src/services/geolocation.ts`. REUSADO sem alteração.
  Especificamente `getRouteGeometry(origin, destination)` para
  carregar a rota OSRM como `GeographicPoint[]` ou `null` em
  falha.
- **FretesService**: módulo `src/services/fretes.ts`. Mudanças
  apenas aditivas, se necessárias. Nenhuma assinatura existente
  alterada. Lista de fretes ativos carregada via
  `getActiveFretes` (ou consumida do mesmo cache que a
  `HomePage` usa).
- **LeafletLib**: dependências `leaflet@1.9.4` +
  `react-leaflet@5.0.0` já instaladas em `package.json`. Esta
  feature **adiciona** a dependência `leaflet-rotate@^0.2.x`
  (versão exata definida no design).
- **OpenStreetMapTiles**: tile server público
  `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`. Mesmo
  servidor já em uso.
- **OSRMRouter**: serviço público de roteamento OSRM já consumido
  pelo `getRouteGeometry`. Sem chave, com timeout configurado no
  service.
- **AuthHook**: hook existente `src/hooks/useAuth.ts`. REUSADO
  para verificar `user?.userType === 'motorista'` na guarda da
  rota.

### Constantes, formatos e valores

- **MotoristaUserCheck**: predicado
  `user?.userType === 'motorista'`. Verdadeiro apenas quando o
  usuário autenticado é motorista.
- **MapaRoute**: caminho `/motorista/mapa`. Rota nova adicionada
  ao `App.tsx`.
- **BR_CENTER**: coordenadas `[-14.235, -51.9253]` (Brasil
  central). Já em uso em `MapaFretes.tsx`. Reusada quando não há
  ponto efetivo.
- **BR_ZOOM_FALLBACK**: `4`. Zoom inicial quando o mapa abre sem
  ponto efetivo.
- **FitBoundsPadding**: `[40, 40]` (em pixels). Padding aplicado
  ao `fitBounds` ao enquadrar o círculo de raio. Mesma folga
  visual usada hoje pelo `MapaFretes.tsx` em
  `MapAutoCenter` (que usa `[30, 30]`); para fullscreen, esta
  feature padroniza em `[40, 40]` por ter mais área.
- **PinOpacity_Selected**: `1.0` (100%).
- **PinOpacity_Unselected**: `0.3` (30%). Aplicado aos pinos não
  selecionados quando há frete com rota traçada.
- **RouteColor_OSRM**: `#2563eb` (azul Tailwind blue-600).
  Cor da Polyline quando a rota real do OSRM foi carregada.
- **RouteColor_Fallback**: `#2563eb` com `dashArray: '8 4'`. Linha
  tracejada azul enquanto a rota OSRM ainda não chegou ou quando
  a chamada falhou.
- **RouteWeight**: `4` (px).
- **RouteOpacity**: `0.85`.
- **OSRMTimeout_ms**: timeout interno do `getRouteGeometry` (já
  existente no service). Esta feature não redefine; apenas
  consome.
- **RotateGesturePlugin**: módulo
  [`leaflet-rotate`](https://www.npmjs.com/package/leaflet-rotate),
  versão pinada definida pelo design (`~0.2.x`). Carregado lazy
  junto com `MotoristaMapaFullscreen`.
- **RotateInitOptions**:
  `{ rotate: true, touchRotate: true, bearing: 0 }`. Opções
  passadas para `MapContainer` quando a lib carrega com sucesso.
- **MapaFullscreenZ**: z-index `100` (acima de
  `MotoristaBottomNav` z-40 e modal de toolbar z-80, mas abaixo
  de toasts e dialogs globais). A página é uma rota dedicada,
  então em prática ocupa toda a tela; o z-index é precaução para
  banners e popups internos.
- **BackButtonLabel**: rótulo `Voltar` para o botão do header da
  página, com ícone seta para a esquerda.
- **PageTitle**: `Mapa de fretes` no header da página.
- **EmptyStateMessage_NoLocation**: `Ative a localização para ver
  fretes próximos a você.` (mesmo texto-padrão usado pelo
  feed/`MapaFretes`, sem inventar variantes).
- **EmptyStateMessage_NoFretes**: `Nenhum frete dentro do raio
  atual. Aumente o raio para ver mais ofertas.`.
- **DefaultRadius_FirstOpen**: valor retornado por
  `readStoredRadius(localStorage[RADIUS_STORAGE_KEY])`. Quando
  não há nada salvo, retorna `RADIUS_DEFAULT_KM` (100).
- **PinHitRadius_px**: `22` (altura do pino SVG já usada em
  `MapaFretes.tsx`). Mantido para consistência visual.

### Tipos e listas pré-definidas

- **GeolocationStatus**: já definido em `useGeolocation.ts`:
  `'idle' | 'loading' | 'success' | 'denied' | 'error' |
  'insecure'`.
- **EffectiveLocationSource**: já definido em
  `useEffectiveLocation.ts`: `'gps' | 'override' | 'none'`.
- **RadiusOption**: já definido em `geoDistance.ts`:
  `50 | 100 | 200 | 500`.
- **PinState**: estados visuais de cada pino:
  `'default' | 'selected' | 'faded'`.
  - `default`: nenhum frete selecionado, opacidade 100%.
  - `selected`: o frete cuja rota está traçada, opacidade 100%.
  - `faded`: outro frete enquanto há um selecionado, opacidade
    `PinOpacity_Unselected`.
- **RouteState**: estados da rota traçada:
  `'idle' | 'loading' | 'osrm' | 'fallback'`.
  - `idle`: nenhum frete selecionado, sem rota.
  - `loading`: frete selecionado, OSRM em vôo, exibindo linha
    tracejada reta.
  - `osrm`: rota OSRM carregada e desenhada.
  - `fallback`: OSRM falhou ou retornou `null`, mantém a linha
    tracejada reta como rota final.
- **RotateAvailability**: `'pending' | 'available' |
  'unavailable'`.
  - `pending`: import do plugin em vôo.
  - `available`: plugin carregou e instalou as opções de rotação.
  - `unavailable`: import falhou; mapa segue sem rotação.

## Requirements

### Requirement 1: Bottom nav: Chat vira Mapa

**User Story:** Como motorista logado, quero que o terceiro item
do bottom nav seja **Mapa**, no lugar de Chat, para que eu acesse o
mapa fullscreen com um toque.

#### Acceptance Criteria

1. THE MotoristaBottomNav SHALL renderizar exatamente quatro itens
   no grid inferior, na ordem: Início, Negociar, Mapa, Menu.
2. THE MotoristaBottomNav SHALL substituir o ícone e o rótulo
   atuais do slot 3 (atualmente um balão de fala com badge `Chat`)
   por um ícone de mapa/pino e o rótulo `Mapa`.
3. THE MotoristaBottomNav SHALL remover a prop `chatBadge` e o
   bloco de badge numérico do slot 3.
4. WHEN o motorista toca no slot **Mapa**,
   THE MotoristaBottomNav SHALL navegar para `MapaRoute`
   (`/motorista/mapa`).
5. THE MotoristaBottomNav SHALL preservar o botão central
   flutuante (megafone) com `aria-label="Anunciar"` e o estilo
   visual atual sem alteração de classes.
6. THE MotoristaBottomNav SHALL preservar o slot **Início** com a
   navegação para `/` e o comportamento de `scrollTo(top)` quando
   já está em `/`.
7. THE MotoristaBottomNav SHALL preservar os slots **Negociar** e
   **Menu** com os mesmos ícones, rótulos e
   placeholders/handlers atuais (sem mudança de comportamento
   nesta feature).
8. THE MotoristaBottomNav SHALL aplicar `aria-label="Mapa"` ao
   botão do slot 3 e estado visual ativo (cor verde) quando
   `useLocation().pathname === '/motorista/mapa'`, análogo ao
   tratamento atual do slot Início.

### Requirement 2: Rota dedicada `/motorista/mapa`

**User Story:** Como sistema, quero uma rota nova `/motorista/mapa`
que renderiza a página fullscreen, para que o mapa tenha uma URL
compartilhável e um back nativo do navegador.

#### Acceptance Criteria

1. THE App SHALL adicionar a rota `MapaRoute`
   (`/motorista/mapa`) ao `<Routes>` principal de `src/App.tsx`,
   apontando para `MotoristaMapaPageLazy`.
2. THE App SHALL importar `MotoristaMapaPage` via
   `React.lazy(() => import('./pages/MotoristaMapaPage'))`.
3. THE App SHALL envolver a rota `MapaRoute` em
   `<Suspense fallback={...}>` com fallback visual leve (mesmo
   padrão de loading usado nas outras rotas lazy do app).
4. WHEN um usuário não autenticado acessa `MapaRoute`,
   THE MotoristaMapaPage SHALL redirecionar para `/login` ou
   renderizar o estado deslogado padrão usado pelas outras rotas
   protegidas do app (decisão de design baseada no padrão atual
   de auth do projeto, sem inventar fluxo novo).
5. WHEN um usuário autenticado com `user.userType !== 'motorista'`
   acessa `MapaRoute`,
   THE MotoristaMapaPage SHALL redirecionar para `/`
   (homepage) — embarcador/admin não tem essa entrada de mapa.
6. WHEN um usuário autenticado com `MotoristaUserCheck === true`
   acessa `MapaRoute`,
   THE MotoristaMapaPage SHALL renderizar a interface fullscreen
   completa.
7. THE App SHALL preservar o catch-all `<Route path="*"
   element={<NotFoundPage />} />` no final de `<Routes>`, sem
   alteração de ordem que afete outras rotas.
8. THE App SHALL preservar a navegação do botão Voltar do
   navegador: ao acessar `MapaRoute` e pressionar Voltar,
   o usuário retorna à rota anterior (`/`, `/menu`, etc.) sem
   forçar uma rota fixa.

### Requirement 3: Página fullscreen com header próprio

**User Story:** Como motorista, quero que o mapa ocupe toda a
tela com um header simples (botão Voltar + título), para
visualizar os fretes sem distração.

#### Acceptance Criteria

1. THE MotoristaMapaPage SHALL renderizar um container que ocupa
   100% da viewport (`100vw × 100vh`) sem `AppHeader` nem
   `MotoristaBottomNav`.
2. THE MotoristaMapaPage SHALL renderizar um header próprio
   sticky no topo com altura de 48 px, contendo um botão Voltar
   com ícone de seta à esquerda e o título `PageTitle` à direita
   do botão.
3. WHEN o motorista toca no botão Voltar,
   THE MotoristaMapaPage SHALL chamar `navigate(-1)` para retornar
   à rota anterior; quando não há histórico (entrada direta via
   URL), SHALL navegar para `/`.
4. THE MotoristaMapaPage SHALL renderizar `MotoristaMapaFullscreen`
   ocupando 100% da área restante abaixo do header (`flex-1`
   dentro de container `flex flex-col h-screen`).
5. THE MotoristaMapaPage SHALL renderizar o seletor de raio
   (chips ou dropdown) flutuando no canto superior direito do
   mapa, com z-index `MapaFullscreenZ` e `min-h-[44px]` em
   viewport mobile.
6. THE MotoristaMapaPage SHALL renderizar uma indicação visual
   da localização efetiva (texto curto, ex.: `📍 GPS` ou
   `📍 Override: <label>`) no canto inferior esquerdo, abaixo do
   círculo do raio, com z-index `MapaFullscreenZ`.
7. THE MotoristaMapaPage SHALL preservar os controles nativos de
   zoom do Leaflet posicionados conforme decisão de design
   (default Leaflet ou ocultos com gestos pinch-zoom apenas).

### Requirement 4: Centralização e zoom para enquadrar o raio

**User Story:** Como motorista, quero que ao abrir o mapa o
zoom já mostre exatamente o meu raio, sem ter que fazer pinch
manual.

#### Acceptance Criteria

1. WHEN `MotoristaMapaFullscreen` é montado E
   `useEffectiveLocation().point !== null`,
   THE MotoristaMapaFullscreen SHALL inicializar o mapa
   centralizado em `(point.latitude, point.longitude)`.
2. WHEN `MotoristaMapaFullscreen` é montado E
   `useEffectiveLocation().point === null`,
   THE MotoristaMapaFullscreen SHALL inicializar o mapa centralizado
   em `BR_CENTER` com zoom `BR_ZOOM_FALLBACK`.
3. WHEN o ponto efetivo está disponível,
   THE MotoristaMapaFullscreen SHALL desenhar um `L.Circle` com
   centro no ponto efetivo, raio em metros igual a
   `radiusKm * 1000` e estilo visual sutil (linha 2 px na cor
   verde do app, fill com 8% de opacidade).
4. WHEN o círculo é desenhado ou o raio muda,
   THE MotoristaMapaFullscreen SHALL chamar
   `map.fitBounds(circle.getBounds(), { padding: FitBoundsPadding })`
   exatamente uma vez por mudança de `radiusKm` ou de `point`,
   garantindo que o círculo inteiro fique visível dentro da
   viewport com a folga padrão.
5. THE MotoristaMapaFullscreen SHALL desenhar um marcador verde
   distinto (não confundível com pinos de frete) na posição do
   ponto efetivo, indicando o motorista. O marcador SHALL ter
   borda branca e sombra leve para contraste sobre tiles claros e
   escuros.
6. IF o `fitBounds` é chamado antes do mapa estar totalmente
   montado (container ainda sem dimensão final),
   THEN THE MotoristaMapaFullscreen SHALL aguardar o ciclo
   seguinte (via `setTimeout` curto ou efeito após
   `whenReady`) e tentar novamente, sem propagar exceção.
7. WHEN o motorista move/pan/zoom manualmente o mapa após o
   ajuste inicial,
   THE MotoristaMapaFullscreen SHALL preservar a interação manual
   sem reenquadrar automaticamente, exceto quando ocorre uma das
   condições disparadoras (mudança de `radiusKm`, mudança de
   `point`, seleção/limpeza de frete que dispara `FitRoute`).

### Requirement 5: Filtro de pinos por raio (compartilhado com o feed)

**User Story:** Como motorista, quero ver no mapa apenas os fretes
que estão dentro do meu raio configurado, e quero que essa
configuração seja a mesma do feed.

#### Acceptance Criteria

1. THE MotoristaMapaFullscreen SHALL hidratar o raio inicial via
   `readStoredRadius(localStorage[RADIUS_STORAGE_KEY])`,
   usando `RADIUS_DEFAULT_KM` quando não há valor salvo ou o
   valor é inválido.
2. WHEN o motorista altera o raio no seletor da página,
   THE MotoristaMapaFullscreen SHALL atualizar o estado local,
   gravar via `writeStoredRadius(novoValor)` e re-renderizar o
   círculo + os pinos imediatamente.
3. THE MotoristaMapaFullscreen SHALL filtrar a lista de fretes
   exibidos no mapa via
   `filterFretesByRadius(fretes, point, radiusKm)` quando
   `point !== null`.
4. WHEN `point === null`,
   THE MotoristaMapaFullscreen SHALL NÃO renderizar pinos de
   frete (mostra mapa centrado no Brasil sem markers).
5. THE MotoristaMapaFullscreen SHALL excluir do conjunto de pinos
   qualquer frete cuja `originLocation` tenha `latitude` ou
   `longitude` não-finitos OU ambos iguais a zero (definição de
   `hasValidLocation` já em `geoDistance.ts`).
6. THE MotoristaMapaFullscreen SHALL renderizar pinos com cor
   verde para fretes com `status === 'ativo'` e cor cinza para
   fretes com `status === 'encerrado'`, reusando o
   estilo `pinIcon` já definido em `MapaFretes.tsx` ou um helper
   equivalente em módulo compartilhado.
7. WHEN a lista de fretes ativos vinda do servidor muda
   (real-time, polling, refetch após filtro),
   THE MotoristaMapaFullscreen SHALL atualizar o conjunto de
   pinos preservando `key={frete.id}` para evitar re-criação
   desnecessária dos markers.
8. WHEN a lista filtrada por raio resulta vazia E
   `point !== null`,
   THE MotoristaMapaFullscreen SHALL exibir um banner discreto
   no rodapé com `EmptyStateMessage_NoFretes` por até 6 segundos
   ou até o motorista mudar o raio (o que vier primeiro).

### Requirement 6: Click no pino: rota traçada via OSRM

**User Story:** Como motorista, quero clicar num pino e ver a rota
do frete (origem → destino) traçada no mapa pelas ruas reais, com
opacidade reduzida nos demais pinos para focar no selecionado.

#### Acceptance Criteria

1. WHEN o motorista toca/clica num pino de frete,
   THE MotoristaMapaFullscreen SHALL definir o frete clicado como
   `selectedRouteFrete` e disparar a chamada
   `getRouteGeometry(frete.originLocation,
   frete.destinationLocation)` em background.
2. WHILE a chamada `getRouteGeometry` está em vôo
   (`RouteState === 'loading'`),
   THE MotoristaMapaFullscreen SHALL desenhar uma `L.Polyline`
   com `RouteColor_Fallback` (azul tracejado) entre origem e
   destino do frete, como rota provisória.
3. WHEN `getRouteGeometry` retorna um array
   `GeographicPoint[]` não-vazio,
   THE MotoristaMapaFullscreen SHALL substituir a linha
   tracejada por uma `L.Polyline` contínua com
   `RouteColor_OSRM`, peso `RouteWeight`, opacidade
   `RouteOpacity`, traçada nos pontos retornados pelo OSRM
   (`RouteState === 'osrm'`).
4. IF `getRouteGeometry` retorna `null` (timeout, HTTP não-OK, ou
   geometria vazia),
   THEN THE MotoristaMapaFullscreen SHALL manter a linha
   tracejada reta como rota final (`RouteState === 'fallback'`)
   sem exibir mensagem de erro bloqueante.
5. WHEN um frete é selecionado E sua rota é traçada
   (qualquer estado != idle),
   THE MotoristaMapaFullscreen SHALL chamar
   `map.fitBounds(routeBounds, { padding: FitBoundsPadding })`
   uma vez para enquadrar a rota na viewport.
6. WHEN um frete está selecionado,
   THE MotoristaMapaFullscreen SHALL renderizar um marker laranja
   distinto na posição do destino do frete (reutilizando o
   helper `destIcon` já em `MapaFretes.tsx` ou equivalente
   compartilhado).
7. WHEN um frete está selecionado,
   THE MotoristaMapaFullscreen SHALL exibir um card flutuante
   no rodapé contendo: rota
   (`origin → destination`), valor formatado em BRL, distância
   motorista→origem do frete em km com 1 casa decimal e botão
   `Ver detalhes` que dispara o `FreteModal` existente (ou
   navega para uma rota de detalhe, conforme padrão atual da
   `HomePage`).
8. WHEN o motorista clica no botão `✕ Limpar rota` do card OU
   clica no mapa em uma área sem pinos,
   THE MotoristaMapaFullscreen SHALL definir
   `selectedRouteFrete = null`, remover a `Polyline`, remover o
   marker de destino e fechar o card flutuante.
9. WHEN o motorista clica em outro pino enquanto há um frete
   selecionado,
   THE MotoristaMapaFullscreen SHALL trocar `selectedRouteFrete`
   para o novo frete e refazer o ciclo (Req 6.1 a 6.5),
   cancelando a chamada `getRouteGeometry` anterior se ainda
   estiver em vôo (via flag `cancelled` ou `AbortController`).

### Requirement 7: Fade nos pinos não-selecionados

**User Story:** Como motorista, quando eu seleciono um frete, os
outros pinos devem perder opacidade pra não competir visualmente
com o que estou olhando.

#### Acceptance Criteria

1. WHILE `selectedRouteFrete === null`,
   THE MotoristaMapaFullscreen SHALL renderizar todos os pinos
   com opacidade `PinOpacity_Selected` (1.0).
2. WHILE `selectedRouteFrete !== null`,
   THE MotoristaMapaFullscreen SHALL renderizar o pino do
   `selectedRouteFrete` com opacidade `PinOpacity_Selected`
   (1.0) e os demais com opacidade `PinOpacity_Unselected`
   (0.3).
3. THE MotoristaMapaFullscreen SHALL aplicar a opacidade nos
   pinos via `Marker.setOpacity` do Leaflet OU via classe CSS
   no `divIcon` (decisão de design); a transição de opacidade
   SHALL ser suave (≤ 200 ms) para evitar flicker.
4. WHEN o motorista clica no mapa em uma área sem pinos
   (evento `click` do `MapContainer` que não foi capturado por
   nenhum `Marker`),
   THE MotoristaMapaFullscreen SHALL limpar
   `selectedRouteFrete` (Req 6.8), restaurando opacidade
   `PinOpacity_Selected` em todos os pinos.
5. WHEN o motorista clica num pino com fade
   (`PinState === 'faded'`),
   THE MotoristaMapaFullscreen SHALL trocar o frete selecionado
   (Req 6.9) e atualizar opacidade: o novo selecionado vai para
   `PinOpacity_Selected`, o anterior selecionado vai para
   `PinOpacity_Unselected`, e os demais permanecem em
   `PinOpacity_Unselected`.
6. THE MotoristaMapaFullscreen SHALL preservar a hit-area do
   pino com fade igual à do pino normal (a opacidade visual
   não reduz a área clicável). O motorista consegue clicar
   normalmente em pinos com opacidade reduzida para selecioná-los.

### Requirement 8: Sem localização: Brasil + banner

**User Story:** Como motorista que ainda não autorizou GPS, quero
ver o mapa do Brasil ao abrir, com um banner explicando como
ativar a localização.

#### Acceptance Criteria

1. WHEN `useEffectiveLocation().point === null` E
   `useEffectiveLocation().geoStatus IN
   { 'idle', 'loading' }`,
   THE MotoristaMapaFullscreen SHALL exibir um overlay leve
   semi-transparente sobre o mapa com texto
   `Localizando...`.
2. WHEN `useEffectiveLocation().point === null` E
   `useEffectiveLocation().geoStatus IN
   { 'denied', 'error', 'insecure' }`,
   THE MotoristaMapaFullscreen SHALL exibir um banner amarelo
   centralizado contendo `EmptyStateMessage_NoLocation` e um
   botão `Como ativar` (idêntico ao banner do `MapaFretes`
   existente, reusando o componente ou copiando o padrão sem
   inventar variantes).
3. WHEN o motorista clica em `Como ativar`,
   THE MotoristaMapaFullscreen SHALL exibir o modal de ajuda já
   implementado no `MapaFretes` (instruções por browser/SO) OU
   chamar `requestLocation()` se o status for `'idle'`/`'error'`
   sem prévia recusa.
4. WHEN `point === null`,
   THE MotoristaMapaFullscreen SHALL renderizar o mapa
   centralizado em `BR_CENTER` com zoom `BR_ZOOM_FALLBACK`,
   SEM círculo de raio, SEM pinos de fretes e SEM marcador do
   motorista.
5. WHEN o status da localização transita para `'success'` em
   tempo real (motorista clicou em `Tentar agora` e o GPS
   respondeu OK), 
   THE MotoristaMapaFullscreen SHALL re-centralizar o mapa em
   `point` (Req 4.1), desenhar o círculo (Req 4.3) e plotar os
   pinos (Req 5.3) sem precisar recarregar a página.
6. THE MotoristaMapaFullscreen SHALL NÃO bloquear a UI quando
   `point === null`: o seletor de raio, o botão Voltar e a
   navegação por gestos do mapa continuam funcionando, mesmo
   sem fretes plotados.

### Requirement 9: Rotação 2 dedos via leaflet-rotate (com fallback)

**User Story:** Como motorista usando o app no celular, quero
girar o mapa com gesto de 2 dedos pra alinhar o norte com a
direção da rua, e quero que o app não quebre se o plugin de
rotação falhar por qualquer motivo.

#### Acceptance Criteria

1. THE Feature SHALL adicionar a dependência
   `leaflet-rotate` ao `package.json` na versão pinada definida
   pelo design (ex.: `"leaflet-rotate": "~0.2.x"` exato).
2. THE MotoristaMapaFullscreen SHALL importar
   `leaflet-rotate` via `import('leaflet-rotate')` dinâmico
   dentro de um `useEffect` no mount do componente, antes de
   inicializar o `MapContainer` ou em conjunto com a primeira
   renderização (decisão de design para garantir ordem
   correta de extensão de `L.Map`).
3. WHEN `import('leaflet-rotate')` resolve com sucesso,
   THE MotoristaMapaFullscreen SHALL passar
   `RotateInitOptions` (`{ rotate: true, touchRotate: true,
   bearing: 0 }`) ao `MapContainer` e definir
   `RotateAvailability = 'available'`.
4. WHILE `RotateAvailability === 'available'`,
   THE MotoristaMapaFullscreen SHALL permitir gesto de rotação
   com 2 dedos em dispositivos touch (touchRotate) e atalho
   `Shift + arrastar` em desktop.
5. IF `import('leaflet-rotate')` rejeita (rede, módulo
   corrompido, incompatibilidade) OU lança ao chamar
   inicialização das opções de rotação,
   THEN THE MotoristaMapaFullscreen SHALL definir
   `RotateAvailability = 'unavailable'`, renderizar o
   `MapContainer` sem `rotate`/`touchRotate`, logar um warn
   `[MotoristaMapaFullscreen] leaflet-rotate indisponível —
   rotação desabilitada` e seguir funcionando normalmente.
6. THE MotoristaMapaFullscreen SHALL NÃO bloquear o render do
   mapa enquanto `RotateAvailability === 'pending'`: o mapa
   abre sem rotação E, se o plugin chegar depois, a rotação
   passa a funcionar nos próximos remounts ou via reinicialização
   suave (decisão de design — uma das duas; consistência é o
   que importa).
7. THE MotoristaMapaFullscreen SHALL preservar pinch-zoom,
   `dragging`, `touchZoom` e `doubleClickZoom` independentemente
   do estado de `RotateAvailability`.
8. WHEN o motorista executa o gesto de rotação E
   `RotateAvailability === 'available'`,
   THE MotoristaMapaFullscreen SHALL atualizar o `bearing` do
   mapa proporcionalmente ao gesto, sem afetar a posição dos
   pinos relativos ao mundo (os pinos giram junto com os tiles,
   coordenadas geográficas inalteradas).

### Requirement 10: Persistência de raio compartilhada com o feed

**User Story:** Como motorista, quero que o raio que eu escolho no
mapa fullscreen seja o mesmo que o feed usa, e vice-versa.

#### Acceptance Criteria

1. THE MotoristaMapaFullscreen SHALL ler e gravar o raio no
   mesmo `localStorage[RADIUS_STORAGE_KEY]` usado pelo
   `HomePage`/`MapaToolbar`.
2. WHEN o motorista muda o raio na `MotoristaMapaFullscreen`,
   THE MotoristaMapaFullscreen SHALL chamar
   `writeStoredRadius(novoValor)` antes de re-renderizar.
3. WHEN o motorista volta para `/` (homepage) após mudar o raio
   no mapa,
   THE HomePage SHALL hidratar o `MapaToolbar` com o novo valor
   na próxima montagem (já é o comportamento atual de
   `readStoredRadius`); a propagação não exige novo evento
   custom.
4. WHEN o motorista muda o raio em `/` (via `MapaToolbar`) e
   abre `/motorista/mapa`,
   THE MotoristaMapaFullscreen SHALL hidratar com o valor mais
   recente gravado em `localStorage`.
5. THE MotoristaMapaFullscreen SHALL aceitar somente valores em
   `RADIUS_OPTIONS_KM` (50, 100, 200, 500); valores fora dessa
   lista vindos de `localStorage` corrompido SHALL cair no
   default `RADIUS_DEFAULT_KM` via `readStoredRadius`.
6. THE MotoristaMapaFullscreen SHALL NÃO modificar nem expor o
   raio para outros consumidores além do feed (sem novos
   `localStorage` keys, sem novos eventos globais, sem cookies).

### Requirement 11: Carregamento dinâmico (lazy)

**User Story:** Como time, quero que o mapa fullscreen e o
plugin de rotação só carreguem quando o motorista entra na rota
`/motorista/mapa`, para não inflar o bundle de visitantes,
embarcadores e do próprio feed do motorista.

#### Acceptance Criteria

1. THE App SHALL importar `MotoristaMapaPage` exclusivamente
   via `React.lazy(() => import('./pages/MotoristaMapaPage'))`,
   sem nenhum import estático que arraste leaflet ou o plugin
   para o entry chunk.
2. THE MotoristaMapaPage SHALL importar
   `MotoristaMapaFullscreen` via `React.lazy(() =>
   import('../components/MotoristaMapaFullscreen'))` OU import
   estático dentro do próprio módulo lazy, contanto que ambos
   permaneçam fora do entry chunk.
3. THE MotoristaMapaFullscreen SHALL importar `leaflet`,
   `react-leaflet` e `leaflet-rotate` apenas dentro do escopo do
   próprio módulo (sem re-export para módulos estáticos).
4. THE Feature SHALL NÃO adicionar `leaflet-rotate` ao bundle
   inicial (verificação manual via inspeção dos chunks gerados
   por `vite build` na seção de validação do design e via
   revisão de código em PRs; não há gating automatizado de
   build para detectar imports incorretos).
5. THE Feature SHALL preservar o chunk lazy atual do
   `MapaFretes` (consumido pelo `MapaToolbar` na `HomePage`)
   sem inflar nem duplicar lógica entre `MapaFretes` e
   `MotoristaMapaFullscreen` — utilitários comuns (icons,
   helpers de pin, banner de permissão) SHALL ser extraídos
   para módulo compartilhado se a duplicação for relevante;
   caso contrário, cópia seletiva é aceitável.

### Requirement 12: Não-regressão de fluxos existentes

**User Story:** Como sistema FreteGO, quero garantir que
embarcador, visitante, feed do motorista e o modal `MapaFretes`
continuem funcionando exatamente como hoje.

#### Acceptance Criteria

1. THE Feature SHALL NÃO alterar nenhum dos arquivos:
   `src/pages/HomePage.tsx` (exceto a remoção da prop
   `chatBadge` na invocação do `MotoristaBottomNav`),
   `src/components/MapaToolbar.tsx`,
   `src/components/MapaFretes.tsx`,
   `src/components/MapaFretesBoundary.tsx`,
   `src/components/InteractiveMap.tsx`,
   `src/components/AppHeader.tsx`,
   `src/components/FreteCard.tsx`,
   `src/components/FreteTable.tsx`,
   `src/components/FreteModal.tsx`,
   `src/components/FreteFilters.tsx`,
   `src/components/DieselDashboardInput.tsx`,
   `src/components/AnunciosCarousel.tsx`,
   `src/components/CommoditiesCarousel.tsx`,
   `src/pages/EmbarcadorPerfilPage.tsx`,
   `src/pages/EmbarcadorPage.tsx`,
   `src/services/embarcador.ts`,
   `src/services/fretes.ts`,
   `src/services/geolocation.ts`,
   `src/utils/geoDistance.ts`,
   `src/hooks/useEffectiveLocation.ts`,
   `src/hooks/useGeolocation.ts`,
   `src/hooks/useAuth.ts`.
2. THE Feature SHALL preservar todas as assinaturas públicas em
   `src/services/fretes.ts` e `src/services/geolocation.ts`.
   Mudanças permitidas são apenas aditivas em arquivos novos
   (`src/components/MotoristaMapaFullscreen.tsx`,
   `src/pages/MotoristaMapaPage.tsx` e helpers compartilhados,
   se extraídos).
3. WHEN o usuário visitante (deslogado) abre `/`,
   THE HomePage SHALL renderizar exatamente o mesmo conteúdo de
   antes desta feature (sem `MotoristaBottomNav`, portanto sem
   o slot Mapa).
4. WHEN o usuário embarcador autenticado abre `/`,
   THE HomePage SHALL renderizar exatamente o mesmo conteúdo de
   antes desta feature (sem `MotoristaBottomNav`).
5. WHEN o motorista autenticado abre `/`,
   THE HomePage SHALL renderizar `MotoristaBottomNav` no rodapé
   com os 4 slots novos (Início, Negociar, Mapa, Menu) e o
   botão central flutuante. O `MapaToolbar` no topo continua
   funcionando como hoje, abrindo o modal `MapaFretes` ao tocar
   `Ver mapa`. O modal `MapaFretes` SHALL continuar funcionando
   sem alteração de comportamento.
6. WHEN os testes existentes do projeto são executados após
   esta implementação,
   THE Test_Suite SHALL apresentar 100% dos casos passando
   (sem novos `failing` introduzidos por esta feature).

### Requirement 13: Performance e responsividade

**User Story:** Como motorista, quero o mapa fullscreen carregar
em até 2 s mesmo com 100+ fretes ativos, e funcionar bem em
celulares com tela ≤ 375 px.

#### Acceptance Criteria

1. WHEN o motorista navega de `/` para `/motorista/mapa`,
   THE MotoristaMapaPage SHALL exibir o esqueleto inicial
   (header + área do mapa em loading) em até 1500 ms desde o
   início da navegação até o primeiro paint útil, em conexão
   típica (LTE/4G ou banda larga doméstica).
2. THE MotoristaMapaFullscreen SHALL atingir o mapa interativo
   completo (tiles carregados + pinos plotados) em até 3000 ms
   adicionais após o primeiro paint útil, com 100 fretes
   ativos.
3. THE MotoristaMapaFullscreen SHALL memoizar a lista de fretes
   filtrada via `useMemo`, recomputando apenas quando muda
   `motoristaPoint`, `radiusKm` ou a lista de fretes ativos
   carregada do servidor.
4. THE MotoristaMapaFullscreen SHALL renderizar markers com
   `key={frete.id}` estável, evitando re-criação dos pinos a
   cada re-render.
5. WHEN renderizada em viewport < 768 px,
   THE MotoristaMapaPage SHALL preservar o pinch-zoom nativo
   do Leaflet sem desabilitar `dragging`, `touchZoom` nem
   `doubleClickZoom`.
6. WHEN renderizada em viewport ≤ 375 px,
   THE MotoristaMapaPage SHALL exibir o seletor de raio como
   chips horizontais ou um dropdown compacto, sem overflow
   horizontal e com `min-h-[44px]` em cada controle clicável.
7. THE MotoristaMapaPage SHALL aplicar `text-base sm:text-sm`
   (16 px no mobile, 14 px no desktop) em controles textuais
   da página, garantindo ausência de zoom acidental no foco
   do iOS.

## Correctness Properties (PBT candidates)

As propriedades a seguir são candidatas a teste com fast-check no
design/tasks. Cada uma é puramente determinística, opera sobre
geometria/utilitários sem efeitos colaterais e tem baixo custo
por iteração.

### Property A — Filtragem por raio: invariante de inclusão

Para qualquer ponto efetivo `P`, qualquer raio `R` em
`RADIUS_OPTIONS_KM`, e qualquer lista de fretes `F` com
coordenadas válidas:

`∀ f ∈ filterFretesByRadius(F, P, R):
   haversineDistanceKm(P, f.originLocation) ≤ R`

(Já testado em `home-map-radius`; reusar a propriedade existente
como referência, sem reimplementar.)

### Property B — Seleção é singleton

Em qualquer estado interno do `MotoristaMapaFullscreen`:

`selectedRouteFrete === null
   OR (∃! f ∈ pinsRenderizados com PinState === 'selected'
       AND ∀ outro f' ≠ f, PinState(f') === 'faded')`

Ou seja: nunca há dois pinos com `selected` simultâneo, e quando
existe um selected todos os demais pinos visíveis estão em
`faded`.

### Property C — Round-trip raio ↔ localStorage

Para qualquer `R ∈ RADIUS_OPTIONS_KM`:

`readStoredRadius(String(R)) === R`
`readStoredRadius(String(writeStoredRadius_then_read(R))) === R`

E para qualquer string `s` arbitrária (lixo):

`readStoredRadius(s) ∈ RADIUS_OPTIONS_KM`
(default cai em `RADIUS_DEFAULT_KM`).

(Propriedade já coberta em `home-map-radius`; reusar.)

### Property D — Idempotência de seleção

Selecionar o mesmo frete duas vezes seguidas equivale a selecionar
uma vez (a segunda chamada não muda estado observável):

`selectFrete(f); selectFrete(f); === selectFrete(f)`

E limpar duas vezes seguidas equivale a limpar uma:

`clearSelection(); clearSelection(); === clearSelection()`

### Property E — Confluence: ordem de seleção/limpeza

Para qualquer sequência de `selectFrete(fA)`, `selectFrete(fB)`,
`clearSelection()`:

A composição `selectFrete(fA) → selectFrete(fB)` resulta em
`selectedRouteFrete === fB`, **independente** da existência de
`selectFrete(fA)` anterior. Ou seja:
`(selectFrete(fA) → selectFrete(fB)) === selectFrete(fB)`
em termos de estado final observável.

### Property F — fitBounds para o círculo enquadra o raio

Para qualquer ponto `P` com latitude em `[-85, 85]` (limites do
Web Mercator) e qualquer raio `R ∈ RADIUS_OPTIONS_KM`:

O `bounds` calculado a partir de `L.circle(P, R*1000).getBounds()`
contém todos os pontos a até `R` km de `P` em projeção
geográfica (Haversine). Verificável amostrando N pontos
sobre o círculo (ângulos `0..2π`) e checando que cada um cai
dentro do `bounds` retornado pelo Leaflet com tolerância
geográfica conservadora (ex.: 1%).

Esta propriedade é mais cara (envolve Leaflet em headless), por
isso o design pode optar por um sucessor mais barato testando
apenas o `LatLngBounds` matemático (norte/sul/leste/oeste
calculados via `R/EARTH_RADIUS_KM` rad).

### Property G — Round-trip OSRM (não testar diretamente)

`getRouteGeometry` é uma chamada de rede e **NÃO** deve ser
testada com PBT direto sobre o serviço externo (custo + não
determinístico). O design pode mockar o `fetch` do `getRouteGeometry`
e testar com PBT que:

- Quando o mock retorna lista válida, o componente entra em
  `RouteState === 'osrm'` e desenha `RouteColor_OSRM` sólida.
- Quando o mock retorna `null`, o componente cai em
  `RouteState === 'fallback'` e mantém a `RouteColor_Fallback`
  tracejada.

Isso é metamorfic property: a relação entre input do `getRouteGeometry`
e o estado visual do componente é determinística mesmo sem
conhecer a geometria exata.

### Property H — fade restaura ao limpar

Para qualquer estado com `selectedRouteFrete = f` E lista de pinos
`L`:

`clearSelection()` resulta em todos os pinos de `L` voltando para
`PinState === 'default'` com opacidade `PinOpacity_Selected`. Não
sobra fade residual.

### Property I — Hit-area do pino independente da opacidade

Para qualquer pino `f` em estado `faded`:

A área clicável do `Marker` SHALL ser idêntica à do pino em
estado `default`. Verificável amostrando coordenadas de pixel
sobre o ícone do `divIcon` e confirmando que `click` no centro
do pino dispara a callback de seleção.

(Propriedade visual; pode ser coberta por example test em vez de
PBT pleno, conforme decisão de design.)

### Property J — Não testar com PBT (anti-properties)

As seguintes condições NÃO são apropriadas para PBT — usar
example tests ou integration tests:

- **Carregamento do plugin `leaflet-rotate`**: depende de import
  dinâmico real do bundler. Cobrir com 1-2 mocks (sucesso e
  falha do `import`) em integration test, não com 100 iterações.
- **Render do Leaflet em DOM headless**: o ciclo de
  `MapContainer → fitBounds → tiles` é caro. Cobrir com 1-2
  example tests usando `@testing-library/react` + mock de
  `tile loading`.
- **Permissão de geolocalização**: depende de `navigator.geolocation`
  e prompts do browser. Cobrir com 1-2 mocks de
  `useGeolocation` retornando `denied`/`success`/`error`.
- **OSRM real (rede)**: custo alto, não-determinístico. Mockar
  `fetch` com 1-3 cenários representativos.
