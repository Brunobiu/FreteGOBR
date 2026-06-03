import L from 'leaflet';

/**
 * Tipos e helpers compartilhados para criação de ícones (pinos) no mapa
 * Leaflet do FreteGO. Centraliza o SVG e cores em um único lugar para
 * evitar divergência visual entre `MapaFretes` (modal do feed) e a
 * `MotoristaMapaFullscreen` (rota dedicada).
 */

/** Categorias visuais de pino suportadas. */
export type PinKind = 'frete-ativo' | 'frete-encerrado' | 'destino' | 'motorista';

/**
 * Opacidades suportadas para o pino do mapa.
 * - `1`: pino destacado / em estado normal.
 * - `0.3`: pino com fade (usado quando outro frete está selecionado).
 */
export type PinOpacity = 1 | 0.3;

/**
 * Mapa de cores por kind. As cores espelham as classes Tailwind já em uso
 * no projeto:
 * - `frete-ativo`: green-600 (#16a34a)
 * - `frete-encerrado`: gray-400 (#9ca3af)
 * - `destino`: orange-600 (#ea580c)
 * - `motorista`: blue-600 (#2563eb) — reservado; o helper
 *   `makeMotoristaIcon` renderiza como bolinha verde para distinguir
 *   visualmente o motorista dos pinos de frete.
 */
const PIN_COLORS: Record<PinKind, string> = {
  'frete-ativo': '#16a34a',
  'frete-encerrado': '#9ca3af',
  destino: '#ea580c',
  motorista: '#2563eb',
};

/**
 * Cria um `L.DivIcon` no formato de pino (gota com círculo branco no
 * centro), na cor associada ao `kind`. Suporta opacidade via atributo
 * `opacity` no `<svg>` raiz para permitir o efeito de fade dos demais
 * pinos quando há um frete selecionado.
 *
 * O `iconAnchor` `[9, 22]` garante que a ponta inferior do pino
 * coincida exatamente com a coordenada geográfica.
 */
export function makePinIcon(kind: PinKind, opacity: PinOpacity = 1): L.DivIcon {
  const color = PIN_COLORS[kind];
  const opacityAttr = opacity === 1 ? '' : ` opacity="${opacity}"`;
  return L.divIcon({
    className: `mapa-pin mapa-pin-${kind}`,
    iconSize: [18, 22],
    iconAnchor: [9, 22],
    popupAnchor: [0, -20],
    html: `<svg width="18" height="22" viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg"${opacityAttr}>
      <path fill="${color}" stroke="#ffffff" stroke-width="1.5"
            d="M11 0a11 11 0 0 0-11 11c0 7.5 11 17 11 17s11-9.5 11-17A11 11 0 0 0 11 0z"/>
      <circle cx="11" cy="11" r="4" fill="#ffffff"/>
    </svg>`,
  });
}

/**
 * Cria um `L.DivIcon` para o marcador do motorista: bolinha verde
 * redonda (22×22) com borda branca e halo translúcido — visualmente
 * distinto dos pinos de frete (que têm formato de gota).
 *
 * Renderizado via `<div>` com `border-radius: 50%` e `box-shadow` para
 * o halo (sem SVG). O `iconAnchor` `[11, 11]` centraliza o círculo
 * exatamente sobre a coordenada do motorista.
 */
export function makeMotoristaIcon(): L.DivIcon {
  return L.divIcon({
    className: 'mapa-pin-motorista',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="width:22px;height:22px;border-radius:50%;background:#16a34a;border:3px solid #fff;box-shadow:0 0 0 2px rgba(22,163,74,.35), 0 1px 4px rgba(0,0,0,.4);"></div>`,
  });
}
