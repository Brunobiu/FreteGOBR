import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function DashboardPage() {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  // Embarcador vai pra sua página, motorista vai pra listagem de fretes
  if (user.userType === 'embarcador') {
    return <Navigate to="/embarcador" replace />;
  }

  return <Navigate to="/" replace />;
}
