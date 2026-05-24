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
  // === Campos novos (Migration 018) ============================================
  addressCep?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  addressNeighborhood?: string;
  addressCity?: string;
  addressUf?: string;
  rgNumber?: string;
  ownerCnpj?: string;
  ownerCompanyName?: string;
  ownerPisNumber?: string;
  ownerIsDriver?: boolean;
  /** Tipo de RNTRC do motorista (Migration 022). */
  rntrcType?: 'fisica' | 'juridica';
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
  // === Campos novos (Migration 017) ===========================================
  vehicleYearManufacture?: number;
  vehicleYearModel?: number;
  kmPerLiter?: number;
  trailerAxles?: number;
  cargoCapacityTon?: number;
  dieselPrice?: number;
  isOwner?: boolean;
  // === Campos novos (Migration 018) ===========================================
  addressCep?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  addressNeighborhood?: string;
  addressCity?: string;
  addressUf?: string;
  rgNumber?: string;
  ownerCnpj?: string;
  ownerCompanyName?: string;
  ownerPisNumber?: string;
  ownerIsDriver?: boolean;
  rntrcType?: 'fisica' | 'juridica';
}

/**
 * Referência profissional do motorista (transportadora ou empresa
 * com quem ele já trabalhou).
 */
export interface MotoristaReference {
  id: string;
  userId: string;
  companyName: string;
  phone: string;
  createdAt: Date;
}

/**
 * Contexto reduzido usado pelo painel de fretes do motorista para
 * fazer cálculos financeiros ao vivo.
 */
export interface MotoristaCalcContext {
  kmPerLiter: number | null;
  dieselPrice: number | null;
  /** Capacidade de carga em toneladas — usado quando o frete é cobrado por tonelada. */
  cargoCapacityTon: number | null;
}

/**
 * Get motorista profile by user ID.
 */
export async function getMotoristaProfile(userId: string): Promise<MotoristaProfile | null> {
  const { data, error } = await supabase
    .from('motoristas')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar perfil: ${error.message}`);
  }

  if (!data) {
    return null;
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
    // === Migration 018 ========================================================
    addressCep: data.address_cep ?? undefined,
    addressStreet: data.address_street ?? undefined,
    addressNumber: data.address_number ?? undefined,
    addressComplement: data.address_complement ?? undefined,
    addressNeighborhood: data.address_neighborhood ?? undefined,
    addressCity: data.address_city ?? undefined,
    addressUf: data.address_uf ?? undefined,
    rgNumber: data.rg_number ?? undefined,
    ownerCnpj: data.owner_cnpj ?? undefined,
    ownerCompanyName: data.owner_company_name ?? undefined,
    ownerPisNumber: data.owner_pis_number ?? undefined,
    ownerIsDriver: data.owner_is_driver ?? undefined,
    rntrcType: data.rntrc_type ?? undefined,
    // =========================================================================
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
  // === Migration 018: endereço, RG e dados do proprietário ===================
  if (data.addressCep !== undefined) motoristaUpdate.address_cep = data.addressCep;
  if (data.addressStreet !== undefined) motoristaUpdate.address_street = data.addressStreet;
  if (data.addressNumber !== undefined) motoristaUpdate.address_number = data.addressNumber;
  if (data.addressComplement !== undefined)
    motoristaUpdate.address_complement = data.addressComplement;
  if (data.addressNeighborhood !== undefined)
    motoristaUpdate.address_neighborhood = data.addressNeighborhood;
  if (data.addressCity !== undefined) motoristaUpdate.address_city = data.addressCity;
  if (data.addressUf !== undefined) motoristaUpdate.address_uf = data.addressUf;
  if (data.rgNumber !== undefined) motoristaUpdate.rg_number = data.rgNumber;
  if (data.ownerCnpj !== undefined) motoristaUpdate.owner_cnpj = data.ownerCnpj;
  if (data.ownerCompanyName !== undefined)
    motoristaUpdate.owner_company_name = data.ownerCompanyName;
  if (data.ownerPisNumber !== undefined) motoristaUpdate.owner_pis_number = data.ownerPisNumber;
  if (data.ownerIsDriver !== undefined) motoristaUpdate.owner_is_driver = data.ownerIsDriver;
  if (data.rntrcType !== undefined) motoristaUpdate.rntrc_type = data.rntrcType;
  // ===========================================================================

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
    .select('km_per_liter, diesel_price, cargo_capacity_ton')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { kmPerLiter: null, dieselPrice: null, cargoCapacityTon: null };
  }
  if (!data) {
    return { kmPerLiter: null, dieselPrice: null, cargoCapacityTon: null };
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
    cargoCapacityTon:
      data.cargo_capacity_ton !== null && data.cargo_capacity_ton !== undefined
        ? Number(data.cargo_capacity_ton)
        : null,
  };
}

/**
 * Get user data by ID. Usa `maybeSingle()` para evitar exception
 * quando a linha em `users` ainda não foi criada (cadastro recém-feito,
 * trigger pendente ou RLS). Retorna campos vazios em vez de throw —
 * a UI pode renderizar o perfil em branco e o motorista pode preencher.
 */
export async function getUserData(userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, cpf, profile_photo_url')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar dados do usuário: ${error.message}`);
  }

  if (!data) {
    return {
      id: userId,
      name: '',
      email: '',
      cpf: '',
      profilePhotoUrl: null as string | null,
    };
  }

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    cpf: data.cpf,
    profilePhotoUrl: data.profile_photo_url,
  };
}

/**
 * Lê todas as referências profissionais do motorista, ordenadas por
 * data de criação (mais antigas primeiro). Retorna `[]` se não houver.
 */
export async function getMotoristaReferences(userId: string): Promise<MotoristaReference[]> {
  const { data, error } = await supabase
    .from('motorista_references')
    .select('id, user_id, company_name, phone, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Erro ao buscar referências: ${error.message}`);
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    companyName: r.company_name,
    phone: r.phone,
    createdAt: new Date(r.created_at),
  }));
}

/**
 * Substitui completamente as referências do motorista. Padrão
 * replace-all (DELETE + INSERT) executado no client. Não é atômico
 * server-side; em caso de falha do INSERT após o DELETE, o caller
 * deve refetch a lista para mostrar o estado real.
 *
 * Aplica `capitalizeName` em `companyName` antes de inserir.
 * Linhas com `companyName.trim() === ''` são descartadas.
 */
export async function replaceMotoristaReferences(
  userId: string,
  refs: { companyName: string; phone: string }[]
): Promise<void> {
  // Passo 1: limpar tudo do usuário
  const { error: delErr } = await supabase
    .from('motorista_references')
    .delete()
    .eq('user_id', userId);
  if (delErr) {
    throw new Error(`Erro ao limpar referências: ${delErr.message}`);
  }

  // Passo 2: filtrar e inserir
  const rows = refs
    .filter((r) => r.companyName.trim() !== '')
    .map((r) => ({
      user_id: userId,
      company_name: capitalizeName(r.companyName.trim()),
      phone: (r.phone ?? '').replace(/\D/g, ''),
    }));

  if (rows.length === 0) return;

  const { error: insErr } = await supabase.from('motorista_references').insert(rows);
  if (insErr) {
    throw new Error(`Erro ao inserir referências: ${insErr.message}`);
  }
}
