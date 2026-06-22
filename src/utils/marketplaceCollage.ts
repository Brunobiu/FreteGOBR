/**
 * Marketplace — layout puro da Photo_Collage (estilo Facebook).
 *
 * Decide quantos quadros exibir e o overlay "+N" a partir da quantidade de
 * fotos do anúncio, sem nenhum I/O. É a base testável (Property 1) do
 * componente MarketplacePhotoCollage: em vez de empilhar todas as fotos,
 * mostra no máximo 4 quadros e, quando há mais, sinaliza o restante no último.
 *
 * Validates: Requirements 8.1, 8.2, 8.3
 */

export const COLLAGE_MAX_TILES = 4;

export interface CollageTile {
  /** Índice da foto (0-based) que este quadro exibe. */
  photoIndex: number;
  /** Fotos ocultas indicadas neste quadro ("+N"); 0 exceto no último quadro. */
  overlayCount: number;
}

export interface CollageLayout {
  /** Quadros exibidos = min(photoCount, COLLAGE_MAX_TILES). */
  tiles: CollageTile[];
  /** Fotos não exibidas = max(0, photoCount - COLLAGE_MAX_TILES). */
  overlayCount: number;
  /** Dica de arranjo para o CSS: 1 | 2 | 3 | 4 (4 cobre 4+ fotos). */
  variant: 1 | 2 | 3 | 4;
}

/**
 * Layout determinístico da colagem a partir da quantidade de fotos.
 *
 * Invariantes (Property 1):
 *  - `tiles.length === min(count, 4)`, onde `count = max(0, floor(photoCount))`;
 *  - `overlayCount === max(0, count - 4)`;
 *  - todo `tile.photoIndex` ∈ `[0, count)`, distintos e crescentes a partir de 0;
 *  - apenas o último quadro pode ter `overlayCount > 0`.
 *
 * Entradas inválidas (NaN, negativas, fracionárias) são saneadas para um
 * `count` inteiro não-negativo — a função nunca lança.
 */
export function computeCollageLayout(photoCount: number): CollageLayout {
  const count = Number.isFinite(photoCount) ? Math.max(0, Math.floor(photoCount)) : 0;
  const tileCount = Math.min(count, COLLAGE_MAX_TILES);
  const overlayCount = Math.max(0, count - COLLAGE_MAX_TILES);

  const tiles: CollageTile[] = [];
  for (let i = 0; i < tileCount; i++) {
    const isLastTile = i === tileCount - 1;
    tiles.push({ photoIndex: i, overlayCount: isLastTile ? overlayCount : 0 });
  }

  const variant = Math.min(Math.max(tileCount, 1), COLLAGE_MAX_TILES) as 1 | 2 | 3 | 4;

  return { tiles, overlayCount, variant };
}
