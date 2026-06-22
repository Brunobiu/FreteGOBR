/**
 * MarketplacePhotoCollage — apresentação das fotos no estilo Facebook.
 *
 * Mostra no máximo 4 quadros (computeCollageLayout). Com mais de 4 fotos, o
 * último quadro recebe um overlay "+N". Tocar em um quadro abre o lightbox na
 * foto correspondente.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 */

import { computeCollageLayout } from '../../utils/marketplaceCollage';

interface Props {
  photoUrls: string[];
  onOpen: (index: number) => void;
}

function gridClass(variant: 1 | 2 | 3 | 4): string {
  return variant === 1 ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-1';
}

function tileClass(variant: 1 | 2 | 3 | 4, tileIndex: number): string {
  if (variant === 1) return 'aspect-video';
  if (variant === 3 && tileIndex === 0) return 'col-span-2 aspect-video';
  return 'aspect-square';
}

export default function MarketplacePhotoCollage({ photoUrls, onOpen }: Props) {
  if (photoUrls.length === 0) {
    return (
      <div className="aspect-video w-full bg-gray-100 flex items-center justify-center text-gray-300">
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16v12H4z"
          />
        </svg>
      </div>
    );
  }

  const layout = computeCollageLayout(photoUrls.length);

  return (
    <div className={`${gridClass(layout.variant)} rounded-xl overflow-hidden bg-white`}>
      {layout.tiles.map((tile, i) => {
        const url = photoUrls[tile.photoIndex];
        const showOverlay = tile.overlayCount > 0;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onOpen(tile.photoIndex)}
            className={`relative overflow-hidden bg-gray-100 ${tileClass(layout.variant, i)}`}
            aria-label={`Ver foto ${tile.photoIndex + 1}`}
          >
            <img
              src={url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
            {showOverlay && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <span className="text-white text-2xl font-semibold">+{tile.overlayCount}</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
