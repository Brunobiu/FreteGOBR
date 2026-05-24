/**
 * admin/roles.ts
 *
 * CRUD basico de papeis admin (admin_roles) com audit-by-construction.
 */

import { supabase } from '../supabase';
import { executeAdminMutation } from './audit';
import type { AdminRole } from './permissions';

export interface AdminUser {
  id: string;
  name: string;
  admin_username: string | null;
  is_active: boolean;
  is_superuser: boolean;
  roles: AdminRole[];
}

export async function listAdmins(): Promise<AdminUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, admin_username, is_active, is_superuser')
    .eq('is_superuser', true)
    .order('name', { ascending: true });
  if (error) throw error;

  const admins = data ?? [];
  if (admins.length === 0) return [];

  const ids = admins.map((a) => a.id);
  const { data: rolesData } = await supabase
    .from('admin_roles')
    .select('user_id, role')
    .in('user_id', ids)
    .is('revoked_at', null);

  const rolesByUser = new Map<string, AdminRole[]>();
  for (const r of rolesData ?? []) {
    const arr = rolesByUser.get(r.user_id as string) ?? [];
    arr.push(r.role as AdminRole);
    rolesByUser.set(r.user_id as string, arr);
  }

  return admins.map((a) => ({
    id: a.id,
    name: a.name,
    admin_username: a.admin_username,
    is_active: a.is_active,
    is_superuser: a.is_superuser,
    roles: rolesByUser.get(a.id) ?? [],
  }));
}

export async function grantRole(userId: string, role: AdminRole): Promise<void> {
  await executeAdminMutation(
    {
      action: 'ADMIN_ROLE_GRANTED',
      targetType: 'admin_roles',
      targetId: userId,
      after: { role },
    },
    async () => {
      const { error } = await supabase.from('admin_roles').insert({
        user_id: userId,
        role,
        granted_by: (await supabase.auth.getUser()).data.user?.id,
      });
      if (error) throw error;
    }
  );
}

export async function revokeRole(userId: string, role: AdminRole): Promise<void> {
  await executeAdminMutation(
    {
      action: 'ADMIN_ROLE_REVOKED',
      targetType: 'admin_roles',
      targetId: userId,
      before: { role },
    },
    async () => {
      const revokerId = (await supabase.auth.getUser()).data.user?.id;
      const { error } = await supabase
        .from('admin_roles')
        .update({ revoked_at: new Date().toISOString(), revoked_by: revokerId })
        .eq('user_id', userId)
        .eq('role', role)
        .is('revoked_at', null);
      if (error) throw error;
    }
  );
}

export type RoleChangeCallback = (payload: {
  userId: string;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
}) => void;

export function subscribeRoleChanges(callback: RoleChangeCallback): () => void {
  const channel = supabase
    .channel('admin_roles_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_roles' }, (payload) => {
      const row = (payload.new ?? payload.old) as { user_id?: string } | null;
      if (!row?.user_id) return;
      callback({ userId: row.user_id, type: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE' });
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
