/**
 * Calculadora de Frete
 * Calcula distância, tempo de viagem, dias totais e lucro por dia
 */

import { calculateDistance } from './geolocation';
import type { GeographicPoint } from '../types';

export interface FreteCalcInput {
  origin: GeographicPoint;
  destination: GeographicPoint;
  freteValue: number;
  loadingDays: number; // D0-D5
  unloadingDays: number; // D0-D5
  custoKm?: number; // custo por km (combustível + manutenção)
}

export interface FreteCalcResult {
  distanceKm: number;
  travelDays: number;
  totalDays: number;
  lucroBruto: number;
  custoEstimado: number;
  lucroLiquido: number;
  lucroPorDia: number;
  lucroPorKm: number;
}

const AVG_KM_PER_DAY = 500; // média de km por dia de viagem
const DEFAULT_CUSTO_KM = 3.5; // R$/km (combustível + manutenção)

export function calcularFrete(input: FreteCalcInput): FreteCalcResult {
  const distanceKm = calculateDistance(input.origin, input.destination);
  const custoKm = input.custoKm ?? DEFAULT_CUSTO_KM;

  // Dias de viagem (ida)
  const travelDays = Math.max(1, Math.ceil(distanceKm / AVG_KM_PER_DAY));

  // Dias totais = viagem + carga + descarga
  const totalDays = travelDays + input.loadingDays + input.unloadingDays;

  const lucroBruto = input.freteValue;
  const custoEstimado = distanceKm * custoKm;
  const lucroLiquido = lucroBruto - custoEstimado;
  const lucroPorDia = totalDays > 0 ? lucroLiquido / totalDays : 0;
  const lucroPorKm = distanceKm > 0 ? lucroLiquido / distanceKm : 0;

  return {
    distanceKm: Math.round(distanceKm),
    travelDays,
    totalDays,
    lucroBruto,
    custoEstimado: Math.round(custoEstimado * 100) / 100,
    lucroLiquido: Math.round(lucroLiquido * 100) / 100,
    lucroPorDia: Math.round(lucroPorDia * 100) / 100,
    lucroPorKm: Math.round(lucroPorKm * 100) / 100,
  };
}
