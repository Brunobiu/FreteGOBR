/**
 * AuthShell — moldura das telas de login e cadastro NA WEB.
 *
 *  - Desktop (lg+): duas colunas — formulário à esquerda, foto à direita.
 *    A foto alterna conforme o público escolhido (caminhoneiro / embarcador).
 *  - Mobile / app (< lg): coluna única, só o formulário, exatamente como já
 *    era (a foto fica escondida). Atende ao pedido de mexer só na versão web.
 *
 * Sem rodapé: as telas de login/cadastro ficam limpas (o rodapé completo fica
 * só na landing, via PublicLayout). As fotos são placeholders (public/
 * audience-motorista.jpg e audience-embarcador.jpg, as mesmas das páginas de
 * público). Troque pelos definitivos quando tiver — é só substituir os
 * arquivos ou ajustar imageFor.
 */

export type AuthAudience = 'motorista' | 'embarcador' | null;

function imageFor(audience: AuthAudience): { src: string; alt: string } {
  if (audience === 'embarcador')
    return { src: '/audience-embarcador.jpg', alt: 'Embarcador usando o FreteGO' };
  if (audience === 'motorista')
    return { src: '/audience-motorista.jpg', alt: 'Caminhoneiro usando o FreteGO' };
  // pré-escolha (cadastro): imagem neutra do caminhão
  return { src: '/landing-fundo.jpg', alt: 'FreteGO' };
}

/** Mensagem sobre a foto, conforme o público escolhido (ou o contexto). */
function overlayTitle(audience: AuthAudience, context: 'login' | 'register'): string {
  if (audience === 'motorista') return 'Mais frete na sua rota — e menos viagem vazia.';
  if (audience === 'embarcador') return 'Sua carga na mão de quem está pertinho dela.';
  return context === 'register'
    ? 'Crie sua conta grátis e comece a fechar frete hoje.'
    : 'Que bom te ver de novo. Bons fretes pela frente.';
}

export default function AuthShell({
  audience,
  children,
  context = 'login',
}: {
  audience: AuthAudience;
  children: React.ReactNode;
  context?: 'login' | 'register';
}) {
  const img = imageFor(audience);

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-2">
        {/* Esquerda: formulário (centralizado) */}
        <div className="flex flex-1 flex-col items-center justify-center p-4 sm:p-6 lg:p-10">
          {children}
        </div>

        {/* Direita: foto (só desktop). Alterna conforme o público escolhido. */}
        <div className="relative hidden overflow-hidden lg:block">
          <img
            src={img.src}
            alt={img.alt}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-10">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
              FreteGO
            </span>
            <p className="text-shadow-soft mt-3 max-w-sm text-xl font-extrabold leading-tight text-white">
              {overlayTitle(audience, context)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
