# Design — commodity-categorization

Liga `fretes` à tabela existente `commodity_categories` via FK
nullable, normalizando o atributo "produto" para uma lista controlada
pelo admin. Filtro do motorista vira filtro server-side.

## 1. Visão geral do fluxo

```
┌──────────────────────────┐
│ Admin                    │
│ /admin/anuncios          │
│   └── AdminCommoditiesP. │  CRUD + reorder + ativar/desativar
│       (já existe)        │  → commodity_categories
└────────────┬─────────────┘
             │ commodity_categories.* (já existe)
             ▼
   ┌─────────────────────────┐
   │ Embarcador              │       ┌──────────────────────────┐
   │ FreteForm               │──────▶│ fretes                   │
   │   └── Produto: <select> │  FK   │   commodity_id NEW       │
   │       (commodities      │       │   product LEGACY         │
   │        ativas)          │       └─────────────┬────────────┘
   └─────────────────────────┘                     │
                                                   │ select join
                                                   ▼
                       ┌────────────────────────────────────────┐
                       │ Motorista                              │
                       │ HomePage                               │
                       │   ├── CommoditiesCarousel              │
                       │   │     onSelect → setSelectedSlug     │
                       │   ├── filtro raio (já existe)          │
                       │   └── getActiveFretes({                │
                       │         commodityId, radius… })        │
                       └────────────────────────────────────────┘
```

## 2. Schema — Migration 044

Próxima livre conforme `project-conventions.md` (043 = chat-support-admin-rls).
Arquivo: `supabase/migrations/044_fretes_commodity_id.sql` + par
`044_fretes_commodity_id_rollback.sql`.

### 2.1. Coluna nova

```sql
ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS commodity_id uuid NULL
    REFERENCES commodity_categories(id) ON DELETE RESTRICT;
```

- **Nullable** (fretes legados ficam `NULL`; UI do embarcador exige
  na criação/edição daqui pra frente).
- **`ON DELETE RESTRICT`**: admin não consegue deletar uma commodity
  com fretes ativos vinculados (RLS cobre isso e a UI captura o erro).
- **Sem `NOT NULL`** mesmo com default — não vamos backfill de dados
  reais, é decisão consciente (R6).

### 2.2. Índice

```sql
CREATE INDEX IF NOT EXISTS idx_fretes_commodity_active
  ON fretes (commodity_id, status)
  WHERE status = 'ativo';
```

Composto + parcial: o filtro do motorista é sempre `status='ativo' AND
commodity_id = ?`, então o parcial reduz drasticamente o tamanho do
índice.

### 2.3. RLS

Política `fretes_select_active_anon_authenticated` já permite
`SELECT *` em fretes ativos. Como a coluna é só uma FK escalar,
nenhuma mudança de RLS é necessária.

A INSERT/UPDATE policy de embarcador continua igual — o cliente
envia `commodity_id` via `.insert()`/`.update()` normal, validado
pelo CHECK FK do banco.

### 2.4. Bloco VERIFY (smoke test manual)

```sql
/*
SELECT column_name FROM information_schema.columns
  WHERE table_name='fretes' AND column_name='commodity_id';

SELECT indexname FROM pg_indexes WHERE tablename='fretes'
  AND indexname='idx_fretes_commodity_active';

-- Confirma RESTRICT
SELECT confdeltype FROM pg_constraint
  WHERE conrelid = 'fretes'::regclass
  AND conname LIKE '%commodity%';
-- Esperado: 'r' (RESTRICT)
*/
```

### 2.5. Rollback

```sql
-- 044_fretes_commodity_id_rollback.sql
DROP INDEX IF EXISTS idx_fretes_commodity_active;
ALTER TABLE fretes DROP COLUMN IF EXISTS commodity_id;
```

Não auto-aplicado.

## 3. TS types

### 3.1. `services/fretes.ts`

```ts
export interface Frete {
  // ... existing
  commodityId?: string | null;
  commoditySlug?: string | null;  // hidratado via join
  commodityName?: string | null;  // hidratado via join

  /** @deprecated mantido só para fretes legados; novos fretes usam commodityId. */
  product?: string;
}

export interface CreateFreteData {
  // ... existing
  commodityId: string;  // OBRIGATÓRIO no novo fluxo
  // product removido do contrato público (mantido só read-only no map)
}

export interface FreteFilters {
  // ... existing
  commodityId?: string;
}
```

### 3.2. Mapeamento DB → TS

`getActiveFretes` faz join leve para hidratar nome/slug sem N+1:

```ts
const { data, error } = await supabase
  .from('fretes')
  .select(`
    *,
    commodity:commodity_categories(id, slug, name)
  `)
  .eq('status', filters?.status ?? 'ativo')
  .eq('commodity_id', filters?.commodityId)  // só quando passado
  // ... demais filtros
```

`mapFreteFromDb` extrai `commodity` do join:

```ts
const commodity = (data as any).commodity as
  | { id: string; slug: string; name: string }
  | null;
return {
  // ...
  commodityId: data.commodity_id ?? null,
  commoditySlug: commodity?.slug ?? null,
  commodityName: commodity?.name ?? null,
  product: data.product ?? undefined,  // legado, opcional
};
```

### 3.3. Filtro no `getActiveFretes`

```ts
let query = supabase.from('fretes').select(`
  *,
  commodity:commodity_categories(id, slug, name)
`).eq('status', filters?.status || 'ativo');

if (filters?.commodityId) {
  query = query.eq('commodity_id', filters.commodityId);
}
// ... resto igual
```

## 4. Embarcador — `FreteForm.tsx`

### 4.1. Novo state

```ts
const [commodities, setCommodities] = useState<CommodityCategory[]>([]);
const [commodityId, setCommodityId] = useState<string>('');

useEffect(() => {
  listActiveCommodities()
    .then(setCommodities)
    .catch(() => setCommodities([]));
}, []);
```

Em modo edição, hidratar `commodityId` do frete recebido.

### 4.2. Substituir o `<input>` do produto

Antes:

```tsx
<label>Produto *</label>
<input value={product} onChange={...} placeholder="Qual produto..." />
```

Depois:

```tsx
<label htmlFor="commodity">Produto *</label>
<select
  id="commodity"
  value={commodityId}
  onChange={(e) => setCommodityId(e.target.value)}
  required
  className="w-full px-3 py-2 bg-white border border-gray-300
             rounded-lg text-gray-800 text-sm appearance-auto"
>
  <option value="" disabled>Selecione um produto</option>
  {commodities.map((c) => (
    <option key={c.id} value={c.id}>{c.name}</option>
  ))}
</select>
{errors.commodityId && (
  <p className="text-xs text-red-600 mt-1">{errors.commodityId}</p>
)}
```

`appearance-auto` mantém a setinha nativa do select (que é o
"setinha pra baixo" pedido pelo Bruno). Sem libs externas.

### 4.3. Validação

Substituir:

```ts
if (!product.trim()) errs.product = 'Informe o produto';
```

Por:

```ts
if (!commodityId) errs.commodityId = 'Selecione um produto';
```

### 4.4. Submit

`product` deixa de ser enviado pelo formulário em fretes novos. Como
`product` é coluna nullable existente no banco e ainda há código de
leitura (FreteCard, FreteModal, FreteTable), mantemos backward
compat: o card/modal mostra `commodityName ?? product`.

```ts
await createFrete({
  // ...
  commodityId,
  // product removido — não enviar
});
```

## 5. Motorista — `HomePage.tsx` + `CommoditiesCarousel.tsx`

### 5.1. State controlado da commodity selecionada

```ts
const [selectedCommoditySlug, setSelectedCommoditySlug] = useState<string | null>(null);
const [selectedCommodityId, setSelectedCommodityId] = useState<string | null>(null);
```

### 5.2. Carrossel passa a ser controlado

```tsx
<CommoditiesCarousel
  selectedSlug={selectedCommoditySlug}
  onSelect={(c) => {
    if (selectedCommoditySlug === c.slug) {
      // Toggle off: clicou na mesma → desliga
      setSelectedCommoditySlug(null);
      setSelectedCommodityId(null);
    } else {
      setSelectedCommoditySlug(c.slug);
      setSelectedCommodityId(c.id);
    }
  }}
/>
```

### 5.3. Filtro server-side

Substituir o atual:

```ts
const loadFretes = useCallback(async (filters: FreteFilters) => {
  // ...
  const data = await getActiveFretes(filters);
  // ...
}, []);
```

Por uma versão que considera `selectedCommodityId`:

```ts
const loadFretes = useCallback(async (filters: FreteFilters) => {
  // ...
  const data = await getActiveFretes({
    ...filters,
    commodityId: selectedCommodityId ?? undefined,
  });
  // ...
}, [selectedCommodityId]);

useEffect(() => {
  if (isMotoristaBloqueado) return;
  loadFretes(currentFiltersRef.current);
}, [loadFretes, isMotoristaBloqueado, selectedCommodityId]);
```

### 5.4. Indicador "Filtro ativo"

Após o `<CommoditiesCarousel />`, antes do header de "Fretes
Disponíveis":

```tsx
{selectedCommoditySlug && (
  <div className="mb-2 flex items-center gap-2 text-xs text-gray-600">
    <span>
      Filtrando por:{' '}
      <span className="font-medium text-green-700">
        {commodityNameFromSlug(selectedCommoditySlug)}
      </span>
    </span>
    <button
      type="button"
      onClick={() => {
        setSelectedCommoditySlug(null);
        setSelectedCommodityId(null);
      }}
      className="text-xs px-2.5 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
    >
      Limpar filtro
    </button>
  </div>
)}
```

### 5.5. Mensagem de "vazio"

Atualizar a mensagem quando `visibleFretes.length === 0`:

```tsx
{isMotorista && motoristaPoint && selectedCommoditySlug
  ? `Nenhum frete de ${selectedCommodityName} no raio de ${radiusKm} km.`
  : isMotorista && motoristaPoint
    ? 'Nenhum frete encontrado nesse raio. Tente aumentar para 200 ou 500 km.'
    : 'Novos fretes aparecerão aqui quando forem publicados.'}
```

## 6. Admin — proteção contra delete em uso

### 6.1. UI: contagem antes do delete

`AdminCommoditiesPanel.handleDelete` consulta antes:

```ts
const { count } = await supabase
  .from('fretes')
  .select('id', { count: 'exact', head: true })
  .eq('commodity_id', c.id)
  .eq('status', 'ativo');

if (count && count > 0) {
  alert(
    `Não é possível excluir "${c.name}" — há ${count} frete(s) ativo(s) ` +
    `usando esta categoria. Desative em vez de excluir.`
  );
  return;
}
// ... segue com confirm + delete normal
```

### 6.2. Banco: salvaguarda real

`ON DELETE RESTRICT` na FK garante que mesmo se a UI for contornada,
o banco rejeita o DELETE com erro `23503`. Capturamos no service:

```ts
if (error?.code === '23503') {
  throw new Error('Existem fretes vinculados a esta categoria. Desative em vez de excluir.');
}
```

## 7. UI: como o card e o modal exibem

### 7.1. `FreteCard.tsx`

```tsx
{(frete.commodityName ?? frete.product) && (
  <p className="text-xs text-gray-700">
    <span className="text-gray-400">Produto:</span>{' '}
    <span className="font-medium">
      {frete.commodityName ?? frete.product}
    </span>
  </p>
)}
```

### 7.2. `FreteModal.tsx`

Bloco "Produto" segue idêntico mas lê de `commodityName ?? product`.
Sem mudança de layout.

### 7.3. `FreteTable.tsx`

Coluna "Produto" idem. Sort continua por `product` (string) — para
fretes com `commodityName`, ordena pelo nome resolvido. Trivial:

```ts
const productSort = (f: Frete) => f.commodityName ?? f.product ?? '';
```

## 8. Compatibilidade & migração de dados (NÃO faremos)

- **Não** vamos fazer backfill (`UPDATE fretes SET commodity_id =
  best_guess WHERE product ILIKE '%soja%'`). Risco de erro maior que
  benefício.
- Fretes legados aparecem normalmente sem categoria. Quando o
  embarcador editar, o save vai forçar escolher uma — normalização
  passiva.

## 9. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Admin desativa commodity em uso → embarcador não vê no dropdown ao editar | média | Hidratar dropdown incluindo a commodity atual do frete mesmo se inativa, com label "(inativa)". Em criação só aparecem ativas. |
| Performance do join `commodity_categories` em `getActiveFretes` | baixa | Tabela tem ≤ 30 linhas. Postgres joina via hash em microssegundos. |
| Real-time subscription do `fretes-realtime` perde refetch quando muda categoria | baixa | `loadFretes` já é re-disparado via `selectedCommodityId` na dependência do useEffect. |
| Card legado quebra layout sem `product` nem `commodityName` | baixa | Bloco já é condicional (`{frete.product && ...}`). Mantém comportamento. |
| Embarcador edita frete legado e não consegue salvar sem commodity | esperado | É feature, não bug — força normalização. Mensagem de erro clara. |

## 10. Testes

### 10.1. Property tests obrigatórios

Conforme `project-conventions.md`:

`src/__tests__/commodity-categorization/cp1_filter_parity.property.test.ts`
- **P1** (determinismo): `filterByCommodity(fretes, c)` puro
- **P2** (interseção raio + commodity): aplicar raio depois commodity =
  aplicar commodity depois raio
- **P3** (legado): `filterByCommodity(fretes, c)` exclui fretes com
  `commodityId === null`

### 10.2. Unit tests do FreteForm

`src/__tests__/embarcador/freteform_commodity_select.test.tsx`
- Renderiza select com opções de `listActiveCommodities` mockado
- Validação rejeita submit sem commodity selecionada
- Em edit, hidrata `commodityId` do frete recebido (mesmo se inativa)

### 10.3. Smoke E2E manual (manual checklist)

1. Admin: criar nova commodity "Trigo Especial"
2. Embarcador (outra aba): abrir FreteForm → opção aparece sem reload
3. Postar frete com "Trigo Especial"
4. Motorista: clicar "Trigo Especial" no carrossel → ver só esse frete
5. Motorista: clicar de novo → volta a ver todos
6. Admin: tentar deletar "Trigo Especial" → erro amigável (1 frete ativo)
7. Admin: desativar → some do dropdown e do carrossel; frete continua
   listado para motorista (sem filtro selecionado)

## 11. Ordem de execução resumida

1. Migration 044 + rollback
2. Service `fretes.ts`: tipo + map + filtro `commodityId`
3. `FreteForm.tsx`: dropdown + validação + remover `product` text
4. `HomePage.tsx`: state controlado + filtro server-side + indicador
5. `AdminCommoditiesPanel.tsx`: pre-check delete
6. Property tests
7. Smoke E2E manual e push

Detalhes finos vão em `tasks.md`.
