/**
 * Marketplace — núcleo puro de validação e formatação de anúncios.
 *
 * Funções determinísticas (sem I/O) usadas pelo formulário de publicação, pelo
 * feed e pelo detalhe. São a base testável das Properties 2, 3 e 4.
 *
 * Validates: Requirements 3.1-3.8, 4.4, 4.5, 6.4, 7.4, 7.5
 */

export const TITLE_MAX = 30;
export const DESCRIPTION_MAX = 2000;
export const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MiB
export const ALLOWED_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type PostType = 'venda' | 'noticia';

/** Metadados de uma foto candidata (sem o binário) para validação pura. */
export interface PhotoMeta {
  mime: string;
  sizeBytes: number;
}

export interface MarketplacePostInput {
  postType: PostType;
  title: string;
  description: string;
  /** Valor obrigatório (> 0). */
  price: number | null;
  photos: PhotoMeta[];
  /** Post_Location resolvida? (Forced_Location — Req 4.4/4.5). */
  hasLocation: boolean;
}

export type PostFieldError =
  | 'TITLE_REQUIRED'
  | 'TITLE_TOO_LONG'
  | 'DESCRIPTION_TOO_LONG'
  | 'PRICE_REQUIRED'
  | 'INVALID_PRICE'
  | 'NO_PHOTOS'
  | 'TOO_MANY_PHOTOS'
  | 'INVALID_FILE_TYPE'
  | 'PHOTO_TOO_LARGE'
  | 'LOCATION_REQUIRED';

export interface PostValidation {
  ok: boolean;
  fieldErrors: Partial<Record<keyof MarketplacePostInput, PostFieldError>>;
}

const ALLOWED_MIME_SET: ReadonlySet<string> = new Set(ALLOWED_PHOTO_MIME);

/**
 * Validação pura e determinística do anúncio (Req 3, 4).
 *
 * `ok === true` se e somente se: título tem 1..30 caracteres após trim;
 * descrição tem 0..2000; `price` está presente e é um número finito `> 0`; há
 * de 1 a 10 fotos, todas com MIME permitido e tamanho `> 0` e `<= 5 MiB`; e
 * `hasLocation === true`. Caso contrário, `ok === false` e há ao menos um
 * `fieldError` apontando o campo ofensor.
 */
export function validateMarketplacePostInput(input: MarketplacePostInput): PostValidation {
  const fieldErrors: Partial<Record<keyof MarketplacePostInput, PostFieldError>> = {};

  // Título: 1..30 após trim (Req 3.1).
  const title = (input.title ?? '').trim();
  if (title.length === 0) {
    fieldErrors.title = 'TITLE_REQUIRED';
  } else if (title.length > TITLE_MAX) {
    fieldErrors.title = 'TITLE_TOO_LONG';
  }

  // Descrição: 0..2000 (Req 3.2).
  if ((input.description ?? '').length > DESCRIPTION_MAX) {
    fieldErrors.description = 'DESCRIPTION_TOO_LONG';
  }

  // Valor: obrigatório e > 0 (Req 3.3).
  if (input.price === null || input.price === undefined) {
    fieldErrors.price = 'PRICE_REQUIRED';
  } else if (!Number.isFinite(input.price) || input.price <= 0) {
    fieldErrors.price = 'INVALID_PRICE';
  }

  // Fotos: 1..10, cada uma com MIME permitido e tamanho válido (Req 3.5-3.8).
  const photos = input.photos ?? [];
  if (photos.length < MIN_PHOTOS) {
    fieldErrors.photos = 'NO_PHOTOS';
  } else if (photos.length > MAX_PHOTOS) {
    fieldErrors.photos = 'TOO_MANY_PHOTOS';
  } else {
    for (const photo of photos) {
      if (!ALLOWED_MIME_SET.has(photo.mime)) {
        fieldErrors.photos = 'INVALID_FILE_TYPE';
        break;
      }
      if (!Number.isFinite(photo.sizeBytes) || photo.sizeBytes <= 0 || photo.sizeBytes > MAX_PHOTO_BYTES) {
        fieldErrors.photos = 'PHOTO_TOO_LARGE';
        break;
      }
    }
  }

  // Localização obrigatória e forçada (Req 4.4/4.5).
  if (!input.hasLocation) {
    fieldErrors.hasLocation = 'LOCATION_REQUIRED';
  }

  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
}

/**
 * Agrupa os milhares de uma string só-dígitos no padrão pt-BR ("56000" →
 * "56.000"). Usado na máscara do campo de valor e por `formatBRL`.
 */
export function groupThousands(digits: string): string {
  return digits.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Formata um valor em Reais no padrão pt-BR: "R$ 65.000" (sem centavos quando
 * inteiro) ou "R$ 1.250,50" (com centavos). Implementação manual (sem
 * `Intl`/ICU) para um resultado determinístico e idêntico em qualquer ambiente
 * — o prefixo "R$ ", o agrupamento de milhar com "." e o decimal com "," são
 * garantidos sem depender de dados de locale (Req 6.4, 7.4).
 */
export function formatBRL(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const totalCents = Math.round(Math.abs(safeValue) * 100);
  const reais = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  const grouped = groupThousands(String(reais));
  const sign = safeValue < 0 ? '-' : '';
  return cents === 0
    ? `${sign}R$ ${grouped}`
    : `${sign}R$ ${grouped},${String(cents).padStart(2, '0')}`;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * Relative_Age em pt-BR a partir de `created_at` (Req 7.5). Faixas disjuntas:
 *  - `[1 dia, ...)` ⇒ "há 1 dia" / "há N dias";
 *  - `[1 h, 24 h)`  ⇒ "há N h";
 *  - `[0, 1 h)`     ⇒ "hoje".
 *
 * Diferença negativa (relógio adiantado/skew) é saneada para 0 ⇒ "hoje", nunca
 * produzindo número negativo. Determinística.
 */
export function formatRelativeAge(createdAt: Date, now: Date): string {
  const diffMs = Math.max(0, now.getTime() - createdAt.getTime());
  const days = Math.floor(diffMs / MS_PER_DAY);
  if (days >= 1) {
    return days === 1 ? 'há 1 dia' : `há ${days} dias`;
  }
  const hours = Math.floor(diffMs / MS_PER_HOUR);
  if (hours >= 1) {
    return `há ${hours} h`;
  }
  return 'hoje';
}
