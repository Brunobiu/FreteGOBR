/**
 * Motorista Service
 * Handles motorista profile operations
 */

import { supabase } from './supabase';

export interface MotoristaProfile {
  id: string;
  userId: string;
  vehicleType: string;
  vehiclePlate?: string;
  vehicleModel?: string;
  vehicleYear?: number;
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
}

/**
 * Get motorista profile by user ID
 */
export async function getMotoristaProfile(userId: string): Promise<MotoristaProfile | null> {
  const { data, error } = await supabase.from('motoristas').select('*').eq('id', userId).single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw new Error(`Erro ao buscar perfil: ${error.message}`);
  }

  return {
    id: data.id,
    userId: data.id,
    vehicleType: data.vehicle_type,
    vehiclePlate: data.vehicle_plate,
    vehicleModel: data.vehicle_model,
    vehicleYear: data.vehicle_year,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

/**
 * Update motorista profile
 */
export async function updateMotoristaProfile(
  userId: string,
  data: UpdateMotoristaProfileData
): Promise<void> {
  // Update user table
  const userUpdate: Record<string, string> = {};
  if (data.name !== undefined) userUpdate.name = data.name;
  if (data.email !== undefined) userUpdate.email = data.email;
  if (data.cpf !== undefined) userUpdate.cpf = data.cpf;

  if (Object.keys(userUpdate).length > 0) {
    const { error: userError } = await supabase.from('users').update(userUpdate).eq('id', userId);
    if (userError) {
      throw new Error(`Erro ao atualizar usuário: ${userError.message}`);
    }
  }

  // Update motorista table
  const motoristaUpdate: Record<string, string | number> = {};
  if (data.vehicleType !== undefined) motoristaUpdate.vehicle_type = data.vehicleType;
  if (data.vehiclePlate !== undefined) motoristaUpdate.vehicle_plate = data.vehiclePlate;
  if (data.vehicleModel !== undefined) motoristaUpdate.vehicle_model = data.vehicleModel;
  if (data.vehicleYear !== undefined) motoristaUpdate.vehicle_year = data.vehicleYear;

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
 * Get user data by ID
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
