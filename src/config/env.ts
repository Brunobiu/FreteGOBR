/**
 * env.ts — Leitura centralizada e validada das variáveis de ambiente.
 *
 * Único ponto do frontend que toca `import.meta.env`. Falha cedo (no boot)
 * com mensagem clara em pt-BR se uma variável obrigatória estiver ausente,
 * evitando erros crípticos espalhados pelo código.
 *
 * Regras:
 *  - Apenas variáveis `VITE_*` (públicas/expostas ao bundle) entram aqui.
 *  - O service key do Supabase (`VITE_SUPABASE_SERVICE_KEY`) NUNCA é lido
 *    pelo frontend — é usado somente em scripts/migrations server-side.
 *
 * Ver `.env.example` para a lista completa e `docs/DISASTER_RECOVERY.md`
 * para o procedimento de setup local.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Variável de ambiente ausente: ${name}. Verifique seu arquivo .env ` +
        `(use .env.example como referência).`
    );
  }
  return value;
}

function optional(value: string | undefined): string {
  return value ?? '';
}

export const env = {
  // Obrigatórias — lançam no boot se faltarem.
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),

  // Opcionais — apenas expostas; ausência não quebra o boot.
  apiBaseUrl: optional(import.meta.env.VITE_API_BASE_URL),
  googleMapsApiKey: optional(import.meta.env.VITE_GOOGLE_MAPS_API_KEY),
  metaPixelId: optional(import.meta.env.VITE_META_PIXEL_ID),
} as const;
