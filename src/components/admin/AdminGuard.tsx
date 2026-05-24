/**
 * AdminGuard
 *
 * Em toda navegacao em /admin/* (exceto rotas publicas de auth):
 * 1. Sessao admin presente e valida
 * 2. is_superuser true
 * 3. is_active true
 * 4. roles.length > 0
 * 5. mfaVerifiedThisSession true
 *
 * Falha em qualquer etapa renderiza Stealth404 (= NotFoundPage).
 */

import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { validateAdminSession, ValidateAdminSessionResult } from '../../services/admin/auth';
import { logAdminAction } from '../../services/admin/audit';
import Stealth404 from './Stealth404';

type GuardState = { status: 'checking' } | { status: 'allowed' } | { status: 'blocked' };

export default function AdminGuard() {
  const location = useLocation();
  const [state, setState] = useState<GuardState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'checking' });

    void (async () => {
      const result: ValidateAdminSessionResult = await validateAdminSession();
      if (cancelled) return;

      if (result.isValid) {
        setState({ status: 'allowed' });
        return;
      }

      // Loga apenas se ha sessao no Supabase Auth (i.e., usuario autenticado);
      // navegacao anonima a /admin/* nao gera log (por design — stealth).
      if (result.reason && result.reason !== 'no_session') {
        try {
          await logAdminAction({
            action: 'ADMIN_STEALTH_BLOCK',
            targetType: 'route',
            targetId: location.pathname,
            after: { reason: result.reason },
          });
        } catch {
          // ignore: logAdminAction tambem exige is_superuser; se nao for, falha silenciosa
        }
      }
      setState({ status: 'blocked' });
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (state.status === 'checking') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Verificando...</div>
      </div>
    );
  }

  if (state.status === 'blocked') {
    return <Stealth404 />;
  }

  return <Outlet />;
}
