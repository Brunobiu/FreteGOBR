# Requirements Document

## Introduction

Esta spec entrega a feature **Marketplace** do FreteGO: uma vitrine de anúncios entre os
próprios usuários do app (motoristas e embarcadores), no estilo do Marketplace do Facebook.
Qualquer usuário logado pode publicar um anúncio — para vender um item (ex.: o caminhão dele) ou
para divulgar uma notícia/recado — com título, uma descrição curta, fotos e a sua localização.
Os anúncios aparecem num feed para os demais usuários, que podem abrir cada anúncio para ver as
fotos em tela cheia, o valor, há quantos dias foi anunciado, a localização e a descrição
completa.

Esta é a **primeira versão (MVP)**: o foco é publicar (título + descrição + fotos + localização)
e visualizar (feed + detalhe com galeria). O contato/mensagem entre interessado e anunciante
**fica para uma fase futura** (o dono decide depois como será). A intenção declarada é "montar
primeiro e melhorar depois".

Pontos de design já confirmados com o dono, capturados aqui como requisitos:

1. **Publicar anúncio**: ao tocar em "Publicar", abre um formulário com **título**, **descrição**
   e a opção de **adicionar até 10 fotos**. A descrição é livre, mas ao ser exibida nos cards do
   feed aparece **truncada em 2–3 linhas** (a descrição completa só aparece no detalhe).
2. **Localização obrigatória**: a localização do anúncio é **puxada automaticamente** da posição
   atual do dispositivo. Se a localização não puder ser obtida (permissão negada/indisponível),
   o app **força a ativação** e **não permite publicar sem localização**.
3. **Fotos no estilo Facebook ("quebradas")**: dentro de um anúncio, as fotos são exibidas numa
   **grade tipo colagem** — em vez de empilhar todas, mostra no máximo **4 quadros**; quando há
   mais de 4 fotos, o último quadro recebe um overlay **"+N"** indicando quantas faltam. Ao tocar,
   abre a galeria em tela cheia.
4. **Galeria em tela cheia (detalhe)**: ao abrir um anúncio, as fotos passam para o lado
   (carrossel) com um contador **"X de N"**; tocar numa foto a **amplia** (lightbox) com um
   **botão de voltar**. Abaixo aparecem **valor**, **"anunciado há N dias"**, **localização** e a
   **descrição** completa.
5. **Identidade do autor em todo anúncio**: cada anúncio **sempre** exibe a **foto** e o **nome**
   de quem publicou. Por enquanto é apenas exibição (sem ação ao tocar).
6. **Feed**: a tela inicial do Marketplace mostra, no topo, a **localização atual** de quem está
   navegando e, abaixo, os itens publicados por outros usuários — cada card com a **primeira
   foto**, o **valor** (quando houver) e o **título/descrição curta**, além da identidade do autor.

A feature respeita as convenções do projeto: UI/mensagens user-facing em **pt-BR**;
identifiers/action codes/error codes em **inglês** (ex.: `MARKETPLACE_POST_CREATED`,
`INVALID_FILE_TYPE`, `LOCATION_REQUIRED`); migrations idempotentes com par `_rollback` e
numeração incremental — **última migration aplicada: 121, próxima livre: 122** (a numeração
citada no steering `project-conventions` — "próxima 044" — está desatualizada; vale o estado real
do diretório `supabase/migrations`). A feature reusa a casca já existente do Marketplace
(`/motorista/marketplace`, `MarketplacePage`, slot na `MotoristaBottomNav`), os hooks de
geolocalização (`useGeolocation`/`useEffectiveLocation`, com suporte Capacitor nativo) e a
resolução de foto de perfil (`resolveProfilePhotoUrl`). O fluxo atual de motorista/embarcador
deve continuar funcionando sem regressão.

**Conteúdo gerado por usuário (não é mutação admin):** a publicação de anúncios é feita pelo
próprio usuário, com autorização via **RLS** (o usuário só cria/edita/remove o que é dele). Por
isso o wrapper `executeAdminMutation` e o padrão de audit-by-construction **não se aplicam ao
caminho do usuário** — eles valem apenas para a moderação feita pelo admin (remoção de anúncio
abusivo), que segue `admin-patterns.md`.

**Fora de escopo (fase futura, NÃO implementar agora):**

- **Mensagem/contato** entre interessado e anunciante (o "Enviar mensagem ao vendedor" do
  Facebook). Registrado no Requisito 13.
- **Busca e categorias** funcionais do feed (a barra de busca e as abas "Para você"/"Categorias"
  já existem na casca, mas seu comportamento de filtragem fica para depois). Registrado no
  Requisito 13.
- **Edição** de um anúncio já publicado (o MVP cobre criar, ver e remover o próprio anúncio).
  Registrado no Requisito 13.
- Recomendação/ordenação inteligente do feed, "curtir"/"salvar"/"compartilhar", filtro por
  raio/distância e moderação automatizada.

## Glossary

- **FreteGO**: O sistema/aplicativo completo (app motorista + painel embarcador + painel admin).
- **Marketplace**: Vitrine de anúncios entre usuários do FreteGO (motoristas e embarcadores),
  acessível dentro do app autenticado.
- **Marketplace_Post**: Um anúncio publicado por um usuário. Registro na tabela nova
  `marketplace_posts`. Contém autor, tipo, título, descrição, valor (opcional), fotos,
  localização e status.
- **Post_Author**: O usuário (`users.id`) que publicou o Marketplace_Post. Sua identidade visual
  (foto + nome) é exibida em todo card e no detalhe.
- **Author_Identity**: Foto (`users.profile_photo_url`, resolvida via `resolveProfilePhotoUrl`) +
  nome (`users.name`) do Post_Author, exibidos em todo anúncio.
- **Post_Type**: Classificação do anúncio: `venda` (item à venda, exibe valor) ou `noticia`
  (recado/notícia, sem valor). Identifier em inglês.
- **Post_Price**: Valor anunciado (opcional). Exibido como moeda BRL quando presente; ausente em
  anúncios do tipo `noticia`.
- **Post_Photos**: Lista ordenada de 1 a 10 imagens do Marketplace_Post, armazenadas no
  Marketplace_Bucket; a ordem define qual é a "primeira foto".
- **Primeira_Foto**: A primeira imagem de `Post_Photos` (índice 0); usada como capa do card no
  feed.
- **Post_Location**: Localização obrigatória do Marketplace_Post (ponto geográfico + rótulo
  legível, ex.: "Indiara, GO"), puxada automaticamente do dispositivo no momento da publicação.
- **Forced_Location**: Regra que exige uma Post_Location válida para publicar; se a localização
  não puder ser obtida, o app orienta/força a ativação e bloqueia a publicação.
- **Marketplace_Feed**: Tela inicial do Marketplace (`/motorista/marketplace`) com a localização
  atual do navegante no topo e a lista de Marketplace_Posts ativos abaixo.
- **Feed_Card**: Item do Marketplace_Feed exibindo Primeira_Foto + Post_Price (quando houver) +
  título + descrição curta (truncada) + Author_Identity.
- **Post_Detail**: Tela de detalhe de um Marketplace_Post (`/motorista/marketplace/:id`) com a
  galeria de fotos, valor, "anunciado há N dias", localização, descrição completa e
  Author_Identity.
- **Photo_Collage**: Apresentação das Post_Photos em grade estilo Facebook — no máximo 4 quadros;
  com mais de 4 fotos, o 4º quadro recebe overlay `+N` (fotos restantes).
- **Photo_Lightbox**: Visualização em tela cheia das Post_Photos, com carrossel (passar para o
  lado), contador "X de N", ampliação ao tocar e botão de voltar.
- **Relative_Age**: Texto em pt-BR de quanto tempo faz que o anúncio foi publicado
  (ex.: "hoje", "há 1 dia", "há 4 dias"), derivado de `created_at`.
- **Marketplace_Bucket**: Bucket público de Storage (`marketplace_photos`) para as fotos dos
  anúncios; caminhos prefixados pelo id do autor (`<author_id>/...`) para permitir RLS por dono.
- **Owner_Scoped_RLS**: Política de RLS em que o usuário só pode inserir/editar/remover os
  registros e arquivos cujos donos são ele mesmo (`author_id = auth.uid()` / prefixo de path =
  `auth.uid()`).
- **Marketplace_Moderation**: Ação administrativa de remover (ocultar) um Marketplace_Post
  abusivo, feita pelo admin com permissão, via `executeAdminMutation` (action
  `MARKETPLACE_POST_REMOVED`), seguindo `admin-patterns.md`.
- **Post_Status**: Estado do Marketplace_Post: `ativo` (visível no feed) ou `removido` (oculto;
  por remoção do próprio dono ou por Marketplace_Moderation).
- **Canonical_File_Error**: Mensagem/Code canônico de rejeição de upload por tipo inválido
  (`INVALID_FILE_TYPE`) ou tamanho acima do limite.
- **Capacitor_Geolocation**: Caminho nativo (Android) de geolocalização via `@capacitor/geolocation`
  já encapsulado em `useGeolocation`.

## Requirements

### Requirement 1: Acesso ao Marketplace

**User Story:** Como usuário logado do FreteGO, quero acessar o Marketplace dentro do app, para
ver e publicar anúncios entre usuários.

#### Acceptance Criteria

1. THE FreteGO SHALL registrar a rota do Marketplace_Feed renderizando a `MarketplacePage` para usuários autenticados.
2. THE FreteGO SHALL permitir o acesso ao Marketplace tanto para usuários do tipo `motorista` quanto do tipo `embarcador`, desde que autenticados.
3. WHEN um visitante não autenticado tenta acessar uma rota do Marketplace, THE FreteGO SHALL redirecioná-lo para o fluxo de login, sem expor conteúdo do Marketplace.
4. THE MotoristaBottomNav SHALL manter o slot "Marketplace" apontando para o Marketplace_Feed.
5. THE FreteGO SHALL prover, a partir do app do embarcador, um ponto de entrada para o Marketplace_Feed.

### Requirement 2: Publicação de anúncio — formulário

**User Story:** Como usuário logado, quero abrir um formulário de publicação ao tocar em
"Publicar", para criar um anúncio com título, descrição e fotos.

#### Acceptance Criteria

1. WHEN o usuário toca no botão "Publicar" no Marketplace, THE FreteGO SHALL abrir o formulário de publicação de Marketplace_Post.
2. THE formulário de publicação SHALL conter um campo "Título", um campo "Descrição" e um controle para adicionar fotos.
3. THE formulário de publicação SHALL permitir escolher o Post_Type entre `venda` (com valor) e `noticia` (sem valor).
4. WHERE o Post_Type é `venda`, THE formulário SHALL exibir um campo opcional "Valor".
5. WHEN o usuário confirma a publicação com dados válidos e Post_Location válida, THE FreteGO SHALL criar o Marketplace_Post e exibi-lo no Marketplace_Feed.
6. WHEN o formulário é submetido com dados inválidos, THE FreteGO SHALL bloquear o envio E exibir mensagem de erro em pt-BR indicando o campo ofensor.

### Requirement 3: Validação do conteúdo do anúncio (frontend e backend)

**User Story:** Como dono do FreteGO, quero validar título, descrição, valor e fotos no frontend e
no backend, para não publicar anúncios malformados.

#### Acceptance Criteria

1. THE FreteGO SHALL validar, no frontend e no backend, que o "Título" tem entre 1 e 120 caracteres após sanitização (trim).
2. THE FreteGO SHALL validar, no frontend e no backend, que a "Descrição" tem entre 0 e 2000 caracteres após sanitização.
3. WHERE o Post_Price é informado, THE FreteGO SHALL validar, no frontend e no backend, que é numérico e maior que zero.
4. WHERE o Post_Type é `noticia`, THE FreteGO SHALL gravar o Post_Price como ausente (nulo).
5. THE FreteGO SHALL exigir ao menos 1 foto e no máximo 10 fotos por Marketplace_Post.
6. THE FreteGO SHALL aceitar apenas imagens com tipo MIME em { image/jpeg, image/png, image/webp, image/gif } e tamanho de até 5 MB por foto.
7. IF uma foto enviada tem MIME inválido, THEN THE FreteGO SHALL recusar o upload com o error code `INVALID_FILE_TYPE` e exibir mensagem em pt-BR.
8. IF o usuário tenta adicionar mais de 10 fotos, THEN THE FreteGO SHALL bloquear o excedente E exibir mensagem em pt-BR informando o limite de 10 fotos.
9. WHEN o formulário é submetido inválido, THE FreteGO SHALL bloquear o envio E exibir uma mensagem de erro em pt-BR (ambos: bloqueio E mensagem).

### Requirement 4: Localização obrigatória e forçada

**User Story:** Como dono do FreteGO, quero que todo anúncio tenha a localização do anunciante,
puxada automaticamente, e que não seja possível publicar sem localização, para situar cada
anúncio numa região.

#### Acceptance Criteria

1. WHEN o usuário abre o formulário de publicação, THE FreteGO SHALL tentar obter automaticamente a localização atual do dispositivo (Capacitor_Geolocation no app nativo; geolocalização do navegador na web).
2. WHEN a localização é obtida com sucesso, THE FreteGO SHALL associar a Post_Location (ponto geográfico) e o rótulo legível (ex.: cidade/UF) ao anúncio em preparação.
3. IF a permissão de localização está negada, indisponível ou em contexto inseguro, THEN THE FreteGO SHALL exibir uma orientação em pt-BR para ativar a localização e SHALL oferecer uma ação para tentar novamente.
4. WHILE não há Post_Location válida, THE FreteGO SHALL manter o botão "Publicar" desabilitado.
5. WHEN o usuário tenta publicar sem Post_Location válida, THE FreteGO SHALL bloquear a publicação com o error code `LOCATION_REQUIRED` e exibir mensagem em pt-BR.
6. THE FreteGO SHALL persistir a Post_Location como ponto geográfico (latitude/longitude) e um rótulo de localização legível junto ao Marketplace_Post.

### Requirement 5: Upload e armazenamento das fotos

**User Story:** Como usuário logado, quero anexar minhas fotos ao anúncio, para mostrar o item que
estou anunciando.

#### Acceptance Criteria

1. WHEN o usuário adiciona fotos válidas, THE FreteGO SHALL enviá-las ao Marketplace_Bucket em caminhos prefixados pelo id do autor (`<author_id>/...`).
2. THE FreteGO SHALL preservar a ordem das fotos escolhida pelo usuário, definindo a foto de índice 0 como Primeira_Foto.
3. WHEN o Marketplace_Post é criado, THE FreteGO SHALL persistir as referências (paths) das fotos associadas ao anúncio.
4. IF a gravação do Marketplace_Post no banco falha após o upload das fotos, THEN THE FreteGO SHALL remover do Storage as fotos já enviadas (rollback), evitando arquivos órfãos.
5. THE FreteGO SHALL servir as fotos publicadas por meio de URLs públicas do Marketplace_Bucket para exibição no feed e no detalhe.

### Requirement 6: Marketplace Feed (lista de anúncios)

**User Story:** Como usuário logado, quero ver no feed os anúncios de outros usuários com a foto
principal, valor e título, para descobrir itens próximos.

#### Acceptance Criteria

1. THE Marketplace_Feed SHALL exibir a localização atual do usuário navegante no topo (cidade), reaproveitando `useEffectiveLocation`.
2. THE Marketplace_Feed SHALL listar os Marketplace_Posts com Post_Status `ativo`, ordenados por `created_at` decrescente por padrão.
3. THE Feed_Card SHALL exibir a Primeira_Foto do anúncio.
4. WHERE o anúncio tem Post_Price, THE Feed_Card SHALL exibir o valor formatado em BRL junto ao título; WHERE não há Post_Price, THE Feed_Card SHALL exibir apenas o título.
5. THE Feed_Card SHALL exibir a descrição truncada em no máximo 2 linhas, sem quebrar o layout.
6. THE Feed_Card SHALL exibir a Author_Identity (foto + nome) do Post_Author.
7. WHEN não há nenhum Marketplace_Post ativo, THE Marketplace_Feed SHALL exibir um estado vazio amigável em pt-BR.
8. WHEN o viewport tem largura inferior a 768px, THE Marketplace_Feed SHALL renderizar os itens em uma lista adaptada a telas pequenas.

### Requirement 7: Detalhe do anúncio

**User Story:** Como usuário logado, quero abrir um anúncio para ver as fotos maiores, o valor, há
quanto tempo foi anunciado, a localização e a descrição completa.

#### Acceptance Criteria

1. WHEN o usuário toca em um Feed_Card, THE FreteGO SHALL abrir o Post_Detail do Marketplace_Post correspondente.
2. THE Post_Detail SHALL exibir as Post_Photos do anúncio (galeria).
3. THE Post_Detail SHALL exibir a Author_Identity (foto + nome) do Post_Author.
4. WHERE o anúncio tem Post_Price, THE Post_Detail SHALL exibir o valor formatado em BRL.
5. THE Post_Detail SHALL exibir a Relative_Age do anúncio em pt-BR (ex.: "anunciado há 4 dias").
6. THE Post_Detail SHALL exibir o rótulo da Post_Location do anúncio.
7. THE Post_Detail SHALL exibir a descrição completa do anúncio.
8. WHEN o id do anúncio não existe ou o anúncio não está ativo, THE Post_Detail SHALL exibir um estado de "anúncio indisponível" em pt-BR.

### Requirement 8: Galeria de fotos estilo Facebook (colagem + lightbox)

**User Story:** Como usuário logado, quero ver as fotos do anúncio numa colagem (sem ficar uma
lista enorme) e poder ampliá-las em tela cheia, para visualizar bem cada imagem.

#### Acceptance Criteria

1. THE Photo_Collage SHALL exibir no máximo 4 quadros, independentemente da quantidade de fotos do anúncio.
2. WHERE o anúncio tem mais de 4 fotos, THE Photo_Collage SHALL exibir no 4º quadro um overlay "+N", onde N é a quantidade de fotos não exibidas (total − 4).
3. THE Photo_Collage SHALL adaptar o arranjo dos quadros conforme a quantidade de fotos (1, 2, 3 ou 4+).
4. WHEN o usuário toca em um quadro da Photo_Collage, THE FreteGO SHALL abrir o Photo_Lightbox na foto correspondente.
5. THE Photo_Lightbox SHALL permitir navegar entre as fotos passando para o lado (carrossel).
6. THE Photo_Lightbox SHALL exibir um contador no formato "X de N".
7. WHEN o usuário toca em uma foto no Photo_Lightbox, THE FreteGO SHALL ampliá-la para melhor visualização.
8. THE Photo_Lightbox SHALL exibir um botão de voltar/fechar que retorna ao Post_Detail.

### Requirement 9: Identidade do autor em todo anúncio

**User Story:** Como usuário logado, quero ver sempre a foto e o nome de quem publicou, para saber
de quem é o anúncio.

#### Acceptance Criteria

1. THE FreteGO SHALL exibir a Author_Identity (foto + nome) em todo Feed_Card e em todo Post_Detail.
2. THE FreteGO SHALL resolver a foto do autor a partir de `users.profile_photo_url` via `resolveProfilePhotoUrl`.
3. WHERE o autor não tem foto de perfil, THE FreteGO SHALL exibir um avatar padrão (placeholder) com as iniciais ou ícone, sem quebrar o layout.
4. THE Author_Identity SHALL ser, nesta versão, apenas exibição (sem ação de navegação ao tocar).

### Requirement 10: Autoria, isolamento e segurança (RLS)

**User Story:** Como dono do FreteGO, quero que cada usuário só consiga publicar como ele mesmo e
gerenciar apenas os próprios anúncios, para impedir acesso cruzado entre usuários.

#### Acceptance Criteria

1. WHEN um Marketplace_Post é criado, THE FreteGO SHALL gravar o `author_id` igual ao `auth.uid()` do usuário autenticado.
2. THE FreteGO SHALL impedir, via Owner_Scoped_RLS, que um usuário crie um Marketplace_Post em nome de outro usuário (`author_id` diferente de `auth.uid()`).
3. THE FreteGO SHALL impedir, via Owner_Scoped_RLS, que um usuário edite ou remova um Marketplace_Post que não seja dele.
4. THE FreteGO SHALL impedir, via Owner_Scoped_RLS no Storage, que um usuário envie/remova arquivos fora do seu próprio prefixo de caminho (`<author_id>/...`).
5. IF `auth.uid()` está ausente em uma operação de escrita do Marketplace, THEN THE FreteGO SHALL recusar a operação.
6. THE FreteGO SHALL expor a leitura do Marketplace_Feed e do Post_Detail apenas a usuários autenticados.
7. THE FreteGO SHALL nunca expor, em respostas, logs ou traces, dados sensíveis do autor além de nome e foto pública.

### Requirement 11: Remoção do anúncio (dono e moderação admin)

**User Story:** Como usuário, quero poder remover meu próprio anúncio; e como admin, quero poder
remover anúncios abusivos, para manter o Marketplace limpo.

#### Acceptance Criteria

1. THE FreteGO SHALL permitir que o Post_Author remova o próprio Marketplace_Post, alterando o Post_Status para `removido`.
2. WHEN um Marketplace_Post é removido, THE FreteGO SHALL ocultá-lo do Marketplace_Feed e do Post_Detail para os demais usuários.
3. THE FreteGO SHALL permitir que um admin com permissão execute a Marketplace_Moderation (remoção) de qualquer Marketplace_Post.
4. WHEN o admin executa a Marketplace_Moderation, THE FreteGO SHALL registrar a ação via `executeAdminMutation` com action `MARKETPLACE_POST_REMOVED`, conforme `admin-patterns.md`.
5. WHEN um acesso administrativo à Marketplace_Moderation ocorre sem a permissão requerida, THE FreteGO SHALL recusar a operação com erro `permission_denied`.

### Requirement 12: Migration e não-regressão

**User Story:** Como dono do FreteGO, quero que a infraestrutura do Marketplace seja adicionada de
forma segura e reversível, sem quebrar o que já existe.

#### Acceptance Criteria

1. THE FreteGO SHALL criar a tabela `marketplace_posts` e o Marketplace_Bucket por meio de uma migration idempotente, acompanhada de um par `_rollback`, com numeração incremental a partir de 122.
2. THE migration SHALL incluir validações defensivas (`DO $check$`) e CHECKs de domínio (Post_Type, faixas de tamanho, quantidade de fotos, valor não negativo) conforme o padrão do projeto.
3. THE FreteGO SHALL preservar o funcionamento atual de motorista/embarcador (feed de fretes, navegação, perfil) sem regressão após a introdução do Marketplace.
4. THE casca existente do Marketplace (`MarketplacePage`, rota e slot na `MotoristaBottomNav`) SHALL ser reaproveitada, não duplicada.

### Requirement 13: Escopo futuro (NÃO implementar agora)

**User Story:** Como dono do FreteGO, quero registrar o que fica para depois, para deixar claro o
recorte do MVP.

#### Acceptance Criteria

1. THE FreteGO SHALL tratar o envio de mensagem/contato entre interessado e anunciante como escopo futuro, fora desta spec.
2. THE FreteGO SHALL tratar a busca e as categorias funcionais do feed como escopo futuro (a UI pode existir como casca, sem comportamento de filtragem nesta entrega).
3. THE FreteGO SHALL tratar a edição de um anúncio já publicado como escopo futuro (o MVP cobre criar, visualizar e remover).
4. WHERE qualquer item de escopo futuro vier a ser implementado, THE FreteGO SHALL fazê-lo em spec/entrega posterior, sem bloquear o MVP.

## Notas de Governança de Testes

Conforme `testing-governance.md`, as seguintes invariantes são candidatas obrigatórias a
property-based testing (detalhadas como Correctness Properties no `design.md`). PBT só se aplica
ao núcleo puro (funções determinísticas); RLS, RPCs, Storage, geolocalização e UI vão para
unit/integration/component tests.

- **Photo_Collage determinística**: para qualquer quantidade de fotos `n` (1..10), a colagem
  mostra `min(n, 4)` quadros e o overlay vale `max(0, n − 4)`; o índice tocado sempre mapeia para
  uma foto válida.
- **Validação de anúncio completa e determinística**: o input é válido se e somente se título
  (1..120), descrição (0..2000), valor (ausente ou > 0), 1..10 fotos com MIME/limite válidos e
  Post_Location presente; cada violação aponta o campo ofensor; revalidar dá o mesmo resultado.
- **Relative_Age monotônica e não-negativa**: para qualquer `created_at <= now`, a idade é
  não-negativa, monotônica em relação a `now` e produz o rótulo pt-BR correto nas fronteiras
  (hoje / há 1 dia / há N dias).
- **Formatação BRL estável**: `formatBRL` é determinística, agrupa milhares no padrão pt-BR e
  trata corretamente inteiros e centavos.
- **Caminhos negativos obrigatórios**: MIME inválido ⇒ `INVALID_FILE_TYPE`; > 10 fotos ⇒
  bloqueio; publicação sem localização ⇒ `LOCATION_REQUIRED`; criação como outro usuário ⇒
  negada por RLS (acesso cruzado impedido).
