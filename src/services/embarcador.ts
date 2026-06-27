/**
 * Embarcador Service
 * Handles embarcador profile operations
 */

import { supabase } from './supabase';

export interface EmbarcadorProfile {
  id: string;
  userId: string;
  companyName: string;
  cnpj?: string | null;
  whatsapp?: string;
  rating: number;
  totalRatings: number;
  branchState?: string | null;
  branchCity?: string | null;
  /** URL publica do logo da empresa (`embarcadores.company_logo_url`). */
  companyLogoUrl?: string | null;
  /** Nome da pessoa fisica responsavel (vem de `users.name`). */
  userName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateEmbarcadorProfileData {
  name?: string;
  email?: string;
  companyName?: string;
  cnpj?: string;
  whatsapp?: string;
  companyLogoUrl?: string;
  branchState?: string | null;
  branchCity?: string | null;
}

export interface EmbarcadorOnboardingProgress {
  profilePhoto: boolean;
  /** users.email_verified (literal) — usado pelo selo de e-mail no perfil. */
  emailVerified: boolean;
  /** users.phone_verified (literal). */
  phoneVerified: boolean;
  /** Contato verificado por qualquer canal: email_verified OR phone_verified. */
  contatoVerificado: boolean;
  companyLogo: boolean;
  /** Nome da empresa preenchido (movido do cadastro para o perfil — migr. 125). */
  companyName: boolean;
  percent: number;
  missing: string[];
}

const ALLOWED_LOGO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Get embarcador profile by user ID
 */
export async function getEmbarcadorProfile(userId: string): Promise<EmbarcadorProfile | null> {
  const { data, error } = await supabase
    .from('embarcadores')
    .select('*, users!inner(name)')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[EMBARCADOR] Erro ao buscar perfil:', error.message);
    return null;
  }

  if (!data) return null;

  // O join `users!inner(name)` traz `data.users` como objeto `{ name }`.
  const usersJoin = (data as unknown as { users?: { name?: string } | null }).users ?? null;

  return {
    id: data.id,
    userId: data.id,
    companyName: data.company_name,
    cnpj: (data as unknown as { cnpj?: string | null }).cnpj ?? null,
    whatsapp: data.whatsapp,
    rating: data.rating,
    totalRatings: data.total_ratings,
    branchState: (data as unknown as { branch_state?: string | null }).branch_state ?? null,
    branchCity: (data as unknown as { branch_city?: string | null }).branch_city ?? null,
    companyLogoUrl:
      (data as unknown as { company_logo_url?: string | null }).company_logo_url ?? null,
    userName: usersJoin?.name ?? null,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

/**
 * Cartao publico do embarcador para o modal de frete (lado motorista).
 *
 * Usa a RPC `get_embarcador_public_card` (SECURITY DEFINER) porque o RLS de
 * `users` so permite `auth.uid() = id` — um motorista nao consegue ler
 * `users.name` / `users.profile_photo_url` do embarcador via SELECT direto.
 * A RPC devolve APENAS campos publicos (nome, foto, empresa, logo, filial).
 */
export interface EmbarcadorPublicCard {
  id: string;
  companyName: string;
  companyLogoUrl: string | null;
  cnpj: string | null;
  branchState: string | null;
  branchCity: string | null;
  userName: string | null;
  profilePhotoUrl: string | null;
}

export async function getEmbarcadorPublicCard(
  embarcadorId: string
): Promise<EmbarcadorPublicCard | null> {
  const { data, error } = await supabase.rpc('get_embarcador_public_card', {
    p_embarcador_id: embarcadorId,
  });

  if (error) {
    console.warn('[EMBARCADOR] Erro ao buscar cartao publico:', error.message);
    return null;
  }
  if (!data) return null;

  const row = data as {
    id: string;
    company_name: string | null;
    company_logo_url: string | null;
    cnpj: string | null;
    branch_state: string | null;
    branch_city: string | null;
    user_name: string | null;
    profile_photo_url: string | null;
  };

  return {
    id: row.id,
    companyName: row.company_name ?? '',
    companyLogoUrl: row.company_logo_url ?? null,
    cnpj: row.cnpj ?? null,
    branchState: row.branch_state ?? null,
    branchCity: row.branch_city ?? null,
    userName: row.user_name ?? null,
    profilePhotoUrl: row.profile_photo_url ?? null,
  };
}

/**
 * Update embarcador profile
 */
export async function updateEmbarcadorProfile(
  userId: string,
  data: UpdateEmbarcadorProfileData
): Promise<void> {
  // Update user table
  const userUpdate: Record<string, string> = {};
  if (data.name !== undefined) userUpdate.name = data.name;
  if (data.email !== undefined) userUpdate.email = data.email;

  if (Object.keys(userUpdate).length > 0) {
    const { error: userError } = await supabase.from('users').update(userUpdate).eq('id', userId);
    if (userError) {
      throw new Error(`Erro ao atualizar usuário: ${userError.message}`);
    }
  }

  // Update embarcador table
  const embarcadorUpdate: Record<string, string | null> = {};
  if (data.companyName !== undefined) embarcadorUpdate.company_name = data.companyName;
  if (data.cnpj !== undefined) embarcadorUpdate.cnpj = data.cnpj;
  if (data.whatsapp !== undefined) embarcadorUpdate.whatsapp = data.whatsapp;
  if (data.companyLogoUrl !== undefined) embarcadorUpdate.company_logo_url = data.companyLogoUrl;
  if (data.branchState !== undefined)
    embarcadorUpdate.branch_state = data.branchState ? data.branchState.toUpperCase() : null;
  if (data.branchCity !== undefined) embarcadorUpdate.branch_city = data.branchCity ?? null;

  if (Object.keys(embarcadorUpdate).length > 0) {
    const { error: embarcadorError } = await supabase
      .from('embarcadores')
      .update(embarcadorUpdate)
      .eq('id', userId);
    if (embarcadorError) {
      throw new Error(`Erro ao atualizar perfil do embarcador: ${embarcadorError.message}`);
    }
  }
}

/**
 * Get user data by ID
 */
export async function getUserData(userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, profile_photo_url')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(`Erro ao buscar dados do usuário: ${error.message}`);
  }

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    profilePhotoUrl: data.profile_photo_url,
  };
}

/**
 * Get public embarcador profile (for public viewing)
 */
export async function getPublicEmbarcadorProfile(embarcadorId: string) {
  const { data, error } = await supabase
    .from('embarcadores')
    .select(
      `
      id,
      company_name,
      rating,
      total_ratings,
      created_at,
      users!inner(name, profile_photo_url)
    `
    )
    .eq('id', embarcadorId)
    .single();

  if (error) {
    throw new Error(`Erro ao buscar perfil público: ${error.message}`);
  }

  const users = data.users as unknown as { name: string; profile_photo_url: string | null };

  return {
    id: data.id,
    userId: data.id,
    companyName: data.company_name,
    rating: data.rating,
    totalRatings: data.total_ratings,
    createdAt: new Date(data.created_at),
    userName: users.name,
    profilePhotoUrl: users.profile_photo_url,
  };
}

/**
 * Get embarcador ratings/reviews
 */
export async function getEmbarcadorRatings(embarcadorId: string) {
  const { data, error } = await supabase
    .from('avaliacoes')
    .select(
      `
      id,
      rating,
      comment,
      created_at,
      motoristas!inner(
        users!inner(name, profile_photo_url)
      )
    `
    )
    .eq('embarcador_id', embarcadorId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`Erro ao buscar avaliações: ${error.message}`);
  }

  return data.map((review) => {
    const motoristas = review.motoristas as unknown as {
      users: { name: string; profile_photo_url: string | null };
    };

    return {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      createdAt: new Date(review.created_at),
      motoristaName: motoristas.users.name,
      motoristaPhoto: motoristas.users.profile_photo_url,
    };
  });
}

/**
 * Faz upload do logo da empresa para o bucket `company-logos`.
 *
 * Caminho: `embarcadores/<userId>/logo.<ext>`.
 * Validações: mime ∈ {jpg, png, webp} e tamanho ≤ 2 MB.
 *
 * @returns URL pública do logo após o upload
 */
export async function uploadCompanyLogo(userId: string, file: File): Promise<string> {
  if (!ALLOWED_LOGO_MIMES.includes(file.type as (typeof ALLOWED_LOGO_MIMES)[number])) {
    throw new Error('Formato inválido. Envie JPG, PNG ou WEBP.');
  }
  if (file.size > MAX_LOGO_SIZE_BYTES) {
    throw new Error('Arquivo muito grande. Limite de 2 MB.');
  }

  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `embarcadores/${userId}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage.from('company-logos').upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: '3600',
  });

  if (uploadError) {
    throw new Error(`Erro no upload do logo: ${uploadError.message}`);
  }

  const { data: pub } = supabase.storage.from('company-logos').getPublicUrl(path);
  const url = pub.publicUrl;

  const { error: dbError } = await supabase
    .from('embarcadores')
    .update({ company_logo_url: url, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (dbError) {
    throw new Error(`Erro ao salvar URL do logo: ${dbError.message}`);
  }

  return url;
}

/**
 * Calcula o progresso de onboarding do embarcador.
 *
 * Itens (peso igual): foto de perfil, e-mail verificado, logo da empresa.
 * Retorna percentual arredondado e a lista de pendências em pt-BR.
 */
export async function getEmbarcadorOnboardingProgress(
  userId: string
): Promise<EmbarcadorOnboardingProgress> {
  const [{ data: u }, { data: e }] = await Promise.all([
    supabase
      .from('users')
      .select('profile_photo_url, email_verified, phone_verified')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('embarcadores')
      .select('company_logo_url, company_name')
      .eq('id', userId)
      .maybeSingle(),
  ]);

  const emailVerified = !!u?.email_verified;
  const phoneVerified = !!u?.phone_verified;
  const contatoVerificado = emailVerified || phoneVerified;

  // Itens que compõem o "cadastro completo" para postar frete (espelha o gate
  // RLS da migration 125: contato verificado + foto + logo + nome da empresa).
  const completeness = {
    profilePhoto: !!u?.profile_photo_url,
    contatoVerificado,
    companyLogo: !!e?.company_logo_url,
    companyName: !!(e?.company_name && String(e.company_name).trim() !== ''),
  };

  const total = Object.keys(completeness).length; // 4
  const done = Object.values(completeness).filter(Boolean).length;
  const percent = Math.round((done / total) * 100);

  const missing: string[] = [];
  if (!completeness.profilePhoto) missing.push('Adicionar foto de perfil');
  if (!completeness.contatoVerificado) missing.push('Verificar WhatsApp ou e-mail');
  if (!completeness.companyName) missing.push('Informar nome da empresa');
  if (!completeness.companyLogo) missing.push('Adicionar logo da empresa');

  return {
    profilePhoto: completeness.profilePhoto,
    emailVerified,
    phoneVerified,
    contatoVerificado,
    companyLogo: completeness.companyLogo,
    companyName: completeness.companyName,
    percent,
    missing,
  };
}
