/**
 * BrandedTitle — renderiza um título substituindo a marca "FreteGO" pela logo
 * oficial (em public/). A logo entra dentro de um "chip" branco arredondado,
 * dimensionada em `em` pra ficar do mesmo tamanho do texto (sem quebrar a
 * linha) e legível em qualquer fundo (claro, escuro ou imagem).
 *
 * Uso: <h1><BrandedTitle title="Comunidade FreteGO" logo="/logo.png" /></h1>
 *
 * Sem `logo`, ou se o título não contém "FreteGO", devolve o texto puro.
 */

const BRAND_MARKER = 'FreteGO';

type BrandedTitleProps = {
  /** Título completo (usado como texto/acessibilidade quando não há logo). */
  title: string;
  /** Caminho da logo em public/ (ex.: "/logo.png"). */
  logo?: string;
};

export default function BrandedTitle({ title, logo }: BrandedTitleProps) {
  const idx = logo ? title.indexOf(BRAND_MARKER) : -1;
  if (!logo || idx === -1) return <>{title}</>;

  const before = title.slice(0, idx);
  const after = title.slice(idx + BRAND_MARKER.length);

  return (
    <>
      {before}
      <span className="inline-flex items-center rounded-md bg-white px-[0.35em] py-[0.15em] align-middle shadow-sm">
        <img
          src={logo}
          alt={BRAND_MARKER}
          className="block h-[0.7em] w-auto"
          draggable={false}
        />
      </span>
      {after}
    </>
  );
}
