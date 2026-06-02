// supabase/functions/_shared/cors.ts
//
// Helpers compartilhados de CORS para as Edge Functions chamadas pelo browser
// via `supabase.functions.invoke(...)`. O cliente Supabase emite um preflight
// `OPTIONS` carregando os headers `authorization`/`content-type`/`x-client-info`/
// `apikey`; sem a resposta correta o navegador bloqueia a requisicao real.
//
// Por que `Access-Control-Allow-Origin: *` aqui:
//  - As Edges deste projeto JA validam autenticacao server-side (Bearer JWT do
//    caller via gateway, ou Bearer service-role para chamadas server-to-server).
//    O CORS NAO e a fronteira de seguranca; ele apenas controla quais ORIGENS
//    do browser podem invocar a funcao.
//  - O painel admin nao usa cookies de sessao cross-site; o JWT vai como
//    `Authorization: Bearer ...`. `Allow-Credentials` permanece falso (omitido).
//  - Origens validas variam entre dev (`http://localhost:5173`), preview
//    (`*.vercel.app`) e producao (dominio publico). `*` cobre todas sem
//    exigir manutencao a cada novo deploy.
//
// Sem `Access-Control-Allow-Credentials`: o painel envia o JWT no header
// `Authorization`, nao em cookies. Nao precisamos (nem queremos) cookies
// cross-site nesta integracao.

/**
 * Headers CORS aplicados a TODA resposta das Edges chamadas pelo browser.
 * Faltando qualquer um, o navegador bloqueia a chamada (rede ou preflight).
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Max-Age': '86400',
};

/**
 * Responde a um preflight `OPTIONS` com `204 No Content` + os headers CORS.
 * Retorna `null` quando o metodo NAO e `OPTIONS` (a funcao chamadora segue o
 * fluxo normal e usa `withCors(...)` na resposta final).
 *
 * Uso tipico no inicio do handler:
 *   const preflight = handlePreflight(req);
 *   if (preflight) return preflight;
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Adiciona os headers de CORS a uma `Response` ja construida pelo handler,
 * preservando todos os headers existentes (ex.: `Content-Type`).
 */
export function withCors(response: Response): Response {
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    merged.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
