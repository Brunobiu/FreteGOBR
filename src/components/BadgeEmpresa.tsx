import { useIsMobile } from '../hooks/useIsMobile';

interface BadgeEmpresaProps {
  companyName: string;
}

/**
 * Badge exibido no AppHeader ao lado do badge "Embarcador" mostrando o
 * nome da empresa do usuário autenticado. Em telas mobile, trunca em 20
 * caracteres com reticências.
 */
export function BadgeEmpresa({ companyName }: BadgeEmpresaProps) {
  const isMobile = useIsMobile();
  const trimmed = (companyName ?? '').trim();
  if (!trimmed) return null;

  const display = isMobile && trimmed.length > 20 ? trimmed.slice(0, 20) + '…' : trimmed;

  return (
    <span
      className="inline-flex items-center text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100 font-medium"
      title={trimmed}
      aria-label={`Empresa: ${trimmed}`}
    >
      {display}
    </span>
  );
}

export default BadgeEmpresa;
