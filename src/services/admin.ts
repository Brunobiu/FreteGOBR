/**
 * Admin Service - Métricas e gerenciamento
 */

import { supabase } from './supabase';

export interface PlatformMetrics {
  totalUsers: number;
  totalMotoristas: number;
  totalEmbarcadores: number;
  activeFretes: number;
  completedFretes: number;
  totalFretes: number;
}

export interface AdminUser {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  userType: string;
  isActive: boolean;
  createdAt: Date;
  lastActivityAt: Date | null;
}

export interface AdminFrete {
  id: string;
  embarcadorId: string;
  origin: string;
  destination: string;
  cargoType: string;
  vehicleType: string;
  status: string;
  viewsCount: number;
  clicksCount: number;
  createdAt: Date;
}

/**
 * Buscar métricas da plataforma
 */
export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  const [usersRes, motoristasRes, embarcadoresRes, fretesRes] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('motoristas').select('id', { count: 'exact', head: true }),
    supabase.from('embarcadores').select('id', { count: 'exact', head: true }),
    supabase.from('fretes').select('id, status'),
  ]);

  const fretes = fretesRes.data || [];
  return {
    totalUsers: usersRes.count || 0,
    totalMotoristas: motoristasRes.count || 0,
    totalEmbarcadores: embarcadoresRes.count || 0,
    activeFretes: fretes.filter((f) => f.status === 'ativo').length,
    completedFretes: fretes.filter((f) => f.status === 'encerrado').length,
    totalFretes: fretes.length,
  };
}

/**
 * Listar todos os usuários
 */
export async function getAdminUsers(filters?: {
  userType?: string;
  search?: string;
}): Promise<AdminUser[]> {
  let query = supabase.from('users').select('*').order('created_at', { ascending: false });

  if (filters?.userType) query = query.eq('user_type', filters.userType);
  if (filters?.search)
    query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao buscar usuários: ${error.message}`);

  return data.map((u) => ({
    id: u.id,
    phone: u.phone,
    name: u.name,
    email: u.email,
    userType: u.user_type,
    isActive: u.is_active,
    createdAt: new Date(u.created_at),
    lastActivityAt: u.last_activity_at ? new Date(u.last_activity_at) : null,
  }));
}

/**
 * Ativar/desativar usuário
 */
export async function toggleUserActive(userId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('users').update({ is_active: isActive }).eq('id', userId);
  if (error) throw new Error(`Erro: ${error.message}`);
}

/**
 * Listar todos os fretes (admin)
 */
export async function getAdminFretes(filters?: { status?: string }): Promise<AdminFrete[]> {
  let query = supabase.from('fretes').select('*').order('created_at', { ascending: false });
  if (filters?.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao buscar fretes: ${error.message}`);

  return data.map((f) => ({
    id: f.id,
    embarcadorId: f.embarcador_id,
    origin: f.origin,
    destination: f.destination,
    cargoType: f.cargo_type,
    vehicleType: f.vehicle_type,
    status: f.status,
    viewsCount: f.views_count,
    clicksCount: f.clicks_count,
    createdAt: new Date(f.created_at),
  }));
}

/**
 * Remover frete (admin)
 */
export async function adminDeleteFrete(freteId: string): Promise<void> {
  const { error } = await supabase.from('fretes').delete().eq('id', freteId);
  if (error) throw new Error(`Erro: ${error.message}`);
}
