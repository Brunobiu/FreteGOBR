/**
 * services/commodities.ts
 *
 * Service para gerenciar categorias de commodities (carrossel horizontal de
 * tipos de carga: Soja, Milho, Acucar, etc.).
 *
 * - listActiveCommodities: lista publica para o motorista
 * - listAllCommodities: admin - lista tudo
 * - createCommodity / updateCommodity / deleteCommodity: admin
 * - reorderCommodities: admin - persiste novo sort_order
 * - uploadCommodityIcon: upload no bucket publico commodity_icons
 */

import { supabase } from './supabase';

export interface CommodityCategory {
  id: string;
  name: string;
  slug: string;
  iconPath: string;
  iconUrl: string; // resolvido via getPublicUrl (vazio se iconPath = '')
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CommodityRow {
  id: string;
  name: string;
  slug: string;
  icon_path: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const BUCKET = 'commodity_icons';

function getPublicUrl(path: string): string {
  if (!path) return '';
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function rowToCommodity(row: CommodityRow): CommodityCategory {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    iconPath: row.icon_path,
    iconUrl: getPublicUrl(row.icon_path),
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Gera um slug a partir de um nome (lowercase, hifens, sem acento).
 * Usado quando o admin cria uma nova categoria sem informar slug.
 */
export function slugifyCommodityName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

/** Lista publica: categorias ativas, ordenadas. */
export async function listActiveCommodities(): Promise<CommodityCategory[]> {
  const { data, error } = await supabase
    .from('commodity_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(rowToCommodity);
}

/** Admin: lista todas (ativas e inativas). */
export async function listAllCommodities(): Promise<CommodityCategory[]> {
  const { data, error } = await supabase
    .from('commodity_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(rowToCommodity);
}

/** Admin: cria nova categoria. */
export async function createCommodity(input: {
  name: string;
  slug?: string;
  iconPath: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<CommodityCategory> {
  const slug = input.slug?.trim() || slugifyCommodityName(input.name);
  const { data, error } = await supabase
    .from('commodity_categories')
    .insert({
      name: input.name,
      slug,
      icon_path: input.iconPath,
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
    })
    .select()
    .single();

  if (error) throw error;
  return rowToCommodity(data);
}

/** Admin: atualiza categoria existente. */
export async function updateCommodity(
  id: string,
  patch: Partial<{
    name: string;
    slug: string;
    iconPath: string;
    sortOrder: number;
    isActive: boolean;
  }>
): Promise<CommodityCategory> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.slug !== undefined) update.slug = patch.slug;
  if (patch.iconPath !== undefined) update.icon_path = patch.iconPath;
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;

  const { data, error } = await supabase
    .from('commodity_categories')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return rowToCommodity(data);
}

/** Admin: deleta categoria (e tenta deletar o icone do storage). */
export async function deleteCommodity(id: string, iconPath?: string): Promise<void> {
  const { error } = await supabase.from('commodity_categories').delete().eq('id', id);
  if (error) throw error;

  if (iconPath) {
    await supabase.storage
      .from(BUCKET)
      .remove([iconPath])
      .catch(() => {
        /* best-effort */
      });
  }
}

/**
 * Admin: persiste nova ordem das categorias. Recebe um array de ids na ordem
 * desejada e atualiza sort_order de cada uma para o indice no array.
 */
export async function reorderCommodities(orderedIds: string[]): Promise<void> {
  // Atualiza um por um para evitar dependencia de RPC. Volume eh pequeno
  // (geralmente menos de 30 categorias).
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('commodity_categories')
      .update({ sort_order: i })
      .eq('id', orderedIds[i]);
    if (error) throw error;
  }
}

/** Admin: faz upload de um icone para o bucket commodity_icons. */
export async function uploadCommodityIcon(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });

  if (error) throw error;
  return path;
}
