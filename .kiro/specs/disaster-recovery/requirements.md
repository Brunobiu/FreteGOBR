# Requisitos — Plano de Continuidade e Disaster Recovery

## Objetivo

Adicionar uma camada de **redundância e recuperação** ao FreteGO sem alterar a
arquitetura atual nem interromper integrações em produção. O foco é garantir que
o projeto continue recuperável e desenvolvível mesmo que uma plataforma externa
(GitHub, Vercel, Supabase) fique indisponível.

Esta spec é **aditiva**: ela não muda código de aplicação, não mexe em RLS, RPCs
ou migrations. Cria documentação, um workflow de espelhamento (mirror) e
padroniza a leitura de variáveis de ambiente.

## Problema identificado

O projeto hoje depende de **pontos únicos de falha (SPOF)** externos:

- **GitHub** — repositório único, CI, e integração que aplica migrations no
  Supabase. Se a conta/repo for suspenso ou perdido, perde-se histórico e
  pipeline.
- **Supabase** — Postgres + Auth + Storage + Edge Functions + Realtime. SPOF
  crítico: é o backend inteiro.
- **Vercel** — deploy do frontend.
- **Asaas / Resend / Firebase FCM / Meta** — integrações de pagamento, email,
  push e marketing.

Não existe hoje: cópia do repositório fora do GitHub, documento de recuperação
passo-a-passo, nem levantamento formal das dependências e SPOFs.

## Requisitos (EARS)

### R1 — Repositório espelhado (mirror)

- R1.1 — O sistema DEVE manter uma cópia espelhada do repositório Git em uma
  segunda plataforma (GitLab ou Gitea/Codeberg), independente do GitHub.
- R1.2 — QUANDO um push for feito na branch `main` do GitHub, o sistema DEVE
  espelhar automaticamente o estado do repositório para o remoto secundário.
- R1.3 — O espelhamento DEVE incluir todos os branches e tags.
- R1.4 — SE as credenciais do remoto secundário não estiverem configuradas, o
  workflow de mirror DEVE falhar de forma visível (não silenciosa) sem quebrar
  o pipeline de CI principal.
- R1.5 — O espelhamento NÃO DEVE expor segredos: a URL/token do remoto
  secundário DEVE vir de GitHub Secrets, nunca hardcoded no workflow.

### R2 — Documentação de recuperação

- R2.1 — O sistema DEVE conter um documento `docs/DISASTER_RECOVERY.md` com
  passo-a-passo de recuperação para cada SPOF.
- R2.2 — O documento DEVE descrever como continuar o desenvolvimento se o GitHub
  ficar indisponível (trocar o remote para o mirror).
- R2.3 — O documento DEVE descrever como restaurar o backend Supabase (banco,
  storage, edge functions) a partir de backups.
- R2.4 — O documento DEVE descrever como reconfigurar deploy se a Vercel ficar
  indisponível.

### R3 — Execução local apenas com variáveis de ambiente

- R3.1 — O projeto DEVE rodar localmente apenas com um `.env` válido, sem
  nenhum segredo hardcoded no código-fonte.
- R3.2 — Todas as variáveis necessárias DEVEM estar documentadas em
  `.env.example`.
- R3.3 — A leitura de variáveis de ambiente DEVE ser centralizada/validada em um
  único módulo, que falha cedo com mensagem clara se algo faltar.

### R4 — Levantamento de dependências e SPOFs

- R4.1 — O documento DR DEVE conter um inventário de todas as dependências
  externas, com o papel de cada uma e o impacto da sua indisponibilidade.
- R4.2 — Cada SPOF DEVE ter classificação de criticidade (crítico/alto/médio) e
  estratégia de mitigação.

### R5 — Não regressão

- R5.1 — Nenhuma mudança desta spec DEVE alterar comportamento em runtime da
  aplicação (sem mudança de RLS, RPC, migration ou lógica de negócio).
- R5.2 — `tsc`, `build` e a suíte de testes DEVEM continuar passando.

## Critérios de aceitação

- [ ] Workflow `.github/workflows/mirror.yml` criado e válido.
- [ ] `docs/DISASTER_RECOVERY.md` cobre todos os SPOFs com passo-a-passo.
- [ ] Inventário de dependências completo.
- [ ] Módulo central de env (`src/config/env.ts`) lendo e validando variáveis.
- [ ] `src/services/supabase.ts` consome o módulo central.
- [ ] `tsc --noEmit`, `vite build` e `vitest run` verdes.
- [ ] Documento deixa explícito o que é automático vs. o que exige ação manual
      do usuário (criar conta secundária, gerar token, configurar secret).
