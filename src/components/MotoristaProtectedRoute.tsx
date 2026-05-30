/**
 * MotoristaProtectedRoute + TrialGate — bloqueio de rotas de motorista (FreteGO).
 *
 * `TrialGate` é o portão de trial: consome `useTrialStatus()` e, quando o
 * motorista está bloqueado (`isExpired === true`), renderiza a
 * `TrialExpiredPage` **no lugar** do conteúdo. Caso contrário, repassa
 * `children`. É inerte para embarcadores/admins, pois `useTrialStatus`
 * retorna `isExpired: false` para esses tipos (Req 7).
 *
 * `MotoristaProtectedRoute` compõe o `ProtectedRoute` existente (autenticação)
 * com o `TrialGate` (bloqueio de trial), sem reimplementar nenhuma das duas
 * responsabilidades.
 *
 * Requirements: 5.2, 5.7
 */

import { ProtectedRoute } from './ProtectedRoute';
import { useTrialStatus } from '../hooks/useTrialStatus';
import TrialExpiredPage from '../pages/TrialExpiredPage';

interface TrialGateProps {
  children: React.ReactNode;
}

/**
 * Portão de trial: exibe `TrialExpiredPage` para motorista bloqueado, senão
 * renderiza o conteúdo. Assume usuário já autenticado (ver
 * `MotoristaProtectedRoute`).
 */
export function TrialGate({ children }: TrialGateProps) {
  const { isExpired } = useTrialStatus();

  if (isExpired) {
    return <TrialExpiredPage />;
  }

  return <>{children}</>;
}

interface MotoristaProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Rota protegida de motorista: exige autenticação (`ProtectedRoute`) e aplica
 * o bloqueio de trial (`TrialGate`).
 */
export function MotoristaProtectedRoute({ children }: MotoristaProtectedRouteProps) {
  return (
    <ProtectedRoute>
      <TrialGate>{children}</TrialGate>
    </ProtectedRoute>
  );
}
