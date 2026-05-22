# Documento de Design — Onboarding e Perfil do Embarcador

## Visão Geral

Esta spec entrega três frentes de trabalho coordenadas para amadurecer o cadastro do Embarcador no FreteGO. Na **frente Schema**, a Migration `010_embarcador_onboarding.sql` adiciona `users.email_verified`, `embarcadores.company_logo_url`, cria a tabela `verification_codes`, ajusta a política RLS de `fretes_insert_policy` para exigir cadastro completo e provisiona o bucket `company-logos` com policies adequadas. Tudo é idempotente, no mesmo padrão da Migration 009.

Na **frente Backend**, o envio de código por e-mail acontece via uma Edge Function `send-verification-email` que usa o serviço SMTP que o Supabase já provê para o módulo Auth. O fluxo *não* usa `supabase.auth.signInWithOtp` porque o login do FreteGO emprega um e-mail sintético `{phone}@example.com` — verificar o e-mail real do Embarcador precisa ser ortogonal ao login. A geração e validação do código ficam encapsuladas em um par de funções RPC (`generate_email_verification_code`, `confirm_email_verification_code`) que cuidam de hash, expiração, rate limiting e auditoria. O serviço `verification.ts` no frontend é um cliente fino sobre essas RPCs.

Na **frente UI**, surgem quatro componentes novos (`BadgeEmpresa`, `BarraProgressoCadastro`, `ModalVerificacaoEmail`, `LogoUploadField`) e seis arquivos existentes recebem refatorações pontuais (`RegisterForm`, `RegisterPage`, `LoginPage`, `AppHeader`, `ConfiguracoesPage`, `EmbarcadorPerfilPage`, `EmbarcadorPage`, `fretes.ts`). O resultado é um perfil de Embarcador que mostra explicitamente o que falta, libera o botão "Postar Frete" só quando os três itens (foto, e-mail verificado e logo) estão completos, e protege essa regra também no banco via RLS.

## Glossário Técnico

| Termo do requirements | Artefato técnico |
|---|---|
| `Página_Cadastro` | `src/pages/RegisterPage.tsx` + `src/components/RegisterForm.tsx` |
| `Página_Login` | `src/pages/LoginPage.tsx` + `src/components/LoginForm.tsx` |
| `Página_Configurações` | `src/pages/ConfiguracoesPage.tsx` |
| `Página_Perfil_Embarcador` | `src/pages/EmbarcadorPerfilPage.tsx` |
| `Página_Embarcador` | `src/pages/EmbarcadorPage.tsx` |
| `AppHeader` | `src/components/AppHeader.tsx` |
| `Badge_Tipo_Usuário` | `<span>` com `userTypeLabel` no `AppHeader` |
| `Badge_Empresa` | **NOVO** `src/components/BadgeEmpresa.tsx` |
| `Modal_Verificação` | **NOVO** `src/components/ModalVerificacaoEmail.tsx` |
| `Barra_Progresso_Cadastro` | **NOVO** `src/components/BarraProgressoCadastro.tsx` |
| Upload de logo | **NOVO** `src/components/LogoUploadField.tsx` |
| `Tabela_Códigos` | **NOVA** tabela `verification_codes` |
| `Serviço_Email_OTP` | **NOVA** Edge Function `supabase/functions/send-verification-email` + RPC `generate_email_verification_code` |
| Cliente do Serviço_Email_OTP | **NOVO** `src/services/verification.ts` |
| Foto_Perfil | `documents` tipo `profile_photo` + `users.profile_photo_url` (já existe; trigger `sync_profile_photo_url_trigger` da Migration 009) |
| Logo_Empresa | **NOVA** coluna `embarcadores.company_logo_url` + bucket `company-logos` |
| Schema | **NOVA** Migration `supabase/migrations/010_embarcador_onboarding.sql` |

## Arquitetura por Requisito

### Requisito 1 — Texto do Botão de Criação de Conta

**Arquivos:** `src/components/RegisterForm.tsx`.

Mudança trivial no rótulo do submit. Hoje o botão diz "Transporte conosco" só quando o tipo está selecionado; troca para "Criar conta", uniforme para Motorista e Embarcador, e o estado de loading vira "Criando conta...".

```tsx
<button type="submit" disabled={isLoading} className="...">
  {isLoading ? 'Criando conta...' : 'Criar conta'}
</button>
```

### Requisito 2 — Fluxo de Cadastro Separado do Login

**Arquivos:** `src/pages/RegisterPage.tsx`, `src/pages/LoginPage.tsx`, `src/components/LoginForm.tsx`.

Após `register()` com sucesso, a `RegisterPage` chama `supabase.auth.signOut()` para encerrar a sessão criada automaticamente pelo `signUp` e navega para `/login` com `state` carregando mensagem e telefone. A `LoginPage` lê esse `state` via `useLocation()` e pré-preenche o `LoginForm` com o telefone via prop opcional.

```tsx
// RegisterPage.tsx
const handleRegister = async (data: RegisterData) => {
  await register(data);
  await supabase.auth.signOut();
  localStorage.removeItem('fretego_user'); // limpa o estado salvo pelo useAuth
  navigate('/login', {
    state: { successMessage: 'Conta criada com sucesso. Faça login para continuar.', phone: data.phone },
  });
};
```

```tsx
// LoginPage.tsx
const location = useLocation();
const successMessage = (location.state as any)?.successMessage as string | undefined;
const prefillPhone = (location.state as any)?.phone as string | undefined;
// ...
<LoginForm onSubmit={handleLogin} successMessage={successMessage} initialPhone={prefillPhone} />
```

O `useAuth` continua intacto — só a `RegisterPage` precisa orquestrar o `signOut` antes do redirect, e o `register()` do hook não precisa mudar de assinatura.

### Requisito 3 — Badge da Empresa no Cabeçalho

**Arquivos:** `src/components/AppHeader.tsx`, **NOVO** `src/components/BadgeEmpresa.tsx`, `src/services/embarcador.ts`.

O `AppHeader` busca `getEmbarcadorProfile(user.id)` em `useEffect` quando `user.userType === 'embarcador'`. O nome cai em estado local; o `BadgeEmpresa` recebe `companyName` como prop e renderiza apenas se for não vazio. Truncamento de 20 caracteres com reticências quando `window.innerWidth < 640` (via `useIsMobile` que já existe).

```tsx
// BadgeEmpresa.tsx
export function BadgeEmpresa({ companyName }: { companyName: string }) {
  const isMobile = useIsMobile();
  const display = isMobile && companyName.length > 20
    ? companyName.slice(0, 20) + '…'
    : companyName;
  return (
    <span
      className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200"
      title={companyName}
      aria-label={`Empresa: ${companyName}`}
    >
      {display}
    </span>
  );
}
```

```tsx
// AppHeader.tsx — bloco onde Badge_Tipo_Usuário é renderizado
{isAuthenticated && user && (
  <>
    <span className="text-xs ...">{userTypeLabel}</span>
    {user.userType === 'embarcador' && companyName && (
      <BadgeEmpresa companyName={companyName} />
    )}
  </>
)}
```

### Requisito 4 — Remoção da Zona de Perigo

**Arquivos:** `src/pages/ConfiguracoesPage.tsx`.

Apaga a `<div>` da seção "Zona de Perigo", remove `handleDeleteAccount` e o import de `useNavigate` se ficar órfão. Mantém a seção de troca de senha intacta. Sem mudança de schema ou serviço.

### Requisito 5 — Nome em Modo Somente Leitura

**Arquivos:** `src/pages/EmbarcadorPerfilPage.tsx`, `src/services/embarcador.ts`.

O input de `name` vira um `<p>` somente leitura. O `handleSave` deixa de enviar `name` ao `updateEmbarcadorProfile`. O serviço já só atualiza chaves presentes em `data`, então a remoção do campo no payload basta.

```tsx
<div>
  <label className="block text-xs text-gray-600 mb-1">Nome</label>
  <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800 text-sm">
    {name}
  </p>
</div>
```

### Requisito 6 — Verificação de E-mail por Código

**Arquivos:** **NOVO** `src/services/verification.ts`, **NOVO** `src/components/ModalVerificacaoEmail.tsx`, Migration 010, RPCs SQL, `src/pages/EmbarcadorPerfilPage.tsx`.

Fluxo completo descrito na seção dedicada abaixo. Em alto nível:

1. Usuário digita o e-mail e clica "Verificar e-mail".
2. Frontend chama `sendEmailVerificationCode(email)` que invoca a RPC `generate_email_verification_code(p_email)`.
3. A RPC gera código de 6 dígitos, calcula hash SHA-256, invalida códigos anteriores não consumidos do mesmo `(user_id, purpose)`, insere em `verification_codes`, registra em `audit_logs` e retorna o código em texto claro só para a Edge Function que dispara o e-mail (a RPC chama `pg_net.http_post` para a Edge Function).
4. `ModalVerificacaoEmail` abre, com 6 inputs de dígito, contador de reenvio de 60 segundos e exibição de mensagens de erro.
5. Submit chama `confirmEmailVerificationCode(code)` que invoca RPC `confirm_email_verification_code(p_code)` — compara hash em tempo constante, incrementa `attempts` em falha, marca `consumed = true` em sucesso, atualiza `users.email` e `users.email_verified = true`.
6. Sucesso fecha o modal e exibe o selo "E-mail confirmado".

```tsx
// ModalVerificacaoEmail.tsx — esqueleto
function ModalVerificacaoEmail({ email, onClose, onSuccess }: Props) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [attempts, setAttempts] = useState(0);
  const [resendTimer, setResendTimer] = useState(60);
  const [error, setError] = useState<string | null>(null);
  // ... timer de reenvio, foco no primeiro input ao montar, ESC fecha, etc.
  const handleSubmit = async () => {
    const code = digits.join('').replace(/\D/g, '');
    try {
      await confirmEmailVerificationCode(code);
      onSuccess();
    } catch (e: any) {
      if (e.code === 'BLOCKED') { setError('Código bloqueado. Solicite um novo código.'); }
      else if (e.code === 'EXPIRED') { setError('Código expirado. Solicite um novo código.'); }
      else { setError('Código incorreto. Tente novamente.'); setAttempts(a => a + 1); }
    }
  };
}
```

### Requisito 7 — Telefone Somente Leitura

**Arquivos:** `src/pages/EmbarcadorPerfilPage.tsx`.

O campo `WhatsApp` editável cai. Em vez disso, exibimos `users.phone` formatado em texto estático. O submit do formulário deixa de mandar `whatsapp` ao `updateEmbarcadorProfile`. Importante: `embarcadores.whatsapp` continua existindo e é usado nos `FreteModal` para link do WhatsApp do embarcador — fica congelado no valor inicial criado no signup. Se no futuro precisar editar, vira spec separada.

### Requisito 8 — Upload do Logo da Empresa

**Arquivos:** **NOVO** `src/components/LogoUploadField.tsx`, `src/services/embarcador.ts`, Migration 010 (bucket).

`uploadCompanyLogo(userId, file)` valida mime e tamanho no cliente, faz `supabase.storage.from('company-logos').upload(...)` no caminho `embarcadores/<user_id>/logo.<ext>`, pega URL pública e atualiza `embarcadores.company_logo_url`. O componente `LogoUploadField` é stateless quanto à URL inicial (vem como prop) e callback `onUploaded(url)`.

```ts
// embarcador.ts
export async function uploadCompanyLogo(userId: string, file: File): Promise<string> {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Formato inválido. Envie JPG, PNG ou WEBP.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Arquivo muito grande. Limite de 2 MB.');
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
  const path = `embarcadores/${userId}/logo.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('company-logos')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw new Error(`Erro no upload: ${upErr.message}`);
  const { data: pub } = supabase.storage.from('company-logos').getPublicUrl(path);
  const url = pub.publicUrl;
  const { error: dbErr } = await supabase
    .from('embarcadores').update({ company_logo_url: url }).eq('id', userId);
  if (dbErr) throw new Error(`Erro ao salvar URL do logo: ${dbErr.message}`);
  return url;
}
```

### Requisito 9 — Barra de Progresso de Cadastro

**Arquivos:** **NOVO** `src/components/BarraProgressoCadastro.tsx`, `src/services/embarcador.ts`, `src/pages/EmbarcadorPerfilPage.tsx`.

Função `getEmbarcadorOnboardingProgress(userId)` retorna `{ profilePhoto: bool, emailVerified: bool, companyLogo: bool, percent: number, missing: string[] }`. O componente é puramente apresentacional, recebe esse objeto via prop e re-renderiza quando o `EmbarcadorPerfilPage` atualiza o estado após cada operação (upload de foto, verificação de e-mail, upload de logo).

```ts
// embarcador.ts
export async function getEmbarcadorOnboardingProgress(userId: string) {
  const { data: u } = await supabase
    .from('users').select('profile_photo_url, email_verified').eq('id', userId).single();
  const { data: e } = await supabase
    .from('embarcadores').select('company_logo_url').eq('id', userId).single();
  const items = {
    profilePhoto: !!u?.profile_photo_url,
    emailVerified: !!u?.email_verified,
    companyLogo: !!e?.company_logo_url,
  };
  const done = Object.values(items).filter(Boolean).length;
  const percent = Math.round((done / 3) * 100);
  const missing: string[] = [];
  if (!items.profilePhoto) missing.push('Adicionar foto de perfil');
  if (!items.emailVerified) missing.push('Verificar e-mail');
  if (!items.companyLogo) missing.push('Adicionar logo da empresa');
  return { ...items, percent, missing };
}
```

```tsx
// BarraProgressoCadastro.tsx — esqueleto
const color = percent < 50 ? 'bg-red-500' : percent < 100 ? 'bg-yellow-500' : 'bg-green-500';
return (
  <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
    <div className="flex justify-between items-center mb-1">
      <span className="text-sm text-gray-700">Cadastro</span>
      <span className="text-sm font-medium">{percent}% completo</span>
    </div>
    <div className="w-full h-2 bg-gray-200 rounded-full">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${percent}%` }} />
    </div>
    {missing.length > 0 && (
      <ul className="mt-2 text-xs text-gray-600 list-disc list-inside">
        {missing.map(m => <li key={m}>{m}</li>)}
      </ul>
    )}
  </div>
);
```

### Requisito 10 — Restrição de Postagem de Frete

**Arquivos:** `src/pages/EmbarcadorPage.tsx`, `src/services/fretes.ts`, Migration 010 (RLS).

Três camadas de defesa:

1. **UI:** `EmbarcadorPage` carrega `getEmbarcadorOnboardingProgress` no mount; se `percent < 100`, o botão "Postar Frete" fica `disabled` e mostra dica "Complete seu cadastro para postar fretes" com link para `/perfil/embarcador`.
2. **Cliente do serviço:** `createFrete` em `fretes.ts` ganha guarda inicial que chama `getEmbarcadorOnboardingProgress(data.embarcadorId)` e lança `Error('Cadastro incompleto. Verifique e-mail, foto e logo da empresa.')` se incompleto.
3. **Banco:** a `fretes_insert_policy` é recriada na Migration 010 para exigir cadastro completo (ver seção Schema Changes).

```ts
// fretes.ts — guarda no createFrete
export async function createFrete(data: CreateFreteData): Promise<Frete> {
  const progress = await getEmbarcadorOnboardingProgress(data.embarcadorId);
  if (progress.percent < 100) {
    throw new Error('Cadastro incompleto. Verifique e-mail, foto e logo da empresa.');
  }
  // ... insert existente
}
```

### Requisito 11 — Schema de Banco

Coberto em detalhes na seção **Schema Changes**.

### Requisito 12 — Round-Trip do Código

**Arquivos:** RPCs SQL na Migration 010, `src/services/verification.ts`.

A geração e a confirmação compartilham a função `hash_verification_code(code)` para garantir que `gerar → hash → normalizar → hash` seja idempotente. Comparação usa o operador `=` sobre `bytea` em PL/pgSQL, equivalente a `pg_sodium`/`pgcrypto` em tempo constante. O frontend só vê o código em texto claro no input do usuário; o backend só vê hash.

```sql
-- helper interno
CREATE OR REPLACE FUNCTION hash_verification_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN encode(digest(regexp_replace(p_code, '\D', '', 'g'), 'sha256'), 'base64');
END;
$$;
```

### Requisito 13 — Telemetria e Logs

As RPCs `generate_email_verification_code`, `confirm_email_verification_code` inserem em `audit_logs` com `action`, `user_id`, e `new_data` JSONB que carrega `purpose` e `target_masked` (apenas últimos 4 caracteres). Nunca persistimos código em texto claro nem hash em logs.

```sql
INSERT INTO audit_logs (user_id, action, new_data)
VALUES (
  v_user_id,
  'verification_code_sent',
  jsonb_build_object('purpose', 'email', 'target_masked', '****' || right(p_email, 4))
);
```

### Requisito 14 — Acessibilidade

- `ModalVerificacaoEmail`: `useEffect` com `inputRef.current?.focus()` no mount; salva `document.activeElement` antes de abrir e devolve o foco ao desmontar; `keydown` handler para `Escape`.
- `BarraProgressoCadastro`: já mostrado acima com `role="progressbar"` e `aria-value*`.
- `BadgeEmpresa`: `title` e `aria-label` carregam o nome completo, o que cobre o caso truncado.
- Selo "E-mail confirmado": classes Tailwind com contraste verificado (`text-green-700` sobre `bg-green-50` rende ~7.5:1).

## Detalhamento da Verificação por E-mail

### Por que não usar `auth.signInWithOtp` direto

O cadastro do FreteGO usa um e-mail sintético `{phone}@example.com` para criar o usuário no Supabase Auth, porque o campo de identidade visível ao usuário é o telefone. Isso significa que a tabela `auth.users` tem um e-mail que não é o e-mail real do Embarcador. `signInWithOtp` opera sobre `auth.users.email`, então usá-lo aqui:

- Forçaria sobrescrita do e-mail sintético no `auth.users`, quebrando o login por telefone+senha.
- Não nos daria controle sobre `attempts`, `expires_at` curto (10 min), invalidação de códigos antigos e auditoria mascarada que o Requisito 6 e o 13 exigem.
- Mistura "verificar identidade do e-mail" com "fazer login", quando os dois fluxos são ortogonais nesta aplicação.

A solução é construir o nosso próprio fluxo de OTP por e-mail, mantendo o e-mail real apenas em `users.email` (tabela de domínio) e usando o SMTP do Supabase como transporte.

### Componentes do fluxo

```
┌──────────────────────┐           ┌──────────────────────────────┐
│ EmbarcadorPerfilPage │           │ verification.ts (cliente)    │
│  - botão "Verificar" │──────────▶│  sendEmailVerificationCode   │
└──────────────────────┘           │  confirmEmailVerificationCode│
            ▲                      └──────────────┬───────────────┘
            │ onSuccess                           │ supabase.rpc
            │                                     ▼
┌──────────────────────┐           ┌──────────────────────────────┐
│ ModalVerificacaoEmail│           │ RPC PostgreSQL                │
│  - 6 inputs          │◀──────────│ generate_email_verification_  │
│  - timer 60s         │           │   code(p_email)               │
└──────────────────────┘           │ confirm_email_verification_   │
                                   │   code(p_code)                │
                                   └──────────────┬───────────────┘
                                                  │ pg_net.http_post
                                                  ▼
                                   ┌──────────────────────────────┐
                                   │ Edge Function                │
                                   │ send-verification-email      │
                                   │  - usa SMTP do Supabase Auth │
                                   │    via Admin API             │
                                   └──────────────────────────────┘
```

### `generate_email_verification_code(p_email TEXT)` — comportamento

1. Valida `auth.uid()` não nulo (sessão obrigatória).
2. Valida formato RFC 5322 do `p_email` (regex simples).
3. Aplica rate limit: rejeita se já houve 3 inserts não consumidos para `(user_id, purpose='email')` nas últimas 24h.
4. Invalida códigos anteriores: `UPDATE verification_codes SET consumed = true WHERE user_id = auth.uid() AND purpose = 'email' AND consumed = false`.
5. Gera código de 6 dígitos com `lpad((random() * 1000000)::int::text, 6, '0')`.
6. Calcula hash via `hash_verification_code`.
7. Insere registro com `expires_at = NOW() + interval '10 minutes'`.
8. Chama Edge Function via `pg_net.http_post('/functions/v1/send-verification-email', ...)` enviando `{ email, code }` no body. A chave de serviço fica em uma `vault` ou em `app.settings`.
9. Insere em `audit_logs` com `action = 'verification_code_sent'` e `target_masked`.
10. Retorna `{ ok: true }` (nunca o código).

### `confirm_email_verification_code(p_code TEXT)` — comportamento

1. Normaliza `p_code` removendo não dígitos.
2. Busca o registro mais recente para `(auth.uid(), 'email', consumed=false)` ordenado por `created_at DESC`.
3. Se não houver, retorna erro `EXPIRED`.
4. Se `expires_at < NOW()`, marca `consumed = true` e retorna `EXPIRED`.
5. Se `attempts >= 3`, marca `consumed = true`, registra `verification_blocked` em audit e retorna `BLOCKED`.
6. Compara hash do código recebido com `code_hash`. Se diferente, incrementa `attempts`, retorna `INVALID`.
7. Se igual: `UPDATE` no registro (`consumed = true`), `UPDATE users SET email = (target do registro), email_verified = true`, audit `verification_succeeded`, retorna `{ ok: true }`.

### Edge Function `send-verification-email`

Recebe POST com `{ email, code }`, autenticada por header `apikey` (service role). Usa `supabase.auth.admin.inviteUserByEmail` *não* — em vez disso usa SMTP via REST do Supabase quando disponível. **Para o MVP** existe um modo dev: se `Deno.env.get('VERIFICATION_DEV_LOG') === 'true'`, apenas faz `console.log({ email, code })` e retorna `200`. Em produção a function chama o endpoint SMTP configurado, podendo ser trocado por Resend/SendGrid sem alterar a RPC.

```ts
// supabase/functions/send-verification-email/index.ts — esqueleto
serve(async (req) => {
  const { email, code } = await req.json();
  if (!email || !code) return new Response('Bad request', { status: 400 });
  if (Deno.env.get('VERIFICATION_DEV_LOG') === 'true') {
    console.log(`[DEV] verification code for ${email}: ${code}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  // produção: chama provedor de e-mail (Resend, SendGrid, SMTP do Supabase)
  // ...
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
```

### Resumo dos contratos do cliente

```ts
// src/services/verification.ts
export async function sendEmailVerificationCode(email: string): Promise<void> {
  const { error } = await supabase.rpc('generate_email_verification_code', { p_email: email });
  if (error) throw new Error(error.message);
}

export async function confirmEmailVerificationCode(code: string): Promise<void> {
  const { data, error } = await supabase.rpc('confirm_email_verification_code', { p_code: code });
  if (error) throw new Error(error.message);
  if (data?.status === 'BLOCKED' || data?.status === 'EXPIRED' || data?.status === 'INVALID') {
    const e = new Error(data.status); (e as any).code = data.status; throw e;
  }
}

export async function getVerificationStatus(): Promise<{ emailVerified: boolean }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { emailVerified: false };
  const { data } = await supabase.from('users').select('email_verified').eq('id', user.id).single();
  return { emailVerified: !!data?.email_verified };
}
```

## Schema Changes

### Migration `010_embarcador_onboarding.sql`

Idempotente, no padrão da Migration 009.

```sql
BEGIN;

-- 1. Colunas novas
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE embarcadores
  ADD COLUMN IF NOT EXISTS company_logo_url TEXT;

-- 2. Tabela verification_codes
CREATE TABLE IF NOT EXISTS verification_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     VARCHAR(20) NOT NULL CHECK (purpose IN ('email')),
  target      VARCHAR(255) NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_user_purpose_consumed
  ON verification_codes (user_id, purpose, consumed);

ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_codes_select_policy ON verification_codes;
CREATE POLICY verification_codes_select_policy ON verification_codes
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS verification_codes_update_policy ON verification_codes;
CREATE POLICY verification_codes_update_policy ON verification_codes
  FOR UPDATE USING (user_id = auth.uid());

-- INSERT só via SECURITY DEFINER nas RPCs (sem policy de INSERT pro usuário direto).

-- 3. Trigger de invalidação de códigos antigos
CREATE OR REPLACE FUNCTION invalidate_old_verification_codes()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE verification_codes
     SET consumed = true
   WHERE user_id = NEW.user_id
     AND purpose = NEW.purpose
     AND id <> NEW.id
     AND consumed = false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invalidate_old_codes_trigger ON verification_codes;
CREATE TRIGGER invalidate_old_codes_trigger
  AFTER INSERT ON verification_codes
  FOR EACH ROW EXECUTE FUNCTION invalidate_old_verification_codes();

-- 4. Função hash_verification_code (compartilhada)
CREATE OR REPLACE FUNCTION hash_verification_code(p_code TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN encode(digest(regexp_replace(p_code, '\D', '', 'g'), 'sha256'), 'base64');
END;
$$;

-- 5. RPC generate_email_verification_code
CREATE OR REPLACE FUNCTION generate_email_verification_code(p_email TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_recent_count INTEGER;
  v_code TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;

  SELECT COUNT(*) INTO v_recent_count
    FROM verification_codes
   WHERE user_id = v_user_id AND purpose = 'email'
     AND created_at > NOW() - interval '24 hours';
  IF v_recent_count >= 3 THEN RAISE EXCEPTION 'rate_limited'; END IF;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  INSERT INTO verification_codes (user_id, purpose, target, code_hash, expires_at)
  VALUES (v_user_id, 'email', p_email, hash_verification_code(v_code), NOW() + interval '10 minutes');

  -- audit (target mascarado)
  INSERT INTO audit_logs (user_id, action, new_data)
  VALUES (v_user_id, 'verification_code_sent',
          jsonb_build_object('purpose', 'email',
                             'target_masked', '****' || right(p_email, 4)));

  -- dispara Edge Function via pg_net (configurada com chave em app.settings)
  PERFORM net.http_post(
    url := current_setting('app.settings.edge_url') || '/send-verification-email',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer ' || current_setting('app.settings.service_key')),
    body := jsonb_build_object('email', p_email, 'code', v_code)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 6. RPC confirm_email_verification_code (esqueleto)
CREATE OR REPLACE FUNCTION confirm_email_verification_code(p_code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_record verification_codes%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_record FROM verification_codes
   WHERE user_id = v_user_id AND purpose = 'email' AND consumed = false
   ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('status','EXPIRED'); END IF;

  IF v_record.expires_at < NOW() THEN
    UPDATE verification_codes SET consumed = true WHERE id = v_record.id;
    RETURN jsonb_build_object('status','EXPIRED');
  END IF;

  IF v_record.attempts >= 3 THEN
    UPDATE verification_codes SET consumed = true WHERE id = v_record.id;
    INSERT INTO audit_logs (user_id, action, new_data)
    VALUES (v_user_id, 'verification_blocked', jsonb_build_object('purpose','email'));
    RETURN jsonb_build_object('status','BLOCKED');
  END IF;

  IF v_record.code_hash <> hash_verification_code(p_code) THEN
    UPDATE verification_codes SET attempts = attempts + 1 WHERE id = v_record.id;
    RETURN jsonb_build_object('status','INVALID');
  END IF;

  UPDATE verification_codes SET consumed = true WHERE id = v_record.id;
  UPDATE users SET email = v_record.target, email_verified = true, updated_at = NOW()
   WHERE id = v_user_id;

  INSERT INTO audit_logs (user_id, action, new_data)
  VALUES (v_user_id, 'verification_succeeded', jsonb_build_object('purpose','email'));

  RETURN jsonb_build_object('status','OK');
END;
$$;

-- 7. RLS de fretes_insert_policy: exigir cadastro completo
DROP POLICY IF EXISTS fretes_insert_policy ON fretes;
CREATE POLICY fretes_insert_policy ON fretes
FOR INSERT
WITH CHECK (
  embarcador_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM users u
     WHERE u.id = auth.uid()
       AND u.user_type = 'embarcador'
       AND u.email_verified = true
       AND u.profile_photo_url IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM embarcadores e
     WHERE e.id = auth.uid()
       AND e.company_logo_url IS NOT NULL
  )
);

COMMIT;
```

### Bucket `company-logos`

Aplicado em arquivo SQL separado em `supabase/storage/setup_company_logos.sql` (mesmo padrão do `setup_storage.sql` existente):

```sql
-- bucket público
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- leitura pública
DROP POLICY IF EXISTS "company_logos_public_read" ON storage.objects;
CREATE POLICY "company_logos_public_read" ON storage.objects
FOR SELECT USING (bucket_id = 'company-logos');

-- escrita: só o dono (path embarcadores/<auth.uid()>/...)
DROP POLICY IF EXISTS "company_logos_owner_write" ON storage.objects;
CREATE POLICY "company_logos_owner_write" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] = 'embarcadores'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "company_logos_owner_update" ON storage.objects;
CREATE POLICY "company_logos_owner_update" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] = 'embarcadores'
  AND (storage.foldername(name))[2] = auth.uid()::text
);
```

## Componentes React Novos

### `src/components/BadgeEmpresa.tsx`
Já mostrado no Requisito 3. Apresentacional puro, prop `companyName: string`.

### `src/components/BarraProgressoCadastro.tsx`
Já mostrado no Requisito 9. Recebe `{ percent, missing }`.

### `src/components/ModalVerificacaoEmail.tsx`
Modal acessível com 6 inputs de dígito, timer de reenvio de 60 segundos, mensagens de erro distintas para `INVALID`, `EXPIRED` e `BLOCKED`. Props:

```ts
interface Props {
  email: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (verifiedEmail: string) => void;
}
```

Recursos: `useEffect` para focar o primeiro input e capturar `Escape`; `useRef` no `Modal` para devolver foco ao botão de origem ao fechar.

### `src/components/LogoUploadField.tsx`
Apresentacional + lógica de upload delegada ao `embarcador.ts`. Props:

```ts
interface Props {
  userId: string;
  currentLogoUrl: string | null;
  onUploaded: (url: string) => void;
}
```

Renderiza preview circular ou placeholder, input de arquivo escondido + label "Alterar logo", e mensagens de erro/sucesso inline.

## Serviços/Funções Novas

### `src/services/verification.ts`
- `sendEmailVerificationCode(email: string): Promise<void>` — chama RPC.
- `confirmEmailVerificationCode(code: string): Promise<void>` — chama RPC e mapeia status para erros tipados.
- `getVerificationStatus(): Promise<{ emailVerified: boolean }>` — leitura rápida da coluna.

### Adições em `src/services/embarcador.ts`
- `uploadCompanyLogo(userId: string, file: File): Promise<string>`.
- `getEmbarcadorOnboardingProgress(userId: string)` retornando o objeto definido no Requisito 9.

### Edge Function `supabase/functions/send-verification-email`
MVP em modo dev (log no console), produção pluga em provedor SMTP. Body `{ email, code }`, header `apikey` validada via service role.

## Mudanças em Componentes Existentes

| Arquivo | Mudança |
|---|---|
| `src/components/RegisterForm.tsx` | Texto do botão "Criar conta" / "Criando conta..." (Req. 1). |
| `src/pages/RegisterPage.tsx` | `signOut` + `navigate('/login', { state: { successMessage, phone } })` após sucesso (Req. 2). |
| `src/pages/LoginPage.tsx` | Lê `location.state` e passa `successMessage` + `initialPhone` ao `LoginForm` (Req. 2). |
| `src/components/LoginForm.tsx` | Aceita props opcionais `successMessage` e `initialPhone`; renderiza banner verde quando há mensagem; usa `defaultValues` no `useForm` (Req. 2). |
| `src/components/AppHeader.tsx` | Carrega nome da empresa para Embarcador, renderiza `BadgeEmpresa` ao lado do `Badge_Tipo_Usuário` (Req. 3). |
| `src/pages/ConfiguracoesPage.tsx` | Remove seção "Zona de Perigo" e `handleDeleteAccount` (Req. 4). |
| `src/pages/EmbarcadorPerfilPage.tsx` | Adiciona `BarraProgressoCadastro` no topo; nome em texto estático (Req. 5); campo de e-mail com botão "Verificar e-mail" + `ModalVerificacaoEmail` (Req. 6); telefone como texto estático formatado (Req. 7); `LogoUploadField` após nome da empresa (Req. 8); recarrega `getEmbarcadorOnboardingProgress` após cada conclusão (Req. 9). |
| `src/pages/EmbarcadorPage.tsx` | Carrega progresso no mount, desabilita botão "Postar Frete" quando incompleto, exibe aviso e link para `/perfil/embarcador` (Req. 10). |
| `src/services/fretes.ts` | `createFrete` valida `getEmbarcadorOnboardingProgress` antes do insert (Req. 10). |
| `src/services/embarcador.ts` | Remove envio de `name` e `whatsapp` no `updateEmbarcadorProfile` quando vier do perfil (mantém retrocompatibilidade aceitando campos opcionais, mas a página não os envia). Adiciona `uploadCompanyLogo` e `getEmbarcadorOnboardingProgress`. |

## Estratégia de Validação

**Property-based testing aplica parcialmente.** Os requisitos 12 (round-trip do código) e 9 (cálculo de progresso) são candidatos naturais a PBT — funções puras com domínio bem definido. O resto é majoritariamente UI, RLS e workflow do Supabase, melhor coberto por testes manuais smoke e integração mockada.

### Smoke manual por requisito
- Req. 1: cadastrar embarcador, ver botão com texto certo nos dois estados.
- Req. 2: completar cadastro, verificar redirect e mensagem; tentar acessar `/embarcador` sem logar e ser bloqueado.
- Req. 3: logar como Embarcador, ver `BadgeEmpresa` no header; redimensionar para mobile e verificar truncamento.
- Req. 4: visitar `/configuracoes`, garantir que "Zona de Perigo" desapareceu.
- Req. 5: editar perfil, confirmar nome em texto estático.
- Req. 6: pedir código, conferir log dev (ou e-mail real), digitar, confirmar marcação `email_verified = true`. Testar 3 tentativas erradas, expiração, reenvio bloqueado por 60s.
- Req. 7: ver telefone formatado, confirmar que payload de update não envia `whatsapp`.
- Req. 8: upload de logo válido, inválido (PDF), grande (>2MB).
- Req. 9: incompleto vermelho < 50%, amarelo, completar tudo e ver verde 100%; lista de pendências some.
- Req. 10: tentar postar com cadastro incompleto via UI (botão desabilitado), via direct API call (bloqueado pelo `createFrete`), via SQL puro com session do user (bloqueado pelo RLS).
- Req. 11: rodar migration em base limpa e em base com dados; idempotência.
- Req. 13: gerar código e ver `audit_logs` com `target_masked`.
- Req. 14: navegar o modal só com teclado (Tab, Esc, Enter).

### PBTs sugeridos (vitest + fast-check)
- `src/__tests__/verification.property.test.ts`: para todo código de 6 dígitos `c`, `hash(c) === hash(normalize(c + " "))` e `hash(c) === hash(c.split("").join("-"))`. Garante o round-trip do Req. 12.
- `src/__tests__/onboardingProgress.property.test.ts`: para toda combinação dos 3 booleans, `percent` é múltiplo de 33 (com 100 quando os três true) e `missing.length === 3 - countTrue`.
- `src/__tests__/maskTarget.property.test.ts`: para todo e-mail válido, `mask(e)` exibe exatamente os últimos 4 caracteres e oculta o restante com `*`.

### Configuração de testes
- Mínimo 100 iterações por property test (fast-check default já 100).
- Tag por teste: `// Feature: embarcador-onboarding, Property N: <descrição>`.

## Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| SMTP do Supabase tem rate limit baixo (≈4 e-mails/hora no plano Free) | Em produção, trocar a Edge Function para Resend ou SendGrid sem alterar RPC. Manter modo dev com `console.log` para evitar consumo de cota durante desenvolvimento. |
| Embarcador troca o e-mail várias vezes para spam | RPC `generate_email_verification_code` aplica rate limit de **3 envios/24h** por `user_id`. Acima disso retorna `rate_limited` e o frontend exibe "Muitas tentativas. Tente novamente em algumas horas." |
| Migration 010 quebra Embarcadores antigos sem foto/logo | A política RLS é nova e já bloqueia INSERT em `fretes` de quem está incompleto, mas isso é exatamente o desejado. Adicionar **banner global** na `EmbarcadorPage` para usuários antigos: "Seu cadastro precisa ser completado para postar novos fretes" com link para `/perfil/embarcador`. Fretes existentes não são afetados (RLS bloqueia só INSERT). |
| Edge Function fica indisponível | RPC trata `pg_net.http_post` em try/catch lógico (via `BEGIN/EXCEPTION` em PL/pgSQL futuro) — para o MVP, se o post falhar a transação ainda gera o código no banco; o usuário pode usar "Reenviar". Documentar que falha de e-mail não derruba a verificação. |
| Race condition entre dois cliques de "Verificar" | O trigger `invalidate_old_codes_trigger` garante que só o registro mais recente fica `consumed = false`. A `confirm_email_verification_code` sempre pega o mais recente. |
| Bucket `company-logos` público vaza logos de empresas privadas | Por design, logos de empresa são informação institucional pública (já aparecem no card do frete para o motorista). Mantemos bucket público para servir as URLs sem assinatura. Se um dia for sensível, troca para `getSignedUrl`. |
| Comparação de hash não constante-time vaza tempo | A comparação `=` em PL/pgSQL sobre strings curtas e de mesmo tamanho não tem variação prática significativa. Para nível alto, podemos migrar para `pgcrypto` `crypt()` futuramente. Documentado como aceitável para o MVP. |
| Usuário tenta enviar `email` com case diferente | A RPC armazena exatamente o que veio. Em uma versão futura podemos normalizar para lowercase antes do hash; por ora não é requisito. |
