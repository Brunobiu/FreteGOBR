# Ideia 3 — Painel Financeiro do Motorista

**Prioridade:** 3
**Status:** Aguardando execução (após admin-financeiro)

## Conceito

Dashboard simples no painel do motorista mostrando: total ganho no mês, total gasto em combustível estimado, lucro real do mês, histórico de fretes concluídos com valores, e gráfico mensal de evolução. Tudo calculado automaticamente com base nos fretes concluídos e nos dados do veículo já cadastrados.

## Regras de Negócio (rascunho)

### Cards KPI (topo)
- **Total ganho no mês:** SUM(value) dos fretes concluídos pelo motorista no mês corrente
- **Gasto combustível estimado:** SUM(distancia_km / consumo_medio * preco_diesel) dos fretes do mês
- **Lucro real do mês:** total ganho - gasto combustível - comissão plataforma
- **Fretes concluídos no mês:** COUNT dos fretes com status encerrado no mês

### Histórico
- Lista de fretes concluídos com: data, origem→destino, valor bruto, custo estimado, lucro líquido
- Paginação (10/50/100)
- Filtro por mês/período

### Gráfico
- Evolução mensal (últimos 6 ou 12 meses)
- Barras ou linhas: receita vs custo vs lucro
- SVG inline (sem deps externas — padrão do projeto)

### Configurações de custo
- Consumo médio do veículo (km/l) — já no cadastro do veículo?
- Preço médio do diesel (R$/l) — editável pelo motorista
- Outros custos fixos mensais (manutenção, seguro) — opcional, MVP pode ignorar

## Dependências

- Feature 2 (Lucro por Hora) compartilha os mesmos dados de custo/consumo
- Dados do veículo do motorista (consumo médio)
- Fretes concluídos pelo motorista (query em `fretes` WHERE motorista_id = X AND status = 'encerrado')

## Integração com Existente

- Painel do motorista (nova aba ou seção)
- Tabela `fretes` (já tem motorista_id, value, distance_km, status)
- Perfil do motorista (dados do veículo)
- Padrão de gráficos SVG inline do admin-dashboard (reusar approach)

## Notas para Implementação

- Pode ser uma RPC agregadora similar a `admin_financeiro_summary` mas para o motorista
- RLS: motorista só vê seus próprios dados (sem SECURITY DEFINER — usar RLS normal)
- Não precisa de audit log (não é painel admin)
- Mobile-first: motoristas usam celular
- Considerar cache/memoização dos cálculos mensais (não recalcular a cada render)
