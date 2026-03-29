/**
 * Frete Service
 * Handles freight (frete) operations
 */

import { supabase } from './supabase';
import type { GeographicPoint } from '../types';

export type FreteStatus = 'ativo' | 'encerrado' | 'cancelado';

export interface Frete {
  id: string;
  embarcadorId: string;
  origin: string;
  originLocation: GeographicPoint;
  destination: string;
  destinationLocation: GeographicPoint;
  cargoType: string;
  vehicleType: string;
  weight: number;
  value: number;
  deadline: Date;
  loadingTime: number;
  unloadingTime: number;
  specifications?: string;
  status: FreteStatus;
  viewsCount: number;
  clicksCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFreteData {
  embarcadorId: string;
  origin: string;
  originLocation: GeographicPoint;
  destination: string;
  destinationLocation: GeographicPoint;
  cargoType: string;
  vehicleType: string;
  weight: number;
  value: number;
  deadline: Date;
  loadingTime: number;
  unloadingTime: number;
  specifications?: string;
}

export interface UpdateFreteData {
  origin?: string;
  originLocation?: GeographicPoint;
  destination?: string;
  destinationLocation?: GeographicPoint;
  cargoType?: string;
  vehicleType?: string;
  weight?: number;
  value?: number;
  deadline?: Date;
  loadingTime?: number;
  unloadingTime?: number;
  specifications?: string;
  status?: FreteStatus;
}

export interface FreteFilters {
  origin?: string;
  destination?: string;
  cargoType?: string;
  vehicleType?: string;
  minWeight?: number;
  maxWeight?: number;
  minValue?: number;
  maxValue?: number;
  status?: FreteStatus;
}

/**
 * Create a new frete
 */
export async function createFrete(data: CreateFreteData): Promise<Frete> {
  const { data: freteData, error } = await supabase
    .from('fretes')
    .insert({
      embarcador_id: data.embarcadorId,
      origin: data.origin,
      origin_location: `POINT(${data.originLocation.longitude} ${data.originLocation.latitude})`,
      destination: data.destination,
      destination_location: `POINT(${data.destinationLocation.longitude} ${data.destinationLocation.latitude})`,
      cargo_type: data.cargoType,
      vehicle_type: data.vehicleType,
      weight: data.weight,
      value: data.value,
      deadline: data.deadline.toISOString().split('T')[0],
      loading_time: data.loadingTime,
      unloading_time: data.unloadingTime,
      specifications: data.specifications,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao criar frete: ${error.message}`);
  }

  return mapFreteFromDb(freteData);
}

/**
 * Update an existing frete
 */
export async function updateFrete(freteId: string, data: UpdateFreteData): Promise<void> {
  const updateData: Record<string, unknown> = {};

  if (data.origin) updateData.origin = data.origin;
  if (data.originLocation) {
    updateData.origin_location = `POINT(${data.originLocation.longitude} ${data.originLocation.latitude})`;
  }
  if (data.destination) updateData.destination = data.destination;
  if (data.destinationLocation) {
    updateData.destination_location = `POINT(${data.destinationLocation.longitude} ${data.destinationLocation.latitude})`;
  }
  if (data.cargoType) updateData.cargo_type = data.cargoType;
  if (data.vehicleType) updateData.vehicle_type = data.vehicleType;
  if (data.weight !== undefined) updateData.weight = data.weight;
  if (data.value !== undefined) updateData.value = data.value;
  if (data.deadline) updateData.deadline = data.deadline.toISOString().split('T')[0];
  if (data.loadingTime !== undefined) updateData.loading_time = data.loadingTime;
  if (data.unloadingTime !== undefined) updateData.unloading_time = data.unloadingTime;
  if (data.specifications !== undefined) updateData.specifications = data.specifications;
  if (data.status) updateData.status = data.status;

  const { error } = await supabase.from('fretes').update(updateData).eq('id', freteId);

  if (error) {
    throw new Error(`Erro ao atualizar frete: ${error.message}`);
  }
}

/**
 * Delete a frete
 */
export async function deleteFrete(freteId: string): Promise<void> {
  const { error } = await supabase.from('fretes').delete().eq('id', freteId);

  if (error) {
    throw new Error(`Erro ao deletar frete: ${error.message}`);
  }
}

/**
 * Get a frete by ID
 */
export async function getFreteById(freteId: string): Promise<Frete | null> {
  const { data, error } = await supabase.from('fretes').select('*').eq('id', freteId).single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Erro ao buscar frete: ${error.message}`);
  }

  return mapFreteFromDb(data);
}

/**
 * Get active fretes with optional filters
 */
export async function getActiveFretes(filters?: FreteFilters): Promise<Frete[]> {
  let query = supabase
    .from('fretes')
    .select('*')
    .eq('status', filters?.status || 'ativo');

  if (filters?.origin) {
    query = query.ilike('origin', `%${filters.origin}%`);
  }
  if (filters?.destination) {
    query = query.ilike('destination', `%${filters.destination}%`);
  }
  if (filters?.cargoType) {
    query = query.eq('cargo_type', filters.cargoType);
  }
  if (filters?.vehicleType) {
    query = query.eq('vehicle_type', filters.vehicleType);
  }
  if (filters?.minWeight !== undefined) {
    query = query.gte('weight', filters.minWeight);
  }
  if (filters?.maxWeight !== undefined) {
    query = query.lte('weight', filters.maxWeight);
  }
  if (filters?.minValue !== undefined) {
    query = query.gte('value', filters.minValue);
  }
  if (filters?.maxValue !== undefined) {
    query = query.lte('value', filters.maxValue);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao buscar fretes: ${error.message}`);
  }

  return data.map(mapFreteFromDb);
}

/**
 * Get fretes by embarcador ID
 */
export async function getFretesByEmbarcador(embarcadorId: string): Promise<Frete[]> {
  const { data, error } = await supabase
    .from('fretes')
    .select('*')
    .eq('embarcador_id', embarcadorId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Erro ao buscar fretes do embarcador: ${error.message}`);
  }

  return data.map(mapFreteFromDb);
}

/**
 * Record a click on a frete by a motorista
 * Uses the database function which handles both insert and counter update
 */
export async function recordFreteClick(freteId: string, motoristaId: string): Promise<boolean> {
  const { error } = await supabase.rpc('record_frete_click', {
    frete_id_param: freteId,
    motorista_id_param: motoristaId,
  });

  if (error) {
    throw new Error(`Erro ao registrar clique: ${error.message}`);
  }

  return true;
}

/**
 * Increment views count for a frete
 */
export async function incrementFreteViews(freteId: string): Promise<void> {
  const { error } = await supabase.rpc('increment_frete_views', {
    p_frete_id: freteId,
  });

  if (error) {
    throw new Error(`Erro ao incrementar visualizações: ${error.message}`);
  }
}

/**
 * Get analytics for a frete (views and clicks)
 */
export async function getFreteAnalytics(freteId: string): Promise<{
  viewsCount: number;
  clicksCount: number;
}> {
  const { data, error } = await supabase
    .from('fretes')
    .select('views_count, clicks_count')
    .eq('id', freteId)
    .single();

  if (error) {
    throw new Error(`Erro ao buscar analytics: ${error.message}`);
  }

  return {
    viewsCount: data.views_count,
    clicksCount: data.clicks_count,
  };
}

/**
 * Helper function to map database row to Frete object
 */
function mapFreteFromDb(data: {
  id: string;
  embarcador_id: string;
  origin: string;
  origin_location: string;
  destination: string;
  destination_location: string;
  cargo_type: string;
  vehicle_type: string;
  weight: number;
  value: number;
  deadline: string;
  loading_time: number;
  unloading_time: number;
  specifications: string | null;
  status: string;
  views_count: number;
  clicks_count: number;
  created_at: string;
  updated_at: string;
}): Frete {
  // Parse PostGIS POINT format: "POINT(longitude latitude)"
  const parsePoint = (pointStr: string): GeographicPoint => {
    const match = pointStr.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (!match) {
      throw new Error(`Invalid point format: ${pointStr}`);
    }
    return {
      longitude: parseFloat(match[1]),
      latitude: parseFloat(match[2]),
    };
  };

  return {
    id: data.id,
    embarcadorId: data.embarcador_id,
    origin: data.origin,
    originLocation: parsePoint(data.origin_location),
    destination: data.destination,
    destinationLocation: parsePoint(data.destination_location),
    cargoType: data.cargo_type,
    vehicleType: data.vehicle_type,
    weight: parseFloat(data.weight),
    value: parseFloat(data.value),
    deadline: new Date(data.deadline),
    loadingTime: data.loading_time,
    unloadingTime: data.unloading_time,
    specifications: data.specifications,
    status: data.status,
    viewsCount: data.views_count,
    clicksCount: data.clicks_count,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

/**
 * Find fretes near a geographic point, ordered by distance
 * Uses the find_nearby_fretes SQL function (PostGIS)
 */
export async function findNearbyFretes(
  latitude: number,
  longitude: number,
  radiusKm: number = 100
): Promise<(Frete & { distanceKm: number })[]> {
  // Call the PostGIS function
  const { data: nearbyData, error: nearbyError } = await supabase.rpc('find_nearby_fretes', {
    user_location: `POINT(${longitude} ${latitude})`,
    radius_km: radiusKm,
  });

  if (nearbyError) {
    throw new Error(`Erro ao buscar fretes próximos: ${nearbyError.message}`);
  }

  if (!nearbyData || nearbyData.length === 0) {
    return [];
  }

  // Fetch full frete data for each nearby frete
  const freteIds = nearbyData.map((r: { frete_id: string }) => r.frete_id);
  const distanceMap = new Map<string, number>(
    nearbyData.map((r: { frete_id: string; distance_km: number }) => [r.frete_id, r.distance_km])
  );

  const { data: fretesData, error: fretesError } = await supabase
    .from('fretes')
    .select('*')
    .in('id', freteIds);

  if (fretesError) {
    throw new Error(`Erro ao buscar detalhes dos fretes: ${fretesError.message}`);
  }

  return fretesData
    .map((f) => ({
      ...mapFreteFromDb(f),
      distanceKm: distanceMap.get(f.id) ?? 0,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
