/**
 * Rating Service
 * Avaliações de embarcadores por motoristas
 */

import { supabase } from './supabase';

export interface Rating {
  id: string;
  embarcadorId: string;
  motoristaId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  motoristaName?: string;
  motoristaPhoto?: string | null;
}

export interface CreateRatingData {
  motoristaId: string;
  embarcadorId: string;
  rating: number;
  comment?: string;
}

/**
 * Criar avaliação (motorista avalia embarcador)
 */
export async function createRating(data: CreateRatingData): Promise<Rating> {
  const { data: ratingData, error } = await supabase
    .from('avaliacoes')
    .insert({
      motorista_id: data.motoristaId,
      embarcador_id: data.embarcadorId,
      rating: data.rating,
      comment: data.comment || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Você já avaliou este embarcador');
    }
    throw new Error(`Erro ao criar avaliação: ${error.message}`);
  }

  return {
    id: ratingData.id,
    embarcadorId: ratingData.embarcador_id,
    motoristaId: ratingData.motorista_id,
    rating: ratingData.rating,
    comment: ratingData.comment,
    createdAt: new Date(ratingData.created_at),
  };
}

/**
 * Buscar avaliações de um embarcador
 */
export async function getRatingsByEmbarcador(embarcadorId: string): Promise<Rating[]> {
  const { data, error } = await supabase
    .from('avaliacoes')
    .select('*')
    .eq('embarcador_id', embarcadorId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Erro ao buscar avaliações: ${error.message}`);
  }

  return data.map((r) => ({
    id: r.id,
    embarcadorId: r.embarcador_id,
    motoristaId: r.motorista_id,
    rating: r.rating,
    comment: r.comment,
    createdAt: new Date(r.created_at),
  }));
}

/**
 * Verificar se motorista já avaliou embarcador
 */
export async function hasRated(motoristaId: string, embarcadorId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('avaliacoes')
    .select('id')
    .eq('motorista_id', motoristaId)
    .eq('embarcador_id', embarcadorId)
    .limit(1);

  if (error) return false;
  return data.length > 0;
}
