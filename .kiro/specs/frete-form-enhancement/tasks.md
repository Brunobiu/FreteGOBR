# Plano de Implementação - Frete Form Enhancement

> **STATUS (29/05/2026)**: spec **100% concluída** via implementação
> incremental no `src/components/FreteForm.tsx`. Todos os campos
> (tipo de carga, espécie, ONU, temperatura, peso/volume,
> dimensões, tipo de frete, opções adicionais, veículos
> categorizados, carrocerias categorizadas, valor, formas de
> pagamento) estão presentes no componente atual.

## Tarefas

- [x] 1. Tipo de Carga
  - [x] CARGO_TYPES com 8 opções (Carga Geral, Granel, etc)
  - [x] Campo ONU condicional para "Perigosa"
  - [x] Campo Temperatura condicional para "Frigorificada"
  - [x] Validação obrigatória

- [x] 2. Espécie
  - [x] SPECIES com 17 opções
  - [x] Seleção única
  - [x] Validação obrigatória

- [x] 3. Unidade de medida
  - [x] Radio "toneladas" / "quilos"
  - [x] Default "toneladas"
  - [x] Atualização de labels

- [x] 4. Peso e Volume
  - [x] Produto, Peso total, Volumes, Peso Cubado, Metragem
  - [x] Dimensões (Comprimento, Largura, Altura)
  - [x] Validação > 0 e decimais

- [x] 5. Tipo de Frete
  - [x] Radio "completa" / "complemento" / outros
  - [x] Default "completa"
  - [x] Percentual de ocupação para complemento

- [x] 6. Opções Adicionais
  - [x] Checkbox Lona
  - [x] Checkbox Rastreador
  - [x] Checkbox Seguro
  - [x] Seleção múltipla

- [x] 7. Veículos categorizados
  - [x] VEHICLE_CATEGORIES com Leves/Médios/Pesados
  - [x] Multi-seleção
  - [x] Click na categoria seleciona/desseleciona todos
  - [x] Validação ≥ 1 selecionado

- [x] 8. Carrocerias categorizadas
  - [x] BODY_CATEGORIES com Fechada/Aberta/Especial
  - [x] Multi-seleção
  - [x] Click na categoria seleciona/desseleciona todos
  - [x] Validação ≥ 1 selecionado

- [x] 9. Pagamento - Valor
  - [x] Radio "ja_sei" / "a_combinar"
  - [x] Campo valor + forma de cálculo
  - [x] Validação > 0 quando "ja_sei"

- [x] 10. Formas de pagamento
  - [x] PAYMENT_METHODS multi-seleção
  - [x] Adiantamento com percentual
  - [x] Faturado com prazo

- [x] 11. Validação e submissão
  - [x] Validação completa de campos obrigatórios
  - [x] Mensagens de erro específicas
  - [x] Mantém dados em caso de erro

- [x] 12. Organização visual
  - [x] Seções organizadas
  - [x] Indicadores de obrigatoriedade
  - [x] Tema consistente
  - [x] Responsivo

## Notas

Implementação concluída como parte do desenvolvimento orgânico do
`FreteForm` ao longo do projeto. Spec criada em fase inicial mas
nunca foi tocada porque o trabalho fluiu naturalmente. Todos os
campos validados em produção pelo embarcador real.
