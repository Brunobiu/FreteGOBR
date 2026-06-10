# Plano de Implementação — Disaster Recovery

- [x] 1. Centralizar leitura de variáveis de ambiente
  - [x] 1.1 Criar `src/config/env.ts` com validação fail-fast em pt-BR para as
        obrigatórias (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) e exposição
        das opcionais. (R3.1, R3.3)
  - [x] 1.2 Refatorar `src/services/supabase.ts` para consumir `env` em vez de
        ler `import.meta.env` diretamente. Manter comportamento idêntico. (R3.3)
  - _Requisitos: R3.1, R3.3, R5.1_

- [x] 2. Workflow de mirror automático
  - [x] 2.1 Criar `.github/workflows/mirror.yml` disparado em push na `main`,
        com `fetch-depth: 0`, guard de secret ausente e `git push --mirror`
        para o remoto secundário via `MIRROR_REPO_URL` + `MIRROR_TOKEN`. (R1.1–R1.5)
  - _Requisitos: R1.1, R1.2, R1.3, R1.4, R1.5_

- [x] 3. Documento de Disaster Recovery
  - [x] 3.1 Criar `docs/DISASTER_RECOVERY.md` com inventário de dependências e
        classificação de SPOFs. (R4.1, R4.2)
  - [x] 3.2 Adicionar runbooks de recuperação: GitHub, Supabase, Vercel,
        integrações externas. (R2.1–R2.4)
  - [x] 3.3 Adicionar seção de setup local e seção "automático vs. manual"
        deixando explícitas as ações que dependem do usuário. (R3.2)
  - _Requisitos: R2.1, R2.2, R2.3, R2.4, R3.2, R4.1, R4.2_

- [x] 4. Verificação
  - [x] 4.1 Rodar `npx tsc --noEmit`, `npx vite build` e `npx vitest run`;
        garantir tudo verde. (R5.2)
  - _Requisitos: R5.1, R5.2_
