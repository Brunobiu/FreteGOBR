/**
 * DeferUntilVisible
 *
 * Adia a montagem de `children` até que o elemento se aproxime da viewport,
 * usando `IntersectionObserver`. Enquanto não visível, renderiza um placeholder
 * dimensionado que reserva o espaço, evitando deslocamento de layout (layout shift).
 *
 * Fail-safe: quando `IntersectionObserver` não está disponível (ex.: SSR ou
 * ambiente sem suporte), os `children` são montados imediatamente.
 *
 * Requirements: 8.1 (adiar conteúdo abaixo da dobra), 8.4 (preservar layout/dimensões).
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface DeferUntilVisibleProps {
  /** Conteúdo montado quando o elemento se aproxima da viewport. */
  children: ReactNode;
  /**
   * Margem aplicada ao redor da viewport para antecipar a montagem.
   * Default `'200px'`: começa a montar antes de o elemento entrar na tela.
   */
  rootMargin?: string;
  /** Placeholder customizado exibido enquanto o conteúdo não foi montado. */
  placeholder?: ReactNode;
  /**
   * Altura mínima reservada para o placeholder, evitando layout shift.
   * Aceita number (px) ou string CSS. Ignorado quando `placeholder` é fornecido.
   */
  minHeight?: number | string;
  /** Estilos extras aplicados ao container wrapper. */
  style?: CSSProperties;
  /** Classe CSS aplicada ao container wrapper. */
  className?: string;
}

function supportsIntersectionObserver(): boolean {
  return typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'undefined';
}

export default function DeferUntilVisible({
  children,
  rootMargin = '200px',
  placeholder,
  minHeight,
  style,
  className,
}: DeferUntilVisibleProps) {
  // Fail-safe: sem IntersectionObserver, monta imediatamente.
  const [isVisible, setIsVisible] = useState<boolean>(() => !supportsIntersectionObserver());
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isVisible) return;
    if (!supportsIntersectionObserver()) {
      setIsVisible(true);
      return;
    }

    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin }
    );

    observer.observe(node);

    // Cleanup no unmount (ou se rootMargin mudar).
    return () => observer.disconnect();
  }, [isVisible, rootMargin]);

  if (isVisible) {
    return <>{children}</>;
  }

  const reservedStyle: CSSProperties = {
    minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
    ...style,
  };

  return (
    <div ref={containerRef} className={className} style={reservedStyle} aria-hidden="true">
      {placeholder}
    </div>
  );
}
