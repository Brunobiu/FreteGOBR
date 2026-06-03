# Requirements — commodity-categorization

Feature que conecta os 3 lados do produto via uma única lista de
commodities controlada pelo admin:

- **Admin** mantém a lista (já existe em `AdminCommoditiesPanel`)
- **Embarcador** escolhe uma commodity ao postar frete (substitui o
  campo "Produto" texto livre)
- **Motorista** filtra fretes clicando na commodity no carrossel da home

## R1 — Fonte única de verdade

A tabela `commodity_categories` (criada em migration 039) é a única
lista de commodities do sistema.

- O admin pode adicionar/editar/desativar/reordenar via
  `/admin/anuncios` → painel de Commodities.
- Mudanças refletem em tempo real no embarcador (próxima vez que abrir o
  formulário de frete) e no motorista (próximo carregamento da home).
- Sem deploy ou migration por commodity nova.

## R2 — Embarcador: dropdown obrigatório

No formulário de cadastro/edição de frete (`FreteForm`):

- O campo "Produto" deixa de ser `<input type="text">` (livre) e vira
  `<select>` (dropdown nativo com setinha) populado por
  `listActiveCommodities()`.
- Campo é **obrigatório** (`required`). Não permite frete sem
  commodity associada.
- A primeira opção é placeholder vazia disabled (`Selecione um
  produto`); demais são as commodities ativas em `sort_order`.
- Texto exibido no card e modal continua mostrando o nome legível
  ("Soja", "Milho").
- Fretes existentes (sem commodity) continuam válidos no banco mas
  só pode editar para informar uma commodity (UI bloqueia salvar
  sem ela).

## R3 — Motorista: filtro por commodity

Na home do motorista (`HomePage`):

- Clique numa commodity do `CommoditiesCarousel` ativa o filtro:
  contador "Fretes Disponíveis (XX)" e a lista refletem só fretes
  daquela commodity.
- Clique de novo na **mesma** commodity desativa (volta a mostrar
  todas).
- Filtro de raio (50/100/200/500 km) e filtro de commodity são
  **combináveis** (interseção).
- Indicador visual: a commodity selecionada fica com ring verde (já
  existe via prop `selectedSlug`) e a contagem "fretes em <commodity>"
  aparece sutil ao lado do total.
- Botão pequeno "Limpar filtro" aparece quando há commodity
  selecionada.

## R4 — Filtro server-side (não cliente)

A lista de fretes do motorista é filtrada **no servidor** via
`getActiveFretes({ commodityId })`, não em memória após o fetch.

- Reduz payload em produção (motorista pode ter 500+ fretes ativos
  no raio 500 km).
- Continua respeitando RLS, real-time updates e paginação existente.

## R5 — Admin: sem regressão

O painel `/admin/anuncios` → Commodities continua funcionando
exatamente como hoje (CRUD + reorder + ícone). Apenas:

- Antes de deletar, mostrar contagem de fretes ativos usando aquela
  commodity. Bloquear delete com mensagem se houver ≥ 1 frete ativo
  vinculado (`ON DELETE RESTRICT` no banco, com erro amigável na UI).
- Desativar (`is_active = false`) continua funcionando: a commodity
  some do dropdown do embarcador e do carrossel do motorista, mas
  fretes vinculados continuam visíveis.

## R6 — Compatibilidade com fretes legados

Fretes criados antes desta feature não têm `commodity_id`:

- Continuam aparecendo no feed do motorista (sem filtro de commodity
  selecionado).
- Não aparecem quando uma commodity está selecionada no filtro
  (filtro server-side `commodity_id = ?`).
- Embarcador pode editá-los e o save **exige** escolher uma
  commodity (forçando a normalização gradual sem migration de dados).

## R7 — Ação e auditoria

Manter coerência com o resto do painel admin:

- Audit log do admin já cobre CRUD de commodities (via `executeAdminMutation`
  no painel atual). Sem mudança.
- Mutações no `fretes.commodity_id` no fluxo do embarcador NÃO
  geram audit log (não é ação admin).

## R8 — UI compacta (steering project-conventions)

- Dropdown do FreteForm segue o estilo dos demais campos: `text-sm
  px-3 py-2 rounded-lg`.
- Botão "Limpar filtro" no motorista: `text-xs px-2.5 py-1`
  (compact UI rule).
- Sem `<h1>` novo.
- Mensagens user-facing em pt-BR.
