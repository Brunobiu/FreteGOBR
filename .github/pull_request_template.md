<!--
  Template de PR do FreteGO — governança de testes.
  Ver .kiro/steering/testing-governance.md
-->

## O que muda

<!-- Descreva resumidamente a mudança e o motivo. -->

## Tipo

- [ ] Feature nova
- [ ] Correção de bug
- [ ] Refatoração / chore
- [ ] Documentação

## Checklist obrigatório (feature nova)

> Nenhuma feature é considerada concluída sem todos os itens abaixo.
> Para bugfix/chore, marque apenas os aplicáveis.

- [ ] `requirements.md` com critérios de aceite testáveis
- [ ] `design.md` (arquitetura + Correctness Properties quando houver invariante)
- [ ] `tasks.md` com plano incremental
- [ ] Testes automatizados (unit + property quando aplicável)
- [ ] Cenários de falha cobertos (caminhos negativos, erros, limites)
- [ ] Validações no frontend E no backend
- [ ] Regression_Suite atualizada (novos testes incorporados)
- [ ] Documentação técnica atualizada

## Decisões oficiais respeitadas

- [ ] Falta de permissão retorna `permission_denied` (precedência sobre validação)
- [ ] Sem vazamento de dados sensíveis em respostas/logs/traces
- [ ] Auditoria verificada por registro PERSISTIDO (quando aplicável)
- [ ] Formulário inválido bloqueia envio E mostra mensagem pt-BR
- [ ] Uploads: MIME inválido ⇒ `INVALID_FILE_TYPE`

## Como testei

<!--
  Comandos rodados e resultado:
  - npm run test:run -- --coverage
  - npx tsc --noEmit
  - npm run build
-->

## Verificação

- [ ] `npm run lint` limpo
- [ ] `npx tsc --noEmit` limpo
- [ ] `npm run test:run` verde (sem flaky)
- [ ] `npm run build` ok
