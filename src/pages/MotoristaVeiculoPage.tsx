/**
 * Wrapper fino: renderiza `MotoristaPerfilPage` filtrando para a view
 * "veiculo" (apenas a secao Veiculo, com tipo, placa, peso e CRLVs).
 *
 * O gating de secoes acontece via CSS em `index.css`
 * (form[data-view='veiculo'] ...) — o componente real carrega tudo, mas
 * o usuario so ve a secao do veiculo.
 */
import MotoristaPerfilPage from './MotoristaPerfilPage';

export default function MotoristaVeiculoPage() {
  return <MotoristaPerfilPage view="veiculo" />;
}
