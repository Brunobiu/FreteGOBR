/**
 * Wrapper fino: renderiza `MotoristaPerfilPage` filtrando para a view
 * "tracao" (apenas dados do cavalo: placa, modelo, ano, CRLV cavalo,
 * RNTRC cavalo, fotos, toggle "nao sou proprietario").
 *
 * Gating via CSS em `index.css` (form[data-view='tracao'] ...).
 */
import MotoristaPerfilPage from './MotoristaPerfilPage';

export default function MotoristaTracaoPage() {
  return <MotoristaPerfilPage view="tracao" />;
}
