# Ideia 9 — Expiração Automática de Fretes (120h / 5 dias)

**Prioridade:** A definir
**Status:** Aguardando execução

## Conceito

Todo frete postado é excluído (ou arquivado) automaticamente após 120 horas (5 dias) sem interação. Se o embarcador editar qualquer campo do frete, o timer reseta e volta a contar 5 dias do zero. Tudo acontece nos bastidores — nenhuma mensagem ou aviso é exibido para o usuário sobre a expiração.

## Regras de Negócio (rascunho)

### Expiração
- Fretes com status "ativo" expiram 120 horas (5 dias) após a última edição
- Timer baseado em `updated_at` do frete (não `created_at`)
- Quando expira: status muda para "expirado" (ou soft delete — não aparece mais em listagens)
- Silencioso: nenhum aviso, notificação ou mensagem para ninguém (embarcador, motorista, admin)
- Fretes com status diferente de "ativo" NÃO expiram (em andamento, encerrado, cancelado — já têm ciclo de vida próprio)

### Reset do Timer
- Qualquer edição pelo embarcador (valor, descrição, origem, destino, produto, qualquer campo) reseta o timer
- Na prática: `updated_at = NOW()` já acontece naturalmente em qualquer UPDATE
- Ou seja: o timer é simplesmente `NOW() - updated_at > INTERVAL '120 hours'`
- Não precisa de campo extra — usar `updated_at` que já existe

### O que NÃO reseta o timer
- Motorista curtir/descurtir o frete
- Motorista enviar mensagem sobre o frete
- Visualizações do frete
- Apenas EDIÇÃO pelo embarcador reseta

### Visibilidade
- Fretes expirados NÃO aparecem na listagem pública (motoristas não veem)
- Fretes expirados NÃO aparecem no painel do embarcador (ou aparecem numa aba "Expirados" separada — decidir)
- Admin pode ver fretes expirados no painel admin (filtro de status)

### Exclusão vs Arquivamento
- **Opção A (recomendada):** Soft delete — status = 'expirado', mantém no banco para histórico/admin
- **Opção B:** Hard delete — remove do banco (mais limpo, mas perde histórico)
- MVP: Opção A (soft delete com novo status 'expirado')

## Implementação Técnica (rascunho)

### Abordagem 1: pg_cron (recomendada)
```sql
-- Roda a cada hora (ou a cada 15 min)
SELECT cron.schedule('expire-stale-fretes', '0 * * * *', $$
  UPDATE fretes
  SET status = 'expirado'
  WHERE status = 'ativo'
    AND updated_at < NOW() - INTERVAL '120 hours';
$$);
```

### Abordagem 2: RLS + View filtrada
- Não mudar status, mas filtrar na query de listagem:
  `WHERE status = 'ativo' AND updated_at > NOW() - INTERVAL '120 hours'`
- Mais simples, mas não "limpa" o banco e pode confundir em queries admin

### Abordagem 3: Edge Function scheduled
- Supabase Edge Function com cron trigger (se pg_cron não estiver disponível)

## Dependências Técnicas

- pg_cron extension no Supabase (verificar se está habilitada — provavelmente sim)
- Coluna `updated_at` na tabela `fretes` (já existe)
- Possível novo valor no CHECK de status: adicionar 'expirado' ao enum
- Índice em `(status, updated_at)` para performance do cron job

## Integração com Existente

- Tabela `fretes` (já tem `status` e `updated_at`)
- Listagem de fretes (já filtra por `status = 'ativo'` — se adicionar 'expirado', já fica excluído automaticamente)
- Painel admin de fretes (adicionar filtro por status 'expirado')
- Mapa interativo (já filtra por status ativo)
- Trigger `on_frete_close_create_repasse` (não afetado — só dispara em 'encerrado')

## Notas para Implementação

- **Zero UI:** nenhuma mudança visual para o usuário. Tudo backend.
- Verificar se o CHECK constraint atual de `fretes.status` aceita 'expirado' — se não, migration para adicionar
- O cron job é idempotente (rodar 2x não causa problema — WHERE já filtra)
- Considerar: notificar o embarcador por e-mail quando o frete expirar? (Bruno disse que NÃO — silencioso)
- Considerar: permitir o embarcador "republicar" um frete expirado? (Futuro — por enquanto, ele cria um novo)
- Log no admin: pode ser útil ter um audit log "FRETE_EXPIRED" para o admin ver quantos expiram por dia
- Performance: com índice em `(status, updated_at)`, o cron job é O(n) apenas nos ativos vencidos (rápido)
