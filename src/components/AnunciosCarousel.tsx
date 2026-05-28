import { useState, useEffect, useRef, useCallback } from 'react';
import { listActiveAnuncios, type Anuncio } from '../services/anuncios';

const AUTO_SLIDE_MS = 3000;
const PAUSE_AFTER_INTERACTION_MS = 10000;

/**
 * Carrossel de anuncios exibido entre o mapa e a listagem de fretes.
 * - Auto-passa a cada 3s
 * - Pausa por 10s apos interacao do usuario (swipe ou clique)
 * - Suporta swipe touch + click (abre link em nova aba)
 */
export default function AnunciosCarousel() {
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const pauseTimerRef = useRef<number | null>(null);

  // Carrega anuncios ativos
  useEffect(() => {
    let cancelled = false;
    listActiveAnuncios()
      .then((list) => {
        if (!cancelled) setAnuncios(list);
      })
      .catch(() => {
        if (!cancelled) setAnuncios([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pausa temporaria apos interacao
  const triggerPause = useCallback(() => {
    setIsPaused(true);
    if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = window.setTimeout(() => {
      setIsPaused(false);
    }, PAUSE_AFTER_INTERACTION_MS);
  }, []);

  // Auto-slide
  useEffect(() => {
    if (anuncios.length <= 1 || isPaused) return;
    const id = window.setInterval(() => {
      setCurrentIndex((i) => (i + 1) % anuncios.length);
    }, AUTO_SLIDE_MS);
    return () => window.clearInterval(id);
  }, [anuncios.length, isPaused]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current);
    };
  }, []);

  // Handlers de touch para swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    triggerPause();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const threshold = 50;
    if (Math.abs(deltaX) > threshold) {
      if (deltaX < 0) {
        // swipe esquerda -> proximo
        setCurrentIndex((i) => (i + 1) % anuncios.length);
      } else {
        // swipe direita -> anterior
        setCurrentIndex((i) => (i - 1 + anuncios.length) % anuncios.length);
      }
    }
    touchStartX.current = null;
  };

  const handleClick = (anuncio: Anuncio) => {
    triggerPause();
    if (anuncio.linkUrl) {
      window.open(anuncio.linkUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const goToIndex = (idx: number) => {
    setCurrentIndex(idx);
    triggerPause();
  };

  if (anuncios.length === 0) return null;

  // Largura de cada slide em % e gap entre eles
  // 85% = slide principal, sobrando 15% pra mostrar o proximo "peek"
  const SLIDE_WIDTH_PCT = 85;
  const GAP_PCT = 2;

  return (
    <div className="mb-4">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseEnter={triggerPause}
      >
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{
            transform: `translateX(-${currentIndex * (SLIDE_WIDTH_PCT + GAP_PCT)}%)`,
            gap: `${GAP_PCT}%`,
          }}
        >
          {anuncios.map((anuncio) => (
            <button
              key={anuncio.id}
              type="button"
              onClick={() => handleClick(anuncio)}
              className="flex-shrink-0 cursor-pointer rounded-xl overflow-hidden shadow-md"
              style={{ width: `${SLIDE_WIDTH_PCT}%` }}
              aria-label={anuncio.name}
            >
              <img
                src={anuncio.imageUrl}
                alt={anuncio.name}
                className="w-full h-auto aspect-[16/7] sm:aspect-[21/8] object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>

        {/* Indicadores (bolinhas) */}
        {anuncios.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-2">
            {anuncios.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => goToIndex(idx)}
                className={`h-1.5 rounded-full transition-all ${
                  idx === currentIndex ? 'bg-green-500 w-4' : 'bg-gray-300 w-1.5'
                }`}
                aria-label={`Ir para anuncio ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
