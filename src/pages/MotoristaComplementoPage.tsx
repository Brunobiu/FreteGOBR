/**
 * Wrapper fino: renderiza `MotoristaPerfilPage` filtrando para a view
 * "complemento" (eixos, consumo km/L, capacidade bruta PBT, tara,
 * liquido calculado e valor do diesel).
 *
 * Gating via CSS em `index.css` (form[data-view='complemento'] ...).
 */
import MotoristaPerfilPage from './MotoristaPerfilPage';

export default function MotoristaComplementoPage() {
  return <MotoristaPerfilPage view="complemento" />;
}
