/**
 * Wrapper fino: renderiza `MotoristaPerfilPage` filtrando para a view
 * "carroceria" (tipo de caminhao, tipo de carroceria, CRLV/RNTRC das
 * carretas).
 *
 * Gating via CSS em `index.css` (form[data-view='carroceria'] ...).
 */
import MotoristaPerfilPage from './MotoristaPerfilPage';

export default function MotoristaCarroceriaPage() {
  return <MotoristaPerfilPage view="carroceria" />;
}
