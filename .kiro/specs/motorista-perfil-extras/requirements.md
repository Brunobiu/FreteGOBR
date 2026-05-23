# Requirements Document — Motorista Perfil Extras

## Introdução

Esta feature **estende** o perfil do motorista (`MotoristaPerfilPage`)
implementado pela spec anterior `motorista-onboarding-painel`. A
página já está dividida em três seções ("Dados Pessoais", "Veículo",
"Proprietário"); esta entrega acrescenta nelas funcionalidades
complementares de cadastro, busca de dados externos (ViaCEP e
BrasilAPI), upload de contrato e mudança de UX para salvar por
seção.

A entrega cobre oito frentes:

1. **Endereço com lookup automático de CEP** (ViaCEP) na seção
   "Dados Pessoais" e também na seção "Proprietário" quando aplicável.
2. **Campos faltantes em "Dados Pessoais"** — RG e endereço completo.
3. **Referências profissionais** — lista dinâmica em "Dados
   Pessoais", abaixo do PIS, persistida em nova tabela
   `motorista_references`.
4. **CNPJ + nome da empresa proprietária** com lookup BrasilAPI,
   reusando o serviço `cnpj.ts` que já atende o embarcador.
5. **PIS na seção Proprietário** (quando `isNotOwner === true`),
   reusando a mesma função pura de validação do PIS do motorista.
6. **Botão "Sou eu o proprietário"** que copia os dados do motorista
   para os campos do proprietário, mantendo-os editáveis.
7. **Seção "Contrato de Arrendamento"** — quarta seção que aparece
   apenas quando `isNotOwner === true`, com upload PDF-only.
8. **Salvar por seção** — cada um dos 4 cartões passa a ter seu
   próprio botão "Salvar" com estado dirty isolado.

Tudo deve funcionar bem em telas mobile (375px) e **NÃO** pode
quebrar nenhum fluxo do embarcador (logo, perfil, verificação de
e-mail, criação de frete) nem regredir nenhum requirement da spec
anterior.

## Glossário

### Sistemas, componentes e arquivos

- **MotoristaPerfilPage**: página `src/pages/MotoristaPerfilPage.tsx`
  estendida por esta feature. Único ponto de edição do perfil do
  motorista.
- **MotoristaService**: módulo `src/services/motorista.ts`. Esta
  feature **estende** seus tipos e funções de update sem alterar
  assinaturas públicas existentes.
- **DocumentsService**: módulo `src/services/documents.ts`. Recebe
  apenas a adição de `'contrato_arrendamento'` em
  `VALID_DOCUMENT_TYPES` (igual ao que a spec anterior fez com
  `'documento_proprietario'`).
- **CepService**: NOVO módulo `src/services/cep.ts`. Faz lookup HTTP
  ao ViaCEP e expõe helpers puros de sanitização/formatação de CEP.
- **CnpjService**: módulo existente `src/services/cnpj.ts`. REUSADO
  pelo motorista sem alteração; o mesmo serviço já é consumido pelo
  embarcador.
- **PhoneFormat**: NOVO módulo `src/utils/phoneFormat.ts` (criado se
  ainda não existir um equivalente público — hoje
  `EmbarcadorPerfilPage.tsx` tem uma cópia local de
  `formatPhoneDisplay` mas ela não é exportada). Funções puras
  `sanitizePhone` e `formatPhoneBR`.
- **CapitalizeName**: função `capitalizeName` em
  `src/utils/textCase.ts`. REUSADA em campos de nome novos
  (referência profissional → nome da empresa quando preenchido por
  digitação livre; e nos campos de "Sou eu o proprietário").
- **PisValidator**: validação de PIS já implementada na spec anterior
  (testes em `src/__tests__/pisValidation.property.test.ts`).
  REUSADA na seção Proprietário.
- **MotoristaReferencesTable**: NOVA tabela
  `motorista_references(id UUID PK, user_id UUID FK → users.id,
  company_name TEXT, phone TEXT, created_at TIMESTAMPTZ DEFAULT now())`.
- **MotoristaAddressColumns**: novas colunas em `motoristas`:
  `address_cep`, `address_street`, `address_number`,
  `address_complement`, `address_neighborhood`, `address_city`,
  `address_uf`, `rg_number`, `owner_cnpj`, `owner_company_name`,
  `owner_pis_number`, `owner_is_driver` (todas `TEXT` ou `BOOLEAN`,
  todas anuláveis exceto `owner_is_driver` que tem `DEFAULT FALSE`).
- **Migration018**: NOVO arquivo
  `supabase/migrations/018_motorista_perfil_extras.sql`, idempotente.
- **ContratoArrendamentoSection**: nova quarta seção (cartão)
  renderizada na `MotoristaPerfilPage` apenas quando
  `isNotOwner === true`. Hospeda um único slot
  `'contrato_arrendamento'`.
- **SecaoSalvarButton**: novo padrão em cada seção — um botão
  "Salvar" próprio que persiste apenas os campos daquela seção.

### Constantes e formatos

- **CEP_DigitsLength**: exatamente 8 dígitos.
- **CEP_Regex**: `^[0-9]{8}$` aplicado sobre os dígitos sanitizados.
- **CEP_DisplayFormat**: `NNNNN-NNN`.
- **ViaCEP_BaseUrl**: `https://viacep.com.br/ws/{cep}/json/`. Em
  CEP inexistente retorna JSON `{ "erro": true }` (HTTP 200).
- **BrasilAPI_CnpjBaseUrl**: já usado por `cnpj.ts`,
  `https://brasilapi.com.br/api/cnpj/v1`.
- **CompanyName_MaxLength**: 80 caracteres.
- **Phone_BR_DigitsLength**: 10 ou 11 dígitos (10 = fixo, 11 = celular).
- **MaxFileSize_Contrato**: 5 MB (5 × 1024 × 1024 bytes).
- **PIS_Length**: exatamente 11 dígitos quando preenchido (mesma
  regra da spec anterior).
- **MobileBreakpoint**: 375 px de viewport.
- **TouchMinTarget**: 44 px (`min-h-[44px]`) para botões em mobile.

### Tipos e listas pré-definidas

- **DocumentTypes_AdicionadosNestaFeature**:
  - `'contrato_arrendamento'` — novo tipo. Aceito apenas como
    `application/pdf`. Acrescentado a `VALID_DOCUMENT_TYPES` em
    `documents.ts` e ao CHECK constraint em
    `documents.document_type`.

- **TiposDocumento_ContratoArrendamento** (Seção 4 — visível apenas
  se `isNotOwner === true`):
  - `contrato_arrendamento` (1 slot, PDF-only).

- **EnderecoCampos_DadosPessoais**: `address_cep`,
  `address_street` (logradouro), `address_number`,
  `address_complement`, `address_neighborhood`, `address_city`,
  `address_uf`. Após lookup do ViaCEP: `address_street`,
  `address_neighborhood`, `address_city`, `address_uf` ficam
  preenchidos automaticamente; `address_number` e
  `address_complement` são SEMPRE digitados manualmente pelo
  motorista.

- **CamposCopia_SouEuOProprietario**: ao clicar no botão, o sistema
  copia o conteúdo dos seguintes campos do motorista para os campos
  homônimos do proprietário (mantendo-os editáveis):
  - Nome do proprietário ← `name`
  - CPF ← `cpf`
  - RG ← `rg_number`
  - PIS ← motorista PIS
  - Endereço completo (CEP + logradouro + número + complemento +
    bairro + cidade + UF)
  - Telefone (do motorista, do cadastro)

  E grava `owner_is_driver = TRUE` em `motoristas`.

- **SecoesSalvar**: as quatro seções com botão "Salvar" próprio são:
  `dados_pessoais`, `veiculo`, `proprietario`, `contrato_arrendamento`.

## Requirements

### Requirement 1 — Endereço com lookup automático via ViaCEP

**User Story:** Como motorista, quero digitar meu CEP e ver os
campos de endereço preenchidos automaticamente, para não precisar
digitar logradouro, bairro, cidade e UF manualmente.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar na seção "Dados Pessoais"
   o campo "CEP" antes dos demais campos de endereço.
2. WHEN o motorista digita no campo "CEP",
   THE MotoristaPerfilPage SHALL aceitar apenas dígitos e limitar o
   valor a `CEP_DigitsLength` caracteres, exibindo no input a
   máscara `CEP_DisplayFormat`.
3. WHEN o campo "CEP" atinge `CEP_DigitsLength` dígitos,
   THE MotoristaPerfilPage SHALL chamar `lookupCep(cep)` do
   `CepService` exatamente uma vez para esse valor.
4. WHEN o `CepService` retorna sucesso,
   THE MotoristaPerfilPage SHALL preencher os campos
   `address_street`, `address_neighborhood`, `address_city` e
   `address_uf` com os valores retornados, mantendo
   `address_number` e `address_complement` no estado anterior.
5. IF o `CepService` retorna `{ erro: true }` (CEP inexistente),
   THEN THE MotoristaPerfilPage SHALL exibir abaixo do campo "CEP" a
   mensagem "CEP não encontrado. Verifique o número digitado." e
   manter os demais campos de endereço com seu estado anterior.
6. IF o `CepService` lança erro de rede,
   THEN THE MotoristaPerfilPage SHALL exibir "Não foi possível
   consultar o CEP agora. Tente novamente em alguns segundos." e
   permitir nova tentativa pelo próprio campo (re-disparo automático
   ao alterar o CEP).
7. THE MotoristaPerfilPage SHALL exibir um indicador visual
   "Buscando endereço..." enquanto a chamada ao `CepService` está em
   andamento.
8. THE CepService SHALL expor a função pura
   `sanitizeCep(value: string): string` que remove tudo que não for
   dígito, e a função pura
   `formatCep(value: string): string` que aplica `CEP_DisplayFormat`
   sobre os dígitos sanitizados.
9. WHERE o motorista limpa o campo "CEP",
   THE MotoristaPerfilPage SHALL NÃO disparar nova chamada ao
   `CepService` enquanto o valor não atingir novamente
   `CEP_DigitsLength` dígitos.

### Requirement 2 — Campos de identificação adicionais (RG + endereço)

**User Story:** Como motorista, quero registrar meu RG e meu
endereço completo no perfil para que transportadoras vejam essas
informações.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar na seção "Dados Pessoais"
   um campo "RG" do tipo texto livre, opcional, com no máximo 20
   caracteres.
2. THE MotoristaPerfilPage SHALL renderizar na seção "Dados Pessoais",
   abaixo do CEP, os campos: "Logradouro", "Número",
   "Complemento" (opcional), "Bairro", "Cidade", "UF".
3. THE MotoristaPerfilPage SHALL aceitar em "UF" exatamente 2 letras
   maiúsculas e converter automaticamente para maiúsculas conforme o
   motorista digita.
4. WHEN o motorista digita em "Número",
   THE MotoristaPerfilPage SHALL aceitar caracteres alfanuméricos
   (incluindo `S/N`, `KM 12`) com no máximo 10 caracteres.
5. WHEN o motorista clica em "Salvar" da seção "Dados Pessoais"
   contendo qualquer um dos campos de
   `EnderecoCampos_DadosPessoais` ou `rg_number` preenchido,
   THE MotoristaService SHALL persistir os valores nas colunas
   correspondentes em `motoristas`.
6. THE MotoristaPerfilPage SHALL permitir salvar a seção "Dados
   Pessoais" com qualquer combinação de campos de endereço vazia ou
   preenchida (todos os campos de endereço são opcionais).

### Requirement 3 — Referências profissionais (lista dinâmica)

**User Story:** Como motorista, quero cadastrar transportadoras com
quem já trabalhei e seus telefones, para que possíveis novos
contratantes possam pedir referências.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar na seção "Dados Pessoais"
   um bloco "Referências profissionais" imediatamente abaixo do
   campo PIS.
2. THE MotoristaPerfilPage SHALL renderizar a lista de referências
   inicialmente vazia para motoristas sem registros em
   `motorista_references`.
3. THE MotoristaPerfilPage SHALL renderizar, abaixo da lista, um
   botão "+ Adicionar referência" que adiciona uma nova linha vazia
   à lista local.
4. THE MotoristaPerfilPage SHALL renderizar em cada linha de
   referência: um campo "Nome da empresa" (texto, máximo
   `CompanyName_MaxLength` caracteres), um campo "Telefone" (texto
   formatado em padrão BR) e um botão "🗑 remover".
5. WHEN o motorista clica em "🗑 remover" em uma linha,
   THE MotoristaPerfilPage SHALL remover essa linha da lista local
   sem confirmação adicional.
6. WHEN o motorista digita em "Nome da empresa",
   THE MotoristaPerfilPage SHALL limitar o valor a
   `CompanyName_MaxLength` caracteres.
7. WHEN o motorista perde o foco do campo "Nome da empresa",
   THE MotoristaPerfilPage SHALL aplicar `capitalizeName` ao valor.
8. WHEN o motorista digita em "Telefone",
   THE MotoristaPerfilPage SHALL formatar usando `formatPhoneBR` do
   `PhoneFormat` e limitar a `Phone_BR_DigitsLength` dígitos.
9. IF uma linha de referência possui "Nome da empresa" preenchido
   mas "Telefone" com menos de 10 dígitos OU mais de 11 dígitos,
   THEN THE MotoristaPerfilPage SHALL exibir
   "Telefone inválido (use 10 ou 11 dígitos)" abaixo do campo e
   bloquear o salvamento da seção "Dados Pessoais".
10. IF uma linha de referência possui "Telefone" preenchido mas
    "Nome da empresa" vazio,
    THEN THE MotoristaPerfilPage SHALL exibir
    "Informe o nome da empresa" abaixo do campo e bloquear o
    salvamento da seção "Dados Pessoais".
11. WHEN o motorista salva a seção "Dados Pessoais",
    THE MotoristaService SHALL persistir as referências executando
    `DELETE FROM motorista_references WHERE user_id = $1` seguido de
    `INSERT` das linhas atuais (replace-all atômico em uma RPC ou
    transação).
12. THE MotoristaPerfilPage SHALL permitir salvar a seção "Dados
    Pessoais" com a lista de referências completamente vazia (todas
    as referências são opcionais).
13. WHERE a lista carregada do servidor está vazia,
    THE MotoristaPerfilPage SHALL exibir o texto auxiliar
    "Nenhuma referência cadastrada ainda." acima do botão
    "+ Adicionar referência".

### Requirement 4 — CNPJ e nome da empresa proprietária (BrasilAPI)

**User Story:** Como motorista que dirige caminhão de outra empresa,
quero digitar o CNPJ do proprietário e ver o nome da empresa
preenchido automaticamente.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar na seção "Proprietário"
   o campo "CNPJ do proprietário".
2. WHEN o motorista digita no campo "CNPJ do proprietário",
   THE MotoristaPerfilPage SHALL aplicar `formatCnpj` do
   `CnpjService` em tempo real e limitar a 14 dígitos sanitizados.
3. WHEN o campo "CNPJ do proprietário" atinge 14 dígitos
   sanitizados, THE MotoristaPerfilPage SHALL chamar `lookupCnpj`
   do `CnpjService` exatamente uma vez para esse valor.
4. WHEN o `CnpjService` retorna sucesso,
   THE MotoristaPerfilPage SHALL preencher o campo "Nome da empresa"
   com `data.razaoSocial` (ou `data.nomeFantasia` quando razão
   social está vazia).
5. THE MotoristaPerfilPage SHALL renderizar o campo "Nome da
   empresa" sempre como `disabled` (somente leitura), com
   estilo visual indicando que não é editável.
6. IF o `CnpjService` lança `CnpjLookupError` com código
   `'NOT_FOUND'`,
   THEN THE MotoristaPerfilPage SHALL exibir abaixo do campo "CNPJ
   do proprietário" a mensagem "CNPJ não encontrado." e manter o
   campo "Nome da empresa" com seu valor anterior.
7. IF o `CnpjService` lança `CnpjLookupError` com código
   `'NETWORK'` ou `'UNKNOWN'`,
   THEN THE MotoristaPerfilPage SHALL exibir "Não foi possível
   consultar o CNPJ agora. Tente novamente." sem alterar o nome.
8. WHEN o motorista salva a seção "Proprietário",
   THE MotoristaService SHALL persistir o CNPJ sanitizado em
   `motoristas.owner_cnpj` e o nome retornado em
   `motoristas.owner_company_name`.
9. WHERE o motorista deixa o campo "CNPJ do proprietário" vazio,
   THE MotoristaPerfilPage SHALL permitir salvar a seção
   "Proprietário" e gravar `NULL` em `owner_cnpj` e
   `owner_company_name`.

### Requirement 5 — PIS na seção Proprietário

**User Story:** Como motorista que dirige caminhão de outra empresa,
quero também registrar o PIS do proprietário com a mesma validação
do meu PIS.

#### Acceptance Criteria

1. WHERE `isNotOwner === true`,
   THE MotoristaPerfilPage SHALL renderizar na seção "Proprietário"
   um campo "PIS do proprietário" com a mesma máscara e validação do
   PIS do motorista.
2. WHEN o motorista digita em "PIS do proprietário",
   THE MotoristaPerfilPage SHALL aceitar apenas dígitos e limitar a
   `PIS_Length` caracteres.
3. WHERE o campo "PIS do proprietário" está vazio no salvamento da
   seção "Proprietário",
   THE MotoristaPerfilPage SHALL exibir aviso amarelo (mesma
   formatação do PIS do motorista) "PIS do proprietário não
   informado." e PERMITIR o salvamento.
4. IF o campo "PIS do proprietário" possui valor com tamanho
   diferente de `PIS_Length` e diferente de 0,
   THEN THE MotoristaPerfilPage SHALL exibir "PIS deve ter
   exatamente 11 dígitos" e bloquear o salvamento da seção
   "Proprietário".
5. WHEN o campo "PIS do proprietário" possui exatamente
   `PIS_Length` dígitos,
   THE MotoristaService SHALL persistir o valor em
   `motoristas.owner_pis_number`.
6. WHERE `isNotOwner === false`,
   THE MotoristaPerfilPage SHALL NÃO renderizar o campo "PIS do
   proprietário".

### Requirement 6 — Botão "Sou eu o proprietário"

**User Story:** Como motorista que é o próprio dono do caminhão mas
quer aparecer como proprietário separado para fins administrativos,
quero clicar em um botão e ter os campos de proprietário preenchidos
com meus dados, mas mantê-los editáveis caso queira ajustar.

#### Acceptance Criteria

1. WHERE `isNotOwner === true`,
   THE MotoristaPerfilPage SHALL renderizar na seção "Proprietário"
   um botão "Sou eu o proprietário" no topo da seção.
2. WHEN o motorista clica em "Sou eu o proprietário",
   THE MotoristaPerfilPage SHALL copiar para os campos de
   proprietário os valores atuais dos campos do motorista
   correspondentes em `CamposCopia_SouEuOProprietario`,
   substituindo qualquer valor anterior dos campos de proprietário.
3. WHEN o motorista clica em "Sou eu o proprietário",
   THE MotoristaPerfilPage SHALL marcar internamente
   `owner_is_driver = true` no estado da seção "Proprietário".
4. THE MotoristaPerfilPage SHALL manter todos os campos copiados
   pelo botão "Sou eu o proprietário" totalmente editáveis após o
   clique.
5. THE MotoristaPerfilPage SHALL NÃO desativar nem ocultar o checkbox
   "O caminhão NÃO é meu" quando o motorista clica em "Sou eu o
   proprietário".
6. WHEN o motorista salva a seção "Proprietário",
   THE MotoristaService SHALL persistir o valor de `owner_is_driver`
   em `motoristas.owner_is_driver` (boolean, default `FALSE`).
7. IF o motorista altera qualquer campo do proprietário após clicar
   em "Sou eu o proprietário",
   THEN THE MotoristaPerfilPage SHALL manter `owner_is_driver` em
   `true` (a flag indica apenas a origem dos dados, não que estão
   sincronizados em tempo real).

### Requirement 7 — Seção "Contrato de Arrendamento"

**User Story:** Como motorista que aluga o caminhão de outra
empresa, quero anexar o contrato de arrendamento em PDF para
comprovar que estou legalmente autorizado a operar o veículo.

#### Acceptance Criteria

1. WHERE `isNotOwner === true`,
   THE MotoristaPerfilPage SHALL renderizar uma quarta seção
   "Contrato de Arrendamento" como cartão abaixo da seção
   "Proprietário".
2. WHERE `isNotOwner === false`,
   THE MotoristaPerfilPage SHALL NÃO renderizar a seção
   "Contrato de Arrendamento".
3. THE MotoristaPerfilPage SHALL renderizar dentro da seção
   "Contrato de Arrendamento" um único slot de upload do tipo
   `'contrato_arrendamento'`.
4. THE MotoristaPerfilPage SHALL definir no `<input type="file">`
   do slot de contrato `accept="application/pdf"` (e não
   `image/*`).
5. IF o motorista seleciona um arquivo cujo `mimeType` não é
   `'application/pdf'`,
   THEN THE MotoristaPerfilPage SHALL exibir "Apenas arquivos PDF
   são aceitos para o contrato de arrendamento." e NÃO chamar
   `uploadDocument`.
6. IF o motorista seleciona um arquivo cujo tamanho excede
   `MaxFileSize_Contrato`,
   THEN THE MotoristaPerfilPage SHALL exibir "Arquivo muito grande.
   Máximo permitido: 5MB." e NÃO chamar `uploadDocument`.
7. WHEN o motorista envia um contrato válido,
   THE MotoristaPerfilPage SHALL chamar
   `uploadDocument(userId, 'contrato_arrendamento', file)` e o
   `DocumentsService` SHALL persistir o documento com
   `status = 'pendente'` e `document_type = 'contrato_arrendamento'`.
8. THE DocumentsService SHALL incluir `'contrato_arrendamento'` na
   constante `VALID_DOCUMENT_TYPES`, mantendo a ordem dos demais
   tipos intacta.
9. THE Migration018 SHALL recriar o CHECK constraint
   `documents_document_type_check` como superconjunto, incluindo
   `'contrato_arrendamento'` além de todos os 20 tipos atuais
   (incluindo `'documento_proprietario'` adicionado na Migration 017).

### Requirement 8 — Salvar por seção (4 botões independentes)

**User Story:** Como motorista, quero poder salvar cada seção do
perfil de forma independente, para não ter que ter tudo válido só
para atualizar meus dados pessoais.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar dentro de cada um dos
   quatro cartões em `SecoesSalvar` um botão próprio rotulado
   "Salvar" (texto opcional sufixo "alterações"), no rodapé do
   cartão.
2. THE MotoristaPerfilPage SHALL NÃO renderizar mais um botão único
   "Salvar Alterações" no fim do formulário.
3. THE MotoristaPerfilPage SHALL manter um estado dirty isolado por
   seção; cada botão "Salvar" deve estar `disabled` quando a
   respectiva seção não tem mudanças não-persistidas.
4. WHEN o motorista clica em "Salvar" da seção "Dados Pessoais",
   THE MotoristaPerfilPage SHALL validar APENAS os campos da seção
   "Dados Pessoais" (nome, e-mail, CPF, RG, endereço, PIS,
   referências) e ignorar erros das demais seções.
5. WHEN o motorista clica em "Salvar" da seção "Veículo",
   THE MotoristaPerfilPage SHALL validar APENAS os campos da seção
   "Veículo" (incluindo todas as validações da spec anterior: placa
   Mercosul, ano fab/modelo cruzado, ranges de km/l, eixos,
   capacidade e diesel, modelo "Outro" preenchido se selecionado).
6. WHEN o motorista clica em "Salvar" da seção "Proprietário",
   THE MotoristaPerfilPage SHALL validar APENAS os campos da seção
   "Proprietário" (CNPJ, PIS proprietário).
7. WHEN o motorista clica em "Salvar" da seção "Contrato de
   Arrendamento",
   THE MotoristaPerfilPage SHALL salvar apenas o documento
   `contrato_arrendamento` (o slot já persiste no upload; o botão
   serve para fechar o estado dirty da seção sem novos efeitos
   colaterais).
8. WHEN um "Salvar" de seção termina com sucesso,
   THE MotoristaPerfilPage SHALL exibir a mensagem "Seção salva."
   próxima ao botão correspondente, com fundo verde claro, por 3
   segundos.
9. IF um "Salvar" de seção falha,
   THEN THE MotoristaPerfilPage SHALL exibir abaixo do botão
   correspondente a mensagem de erro retornada pelo serviço (ou
   "Erro ao salvar.") sem afetar as demais seções.
10. WHEN o motorista clica em "Salvar" de uma seção mas existem
    erros de validação somente nessa seção,
    THE MotoristaPerfilPage SHALL exibir as mensagens de erro inline
    nos campos correspondentes e mover o foco para o primeiro
    campo inválido daquela seção.

### Requirement 9 — Responsividade mobile (≤ 375 px)

**User Story:** Como motorista usando o app no celular durante uma
parada, quero o perfil funcionar bem em telas pequenas, sem zoom
acidental e com botões grandes o suficiente para tocar.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL aplicar a classe `text-base` (16 px)
   em TODOS os inputs novos introduzidos por esta feature em
   viewports de largura ≤ `MobileBreakpoint`, garantindo que o iOS
   não dê zoom no foco.
2. THE MotoristaPerfilPage SHALL renderizar todos os campos de
   formulário em uma única coluna em viewports de largura
   ≤ `MobileBreakpoint`.
3. THE MotoristaPerfilPage SHALL aplicar `min-h-[44px]` (≥
   `TouchMinTarget`) em TODOS os botões introduzidos por esta
   feature: "+ Adicionar referência", "🗑 remover", "Sou eu o
   proprietário" e os 4 botões "Salvar" por seção.
4. THE MotoristaPerfilPage SHALL aplicar padding vertical mínimo de
   12 px nos cartões de seção em viewports ≤ `MobileBreakpoint` (não
   reduzir o padding das versões maiores).
5. WHEN renderizada em viewport de largura ≤ `MobileBreakpoint`,
   THE MotoristaPerfilPage SHALL exibir cada item da lista de
   referências profissionais como um card vertical (campos
   empilhados) com o botão "🗑 remover" claramente visível no canto
   superior direito do card.
6. THE MotoristaPerfilPage SHALL evitar overflow horizontal em
   viewports ≤ `MobileBreakpoint` (todos os elementos devem caber
   dentro da largura visível).

### Requirement 10 — Migration 018 idempotente e não-destrutiva

**User Story:** Como sistema FreteGO, quero garantir que o schema
necessário para esta feature seja aplicado sem quebrar dados
existentes nem outras tabelas.

#### Acceptance Criteria

1. THE Feature SHALL criar a Migration018
   (`supabase/migrations/018_motorista_perfil_extras.sql`) usando
   exclusivamente `ADD COLUMN IF NOT EXISTS` para os novos campos em
   `motoristas`:
   `address_cep TEXT`, `address_street TEXT`,
   `address_number TEXT`, `address_complement TEXT`,
   `address_neighborhood TEXT`, `address_city TEXT`,
   `address_uf TEXT`, `rg_number TEXT`, `owner_cnpj TEXT`,
   `owner_company_name TEXT`, `owner_pis_number TEXT`,
   `owner_is_driver BOOLEAN DEFAULT FALSE`.
2. THE Migration018 SHALL criar a tabela
   `motorista_references` somente se ela ainda não existir
   (`CREATE TABLE IF NOT EXISTS`), com colunas:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `company_name TEXT NOT NULL`
   - `phone TEXT NOT NULL`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
3. THE Migration018 SHALL criar um índice
   `idx_motorista_references_user_id ON motorista_references(user_id)`
   com `IF NOT EXISTS`.
4. THE Migration018 SHALL recriar o CHECK constraint
   `documents_document_type_check` com a lista atual + o novo tipo
   `'contrato_arrendamento'`, sem remover nenhum tipo existente.
5. THE Migration018 SHALL habilitar RLS em
   `motorista_references` e adicionar políticas que permitam ao
   motorista logado fazer `SELECT`, `INSERT` e `DELETE` apenas onde
   `user_id = auth.uid()` (políticas criadas com
   `DROP POLICY IF EXISTS` antes do `CREATE POLICY` para
   idempotência).
6. THE Migration018 SHALL ser idempotente — execução múltipla
   produz exatamente o mesmo schema final sem erros.
7. THE Migration018 SHALL NÃO alterar nenhuma coluna ou constraint
   das tabelas `embarcadores`, `fretes`, `users`, `documents`
   (exceto a recriação do CHECK em `documents.document_type` como
   superconjunto, conforme item 4).

### Requirement 11 — Não-regressão dos fluxos do embarcador e da spec anterior

**User Story:** Como sistema FreteGO, quero garantir que nada do
embarcador nem da spec `motorista-onboarding-painel` regrida.

#### Acceptance Criteria

1. THE Feature SHALL NÃO alterar nenhum dos arquivos:
   `src/pages/EmbarcadorPerfilPage.tsx`,
   `src/pages/EmbarcadorPage.tsx`,
   `src/services/embarcador.ts`,
   `src/services/fretes.ts`,
   `src/services/verification.ts`,
   `src/components/ModalVerificacaoEmail.tsx`,
   `src/components/LogoUploadField.tsx`,
   `src/components/FreteForm.tsx`.
2. THE Feature SHALL NÃO alterar a assinatura pública das funções
   `lookupCnpj`, `formatCnpj`, `sanitizeCnpj` e `isValidCnpjLength`
   em `src/services/cnpj.ts` (apenas REUSO).
3. THE Feature SHALL NÃO alterar a assinatura pública das funções
   `uploadDocument`, `getSignedUrl`, `deleteDocument`,
   `validateDocumentType`, `resolveProfilePhotoUrl` em
   `src/services/documents.ts` (apenas adição de
   `'contrato_arrendamento'` em `VALID_DOCUMENT_TYPES`).
4. THE Feature SHALL preservar o comportamento de TODOS os
   requirements da spec `motorista-onboarding-painel`
   (Requirements 1–16 daquela spec) sem regressão.
5. WHEN os testes existentes do embarcador e da spec anterior são
   executados após esta implementação, THE Test_Suite SHALL
   apresentar 100% dos casos passando (sem novos `failing`
   introduzidos por esta feature).

### Requirement 12 — Reaproveitamento de utilitários puros

**User Story:** Como time, quero que campos novos reutilizem as
funções de capitalização e formatação já existentes, para evitar
duplicação.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL aplicar `capitalizeName` ao perder
   o foco do campo "Nome da empresa" em cada referência
   profissional.
2. THE MotoristaPerfilPage SHALL aplicar `capitalizeName` ao perder
   o foco do campo "Nome do proprietário" na seção "Proprietário"
   (quando preenchido manualmente).
3. WHERE já existe um utilitário de formatação de telefone BR
   exportado em `src/utils/`,
   THE Feature SHALL importar e reusar esse utilitário em vez de
   duplicar a lógica.
4. WHERE NÃO existe um utilitário público de formatação de telefone
   BR,
   THE Feature SHALL criar `src/utils/phoneFormat.ts` exportando
   funções puras `sanitizePhone(value: string): string` e
   `formatPhoneBR(value: string): string` e usá-las em todos os
   campos de telefone novos desta feature.
