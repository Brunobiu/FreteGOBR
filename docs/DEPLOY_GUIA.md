# Guia de Deploy — Como subir o FreteGO no ar

> Anotação criada a pedido do Bruno em 2026-05-24.
> Atualizado em 2026-05-25 com o estado atual: integração Supabase↔GitHub
> ativa, conta Vercel criada e conectada ao repositório.

---

## 1. Visão geral — as 3 peças do projeto

O FreteGO tem três componentes que precisam estar publicados pra
funcionar em produção:

| Peça                 | O que é                                              | Onde mora hoje                | Onde vai morar em produção         |
| -------------------- | ---------------------------------------------------- | ----------------------------- | ---------------------------------- |
| **Código fonte**     | Tudo que está em `src/`, configs, etc.               | Seu PC + GitHub               | GitHub (sempre)                    |
| **Frontend (app)**   | O que o navegador baixa: HTML, JS, CSS               | `npm run dev` no seu PC       | Vercel (já conectada ao repo)      |
| **Backend / Banco**  | Supabase (Postgres, autenticação, storage, realtime) | Já está em produção           | Já está em produção (não muda)     |
| **Domínio**          | `seudominio.com.br`                                  | Comprado no registrador       | Apontado para a Vercel             |

A boa notícia é que o **backend já está no ar** desde sempre — o
Supabase que você usa já é o de produção. Só precisamos terminar
de configurar a Vercel e (quando quiser) apontar o domínio.

---

## 2. Onde o código vive (GitHub)

```
[seu PC] ──git push──▶ [GitHub] ──auto-deploy──▶ [Vercel] ──serve▶ [internet]
                              └──auto-migrate──▶ [Supabase]
```

- **GitHub**: caderno mestre do código. Cada `git push` grava nova versão.
- **Vercel**: detecta push em `main` e publica nova versão do frontend em ~2 min.
- **Supabase**: detecta push em `main` e aplica migrations novas de `supabase/migrations/` automaticamente.

Você não precisa subir código manualmente em lugar nenhum: é só `git push`
e os dois serviços (frontend + banco) atualizam sozinhos.

---

## 3. Estado atual (o que já está pronto)

| Etapa                                                    | Status |
| -------------------------------------------------------- | :----: |
| Repositório `Brunobiu/FreteGOBR` no GitHub               |   ✅   |
| Supabase em produção (project `kvdwmgchtpdnllxwswtf`)    |   ✅   |
| Integração **Supabase ↔ GitHub** (migrations auto)       |   ✅   |
| Conta Vercel criada e conectada ao GitHub                |   ✅   |
| Projeto Vercel apontando pro repo                        |   ✅   |
| Variáveis de ambiente na Vercel                          | ⏳ falta |
| URLs do Supabase Auth (Site URL + Redirect)              | ⏳ falta |
| Primeiro deploy de produção bem-sucedido                 | ⏳ falta |
| Domínio próprio                                          | ⏳ depois |

---

## 4. O que falta fazer (checklist)

### 4.1 Configurar variáveis de ambiente na Vercel

Sem isso o frontend sobe mas não consegue falar com o Supabase
(vai dar tela em branco ou erro de auth).

1. Vá na Vercel → projeto FreteGO → **Settings → Environment Variables**.
2. Adicione **2 variáveis** (todos os 3 ambientes: Production, Preview, Development):

   - `VITE_SUPABASE_URL` = `https://kvdwmgchtpdnllxwswtf.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = pega no painel do Supabase em **Settings → API → Project API keys → anon public**

3. Salva. Não precisa reiniciar nada — vai pegar no próximo build.

> **Importante**: a chave **anon** é pública e pode ficar no frontend.
> NUNCA coloque a `service_role` em variável `VITE_*` — essa é só pra
> backend e dá acesso total ao banco.

### 4.2 Configurar URLs no Supabase Auth

Sem isso, login com magic link e reset de senha quebram em produção.

1. Supabase → **Authentication → URL Configuration**.
2. **Site URL**: cole a URL que a Vercel te deu (algo tipo
   `https://fretego-bruno.vercel.app`). Quando comprar o domínio próprio,
   troque pra ele.
3. **Additional Redirect URLs**: adicione, uma por linha:
   ```
   https://fretego-bruno.vercel.app/**
   https://*.vercel.app/**
   http://localhost:5173/**
   ```
   O `**` é importante — significa "qualquer rota dentro desse domínio".
4. Salva.

### 4.3 Disparar o primeiro deploy

Se ainda não rodou:

- Na Vercel, no painel do projeto, clica em **Deployments → Redeploy** no
  deploy mais recente (a Vercel já criou um quando você conectou o repo,
  mas talvez tenha falhado por causa das variáveis ausentes).
- Ou faz qualquer commit pequeno e `git push origin main` que dispara
  novo build com as variáveis já configuradas.

Acompanha o log. Se der erro de build, manda print que eu ajudo a
diagnosticar.

### 4.4 Testar em produção

Quando o deploy ficar verde:

1. Abre a URL `*.vercel.app` no navegador.
2. Tenta criar uma conta nova de motorista ou embarcador.
3. Tenta logar com o admin (Bruno Henrique / `Nexus_Vortex99`) em
   `https://*.vercel.app/admin/login`.
4. Confirma que a tela admin carrega usuários, fretes, etc.

Se algo quebrar, geralmente é uma das 3 coisas:
- variável de ambiente faltando ou errada → seção 4.1
- URL não cadastrada no Auth → seção 4.2
- migration nova não aplicada (raro com a integração ativa) → ver seção 5.3

### 4.5 Apontar domínio próprio (depois)

1. Compra o domínio onde quiser (Registro.br, GoDaddy, Hostinger, etc).
2. Vercel → projeto → **Settings → Domains**.
3. Digita o domínio (ex: `fretego.com.br`).
4. Vercel mostra os registros DNS pra adicionar no painel do registrador:

   ```
   Tipo: A      Nome: @     Valor: 76.76.21.21
   Tipo: CNAME  Nome: www   Valor: cname.vercel-dns.com
   ```

5. Adiciona no painel do registrador. Propagação leva de minutos a 24h.
6. A Vercel ativa **HTTPS automático** (Let's Encrypt grátis, renovação automática).
7. **Volta no Supabase Auth** (seção 4.2) e troca o `Site URL` pro
   domínio definitivo.

---

## 5. Configurações importantes do Supabase

### 5.1 URL Configuration

Cobertas na seção 4.2 acima.

### 5.2 Variáveis de ambiente

Cobertas na seção 4.1.

### 5.3 Migrations — fluxo automático com a integração

**A integração Supabase ↔ GitHub está ativa**. Toda vez que você fizer
`git push origin main` com um arquivo novo em `supabase/migrations/`,
o Supabase aplica sozinho.

Migrations já aplicadas no banco (manualmente, antes da integração):

- 001 a 029 (schema base do FreteGO + chat + likes + realtime)
- 030 admin-foundation
- 031 admin-users
- 032 admin-fretes
- 033 embarcador-branch
- 034 admin-notify-user

A próxima vai ser **035_admin_blacklist.sql** quando a spec for executada.
Essa já vai ser aplicada automaticamente pela integração ao subir pra `main`.

> **Importante**: as migrations antigas NÃO vão ser re-rodadas pela
> integração — ela só aplica arquivos novos a partir do momento em que
> foi ativada. Como nossas migrations são todas idempotentes (`CREATE ...
> IF NOT EXISTS`, `DROP POLICY IF EXISTS`), mesmo se rodassem de novo
> não causariam problema.

### 5.4 Backups

O Supabase faz backup diário automático no plano Free (mantém 7 dias).
No Pro sobe pra 30 dias com point-in-time.

---

## 6. Fluxo de trabalho dia a dia

```
1. Mexer no código (Cursor/Kiro/VSCode)
   ↓
2. Testar localmente (npm run dev → http://localhost:5173)
   ↓
3. Commitar e dar push:
   git add .
   git commit -m "feat: ajuste no botão X"
   git push origin main
   ↓
4. Vercel detecta o push e faz build (~2 min)
   ↓
5. Supabase aplica migrations novas se houver
   ↓
6. Nova versão fica no ar
```

**Branches de teste** (opcional): cada branch que não é a `main` ganha
um "Preview Deployment" próprio na Vercel. Útil pra testar mudanças
grandes sem mexer em produção.

---

## 7. Custos esperados

Pra um projeto recém-lançado:

| Item                       | Custo mensal estimado          |
| -------------------------- | ------------------------------ |
| Vercel (Hobby)             | **R$ 0** (até 100GB banda/mês) |
| Supabase (Free)            | **R$ 0** (até 500MB banco, 50k MAU) |
| Domínio `.com.br`          | ~R$ 40/ano                     |
| Domínio `.com`             | ~US$ 12/ano (~R$ 60)           |

Quando o projeto crescer:

- **Vercel Pro**: US$ 20/mês
- **Supabase Pro**: US$ 25/mês — backup point-in-time, 8GB banco, sem pausa por inatividade

---

## 8. Riscos e cuidados

### Nunca commitar segredos

`.env` está no `.gitignore` e o conteúdo dele NUNCA vai pro GitHub.
As variáveis ficam apenas em:

- `.env` local (PC do Bruno)
- Vercel → Settings → Environment Variables (produção)
- Supabase Studio (mostradas em Settings → API)

A pasta `Credencial/` também está no `.gitignore` — fica fora do repo.

### Banco compartilhado com dev

Hoje seu Supabase é único: localhost e produção falam com o **mesmo
banco**. OK pra começar, mas:

1. Não rode migrations destrutivas (DROP, TRUNCATE) sem certeza.
2. Quando o app tiver usuários reais, criar **um segundo projeto
   Supabase pra dev** e ter dois `.env`: localhost vs produção.

### Mobile app no futuro

Quando virar app iOS/Android (React Native ou Capacitor), o mesmo
Supabase atende sem mudança. Só o frontend muda — o "backend" continua
o mesmo banco.

---

## 9. Resumo curto

1. **Código**: GitHub (✅ ok).
2. **Backend**: Supabase em produção (✅ ok, com migrations auto via push).
3. **Frontend**: Vercel conectada ao repo (✅), faltam as 2 variáveis de ambiente.
4. **Auth URLs**: configurar Site URL e Redirect no Supabase Auth.
5. **Primeiro deploy**: redeploy ou push novo dispara o build em produção.
6. **Domínio próprio**: depois, apontando DNS pra Vercel.
7. **Mudou código?** `git push` → publica em 2 min.
8. **Mudou banco?** add migration em `supabase/migrations/` → push → aplica sozinho.
