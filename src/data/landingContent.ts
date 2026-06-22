/**
 * landingContent — conteúdo (copy) das seções de marketing da landing do
 * FreteGO e das páginas de detalhe ("Saiba mais"). Mantido fora dos
 * componentes de página pra deixar o fast-refresh limpo (a página exporta só
 * o componente) e centralizar o texto pt-BR num lugar só.
 *
 * Princípio: copy emocional, na língua do caminhoneiro, mas SEM número
 * inventado (downloads/avaliação só quando forem reais). O foco é a dor real
 * (rodar vazio, atravessador, achar carga tarde) e o desejo (mais frete na
 * rota, menos viagem vazia, mais lucro).
 */

/** Chaves de ícone usadas pelos cards de Vantagens (mapeadas no componente). */
export type BenefitIcon = 'route' | 'return' | 'money' | 'chat' | 'shield' | 'phone';

export type Pain = { title: string; desc: string };

export type Benefit = {
  /** slug da página de detalhe correspondente (/saiba/:slug). */
  slug: string;
  icon: BenefitIcon;
  title: string;
  desc: string;
};

export type Feature = {
  slug: string;
  title: string;
  desc: string;
  /** imagem/screenshot ao lado (em public/). */
  image: string;
  bullets: string[];
};

export type Testimonial = {
  /** Conteúdo de exemplo até termos depoimentos reais (UI marca como "exemplo"). */
  placeholder: boolean;
  name: string;
  role: string;
  location: string;
  quote: string;
};

export type TopicBlock = { heading: string; body: string };

export type Topic = {
  slug: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  blocks: TopicBlock[];
  ctaLabel: string;
  ctaTo: string;
};

/* ===================== Seção 3 — Dor do caminhoneiro ===================== */

export const PAIN_TITLE = 'A estrada já é difícil. Achar frete bom não devia ser.';
export const PAIN_SUBTITLE =
  'Todo dia é a mesma luta pra fechar carga boa, no preço justo e sem rodar à toa. A gente entende — e foi por isso que o FreteGO existe.';

export const PAINS: Pain[] = [
  {
    title: 'Cansado de voltar vazio?',
    desc: 'Cada quilômetro rodado sem carga é dinheiro saindo do seu bolso e diesel queimado à toa.',
  },
  {
    title: 'Fica sabendo do frete tarde demais?',
    desc: 'Quando a carga aparece no grupo, já foi. Você perde frete por falta de informação na hora certa.',
  },
  {
    title: 'Comissão alta de atravessador?',
    desc: 'Você roda, corre o risco e pega no batente — e ainda divide o lucro com quem só passou o contato.',
  },
  {
    title: 'Carga perdida em mil grupos de WhatsApp?',
    desc: 'Print velho, frete que não existe mais, golpe e telefone que não atende. Tempo demais pra achar pouca coisa.',
  },
];

/* ===================== Bridge desejo (dor → ganho) ===================== */

export const DESIRE_TITLE = 'Agora imagina a inteligência artificial trabalhando por você:';
export const DESIRE_POINTS = [
  'Mais frete na sua rota — a inteligência artificial acha cargas perto de você e no caminho que você já vai fazer.',
  'Menos viagem vazia — a IA encontra o frete de retorno antes mesmo de você sair.',
  'Mais lucro por viagem — sem atravessador comendo a sua margem.',
];

/* ===================== Seção 4 — Vantagens (Benefícios) ===================== */

export const BENEFITS_TITLE = 'Por que o caminhoneiro escolhe o FreteGO';
export const BENEFITS_SUBTITLE =
  'Inteligência artificial e tecnologia simples pra te dar mais carga boa — de ida e de volta — e menos dor de cabeça na estrada.';

export const BENEFITS: Benefit[] = [
  {
    slug: 'frete-na-rota',
    icon: 'route',
    title: 'Frete na sua rota',
    desc: 'A inteligência artificial mostra cargas perto de você e no caminho que você já vai fazer, não em qualquer lugar do mapa.',
  },
  {
    slug: 'menos-viagem-vazia',
    icon: 'return',
    title: 'Menos viagem vazia',
    desc: 'A IA acha sua carga de retorno antes de você sair e te livra do prejuízo de rodar vazio.',
  },
  {
    slug: 'sem-atravessador',
    icon: 'money',
    title: 'Mais lucro, sem atravessador',
    desc: 'Você fala direto com quem tem a carga. Sem comissão de intermediário no meio do caminho.',
  },
  {
    slug: 'fale-direto',
    icon: 'chat',
    title: 'Negocie direto',
    desc: 'Combine valor, prazo e detalhes com o embarcador, do seu jeito, sem ninguém empurrando preço.',
  },
  {
    slug: 'seguranca-antifraude',
    icon: 'shield',
    title: 'Mais segurança',
    desc: 'A gente verifica cadastro e documentos pra manter fraudador longe e dar mais tranquilidade pro seu fechamento.',
  },
  {
    slug: 'simples-no-celular',
    icon: 'phone',
    title: 'Simples no celular',
    desc: 'Tudo na palma da mão, com poucos toques. Feito pra usar na estrada, não pra perder tempo.',
  },
];

/* ===================== Seção 5 — Funcionalidades ===================== */

export const FEATURES_TITLE = 'Tudo que você precisa em um só app';
export const FEATURES_SUBTITLE =
  'Do achar a carga ao fechar o frete, sem sair do celular.';

export const FEATURES: Feature[] = [
  {
    slug: 'mapa-de-cargas',
    title: 'Mapa de cargas perto de você',
    desc: 'Veja no mapa as cargas disponíveis ao seu redor e na sua rota, em tempo real.',
    image: '/app-tela.jpg',
    bullets: ['Cargas por raio de distância', 'Origem e destino antes de aceitar', 'Atualização em tempo real'],
  },
  {
    slug: 'filtros-do-caminhao',
    title: 'Filtros pro seu caminhão',
    desc: 'Filtre por tipo de veículo, carroceria e região e veja só o que serve pra você.',
    image: '/app-tela.jpg',
    bullets: ['Por tipo de carroceria', 'Por região e rota', 'Sem carga que não cabe no seu veículo'],
  },
  {
    slug: 'fale-direto',
    title: 'Conversa direta com o embarcador',
    desc: 'Negocie pelo chat ou chame no WhatsApp, sem intermediário e sem ruído.',
    image: '/app-tela.jpg',
    bullets: ['Chat dentro do app', 'Atalho pro WhatsApp', 'Você combina valor e prazo'],
  },
  {
    slug: 'frete-comunidade',
    title: 'Frete Comunidade',
    desc: 'Cargas indicadas pela comunidade, perto de você, pra você não perder oportunidade.',
    image: '/app-tela.jpg',
    bullets: ['Cargas da sua região', 'Contato rápido', 'Mais opção de frete'],
  },
];

/* ===================== Seção 8 — Depoimentos (placeholders) ===================== */

export const TESTIMONIALS_TITLE = 'Quem roda com o FreteGO recomenda';

export const TESTIMONIALS: Testimonial[] = [
  {
    placeholder: true,
    name: 'João M.',
    role: 'Caminhoneiro autônomo',
    location: 'Goiânia, GO',
    quote: 'Achei carga de volta no mesmo dia. Parei de voltar vazio pra casa e isso mudou meu mês.',
  },
  {
    placeholder: true,
    name: 'Carlos R.',
    role: 'Frota própria',
    location: 'Uberlândia, MG',
    quote: 'Falo direto com quem tem a carga. Sem atravessador, o valor que combino é o que entra.',
  },
  {
    placeholder: true,
    name: 'Edson L.',
    role: 'Caminhoneiro',
    location: 'Londrina, PR',
    quote: 'Simples de usar na estrada. Em poucos toques já sei o que tem carga na minha rota.',
  },
];

/* ===================== Seção 9 — Sobre (curta) ===================== */

export const ABOUT = {
  title: 'Tecnologia com propósito',
  body: 'O FreteGO nasceu pra tirar o atravessador do caminho e colocar caminhoneiro e embarcador frente a frente. Tecnologia brasileira, feita pra quem vive na estrada.',
};

/* ===================== CTA final ===================== */

export const FINAL_CTA_TITLE = 'Sua próxima carga pode estar na sua rota agora.';
export const FINAL_CTA_TEXT =
  'Baixe o FreteGO, crie sua conta de graça e comece a achar frete bom perto de você. Sem burocracia.';

/* ===================== Páginas de detalhe (/saiba/:slug) ===================== */

export const TOPICS: Record<string, Topic> = {
  'frete-na-rota': {
    slug: 'frete-na-rota',
    eyebrow: 'Vantagem',
    title: 'Frete na sua rota',
    subtitle:
      'A inteligência artificial para de te mostrar carga em qualquer canto do mapa e foca no que está perto de você e no caminho que você já vai fazer.',
    blocks: [
      {
        heading: 'Carga onde você está',
        body: 'O FreteGO mostra as cargas disponíveis por raio de distância, então você enxerga primeiro o que está pertinho de onde você está agora.',
      },
      {
        heading: 'No caminho que você já vai',
        body: 'Filtre pela sua rota e aproveite cada viagem: em vez de desviar, você pega carga que casa com o trajeto que já estava no seu plano.',
      },
      {
        heading: 'Você decide antes de aceitar',
        body: 'Origem, destino e detalhes ficam claros antes de você topar. Nada de surpresa depois que já está na estrada.',
      },
    ],
    ctaLabel: 'Criar conta grátis',
    ctaTo: '/register',
  },
  'menos-viagem-vazia': {
    slug: 'menos-viagem-vazia',
    eyebrow: 'Vantagem',
    title: 'Menos viagem vazia',
    subtitle:
      'Voltar vazio é prejuízo certo: diesel, pedágio e desgaste sem ninguém pagando. A inteligência artificial do FreteGO te ajuda a fechar o frete de retorno.',
    blocks: [
      {
        heading: 'Ache o retorno antes de sair',
        body: 'Antes de pegar a estrada, veja se já tem carga pro caminho de volta e planeje a viagem inteira com frete nas duas pontas.',
      },
      {
        heading: 'Cada km rodando rende',
        body: 'Quanto menos quilômetro vazio, mais a sua viagem vale a pena. A ideia é simples: encher o caminhão nas duas direções.',
      },
      {
        heading: 'Frete Comunidade na sua região',
        body: 'Além das cargas dos embarcadores, você vê oportunidades indicadas pela comunidade perto de você.',
      },
    ],
    ctaLabel: 'Criar conta grátis',
    ctaTo: '/register',
  },
  'sem-atravessador': {
    slug: 'sem-atravessador',
    eyebrow: 'Vantagem',
    title: 'Mais lucro, sem atravessador',
    subtitle: 'Quem roda é você. O lucro também devia ser. No FreteGO você negocia direto com quem tem a carga.',
    blocks: [
      {
        heading: 'Contato direto com o embarcador',
        body: 'Sem agenciador no meio, o valor que você combina é o valor que entra. Sem fatia pra quem só passou o telefone.',
      },
      {
        heading: 'Negociação no seu controle',
        body: 'Você fala valor, prazo e condição direto com quem contrata e fecha do seu jeito.',
      },
      {
        heading: 'Transparência do começo ao fim',
        body: 'Dá pra ver de onde sai e pra onde vai a carga antes de aceitar — você fecha sabendo no que está entrando.',
      },
    ],
    ctaLabel: 'Criar conta grátis',
    ctaTo: '/register',
  },
  'fale-direto': {
    slug: 'fale-direto',
    eyebrow: 'Funcionalidade',
    title: 'Negocie direto com o embarcador',
    subtitle: 'Converse pelo chat do app ou chame no WhatsApp. Sem intermediário, sem ruído, sem telefone que não atende.',
    blocks: [
      {
        heading: 'Chat dentro do app',
        body: 'Fale com o embarcador sem sair do FreteGO e mantenha o histórico da conversa organizado.',
      },
      {
        heading: 'Atalho pro WhatsApp',
        body: 'Quando faz sentido, é um toque pra continuar a conversa no WhatsApp, direto com quem tem a carga.',
      },
      {
        heading: 'Você combina os detalhes',
        body: 'Valor, prazo, local de carga e descarga: tudo acertado entre vocês dois, sem terceiro empurrando preço.',
      },
    ],
    ctaLabel: 'Criar conta grátis',
    ctaTo: '/register',
  },
  'seguranca-antifraude': {
    slug: 'seguranca-antifraude',
    eyebrow: 'Confiança',
    title: 'Mais segurança em cada frete',
    subtitle: 'A gente verifica identidade e documentos pra manter fraudador fora e deixar você negociar com mais tranquilidade.',
    blocks: [
      {
        heading: 'Cadastro verificado',
        body: 'Conferimos documentos e dados antes de liberar o acesso, pra reduzir golpe e perfil falso na plataforma.',
      },
      {
        heading: 'Antifraude ativo',
        body: 'Monitoramos comportamentos suspeitos pra proteger as negociações de quem está de boa-fé.',
      },
      {
        heading: 'Você vê a rota antes',
        body: 'De onde sai e pra onde vai a carga fica claro antes de aceitar — menos surpresa, mais confiança.',
      },
    ],
    ctaLabel: 'Criar conta grátis',
    ctaTo: '/register',
  },
  'simples-no-celular': {
    slug: 'simples-no-celular',
    eyebrow: 'Vantagem',
    title: 'Simples no celular',
    subtitle: 'Feito pra usar na estrada: poucos toques, sem burocracia e sem complicação.',
    blocks: [
      {
        heading: 'Pensado pra rotina da estrada',
        body: 'Interface direta, com o que importa à mão. Você acha carga, negocia e fecha sem se perder em menu.',
      },
      {
        heading: 'Comece de graça',
        body: 'Crie sua conta e explore os fretes sem pagar nada pra testar. Sem cartão, sem pegadinha.',
      },
      {
        heading: 'Tudo na palma da mão',
        body: 'Do mapa de cargas à conversa com o embarcador, tudo acontece dentro do app, no seu tempo.',
      },
    ],
    ctaLabel: 'Baixar o app',
    ctaTo: '/register',
  },
  'mapa-de-cargas': {
    slug: 'mapa-de-cargas',
    eyebrow: 'Funcionalidade',
    title: 'Mapa de cargas perto de você',
    subtitle: 'Enxergue no mapa as cargas disponíveis ao seu redor e na sua rota, atualizadas em tempo real.',
    blocks: [
      {
        heading: 'Cargas por raio de distância',
        body: 'Defina o quão perto você quer ver e o mapa mostra as oportunidades na sua volta.',
      },
      {
        heading: 'Origem e destino claros',
        body: 'Cada carga mostra de onde sai e pra onde vai, pra você decidir antes de aceitar.',
      },
      {
        heading: 'Em tempo real',
        body: 'O que aparece está disponível agora — menos print velho, menos frete que já foi.',
      },
    ],
    ctaLabel: 'Ver fretes',
    ctaTo: '/fretes',
  },
  'filtros-do-caminhao': {
    slug: 'filtros-do-caminhao',
    eyebrow: 'Funcionalidade',
    title: 'Filtros pro seu caminhão',
    subtitle: 'Veja só a carga que serve pro seu veículo. Sem perder tempo com o que não cabe.',
    blocks: [
      {
        heading: 'Por tipo de carroceria',
        body: 'Filtre pelo seu tipo de veículo e carroceria e ignore o que não dá pra carregar.',
      },
      {
        heading: 'Por região e rota',
        body: 'Combine o filtro de veículo com a sua rota e foque no que realmente faz sentido pra você.',
      },
      {
        heading: 'Menos rolagem, mais frete',
        body: 'Com o filtro certo, você chega rápido na carga boa em vez de rolar tela à toa.',
      },
    ],
    ctaLabel: 'Ver fretes',
    ctaTo: '/fretes',
  },
  'frete-comunidade': {
    slug: 'frete-comunidade',
    eyebrow: 'Funcionalidade',
    title: 'Frete Comunidade',
    subtitle: 'Além das cargas dos embarcadores, oportunidades indicadas pela comunidade perto de você.',
    blocks: [
      {
        heading: 'Cargas da sua região',
        body: 'Veja indicações de frete da comunidade na sua área e amplie suas opções.',
      },
      {
        heading: 'Contato rápido',
        body: 'Quando tem telefone, é um toque pra falar com quem indicou e correr atrás da carga.',
      },
      {
        heading: 'Mais oportunidade',
        body: 'Mais fontes de carga significam menos tempo parado e menos viagem vazia.',
      },
    ],
    ctaLabel: 'Ver fretes',
    ctaTo: '/fretes',
  },
};

/** Busca o conteúdo de um tópico de detalhe pelo slug (undefined se não existe). */
export function getTopic(slug: string | undefined): Topic | undefined {
  if (!slug) return undefined;
  return TOPICS[slug];
}

/* ===================== Ticker de fretes (hero) =====================
 * Lista ilustrativa que passa em loop no rodapé do hero (efeito "marquee").
 * Conteúdo de exemplo (rotas/cargas/caminhões/valores variados) só pra dar
 * vida — não são fretes reais. Quando houver feed real, dá pra trocar a fonte.
 */
export type FreteTickerItem = {
  rota: string;
  carga: string;
  caminhao: string;
  valor: string;
};

export const FRETE_TICKER: FreteTickerItem[] = [
  { rota: 'Goiânia, GO → São Paulo, SP', carga: 'Soja', caminhao: 'Graneleiro', valor: 'R$ 9.800' },
  { rota: 'Indiara, GO → Santos, SP', carga: 'Milho', caminhao: 'Bitrem', valor: 'R$ 11.200' },
  { rota: 'Rio Verde, GO → Uberlândia, MG', carga: 'Farelo de soja', caminhao: 'Rodotrem', valor: 'R$ 7.450' },
  { rota: 'Sorriso, MT → Rondonópolis, MT', carga: 'Soja', caminhao: 'Bitrem graneleiro', valor: 'R$ 6.900' },
  { rota: 'Sinop, MT → Santos, SP', carga: 'Milho', caminhao: 'Rodotrem', valor: 'R$ 18.500' },
  { rota: 'Rondonópolis, MT → Paranaguá, PR', carga: 'Soja', caminhao: 'Bitrem', valor: 'R$ 14.300' },
  { rota: 'Cascavel, PR → Paranaguá, PR', carga: 'Fertilizante', caminhao: 'Graneleiro', valor: 'R$ 5.200' },
  { rota: 'L. E. Magalhães, BA → Salvador, BA', carga: 'Algodão', caminhao: 'Carreta LS', valor: 'R$ 8.700' },
  { rota: 'Uberaba, MG → Ribeirão Preto, SP', carga: 'Calcário', caminhao: 'Caçamba', valor: 'R$ 4.600' },
  { rota: 'Dourados, MS → Campo Grande, MS', carga: 'Adubo', caminhao: 'Truck', valor: 'R$ 3.900' },
  { rota: 'Maringá, PR → Curitiba, PR', carga: 'Açúcar', caminhao: 'Carreta', valor: 'R$ 6.100' },
  { rota: 'Catalão, GO → Anápolis, GO', carga: 'Fertilizante', caminhao: 'Vanderléia', valor: 'R$ 5.800' },
  { rota: 'Jataí, GO → Goiânia, GO', carga: 'Sorgo', caminhao: 'Graneleiro', valor: 'R$ 4.200' },
  { rota: 'Primavera do Leste, MT → Cuiabá, MT', carga: 'Soja', caminhao: 'Bitrem', valor: 'R$ 5.500' },
  { rota: 'Barreiras, BA → L. E. Magalhães, BA', carga: 'Milho', caminhao: 'Graneleiro', valor: 'R$ 3.400' },
  { rota: 'Chapadão do Sul, MS → Três Lagoas, MS', carga: 'Eucalipto', caminhao: 'Rodotrem', valor: 'R$ 6.700' },
  { rota: 'Patrocínio, MG → Uberlândia, MG', carga: 'Café', caminhao: 'Truck baú', valor: 'R$ 4.950' },
  { rota: 'Cristalina, GO → Brasília, DF', carga: 'Batata', caminhao: 'Carreta baú', valor: 'R$ 5.300' },
  { rota: 'Itumbiara, GO → Uberlândia, MG', carga: 'Etanol', caminhao: 'Tanque', valor: 'R$ 7.800' },
  { rota: 'Palmas, TO → Goiânia, GO', carga: 'Arroz', caminhao: 'Graneleiro', valor: 'R$ 9.100' },
  { rota: 'Londrina, PR → Santos, SP', carga: 'Trigo', caminhao: 'Bitrem', valor: 'R$ 10.400' },
  { rota: 'Campo Verde, MT → Rondonópolis, MT', carga: 'Algodão', caminhao: 'Carreta LS', valor: 'R$ 4.800' },
  { rota: 'Mineiros, GO → Rio Verde, GO', carga: 'Ração', caminhao: 'Truck', valor: 'R$ 3.600' },
  { rota: 'Balsas, MA → Imperatriz, MA', carga: 'Soja', caminhao: 'Rodotrem', valor: 'R$ 8.200' },
  { rota: 'Tangará da Serra, MT → Cuiabá, MT', carga: 'Milho', caminhao: 'Bitrem graneleiro', valor: 'R$ 5.700' },
  { rota: 'Paranaguá, PR → Maringá, PR', carga: 'Fertilizante', caminhao: 'Graneleiro', valor: 'R$ 6.300' },
  { rota: 'Uberlândia, MG → Goiânia, GO', carga: 'Cimento', caminhao: 'Carreta', valor: 'R$ 5.000' },
  { rota: 'Anápolis, GO → Brasília, DF', carga: 'Bebidas', caminhao: 'Truck baú', valor: 'R$ 3.200' },
  { rota: 'Ribeirão Preto, SP → Uberaba, MG', carga: 'Cana', caminhao: 'Caçamba', valor: 'R$ 4.100' },
  { rota: 'Cuiabá, MT → Sinop, MT', carga: 'Adubo', caminhao: 'Bitrem', valor: 'R$ 9.600' },
  { rota: 'Três Lagoas, MS → Bauru, SP', carga: 'Celulose', caminhao: 'Carreta LS', valor: 'R$ 7.300' },
  { rota: 'Formosa, GO → Brasília, DF', carga: 'Hortifruti', caminhao: 'Truck refrigerado', valor: 'R$ 3.800' },
];
