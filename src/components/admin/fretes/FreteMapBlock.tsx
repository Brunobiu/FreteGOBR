/**
 * FreteMapBlock - mini-mapa origem→destino simplificado.
 *
 * Versao readonly que mostra coordenadas como texto. Pode ser
 * upgradado pra usar InteractiveMap em spec futura.
 */

interface Props {
  origin: string;
  destination: string;
}

export default function FreteMapBlock({ origin, destination }: Props) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Trajeto</h3>
      <div className="bg-gray-800/40 rounded p-4 text-center">
        <div className="text-sm">
          <span className="inline-block px-2 py-1 rounded bg-green-500/15 text-green-300 text-xs">
            📍 {origin}
          </span>
          <span className="text-gray-500 mx-2">━━━━━</span>
          <span className="inline-block px-2 py-1 rounded bg-red-500/15 text-red-300 text-xs">
            📍 {destination}
          </span>
        </div>
        <div className="text-[10px] text-gray-500 mt-2">
          Visualizacao detalhada em mapa virá em spec futura.
        </div>
      </div>
    </section>
  );
}
