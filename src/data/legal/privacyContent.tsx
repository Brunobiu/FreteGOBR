/**
 * Conteúdo da Política de Privacidade do FreteGO (Feature 1 — legal).
 *
 * Conforme LGPD (Lei 13.709/2018). Texto versionado no git. Ao alterar,
 * atualizar `version`/`updatedAt` em `src/data/legal/index.ts`.
 *
 * NOTA: documento padrão para marketplace de frete brasileiro. Recomenda-se
 * revisão por advogado/DPO antes de uso definitivo em produção. Substituir o
 * email de contato do controlador pelo canal oficial.
 */

import type { LegalSection } from './types';

/** Email de contato do controlador/encarregado (DPO). Ajustar se necessário. */
export const PRIVACY_CONTACT_EMAIL = 'privacidade@fretegobr.com.br';

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: 'introducao',
    heading: '1. Introdução',
    body: [
      'Esta Política de Privacidade descreve como o FreteGO coleta, usa, armazena, compartilha e protege os dados pessoais de Motoristas e Embarcadores, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018).',
      'Ao utilizar a plataforma, você declara estar ciente do tratamento dos seus dados conforme aqui descrito.',
    ],
  },
  {
    id: 'controlador',
    heading: '2. Controlador dos dados',
    body: [
      'O FreteGO é o controlador dos dados pessoais tratados na plataforma. Para exercer seus direitos ou esclarecer dúvidas sobre privacidade, entre em contato pelo canal indicado ao final deste documento.',
    ],
  },
  {
    id: 'dados-coletados',
    heading: '3. Dados pessoais coletados',
    body: ['Coletamos as seguintes categorias de dados, conforme o tipo de usuário:'],
    bullets: [
      'Dados de identificação: nome, CPF, RG, data de nascimento.',
      'Dados de contato: telefone e e-mail.',
      'Documentos de habilitação e atividade (Motorista): CNH, RNTRC e comprovantes.',
      'Dados do veículo: placa, modelo, ano, tipo de carroceria, CRLV e documentos relacionados.',
      'Dados empresariais (Embarcador): CNPJ e razão social.',
      'Dados de localização: posição geográfica utilizada para exibir e calcular fretes próximos.',
      'Dados de uso: registros de acesso, dispositivo e interações na plataforma.',
    ],
  },
  {
    id: 'finalidades',
    heading: '4. Finalidades e base legal do tratamento',
    body: [
      'Tratamos seus dados para as finalidades abaixo, com a respectiva base legal da LGPD (art. 7º):',
    ],
    bullets: [
      'Criar e gerenciar sua conta e viabilizar o uso da plataforma — execução de contrato (art. 7º, V).',
      'Conectar Motoristas e Embarcadores e exibir fretes compatíveis — execução de contrato e legítimo interesse (art. 7º, V e IX).',
      'Verificar identidade e documentos para segurança e prevenção a fraudes — legítimo interesse e cumprimento de obrigação legal (art. 7º, II e IX).',
      'Usar a localização para mostrar fretes próximos e calcular distâncias — consentimento e execução de contrato (art. 7º, I e V).',
      'Enviar comunicações operacionais e de verificação (ex.: código de e-mail) — execução de contrato (art. 7º, V).',
      'Cumprir obrigações legais, fiscais e regulatórias — cumprimento de obrigação legal (art. 7º, II).',
    ],
  },
  {
    id: 'compartilhamento',
    heading: '5. Compartilhamento de dados',
    body: [
      'Dados necessários à realização do frete (ex.: contato e informações do veículo) são compartilhados entre Motorista e Embarcador envolvidos na negociação.',
      'Podemos compartilhar dados com prestadores de serviço que operam a infraestrutura da plataforma (ex.: provedor de banco de dados e de envio de e-mail), estritamente para viabilizar o serviço, e com autoridades quando exigido por lei.',
      'Não vendemos seus dados pessoais a terceiros.',
    ],
  },
  {
    id: 'retencao',
    heading: '6. Período de retenção',
    body: [
      'Mantemos seus dados pessoais pelo tempo necessário às finalidades descritas e ao cumprimento de obrigações legais e regulatórias.',
      'Encerrada a finalidade, os dados são eliminados ou anonimizados, ressalvadas as hipóteses de guarda obrigatória previstas em lei.',
    ],
  },
  {
    id: 'direitos',
    heading: '7. Seus direitos como titular',
    body: ['Nos termos da LGPD, você pode, a qualquer momento:'],
    bullets: [
      'Confirmar a existência de tratamento e acessar seus dados.',
      'Corrigir dados incompletos, inexatos ou desatualizados.',
      'Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade.',
      'Solicitar a portabilidade dos dados.',
      'Revogar o consentimento e solicitar a exclusão dos dados tratados com base nele.',
      'Solicitar a exclusão da conta e dos dados pessoais — concluída em até 30 dias, ressalvadas as retenções legais obrigatórias.',
    ],
  },
  {
    id: 'exclusao',
    heading: '8. Exclusão de dados',
    body: [
      'Você pode solicitar a exclusão da sua conta e dos seus dados pessoais diretamente no seu perfil na plataforma. A exclusão é concluída em até 30 dias.',
      'Alguns dados podem ser retidos de forma anonimizada quando houver obrigação legal de guarda (ex.: registros fiscais de fretes concluídos), preservando apenas o estritamente necessário.',
    ],
  },
  {
    id: 'seguranca',
    heading: '9. Segurança da informação',
    body: [
      'Adotamos medidas técnicas e organizacionais para proteger seus dados contra acessos não autorizados, perda ou alteração indevida, incluindo controle de acesso, criptografia de credenciais e registros de auditoria.',
    ],
  },
  {
    id: 'cookies',
    heading: '10. Cookies e tecnologias semelhantes',
    body: [
      'Utilizamos cookies essenciais ao funcionamento da plataforma e, mediante seu consentimento, cookies de análise e de marketing. Você pode gerenciar suas preferências no banner de cookies exibido na primeira visita.',
    ],
  },
  {
    id: 'contato',
    heading: '11. Contato do encarregado (DPO)',
    body: [
      `Para exercer seus direitos ou esclarecer dúvidas sobre o tratamento dos seus dados, entre em contato pelo e-mail ${PRIVACY_CONTACT_EMAIL}.`,
      'Responderemos às solicitações nos prazos previstos pela LGPD.',
    ],
  },
];
