# Checklist SaaS de Vulnerabilidades — FreteGO (avaliação)

Avaliação item-a-item da lista de vulnerabilidades SaaS contra a arquitetura
real (React SPA estática no Vercel + Supabase PostgREST/Auth/Edge Deno).
Verificado com evidência do código, não suposição.

Legenda: ✅ já coberto · 🔧 melhoria aplicada · 🟢 N/A pela arquitetura · 📋 nota

---

## CRÍTICAS

### Injeção de Código / RCE — ✅ N/A + coberto
- Não há backend que execute shell. Edge Functions são Deno isolado, sem
  `eval`/exec de input. Grep: `eval(`, `new Function` ⇒ **0 ocorrências** no src.
- SQL: não há SQL string-concatenado no cliente; tudo via PostgREST
  parametrizado e RPCs `plpgsql` com parâmetros tipados. Sem `;ls`/`sleep` surface.
- CSP bloqueia execução de script externo.

### Bypass de Autenticação — ✅ coberto
- JWT é gerido pelo **Supabase Auth** (assinatura HS256/JWKS verificada no
  servidor) — não há parsing manual de JWT vulnerável a null-byte.
- Sessão = token Supabase, não `SESSION_ID=admin` em cookie manipulável.
- `admin/auth.ts` valida `is_superuser` + roles no servidor.
- Rate-limit/lockout: `login_attempts`, `account_lockouts`, `rate_limits`
  (migration 005) + lockout por tentativas. Credenciais default não existem.

### SSRF — 🟢 N/A
- Todos os `fetch` das Edge Functions vão para hosts **fixos/confiáveis**
  (Resend, SendGrid, Facebook Graph, Claude, Gemini, Google OAuth, Asaas,
  Supabase). Nenhum fetch usa URL fornecida pelo usuário. Não há como apontar
  para `169.254.169.254`. CT-e/anexos vão para Storage, não são "fetchados".

---

## MODERADAS

### CSRF — ✅ coberto pela arquitetura
- Auth é **Bearer token (JWT) no header Authorization**, não cookie de sessão
  automático. CSRF clássico depende de cookie auto-enviado pelo browser; como o
  token vai por header explícito (não em cookie), uma página maliciosa não
  consegue forjar a requisição autenticada. Edge sensíveis exigem o JWT.

### XSS (Reflected/Stored) — ✅ coberto
- React escapa tudo por padrão. Grep: `dangerouslySetInnerHTML`, `innerHTML`
  ⇒ **0 ocorrências**. CSP com `object-src 'none'`, `frame-src 'none'`.
- 🔧 Melhoria possível: remover `'unsafe-inline'`/`'unsafe-eval'` do
  `script-src` (ver R-CSP abaixo) — endurece ainda mais.

### IDOR — ✅ coberto (verificado na auditoria anterior)
- IDs são **UUID** (não sequenciais). RLS valida posse por `auth.uid()` em todas
  as tabelas de dados pessoais (R7 da auditoria: 0 vazamento cross-user provado).
- Trocar o UUID na URL não dá acesso — o servidor (RLS) nega.

---

## LEVES

### CSP e X-Frame-Options — ✅ já configurado (vercel.json)
- `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` ⇒ Clickjacking
  bloqueado em duas camadas.

### Exposição de Configuração/Debug — ✅ coberto
- SPA estática: não há `.env`/`phpinfo`/`.git` servidos. `.env` e segredos
  ignorados no Git (confirmado). Sem servidor que liste diretório.

### HSTS Bypass via Downgrade — ✅ coberto
- HSTS `max-age=31536000; includeSubDomains; preload` (1 ano). O caso vulnerável
  é `max-age=0`; o nosso é forte.

---

## LÓGICA E RECURSOS

### Password Reset Poisoning — ✅ coberto
- Reset é feito pelo **Supabase Auth** (`resetPasswordForEmail`), que envia para
  o email cadastrado, não para um host derivado de header `Host` manipulável.
  O link/redirect usa allowlist de Redirect URLs configurada no Supabase.
- 📋 Ação sua: confirmar no Supabase → Auth → URL Configuration que só os
  domínios do FreteGO estão na allowlist de Redirect URLs.

### Subdomain Takeover — 📋 ação operacional (DNS)
- Não é código. Verificar no painel DNS (Vercel/registrador) se não há CNAME
  órfão apontando para serviço desativado. Hoje: domínio aponta para Vercel
  (ativo) e Supabase (ativo). Sem subdomínio órfão conhecido.

### Clickjacking via SVG — ✅ mitigado
- `frame-ancestors 'none'` + `object-src 'none'`. SVGs de avatar/logo são
  servidos como imagem em buckets; não são renderizados como documento ativo
  na origem da app.

---

## DDoS (SYN Flood / Slowloris / DNS Amplification) — 🟢 infra (Vercel/Supabase)
- App é estática no edge da Vercel + Supabase gerenciado; ambos têm proteção
  L3/L4/L7 e rate-limit de borda. Não se configura em código. Rate-limit de
  aplicação (login, tickets, códigos) já existe nas RPCs.

---

## MELHORIAS QUE VOU APLICAR
- **R-CSP** 🔧 APLICADO: removido `'unsafe-eval'` do `script-src` no vercel.json.
  Confirmado que o bundle de produção não usa `eval()` (grep no dist = 0). Isso
  reduz a superfície de XSS (um payload injetado não consegue mais usar eval).
  `'unsafe-inline'` mantido por ora (Vite injeta bootstrap inline; trocar por
  nonce/hash é mais arriscado e de ganho menor — fica como melhoria futura).
