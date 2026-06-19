/**
 * Helpers de seed para testes de integração do painel admin.
 *
 * seedUser (supabaseHarness) cria o usuário em auth.users e devolve um token; o
 * gating server-side e as FKs (admin_audit_logs.admin_id, admin_roles.user_id,
 * admin_user_notes.user_id) exigem uma linha correspondente em public.users com
 * id == auth.uid(). ensureUserRow garante essa linha de forma idempotente
 * (upsert por id, ignora se já existir — cobre tanto o caso com trigger de
 * sincronização quanto sem). seedAdminRole concede um papel admin via service
 * (contorna RLS; não há trigger bloqueando INSERT direto em admin_roles).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminRole } from '../../src/services/admin/permissions';

export interface EnsureUserOptions {
  id: string;
  userType: 'motorista' | 'embarcador' | 'admin';
  name?: string;
  phone?: string;
  adminUsername?: string | null;
}

let seq = 0;

/** Garante public.users(id) (idempotente). Retorna o phone efetivo da linha. */
export async function ensureUserRow(
  svc: SupabaseClient,
  opts: EnsureUserOptions
): Promise<{ id: string; phone: string }> {
  seq += 1;
  const phone = opts.phone ?? `5562${String(900000000 + ((Date.now() + seq) % 99999999))}`;
  await svc.from('users').upsert(
    {
      id: opts.id,
      phone,
      password_hash: 'test-hash-not-a-secret',
      user_type: opts.userType,
      name: opts.name ?? `Teste C360 ${opts.id.slice(0, 6)}`,
      email: `c360-${opts.id.slice(0, 8)}@teste.com`,
      admin_username: opts.adminUsername ?? null,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  const { data } = await svc.from('users').select('phone').eq('id', opts.id).maybeSingle();
  return { id: opts.id, phone: ((data as { phone?: string } | null)?.phone ?? phone) as string };
}

/** Concede um papel admin (self-granted) via service. */
export async function seedAdminRole(
  svc: SupabaseClient,
  userId: string,
  role: AdminRole
): Promise<void> {
  await svc.from('admin_roles').insert({ user_id: userId, role, granted_by: userId });
}

/** Remove papéis e a linha public.users criada para o teste (cascateia notas). */
export async function cleanupUserRow(svc: SupabaseClient, userId: string): Promise<void> {
  await svc.from('admin_roles').delete().eq('user_id', userId);
  await svc.from('users').delete().eq('id', userId);
}
