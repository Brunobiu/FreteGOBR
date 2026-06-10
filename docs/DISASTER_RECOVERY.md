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
- No plano **free** o Supabase não faz backup automático. Faça **dump manual
  periódico** com o script do projeto (ver §7 abaixo — passo a passo completo).
  Em uma frase:
  ```powershell
  .\scripts\backup-db.ps1
  ```
- Ao lançar com clientes reais, considere o plano **Pro (~US$ 25/mês)**, que
  liga backup diário automático + PITR no painel (Settings → Database → Backups).

**Restauração:** ver §7.4 para restaurar a partir de um `.gz` gerado pelo script.
Para recriar o projeto do zero:
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
| Backup do banco (dump) | ⚙️ Semi-auto | **Rodar `scripts/backup-db.ps1`** — ou agendar no Windows (§7.5) |
| Backup do Storage | ❌ Não | Exportar arquivos periodicamente |
| Cópia dos secrets do Vault/Edge | ❌ Não | Guardar cópia segura offline |
| Documentação de recuperação | ✅ Sim | Manter este doc atualizado |

### Ações manuais recomendadas (checklist pré-produção)

- [ ] Criar conta no GitLab/Codeberg e repo espelho.
- [ ] Gerar PAT e cadastrar `MIRROR_REPO_URL` + `MIRROR_TOKEN` nos secrets do GitHub.
- [ ] Ativar PITR/backup no Supabase (ou agendar dump periódico — ver §7.5).
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

---

## 7. Backup manual do banco — guia completo

No plano free do Supabase **não há backup automático**. Este projeto inclui
dois scripts que resolvem isso sem precisar instalar nada com permissão de
administrador e sem Docker:

- `scripts/setup-pgdump.ps1` — baixa um **pg_dump portátil** (binários oficiais
  do PostgreSQL) para `tools/pgsql/`. Roda **uma única vez**.
- `scripts/backup-db.ps1` — gera o backup completo (schema + dados) num arquivo
  `.sql` comprimido (`.gz`) dentro de `backups/`. Roda sempre que quiser.

As pastas `tools/` e `backups/` são **gitignored** — nada disso vai pro Git.

### 7.1 — Pré-requisito: a connection string (uma vez)

O script lê a string de conexão, nesta ordem:

1. Variável de ambiente `SUPABASE_DB_URL`; ou
2. Arquivo `Credencial/supabase_db_url.txt` (gitignored), com a string numa
   única linha.

Onde pegar: painel Supabase → botão **Connect** → aba **Session pooler**
(porta 5432) → copie a URL e **troque `[YOUR-PASSWORD]` pela senha real do
banco** (Settings → Database → Database password; se esqueceu, clique em
*Reset database password*).

> A senha pode conter caracteres especiais (`@`, `:`, `#`, etc). O script
> separa a senha da URL e a passa de forma segura via `PGPASSWORD`, então
> não há problema.

### 7.2 — Primeira vez (instalar o pg_dump portátil)

```powershell
.\scripts\setup-pgdump.ps1
```

Baixa ~300 MB e extrai para `tools/pgsql/`. Só precisa fazer isso uma vez
(ou se trocar de computador).

### 7.3 — Fazer um backup (sempre que quiser)

```powershell
.\scripts\backup-db.ps1
```

Gera `backups\db_backup_AAAAMMDD_HHmm.sql.gz`. Mantém automaticamente os **10
backups mais recentes** e apaga os antigos (ajustável com `-KeepLast`).

> **Importante:** a pasta `backups\` fica só no seu computador. De tempos em
> tempos, copie o `.gz` mais recente para um lugar **fora do PC**: Google Drive,
> OneDrive, Dropbox ou um HD externo. Se o computador morrer, o backup precisa
> sobreviver em outro lugar.

### 7.4 — Restaurar um backup

Para restaurar num projeto Supabase (novo ou existente):

```powershell
# 1. Descomprimir o .gz desejado
$gz = ".\backups\db_backup_AAAAMMDD_HHmm.sql.gz"
$sql = $gz -replace '\.gz$',''
$in = [IO.File]::OpenRead($gz)
$g  = New-Object IO.Compression.GzipStream($in, [IO.Compression.CompressionMode]::Decompress)
$out = [IO.File]::Create($sql)
$g.CopyTo($out); $out.Close(); $g.Close(); $in.Close()

# 2. Restaurar com o psql portátil (mesma pasta do pg_dump), usando a
#    connection string do banco DESTINO:
$env:PGPASSWORD = "<senha-do-banco-destino>"
$env:PGSSLMODE  = "require"
.\tools\pgsql\bin\psql.exe --host=<host> --port=5432 --username=<usuario> --dbname=postgres --file=$sql
Remove-Item Env:\PGPASSWORD
```

> Restaurar **sobrescreve** dados. Faça em projeto de teste antes de mexer em
> produção. O dump usa `--no-owner --no-privileges`, então é portável entre
> projetos Supabase diferentes.

### 7.5 — Como NÃO esquecer de rodar

Backup manual só protege se for feito com regularidade. Opções, da mais
confiável para a menos:

**Opção A — Agendar automático no Windows (recomendado).** O Windows roda o
script sozinho, sem você lembrar. Crie a tarefa (uma vez, num PowerShell comum):

```powershell
$projeto = "c:\Users\bruno\BRUNO\Meus Projetos\FreteGO\FreteGO"
$acao = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$projeto\scripts\backup-db.ps1`"" `
  -WorkingDirectory $projeto
# Toda segunda-feira às 10h:
$gatilho = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 10:00
Register-ScheduledTask -TaskName "FreteGO Backup Semanal" -Action $acao -Trigger $gatilho `
  -Description "Backup semanal do banco Supabase do FreteGO"
```

Depois é só conferir a pasta `backups\` de vez em quando. Para remover a
tarefa: `Unregister-ScheduledTask -TaskName "FreteGO Backup Semanal"`.

**Opção B — Lembrete manual.** Coloque um lembrete recorrente no celular
(ex: toda segunda) com o texto: *"Rodar `.\scripts\backup-db.ps1` no FreteGO e
subir o .gz pro Drive"*.

**Opção C — Antes de mudanças grandes.** Independente do agendamento, rode um
backup manual **sempre antes** de aplicar uma migration grande, mexer em dados
em massa ou fazer qualquer operação arriscada no banco.

> Frequência sugerida enquanto está em plano free: **semanal** + **antes de
> mudanças grandes**. Ao ter clientes reais e movimento diário de dados, migre
> para o plano Pro (backup diário automático) — backup manual semanal não
> basta quando há dados novos importantes todo dia.
