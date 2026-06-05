/**
 * Conteúdo dos Termos de Uso do FreteGO (Feature 1 — legal).
 *
 * Texto versionado no git (trilha de auditoria). Ao alterar, atualizar
 * `version`/`updatedAt` em `src/data/legal/index.ts`.
 *
 * NOTA: documento padrão para marketplace de frete brasileiro. Recomenda-se
 * revisão por advogado antes de uso definitivo em produção.
 */

import type { LegalSection } from './types';

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: 'objeto',
    heading: '1. Objeto do serviço',
    body: [
      'O FreteGO é uma plataforma digital (marketplace) que conecta motoristas autônomos e transportadores ("Motoristas") a empresas e pessoas que precisam transportar cargas ("Embarcadores"), facilitando a divulgação, a busca e a negociação de fretes.',
      'O FreteGO atua como intermediador tecnológico. A contratação do transporte, o cumprimento do frete e as obrigações fiscais e trabalhistas decorrentes são de responsabilidade exclusiva das partes envolvidas (Motorista e Embarcador).',
    ],
  },
  {
    id: 'cadastro',
    heading: '2. Cadastro e elegibilidade',
    body: [
      'Para usar a plataforma é necessário criar uma conta, fornecendo dados verdadeiros, completos e atualizados. O usuário é responsável pela veracidade das informações prestadas.',
      'É necessário ter capacidade civil plena. Motoristas devem possuir habilitação e documentação válidas para o exercício da atividade de transporte, incluindo, quando aplicável, RNTRC ativa junto à ANTT.',
      'O usuário é responsável por manter a confidencialidade de suas credenciais de acesso e por todas as atividades realizadas em sua conta.',
    ],
  },
  {
    id: 'obrigacoes',
    heading: '3. Obrigações dos usuários',
    body: [
      'Motoristas comprometem-se a manter documentos pessoais e do veículo válidos, prestar o serviço de transporte com diligência e cumprir a legislação de trânsito e de transporte de cargas.',
      'Embarcadores comprometem-se a fornecer informações corretas sobre a carga, origem, destino e condições do frete, e a remunerar o serviço conforme acordado diretamente com o Motorista.',
      'Ambas as partes comprometem-se a negociar de boa-fé e a tratar os demais usuários com respeito.',
    ],
  },
  {
    id: 'conduta',
    heading: '4. Conduta proibida',
    body: [
      'É vedado: fornecer dados falsos; publicar cargas ilícitas ou proibidas por lei; usar a plataforma para fins fraudulentos; assediar, ameaçar ou discriminar outros usuários; tentar burlar mecanismos de segurança; ou utilizar sistemas automatizados não autorizados para coletar dados.',
      'O descumprimento poderá resultar em suspensão ou encerramento da conta, sem prejuízo das medidas legais cabíveis.',
    ],
  },
  {
    id: 'responsabilidades',
    heading: '5. Responsabilidades e limitação',
    body: [
      'O FreteGO não é parte nos contratos de transporte firmados entre Motoristas e Embarcadores e não se responsabiliza por perdas, danos, avarias, atrasos, inadimplência ou quaisquer prejuízos decorrentes da relação entre as partes.',
      'A plataforma é fornecida "no estado em que se encontra". Empenhamo-nos para manter o serviço disponível e seguro, mas não garantimos operação ininterrupta ou livre de erros.',
      'Na máxima extensão permitida pela lei, a responsabilidade do FreteGO limita-se à prestação do serviço de intermediação tecnológica.',
    ],
  },
  {
    id: 'propriedade',
    heading: '6. Propriedade intelectual',
    body: [
      'A marca FreteGO, o software, o layout, os textos e demais elementos da plataforma são protegidos por direitos de propriedade intelectual e não podem ser copiados, reproduzidos ou utilizados sem autorização.',
    ],
  },
  {
    id: 'rescisao',
    heading: '7. Suspensão e encerramento',
    body: [
      'O usuário pode encerrar sua conta a qualquer momento, inclusive solicitando a exclusão de seus dados conforme a Política de Privacidade.',
      'O FreteGO pode suspender ou encerrar contas que violem estes Termos, a legislação aplicável ou que apresentem risco à segurança da plataforma e de seus usuários.',
    ],
  },
  {
    id: 'privacidade',
    heading: '8. Privacidade e proteção de dados',
    body: [
      'O tratamento de dados pessoais é regido pela nossa Política de Privacidade, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018). Recomendamos a leitura atenta desse documento.',
    ],
  },
  {
    id: 'foro',
    heading: '9. Legislação aplicável e foro',
    body: [
      'Estes Termos são regidos pelas leis da República Federativa do Brasil.',
      'Fica eleito o foro do domicílio do consumidor para dirimir eventuais controvérsias, quando aplicável a legislação consumerista; nos demais casos, o foro da comarca da sede do FreteGO.',
    ],
  },
];
