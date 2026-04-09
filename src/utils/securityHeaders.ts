/**
 * Security Headers - Configuração de headers de segurança HTTP
 * 
 * Estes headers protegem contra:
 * - XSS (Cross-Site Scripting)
 * - Clickjacking
 * - MIME type sniffing
 * - Protocol downgrade attacks
 * - Information leakage
 * 
 * Nota: Em produção, estes headers devem ser configurados no servidor/CDN.
 * Para Vercel, use vercel.json. Para outros, configure no servidor web.
 */

export interface SecurityHeaders {
  'Content-Security-Policy': string;
  'X-Content-Type-Options': string;
  'X-Frame-Options': string;
  'X-XSS-Protection': string;
  'Strict-Transport-Security': string;
  'Referrer-Policy': string;
  'Permissions-Policy': string;
}

/**
 * Content Security Policy (CSP)
 * Define quais recursos podem ser carregados
 */
const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Necessário para React
  'style-src': ["'self'", "'unsafe-inline'"], // Necessário para Tailwind
  'img-src': ["'self'", 'data:', 'https:', 'blob:'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],
  'connect-src': [
    "'self'",
    'https://*.supabase.co', // Supabase API
    'wss://*.supabase.co', // Supabase Realtime
    'https://api.ibge.gov.br', // IBGE API
    'https://nominatim.openstreetmap.org', // Geocoding
  ],
  'frame-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'upgrade-insecure-requests': [],
};

/**
 * Gera a string CSP a partir das diretivas
 */
function buildCSP(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, values]) => {
      if (values.length === 0) return directive;
      return `${directive} ${values.join(' ')}`;
    })
    .join('; ');
}

/**
 * Headers de segurança recomendados
 */
export const SECURITY_HEADERS: SecurityHeaders = {
  // Content Security Policy - controla quais recursos podem ser carregados
  'Content-Security-Policy': buildCSP(),

  // Previne MIME type sniffing
  'X-Content-Type-Options': 'nosniff',

  // Previne clickjacking - página não pode ser carregada em iframe
  'X-Frame-Options': 'DENY',

  // Ativa filtro XSS do navegador (legado, mas ainda útil)
  'X-XSS-Protection': '1; mode=block',

  // Força HTTPS por 1 ano, incluindo subdomínios
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',

  // Controla informações enviadas no header Referer
  'Referrer-Policy': 'strict-origin-when-cross-origin',

  // Restringe APIs do navegador
  'Permissions-Policy': [
    'accelerometer=()',
    'camera=()',
    'geolocation=(self)', // Permitido para funcionalidade de localização
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()', // Será habilitado quando pagamentos forem implementados
    'usb=()',
  ].join(', '),
};

/**
 * Configuração para vercel.json
 */
export const VERCEL_HEADERS_CONFIG = {
  headers: [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'X-XSS-Protection',
          value: '1; mode=block',
        },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=31536000; includeSubDomains; preload',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
        {
          key: 'Permissions-Policy',
          value: 'accelerometer=(), camera=(), geolocation=(self), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
        },
        {
          key: 'Content-Security-Policy',
          value: buildCSP(),
        },
      ],
    },
  ],
};

/**
 * Aplica headers de segurança a uma Response (para uso em service workers ou edge functions)
 */
export function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Verifica se os headers de segurança estão presentes
 */
export function validateSecurityHeaders(headers: Headers): {
  valid: boolean;
  missing: string[];
  warnings: string[];
} {
  const missing: string[] = [];
  const warnings: string[] = [];

  const requiredHeaders = [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Strict-Transport-Security',
  ];

  const recommendedHeaders = [
    'Content-Security-Policy',
    'Referrer-Policy',
    'Permissions-Policy',
  ];

  requiredHeaders.forEach(header => {
    if (!headers.has(header)) {
      missing.push(header);
    }
  });

  recommendedHeaders.forEach(header => {
    if (!headers.has(header)) {
      warnings.push(`Header recomendado ausente: ${header}`);
    }
  });

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

export default SECURITY_HEADERS;
