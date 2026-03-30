/**
 * Embarcador Service
 * Handles embarcador profile operations
 */

import { supabase } from './supabase';

export interface EmbarcadorProfile {
  id: string;
  userId: string;
  companyName: string;
  whatsapp?: string;
  rating: number;
  totalRatings: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateEmbarcadorProfileData {
  name?: string;
  email?: string;
  companyName?: string;
  whatsapp?: string;
}

/**
 * Get embarcador profile by user ID
 */
export async function getEmbarcadorProfile(userId: string): Promise<EmbarcadorProfile | null> {
  const { data, error } = await supabase.from('embarcadores').select('*').eq('id', userId).single();

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
    companyName: data.company_name,
    whatsapp: data.whatsapp,
    rating: data.rating,
    totalRatings: data.total_ratings,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

/**
 * Update embarcador profile
 */
export async function updateEmbarcadorProfile(
  userId: string,
  data: UpdateEmbarcadorProfileData
): Promise<void> {
  // Update user table
  const userUpdate: Record<string, string> = {};
  if (data.name !== undefined) userUpdate.name = data.name;
  if (data.email !== undefined) userUpdate.email = data.email;

  if (Object.keys(userUpdate).length > 0) {
    const { error: userError } = await supabase.from('users').update(userUpdate).eq('id', userId);
    if (userError) {
      throw new Error(`Erro ao atualizar usuário: ${userError.message}`);
    }
  }

  // Update embarcador table
  const embarcadorUpdate: Record<string, string> = {};
  if (data.companyName !== undefined) embarcadorUpdate.company_name = data.companyName;
  if (data.whatsapp !== undefined) embarcadorUpdate.whatsapp = data.whatsapp;

  if (Object.keys(embarcadorUpdate).length > 0) {
    const { error: embarcadorError } = await supabase
      .from('embarcadores')
      .update(embarcadorUpdate)
      .eq('id', userId);
    if (embarcadorError) {
      throw new Error(`Erro ao atualizar perfil do embarcador: ${embarcadorError.message}`);
    }
  }
}

/**
 * Get user data by ID
 */
export async function getUserData(userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, profile_photo_url')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(`Erro ao buscar dados do usuário: ${error.message}`);
  }

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    profilePhotoUrl: data.profile_photo_url,
  };
}

/**
 * Get public embarcador profile (for public viewing)
 */
export async function getPublicEmbarcadorProfile(embarcadorId: string) {
  const { data, error } = await supabase
    .from('embarcadores')
    .select(
      `
      id,
      company_name,
      rating,
      total_ratings,
      created_at,
      users!inner(name, profile_photo_url)
    `
    )
    .eq('id', embarcadorId)
    .single();

  if (error) {
    throw new Error(`Erro ao buscar perfil público: ${error.message}`);
  }

  const users = data.users as unknown as { name: string; profile_photo_url: string | null };

  return {
    id: data.id,
    userId: data.id,
    companyName: data.company_name,
    rating: data.rating,
    totalRatings: data.total_ratings,
    createdAt: new Date(data.created_at),
    userName: users.name,
    profilePhotoUrl: users.profile_photo_url,
  };
}

/**
 * Get embarcador ratings/reviews
 */
export async function getEmbarcadorRatings(embarcadorId: string) {
  const { data, error } = await supabase
    .from('avaliacoes')
    .select(
      `
      id,
      rating,
      comment,
      created_at,
      motoristas!inner(
        users!inner(name, profile_photo_url)
      )
    `
    )
    .eq('embarcador_id', embarcadorId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`Erro ao buscar avaliações: ${error.message}`);
  }

  return data.map((review) => {
    const motoristas = review.motoristas as unknown as {
      users: { name: string; profile_photo_url: string | null };
    };

    return {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      createdAt: new Date(review.created_at),
      motoristaName: motoristas.users.name,
      motoristaPhoto: motoristas.users.profile_photo_url,
    };
  });
}
