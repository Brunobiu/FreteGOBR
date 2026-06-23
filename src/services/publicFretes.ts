/**
 * publicFretes — leitura enxuta de fretes ativos para a LANDING pública
 * (pré-login). Reaproveita `getActiveFretes()` (a RLS já permite leitura
 * anônima de fretes ativos) e expõe apenas campos NÃO sensíveis: rota,
 * coordenada de origem, tipo de carga/veículo, quando foi postado e a origem
 * (embarcador/comunidade).
 *
 * Decisão de privacidade: o VALOR do frete NÃO é exposto aqui — segue a mesma
 * regra do feed, que esconde o valor de quem não está logado ("Login para
 * ver"). A landing é vitrine de movimento ("tempo real"), não de preços.
 *
 * Performance: hoje reaproveita o feed completo (cacheado 30s) e corta no
 * cliente. Se o volume crescer, dá pra trocar por um RPC público dedicado
 * com LIMIT no servidor (mesmo molde do public_stats) — "monta primeiro,
 * depois melhora".
 */

import { getActiveFretes, type FreteSource } from './fretes';
import type { GeographicPoint } from '../types';

/** Frete reduzido e seguro para exibição pública na landing. */
export interface PublicFrete {
  id: string;
  /** Texto "Cidade, UF" da origem. */
  origin: string;
  /** Texto "Cidade, UF" do destino. */
  destination: string;
  /** Coordenada de origem (para o pin no mapa). */
  point: GeographicPoint;
  cargoType: string;
  product?: string;
  vehicleType: string;
  createdAt: Date;
  source: FreteSource;
}

/** Coordenada finita e diferente de (0,0) — descarta pins inválidos. */
function hasValidPoint(p: GeographicPoint): boolean {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

/**
 * Busca os fretes ativos mais recentes para a vitrine pública.
 * Já vem ordenado por `created_at` desc (do `getActiveFretes`). Filtra pins
 * inválidos e corta no `limit`.
 */
export async function getPublicRecentFretes(limit = 60): Promise<PublicFrete[]> {
  const fretes = await getActiveFretes();
  return fretes
    .filter((f) => hasValidPoint(f.originLocation))
    .slice(0, limit)
    .map((f) => ({
      id: f.id,
      origin: f.origin,
      destination: f.destination,
      point: f.originLocation,
      cargoType: f.cargoType,
      product: f.product,
      vehicleType: f.vehicleType,
      createdAt: f.createdAt,
      source: f.source ?? 'embarcador',
    }));
}
