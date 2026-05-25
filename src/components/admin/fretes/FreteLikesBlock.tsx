/**
 * FreteLikesBlock - placeholder neutro (frete_likes ainda nao tem
 * exposicao admin). Renderiza apenas se houver dados.
 */

interface Props {
  count?: number;
}

export default function FreteLikesBlock({ count }: Props) {
  if (count === undefined || count === 0) return null;
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Curtidas</h3>
      <div className="text-sm text-gray-400">{count} motorista(s) curtiram este frete.</div>
      <div className="text-[10px] text-gray-500 mt-1">Lista detalhada em spec futura.</div>
    </section>
  );
}
