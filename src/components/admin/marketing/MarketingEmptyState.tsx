/**
 * MarketingEmptyState - estado vazio do painel quando a integracao Meta ainda
 * nao foi configurada (`TOKEN_NOT_CONFIGURED`).
 *
 * Orienta o admin a configurar a integracao. O link "Configurar integracao"
 * (-> /admin/marketing/configuracoes) e GATED por `MARKETING_EDIT`: admins sem
 * essa permissao nao veem o link (oculto, nao apenas desabilitado), conforme
 * Req 2.8 / 5.11. O gating segue a primeira camada do padrao RBAC do painel
 * (UI esconde; o servidor decide de qualquer forma).
 *
 * Mensagem default vem da tabela canonica `MARKETING_ERROR_MESSAGES`
 * (`TOKEN_NOT_CONFIGURED`) para manter paridade com o restante do modulo.
 *
 * _Requirements: 5.11, 14.3_
 */

import { Link } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { MARKETING_ERROR_MESSAGES } from '../../../services/admin/marketing';

interface Props {
  /** Mensagem orientativa. Default: mensagem canonica de TOKEN_NOT_CONFIGURED. */
  message?: string;
  /** Destino do link Configurar. Default: rota de configuracao do modulo. */
  configHref?: string;
  className?: string;
}

export default function MarketingEmptyState({
  message = MARKETING_ERROR_MESSAGES.TOKEN_NOT_CONFIGURED,
  configHref = '/admin/marketing/configuracoes',
  className = '',
}: Props) {
  // Camada 1 (UI): sem MARKETING_EDIT o link nao aparece.
  const { allowed: canEdit } = useAdminPermission('MARKETING_EDIT');

  return (
    <div
      className={`rounded-lg border border-gray-800 bg-gray-900 p-6 flex flex-col items-center justify-center gap-3 text-center ${className}`}
    >
      {/* Icone megafone (SVG inline; sem dependencia de icones) */}
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gray-600"
        aria-hidden="true"
      >
        <path d="m3 11 18-5v12L3 14v-3z" />
        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </svg>

      <p className="text-sm text-gray-300 max-w-sm">{message}</p>

      {canEdit && (
        <Link
          to={configHref}
          className="text-xs px-2.5 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-500 transition focus:outline-none focus:ring-2 focus:ring-cyan-700"
        >
          Configurar integração
        </Link>
      )}
    </div>
  );
}
