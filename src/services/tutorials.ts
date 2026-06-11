/**
 * services/tutorials.ts
 *
 * Tutoriais em vídeo gerenciados pelo admin e exibidos para motorista e
 * embarcador. Cada vídeo pertence a um público (`motorista` | `embarcador`),
 * e pode ser um link do YouTube ou um arquivo enviado (bucket público
 * `tutorial_videos`). O usuário pode marcar como concluído.
 */

import { supabase } from './supabase';

export type TutorialAudience = 'motorista' | 'embarcador';
export type TutorialSourceType = 'youtube' | 'upload';

const BUCKET = 'tutorial_videos';

export interface TutorialVideo {
  id: string;
  audience: TutorialAudience;
  title: string;
  description: string | null;
  sourceType: TutorialSourceType;
  /** URL pronta para tocar: embed do YouTube OU URL pública do arquivo. */
  playbackUrl: string;
  /** URL "crua" do YouTube (quando sourceType=youtube), para edição. */
  youtubeUrl: string | null;
  storagePath: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  /** Preenchido em listForUser: o usuário marcou como concluído. */
  completed?: boolean;
}

interface TutorialRow {
  id: string;
  audience: TutorialAudience;
  title: string;
  description: string | null;
  source_type: TutorialSourceType;
  youtube_url: string | null;
  storage_path: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

/**
 * Extrai o ID de um vídeo do YouTube de várias formas de URL
 * (watch?v=, youtu.be/, shorts/, embed/). Retorna null se não reconhecer.
 */
export function parseYouTubeId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Monta a URL de embed do YouTube a partir de uma URL qualquer. */
export function youTubeEmbedUrl(url: string): string | null {
  const id = parseYouTubeId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

function publicUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function rowToVideo(row: TutorialRow): TutorialVideo {
  const playbackUrl =
    row.source_type === 'youtube'
      ? (youTubeEmbedUrl(row.youtube_url ?? '') ?? row.youtube_url ?? '')
      : row.storage_path
        ? publicUrl(row.storage_path)
        : '';
  return {
    id: row.id,
    audience: row.audience,
    title: row.title,
    description: row.description,
    sourceType: row.source_type,
    playbackUrl,
    youtubeUrl: row.youtube_url,
    storagePath: row.storage_path,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

// ─── Admin ────────────────────────────────────────────────────────────────

/** Admin: lista TODOS os vídeos (ativos e inativos) de um público. */
export async function listTutorialsAdmin(audience: TutorialAudience): Promise<TutorialVideo[]> {
  const { data, error } = await supabase
    .from('tutorial_videos')
    .select('*')
    .eq('audience', audience)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToVideo);
}

export interface CreateTutorialInput {
  audience: TutorialAudience;
  title: string;
  description?: string | null;
  sourceType: TutorialSourceType;
  youtubeUrl?: string | null;
  storagePath?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Admin: cria um vídeo. */
export async function createTutorial(input: CreateTutorialInput): Promise<TutorialVideo> {
  if (input.sourceType === 'youtube' && !parseYouTubeId(input.youtubeUrl ?? '')) {
    throw new Error('Link do YouTube inválido. Cole o endereço completo do vídeo.');
  }
  const { data, error } = await supabase
    .from('tutorial_videos')
    .insert({
      audience: input.audience,
      title: input.title,
      description: input.description ?? null,
      source_type: input.sourceType,
      youtube_url: input.sourceType === 'youtube' ? (input.youtubeUrl ?? null) : null,
      storage_path: input.sourceType === 'upload' ? (input.storagePath ?? null) : null,
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToVideo(data);
}

/** Admin: atualiza metadados de um vídeo. */
export async function updateTutorial(
  id: string,
  patch: Partial<{ title: string; description: string | null; isActive: boolean }>
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  const { error } = await supabase.from('tutorial_videos').update(update).eq('id', id);
  if (error) throw error;
}

/** Admin: exclui um vídeo (e tenta remover o arquivo do storage). */
export async function deleteTutorial(id: string, storagePath?: string | null): Promise<void> {
  const { error } = await supabase.from('tutorial_videos').delete().eq('id', id);
  if (error) throw error;
  if (storagePath) {
    await supabase.storage
      .from(BUCKET)
      .remove([storagePath])
      .catch(() => {
        /* best-effort */
      });
  }
}

/** Admin: reordena os vídeos de um público conforme a lista de ids. */
export async function reorderTutorials(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('tutorial_videos')
      .update({ sort_order: i })
      .eq('id', orderedIds[i]);
    if (error) throw error;
  }
}

/** Admin: faz upload de um arquivo de vídeo para o bucket. Retorna o path. */
export async function uploadTutorialVideo(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(`Erro ao enviar o vídeo: ${error.message}`);
  return path;
}

// ─── Usuário (motorista / embarcador) ───────────────────────────────────────

/**
 * Lista os vídeos ATIVOS de um público com o flag `completed` por usuário.
 */
export async function listTutorialsForUser(
  audience: TutorialAudience,
  userId: string
): Promise<TutorialVideo[]> {
  const [{ data: videos, error: vErr }, { data: progress, error: pErr }] = await Promise.all([
    supabase
      .from('tutorial_videos')
      .select('*')
      .eq('audience', audience)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase.from('tutorial_progress').select('video_id').eq('user_id', userId),
  ]);
  if (vErr) throw vErr;
  if (pErr) throw pErr;

  const done = new Set((progress || []).map((p) => p.video_id as string));
  return (videos || []).map((row) => ({ ...rowToVideo(row), completed: done.has(row.id) }));
}

/** Marca/desmarca um vídeo como concluído para o usuário logado. */
export async function setTutorialCompleted(
  videoId: string,
  userId: string,
  completed: boolean
): Promise<void> {
  if (completed) {
    const { error } = await supabase
      .from('tutorial_progress')
      .upsert({ user_id: userId, video_id: videoId }, { onConflict: 'user_id,video_id' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('tutorial_progress')
      .delete()
      .eq('user_id', userId)
      .eq('video_id', videoId);
    if (error) throw error;
  }
}
