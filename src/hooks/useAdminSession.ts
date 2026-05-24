/**
 * useAdminSession - hook que mantem session admin viva
 *
 * - Atualiza lastActivityAt em mousemove/keydown/scroll/touchstart (throttled 60s)
 * - Escuta storage events (logout em outra aba)
 * - Expoe session, roles, lastActivityAt, refresh, clear
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AdminSession,
  clearAdminSession,
  getAdminSession,
  updateAdminSessionActivity,
} from '../services/admin/auth';

const ACTIVITY_THROTTLE_MS = 60_000;
const SESSION_KEY = 'fretego_admin_session';
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'scroll', 'touchstart'];

export function useAdminSession() {
  const [session, setSession] = useState<AdminSession | null>(() => getAdminSession());

  const refresh = useCallback(() => {
    setSession(getAdminSession());
  }, []);

  const clear = useCallback(() => {
    clearAdminSession();
    setSession(null);
  }, []);

  useEffect(() => {
    let lastUpdate = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastUpdate < ACTIVITY_THROTTLE_MS) return;
      lastUpdate = now;
      updateAdminSessionActivity(now);
      // refresh interno do estado para que outros hooks recebam novo lastActivityAt
      setSession(getAdminSession());
    };

    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));

    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) {
        setSession(getAdminSession());
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return {
    session,
    roles: session?.roles ?? [],
    lastActivityAt: session?.lastActivityAt ?? 0,
    mfaVerified: session?.mfaVerified ?? false,
    refresh,
    clear,
  };
}
