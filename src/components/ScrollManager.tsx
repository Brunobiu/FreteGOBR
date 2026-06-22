/**
 * ScrollManager — restauração de scroll na navegação SPA.
 *
 * Comportamento:
 *   - Avançar para uma página nova (PUSH/REPLACE): rola pro TOPO. Assim páginas
 *     como /saiba/:slug e /para-embarcadores começam do início, não no meio
 *     (antes a posição de scroll vazava da landing pra página de destino).
 *   - Voltar/avançar pelo histórico (POP): RESTAURA a posição onde o usuário
 *     estava. Assim, ao voltar da página de detalhe pra landing, ele cai no
 *     mesmo ponto de onde clicou, e continua de onde parou.
 *
 * Mantém um mapa posição-por-`location.key` em memória. Desliga a restauração
 * automática do browser (scrollRestoration='manual') pra controlar tudo aqui e
 * evitar conflito. Renderiza `null` — é só efeito colateral. Deve ficar dentro
 * do Router (usa useLocation/useNavigationType).
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export default function ScrollManager() {
  const location = useLocation();
  const navType = useNavigationType(); // 'POP' | 'PUSH' | 'REPLACE'
  const positions = useRef<Map<string, number>>(new Map());

  // Assume o controle do scroll (o browser não restaura sozinho).
  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return;
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = prev;
    };
  }, []);

  // Salva continuamente a posição da rota atual (e também ao sair dela).
  useEffect(() => {
    const key = location.key;
    const map = positions.current;
    const save = () => map.set(key, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      map.set(key, window.scrollY);
      window.removeEventListener('scroll', save);
    };
  }, [location.key]);

  // Ao trocar de rota: POP restaura a posição salva; senão vai pro topo.
  // useLayoutEffect evita o "flash" de pular antes da pintura.
  useLayoutEffect(() => {
    if (navType === 'POP') {
      const y = positions.current.get(location.key) ?? 0;
      window.scrollTo(0, y);
    } else {
      window.scrollTo(0, 0);
    }
    // navType muda junto com location.key; basta depender da key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  return null;
}
