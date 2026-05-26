# Ideias — Backlog de Features Futuras

Pasta de rascunhos de features para implementar **após** o admin-financeiro estar completo.
Cada arquivo documenta conceito, regras de negócio, dependências e notas de implementação.

Quando for hora de executar, transformamos cada ideia em spec formal (requirements → design → tasks).

## Índice (por prioridade)

| # | Feature | Arquivo | Resumo |
|---|---------|---------|--------|
| 1 | Frete de Retorno Automático | `01-frete-retorno-automatico.md` | PostGIS busca fretes perto do destino atual |
| 2 | Lucro Líquido por Hora | `02-lucro-liquido-por-hora.md` | Comparação inteligente de fretes por R$/hora |
| 3 | Painel Financeiro do Motorista | `03-painel-financeiro-motorista.md` | Dashboard de receita, custo e lucro mensal |
| 4 | Avaliação Mútua e Reputação | `04-avaliacao-mutua-reputacao.md` | Notas 1-5 + comentários pós-frete |

## Ordem de Execução Sugerida

1. **Feature 2** (Lucro/Hora) primeiro — é helper puro, sem migration pesada, e alimenta Feature 1 e 3
2. **Feature 1** (Frete de Retorno) — depende de PostGIS + coordenadas, maior impacto para motoristas
3. **Feature 3** (Painel Financeiro) — reutiliza dados de custo da Feature 2
4. **Feature 4** (Avaliações) — independente, pode ser paralela

*A ordem final depende do que o Bruno decidir na hora.*
