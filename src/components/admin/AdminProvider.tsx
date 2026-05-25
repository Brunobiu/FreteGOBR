/**
 * AdminProvider
 *
 * Context com sessao admin, papeis ativos, helper de permissao,
 * tempo restante de sessao e logout.
 *
 * Subscribe Realtime em admin_roles para reagir a revogacao
 * em tempo real.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AdminSession,
  getAdminSession,
  logoutAdmin,
  validateAdminSession,
} from '../../services/admin/auth';
import { AdminAction, AdminRole, hasPermissionForRoles } from '../../services/admin/permissions';
import { subscribeRoleChanges } from '../../services/admin/roles';
import { useAdminSession } from '../../hooks/useAdminSession';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30min

export interface AdminContextValue {
  session: AdminSession | null;
  roles: AdminRole[];
  hasPermission: (action: AdminAction | string) => boolean;
  sessionTimeRemainingMs: number;
  logout: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const { session, refresh, clear } = useAdminSession();
  const [roles, setRoles] = useState<AdminRole[]>(session?.roles ?? []);
  const [now, setNow] = useState(Date.now());
  const navigate = useNavigate();

  // Mantem roles em sincronia com session.roles (ressync quando session muda)
  useEffect(() => {
    setRoles(session?.roles ?? []);
  }, [session?.roles]);

  // No mount: revalida roles via RPC para garantir snapshot fresco do banco
  // (cobre casos onde a sessao local ficou com roles vazios apos reload)
  useEffect(() => {
    if (!session) return;
    void (async () => {
      const result = await validateAdminSession();
      if (result.isValid) setRoles(result.roles);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId]);

  // Tick de 1s pro countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Realtime: revalida ao receber mudanca de papel do usuario logado
  useEffect(() => {
    if (!session) return;
    const unsub = subscribeRoleChanges(({ userId }) => {
      if (userId !== session.userId) return;
      void refreshRoles();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId]);

  const refreshRoles = useCallback(async () => {
    const result = await validateAdminSession();
    setRoles(result.roles);
    if (!result.isValid) {
      // Revogacao em tempo real ou sessao morta -> limpa e redireciona
      clear();
      navigate('/admin/login', { replace: true });
    } else {
      refresh();
    }
  }, [clear, navigate, refresh]);

  const logout = useCallback(async () => {
    await logoutAdmin();
    clear();
    navigate('/admin/login', { replace: true });
  }, [clear, navigate]);

  const sessionTimeRemainingMs = useMemo(() => {
    if (!session) return 0;
    return Math.max(0, SESSION_TIMEOUT_MS - (now - session.lastActivityAt));
  }, [now, session]);

  // Auto-logout em inatividade
  useEffect(() => {
    if (!session) return;
    if (sessionTimeRemainingMs <= 0) {
      void logout();
    }
  }, [sessionTimeRemainingMs, session, logout]);

  const value: AdminContextValue = {
    session,
    roles,
    hasPermission: (action) => hasPermissionForRoles(roles, action),
    sessionTimeRemainingMs,
    logout,
    refreshRoles,
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminContext(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) {
    // Em rotas /admin/* o provider sempre encapsula. Se cair aqui, e bug.
    return {
      session: getAdminSession(),
      roles: [],
      hasPermission: () => false,
      sessionTimeRemainingMs: 0,
      logout: async () => {},
      refreshRoles: async () => {},
    };
  }
  return ctx;
}
