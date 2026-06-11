/**
 * RotaTimeline — timeline vertical de origem → destino de um frete.
 *
 * Usado nos modais de detalhe (FreteModal e FreteRetornoModal) para
 * substituir os dois cards lado a lado por uma linha do tempo com bolinhas
 * conectadas (estilo app de transporte), SEM horário.
 *
 * Cada parada mostra:
 *   - a cidade (origem/destino);
 *   - abaixo, o local de carregamento/descarga (detalhe) — quando houver. O
 *     próprio nome do local é o link clicável que abre no Google Maps.
 *
 * Visual: bolinhas brancas neutras com pulso sutil. Entre origem e destino,
 * uma linha CONTÍNUA de vários pontinhos pequenos que "descem" (animação),
 * dando a ideia de trajeto/movimento. Sem container colorido e sem negrito.
 */

import { googleMapsUrl } from '../utils/coordParser';

interface Ponto {
  /** Cidade/título da parada. */
  cidade: string;
  /** Endereço/local (carregamento ou descarga). Opcional. */
  local?: string;
  /** Coordenadas para o link "Abrir no Maps". Opcional. */
  lat?: number;
  lng?: number;
}

interface RotaTimelineProps {
  origem: Ponto;
  destino: Ponto;
  /** Tema escuro: texto claro para uso sobre fundo escuro (card com mapa). */
  dark?: boolean;
}

// Keyframes locais (injetados uma vez).
//  - `rota-flow`: faz os pontinhos da linha descerem (movimento do trajeto).
//  - `rota-pulse`: leve pulso nas bolinhas de origem/destino.
const TIMELINE_STYLE = `
@keyframes rota-flow {
  0% { background-position: center 0; }
  100% { background-position: center 8px; }
}
@keyframes rota-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: 0.85; }
}
.rota-line {
  /* Vários pontinhos pequenos empilhados (radial-gradient repetido). */
  background-image: radial-gradient(circle, rgba(156,163,175,0.95) 1.1px, transparent 1.4px);
  background-size: 100% 8px;
  background-repeat: repeat-y;
  background-position: center 0;
  animation: rota-flow 0.9s linear infinite;
}
.rota-dot { animation: rota-pulse 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .rota-line { animation: none; }
  .rota-dot { animation: none; }
}
`;

/** Bolinha branca neutra com anel de pulso sutil (chama atenção). */
function Dot() {
  return (
    <span className="relative flex items-center justify-center w-2.5 h-2.5 shrink-0">
      <span className="absolute inline-flex w-full h-full rounded-full bg-gray-400/40 rota-dot" />
      <span className="relative inline-flex w-2.5 h-2.5 rounded-full border-2 border-gray-300 bg-white" />
    </span>
  );
}

function Parada({
  ponto,
  dark,
  drawTop,
  drawBottom,
}: {
  ponto: Ponto;
  dark?: boolean;
  /** Desenha o segmento de linha ACIMA da bolinha (liga à parada anterior). */
  drawTop: boolean;
  /** Desenha o segmento de linha ABAIXO da bolinha (liga à próxima parada). */
  drawBottom: boolean;
}) {
  const hasCoords = ponto.lat !== undefined && ponto.lng !== undefined;
  const maps = hasCoords
    ? googleMapsUrl({ latitude: ponto.lat!, longitude: ponto.lng! })
    : undefined;
  return (
    <div className="flex gap-2.5 items-stretch">
      {/* Coluna da linha + bolinha. Os dois segmentos (acima/abaixo) usam a
          MESMA classe pontilhada, então a linha fica contínua de uma bolinha
          à outra — sem buraco. */}
      <div className="flex flex-col items-center w-3 shrink-0">
        <span className={`w-1 flex-1 ${drawTop ? 'rota-line' : 'bg-transparent'}`} />
        <Dot />
        <span className={`w-1 flex-1 ${drawBottom ? 'rota-line' : 'bg-transparent'}`} />
      </div>

      {/* Conteúdo da parada */}
      <div className="min-w-0 flex-1 py-2">
        <p className={`text-sm truncate ${dark ? 'text-white' : 'text-gray-800'}`}>
          {ponto.cidade}
        </p>
        {ponto.local && (
          <p className="text-xs mt-0.5 break-words">
            {maps ? (
              <a
                href={maps}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  dark
                    ? 'text-blue-300 hover:text-blue-200 underline'
                    : 'text-blue-600 hover:text-blue-800 underline'
                }
              >
                {ponto.local}
              </a>
            ) : (
              <span className={dark ? 'text-gray-300' : 'text-gray-500'}>{ponto.local}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export default function RotaTimeline({ origem, destino, dark }: RotaTimelineProps) {
  return (
    <div className="py-1">
      <style>{TIMELINE_STYLE}</style>
      {/* origem desenha a linha ABAIXO; destino desenha a linha ACIMA.
          Juntas formam uma linha pontilhada contínua entre as duas bolinhas. */}
      <Parada ponto={origem} dark={dark} drawTop={false} drawBottom />
      <Parada ponto={destino} dark={dark} drawTop drawBottom={false} />
    </div>
  );
}
