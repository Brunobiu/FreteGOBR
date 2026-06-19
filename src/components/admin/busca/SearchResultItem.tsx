/**
 * SearchResultItem — item unificado de um Search_Result (Pesquisa Global).
 * Exibe nome, tipo, e-mail, telefone, empresa e o Search_Field que casou; e um
 * link para a Visao 360 (/admin/users/<id>). Spec: admin-cliente-360 (Task 8.1).
 */

import { Link } from 'react-router-dom';
import type { SearchResult } from '../../../services/admin/cliente360';

const FIELD_LABEL: Record<SearchResult['matched_field'], string> = {
  id: 'ID',
  email: 'E-mail',
  phone: 'Telefone',
  name: 'Nome',
  company_name: 'Empresa',
};

const TYPE_LABEL: Record<SearchResult['user_type'], string> = {
  motorista: 'Motorista',
  embarcador: 'Embarcador',
};

interface Props {
  result: SearchResult;
  active?: boolean;
  onNavigate?: () => void;
}

export default function SearchResultItem({ result, active = false, onNavigate }: Props) {
  return (
    <Link
      to={`/admin/users/${result.id}`}
      onClick={onNavigate}
      data-testid="search-result-item"
      className={`block px-3 py-2 border-b border-gray-800/60 last:border-0 transition ${
        active ? 'bg-cyan-500/15' : 'hover:bg-gray-800/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-gray-100 truncate">{result.name}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-gray-500">
          {TYPE_LABEL[result.user_type]}
        </span>
      </div>
      <div className="text-[11px] text-gray-500 truncate">
        {result.email ?? 'sem e-mail'}
        {result.phone ? ` · ${result.phone}` : ''}
        {result.company_name ? ` · ${result.company_name}` : ''}
      </div>
      <div className="mt-0.5 text-[10px] text-cyan-400/80">
        casou por {FIELD_LABEL[result.matched_field]}
      </div>
    </Link>
  );
}
