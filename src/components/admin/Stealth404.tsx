/**
 * Stealth404
 *
 * Re-export literal de NotFoundPage. Garante CP-11 por construcao:
 * usuario nao distingue uma rota /admin/* sem permissao de uma rota
 * inexistente do app.
 */

import NotFoundPage from '../../pages/NotFoundPage';

export default function Stealth404() {
  return <NotFoundPage />;
}
