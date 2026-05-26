# Ideia 4 — Avaliação Mútua e Reputação

**Prioridade:** 4
**Status:** Aguardando execução (após admin-financeiro)

## Conceito

Após a conclusão de um frete, tanto o motorista quanto o embarcador se avaliam (nota 1-5 + comentário). A média de avaliações aparece no perfil de cada um. O motorista consegue ver a reputação do embarcador antes de aceitar um frete, sabendo se ele paga em dia, se a carga está correta, etc. Embarcadores ruins ficam visíveis pra toda a comunidade.

## Regras de Negócio (rascunho)

### Fluxo de Avaliação
- Trigger: frete muda para status "encerrado"
- Ambos (motorista e embarcador) recebem notificação para avaliar
- Prazo: 7 dias para avaliar (após isso, perde a chance)
- Avaliação é anônima até ambos avaliarem (evita retaliação)
- Após ambos avaliarem OU prazo expirar, as avaliações ficam visíveis

### Campos da Avaliação
- Nota geral: 1-5 estrelas (obrigatória)
- Categorias específicas (opcionais):
  - Para embarcador: "Pagamento em dia", "Carga conforme descrito", "Comunicação"
  - Para motorista: "Pontualidade", "Cuidado com a carga", "Comunicação"
- Comentário texto livre (opcional, max 500 chars)

### Reputação
- Média ponderada das últimas N avaliações (ex: últimas 50)
- Exibida no perfil público: estrelas + número de avaliações
- Badge visual: "Novo" (< 5 avaliações), "Confiável" (≥ 4.5 com 10+), "Verificado" (≥ 4.0 com 20+)
- Embarcadores com média < 3.0 recebem alerta visual nos cards de frete

### Visibilidade
- Motorista vê reputação do embarcador ANTES de aceitar o frete (no card e no detalhe)
- Embarcador vê reputação do motorista quando ele demonstra interesse
- Avaliações individuais visíveis no perfil (com data, nota, comentário — sem nome do avaliador até ambos avaliarem)
- Admin pode moderar avaliações (remover ofensivas)

### Proteções
- Não pode avaliar o mesmo frete 2x (idempotente)
- Não pode avaliar frete que não participou
- Comentários passam por filtro de palavrões (lista básica)
- Admin pode remover avaliação abusiva (audit log)

## Dependências Técnicas

- Nova tabela `reviews` (ou `avaliacoes`)
- Coluna `rating_avg` e `rating_count` em `users` (desnormalizado para performance)
- Trigger ou RPC para recalcular média quando nova avaliação entra
- Notificação para lembrar de avaliar (integra com sistema de notificações existente)

## Integração com Existente

- Perfil do motorista e embarcador (exibir estrelas + badge)
- Cards de frete (exibir reputação do embarcador)
- Sistema de notificações (lembrete de avaliação)
- Painel admin (moderação de avaliações — pode ser módulo futuro)
- Chat (após encerramento, sugerir avaliação)

## Notas para Implementação

- Tabela `reviews`: reviewer_id, reviewed_id, frete_id, rating (1-5), categories (jsonb), comment, created_at
- UNIQUE constraint em (reviewer_id, frete_id) — idempotência
- RLS: só pode criar review se participou do frete E frete está encerrado
- Desnormalizar `rating_avg` e `rating_count` em `users` via trigger (evita JOIN pesado em listagens)
- Considerar que o RatingDisplay.tsx e RatingForm.tsx já existem no projeto — reusar/adaptar
- MVP: nota + comentário simples. Evolução: categorias, badges, moderação admin
