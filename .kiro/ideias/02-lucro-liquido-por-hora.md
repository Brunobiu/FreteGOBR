# Ideia 2 — Lucro Líquido por Hora Rodada

**Prioridade:** 2
**Status:** Aguardando execução (após admin-financeiro)

## Conceito

Além do lucro total já calculado, mostrar ao motorista o lucro por hora estimado de cada frete, baseado na distância, velocidade média configurável e tempo de carga/descarga. Permite comparar fretes de forma mais inteligente.

**Exemplo:** Frete de R$2.000 em 800km pode ser pior que R$1.200 em 300km quando analisado por hora.

## Regras de Negócio (rascunho)

- Cálculo: `lucro_por_hora = lucro_liquido / tempo_total_estimado_horas`
- Tempo total = tempo de viagem + tempo de carga + tempo de descarga
- Tempo de viagem = `distancia_km / velocidade_media_kmh`
- Velocidade média: configurável pelo motorista (default: 60 km/h para rodovia)
- Tempo de carga/descarga: configurável (default: 2h total, ou 1h carga + 1h descarga)
- Lucro líquido = valor do frete - custo estimado de combustível - comissão da plataforma
- Custo combustível = `(distancia_km / consumo_medio_km_l) * preco_diesel_l`
- Consumo médio: vem do cadastro do veículo do motorista (já existe?)
- Preço diesel: configurável pelo motorista ou usar média nacional (API ANP?)
- Exibir em cada card de frete na listagem + no detalhe do frete
- Permitir ordenar fretes por lucro/hora (além de distância, valor, data)

## Dados Necessários

- `distancia_km` do frete (já existe no schema: `distance_km`)
- Valor do frete (`value`)
- Dados do veículo do motorista (consumo médio — verificar se existe)
- Configurações do motorista (velocidade média, tempo carga/descarga, preço diesel)

## Integração com Existente

- Cards de frete na listagem (`FreteCard.tsx`)
- Detalhe do frete (`FreteModal.tsx`)
- Perfil do motorista (configurações de veículo)
- Feature 1 (Frete de Retorno) — pode usar lucro/hora como critério de ordenação

## Notas para Implementação

- Helper puro `calcularLucroPorHora(frete, configMotorista)` — testável com fast-check
- Configurações do motorista: nova seção em ConfiguracoesPage ou no perfil
- Se dados do veículo não existem ainda, criar migration para adicionar campos
- Considerar tooltip explicando o cálculo quando o motorista clicar no valor
- MVP: cálculo simples sem considerar pedágios. Evolução: integrar pedágios via API
