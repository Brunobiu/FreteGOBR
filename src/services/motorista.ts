/**
 * Motorista Service
 *
 * Operações de perfil do motorista. Estendido pela feature
 * `motorista-onboarding-painel` com novos campos operacionais
 * (km/l, eixos, capacidade, valor do diesel, anos separados,
 * flag de proprietário) e funções específicas para o painel
 * de fretes.
 *
 * IMPORTANTE: assinaturas públicas (getMotoristaProfile,
 * updateMotoristaProfile, getUserData) NÃO mudam — apenas ganham
 * suporte a novos campos opcionais.
 */

import { supabase } from './supabase';
import { capitalizeName } from '../utils/textCase';

export interface MotoristaProfile {
  id: string;
  userId: string;
  vehicleType: string;
  vehiclePlate?: string;
  vehicleModel?: string;
  /** Coluna legado preservada para retrocompatibilidade. */
  vehicleYear?: number;
  // === Campos novos (Migration 017) ============================================
  vehicleYearManufacture?: number;
  vehicleYearModel?: number;
  kmPerLiter?: number;
  trailerAxles?: number;
  cargoCapacityTon?: number;
  dieselPrice?: number;
  isOwner?: boolean;
  // =============================================================================
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateMotoristaProfileData {
  name?: string;
  email?: string;
  cpf?: string;
  vehicleType?: string;
  vehiclePlate?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  // === Campos novos ===========================================================
  vehicleYearManufacture?: number;
  vehicleYearModel?: number;
  kmPerLiter?: number;
  trailerAxles?: number;
  cargoCapacityTon?: number;
  dieselPrice?: number;
  isOwner?: boolean;
}

/**
 * Contexto reduzido usado pelo painel de fretes do motorista para
 * fazer cálculos financeiros ao vivo.
 */
export interface MotoristaCalcContext {
  kmPerLiter: number | null;
  dieselPrice: number | null;
}

/**
 * Get motorista profile by user ID.
 */
export async function getMotoristaProfile(userId: string): Promise<MotoristaProfile | null> {
  const { data, error } = await supabase.from('motoristas').select('*').eq('id', userId).single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Erro ao buscar perfil: ${error.message}`);
  }

  return {
    id: data.id,
    userId: data.id,
    vehicleType: data.vehicle_type,
    vehiclePlate: data.vehicle_plate ?? undefined,
    vehicleModel: data.vehicle_model ?? undefined,
    vehicleYear: data.vehicle_year ?? undefined,
    vehicleYearManufacture: data.vehicle_year_manufacture ?? undefined,
    vehicleYearModel: data.vehicle_year_model ?? undefined,
    kmPerLiter:
      data.km_per_liter !== null && data.km_per_liter !== undefined
        ? Number(data.km_per_liter)
        : undefined,
    trailerAxles: data.trailer_axles ?? undefined,
    cargoCapacityTon:
      data.cargo_capacity_ton !== null && data.cargo_capacity_ton !== undefined
        ? Number(data.cargo_capacity_ton)
        : undefined,
    dieselPrice:
      data.diesel_price !== null && data.diesel_price !== undefined
        ? Number(data.diesel_price)
        : undefined,
    isOwner: data.is_owner ?? undefined,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

/**
 * Update motorista profile.
 *
 * Aplica `capitalizeName` no campo `name` como defesa em profundidade
 * (a UI já faz isso no `onBlur`, mas garantimos no service também).
 */
export async function updateMotoristaProfile(
  userId: string,
  data: UpdateMotoristaProfileData
): Promise<void> {
  // Update user table
  const userUpdate: Record<string, string> = {};
  if (data.name !== undefined) userUpdate.name = capitalizeName(data.name);
  if (data.email !== undefined) userUpdate.email = data.email;
  if (data.cpf !== undefined) userUpdate.cpf = data.cpf;

  if (Object.keys(userUpdate).length > 0) {
    const { error: userError } = await supabase.from('users').update(userUpdate).eq('id', userId);
    if (userError) {
      throw new Error(`Erro ao atualizar usuário: ${userError.message}`);
    }
  }

  // Update motorista table
  const motoristaUpdate: Record<string, string | number | boolean | null> = {};
  if (data.vehicleType !== undefined) motoristaUpdate.vehicle_type = data.vehicleType;
  if (data.vehiclePlate !== undefined) motoristaUpdate.vehicle_plate = data.vehiclePlate;
  if (data.vehicleModel !== undefined) motoristaUpdate.vehicle_model = data.vehicleModel;
  if (data.vehicleYear !== undefined) motoristaUpdate.vehicle_year = data.vehicleYear;
  if (data.vehicleYearManufacture !== undefined)
    motoristaUpdate.vehicle_year_manufacture = data.vehicleYearManufacture;
  if (data.vehicleYearModel !== undefined)
    motoristaUpdate.vehicle_year_model = data.vehicleYearModel;
  if (data.kmPerLiter !== undefined) motoristaUpdate.km_per_liter = data.kmPerLiter;
  if (data.trailerAxles !== undefined) motoristaUpdate.trailer_axles = data.trailerAxles;
  if (data.cargoCapacityTon !== undefined)
    motoristaUpdate.cargo_capacity_ton = data.cargoCapacityTon;
  if (data.dieselPrice !== undefined) motoristaUpdate.diesel_price = data.dieselPrice;
  if (data.isOwner !== undefined) motoristaUpdate.is_owner = data.isOwner;

  if (Object.keys(motoristaUpdate).length > 0) {
    const { error: motoristaError } = await supabase
      .from('motoristas')
      .update(motoristaUpdate)
      .eq('id', userId);
    if (motoristaError) {
      throw new Error(`Erro ao atualizar perfil do motorista: ${motoristaError.message}`);
    }
  }
}

/**
 * Atualização rápida do valor do diesel — usada pelo input
 * `DieselDashboardInput` no header do painel do motorista.
 */
export async function updateDieselPrice(userId: string, price: number): Promise<void> {
  const { error } = await supabase
    .from('motoristas')
    .update({ diesel_price: price })
    .eq('id', userId);
  if (error) {
    throw new Error(`Erro ao atualizar valor do diesel: ${error.message}`);
  }
}

/**
 * Lê apenas os campos necessários para o cálculo financeiro no painel
 * do motorista. Mais leve que `getMotoristaProfile`.
 */
export async function getMotoristaCalcContext(userId: string): Promise<MotoristaCalcContext> {
  const { data, error } = await supabase
    .from('motoristas')
    .select('km_per_liter, diesel_price')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { kmPerLiter: null, dieselPrice: null };
  }
  if (!data) {
    return { kmPerLiter: null, dieselPrice: null };
  }

  return {
    kmPerLiter:
      data.km_per_liter !== null && data.km_per_liter !== undefined
        ? Number(data.km_per_liter)
        : null,
    dieselPrice:
      data.diesel_price !== null && data.diesel_price !== undefined
        ? Number(data.diesel_price)
        : null,
  };
}

/**
 * Get user data by ID (mantido como estava — apenas leitura).
 */
export async function getUserData(userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, cpf, profile_photo_url')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(`Erro ao buscar dados do usuário: ${error.message}`);
  }

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    cpf: data.cpf,
    profilePhotoUrl: data.profile_photo_url,
  };
}
