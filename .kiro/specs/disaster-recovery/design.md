# Design — Plano de Continuidade e Disaster Recovery

## Visão geral

Solução em três frentes, todas aditivas e não-intrusivas:

1. **Mirror automático** — GitHub Action que, a cada push em `main`, faz
   `git push --mirror` para um remoto secundário (GitLab/Gitea/Codeberg).
2. **Documentação DR** — `docs/DISASTER_RECOVERY.md` com inventário de
   dependências, SPOFs e runbooks de recuperação.
3. **Centralização de env** — módulo `src/config/env.ts` único que lê e valida
   `import.meta.env`, consumido por `supabase.ts` (e futuros consumidores).

## 1. Mirror automático (`.github/workflows/mirror.yml`)

### Mecanismo

Usa o evento `push` na branch `main`. O job clona o repo com histórico completo
(`fetch-depth: 0`) e executa `git push --mirror` para a URL secundária com token
embutido via secret.

```yaml
on:
  push:
    branches: [main]
```

### Segredos necessários (GitHub → Settings → Secrets and variables → Actions)

- `MIRROR_REPO_URL` — URL HTTPS do repo secundário, ex:
  `https://gitlab.com/seu-usuario/fretego.git`
- `MIRROR_TOKEN` — Personal Access Token (PAT) do GitLab/Gitea com escopo de
  escrita (`write_repository`).

### Comportamento de falha (R1.4)

O job de mirror é **separado** do `ci.yml`. Se os secrets faltarem, o job falha
e o usuário recebe o email de "workflow failed" — visível, não silencioso — mas
o pipeline de qualidade (`ci.yml`) continua independente.

Adiciona-se um guard: se `MIRROR_REPO_URL` estiver vazio, o job emite um aviso
explicativo e encerra com erro orientado (em vez de um erro críptico de git).

### Por que push explícito de heads/tags

`git push --mirror` replicaria **todos** os refs, inclusive refs internas de
rastreamento do GitHub (ex: `refs/pull/*`), que o remoto secundário rejeita com
`deny updating a hidden ref`. Por isso o workflow empurra explicitamente apenas
`refs/heads/*` (branches) e `refs/tags/*` (tags) com `--force`, garantindo R1.3
de forma idempotente e compatível entre plataformas.

## 2. Documentação DR (`docs/DISASTER_RECOVERY.md`)

Estrutura:

- **Inventário de dependências** — tabela serviço → papel → criticidade →
  mitigação.
- **Runbooks por SPOF**:
  - GitHub indisponível → trocar remote para o mirror, continuar dev/deploy.
  - Supabase indisponível → restaurar de backup (PITR/dump), reaplicar
    migrations, reconfigurar storage e edge functions.
  - Vercel indisponível → redeploy alternativo (build estático + qualquer host).
  - Asaas/Resend/FCM/Meta indisponíveis → degradação controlada.
- **Setup local do zero** — clonar, `.env`, `npm ci`, `npm run dev`.
- **Seção "automático vs. manual"** — separação honesta do que o pipeline faz
  sozinho e do que exige ação humana (criar conta secundária, gerar PAT,
  cadastrar secrets, contratar PITR no Supabase).

## 3. Centralização de env (`src/config/env.ts`)

### Antes

`supabase.ts` lê `import.meta.env.VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY` diretamente e lança erro genérico.

### Depois

Um módulo central expõe um objeto `env` tipado e validado:

```ts
// src/config/env.ts
function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Variável de ambiente ausente: ${name}. Verifique seu arquivo .env ` +
        `(use .env.example como referência).`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
  // opcionais (não lançam): apenas expostos
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
  metaPixelId: import.meta.env.VITE_META_PIXEL_ID ?? '',
} as const;
```

`supabase.ts` passa a importar `env` e usar `env.supabaseUrl` /
`env.supabaseAnonKey`. Comportamento idêntico ao atual (lança cedo se faltar),
apenas centralizado e com mensagem em pt-BR.

### Restrições

- Apenas variáveis `VITE_*` (públicas/expostas ao bundle). O service key
  (`VITE_SUPABASE_SERVICE_KEY`) **não** entra no módulo do frontend — só é usado
  em scripts/migrations server-side.
- Não muda o comportamento observável: se as duas obrigatórias existem, tudo
  funciona como antes.

## Impactos

- Arquivos novos: `mirror.yml`, `DISASTER_RECOVERY.md`, `src/config/env.ts`.
- Arquivo alterado: `src/services/supabase.ts` (troca leitura direta por `env`).
- Runtime: sem mudança observável. Sem mudança de banco.

## Estratégia de rollback

- Mirror: deletar `mirror.yml` (não afeta nada além do espelhamento).
- env central: reverter `supabase.ts` para leitura direta e remover
  `src/config/env.ts`. Sem efeito colateral.

## Estratégia de testes

- `npx tsc --noEmit` — garante tipagem do novo módulo.
- `npx vite build` — garante que o bundle compila com o env centralizado.
- `npx vitest run` — garante não-regressão da suíte existente.
- Validação manual do YAML do workflow (sintaxe).
