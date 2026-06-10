# Plano de Continuidade e Disaster Recovery — FreteGO

Documento operacional. Descreve como recuperar o FreteGO se uma plataforma
externa ficar indisponível, e o que precisa ser feito **manualmente** pelo
responsável (você) para que a redundância funcione.

> Resumo honesto: o repositório espelhado e a documentação são **automáticos**
> depois de configurados uma vez. A criação de contas secundárias, geração de
> tokens e contratação de backups gerenciados (PITR) **dependem de você** — não
> dá para automatizar isso por dentro do projeto.

---

## 1. Inventário de dependências externas

| Serviço | Papel | Criticidade | Impacto se cair | Mitigação |
|---|---|---|---|---|
| **Supabase** | Postgres + Auth + Storage + Edge Functions + Realtime. É o backend inteiro. | 🔴 Crítico (SPOF) | App para totalmente: sem login, dados, uploads, push. | Backup/PITR + dump periódico + runbook §4.2 |
| **GitHub** | Repositório único, CI (lint/type/test/build) e integração que aplica migrations no Supabase. | 🟠 Alto | Perde-se pipeline e histórico; deploy automático para. | **Mirror automático** (§3) + runbook §4.1 |
| **Vercel** | Build e hospedagem do frontend (SPA estática). | 🟠 Alto | Site sai do ar, mas o conteúdo é estático e re-hospedável. | Build estático portável; runbook §4.3 |
| **Asaas** | Gateway de pagamento (assinaturas) via webhook. | 🟡 Médio | Não processa novas cobranças; app segue funcionando. | Degradação controlada; reprocessar webhooks |
| **Resend** | Envio de email transacional. | 🟡 Médio | Emails (verificação, reset) não saem. | Reenfileirar; fallback de provedor |
| **Firebase FCM** | Push notifications (Android). | 🟢 Baixo | Sem push; resto funciona. | Degradação controlada |
| **Meta Pixel** | Marketing/analytics no site público. | 🟢 Baixo | Sem tracking; zero impacto funcional. | Nenhuma ação necessária |
| **Google Maps API** | Geocoding (opcional). | 🟢 Baixo | Falha de geocoding; mapas Leaflet (OSM) seguem. | Opcional por env |

**Ponto único de falha crítico:** Supabase. É a única dependência cuja queda
derruba todo o sistema. Priorize o backup gerenciado dele (ver §4.2).

---

## 2. Setup local do zero (rodar só com `.env`)

O projeto roda localmente apenas com variáveis de ambiente — nenhum segredo é
hardcoded no código (a leitura é centralizada em `src/config/env.ts`).

```bash
git clone <url-do-repo>
cd FreteGO
cp .env.example .env      # preencha os valores reais
npm ci
npm run dev               # ambiente de desenvolvimento
```

Variáveis (ver `.env.example` para detalhes):

- **Obrigatórias:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Opcionais:** `VITE_API_BASE_URL`, `VITE_GOOGLE_MAPS_API_KEY`,
  `VITE_META_PIXEL_ID`, `VITE_ADMIN_MFA_KEY`
- **Server-side apenas (nunca no frontend):** `VITE_SUPABASE_SERVICE_KEY`

Se uma variável obrigatória faltar, o app falha no boot com mensagem clara em
pt-BR apontando o nome da variável.

---

## 3. Repositório espelhado (mirror)

O workflow `.github/workflows/mirror.yml` espelha o repositório para uma
segunda plataforma Git a cada push na `main`, usando `git push --mirror`
(replica todos os branches e tags).

### O que é automático

Depois de configurado, **toda vez que você der push na main**, o GitHub Actions
copia o repositório inteiro para o remoto secundário. Sem intervenção.

### O que VOCÊ precisa fazer (uma vez)

1. Criar uma conta numa segunda plataforma Git. Recomendado: **GitLab**
   (`gitlab.com`), **Codeberg** (`codeberg.org`) ou um **Gitea** próprio.
2. Criar um repositório vazio lá (ex: `fretego`). Não inicialize com README.
3. Gerar um **Personal Access Token (PAT)** com escopo de escrita
   (`write_repository` no GitLab).
4. No GitHub do FreteGO: **Settings → Secrets and variables → Actions → New
   repository secret**, criar:
   - `MIRROR_REPO_URL` = a URL HTTPS do repo secundário
     (ex: `https://gitlab.com/seu-usuario/fretego.git`)
   - `MIRROR_TOKEN` = o PAT gerado no passo 3
5. Pronto. No próximo push (ou disparo manual em Actions → Mirror → Run
   workflow), o espelho é populado.

> Se os secrets não estiverem configurados, o workflow de Mirror **falha de
> propósito** (com mensagem explicativa) e você recebe o email de "workflow
> failed". Isso é intencional: avisa que a redundância ainda não está ativa.
> O pipeline de qualidade (`ci.yml`) é independente e segue funcionando.

---

## 4. Runbooks de recuperação por SPOF

### 4.1 — GitHub indisponível

Cenário: conta/repo suspenso, GitHub fora do ar, perda de acesso.

1. **Continuar desenvolvendo** a partir do mirror:
   ```bash
   git remote set-url origin <url-do-mirror>     # ex: https://gitlab.com/seu-usuario/fretego.git
   git remote -v                                  # confere
   git pull origin main
   # ... trabalha normalmente, commit/push para o mirror
   ```
2. **Deploy enquanto isso:** a integração GitHub↔Vercel e GitHub↔Supabase fica
   indisponível. Use deploy manual:
   - Frontend: `npm run build` e suba a pasta `dist/` (ver §4.3).
   - Migrations: aplique manualmente via Supabase CLI/SQL Editor (ver §4.2).
3. Quando o GitHub voltar (ou ao migrar definitivamente), re-aponte o `origin`
   e reconfigure as integrações no painel da Vercel e Supabase.

### 4.2 — Supabase indisponível (SPOF crítico)

Cenário: projeto Supabase corrompido, deletado ou fora do ar.

**Pré-requisito (ação manual sua, recomendada AGORA):**
- Ative **Point-in-Time Recovery (PITR)** ou backups diários no painel do
  Supabase (Settings → Database → Backups). No plano free há apenas backup
  limitado — considere um dump periódico manual:
  ```bash
  # Dump completo do schema + dados (rode periodicamente e guarde fora do Supabase)
  supabase db dump --db-url "postgresql://...":  > backup_$(date +%Y%m%d).sql
  ```

**Restauração:**
1. Criar um novo projeto Supabase (ou restaurar o existente via painel).
2. Reaplicar as migrations em ordem a partir de `supabase/migrations/`:
   - Via integração GitHub (push na main reaplica), **ou**
   - Manualmente: Supabase CLI (`supabase db push`) ou colando cada
     `NNN_*.sql` em ordem no SQL Editor.
3. Restaurar dados a partir do último dump/backup.
4. **Storage:** os buckets e arquivos não vêm nas migrations. Restaure a partir
   do backup de storage ou recrie os buckets (config está nas migrations) e
   reimporte os arquivos.
5. **Edge Functions:** redeploy a partir do código em `supabase/functions/`
   (`supabase functions deploy <nome>`).
6. **Secrets do Vault / Edge:** reconfigurar (`ASAAS_*`, `RESEND_*`, `FCM_*`,
   `EDGE_SHARED_SECRET`). Não ficam no repo — guarde uma cópia segura offline.
7. Atualizar `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` no `.env` e na
   Vercel para apontar ao novo projeto.

### 4.3 — Vercel indisponível

O frontend é uma SPA estática — re-hospedável em qualquer host de arquivos.

1. Build local:
   ```bash
   npm ci
   npm run build      # gera dist/
   ```
2. Subir `dist/` em qualquer alternativa: Netlify, Cloudflare Pages, GitHub
   Pages, S3+CloudFront, ou um servidor estático.
3. Configurar as variáveis `VITE_*` no novo host (mesmas da Vercel).
4. Apontar o domínio (`fretegobr.com.br`) para o novo host via DNS.

> Atenção: rotas SPA exigem fallback para `index.html` (rewrite). Configure o
> equivalente ao `vercel.json` no host escolhido.

### 4.4 — Integrações externas (Asaas / Resend / FCM / Meta)

Todas com degradação controlada — a queda de qualquer uma **não** derruba o app:

- **Asaas:** novas cobranças param; o app segue. Quando voltar, reprocessar os
  webhooks pendentes (idempotência já garante não-duplicação).
- **Resend:** emails transacionais param. Considere provedor alternativo
  (SendGrid/SES) trocando a config server-side. Usuários ainda usam o app.
- **FCM:** sem push; nenhuma outra função afetada.
- **Meta Pixel:** apenas marketing; zero impacto funcional. Pode ignorar.

---

## 5. Automático vs. manual — resumo honesto

| Item | Automático? | O que depende de você |
|---|---|---|
| Espelhamento do repo a cada push | ✅ Sim (após setup) | Criar conta secundária, gerar PAT, cadastrar 2 secrets |
| Reaplicar migrations no Supabase | ⚠️ Parcial | Via push GitHub↔Supabase; manual se o GitHub cair |
| Deploy do frontend | ✅ Sim (Vercel) | Manual se a Vercel cair (§4.3) |
| Backup do banco (PITR/dump) | ❌ Não | **Ativar no painel Supabase / rodar dump periódico** |
| Backup do Storage | ❌ Não | Exportar arquivos periodicamente |
| Cópia dos secrets do Vault/Edge | ❌ Não | Guardar cópia segura offline |
| Documentação de recuperação | ✅ Sim | Manter este doc atualizado |

### Ações manuais recomendadas (checklist pré-produção)

- [ ] Criar conta no GitLab/Codeberg e repo espelho.
- [ ] Gerar PAT e cadastrar `MIRROR_REPO_URL` + `MIRROR_TOKEN` nos secrets do GitHub.
- [ ] Ativar PITR/backup no Supabase (ou agendar dump periódico).
- [ ] Exportar e guardar offline: secrets do Vault/Edge e service key.
- [ ] Testar uma restauração de dump em projeto Supabase de teste (fire drill).
- [ ] Confirmar Redirect URLs do Supabase Auth para produção (ver pendência
      anotada na auditoria de segurança).

---

## 6. Pré-requisitos de software para recuperação local

- Node.js 20+
- npm
- Git
- Supabase CLI (para restauração de banco/functions): `npm i -g supabase`
