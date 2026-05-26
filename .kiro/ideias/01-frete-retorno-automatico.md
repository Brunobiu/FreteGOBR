# Ideia 1 — Frete de Retorno Automático

**Prioridade:** 1 (mais alta)
**Status:** Aguardando execução (após admin-financeiro)

## Conceito

Quando o motorista aceitar um frete ou estiver "em andamento", o sistema busca automaticamente fretes disponíveis cuja ORIGEM esteja num raio configurável do DESTINO do frete atual. Aparece num card destacado ou aba "Fretes de Retorno" no painel do motorista, mesmo que ele nunca abra o mapa.

## Regras de Negócio (rascunho)

- Trigger: motorista aceita frete OU frete muda para status "em andamento"
- Query: buscar fretes com `status = 'ativo'` cuja coordenada de origem esteja dentro de um raio X km do destino do frete atual
- Raio configurável pelo motorista (default: 50km, range: 10-200km)
- Usar PostGIS (`ST_DWithin` ou `ST_Distance`) para query de proximidade geográfica
- Resultados aparecem em card destacado / aba "Fretes de Retorno" no painel do motorista
- Não depende do motorista abrir o mapa — aparece automaticamente
- Ordenação por proximidade (mais perto primeiro) ou por lucro/hora (se Feature 2 estiver pronta)
- Atualização: recalcular quando o frete atual mudar de status ou quando novos fretes forem publicados (realtime ou polling)

## Dependências Técnicas

- PostGIS extension no Supabase (verificar se já está habilitada)
- Coordenadas de origem/destino nos fretes (já existem: `origin_lat`, `origin_lng`, `destination_lat`, `destination_lng` ou equivalente — verificar schema)
- Possível necessidade de índice GiST nas coordenadas para performance

## Integração com Existente

- Painel do motorista (já existe)
- Tabela `fretes` (já existe com coordenadas)
- Sistema de aceite de frete (já existe)
- Mapa interativo (já existe — pode mostrar os fretes de retorno no mapa também)

## Notas para Implementação

- Considerar cache da query (não recalcular a cada render)
- Considerar notificação push quando um frete de retorno bom aparecer
- MVP: query simples por distância. Evolução: scoring por lucro/hora + distância
- Pensar em como lidar quando o motorista tem múltiplos fretes aceitos (qual destino usar?)
