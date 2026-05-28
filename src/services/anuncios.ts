/**
 * services/anuncios.ts
 *
 * Service para gerenciar anuncios (banners do carrossel).
 * - listActiveAnuncios: lista publica (motorista/embarcador)
 * - listAllAnuncios: admin - lista tudo
 * - createAnuncio / updateAnuncio / deleteAnuncio: admin
 * - uploadAnuncioImage: upload no bucket publico
 */

import { supabase } from './supabase';

export interface Anuncio {
  id: string;
  name: string;
  imagePath: string;
  imageUrl: string; // resolvido via getPublicUrl
  linkUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface AnuncioRow {
  id: string;
  name: string;
  image_path: string;
  link_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const BUCKET = 'anuncios_images';

function getPublicUrl(path: string): string {
  if (!path) return '';
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function rowToAnuncio(row: AnuncioRow): Anuncio {
  return {
    id: row.id,
    name: row.name,
    imagePath: row.image_path,
    imageUrl: getPublicUrl(row.image_path),
    linkUrl: row.link_url,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lista anuncios ativos para exibir no carrossel (motorista/embarcador). */
export async function listActiveAnuncios(): Promise<Anuncio[]> {
  const { data, error } = await supabase
    .from('anuncios')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToAnuncio);
}

/** Admin: lista todos os anuncios. */
export async function listAllAnuncios(): Promise<Anuncio[]> {
  const { data, error } = await supabase
    .from('anuncios')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToAnuncio);
}

/** Admin: cria novo anuncio. */
export async function createAnuncio(input: {
  name: string;
  imagePath: string;
  linkUrl?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<Anuncio> {
  const { data, error } = await supabase
    .from('anuncios')
    .insert({
      name: input.name,
      image_path: input.imagePath,
      link_url: input.linkUrl || null,
      is_active: input.isActive ?? true,
      sort_order: input.sortOrder ?? 0,
    })
    .select()
    .single();

  if (error) throw error;
  return rowToAnuncio(data);
}

/** Admin: atualiza anuncio. */
export async function updateAnuncio(
  id: string,
  patch: Partial<{
    name: string;
    imagePath: string;
    linkUrl: string | null;
    isActive: boolean;
    sortOrder: number;
  }>
): Promise<Anuncio> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.imagePath !== undefined) update.image_path = patch.imagePath;
  if (patch.linkUrl !== undefined) update.link_url = patch.linkUrl;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;

  const { data, error } = await supabase
    .from('anuncios')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return rowToAnuncio(data);
}

/** Admin: deleta anuncio (e tenta deletar a imagem do storage). */
export async function deleteAnuncio(id: string, imagePath?: string): Promise<void> {
  const { error } = await supabase.from('anuncios').delete().eq('id', id);
  if (error) throw error;

  if (imagePath) {
    // Best-effort: ignora erro se nao conseguir deletar a imagem
    await supabase.storage.from(BUCKET).remove([imagePath]).catch(() => {});
  }
}

/** Admin: faz upload de uma imagem para o bucket anuncios_images. */
export async function uploadAnuncioImage(file: File): Promise<string> {
  // Sanitiza nome do arquivo
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (error) throw error;
  return path;
}
