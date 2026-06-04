/**
 * Wrapper fino: renderiza `MotoristaPerfilPage` filtrando para a view
 * "contrato" (apenas Proprietario + Contrato de Arrendamento).
 *
 * Essas secoes so aparecem quando o motorista marcou que NAO eh o
 * proprietario do caminhao (toggle dentro da secao Veiculo).
 *
 * Gating via CSS em `index.css` (form[data-view='contrato'] ...).
 */
import MotoristaPerfilPage from './MotoristaPerfilPage';

export default function MotoristaContratoPage() {
  return <MotoristaPerfilPage view="contrato" />;
}
