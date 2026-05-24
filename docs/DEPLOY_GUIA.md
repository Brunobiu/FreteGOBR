# Guia de Deploy — Como subir o FreteGO no ar

> Anotação criada a pedido do Bruno em 2026-05-24. Este documento
> explica do zero como publicar o FreteGO em produção, conectar o
> domínio próprio, e como o fluxo de "alterar código → subir nova
> versão" funciona daqui pra frente.

---

## 1. Visão geral — as 3 peças do projeto

O FreteGO tem três componentes que precisam estar publicados pra
funcionar em produção:

| Peça                 | O que é                                              | Onde mora hoje                | Onde vai morar em produção         |
| -------------------- | ---------------------------------------------------- | ----------------------------- | ---------------------------------- |
| **Código fonte**     | Tudo que está em `src/`, configs, etc.               | Seu PC + GitHub               | GitHub (sempre)                    |
| **Frontend (app)**   | O que o navegador baixa: HTML, JS, CSS               | `npm run dev` no seu PC       | Vercel ou Netlify (gratuito)       |
| **Backend / Banco**  | Supabase (banco PostgreSQL, autenticação, storage)   | Já está em produção           | Já está em produção (não muda)     |
| **Domínio**          | `seudominio.com.br`                                  | Comprado no registrador       | Apontado para a Vercel/Netlify     |

A boa notícia é que **o backend já está no ar** desde sempre — o
Supabase que você usa já é o de produção. Só precisamos publicar o
frontend e apontar o domínio.

---

## 2. Onde o código vive (GitHub)

O fluxo é assim:

```
[seu PC] ──git push──▶ [GitHub] ──auto-deploy──▶ [Vercel/Netlify] ──serve▶ [internet]
```

- **GitHub**: é o "caderno mestre" do código. A cada `git push`,
  uma nova versão é gravada lá.
- **Vercel/Netlify**: ferramenta de deploy. Conectada ao GitHub,
  ela detecta quando você dá `git push` e **publica
  automaticamente** a nova versão em alguns minutos.
- O código NÃO precisa ser enviado manualmente pra hospedagem.
  É só commitar e dar push, o resto é automático.

> Você já tem o GitHub funcionando — toda vez que rodamos
> `git push origin main` o código vai pra lá.

---

## 3. Por que Vercel ou Netlify (e não cPanel/HostGator)?

Hospedagens tradicionais (HostGator, Locaweb, cPanel) servem
arquivos estáticos ou PHP. O FreteGO é uma **SPA React + Vite**,
que precisa de:

- Build automático (`npm run build`)
- HTTPS sempre (geolocation, service workers)
- CDN global (rapidez)
- Redirect de qualquer rota pra `index.html` (SPA routing)

A **Vercel** e a **Netlify** fazem tudo isso automaticamente, no
**plano gratuito** de pequenos projetos:

|                          | Vercel             | Netlify            |
| ------------------------ | ------------------ | ------------------ |
| Plano gratuito           | Sim                | Sim                |
| HTTPS automático         | Sim                | Sim                |
| Build automático         | Sim                | Sim                |
| Domínio próprio          | Sim                | Sim                |
| Limite gratuito          | 100 GB/mês banda   | 100 GB/mês banda   |
| Recomendado para Vite    | ⭐ excelente       | ⭐ excelente       |

Vou recomendar a **Vercel** por ser um pouco mais simples com
Vite/React, mas as duas resolvem.

---

## 4. Passo a passo — Deploy na Vercel (primeira vez)

### 4.1 Criar conta

1. Acesse https://vercel.com
2. Clique em **Sign Up**.
3. Escolha **Continue with GitHub** (assim ela já fica conectada
   ao seu repositório).
4. Autorize a Vercel a ler seus repositórios.

### 4.2 Importar o projeto

1. No dashboard da Vercel, clique em **Add New → Project**.
2. Escolha o repositório `Brunobiu/FreteGOBR` (ou o nome do seu).
3. A Vercel detecta sozinha que é Vite e preenche tudo:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
4. **Environment Variables** — clique em adicionar cada uma das
   variáveis do seu `.env`:

   ```
   VITE_SUPABASE_URL = https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJhbGciOi...
   ```

   (Pega os valores no seu `.env` local. **Não precisa subir o
   `.env` pro GitHub** — ele já está no `.gitignore`.)

5. Clique em **Deploy**.
6. Em ~2-3 minutos, a Vercel te dá uma URL tipo
   `fretego-bruno.vercel.app` — **já funcionando, com HTTPS**.

### 4.3 Apontar seu domínio próprio

1. No projeto da Vercel, vá em **Settings → Domains**.
2. Digite seu domínio (ex: `fretego.com.br`).
3. A Vercel mostra os registros DNS que você precisa adicionar no
   painel do registrador onde comprou o domínio. Normalmente:

   ```
   Tipo: A      Nome: @     Valor: 76.76.21.21
   Tipo: CNAME  Nome: www   Valor: cname.vercel-dns.com
   ```

4. Vai no painel do seu registrador (Registro.br, GoDaddy, etc),
   adiciona esses registros.
5. A propagação leva de **alguns minutos a 24h** (geralmente <1h).
6. A Vercel detecta automaticamente e ativa **HTTPS** no seu
   domínio (certificado Let's Encrypt grátis e renovação
   automática).

Pronto. `https://fretego.com.br` vai estar no ar.

---

## 5. Configurações importantes do Supabase pra produção

O banco já está no ar, mas precisa garantir alguns pontos:

### 5.1 Adicionar o domínio em "Site URL" e "Redirect URLs"

No painel do Supabase:

1. **Authentication → URL Configuration**
2. **Site URL**: `https://fretego.com.br` (o domínio que você
   apontou)
3. **Additional Redirect URLs**: cole aqui também as URLs da
   Vercel (`https://fretego-bruno.vercel.app` e qualquer preview
   `https://fretego-bruno-*.vercel.app`).

Sem isso, login com Magic Link e recuperação de senha não
funcionam fora do localhost.

### 5.2 Conferir as variáveis de ambiente da Vercel

Confirma que `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
batem **exatamente** com os valores em **Project Settings → API**
no Supabase.

### 5.3 Migrações pendentes

Antes de cada deploy, **rode no SQL Editor do Supabase** qualquer
migration nova que esteja em `supabase/migrations/` e ainda não
foi aplicada. Hoje a última é a `019_add_frete_origin_destination_detail.sql`.

### 5.4 Backups

O Supabase faz backup diário automático no plano gratuito (mantém
7 dias). Em planos pagos sobe para 30 dias e backup point-in-time.

---

## 6. Fluxo de trabalho dia a dia (depois de tudo no ar)

Esse é o ciclo que você vai repetir cada vez que mudar algo:

```
1. Mexer no código no seu PC (com Cursor/Kiro/VSCode)
   ↓
2. Testar localmente (npm run dev → http://localhost:5173)
   ↓
3. Quando estiver bom, commitar e dar push:
   git add .
   git commit -m "feat: ajuste no botão X"
   git push origin main
   ↓
4. Vercel detecta o push e faz build automático (~2 min)
   ↓
5. Nova versão fica no ar em https://fretego.com.br
   ↓
6. Se mudou algo no banco, rodar a migration nova no
   Supabase Studio (SQL Editor)
```

**Atalho útil**: a Vercel cria um "Preview Deployment" pra cada
branch que não é a `main`. Se você criar uma branch `git checkout
-b experimento`, der push, vai sair uma URL única tipo
`fretego-bruno-experimento.vercel.app` pra testar antes de
mergear na produção.

---

## 7. Custos esperados

Pra um projeto recém-lançado com pouco tráfego:

| Item                       | Custo mensal estimado          |
| -------------------------- | ------------------------------ |
| Vercel (Hobby)             | **R$ 0** (até 100GB banda/mês) |
| Supabase (Free)            | **R$ 0** (até 500MB banco, 50k MAU) |
| Domínio `.com.br`          | ~R$ 40/ano                     |
| Domínio `.com`             | ~US$ 12/ano (~R$ 60)           |

Quando o projeto crescer:

- **Vercel Pro**: US$ 20/mês — mais banda, mais builds, analytics
- **Supabase Pro**: US$ 25/mês — backup point-in-time, 8GB
  banco, sem pausa por inatividade

---

## 8. Riscos e cuidados

### Nunca commitar segredos

Já está protegido pelo `.gitignore`, mas confirme antes de cada
push: o arquivo `.env` **NUNCA** vai pro GitHub. As variáveis
sensíveis ficam apenas em:

- `.env` local (no seu PC)
- **Project Settings → Environment Variables** na Vercel

### Banco compartilhado com dev

Hoje seu Supabase é único — `npm run dev` no localhost e
`fretego.com.br` em produção falam com o **mesmo banco**. Isso é
OK pra começar, mas tem dois cuidados:

1. **Não rode migrations destrutivas** (DROP, TRUNCATE) sem ter
   certeza absoluta.
2. Em algum momento (quando o app crescer), criar um **segundo
   projeto Supabase só pra desenvolvimento** e ter dois `.env`:
   um pro localhost (`.env.development`) e outro pra produção
   (variáveis na Vercel).

### Mobile app no futuro

Quando virar app iOS/Android (React Native ou Capacitor), o
mesmo Supabase atende sem mudança. Só o frontend muda — o
"backend" continua o mesmo banco.

---

## 9. Resumo curto

1. **Código**: GitHub (já funciona).
2. **Frontend**: Vercel (gratuito, conecta ao GitHub, deploy
   automático).
3. **Backend**: Supabase (já no ar).
4. **Domínio**: aponta DNS pro Vercel.
5. **Mudou código?** `git push` → Vercel publica em 2 min.
6. **Mudou banco?** rodar a migration nova no Supabase Studio.

Quando você quiser, eu te ajudo a fazer o primeiro deploy passo a
passo — basta avisar. ✅
