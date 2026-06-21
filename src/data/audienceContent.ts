/**
 * Conteúdo das páginas públicas por público-alvo (AudienceLandingPage):
 *   - /para-embarcadores  → CONTENT.embarcador
 *   - /para-caminhoneiros → CONTENT.motorista
 *
 * Fica num módulo de dados (sem componentes) para não acoplar texto à página
 * e manter o fast-refresh limpo (a página só exporta o componente).
 */

export type Audience = 'embarcador' | 'motorista';

export type Benefit = { title: string; desc: string };

export type AudienceContent = {
  docTitle: string;
  tag: string;
  heroTitle: string;
  heroSubtitle: string;
  image: string;
  ctaLabel: string;
  benefitsTitle: string;
  benefits: Benefit[];
  finalTitle: string;
};

export const CONTENT: Record<Audience, AudienceContent> = {
  embarcador: {
    docTitle: 'Para embarcadores',
    tag: 'Para embarcadores',
    heroTitle: 'Publique seus fretes e ache caminhoneiros perto da carga',
    heroSubtitle:
      'Sem intermediário: você fala direto com quem vai rodar com a sua carga, no melhor valor.',
    image: '/audience-embarcador.jpg',
    ctaLabel: 'Criar conta de embarcador',
    benefitsTitle: 'Por que publicar no FreteGO',
    benefits: [
      {
        title: 'Publique em minutos',
        desc: 'Cadastre a carga com origem, destino e detalhes; ela aparece para caminhoneiros na rota.',
      },
      {
        title: 'Caminhoneiros perto da carga',
        desc: 'Encontre veículos próximos do ponto de coleta e reduza o tempo até a retirada.',
      },
      {
        title: 'Negocie direto',
        desc: 'Converse com o caminhoneiro sem atravessador e combine valor e prazo do seu jeito.',
      },
      {
        title: 'Tudo num lugar só',
        desc: 'Acompanhe seus fretes e converse pelo chat dentro da própria plataforma.',
      },
    ],
    finalTitle: 'Pronto para publicar seu primeiro frete?',
  },
  motorista: {
    docTitle: 'Para caminhoneiros',
    tag: 'Para caminhoneiros',
    heroTitle: 'Encontre as melhores cargas para o seu veículo e a sua rota',
    heroSubtitle:
      'Veja fretes perto de você, filtre pelo seu caminhão e negocie direto com o embarcador.',
    image: '/audience-motorista.jpg',
    ctaLabel: 'Criar conta de motorista',
    benefitsTitle: 'Por que rodar com o FreteGO',
    benefits: [
      {
        title: 'Cargas na sua rota',
        desc: 'Veja fretes perto de você e na sua viagem de volta, sem rodar vazio.',
      },
      {
        title: 'Filtre pelo seu veículo',
        desc: 'Resultados pelo tipo de carroceria, eixos e capacidade do seu caminhão.',
      },
      {
        title: 'Negocie direto',
        desc: 'Fale com o embarcador sem intermediário e combine valor e prazo.',
      },
      {
        title: 'Comece de graça',
        desc: 'Crie sua conta e explore os fretes sem pagar nada para testar.',
      },
    ],
    finalTitle: 'Pronto para achar sua próxima carga?',
  },
};
