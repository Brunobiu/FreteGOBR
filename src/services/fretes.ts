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
  product?: string;
  cargoSpecies?: string;
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
  // Campos estendidos (Migration 014)
  onuNumber?: string;
  temperature?: number;
  weightUnit?: string;
  freightType?: string;
  occupancyPercentage?: number;
  bodyTypes?: string;
  requiresLona?: boolean;
  requiresTracker?: boolean;
  requiresInsurance?: boolean;
  valueKnown?: boolean;
  priceCalculation?: string;
  paymentMethods?: string;
  advancePercentage?: number;
  // Distância calculada (Migration 015)
  distanceKm?: number;
  // Detalhes de carregamento e entrega (Migration 019) — texto livre
  // exibido apenas no modal de detalhes (não no card resumido).
  originDetail?: string;
  destinationDetail?: string;
  // Coordenadas exatas opcionais (Migration 020) — pin GPS para abrir
  // num app de mapa.
  originPinnedLat?: number;
  originPinnedLng?: number;
  destinationPinnedLat?: number;
  destinationPinnedLng?: number;
}

export interface CreateFreteData {
  embarcadorId: string;
  origin: string;
  originLocation: GeographicPoint;
  destination: string;
  destinationLocation: GeographicPoint;
  cargoType: string;
  product?: string;
  cargoSpecies?: string;
  vehicleType: string;
  weight: number;
  value: number;
  deadline: Date;
  loadingTime: number;
  unloadingTime: number;
  specifications?: string;
  // Campos estendidos
  onuNumber?: string;
  temperature?: number;
  weightUnit?: string;
  freightType?: string;
  occupancyPercentage?: number;
  bodyTypes?: string;
  requiresLona?: boolean;
  requiresTracker?: boolean;
  requiresInsurance?: boolean;
  valueKnown?: boolean;
  priceCalculation?: string;
  paymentMethods?: string;
  advancePercentage?: number;
  distanceKm?: number;
  originDetail?: string;
  destinationDetail?: string;
  originPinnedLat?: number;
  originPinnedLng?: number;
  destinationPinnedLat?: number;
  destinationPinnedLng?: number;
}

export interface UpdateFreteData {
  origin?: string;
  originLocation?: GeographicPoint;
  destination?: string;
  destinationLocation?: GeographicPoint;
  cargoType?: string;
  product?: string;
  cargoSpecies?: string;
  vehicleType?: string;
  weight?: number;
  value?: number;
  deadline?: Date;
  loadingTime?: number;
  unloadingTime?: number;
  specifications?: string;
  status?: FreteStatus;
  // Campos estendidos
  onuNumber?: string;
  temperature?: number;
  weightUnit?: string;
  freightType?: string;
  occupancyPercentage?: number;
  bodyTypes?: string;
  requiresLona?: boolean;
  requiresTracker?: boolean;
  requiresInsurance?: boolean;
  valueKnown?: boolean;
  priceCalculation?: string;
  paymentMethods?: string;
  advancePercentage?: number;
  distanceKm?: number;
  originDetail?: string;
  destinationDetail?: string;
  originPinnedLat?: number;
  originPinnedLng?: number;
  destinationPinnedLat?: number;
  destinationPinnedLng?: number;
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
  // Guard: cadastro do embarcador precisa estar 100% completo.
  // Embora a RLS já bloqueie no banco, validamos antes para retornar
  // mensagem clara ao usuário.
  const { getEmbarcadorOnboardingProgress } = await import('./embarcador');
  const progress = await getEmbarcadorOnboardingProgress(data.embarcadorId);
  if (progress.percent < 100) {
    throw new Error('Cadastro incompleto. Verifique e-mail, foto e logo da empresa.');
  }

  const { data: freteData, error } = await supabase
    .from('fretes')
    .insert({
      embarcador_id: data.embarcadorId,
      origin: data.origin,
      origin_location: `POINT(${data.originLocation.longitude} ${data.originLocation.latitude})`,
      destination: data.destination,
      destination_location: `POINT(${data.destinationLocation.longitude} ${data.destinationLocation.latitude})`,
      cargo_type: data.cargoType,
      product: data.product ?? null,
      cargo_species: data.cargoSpecies ?? null,
      vehicle_type: data.vehicleType,
      weight: data.weight,
      value: data.value,
      deadline: data.deadline.toISOString().split('T')[0],
      loading_time: data.loadingTime,
      unloading_time: data.unloadingTime,
      specifications: data.specifications,
      onu_number: data.onuNumber ?? null,
      temperature: data.temperature ?? null,
      weight_unit: data.weightUnit ?? null,
      freight_type: data.freightType ?? null,
      occupancy_percentage: data.occupancyPercentage ?? null,
      body_types: data.bodyTypes ?? null,
      requires_lona: data.requiresLona ?? false,
      requires_tracker: data.requiresTracker ?? false,
      requires_insurance: data.requiresInsurance ?? false,
      value_known: data.valueKnown ?? true,
      price_calculation: data.priceCalculation ?? null,
      payment_methods: data.paymentMethods ?? null,
      advance_percentage: data.advancePercentage ?? null,
      distance_km: data.distanceKm ?? null,
      origin_detail: data.originDetail ?? null,
      destination_detail: data.destinationDetail ?? null,
      origin_pinned_lat: data.originPinnedLat ?? null,
      origin_pinned_lng: data.originPinnedLng ?? null,
      destination_pinned_lat: data.destinationPinnedLat ?? null,
      destination_pinned_lng: data.destinationPinnedLng ?? null,
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
  if (data.product !== undefined) updateData.product = data.product;
  if (data.cargoSpecies !== undefined) updateData.cargo_species = data.cargoSpecies;
  if (data.vehicleType) updateData.vehicle_type = data.vehicleType;
  if (data.weight !== undefined) updateData.weight = data.weight;
  if (data.value !== undefined) updateData.value = data.value;
  if (data.deadline) updateData.deadline = data.deadline.toISOString().split('T')[0];
  if (data.loadingTime !== undefined) updateData.loading_time = data.loadingTime;
  if (data.unloadingTime !== undefined) updateData.unloading_time = data.unloadingTime;
  if (data.specifications !== undefined) updateData.specifications = data.specifications;
  if (data.status) updateData.status = data.status;
  if (data.onuNumber !== undefined) updateData.onu_number = data.onuNumber;
  if (data.temperature !== undefined) updateData.temperature = data.temperature;
  if (data.weightUnit !== undefined) updateData.weight_unit = data.weightUnit;
  if (data.freightType !== undefined) updateData.freight_type = data.freightType;
  if (data.occupancyPercentage !== undefined)
    updateData.occupancy_percentage = data.occupancyPercentage;
  if (data.bodyTypes !== undefined) updateData.body_types = data.bodyTypes;
  if (data.requiresLona !== undefined) updateData.requires_lona = data.requiresLona;
  if (data.requiresTracker !== undefined) updateData.requires_tracker = data.requiresTracker;
  if (data.requiresInsurance !== undefined) updateData.requires_insurance = data.requiresInsurance;
  if (data.valueKnown !== undefined) updateData.value_known = data.valueKnown;
  if (data.priceCalculation !== undefined) updateData.price_calculation = data.priceCalculation;
  if (data.paymentMethods !== undefined) updateData.payment_methods = data.paymentMethods;
  if (data.advancePercentage !== undefined) updateData.advance_percentage = data.advancePercentage;
  if (data.distanceKm !== undefined) updateData.distance_km = data.distanceKm;
  if (data.originDetail !== undefined) updateData.origin_detail = data.originDetail;
  if (data.destinationDetail !== undefined)
    updateData.destination_detail = data.destinationDetail;
  if (data.originPinnedLat !== undefined)
    updateData.origin_pinned_lat = data.originPinnedLat;
  if (data.originPinnedLng !== undefined)
    updateData.origin_pinned_lng = data.originPinnedLng;
  if (data.destinationPinnedLat !== undefined)
    updateData.destination_pinned_lat = data.destinationPinnedLat;
  if (data.destinationPinnedLng !== undefined)
    updateData.destination_pinned_lng = data.destinationPinnedLng;

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
    // Bug 8 — propagar erros com log estruturado em vez de mascarar
    // a falha retornando array vazio. A UI deve capturar e exibir
    // mensagem amigável ao usuário (ErrorBoundary já existe).
    console.error('[FRETES] getActiveFretes failed', {
      code: error.code,
      message: error.message,
      filters,
    });
    throw new Error(`Erro ao buscar fretes: ${error.message}`);
  }

  return (data || []).map(mapFreteFromDb);
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
    frete_id_param: freteId,
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
function mapFreteFromDb(
  data: {
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
  } & Record<string, unknown>
): Frete {
  // Atalho para campos estendidos (Migration 014) que podem ou não existir
  const extra = data as unknown as {
    onu_number?: string | null;
    temperature?: number | string | null;
    weight_unit?: string | null;
    freight_type?: string | null;
    occupancy_percentage?: number | null;
    body_types?: string | null;
    requires_lona?: boolean | null;
    requires_tracker?: boolean | null;
    requires_insurance?: boolean | null;
    value_known?: boolean | null;
    price_calculation?: string | null;
    payment_methods?: string | null;
    advance_percentage?: number | null;
    distance_km?: number | null;
    origin_detail?: string | null;
    destination_detail?: string | null;
    origin_pinned_lat?: number | null;
    origin_pinned_lng?: number | null;
    destination_pinned_lat?: number | null;
    destination_pinned_lng?: number | null;
  };
  // Parse PostGIS POINT format: "POINT(longitude latitude)" or WKB hex
  const parsePoint = (pointStr: string): GeographicPoint => {
    // Try text format first: POINT(lng lat)
    const match = pointStr.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (match) {
      return {
        longitude: parseFloat(match[1]),
        latitude: parseFloat(match[2]),
      };
    }

    // Try WKB hex format (PostGIS binary)
    if (/^[0-9a-fA-F]+$/.test(pointStr) && pointStr.length >= 42) {
      try {
        // WKB POINT: byte order (2) + type (8) + SRID (8 optional) + X (16) + Y (16)
        const isLittleEndian = pointStr.substring(0, 2) === '01';
        let offset = 2; // skip byte order

        // Check if EWKB (has SRID flag)
        const typeHex = pointStr.substring(offset, offset + 8);
        offset += 8;

        // Parse type to check for SRID
        const typeInt = isLittleEndian
          ? parseInt(typeHex.match(/../g)!.reverse().join(''), 16)
          : parseInt(typeHex, 16);

        if (typeInt & 0x20000000) {
          offset += 8; // skip SRID (4 bytes = 8 hex chars)
        }

        const xHex = pointStr.substring(offset, offset + 16);
        offset += 16;
        const yHex = pointStr.substring(offset, offset + 16);

        const parseDouble = (hex: string, le: boolean): number => {
          const bytes = hex.match(/../g)!;
          if (le) bytes.reverse();
          const buf = new ArrayBuffer(8);
          const view = new DataView(buf);
          bytes.forEach((b, i) => view.setUint8(i, parseInt(b, 16)));
          return view.getFloat64(0);
        };

        const lng = parseDouble(xHex, isLittleEndian);
        const lat = parseDouble(yHex, isLittleEndian);

        if (!isNaN(lng) && !isNaN(lat)) {
          return { longitude: lng, latitude: lat };
        }
      } catch {
        // Fall through to default
      }
    }

    // Default fallback
    return { longitude: 0, latitude: 0 };
  };

  return {
    id: data.id,
    embarcadorId: data.embarcador_id,
    origin: data.origin,
    originLocation: parsePoint(data.origin_location),
    destination: data.destination,
    destinationLocation: parsePoint(data.destination_location),
    cargoType: data.cargo_type,
    product: (data as unknown as { product?: string | null }).product ?? undefined,
    cargoSpecies: (data as unknown as { cargo_species?: string | null }).cargo_species ?? undefined,
    vehicleType: data.vehicle_type,
    weight: typeof data.weight === 'string' ? parseFloat(data.weight) : data.weight,
    value: typeof data.value === 'string' ? parseFloat(data.value) : data.value,
    deadline: new Date(data.deadline),
    loadingTime: data.loading_time,
    unloadingTime: data.unloading_time,
    specifications: data.specifications ?? undefined,
    status: data.status as FreteStatus,
    viewsCount: data.views_count,
    clicksCount: data.clicks_count,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    // Campos estendidos
    onuNumber: extra.onu_number ?? undefined,
    temperature:
      extra.temperature !== null && extra.temperature !== undefined
        ? Number(extra.temperature)
        : undefined,
    weightUnit: extra.weight_unit ?? undefined,
    freightType: extra.freight_type ?? undefined,
    occupancyPercentage: extra.occupancy_percentage ?? undefined,
    bodyTypes: extra.body_types ?? undefined,
    requiresLona: extra.requires_lona ?? false,
    requiresTracker: extra.requires_tracker ?? false,
    requiresInsurance: extra.requires_insurance ?? false,
    valueKnown: extra.value_known ?? true,
    priceCalculation: extra.price_calculation ?? undefined,
    paymentMethods: extra.payment_methods ?? undefined,
    advancePercentage: extra.advance_percentage ?? undefined,
    distanceKm: extra.distance_km ?? undefined,
    originDetail: extra.origin_detail ?? undefined,
    destinationDetail: extra.destination_detail ?? undefined,
    originPinnedLat: extra.origin_pinned_lat ?? undefined,
    originPinnedLng: extra.origin_pinned_lng ?? undefined,
    destinationPinnedLat: extra.destination_pinned_lat ?? undefined,
    destinationPinnedLng: extra.destination_pinned_lng ?? undefined,
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
