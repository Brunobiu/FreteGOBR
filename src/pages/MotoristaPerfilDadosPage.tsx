/**
 * Wrapper fino: renderiza `MotoristaPerfilPage` filtrando para a view
 * "perfil" (apenas Dados Pessoais).
 *
 * O gating de secoes acontece via CSS em `index.css`
 * (form[data-view='perfil'] ...) — o componente real carrega tudo, mas
 * o usuario so ve o bloco de identidade pessoal.
 */
import MotoristaPerfilPage from './MotoristaPerfilPage';

export default function MotoristaPerfilDadosPage() {
  return <MotoristaPerfilPage view="perfil" />;
}
