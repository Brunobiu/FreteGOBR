# Implementation Plan

> Sistema de Testes Automatizados e Validações Contínuas — FreteGO

## Overview

Plano de implementação incremental do sistema de testes do FreteGO. Cada tarefa referencia requisitos, constrói sobre o que já existe (`src/__tests__/`, `vitest.config.ts`, `.github/workflows/ci.yml`, Husky + lint-staged) e foca apenas em código de teste, helpers, configs e pipeline — nenhuma muda regra de negócio do produto.

As fases seguem a pirâmide de testes do design: fundação compartilhada (Fase 0) → unitários (Fase 1) → integração (Fase 2) → segurança (Fase 3) → validação/contratos (Fase 4) → E2E (Fase 5) → performance (Fase 6) → pipeline/regressão/observabilidade (Fase 7) → governança (Fase 8).

## Task Dependency Graph

```
Fase 0 (fundação)
  1 (generators) ─┬─> 4,5,6,7,8,9  (unit/property)
  2 (assertions) ─┤
  3 (coverage)  ──┘

Fase 1 (unit) ──> Fase 2 (integração)
  10 (harness) ─┬─> 11,12,13,14,15,16,17

Fase 2 ──> Fase 3 (segurança)
  18 (rlsHarness) ─> 19, 20, 21

Fase 1 ──> Fase 4 (validação/contratos)
  22, 23 ─> 24 (contratos)

Fase 2 ──> Fase 5 (E2E)
  25 (playwright config) ─> 26, 27

Fase 2 ──> Fase 6 (performance)
  28

Tudo acima ──> Fase 7 (pipeline/regressão/observabilidade)
  29 (CI gates) ─> 30 (workflows e2e/perf)
  29 ─> 31 (relatório regressão)
  32 (observabilidade)  [depende de 10]

Fase 7 ──> Fase 8 (governança)
  33 (steering/checklist) ─> 34 (validação final)
```

Dependências-chave:
- Tarefas 4–9 dependem de 1, 2 e 3 (geradores + assertions + coverage).
- Tarefas 11–17 dependem de 10 (Supabase Test Harness).
- Tarefas 19–21 dependem de 18 (RLS Harness).
- Tarefa 24 depende de 22, 23.
- Tarefas 26–27 dependem de 25.
- Tarefa 29 depende de toda a coleção de testes existir.
- Tarefa 34 é a última (validação final de tudo).

```json
{
  "waves": [
    { "wave": 1, "tasks": [1, 2, 3], "description": "Fundação: geradores, assertions canônicas e config de cobertura (sem dependências)." },
    { "wave": 2, "tasks": [4, 5, 6, 7, 8, 9, 10, 22, 23, 25, 28], "description": "Unitários, validação, harness de integração, config E2E e performance (dependem da fundação)." },
    { "wave": 3, "tasks": [11, 12, 13, 14, 15, 16, 17, 18, 24, 26, 27], "description": "Integração, RLS harness, contratos e fluxos E2E (dependem do harness e das configs)." },
    { "wave": 4, "tasks": [19, 20, 21, 32], "description": "Segurança avançada e observabilidade (dependem de RLS harness e integração)." },
    { "wave": 5, "tasks": [29, 30, 31], "description": "Pipeline CI, workflows dedicados e relatório de regressão (dependem de toda a coleção existir)." },
    { "wave": 6, "tasks": [33, 34], "description": "Governança de specs e validação final da suíte completa." }
  ]
}
```

## Tasks

Cada tarefa é incremental, referencia requisitos e constrói sobre o que já existe.

## Fase 0 — Fundação compartilhada

- [x] 1. Criar diretório de helpers e geradores compartilhados
  - Criar `src/__tests__/_helpers/generators.ts` com `validCpf`, `validCnpj`, `validPhone`, `validEmail` (via `fc.constantFrom`), `safeText` (via `fc.string().filter`, nunca `fc.stringOf`) e `financialAmount` (inclui `NaN`/`Infinity`/extremos).
  - Adicionar teste de sanidade que exercita cada gerador (smoke).
  - _Requirements: 3.6, 1.5_

- [x] 2. Criar assertions canônicas de governança
  - Criar `src/__tests__/_helpers/authAssertions.ts` com `expectPermissionDenied(err)` (aprova só com code exato `permission_denied`).
  - Criar `src/__tests__/_helpers/antiEnumeration.ts` com `CANONICAL_MESSAGES` (AUTH/SIGNUP/CODE) e `expectAntiEnumeration`.
  - Criar `src/__tests__/_helpers/logAssertions.ts` com `expectNoSecrets(sample)` (sem hash/token/secret/stack trace).
  - Testes unitários dos próprios helpers (garantir que reprovam o caso errado).
  - _Requirements: 16.5, 7.6, 7.7, 7.8, 19.1, 19.3_

- [x] 3. Configurar coverage thresholds para Critical_Modules
  - Criar `tests/coverage.config.ts` exportando `CRITICAL_MODULES` (calculoFrete 95, permissions 95, audit 90, trialStatus 90, inputValidator 90, passwordValidation 90, verification 85).
  - Criar `scripts/check-coverage.ts` que lê `coverage-final.json` (v8) e falha se algum módulo crítico ficar abaixo do threshold.
  - Atualizar `vitest.config.ts` para incluir os critical modules no `coverage.include`.
  - _Requirements: 25.7, 25.8_

## Fase 1 — Testes unitários (Categoria A)

- [x] 4. Cobertura unitária das regras financeiras
  - Em `src/__tests__/`, garantir/estender testes de lucro líquido, lucro por hora e frete de retorno cobrindo válidos, inválidos, vazios, nulos, undefined e tipos incorretos.
  - Property test da invariante `lucro_liquido = receita - custos_totais` (Property 1) usando `financialAmount`.
  - Casos de `NaN`/`Infinity` retornando `INVALID_NUMERIC_INPUT` e overflow retornando `NUMERIC_OVERFLOW`.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7_

- [x] 5. Cobertura unitária de comissão, assinatura, cobrança e limites
  - Testes de regras de comissão cobrindo todos os ramos de decisão.
  - Testes de assinatura/plano por estado (trial, ativo, expirado, cancelado) e property test da máquina de estados (Property: só transições permitidas).
  - Testes de limite de uso (abaixo, no limite, acima) verificando `USAGE_LIMIT_REACHED`.
  - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 6. Cobertura unitária de autenticação, permissões e validações
  - Testes de autenticação (credenciais válidas, inválidas, vazias, nulas).
  - Testes de cada permissão/role do RBAC usando `expectPermissionDenied`.
  - Testes de validação de formulário e de payload (válido, malformado, vazio, campos faltantes).
  - Property test de phone/CPF/CNPJ/email (válidos aceitos, inválidos rejeitados).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 7. Cobertura unitária de helpers, serviços, hooks, middlewares e jobs
  - Testes de serviços internos (sucesso e erro), helpers/utilitários (válido, vazio, extremo).
  - Testes de hooks React (inicial, loading, sucesso, erro) usando `vi.mock` hoisted com spies via `globalThis.__nomeDoSpy`.
  - Testes de middlewares (autorizado/não autorizado) e de jobs (sucesso, falha, reprocessamento).
  - Validar tratamento de `JOB_FAILED` sem falha real (apenas error code é suficiente).
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [ ] 8. Cobertura unitária de parsing, transformação e CSV export
  - Para cada parser, garantir pretty printer correspondente e property test de round-trip `parse(print(x)) ≡ x` (Property 2).
  - Teste de entrada malformada retornando `PARSE_ERROR`.
  - Property test do CSV export: BOM UTF-8, separador `;`, escape RFC 4180, truncamento em 10000 linhas.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 9. Robustez unitária sob concorrência e idempotência
  - Property test de confluência de operações comutativas (Property 4).
  - Property test de idempotência `op(op(s)) == op(s)` (Property 3).
  - Teste de versionamento otimista: segunda escrita concorrente recebe `STALE_VERSION` (Property 5).
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

## Fase 2 — Harness de integração (Categoria B)

- [ ] 10. Construir Supabase Test Harness
  - Criar `tests/_helpers/supabaseHarness.ts` com `asUser`, `asAnon`, `asService`, `seedUser`, `cleanup` (IDs derivados do nome do teste; credenciais via env, nunca hardcoded).
  - Criar `src/__tests__/_helpers/auditAssertions.ts` com `expectAuditPersisted` (Property 8) e `expectMutationSucceedsDespiteAuditFailure` (Property 9) e `expectViewDenied`.
  - Documentar uso de branch Supabase efêmero no CI.
  - _Requirements: 12.4, 12.5, 12.6, 19.3_

- [ ] 11. Integração de cadastro e autenticação
  - `tests/integration/auth.integration.test.ts`: cadastro motorista, cadastro embarcador, login/logout, recuperação de senha.
  - JWT expirado → HTTP 401; credenciais inválidas → mensagem canônica `Não foi possível autenticar.`
  - Falha de envio de código → `Não foi possível enviar o código.`; cadastro duplicado → `Não foi possível concluir o cadastro.` (dados parciais temporários permitidos).
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [ ] 12. Integração do ciclo de vida do frete
  - `tests/integration/frete-lifecycle.integration.test.ts`: publicação, edição com `expected_updated_at`, candidatura, confirmação de fechamento, aceite de termos.
  - Edição com versão desatualizada → `STALE_VERSION` sem alterar registro.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 13. Integração de chat e mensagens
  - `tests/integration/chat.integration.test.ts`: abertura de conversa, envio/entrega, ordem cronológica.
  - Usuário sem vínculo é bloqueado pelo RLS.
  - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 14. Integração de assinaturas, pagamentos e webhooks
  - `tests/integration/billing-webhooks.integration.test.ts`: assinatura, cancelamento, pagamento mockado (aprovação/recusa).
  - Webhook com HMAC inválido → `WEBHOOK_SIGNATURE_INVALID`; webhook duplicado → idempotente (Property 3), sem rastrear duplicatas.
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 15. Integração de notificações, uploads e arquivos
  - `tests/integration/uploads.integration.test.ts`: envio de notificação, upload ao Storage, acesso via URL assinada só por autorizado.
  - MIME não permitido → `INVALID_FILE_TYPE`; arquivo malicioso rejeitado após conclusão; falha antes da conclusão não exige validação extra.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [ ] 16. Integração de LGPD, exclusão e auditoria
  - `tests/integration/lgpd-audit.integration.test.ts`: exclusão de conta, exportação LGPD, exclusão de dados.
  - Mutação admin auditável aprovada só com registro PERSISTIDO (Property 8); audit falho não bloqueia mutação (Property 9); RPC sem permissão grava `<MODULE>_VIEW_DENIED` com `before=NULL`.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 17. Integração de filas assíncronas e APIs externas
  - `tests/integration/jobs-external.integration.test.ts`: enfileiramento/processamento, integração externa com 1–3 cenários (mock).
  - Erro/timeout externo → retry ou degradação parcial sem perda; bloco de fetch agregado falha isolado (Property 14).
  - _Requirements: 13.1, 13.2, 13.3, 13.4_

## Fase 3 — Segurança (Categoria D)

- [ ] 18. RLS Harness e isolamento entre usuários
  - Criar `tests/_helpers/rlsHarness.ts` com `expectNoCrossUserAccess`.
  - `tests/security/rls-isolation.test.ts`: A não lê/atualiza/exclui dados de B; não autenticado → 401; sem admin → `permission_denied`.
  - Property test de isolamento para pares de usuários (Property 6); Master Admin imutável.
  - `permission_denied` tem precedência mesmo com erros de validação simultâneos (Property 7).
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

- [ ] 19. Vetores de injeção e ataques web
  - `tests/security/injection-vectors.test.ts`: SQLi, NoSQLi, XSS, CSRF, SSRF.
  - Property test: para todo payload malicioso, rejeição sem efeito colateral (Property 10).
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [ ] 20. Rate limiting, força bruta e anti-enumeração
  - `tests/security/rate-limit-bruteforce.test.ts`: excesso de login → 429; excesso por IP → header `Retry-After`; enumeração indistinguível; upload malicioso/MIME forjado rejeitado.
  - _Requirements: 18.1, 18.2, 18.3, 18.4_

- [ ] 21. Não vazamento de dados sensíveis e secrets
  - `tests/security/no-secret-leak.test.ts`: property test de respostas sem hash/secret (Property 11); erro de servidor sem stack trace; tokens fora dos logs; headers de segurança presentes.
  - `tests/security/secret-scan.test.ts`: escanear código-fonte por secrets hardcoded e falhar se encontrar.
  - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

## Fase 4 — Validação e contratos (Categorias G e H)

- [ ] 22. Validação de entrada frontend + backend
  - Testes garantindo validação de tipo/formato/tamanho/obrigatoriedade no frontend e revalidação no backend.
  - Sanitização só quando caractere perigoso detectado; normalização/encoding antes de persistir; violação de regra rejeitada na camada de validação.
  - Property test: entradas vazias/nulas/undefined/tipo incorreto rejeitadas consistentemente nos dois lados.
  - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6_

- [ ] 23. Validação de saída e respostas padronizadas
  - Testes de estrutura JSON contra schema, status HTTP correto, mensagens de erro padronizadas, ausência de campos sensíveis fora do contrato.
  - _Requirements: 23.1, 23.2, 23.3, 23.4_

- [ ] 24. Testes de contrato frontend/backend
  - Criar `tests/contract/api-contracts.test.ts` + baseline em `tests/contracts-snapshots/`.
  - `assertContractCompatible`: mudança compatível passa, incompatível falha (Property 13); round-trip de contrato (Property 2); estabilidade de webhooks; compatibilidade entre versões.
  - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6_

## Fase 5 — E2E (Categoria C)

- [ ] 25. Configurar Playwright (desktop + mobile)
  - Criar `tests/e2e/playwright.config.ts` com projetos `desktop-chromium` e `mobile-safari` (<768px), `retries: 1` no CI.
  - Criar `tests/e2e/fixtures/e2eFixtures.ts` (sessão autenticada, dados) e helper `expectInvalidFormBlocked` (exige bloqueio E mensagem pt-BR).
  - _Requirements: 14.1, 14.3, 15.1_

- [ ] 26. Fluxos E2E principais
  - `tests/e2e/auth.e2e.spec.ts` e `frete.e2e.spec.ts`: navegar, preencher, validar mensagem/estado/persistência; form válido → sucesso+persistência; inválido → bloqueio+erro pt-BR; rota protegida sem permissão → redirect/Stealth_404; persistência após refresh.
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 27. E2E de dispositivos e condições adversas
  - `tests/e2e/devices-adverse.e2e.spec.ts`: mobile vira lista de cards; sessão expirada → reautenticação; perda de rede com operação ativa → opções de recuperação; sem operação ativa → sem opções; múltiplos usuários → versão otimista sem corromper.
  - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6_

## Fase 6 — Performance (Categoria E)

- [ ] 28. Testes de carga e degradação controlada
  - Criar `tests/performance/load.k6.js` + `thresholds.json` (p95 dentro do limite, http_req_failed < 1%).
  - Medir memória/CPU/throughput sob múltiplos usuários; pico absorvido por filas sem perda.
  - Cenário de múltiplos serviços externos fora simultaneamente → degradação controlada sem falha total (Property 14).
  - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

## Fase 7 — Pipeline, regressão e observabilidade (Categorias F, I, J)

- [ ] 29. Estender o pipeline CI com gates de qualidade
  - Atualizar `.github/workflows/ci.yml`: adicionar `tsc --noEmit`, `test:run --coverage`, `check-coverage.ts`, jobs `migrations` (`validate-migrations.ts`) e `env-check` (`validate-env.ts`).
  - Gate de deploy só após quality + migrations + env-check verdes; falha de qualidade bloqueia deploy.
  - Step que falha se `flaky > 0`; steps de infra com `continue-on-error` + anotação (não bloqueiam merge).
  - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 25.1, 25.2, 25.3, 25.4, 25.5, 25.6_

- [ ] 30. Workflows dedicados de E2E e performance
  - Criar `.github/workflows/e2e.yml` (PR com label/scheduled, provisiona branch Supabase efêmero).
  - Criar `.github/workflows/performance.yml` (manual/agendado).
  - _Requirements: 15.1, 20.1_

- [ ] 31. Relatório de regressão e detecção de testes afetados
  - Criar `scripts/test-report.ts` que agrega `TestRunReport` (total/passed/failed/flaky/coverage) e publica artefato.
  - Garantir que teste existente que passa a falhar reporta o teste e o exemplo que falhou.
  - _Requirements: 21.7, 21.8, 25.6_

- [ ] 32. Observabilidade testável
  - Testes de logs estruturados contínuos (não dependem de evento específico) e correlation_id em erro não tratado.
  - Propagação de tracing entre frontend → Edge Function → RPC; 1–3 exemplos de evento auditável produzindo registro; `expectNoSecrets` sobre amostras de log.
  - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6_

## Fase 8 — Governança futura (Categoria K)

- [ ] 33. Steering de governança de specs e checklist de PR
  - Criar `.kiro/steering/testing-governance.md`: nenhuma feature pronta sem Requirements/Design/Tasks, testes, cenários de falha, validações, regressão atualizada e doc técnica.
  - Adicionar checklist de PR (template) com os itens obrigatórios e critérios de aceite testáveis.
  - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6_

- [ ] 34. Validação final da suíte completa
  - Rodar `npm run test:run -- --coverage` e `check-coverage.ts` localmente; confirmar verde e thresholds atingidos.
  - Rodar `npx tsc --noEmit` e `npm run build`; confirmar limpos.
  - Documentar como executar cada suíte (unit, integração, e2e, segurança, performance) em `tests/README.md`.
  - _Requirements: 21.1, 25.1, 27.6_


## Notes

- **Reuso primeiro:** muitos módulos já têm property tests em `src/__tests__/` (calculoFrete, inputValidator, passwordValidation, etc.). As tarefas da Fase 1 estendem/completam, não reescrevem.
- **Pre-commit rápido:** testes em `src/__tests__/` rodam no pre-commit (código puro). Testes em `tests/` (integração, E2E, performance) rodam só no CI para não atrasar o commit.
- **Branch Supabase efêmero:** integração e E2E usam development branch do Supabase (migrations da `main` em DB limpo), sem tocar produção.
- **Convenções fast-check:** nunca `fc.stringOf`; PII via `fc.constantFrom` de templates fixos válidos; `vi.mock` hoisted com spies via `globalThis.__nomeDoSpy`.
- **Governança executável:** as decisões oficiais viram helpers (`expectPermissionDenied`, `expectAuditPersisted`, `expectAntiEnumeration`) — o comportamento correto é a opção mais fácil de testar.
- **Credenciais:** sempre via variáveis de ambiente do CI; nenhuma chave hardcoded (Requirement 19).
- **Gates de CI:** falha de produto bloqueia merge/deploy (inclui flaky); falha de infra da pipeline não bloqueia automaticamente.
