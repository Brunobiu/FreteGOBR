# Implementation Plan

> Feature 2 — Aceite Obrigatório dos Termos (FreteGO)

## Overview

Plano incremental para o aceite obrigatório no cadastro. Depende da Feature 1 (`currentLegalVersion()`, rotas legais). Inclui migration (colunas em `users`), validação cliente (Zod) e servidor, e persistência do registro de aceite.

## Task Dependency Graph

```
1 (migration colunas users)
   └─> 4 (signup grava aceite)
2 (checkbox + Zod no RegisterForm) ─> 3 (payload acceptedVersion)
3 ─> 4
4 ─> 5 (testes + validação)
```

```json
{
  "waves": [
    { "wave": 1, "tasks": [1, 2], "description": "Migration e UI do checkbox (independentes)." },
    { "wave": 2, "tasks": [3], "description": "Payload com acceptedVersion (depende do checkbox)." },
    { "wave": 3, "tasks": [4], "description": "Signup grava aceite (depende de migration + payload)." },
    { "wave": 4, "tasks": [5], "description": "Testes e validação final." }
  ]
}
```

## Tasks

- [ ] 1. Migration: colunas de aceite em `users`
  - Criar migration idempotente adicionando `terms_accepted_at timestamptz` e `terms_version text` em `public.users` (ambas nullable, com COMMENT). Criar par `_rollback.sql` documentado.
  - Usar a próxima numeração livre do repositório (verificar maior número atual em `supabase/migrations/`).
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 2. Adicionar checkbox de aceite ao RegisterForm
  - Em `src/components/RegisterForm.tsx`: campo `acceptTerms: z.boolean().refine(v===true, 'Você precisa aceitar os Termos de Uso e a Política de Privacidade.')`.
  - UI: checkbox + label com links para `/termos` e `/privacidade` (`target="_blank" rel="noopener"`); botão "Criar conta" desabilitado enquanto desmarcado; checkbox inicia desmarcado.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.1_

- [ ] 3. Enviar acceptedVersion no payload de cadastro
  - Estender `RegisterData` com `acceptedVersion: string`; no submit, preencher com `currentLegalVersion()` (Feature 1).
  - _Requirements: 2.2, 4.4_

- [ ] 4. Persistir o registro de aceite no signup
  - No fluxo de signup (RPC `register_with_terms` SECURITY DEFINER, ou insert + default/trigger): revalidar `acceptedVersion` não-vazio (erro `TERMS_NOT_ACCEPTED` se ausente); gravar `terms_accepted_at = now()` (servidor) e `terms_version = acceptedVersion` na mesma operação que cria a conta.
  - Garantir que falha ao gravar aceite falha o cadastro (sem conta órfã).
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.2, 4.3_

- [ ] 5. Testes e validação final
  - Zod: rejeita `acceptTerms=false`/ausente com mensagem pt-BR; aceita `true`.
  - Payload: `acceptedVersion === currentLegalVersion()`.
  - Property (servidor): sem `acceptedVersion` não-vazio ⇒ nenhuma conta criada (Property 1); toda conta nova tem aceite completo (Property 2).
  - Rodar `npx tsc --noEmit`, `npm run test:run`, `npm run build`; confirmar verde.
  - _Requirements: 1.5, 2.1, 2.2, 2.3, 4.3, 4.4_

## Notes

- Timestamp do aceite SEMPRE definido pelo servidor (`now()`), nunca pelo cliente (Requirement 2.5).
- Contas legadas ficam com `terms_accepted_at`/`terms_version` nulos; login não pode quebrar (Requirement 3.3).
- Histórico de re-aceite (nova versão) fica para evolução futura (tabela `terms_acceptances`); esta feature cobre o aceite no cadastro.
