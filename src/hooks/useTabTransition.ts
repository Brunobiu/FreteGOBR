/**
 * useTabTransition — direção de slide para a transição entre as abas da barra
 * inferior do motorista (estilo PageView).
 *
 * Como cada aba é uma rota/página independente (monta do zero ao navegar),
 * guardamos o ÍNDICE da última aba visitada em sessionStorage. Ao montar uma
 * página, comparamos o índice atual com o anterior:
 *   - índice maior  → navegou para a direita → entra da direita ('right')
 *   - índice menor  → voltou para a esquerda → entra da esquerda ('left')
 *   - igual/sem histórico → sem animação ('none')
 *
 * A navegação real continua sendo feita pelo react-router (sem manter duas
 * telas montadas), o que evita qualquer risco de vazamento de DOM/portal.
 */

import { useLocation } from 'react-router-dom';
import { useState } from 'react';

// Ordem das abas, da esquerda para a direita, espelhando o MotoristaBottomNav.
// O índice é usado só para decidir a direção do slide.
const TAB_ORDER: { match: (path: string) => boolean }[] = [
  { match: (p) => p === '/' }, // Início
  { match: (p) => p.startsWith('/motorista/mapa') }, // Mapa
  { match: (p) => p.startsWith('/motorista/tabela-antt') }, // ANTT
  { match: (p) => p.startsWith('/motorista/marketplace') }, // Marketplace
  {
    match: (p) =>
      p.startsWith('/motorista/menu') ||
      p.startsWith('/motorista/perfil') ||
      p.startsWith('/motorista/veiculo') ||
      p.startsWith('/motorista/tracao') ||
      p.startsWith('/motorista/carroceria') ||
      p.startsWith('/motorista/complemento') ||
      p.startsWith('/motorista/referencias') ||
      p.startsWith('/motorista/contrato') ||
      p.startsWith('/tutorial'),
  }, // Menu (e telas acessadas por ele)
];

const STORAGE_KEY = 'fretego_last_tab_index';

export type SlideDirection = 'left' | 'right' | 'none';

function tabIndexFor(path: string): number {
  return TAB_ORDER.findIndex((t) => t.match(path));
}

/**
 * Retorna a classe CSS de slide a aplicar no container de conteúdo da página
 * atual, com base na aba anterior. Atualiza o histórico de aba ao ser chamado.
 */
export function useTabSlideClass(): string {
  const { pathname } = useLocation();

  // Calcula a direção UMA vez por montagem (lazy initializer), evitando
  // recalcular/regravar em re-renders subsequentes da mesma página.
  const [slideClass] = useState<string>(() => {
    const current = tabIndexFor(pathname);
    if (current < 0) return '';

    let direction: SlideDirection = 'none';
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const prev = raw === null ? null : Number(raw);
      if (prev !== null && !Number.isNaN(prev) && prev !== current) {
        direction = current > prev ? 'right' : 'left';
      }
      sessionStorage.setItem(STORAGE_KEY, String(current));
    } catch {
      // sessionStorage indisponível: segue sem animação.
    }

    if (direction === 'right') return 'page-slide-right';
    if (direction === 'left') return 'page-slide-left';
    return '';
  });

  return slideClass;
}
