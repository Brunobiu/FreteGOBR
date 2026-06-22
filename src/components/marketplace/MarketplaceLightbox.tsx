/**
 * MarketplaceLightbox — galeria em tela cheia.
 *
 * Carrossel touch-swipe das fotos do anúncio, com contador "X de N", toque para
 * ampliar (contain ↔ cover) e botão de voltar. Trava o scroll do body enquanto
 * aberto; setas/Esc no teclado para navegar/fechar.
 *
 * Validates: Requirements 8.5, 8.6, 8.7, 8.8
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  photoUrls: string[];
  startIndex: number;
  onClose: () => void;
}

export default function MarketplaceLightbox({ photoUrls, startIndex, onClose }: Props) {
  const total = photoUrls.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(total - 1, 0)));
  const [zoomed, setZoomed] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const go = (next: number) => {
    setZoomed(false);
    setIndex((prev) => {
      const target = prev + next;
      if (target < 0) return 0;
      if (target > total - 1) return total - 1;
      return target;
    });
  };

  // Trava o scroll do body enquanto o lightbox está aberto.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Teclado: setas navegam, Esc fecha.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 50) go(delta < 0 ? 1 : -1);
    touchStartX.current = null;
  };

  if (total === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" role="dialog" aria-modal="true">
      {/* Barra superior */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
          aria-label="Voltar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium">
          {index + 1} de {total}
        </span>
        <span className="w-9" aria-hidden="true" />
      </div>

      {/* Imagem */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={photoUrls[index]}
          alt={`Foto ${index + 1} de ${total}`}
          onClick={() => setZoomed((z) => !z)}
          className={
            zoomed
              ? 'w-full h-full object-cover cursor-zoom-out'
              : 'max-w-full max-h-full object-contain cursor-zoom-in'
          }
          draggable={false}
        />
      </div>

      {/* Navegação (desktop) */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-30"
            aria-label="Foto anterior"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={index === total - 1}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-30"
            aria-label="Próxima foto"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
