// ============================================================================
// freightContext.ts — Context Builder para o motorista-ai-chat
// ============================================================================
// Monta o contexto de fretes disponiveis baseado na localizacao do motorista.
// Calcula distancia via haversine, lucro liquido e lucro/km para cada frete.
// ============================================================================

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ===================== Interfaces ===========================================

export interface FreightContextItem {
  id: string;
  origin: string;
  destination: string;
  originState: string;
  destinationState: string;
  distanceKm: number;
  distanceToOriginKm: number | null;
  value: number;
  lucroLiquido: number | null;
  lucroPorKm: number | null;
  product: string | null;
  weight: number | null;
}

export interface FreightContextResult {
  items: FreightContextItem[];
  calcIncomplete: boolean;
  locationAvailable: boolean;
  radiusUsedKm: number;
  expandedSearch: boolean;
}

// ===================== Haversine ============================================

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ===================== Builder principal ====================================

interface BuildFreightContextParams {
  sb: SupabaseClient;
  userId: string;
  /** Localizacao explicitamente enviada pelo motorista (opcional). */
  locationOverride?: { lat: number; lng: number } | null;
}

export async function buildFreightContext(
  params: BuildFreightContextParams
): Promise<FreightContextResult> {
  const { sb, userId, locationOverride } = params;

  // 1. Ler dados do motorista
  const { data: motorista } = await sb
    .from('motoristas')
    .select('km_per_liter, diesel_price, cargo_capacity_ton, lat, lng, search_radius_km')
    .eq('user_id', userId)
    .maybeSingle();

  // Localização efetiva: override > motorista.lat/lng
  let lat: number | null = locationOverride?.lat ?? null;
  let lng: number | null = locationOverride?.lng ?? null;

  if (lat === null || lng === null) {
    lat = motorista?.lat ?? null;
    lng = motorista?.lng ?? null;
  }

  const locationAvailable = lat !== null && lng !== null;

  // Dados de cálculo
  const kmPerLiter: number | null = motorista?.km_per_liter ?? null;
  const dieselPrice: number | null = motorista?.diesel_price ?? null;
  const calcIncomplete = kmPerLiter === null || dieselPrice === null;

  // Raio padrão
  const defaultRadius = motorista?.search_radius_km ?? 200;

  // 2. Buscar fretes ativos
  const { data: fretes } = await sb
    .from('fretes')
    .select(
      'id, origin, destination, origin_lat, origin_lng, destination_lat, destination_lng, distance_km, value, product_name, weight_tons, origin_state, destination_state'
    )
    .eq('status', 'ativo');

  if (!fretes || fretes.length === 0) {
    return {
      items: [],
      calcIncomplete,
      locationAvailable,
      radiusUsedKm: defaultRadius,
      expandedSearch: false,
    };
  }

  // 3. Filtrar por distância (se localização disponível)
  let radiusUsedKm = defaultRadius;
  let expandedSearch = false;
  let filtered: typeof fretes;

  if (locationAvailable && lat !== null && lng !== null) {
    // Filtro inicial pelo raio padrão
    filtered = fretes.filter((f) => {
      if (f.origin_lat == null || f.origin_lng == null) return false;
      const dist = haversineKm(lat!, lng!, f.origin_lat, f.origin_lng);
      return dist <= defaultRadius;
    });

    // Se não encontrou nenhum, expandir para 500km
    if (filtered.length === 0) {
      radiusUsedKm = 500;
      expandedSearch = true;
      filtered = fretes.filter((f) => {
        if (f.origin_lat == null || f.origin_lng == null) return false;
        const dist = haversineKm(lat!, lng!, f.origin_lat, f.origin_lng);
        return dist <= 500;
      });
    }
  } else {
    // Sem localização: retornar todos (limitados ao max)
    filtered = fretes;
  }

  // 4. Montar items com cálculos
  const items: FreightContextItem[] = filtered.map((f) => {
    // Distância do motorista até a origem do frete
    let distanceToOriginKm: number | null = null;
    if (
      locationAvailable &&
      lat !== null &&
      lng !== null &&
      f.origin_lat != null &&
      f.origin_lng != null
    ) {
      distanceToOriginKm = Math.round(haversineKm(lat, lng, f.origin_lat, f.origin_lng));
    }

    // Distância total do frete (usa a coluna ou calcula via haversine)
    let distanceKm: number = f.distance_km ?? 0;
    if (
      !distanceKm &&
      f.origin_lat != null &&
      f.origin_lng != null &&
      f.destination_lat != null &&
      f.destination_lng != null
    ) {
      distanceKm = Math.round(
        haversineKm(f.origin_lat, f.origin_lng, f.destination_lat, f.destination_lng)
      );
    }

    // Cálculos de lucro
    let lucroLiquido: number | null = null;
    let lucroPorKm: number | null = null;

    if (!calcIncomplete && distanceKm > 0 && kmPerLiter !== null && dieselPrice !== null) {
      const custoDiesel = (distanceKm / kmPerLiter) * dieselPrice;
      lucroLiquido = Math.round((f.value - custoDiesel) * 100) / 100;
      lucroPorKm = Math.round((lucroLiquido / distanceKm) * 100) / 100;
    }

    return {
      id: f.id,
      origin: f.origin ?? '',
      destination: f.destination ?? '',
      originState: f.origin_state ?? '',
      destinationState: f.destination_state ?? '',
      distanceKm,
      distanceToOriginKm,
      value: f.value ?? 0,
      lucroLiquido,
      lucroPorKm,
      product: f.product_name ?? null,
      weight: f.weight_tons ?? null,
    };
  });

  // 5. Ordenar por lucroPorKm DESC (null vai pro final)
  items.sort((a, b) => {
    if (a.lucroPorKm === null && b.lucroPorKm === null) return 0;
    if (a.lucroPorKm === null) return 1;
    if (b.lucroPorKm === null) return -1;
    return b.lucroPorKm - a.lucroPorKm;
  });

  // 6. Limitar a 20 itens
  const limited = items.slice(0, 20);

  return {
    items: limited,
    calcIncomplete,
    locationAvailable,
    radiusUsedKm,
    expandedSearch,
  };
}
