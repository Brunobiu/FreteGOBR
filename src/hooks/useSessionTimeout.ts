/**
 * useSessionTimeout - aviso de expiracao de sessao admin
 *
 * Modal de aviso aos 5min restantes; expirou aos 0min.
 */

import { useEffect, useState } from 'react';
import { useAdminContext } from '../components/admin/AdminProvider';

const WARNING_THRESHOLD_MS = 5 * 60 * 1000;

export function useSessionTimeout() {
  const { sessionTimeRemainingMs } = useAdminContext();
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    if (sessionTimeRemainingMs === 0) {
      setShowWarning(false);
      return;
    }
    setShowWarning(sessionTimeRemainingMs <= WARNING_THRESHOLD_MS);
  }, [sessionTimeRemainingMs]);

  return {
    sessionTimeRemainingMs,
    showWarning,
    minutesRemaining: Math.ceil(sessionTimeRemainingMs / 60_000),
    expired: sessionTimeRemainingMs === 0,
    dismissWarning: () => setShowWarning(false),
  };
}
