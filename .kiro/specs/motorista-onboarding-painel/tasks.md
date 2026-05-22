# Plano de Implementação — Motorista Onboarding & Painel

## Visão Geral

Este plano traduz o design aprovado em uma sequência de tarefas
incrementais de codificação. A ordem segue a estratégia
**"de dentro para fora"**: primeiro o backlog e o schema (não-UI),
depois utilidades puras testáveis, depois serviços, depois
componentes, e finalmente o cabeamento das páginas.

Cada tarefa principal referencia explicitamente os requirements
e/ou seções do design que valida. Sub-tarefas marcadas com `*` são
opcionais (testes) e podem ser puladas em uma execução de MVP.

> Convenção sobre as instruções de implementação:
>
> Convert the feature design into a series of prompts for a
> code-generation LLM that will implement each step with incremental
> progress. Make sure that each prompt builds on the previous prompts,
> and ends with wiring things together. There should be no hanging or
> orphaned code that isn't integrated into a previous step. Focus
> ONLY on tasks that involve writing, modifying, or testing code.

---

## Tarefas

- [x] 1. Criar backlog `.kiro/PARA_DEPOIS.md` com itens iniciais
  - Criar arquivo `.kiro/PARA_DEPOIS.md` na raiz da pasta `.kiro/`
    (fora de `specs/`).
  - Adicionar cabeçalho `# Para Depois` + parágrafo curto explicando
    que entradas mais recentes ficam no topo.
  - Incluir as 4 entradas iniciais no formato
    `## YYYY-MM-DD — <título curto>` seguidas da descrição:
    1. "Sistema de aprovação de documentos (admin aprova/rejeita
       CNH, CRLV, etc)"
    2. "Dashboard administrativo do dono (acesso a tudo e todos)"
    3. "Forma de pagamento do embarcador integrada (Mercado Pago,
       Stripe, etc)"
    4. "API de pedágios — cálculo automático baseado na rota e
       número de eixos do caminhão"
  - _Refs: Requirement 14_

- [x] 2. Criar migration `017_motorista_painel_fields.sql`
  - Criar arquivo
    `supabase/migrations/017_motorista_painel_fields.sql` envelopado
    em `BEGIN; ... COMMIT;`.
  - _Refs: Requirement 15, Design Section 4_

  - [x] 2.1 Adicionar 7 novas colunas em `motoristas` com
        `ADD COLUMN IF NOT EXISTS`
    - `vehicle_year_manufacture INTEGER`
    - `vehicle_year_model INTEGER`
    - `km_per_liter NUMERIC(4,1)`
    - `trailer_axles INTEGER`
    - `cargo_capacity_ton NUMERIC(5,1)`
    - `diesel_price NUMERIC(5,2)`
    - `is_owner BOOLEAN DEFAULT TRUE`
    - _Refs: Requirements 15.1, 15.3_

  - [x] 2.2 Backfill: copiar `vehicle_year` para
        `vehicle_year_manufacture` quando este for nulo
    - `UPDATE motoristas SET vehicle_year_manufacture = vehicle_year
       WHERE vehicle_year_manufacture IS NULL AND vehicle_year IS NOT NULL`
    - Não apagar nem renomear `vehicle_year` (preservação total).
    - _Refs: Requirement 15.4_

  - [x] 2.3 Recriar `documents_document_type_check` incluindo
        `'documento_proprietario'`
    - `ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_document_type_check`.
    - `ADD CONSTRAINT documents_document_type_check CHECK (...)` com
      os 19 tipos atuais + `'documento_proprietario'` (superconjunto).
    - _Refs: Requirements 15.2, 15.5_

  - [x] 2.4 Adicionar CHECKs de range em `km_per_liter`,
        `trailer_axles` e `diesel_price` via bloco `DO $...$`
        idempotente
    - `motoristas_km_per_liter_check`: NULL ou `[1.0, 10.0]`.
    - `motoristas_trailer_axles_check`: NULL ou `[2, 9]`.
    - `motoristas_diesel_price_check`: NULL ou `[1.00, 20.00]`.
    - Cada `ADD CONSTRAINT` é encapsulado em `IF NOT EXISTS` via
      consulta a `information_schema.constraint_column_usage`.
    - _Refs: Requirement 15.3, Design Section 4_

- [x] 3. Criar `src/utils/plateValidation.ts`
  - Criar arquivo novo com função pura `formatPlate(value: string):
    string` (uppercase, remove não-alfanuméricos, fatia em 7 chars).
  - Exportar `PLATE_REGEX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/`.
  - Exportar `isValidMercosulPlate(value: string): boolean` que
    aplica `PLATE_REGEX` sobre `formatPlate(value)`.
  - JSDoc curto em cada função com exemplos válidos/inválidos
    (`ABC1D23`, `ABC1234`, `ABCD123`, `AB12D34`).
  - _Refs: Requirement 3, Design Section 3 (Req 3), Design Section 6_

- [x] 4. Criar `src/utils/calculoFrete.ts`
  - Criar arquivo novo exportando:
    - `round2(n: number): number` — `Math.round(n * 100) / 100`.
    - `formatCurrencyBRL(n: number): string` via `Intl.NumberFormat`
      com `pt-BR` e `BRL`.
    - Tipos `CalculoFreteInput` (`distanceKm`, `kmPerLiter`,
      `dieselPrice`, `freteValue`) e `CalculoFreteOutput` (`litros`,
      `custoDiesel`, `pedagio: null`, `lucroLiquido`).
    - Função pura `calculateFreteFinanceiro(input)` retornando
      `litros` arredondado, `custoDiesel = round2(litros *
      dieselPrice)`, `pedagio: null`, `lucroLiquido = round2(freteValue
      − custoDiesel)`.
  - Sem dependências de React, Supabase ou DOM (puro).
  - _Refs: Requirement 12, Design Section 6_

- [x] 5. Estender `src/services/motorista.ts`
  - _Refs: Requirements 1, 5, 6, 9, 10, 11; Design Section 6_

  - [x] 5.1 Adicionar campos novos em `MotoristaProfile` e
        `UpdateMotoristaProfileData`
    - Acrescentar (todos opcionais): `vehicleYearManufacture?: number`,
      `vehicleYearModel?: number`, `kmPerLiter?: number`,
      `trailerAxles?: number`, `cargoCapacityTon?: number`,
      `dieselPrice?: number`, `isOwner?: boolean`.
    - Manter `vehicleYear?` legado intacto (não remover).
    - _Refs: Requirements 6.5, 10.5, 11.4, 15.1_

  - [x] 5.2 Estender `getMotoristaProfile` para mapear os novos
        campos do banco
    - Adicionar `vehicle_year_manufacture`, `vehicle_year_model`,
      `km_per_liter`, `trailer_axles`, `cargo_capacity_ton`,
      `diesel_price`, `is_owner` na projeção do `select` e no
      mapeamento snake→camel.
    - _Refs: Requirements 6.5, 10.5, 11.4_

  - [x] 5.3 Estender `updateMotoristaProfile` para escrever os novos
        campos e capitalizar `name`
    - Quando `data.name !== undefined`, gravar
      `users.name = capitalizeName(data.name)` (defesa em
      profundidade).
    - Acrescentar mapeamento camel→snake dos novos campos no
      `update` da tabela `motoristas`.
    - Não alterar a assinatura pública (parâmetros e retorno).
    - _Refs: Requirements 1.2, 5.5, 5.6, 6.5, 10.5, 11.4_

  - [x] 5.4 Adicionar nova função `updateDieselPrice(userId, price)`
    - Assinatura: `(userId: string, price: number) => Promise<void>`.
    - Faz `update motoristas set diesel_price = price where user_id =
      userId`.
    - Lança `Error` em falha; não captura silenciosamente.
    - _Refs: Requirements 11.4, 11.6_

  - [x] 5.5 Adicionar nova função `getMotoristaCalcContext(userId)`
    - Assinatura: `(userId: string) => Promise<MotoristaCalcContext>`
      onde `MotoristaCalcContext = { kmPerLiter: number | null;
      dieselPrice: number | null }`.
    - `select km_per_liter, diesel_price from motoristas where
      user_id = userId`.
    - _Refs: Requirements 11.5, 13.1, 13.2_

- [x] 6. Estender `src/services/documents.ts` (somente constante)
  - _Refs: Requirements 7.7, 15.2; Design Section 7_

  - [x] 6.1 Adicionar `'documento_proprietario'` em
        `VALID_DOCUMENT_TYPES`
    - Inserir o novo tipo na lista mantendo a ordem dos demais
      intacta.
    - Não alterar nenhuma assinatura: `uploadDocument`,
      `getSignedUrl`, `deleteDocument`, `validateDocumentType`,
      `resolveProfilePhotoUrl` permanecem bit a bit iguais.
    - _Refs: Requirement 7.7, Requirement 16.1_

- [x] 7. Criar `src/components/DieselDashboardInput.tsx`
  - Componente novo com props `userId`, `initialValue`, `onSaved`,
    `onError?`. Input numérico controlado, range visual `1.00`–`20.00`,
    `step="0.01"`.
  - _Refs: Requirement 11, Design Section 5_

  - [x] 7.1 Implementar hook `useDebouncedCallback` interno ao
        arquivo
    - Implementação local sem dependência externa, usando
      `setTimeout` + `clearTimeout` controlado por `useRef`.
    - Aceita `(fn, delay)` e devolve uma função debounced
      tipo-segura.
    - _Refs: Requirement 11.4, Design Section 3 (Req 11)_

  - [x] 7.2 Implementar token monotônico anti race-condition
    - Usar `lastReqRef = useRef(0)`.
    - Antes de cada request: `const myReq = ++lastReqRef.current`.
    - Após o `await`, descartar resposta se `myReq !==
      lastReqRef.current`.
    - _Refs: Requirement 11.5, Design Section 3 (Req 11)_

  - [x] 7.3 Implementar reversão visual em erro
    - Manter `lastSavedRef` com o último valor confirmado.
    - Em `catch`, fazer `setValue(lastSavedRef.current)` e chamar
      `onError?.("Não foi possível salvar o valor do diesel")`.
    - _Refs: Requirement 11.6_

  - [x] 7.4 Garantir cleanup do timer no unmount
    - `useEffect(() => () => clearTimeout(ref.current), [])` no
      hook debounced.
    - Evita disparar request após o componente sair da árvore.
    - _Refs: Design Section 9 (Riscos)_

- [x] 8. Estender `src/components/FreteCard.tsx` com prop opcional
      `motoristaCalc`
  - _Refs: Requirements 12, 13.1, 16.3; Design Section 7_

  - [x] 8.1 Definir tipo `MotoristaCalcContext`
    - Pode ser definido localmente no `FreteCard.tsx` ou importado
      de `src/services/motorista.ts` (preferir importar para evitar
      duplicação de tipo).
    - Forma: `{ kmPerLiter: number | null; dieselPrice: number |
      null }`.
    - _Refs: Design Section 6_

  - [x] 8.2 Adicionar prop `motoristaCalc?: MotoristaCalcContext` em
        `FreteCardProps`
    - Prop **opcional**. Demais props (`frete`, `onClick`,
      `hidePhone?`) permanecem intactas.
    - _Refs: Requirements 12.7, 16.3_

  - [x] 8.3 Renderizar bloco "Cálculo financeiro" condicional
    - Apenas se `motoristaCalc` está presente, `kmPerLiter` e
      `dieselPrice` estão preenchidos e `frete.distance_km` existe.
    - Linhas: "Distância", "Litros estimados", "Custo de diesel",
      "Pedágio (em breve)" exibido como `—`, "Valor do frete",
      "Lucro líquido (estimado) *" com nota "* sem pedágio".
    - Usar `formatCurrencyBRL` de `calculoFrete.ts`.
    - _Refs: Requirements 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 8.4 Renderizar aviso "Configure seu veículo para ver os
        cálculos"
    - Quando `motoristaCalc` está presente mas falta `kmPerLiter` ou
      `dieselPrice`, substituir o bloco de cálculo por link
      `<Link to="/perfil/motorista">`.
    - Quando `motoristaCalc` está presente mas frete não tem
      `distance_km`, exibir "Distância não disponível" sem travar o
      restante do card.
    - _Refs: Requirements 12.6, 13.1_

  - [x] 8.5 Garantir não-regressão sem a prop
    - Branch `if (!motoristaCalc) renderAtual()` no início do JSX
      (ou estrutura equivalente) para garantir output bit a bit
      idêntico ao baseline atual.
    - _Refs: Requirements 12.7, 16.3, 16.4_

- [x] 9. Refatorar `src/pages/MotoristaPerfilPage.tsx` em três
      seções
  - _Refs: Requirements 1–10, 16.1; Design Section 3_

  - [x] 9.1 Capitalização do nome (onBlur + dirty state)
    - Aplicar `capitalizeName` no handler `onBlur` do input "Nome".
    - Bloquear submit e exibir "Informe seu nome completo" quando
      vazio ou apenas espaços.
    - Ao carregar dados do servidor, exibir nome via
      `capitalizeName(serverValue)` mesmo se o banco contém
      caixa-alta.
    - _Refs: Requirements 1.1, 1.3, 1.4_

  - [x] 9.2 Botão "Verificar e-mail" + reuso do
        `ModalVerificacaoEmail`
    - Estado local `emailVerifiedAtServer` carregado no mount via
      `getVerificationStatus()`; `emailDirty` é `true` quando o
      input difere do valor verificado.
    - Botão chama `sendEmailVerificationCode(email)`; em sucesso,
      abre o modal já existente (sem alterá-lo).
    - Em `RATE_LIMITED`, bloquear botão por 60 s e mostrar mensagem
      pt-BR.
    - Bloquear submit quando `emailDirty && !emailVerifiedAtServer`.
    - Selo "E-mail verificado ✓" exibido quando o input casa com o
      valor verificado.
    - _Refs: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 9.3 Input de placa com `formatPlate` e erro inline
    - `onChange` aplica `setPlate(formatPlate(e.target.value))`.
    - `maxLength={7}`.
    - Se `!isValidMercosulPlate(plate)` no submit, exibir "Placa
      inválida. Formato esperado: ABC1D23" abaixo do campo e
      bloquear salvamento.
    - _Refs: Requirements 3.1, 3.2, 3.3, 3.4_

  - [x] 9.4 Reorganização visual em três seções (cards-stack)
    - Renderizar três `<section>` na ordem: "Dados Pessoais",
      "Veículo", "Proprietário".
    - Cada seção é um cartão independente com título e contador.
    - Estado de campos e documentos é preservado ao alternar entre
      seções (estado React único, sem rota/hash).
    - _Refs: Requirements 4.1, 4.2, 4.3, 4.6_

  - [x] 9.5 Toggle "O caminhão NÃO é meu" controlando Seção 3
    - Checkbox abaixo da seção "Veículo": `isNotOwner`.
    - Quando ON, renderiza Seção 3 com slots de
      `TiposDocumento_Proprietario`
      (`comprovante_endereco_proprietario`,
      `documento_proprietario`).
    - Quando OFF, oculta Seção 3 e não exige documentos dela.
    - Persistir `is_owner = !isNotOwner` em `motoristas.is_owner` no
      submit.
    - _Refs: Requirements 4.4, 4.5_

  - [x] 9.6 Select de modelo de caminhão com opção "Outro"
    - Definir constante `MODELOS_CAMINHAO` no topo do arquivo, na
      ordem exata do glossário (Volvo FH … MAN TGX, Outro).
    - Quando "Outro" é selecionado, exibir `<input maxLength={60}>`
      "Especifique o modelo".
    - Bloquear submit + mensagem "Informe o modelo do caminhão" se
      "Outro" ativo e campo livre vazio.
    - Persistir o rótulo exato (ou texto livre) em
      `motoristas.vehicle_model` (uma única coluna).
    - _Refs: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 9.7 Anos de fabricação e modelo separados, com validação
        cruzada
    - Dois `<input type="number" min={1980}>` distintos:
      "Ano de fabricação" (max=ano+1) e "Ano modelo" (max=ano+2).
    - Bloquear submit + mensagem "Ano modelo deve ser maior ou
      igual ao ano de fabricação" quando `anoModelo < anoFab`.
    - Submit grava em `vehicle_year_manufacture` e
      `vehicle_year_model`.
    - _Refs: Requirements 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 9.8 Inputs operacionais (km/l, eixos, capacidade, valor do
        diesel)
    - Quatro inputs numéricos: "Consumo (km/l do cavalo)",
      "Eixos da carreta", "Capacidade de carga (toneladas)",
      "Valor do diesel (R$/litro)".
    - Validar cada um nos ranges definidos no glossário; mensagem
      genérica "Valor fora do intervalo permitido" abaixo do campo.
    - Permitir salvar com os três primeiros vazios mas exibir aviso
      "Preencha consumo, eixos e capacidade para desbloquear
      cálculos no painel".
    - Persistir em `km_per_liter`, `trailer_axles`,
      `cargo_capacity_ton` e `diesel_price`.
    - _Refs: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7,
      11.1, 11.3, 11.4_

  - [x] 9.9 Inputs de câmera/arquivo nos slots de documento
    - Para cada slot, dois `<label>` controlando dois `<input
      type="file" hidden>`: um com `capture="environment"`, outro
      sem.
    - `accept="image/*"` em slots foto-only
      (`foto_segurando_cnh`, `foto_frente_caminhao`,
      `foto_caminhao_completo`).
    - `accept="image/*,application/pdf"` nos demais slots.
    - Validar local: `size > 5 MB` → "Arquivo muito grande. Máximo
      permitido: 5MB."; mime fora do `accept` do slot → "Tipo de
      arquivo não suportado neste slot". Em ambos os casos, NÃO
      chamar `uploadDocument`.
    - Comentário inline: "fallback: navegadores desktop ignoram
      `capture` e abrem o seletor de arquivos".
    - _Refs: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 9.10 Compactação visual (paddings, fontes, gaps)
    - Cartões `p-4` (em vez de `p-5`).
    - Form com `space-y-4` (em vez de `space-y-6`); seções internas
      com `space-y-3` (em vez de `space-y-4`).
    - Inputs e labels em `text-sm`; títulos de seção em `text-base`.
    - Container principal em `max-w-3xl` (sem alargar).
    - Grids de pares em `grid grid-cols-1 md:grid-cols-2 gap-3`.
    - Barra de progresso em `h-2`.
    - _Refs: Requirements 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 9.11 Campo PIS inline com aviso amarelo não-bloqueante
    - Renderizar como ÚLTIMO campo da seção "Dados Pessoais",
      imediatamente acima do botão "Salvar Alterações".
    - `onChange` aceita apenas dígitos e limita a 11 caracteres.
    - Se vazio no submit: aviso amarelo (`bg-yellow-50
      text-yellow-800`) "Transportadoras hoje em dia pedem muito o
      PIS, favor preencher" mas PERMITIR salvar.
    - Se comprimento ≠ 11 e ≠ 0: erro vermelho "PIS deve ter
      exatamente 11 dígitos" e BLOQUEAR salvar.
    - Se 11 dígitos: persistir em `motorista_pis.pis_number`
      (upsert).
    - _Refs: Requirements 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 9.12 Contador "X/Y documentos enviados" por seção
    - Computar contadores a partir de `documents` carregado e da
      lista de tipos de cada seção
      (`TiposDocumento_DadosPessoais`, `TiposDocumento_Veiculo`,
      `TiposDocumento_Proprietario`).
    - Exibir contador ao lado do título de cada seção.
    - Garantir que tipos de uma seção não influenciem o contador
      das demais.
    - _Refs: Requirement 4.7_

  - [x] 9.13 Submit com validação cruzada
    - Validar em ordem: nome não-vazio → e-mail verificado se dirty
      → placa Mercosul → ano modelo ≥ ano fab → PIS (vazio ou 11) →
      ranges (km/l, eixos, capacidade, diesel) → "Outro" preenchido
      se selecionado.
    - Em caso de erro, exibir alerta no topo (`role="alert"`) e
      mover foco para o primeiro campo inválido.
    - Persistir tudo em uma única chamada
      `updateMotoristaProfile(userId, data)` (mais o upsert de PIS).
    - _Refs: Requirements 1.4, 2.6, 3.3, 5.3, 6.4, 9.4, 10.6_

- [x] 10. Cabear `src/pages/HomePage.tsx` (somente ramo motorista)
  - _Refs: Requirements 11–13, 16.4; Design Section 3_

  - [x] 10.1 Carregar `getMotoristaCalcContext` no mount, somente se
        motorista
    - `useEffect(() => { if (user?.userType === 'motorista') { ... } }, [user])`.
    - Guardar resultado em estado local `motoristaCalc`.
    - Exibir loader/skeleton enquanto carrega para não piscar
      banner indevido.
    - _Refs: Requirements 11.7, 13.3_

  - [x] 10.2 Renderizar `DieselDashboardInput` no centro do header
    - Apenas quando `user?.userType === 'motorista'`.
    - Passar `userId`, `initialValue=motoristaCalc.dieselPrice`,
      `onSaved=(p) => setMotoristaCalc(prev => ({ ...prev,
      dieselPrice: p }))` e `onError=(msg) => mostrarToast(msg)`.
    - _Refs: Requirements 11.2, 11.7_

  - [x] 10.3 Banner amarelo quando dados de cálculo estão
        incompletos
    - Renderizar acima da grade quando `motoristaCalc` está
      carregado e `kmPerLiter` ou `dieselPrice` é nulo.
    - Mensagem: "Configure seu veículo para ver os cálculos." com
      link para `/perfil/motorista`.
    - _Refs: Requirements 13.1, 13.2_

  - [x] 10.4 Propagar `motoristaCalc` a cada `FreteCard`
    - Apenas no ramo motorista, passar prop opcional
      `motoristaCalc={motoristaCalc}` em cada `<FreteCard ... />`.
    - Não passar para visitante nem para embarcador (mantém render
      atual).
    - _Refs: Requirements 12.1, 12.7, 16.4_

  - [x] 10.5 Atualizar state local quando o diesel é alterado (sem
        reload)
    - O callback `onSaved` do `DieselDashboardInput` atualiza
      `motoristaCalc.dieselPrice` em estado local.
    - Sem refetch da lista de fretes — recálculo derivado das props.
    - Banner some automaticamente quando os dois valores ficam
      preenchidos.
    - _Refs: Requirements 11.5, 13.3_

- [-]* 11. Testes de propriedade (opcionais, mas recomendados)
  - Cada sub-task abaixo implementa uma das 8 propriedades da
    Seção 10 do design, com `vitest` + `fast-check` e mínimo
    `numRuns: 100`.
  - _Refs: Design Section 10, Design Section 12_

  - [x]* 11.1 `src/__tests__/plateValidation.property.test.ts`
    - **Property 1: Validação de placa Mercosul**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [x]* 11.2 `src/__tests__/calculoFrete.property.test.ts`
    - **Property 2: Cálculo financeiro do frete**
    - **Validates: Requirements 12.2, 12.3, 12.5**

  - [ ]* 11.3 `src/__tests__/freteCard.regression.test.tsx`
    - **Property 3: Não-regressão estrutural do FreteCard**
    - **Validates: Requirements 12.7, 16.3, 16.4**

  - [x]* 11.4 `src/__tests__/motoristaService.property.test.ts`
        (com mock do `supabase`)
    - **Property 5: Capitalização do nome na persistência**
    - **Validates: Requirements 1.2, 1.3**

  - [x]* 11.5 `src/__tests__/pisValidation.property.test.ts`
    - **Property 6: PIS — normalização e validação**
    - **Validates: Requirements 9.2, 9.3, 9.4**

  - [x]* 11.6 `src/__tests__/yearValidation.property.test.ts`
    - **Property 7: Validação de pares de anos**
    - **Validates: Requirements 6.2, 6.3, 6.4**

  - [x]* 11.7 `src/__tests__/sectionCounter.property.test.ts`
    - **Property 8: Contador de documentos por seção**
    - **Validates: Requirement 4.7**

  - [ ]* 11.8 Validação manual da Migration 017 em ambiente Supabase
        local
    - **Property 4: Migration 017 é não-destrutiva e idempotente**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 16.2**
    - Executar a migration duas vezes consecutivas em banco local
      com migrations 001–016 já aplicadas; comparar
      `information_schema.columns` e o conjunto de tipos válidos do
      CHECK antes/depois; validar que `embarcadores`, `fretes` e
      `users` permanecem bit a bit idênticos.

- [x] 12. Smoke tests manuais (caminho-feliz)
  - _Refs: Design Section 8 (smoke caminho-feliz)_

  - [x] 12.1 Aplicar Migration 017 no Supabase do ambiente
    - Rodar `017_motorista_painel_fields.sql`, confirmar sucesso e
      executar uma segunda vez para validar idempotência.

  - [x] 12.2 Login como motorista
    - Confirmar que `MotoristaPerfilPage` carrega sem erros e que o
      header da home renderiza o `DieselDashboardInput`.

  - [x] 12.3 Editar nome em CAIXA-ALTA → ao salvar, retorna
        capitalizado
    - _Refs: Requirement 1_

  - [x] 12.4 Mudar e-mail → "Verificar e-mail" → modal abre →
        confirmar código
    - _Refs: Requirement 2_

  - [x] 12.5 Digitar placa `abc1d23` → vira `ABC1D23` e salva
    - _Refs: Requirement 3_

  - [x] 12.6 Digitar placa `ABCD123` → erro inline, salvar
        bloqueado
    - _Refs: Requirement 3_

  - [x] 12.7 Marcar "O caminhão NÃO é meu" → seção "Proprietário"
        aparece
    - _Refs: Requirement 4_

  - [x] 12.8 Selecionar "Outro" no modelo → campo de texto livre
        aparece
    - _Refs: Requirement 5_

  - [x] 12.9 Ano modelo < ano fabricação → erro, bloqueia salvar
    - _Refs: Requirement 6_

  - [x] 12.10 Upload via "Abrir câmera" no celular → câmera traseira
        abre
    - _Refs: Requirement 7_

  - [x] 12.11 Upload via "Escolher arquivo" → seletor padrão abre
    - _Refs: Requirement 7_

  - [x] 12.12 PIS vazio → aviso amarelo, salvar OK
    - _Refs: Requirement 9_

  - [x] 12.13 PIS com 5 dígitos → erro vermelho, salvar bloqueado
    - _Refs: Requirement 9_

  - [x] 12.14 No dashboard, alterar diesel → recálculo nos cards em
        menos de 1 s
    - _Refs: Requirements 11, 12_

  - [x] 12.15 No dashboard com km/l vazio → banner amarelo + link
        nos cards
    - _Refs: Requirement 13_

- [x] 13. Smoke não-regressão do embarcador
  - _Refs: Requirement 16, Design Section 8 (não-regressão)_

  - [x] 13.1 Login como embarcador → home renderiza tabela/cards
        normalmente, sem bloco de cálculo financeiro

  - [x] 13.2 Cadastrar novo frete via `FreteForm` (arquivo não
        tocado)

  - [x] 13.3 Editar perfil em `EmbarcadorPerfilPage` (arquivo não
        tocado)

  - [x] 13.4 Upload de logo via `LogoUploadField` (arquivo não
        tocado)

  - [x] 13.5 Verificação de e-mail do embarcador (modal não tocado)

  - [x] 13.6 Visitante (deslogado) abrindo home → cards exibem
        "Login para ver" como hoje, sem cálculo financeiro

---

## Notas

- Tarefas marcadas com `*` são opcionais (testes); podem ser puladas
  numa execução de MVP, mas idealmente devem ser implementadas para
  garantir as 8 propriedades formais do design.
- Cada tarefa referencia explicitamente os requirements (granular)
  ou seções do design para rastreabilidade.
- A ordem de execução (1 → 13) é incremental: backlog/schema →
  utilidades puras → serviços → componente novo → componente
  estendido → páginas → testes → validação manual.
- Testes de propriedade ficam **próximos** das implementações que
  validam (utilidades puras e service de motorista) para apanhar
  regressões cedo.
- Esta workflow termina aqui. A implementação efetiva é executada
  abrindo este `tasks.md` e clicando em "Start task" ao lado de cada
  item.
