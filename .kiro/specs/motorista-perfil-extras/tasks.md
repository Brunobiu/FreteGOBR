# Plano de Implementação — Motorista Perfil Extras

## Visão Geral

Este plano traduz o design aprovado em uma sequência incremental
de tarefas de codificação. A ordem segue a estratégia
**"de dentro para fora"**: primeiro o schema (não-UI), depois
utilidades puras testáveis, depois services, depois a UI por
seção da página, e por fim os smoke tests.

Cada tarefa principal referencia explicitamente os requirements
e/ou seções do design que valida. Sub-tarefas marcadas com `*` são
opcionais (testes de propriedade) e podem ser puladas em uma
execução de MVP.

> Convert the feature design into a series of prompts for a
> code-generation LLM that will implement each step with incremental
> progress. Make sure that each prompt builds on the previous prompts,
> and ends with wiring things together. There should be no hanging or
> orphaned code that isn't integrated into a previous step. Focus
> ONLY on tasks that involve writing, modifying, or testing code.

---

## Tarefas

- [x] 1. Criar migration `018_motorista_perfil_extras.sql`
  - Criar arquivo
    `supabase/migrations/018_motorista_perfil_extras.sql` envelopado
    em `BEGIN; ... COMMIT;` com cabeçalho explicativo idêntico ao
    padrão da Migration 017.
  - _Refs: Requirement 10, Design Section 4_

  - [x] 1.1 Adicionar 12 novas colunas em `motoristas` com
        `ADD COLUMN IF NOT EXISTS`
    - `address_cep TEXT`
    - `address_street TEXT`
    - `address_number TEXT`
    - `address_complement TEXT`
    - `address_neighborhood TEXT`
    - `address_city TEXT`
    - `address_uf TEXT`
    - `rg_number TEXT`
    - `owner_cnpj TEXT`
    - `owner_company_name TEXT`
    - `owner_pis_number TEXT`
    - `owner_is_driver BOOLEAN DEFAULT FALSE`
    - _Refs: Requirements 10.1, 2.5, 4.8, 5.5, 6.6_

  - [x] 1.2 Adicionar CHECK idempotente
        `motoristas_address_uf_check`
    - Bloco `DO $...$` consultando
      `information_schema.constraint_column_usage` para evitar
      duplicação.
    - `CHECK (address_uf IS NULL OR address_uf ~ '^[A-Z]{2}$')`.
    - _Refs: Requirement 2.3_

  - [x] 1.3 Criar tabela `motorista_references`
        com `CREATE TABLE IF NOT EXISTS`
    - Colunas: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
      `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`,
      `company_name TEXT NOT NULL`, `phone TEXT NOT NULL`,
      `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
    - Criar índice `idx_motorista_references_user_id` com
      `CREATE INDEX IF NOT EXISTS`.
    - _Refs: Requirements 10.2, 10.3_

  - [x] 1.4 Habilitar RLS e políticas em `motorista_references`
    - `ALTER TABLE motorista_references ENABLE ROW LEVEL SECURITY`.
    - 3 políticas (`SELECT`, `INSERT`, `DELETE`), todas com
      `user_id = auth.uid()`. Usar `DROP POLICY IF EXISTS` antes de
      cada `CREATE POLICY`.
    - _Refs: Requirement 10.5_

  - [x] 1.5 Recriar CHECK de `documents.document_type` como
        superconjunto
    - `DROP CONSTRAINT IF EXISTS documents_document_type_check`.
    - `ADD CONSTRAINT` com 21 tipos: os 20 atuais (incluindo
      `'documento_proprietario'` da Migration 017) +
      `'contrato_arrendamento'`.
    - _Refs: Requirements 7.9, 10.4_

- [x] 2. Criar `src/utils/phoneFormat.ts`
  - Criar arquivo novo exportando funções puras
    `sanitizePhone(value: string): string` (digits-only) e
    `formatPhoneBR(value: string): string` (formata `(DD) NNNN-NNNN`
    para 10 dígitos e `(DD) N NNNN-NNNN` para 11 dígitos).
  - JSDoc curto com exemplos válidos para 10 e 11 dígitos.
  - Sem dependências de React, Supabase ou DOM (puro).
  - _Refs: Requirement 12.4, Design Section 6_

- [x] 3. Criar `src/services/cep.ts`
  - Criar arquivo novo seguindo o padrão de `src/services/cnpj.ts`.
  - _Refs: Requirement 1, Design Section 3 (Req 1), Design Section 6_

  - [x] 3.1 Helpers puros: `sanitizeCep`, `formatCep`,
        `isValidCepFormat`
    - `sanitizeCep` remove tudo que não for dígito.
    - `formatCep` aplica máscara `NNNNN-NNN` sobre os dígitos
      sanitizados (truncados em 8).
    - `isValidCepFormat` testa `/^[0-9]{8}$/` sobre
      `sanitizeCep(value)`.
    - _Refs: Requirement 1.8_

  - [x] 3.2 Tipo `CepData` e classe `CepLookupError`
    - `CepData`: `{ cep, logradouro, bairro, localidade, uf }`.
    - `CepLookupError` com codes `'NOT_FOUND' | 'INVALID' | 'NETWORK' | 'UNKNOWN'`.
    - _Refs: Requirement 1.5, 1.6_

  - [x] 3.3 Função `lookupCep(cep)` consumindo ViaCEP
    - Validar tamanho com `sanitizeCep` antes do `fetch`.
    - `fetch(`https://viacep.com.br/ws/${digits}/json/`)`.
    - Em rede falha → `CepLookupError('...', 'NETWORK')`.
    - Em `data.erro === true` → `CepLookupError('CEP não encontrado.', 'NOT_FOUND')`.
    - Mapear resposta JSON para `CepData`.
    - _Refs: Requirements 1.3, 1.4, 1.5, 1.6_

- [x] 4. Estender `src/services/documents.ts`
  - _Refs: Requirements 7.8, 11.3_

  - [x] 4.1 Adicionar `'contrato_arrendamento'` em
        `VALID_DOCUMENT_TYPES`
    - Inserir o novo tipo no fim da lista, mantendo ordem dos
      demais.
    - Não alterar nenhuma assinatura: `uploadDocument`,
      `getSignedUrl`, `deleteDocument`, `validateDocumentType`,
      `resolveProfilePhotoUrl` permanecem bit a bit iguais.
    - _Refs: Requirements 7.8, 11.3_

- [x] 5. Estender `src/services/motorista.ts`
  - _Refs: Requirements 2, 3, 4, 5, 6; Design Section 6_

  - [x] 5.1 Adicionar campos novos em `MotoristaProfile` e
        `UpdateMotoristaProfileData`
    - Acrescentar (todos opcionais): `addressCep?`, `addressStreet?`,
      `addressNumber?`, `addressComplement?`, `addressNeighborhood?`,
      `addressCity?`, `addressUf?`, `rgNumber?`, `ownerCnpj?`,
      `ownerCompanyName?`, `ownerPisNumber?`, `ownerIsDriver?: boolean`.
    - Não remover nem renomear nenhum campo existente.
    - _Refs: Requirements 2.5, 4.8, 5.5, 6.6_

  - [x] 5.2 Estender `getMotoristaProfile` para mapear novos campos
    - Adicionar `address_cep`, `address_street`, etc.,
      `rg_number`, `owner_cnpj`, `owner_company_name`,
      `owner_pis_number`, `owner_is_driver` no mapeamento
      snake→camel.
    - _Refs: Requirements 2.5, 4.8, 5.5, 6.6_

  - [x] 5.3 Estender `updateMotoristaProfile` para escrever os
        novos campos
    - Acrescentar mapeamento camel→snake dos novos campos no
      `update` da tabela `motoristas`.
    - Não alterar a assinatura pública (parâmetros e retorno).
    - _Refs: Requirements 2.5, 4.8, 5.5, 6.6_

  - [x] 5.4 Adicionar tipo `MotoristaReference` e função
        `getMotoristaReferences(userId)`
    - Tipo: `{ id, userId, companyName, phone, createdAt }`.
    - Função faz `select * from motorista_references where user_id =
      $1 order by created_at asc`.
    - Retorna `[]` se não houver linhas.
    - _Refs: Requirements 3.2, 3.13_

  - [x] 5.5 Adicionar função `replaceMotoristaReferences(userId,
        refs)`
    - Assinatura: `(userId: string, refs: { companyName: string;
      phone: string }[]) => Promise<void>`.
    - Passo 1: `delete from motorista_references where user_id =
      $1`.
    - Passo 2: filtrar `refs` removendo linhas com `companyName.trim()
      === ''`; aplicar `capitalizeName` em `companyName`.
    - Passo 3: se sobrou alguma linha, `insert` em
      `motorista_references` com `(user_id, company_name, phone)`.
    - Em qualquer falha, lançar `Error` com mensagem do supabase.
    - _Refs: Requirement 3.11_

- [ ] 6. Estender `src/pages/MotoristaPerfilPage.tsx`
  - _Refs: Requirements 1–9; Design Section 3_

  - [ ] 6.1 Carregar dados estendidos no mount
    - Estender o `loadAll` existente para também buscar
      `motorista_references` via `getMotoristaReferences(userId)`.
    - Hidratar estados novos a partir do `MotoristaProfile`
      retornado: endereço (7 campos), RG, owner_cnpj,
      owner_company_name, owner_pis, owner_is_driver.
    - _Refs: Requirements 2, 3.2, 4, 5, 6_

  - [ ] 6.2 Estado dirty isolado por seção
    - Adicionar state:
      `const [dirty, setDirty] = useState({ dadosPessoais: false,
      veiculo: false, proprietario: false, contrato: false })`.
    - Wrapper helper
      `markDirty(section: 'dadosPessoais'|'veiculo'|'proprietario'|'contrato')`
      a ser chamado em todos os `onChange` dos campos da seção.
    - Estado paralelo `saving` e `sectionFeedback` por seção.
    - _Refs: Requirements 8.3, 8.4, 8.5, 8.6, 8.7_

  - [ ] 6.3 Bloco "CEP + endereço" na seção "Dados Pessoais"
    - Adicionar campo "CEP" antes dos demais campos de endereço,
      com `formatCep` no display e `sanitizeCep` no estado interno
      (`addressCep` armazena dígitos).
    - `useEffect` que dispara `lookupCep` quando
      `sanitizeCep(addressCep).length === 8` E `addressCep !==
      lastQueriedCepRef.current`. Usar token monotônico para
      descartar respostas velhas.
    - Estado de loading (`cepLoading`), erro (`cepError`).
    - Em sucesso: preencher `addressStreet`, `addressNeighborhood`,
      `addressCity`, `addressUf`. **Não** sobrescrever `addressNumber`
      nem `addressComplement`.
    - Em `NOT_FOUND`: exibir "CEP não encontrado. Verifique o
      número digitado." inline.
    - Em `NETWORK`/`UNKNOWN`: "Não foi possível consultar o CEP
      agora. Tente novamente em alguns segundos."
    - Renderizar campos "Logradouro", "Número", "Complemento",
      "Bairro", "Cidade", "UF" em grid responsivo. UF
      `onChange` aplica `.toUpperCase()` e `slice(0, 2)`.
    - _Refs: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 2.2, 2.3, 2.4_

  - [ ] 6.4 Campo RG na seção "Dados Pessoais"
    - Texto livre, `maxLength={20}`, opcional. Renderizar acima do
      bloco de endereço.
    - _Refs: Requirement 2.1_

  - [ ] 6.5 Bloco "Referências profissionais"
    - Estado:
      `const [references, setReferences] = useState<MotoristaReferenceLocal[]>([])`.
    - Estado de erros por linha:
      `referenceErrors: Record<string, { name?: string; phone?: string }>`.
    - Renderizar cada linha com 2 inputs + botão 🗑.
    - Botão "+ Adicionar referência" no fim da lista (`min-h-[44px]`).
    - Em mobile: linhas viram cards verticais; botão remover
      absoluto no canto superior direito.
    - "Nome da empresa": `maxLength={80}`, `onBlur` aplica
      `capitalizeName`.
    - "Telefone": `onChange` aplica `formatPhoneBR`; estado
      armazena dígitos sanitizados.
    - Texto auxiliar "Nenhuma referência cadastrada ainda." quando
      a lista está vazia.
    - _Refs: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.13, 9.5, 12.1_

  - [ ] 6.6 Validação cruzada das referências no save
    - Para cada `r` em `references`:
      - Vazia (nome E telefone vazios) → ignorar.
      - Nome preenchido + telefone com `[10,11].includes(digits.length) === false` → erro "Telefone inválido (use 10 ou 11 dígitos)".
      - Telefone preenchido + nome vazio → erro "Informe o nome
        da empresa".
    - Bloquear save da seção "Dados Pessoais" se houver qualquer
      erro de referência.
    - _Refs: Requirements 3.9, 3.10_

  - [ ] 6.7 Botão "Salvar" da seção "Dados Pessoais"
    - Substitui o submit único atual para essa seção. Renderizar
      no rodapé do cartão "Dados Pessoais".
    - Validar APENAS campos da seção: nome (não vazio), e-mail
      (verificado se dirty), CPF, RG, endereço (qualquer
      combinação), PIS (vazio ou 11), referências (Req 6.6).
    - Em sucesso: chamar `updateMotoristaProfile(userId, dataDP)` +
      `replaceMotoristaReferences(userId, refs)` + upsert PIS;
      resetar `dirty.dadosPessoais = false`; mostrar "Seção salva."
      por 3s.
    - Em erro: feedback vermelho próximo ao botão; foco no primeiro
      campo inválido daquela seção.
    - `disabled` quando `!dirty.dadosPessoais` ou `saving.dadosPessoais`.
    - _Refs: Requirements 8.1, 8.2, 8.3, 8.4, 8.8, 8.9, 8.10_

  - [ ] 6.8 Botão "Salvar" da seção "Veículo"
    - Renderizar no rodapé do cartão "Veículo".
    - Validar APENAS campos da seção: placa Mercosul, modelo "Outro"
      preenchido, ano fab/modelo cruzado, ranges (km/l, eixos,
      capacidade, diesel) — todas as validações da spec anterior.
    - Em sucesso: `updateMotoristaProfile(userId, dataVeiculo)` +
      reset dirty + feedback verde.
    - Em erro: feedback inline; foco no primeiro campo inválido.
    - `disabled` quando `!dirty.veiculo` ou `saving.veiculo`.
    - _Refs: Requirements 8.1, 8.2, 8.3, 8.5, 8.8, 8.9, 8.10_

  - [ ] 6.9 Refator da seção "Proprietário": campos novos
    - Adicionar acima dos slots de documento existentes:
      - "Nome do proprietário" (texto, `onBlur` capitalizeName).
      - "CPF do proprietário" (texto, opcional).
      - "RG do proprietário" (texto, `maxLength={20}`, opcional).
      - "PIS do proprietário" (igual à validação do PIS do
        motorista).
      - "Telefone do proprietário" (`formatPhoneBR`).
      - "CNPJ do proprietário" + "Nome da empresa (preenchido pela
        Receita)".
      - Endereço completo (CEP + logradouro + número + complemento
        + bairro + cidade + UF) — pode reutilizar lookupCep do
        mesmo CepService.
    - State: novas variáveis `owner*` espelhando os campos.
    - _Refs: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2_

  - [ ] 6.10 Lookup automático de CNPJ na seção Proprietário
    - `useEffect` que dispara `lookupCnpj` quando
      `sanitizeCnpj(ownerCnpj).length === 14` E difere do último
      consultado. Token monotônico anti-race.
    - Em sucesso: `setOwnerCompanyName(data.razaoSocial ||
      data.nomeFantasia || '')`. Campo "Nome da empresa" sempre
      `disabled`.
    - Em `NOT_FOUND`: "CNPJ não encontrado." sem alterar nome.
    - Em `NETWORK`/`UNKNOWN`: mensagem genérica.
    - _Refs: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ] 6.11 Botão "Sou eu o proprietário"
    - Renderizar no topo da seção "Proprietário", visível apenas se
      `isNotOwner === true`.
    - Handler copia campos do motorista para campos do proprietário
      (`CamposCopia_SouEuOProprietario`) e marca
      `setOwnerIsDriver(true)` + `markDirty('proprietario')`.
    - Não desativar `isNotOwner`. Manter campos editáveis após
      cópia.
    - Idempotência garantida pela natureza da cópia.
    - `min-h-[44px]`.
    - _Refs: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 9.3_

  - [ ] 6.12 Botão "Salvar" da seção "Proprietário"
    - Renderizar no rodapé do cartão.
    - Validar APENAS campos da seção: PIS proprietário (vazio ok,
      ≠11 bloqueia), CNPJ (qualquer combinação aceita).
    - Em sucesso: `updateMotoristaProfile(userId, dataProp)` (com
      `ownerCnpj`, `ownerCompanyName`, `ownerPisNumber`,
      `ownerIsDriver`, `ownerName`, `ownerCpf`, `ownerRg`, telefone,
      endereço completo) + reset dirty + feedback verde.
    - `disabled` quando `!dirty.proprietario` ou `saving.proprietario`.
    - _Refs: Requirements 4.8, 4.9, 5.3, 5.4, 5.5, 6.6, 8.1, 8.2, 8.6, 8.8, 8.9_

  - [ ] 6.13 Nova seção "Contrato de Arrendamento" (4ª seção)
    - Renderizar abaixo da seção "Proprietário", apenas se
      `isNotOwner === true`.
    - Cartão padrão `bg-white border border-gray-200 rounded-lg p-4`.
    - Título `<h2>Contrato de Arrendamento</h2>` + contador "X/1
      documento" (1 se `documents.contrato_arrendamento` existe, 0
      caso contrário).
    - Único `DocSlot` com `type: 'contrato_arrendamento'`,
      `label: 'Contrato de arrendamento (PDF)'`,
      `accept: 'application/pdf'`.
    - _Refs: Requirements 7.1, 7.2, 7.3, 7.4_

  - [ ] 6.14 Pequeno ajuste em `DocSlot` para slots PDF-only
    - Quando `slot.accept === 'application/pdf'`, **não** renderizar
      o botão "📷 Câmera" (esconder o `cameraRef` input + button).
    - Não criar componente novo — só um if no JSX existente.
    - Não afetar slots existentes (image/* ou image/*+pdf
      continuam com câmera).
    - _Refs: Requirement 7.4_

  - [ ] 6.15 Validação extra no upload de contrato
    - No handler `handleDocUpload`, antes do `uploadDocument`:
      - Se `docType === 'contrato_arrendamento'` E
        `file.type !== 'application/pdf'` → "Apenas arquivos PDF
        são aceitos para o contrato de arrendamento."; abort.
    - O check existente de tamanho > 5 MB já cobre o size limit.
    - _Refs: Requirements 7.5, 7.6, 7.7_

  - [ ] 6.16 Botão "Salvar" da seção "Contrato de Arrendamento"
    - Renderizar no rodapé do cartão. Como o upload já persiste no
      momento, o botão apenas: reseta `dirty.contrato = false` e
      mostra feedback "Seção salva.".
    - `disabled` quando `!dirty.contrato`.
    - _Refs: Requirements 8.1, 8.2, 8.7_

  - [ ] 6.17 Remover o botão "Salvar Alterações" único antigo
    - Remover o `<button type="submit">Salvar Alterações</button>`
      no fim do `<form>`.
    - Trocar `<form onSubmit={handleSave}>` por
      `<form onSubmit={(e) => e.preventDefault()}>` para evitar
      submit acidental por Enter.
    - Remover o handler `handleSave` único (substituído pelos 4
      handlers por seção).
    - _Refs: Requirement 8.2_

  - [ ] 6.18 Classes de responsividade mobile nos componentes novos
    - Inputs novos: `text-base sm:text-sm`.
    - Botões novos: `min-h-[44px]`.
    - Grid de endereço: `grid grid-cols-1 sm:grid-cols-2 gap-3`.
    - Lista de referências: ver task 6.5 — cards no mobile, linha
      no desktop.
    - Garantir que cartões usem `p-3 sm:p-4` quando os existentes
      ainda forem `p-4` (preservar desktop, melhorar mobile).
    - Conferir DevTools 375 px sem overflow horizontal.
    - _Refs: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ]* 7. Testes de propriedade (opcionais, mas recomendados)
  - _Refs: Design Section 8 (PBT)_

  - [x]* 7.1 `src/__tests__/phoneFormat.property.test.ts`
    - **Property: idempotência de `sanitizePhone`** —
      `sanitizePhone(sanitizePhone(s)) === sanitizePhone(s)`.
    - **Property: formatador preserva dígitos** —
      `sanitizePhone(formatPhoneBR(s)) === sanitizePhone(s).slice(0, 11)`.
    - **Validates: Requirement 12.4**

  - [x]* 7.2 `src/__tests__/cep.property.test.ts`
    - **Property: idempotência de `sanitizeCep`**.
    - **Property: round-trip** —
      `sanitizeCep(formatCep(d)) === d` para `d` ∈ strings de 0–8
      dígitos.
    - **Property: limite de tamanho** — após `formatCep`,
      `sanitizeCep(out).length <= 8`.
    - **Property: `isValidCepFormat(s) ⇔ sanitizeCep(s).length === 8`**.
    - **Validates: Requirements 1.2, 1.8**

  - [ ]* 7.3 `src/__tests__/souEuProprietario.property.test.ts`
    - **Property: idempotência da cópia** — clicar duas vezes
      consecutivas produz o mesmo estado de proprietário.
    - **Property: cópia exata** — após clique, todos os campos
      `CamposCopia_SouEuOProprietario` no estado de proprietário
      são `===` aos campos do motorista.
    - Implementar com modelo puro (sem React) chamando uma função
      pura `copyDriverToOwner(driverState, ownerState)` extraída do
      handler do botão. Se o handler ficou inline na página, esta
      task pode ser pulada.
    - **Validates: Requirements 6.2, 6.7**

- [ ] 8. Smoke tests manuais (caminho-feliz)
  - _Refs: Design Section 8 (smoke caminho-feliz)_

  - [ ] 8.1 Aplicar Migration 018 no Supabase do ambiente
    - Rodar `018_motorista_perfil_extras.sql`, confirmar sucesso e
      executar uma segunda vez para validar idempotência.

  - [ ] 8.2 CEP `01310-100` em "Dados Pessoais" preenche endereço
    - Av. Paulista / Bela Vista / São Paulo / SP. "Número" e
      "Complemento" continuam vazios.
    - _Refs: Requirements 1.3, 1.4_

  - [ ] 8.3 CEP `00000-000` mostra "CEP não encontrado."
    - _Refs: Requirement 1.5_

  - [ ] 8.4 Salvar "Dados Pessoais" com endereço + RG
    - Recarregar página e conferir persistência das colunas
      novas em `motoristas`.
    - _Refs: Requirements 2.1, 2.5_

  - [ ] 8.5 Adicionar 2 referências, validar erros, salvar
    - Linha 1: nome só → bloqueia com "Telefone inválido…".
    - Linha 2: telefone só → bloqueia com "Informe o nome…".
    - Preencher ambas, salvar, conferir
      `select * from motorista_references where user_id = $1`
      retorna exatamente 2 linhas.
    - Remover uma, salvar, conferir 1 linha.
    - _Refs: Requirements 3.4, 3.5, 3.9, 3.10, 3.11_

  - [ ] 8.6 Marcar "O caminhão NÃO é meu" → seções 3 e 4 aparecem
    - "Proprietário" e "Contrato de Arrendamento" expandem como
      cartões separados.
    - _Refs: Requirements 7.1, 7.2_

  - [ ] 8.7 CNPJ `11222333000181` (CNPJ válido qualquer) preenche
        "Nome da empresa" disabled
    - _Refs: Requirements 4.2, 4.3, 4.4, 4.5_

  - [ ] 8.8 Botão "Sou eu o proprietário" copia todos os campos
    - Conferir que cada campo do proprietário ficou idêntico ao do
      motorista; `owner_is_driver` no banco fica `TRUE` após save.
    - _Refs: Requirements 6.1, 6.2, 6.3, 6.6_

  - [ ] 8.9 Upload de contrato em formato errado bloqueia
    - JPG: "Apenas arquivos PDF…".
    - PDF de 10 MB: "Arquivo muito grande…".
    - PDF válido < 5 MB: aceita com `status='pendente'`.
    - _Refs: Requirements 7.4, 7.5, 7.6, 7.7_

  - [ ] 8.10 Salvar isolado por seção
    - Placa inválida na seção "Veículo" não bloqueia "Salvar" da
      seção "Dados Pessoais", e vice-versa.
    - Cada botão tem feedback verde/vermelho próprio.
    - _Refs: Requirements 8.4, 8.5, 8.6, 8.8, 8.9_

  - [ ] 8.11 Mobile DevTools 375 px
    - Inputs sem zoom no foco do iOS (text-base = 16 px).
    - Botões com altura ≥ 44 px.
    - Sem overflow horizontal.
    - Lista de referências em cards verticais com 🗑 visível.
    - _Refs: Requirements 9.1, 9.2, 9.3, 9.5, 9.6_

- [ ] 9. Smoke não-regressão do embarcador e da spec anterior
  - _Refs: Requirement 11_

  - [ ] 9.1 Login como embarcador → home renderiza normalmente
    - Sem cálculo financeiro, mesmo layout de antes.

  - [ ] 9.2 Cadastrar novo frete via `FreteForm` (não tocado)

  - [ ] 9.3 Editar perfil em `EmbarcadorPerfilPage` (não tocado)

  - [ ] 9.4 Upload de logo via `LogoUploadField` (não tocado)

  - [ ] 9.5 Verificação de e-mail do embarcador (modal não tocado)

  - [ ] 9.6 Login como motorista, fluxos da spec anterior intactos
    - Capitalização de nome, verificação de e-mail OTP, placa
      Mercosul, modelo "Outro", ano fab/modelo cruzado, upload de
      câmera, PIS amarelo/vermelho, contador de docs por seção,
      diesel debounced no dashboard, banner amarelo quando km/l
      ou diesel faltam — TODOS continuam funcionando.

  - [ ] 9.7 `npm test` passa sem novos failing
    - Suite completa (`auth`, `inputValidator`, `passwordHash`,
      `passwordValidation`, `pisValidation`, `plateValidation`,
      `tripSuggestion`, `yearValidation`, `sectionCounter`,
      `calculoFrete`, `freteFilters`, `geolocation`,
      `fileValidation`, `textCase`, `security/*`) verde.

---

## Notas

- Tarefas marcadas com `*` são opcionais (testes de propriedade);
  podem ser puladas em uma execução de MVP, mas idealmente devem
  ser implementadas para garantir as 3 propriedades formais do
  design.
- Cada tarefa referencia explicitamente os requirements (granular)
  ou seções do design para rastreabilidade.
- A ordem de execução (1 → 9) é incremental: schema → utils puros
  → services → UI por seção → testes → validação manual.
- Testes de propriedade ficam **próximos** das implementações que
  validam (utilidades puras `phoneFormat` e `cep`).
- A implementação efetiva é executada abrindo este `tasks.md` e
  clicando em "Start task" ao lado de cada item.
