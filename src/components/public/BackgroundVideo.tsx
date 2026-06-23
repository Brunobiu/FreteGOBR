/**
 * BackgroundVideo — vídeo de fundo decorativo (mudo, autoplay, loop). Reforça
 * o autoplay via ref porque alguns navegadores ignoram o `muted` setado só
 * pelo React e bloqueiam o autoplay; se ainda assim falhar, o elemento fica
 * transparente e o fundo de trás aparece.
 *
 * É puramente visual (aria-hidden). Quem usa controla posição/recorte/desfoque
 * pela `className` (ex.: "absolute inset-0 h-full w-full object-cover blur-[3px]").
 */

import { useEffect, useRef } from 'react';

type BackgroundVideoProps = {
  /** Caminho do vídeo em public/ (ex.: "/ia-hero.mp4"). */
  src: string;
  className?: string;
};

export default function BackgroundVideo({ src, className = '' }: BackgroundVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {
      /* autoplay bloqueado pelo navegador: o fundo de trás permanece */
    });
  }, []);

  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}
