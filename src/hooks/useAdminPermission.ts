/**
 * useAdminPermission - hook reativo de permissao
 */

import { useAdminContext } from '../components/admin/AdminProvider';
import type { AdminAction } from '../services/admin/permissions';

export function useAdminPermission(action: AdminAction | string): {
  allowed: boolean;
  roles: string[];
} {
  const ctx = useAdminContext();
  return {
    allowed: ctx.hasPermission(action),
    roles: ctx.roles,
  };
}
