# Marketplace — documentação técnica

Vitrine de anúncios entre usuários do FreteGO (motoristas e embarcadores), no
estilo do Marketplace do Facebook. Qualquer usuário autenticado publica um
anúncio (`venda` ou `noticia`) com título, descrição, de 1 a 10 fotos e a sua
localização (obrigatória). Os anúncios aparecem num feed e podem ser abertos num
detalhe com galeria (colagem + lightbox).

Spec: `.kiro/specs/marketplace/{requirements,design,tasks}.md`.

## Modelo de dados (migrations 122 + 123)

Tabela `marketplace_posts`:

| Coluna | Tipo | Observações |
| --- | --- | --- |
| `id` | uuid PK | |
| `author_id` | uuid NOT NULL → `users(id)` | dono do anúncio (`auth.uid()`) |
| `post_type` | text | `venda` \| `noticia` (CHECK). A UI publica sempre `venda`; `noticia` fica no schema por compatibilidade, sem uso atual. |
| `title` | text | 1..30 após trim. A 122 cria o teto 1..120; a 123 reforça 1..30 (regra de produto). |
| `description` | text | 0..2000 (CHECK) |
| `price` | numeric(12,2) NULL | **obrigatório** no app, `> 0`. (No schema é nullable por compat; a UI sempre envia um valor.) |
| `photo_paths` | text[] | 1..10 itens, sem NULL (CHECK) |
| `location` | geography(POINT) NOT NULL | obrigatória; gravada como `POINT(lng lat)` |
| `location_label` | text | rótulo legível (ex.: "Indiara, GO") |
| `status` | text | `ativo` \| `removido` (soft-delete) |
| `created_at` / `updated_at` | timestamptz | trigger atualiza `updated_at` |

Índices: feed parcial (`status='ativo'` por `created_at` desc), por autor, e
GiST de `location` (para busca por proximidade — escopo futuro).

Bucket de Storage `marketplace_photos` (público, 5 MiB, `image/jpeg|png|webp|gif`).
Leitura pública (serve `getPublicUrl`); escrita/edição/remoção só no prefixo do
dono (`<auth.uid()>/...`).

## Autorização (RLS owner-scoped)

Conteúdo de usuário — a escrita é autorizada por RLS de dono, não por permissão
admin:

- **SELECT**: só autenticados; `status='ativo'` para todos, o dono vê os próprios
  (inclusive `removido`), admin vê tudo. `anon` não lê.
- **INSERT**: `author_id = auth.uid()` e `status='ativo'` (não dá para publicar
  como outro usuário).
- **UPDATE/DELETE**: só o dono (`author_id = auth.uid()`).
- **Storage**: INSERT/UPDATE/DELETE só no prefixo `<auth.uid()>/`.

RPCs `SECURITY DEFINER` (gated a `authenticated`):

- `marketplace_list_posts(p_limit, p_offset)` — feed paginado + nome/foto do autor
  (join controlado, sem expor a tabela `users`).
- `marketplace_get_post(p_id)` — detalhe (ativo ou do próprio autor).
- `marketplace_remove_post(p_id)` — **moderação admin**: exige `USER_EDIT`; na
  falta, grava `MARKETPLACE_VIEW_DENIED` em `admin_audit_logs` e recusa com
  `permission_denied`.

## Fluxo de publicação

1. O usuário toca em **Publicar** → abre o `MarketplacePublishSheet`.
2. Escolhe o tipo (à venda / notícia), preenche título, valor (só venda) e
   descrição, e adiciona até 10 fotos (câmera ou galeria).
3. A **localização é obrigatória e forçada**: o `MarketplaceLocationGate` tenta
   obter a posição (Capacitor nativo + web). Sem localização válida, o botão
   **Publicar** fica desabilitado (`LOCATION_REQUIRED`).
4. Ao publicar, `createMarketplacePost` valida (núcleo puro), sobe as fotos no
   bucket (`<userId>/<ts>_<rand>.<ext>`) e insere a linha. Se a inserção falhar
   após o upload, as fotos órfãs são removidas (rollback).

## Validação (frontend e backend)

`validateMarketplacePostInput` (em `src/utils/marketplacePost.ts`) é a fonte única
de verdade no frontend; a tabela replica as regras em CHECKs no backend:

- título 1..30 (após trim), descrição 0..2000;
- `price` **obrigatório** e `> 0`;
- 1..10 fotos, cada uma com MIME ∈ {jpeg, png, webp, gif} e ≤ 5 MB;
- localização presente.

Mensagens canônicas em pt-BR via `marketplaceMessage(code)`.

O formulário de publicação tem só os campos: título (máx. 30), valor
(obrigatório, com máscara "R$" e separador de milhar), descrição (máx. 2000) e
fotos. Não há mais o seletor "À venda / Notícia". As fotos podem ser escolhidas
em **lote pela galeria** (seleção múltipla) ou pela câmera (uma por vez).

## Apresentação das fotos

- **Feed** (`MarketplaceFeedCard`): primeira foto + valor (quando houver) +
  título + descrição truncada (2 linhas) + foto/nome do autor.
- **Detalhe** (`MarketplacePostDetailPage`): `MarketplacePhotoCollage` mostra até
  4 quadros (overlay "+N" quando há mais de 4 — `computeCollageLayout`); tocar
  abre o `MarketplaceLightbox` (carrossel em tela cheia, contador "X de N",
  ampliar ao tocar, botão voltar).

## Remoção

- **Dono**: botão "Remover anúncio" no detalhe → `deleteMarketplacePost` (UPDATE
  `status='removido'`, autorizado pela RLS de dono).
- **Admin (moderação)**: `removeMarketplacePost` (`src/services/admin/marketplace.ts`)
  envolve a RPC `marketplace_remove_post` em `executeAdminMutation` (action
  `MARKETPLACE_POST_REMOVED`).

## Acesso (rota)

A feature vive em `/motorista/marketplace` (feed) e `/motorista/marketplace/:id`
(detalhe). O backend já aceita qualquer usuário autenticado (motorista e
embarcador); a exposição de um ponto de entrada para o embarcador é um ajuste de
UI a fazer (Decisão D1 do design).

## Escopo futuro (não implementado)

- Envio de mensagem/contato ao anunciante.
- Busca e categorias funcionais do feed (a UI existe como casca).
- Edição de anúncio publicado.
- Recomendação/ordenação e filtro por proximidade (índice GiST já preparado).
