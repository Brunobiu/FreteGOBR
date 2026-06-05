# Governança de Testes — FreteGO

Documento de referência permanente. Define o padrão obrigatório de entrega
para TODA feature nova. Derivado da spec `testes`
(`.kiro/specs/testes/{requirements,design,tasks}.md`).

Regra-mãe: **nenhuma feature é considerada concluída sem testes completos.**
Isso vale independentemente da configuração de governança do projeto.

## Padrão obrigatório por feature (checklist de PR)

Toda feature nova DEVE conter, antes de ser marcada como concluída:

- [ ] `requirements.md` — requisitos em EARS, critérios de aceite testáveis
- [ ] `design.md` — arquitetura + Correctness Properties quando aplicável
- [ ] `tasks.md` — plano incremental com dependências
- [ ] Testes automatizados (unit + property quando houver invariante)
- [ ] Cenários de falha (caminhos negativos, erros, limites)
- [ ] Validações (frontend E backend)
- [ ] Regression_Suite atualizada (novos testes incorporados)
- [ ] Documentação técnica atualizada

Se algum item faltar, a feature **não** está pronta.

## Onde colocar cada teste

- **Código puro** (utils, helpers, regras de negócio, parsers, hooks):
  `src/__tests__/` — roda no pre-commit e no CI. Convenção
  `cp<N>_<nome>.property.test.ts` para property-based.
- **Integração com Supabase / E2E / performance**: `tests/` — roda só no CI
  (não atrasa o commit). Usa branch Supabase efêmero.

## Helpers canônicos (sempre reusar, nunca reimplementar)

Em `src/__tests__/_helpers/`:

- `generators.ts` — geradores fast-check (PII via `fc.constantFrom`,
  `safeText` via `fc.string().filter`; NUNCA `fc.stringOf`).
- `authAssertions.ts` — `expectPermissionDenied` (precedência sobre
  qualquer erro de validação simultâneo).
- `antiEnumeration.ts` — `CANONICAL_MESSAGES` + `expectAntiEnumeration`.
- `logAssertions.ts` — `expectNoSecrets`, `expectStructuredLog`.

## Decisões oficiais que os testes DEVEM respeitar

Estas decisões são comportamento oficial do sistema — testes que as
contrariam estão errados, não o sistema.

### Autorização
- Falta de permissão em ação protegida ⇒ SEMPRE `permission_denied`,
  mesmo com erros de validação simultâneos (precedência).
- APIs impedem qualquer acesso cruzado entre usuários (RLS).
- Nunca expor dados sensíveis em respostas, logs ou traces.

### Auditoria e observabilidade
- Verificação de auditoria só passa quando o registro está PERSISTIDO
  em `admin_audit_logs` (a execução do processo não basta).
- Falha de audit logging NÃO bloqueia a mutação administrativa.
- Logs estruturados são contínuos (não dependem de evento específico).

### Validação de inputs
- Todo input valida tipo, formato, regra de negócio, sanitização,
  consistência — no frontend E no backend.
- Sanitização ocorre apenas quando caracteres perigosos são detectados.
- Formulário inválido: o teste só passa se o envio for bloqueado E
  uma mensagem de erro em pt-BR for exibida (ambos).

### Uploads
- MIME inválido ⇒ falha com `INVALID_FILE_TYPE`.
- Arquivo malicioso é rejeitado SOMENTE após upload concluído.
- Falha antes da conclusão (rede/limite/timeout) não exige validação extra.

### Background jobs
- Validar `JOB_FAILED` mesmo sem falha real do job (lógica de erro
  independente do cenário). Apenas o error code é suficiente.

### Anti-enumeração
- Falha por dado duplicado ⇒ mensagem canônica anti-enumeração; dados
  parciais podem existir temporariamente antes do cleanup.

### Webhooks
- Idempotência completa; não é necessário rastrear entregas duplicadas.

### Recuperação de rede
- Opções de recuperação aparecem SOMENTE quando há operação ativa em
  andamento.

### Performance e resiliência
- Degradação controlada mesmo com múltiplos serviços externos fora
  simultaneamente. Falha total não é aceitável.

### Pipeline e regressão
- Qualquer falha de teste bloqueia merge e deploy — inclui flaky que só
  passou após retry.
- Problemas de infraestrutura da pipeline NÃO bloqueiam merge
  automaticamente.
- Mudança de schema compatível não falha contrato; só incompatível falha.
- O mecanismo padrão de bloqueio de deploy é confiável (sem fail-safe extra).

## Convenções fast-check do projeto

- `vi.mock` é hoisted: não referenciar variáveis externas no factory; expor
  spies via `(globalThis as Record<string, unknown>).__nomeDoSpy = ...`.
- `fc.stringOf` NÃO existe — usar `fc.string({ minLength, maxLength }).filter(...)`.
- Geradores de phone/CPF/CNPJ/email: `fc.constantFrom([...templates fixos válidos])`.

## Critical_Modules e cobertura mínima

Definidos em `tests/coverage.config.ts`; verificados por
`scripts/check-coverage.ts` no CI. Abaixo do threshold ⇒ build falha.
Ao tocar um Critical_Module, garanta que a cobertura permanece no mínimo.
