/**
 * Wrapper fino: renderiza `MotoristaPerfilPage` filtrando para a view
 * "referencias" (apenas o bloco de Referencias profissionais).
 *
 * O gating de secoes acontece via CSS em `index.css`
 * (form[data-view='referencias'] ...).
 */
import MotoristaPerfilPage from './MotoristaPerfilPage';

export default function MotoristaReferenciasPage() {
  return <MotoristaPerfilPage view="referencias" />;
}
