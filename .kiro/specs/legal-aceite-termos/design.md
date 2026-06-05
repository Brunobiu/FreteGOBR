# Design Document

> Feature 2 — Aceite Obrigatório dos Termos (FreteGO)

## Overview

Adiciona um checkbox obrigatório ao `RegisterForm`, valida o aceite no cliente (Zod) e no servidor, e persiste `terms_accepted_at` + `terms_version` na tabela `users`. O timestamp é definido pelo servidor (não pelo cliente) para ser fonte confiável. Reusa `currentLegalVersion()` da Feature 1 como versão aceita.

A criação de conta hoje passa por um fluxo de signup. O design garante a invariante: **nenhuma conta existe sem registro de aceite** — o aceite é gravado no mesmo caminho que cria o usuário.

## Architecture

```
RegisterForm (Zod + RHF)
  └─ campo acceptTerms: boolean  (refine: deve ser true)
  └─ ao submeter: envia acceptedVersion = currentLegalVersion()
        │
        ▼
Signup_Mutation (services/auth signup)
  └─ valida acceptedVersion não-vazio  (revalidação servidor)
  └─ cria user + grava terms_accepted_at=now() (servidor), terms_version=acceptedVersion
        │
        ▼
DB: public.users + colunas terms_accepted_at (timestamptz), terms_version (text)
```

Duas opções de "servidor define o timestamp":
- **A (preferida):** uma RPC `register_with_terms` SECURITY DEFINER que insere o usuário e seta `terms_accepted_at = now()`. Garante atomicidade e tempo confiável.
- **B (fallback):** se o signup usa Supabase Auth + insert client-side, gravar `terms_accepted_at` via `DEFAULT now()` na coluna quando `terms_version` é fornecido, com trigger que exige `terms_version` não-nulo em novas linhas.

O design adota **A** quando o projeto já tem fluxo de signup via RPC; caso o signup seja via `supabase.auth` + insert direto, adota **B** (coluna `terms_accepted_at` com default `now()` + `terms_version` obrigatório por trigger em INSERT de contas novas).

## Components and Interfaces

### RegisterForm (cliente)

```ts
// Zod schema — adiciona:
acceptTerms: z.boolean().refine((v) => v === true, {
  message: 'Você precisa aceitar os Termos de Uso e a Política de Privacidade.',
})

// UI: checkbox + label com links
// <input type="checkbox" {...register('acceptTerms')} />
// <span>Li e aceito os <a href="/termos" target="_blank">Termos de Uso</a> e a
//   <a href="/privacidade" target="_blank">Política de Privacidade</a></span>
// Botão "Criar conta" disabled enquanto !acceptTerms (Requirement 1.4).
```

Os links abrem em nova aba (`target="_blank" rel="noopener"`) para não perder os dados do formulário (Requirement 1.3).

### Signup payload

```ts
interface RegisterData {
  // ...campos existentes (phone, password, name, userType, companyName)
  acceptedVersion: string; // currentLegalVersion() no momento do submit
}
```

### Signup_Mutation (servidor)

```
- valida acceptedVersion: string não-vazia, senão erro TERMS_NOT_ACCEPTED.
- cria a conta e grava:
    terms_accepted_at = now()        -- servidor (Requirement 2.5)
    terms_version     = acceptedVersion
- tudo no mesmo fluxo (Requirement 2.3): falha ao gravar aceite => falha o cadastro.
```

## Data Models

### Colunas novas em `public.users`

| coluna | tipo | nullable | descrição |
|---|---|---|---|
| `terms_accepted_at` | `timestamptz` | sim (legado) | instante UTC do aceite, definido pelo servidor |
| `terms_version` | `text` | sim (legado) | versão aceita (`currentLegalVersion()`) |

Contas legadas ficam com ambos nulos (Requirement 3.3) — não quebra login. Novas contas sempre preenchem ambos.

### Migration (idempotente + rollback)

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;

COMMENT ON COLUMN public.users.terms_accepted_at IS 'Instante UTC do aceite dos termos (LGPD). NULL = conta legada.';
COMMENT ON COLUMN public.users.terms_version IS 'Versao dos documentos aceita (currentLegalVersion). NULL = conta legada.';
```

Par de rollback (`_rollback.sql`) com `DROP COLUMN IF EXISTS` documentado, não auto-aplicado.

## Error Handling

| Situação | Camada | Resultado |
|---|---|---|
| Checkbox desmarcado | cliente (Zod) | erro inline pt-BR; submit bloqueado |
| `acceptedVersion` vazio na mutation | servidor | `TERMS_NOT_ACCEPTED`, conta não criada |
| Falha ao gravar aceite | servidor | cadastro falha; nenhuma conta órfã (Requirement 2.4) |

## Testing Strategy

- **Unit (Zod)**: schema rejeita `acceptTerms=false`/ausente com a mensagem pt-BR; aceita `true`.
- **Unit (payload)**: `acceptedVersion` enviado é exatamente `currentLegalVersion()`.
- **Property (servidor)**: para todo payload sem `acceptedVersion` não-vazio, a mutation rejeita e nenhuma conta é criada (sem efeito colateral).
- **Migration**: aplicar é idempotente; colunas existem; contas legadas com nulos não quebram leitura.

## Correctness Properties

### Property 1: Sem aceite, sem conta
**Validates: Requirements 1.5, 2.3, 4.3, 4.4**
Para toda submissão de cadastro em que o aceite está ausente, desmarcado ou com `acceptedVersion` vazio, nenhuma conta é criada e nenhum efeito colateral persiste.

### Property 2: Toda conta nova tem registro de aceite completo
**Validates: Requirements 2.1, 2.2, 4.4**
Para toda conta criada por esta feature, existe `terms_accepted_at` não-nulo E `terms_version` não-vazio gravados na mesma operação.

### Property 3: Timestamp definido pelo servidor
**Validates: Requirements 2.5**
O `terms_accepted_at` gravado deriva do relógio do servidor (`now()`), nunca de um valor controlado pelo cliente.

### Property 4: Versão aceita é a versão vigente
**Validates: Requirements 2.2**
O `terms_version` persistido é igual ao `currentLegalVersion()` retornado no instante do aceite (Feature 1 como fonte de verdade).

### Property 5: Registro de aceite imutável
**Validates: Requirements 2.6**
Após criado pelo cadastro, o par (terms_accepted_at, terms_version) não é alterável por fluxos do próprio usuário.

## Decisões e Trade-offs

1. **Timestamp no servidor (`now()`).** Evita falsificação de data de aceite pelo cliente — relevante para prova de consentimento LGPD.
2. **Colunas em `users` (não tabela separada).** Cada usuário tem um aceite no cadastro; coluna é mais simples que tabela 1:1. Trade-off: não guarda histórico de re-aceites — aceitável agora (re-aceite por nova versão fica para evolução futura, ex.: tabela `terms_acceptances`).
3. **`currentLegalVersion()` como string combinada.** Captura a versão de Termos e Privacidade num único campo, suficiente para auditoria.
4. **Nullable para legado.** Não força migração retroativa de 7 contas existentes; novas contas sempre preenchem.
