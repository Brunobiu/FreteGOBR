# Requirements Document — Motorista Onboarding & Painel

## Introdução

Reorganização completa do perfil do motorista (`MotoristaPerfilPage`) e
adição de cálculos financeiros ao vivo no painel de fretes do motorista
(`HomePage` quando `userType === 'motorista'`).

A feature abrange três frentes:

1. **Perfil do Motorista** — formulário compacto, dividido em três
   seções claras (Dados Pessoais, Veículo, Proprietário), com
   validações reaproveitadas do fluxo do embarcador (capitalização de
   nome e verificação de e-mail por OTP), validação de placa no padrão
   Mercosul brasileiro, lista pré-definida de modelos de caminhão,
   anos de fabricação e modelo separados (4 dígitos cada), upload de
   documentos com opção de câmera e/ou arquivo, novos campos
   operacionais (km/l, eixos, capacidade, valor do diesel) e aviso
   amigável (não bloqueante) sobre o PIS.
2. **Painel de Fretes do Motorista** — exibição de valor do diesel
   regional editável "ao vivo" no cabeçalho do dashboard e cálculo
   automático por frete (litros, custo de diesel, lucro líquido
   estimado), com pedágio como placeholder.
3. **Backlog "Para Depois"** — arquivo único `.kiro/PARA_DEPOIS.md` que
   centraliza tarefas adiadas (aprovação de documentos, dashboard
   admin do dono, pagamento integrado, API de pedágios).

Toda a feature é **isolada do fluxo do embarcador**, que NÃO pode
sofrer regressões.

## Glossário

### Sistemas e componentes

- **MotoristaPerfilPage**: página `src/pages/MotoristaPerfilPage.tsx`,
  rota `/perfil/motorista`. Único ponto de edição do perfil do
  motorista.
- **HomePageMotorista**: ramo da página `src/pages/HomePage.tsx` ativo
  quando `user?.userType === 'motorista'`. Contém o painel de fretes
  com cabeçalho de diesel e cards/tabela de fretes.
- **MotoristaService**: módulo `src/services/motorista.ts`. Único
  módulo autorizado a alterar tabelas `motoristas` e dados específicos
  do motorista neste escopo.
- **DocumentsService**: módulo `src/services/documents.ts`. Pode
  receber NOVOS helpers/parâmetros, mas NÃO pode quebrar contratos já
  consumidos pelo embarcador (`uploadDocument`, `getSignedUrl`,
  `deleteDocument`, `validateDocumentType`,
  `resolveProfilePhotoUrl`, `VALID_DOCUMENT_TYPES`).
- **VerificationService**: módulo `src/services/verification.ts` já
  existente (Migration 010). REUSADO pelo motorista sem alteração de
  contrato.
- **ModalVerificacaoEmail**: componente
  `src/components/ModalVerificacaoEmail.tsx` já existente. REUSADO
  pelo motorista sem alteração de props.
- **CapitalizeName**: função `capitalizeName` em
  `src/utils/textCase.ts`. REUSADA pelo motorista.
- **FreteCard**: componente `src/components/FreteCard.tsx`. Recebe
  novas props OPCIONAIS para exibir cálculos quando o usuário for
  motorista. Sem props opcionais novas, comportamento permanece
  idêntico ao atual (não-regressão para o embarcador).
- **DieselDashboardInput**: novo componente exclusivo da
  `HomePageMotorista`, exibido apenas quando
  `userType === 'motorista'`. Não é renderizado para visitantes nem
  para embarcadores.
- **ParaDepoisFile**: arquivo `.kiro/PARA_DEPOIS.md` (raiz do
  workspace, dentro de `.kiro/`). Único arquivo onde tarefas adiadas
  são registradas.

### Constantes e formatos

- **Placa_Mercosul_Regex**: `^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$`. Sete
  caracteres, todos maiúsculos: 3 letras, 1 dígito, 1 letra ou
  dígito, 2 dígitos. Exemplos válidos: `ABC1D23`, `ABC1234`. Exemplos
  inválidos: `ABCD123` (4ª posição não é dígito), `AB12D34` (apenas 2
  letras iniciais), `abc1d23` (minúsculas).
- **AnoFabricacao_Range**: inteiro entre 1980 e (ano corrente + 1),
  exatamente 4 dígitos.
- **AnoModelo_Range**: inteiro entre 1980 e (ano corrente + 2),
  exatamente 4 dígitos. Deve ser maior ou igual ao ano de fabricação.
- **KmPorLitro_Range**: número decimal positivo entre 1,0 e 10,0
  (km/l do cavalo).
- **Eixos_Range**: inteiro entre 2 e 9 (eixos da carreta).
- **Capacidade_Range**: número decimal positivo entre 1,0 e 80,0
  (toneladas).
- **ValorDiesel_Range**: número decimal positivo entre 1,00 e 20,00
  (R$/litro).
- **PIS_Length**: exatamente 11 dígitos quando preenchido. Vazio é
  permitido.
- **MaxFileSize**: 5 MB (5 × 1024 × 1024 bytes), aplicado a cada
  upload.

### Listas pré-definidas

- **Modelos_Caminhao**: lista fixa de modelos exibida em `<select>`,
  na seguinte ordem (rótulos exatos):
  - Volvo FH
  - Volvo VM
  - Scania R450
  - Scania G
  - Mercedes Atego
  - Mercedes Axor
  - Mercedes Actros
  - Iveco Hi-Way
  - Iveco Tector
  - Ford Cargo
  - VW Constellation
  - VW Delivery
  - DAF XF
  - MAN TGX
  - Outro

  Ao escolher "Outro", o sistema exibe um campo de texto livre para o
  modelo customizado (máx. 60 caracteres).

- **TiposVeiculo**: `truck`, `van`, `pickup`, `carreta`,
  `bitrem`, `rodotrem`, `vanderleia`. Rótulos em pt-BR exibidos pela
  UI: "Caminhão", "Van", "Pickup", "Carreta", "Bitrem", "Rodotrem",
  "Vanderleia".

- **TiposDocumento_DadosPessoais** (Seção 1):
  - `cnh` (CNH frente/verso)
  - `foto_segurando_cnh`
  - `comprovante_endereco_motorista`

- **TiposDocumento_Veiculo** (Seção 2):
  - `crlv_cavalo`
  - `crlv_carreta_1`, `crlv_carreta_2`, `crlv_carreta_3`,
    `crlv_carreta_4` (carretas 2–4 atrás de toggle "Adicionar mais
    carretas")
  - `rntrc_cavalo`
  - `rntrc_carreta_1`, `rntrc_carreta_2` (carreta 2 atrás do mesmo
    toggle)
  - `foto_frente_caminhao`
  - `foto_caminhao_completo`

- **TiposDocumento_Proprietario** (Seção 3, exibida apenas se
  `caminhao_proprio === false`):
  - `comprovante_endereco_proprietario`
  - `documento_proprietario` (CPF/CNH ou contrato — novo tipo a ser
    adicionado à lista canônica de `documents.document_type`)

### Termos do domínio financeiro

- **DistanciaFrete_km**: campo `distance_km` da tabela `fretes`
  (Migration 015). Inteiro em quilômetros.
- **LitrosEstimados**: `DistanciaFrete_km / KmPorLitro`, arredondado
  com 2 casas decimais. Em litros.
- **CustoDiesel**: `LitrosEstimados × ValorDiesel`, em reais.
- **Pedagio**: por enquanto SEMPRE exibido como `—` (placeholder). O
  cálculo real é diferido para o backlog "Para Depois".
- **LucroLiquidoEstimado**: `frete.value − CustoDiesel − Pedagio`. Como
  Pedagio é `—`, o cálculo atual considera Pedagio = 0, mas o rótulo
  da UI deixa claro que pedágio ainda não está incluso.

## Requirements

### Requirement 1 — Capitalização do nome do motorista

**User Story:** Como motorista, quero meu nome aparecer sempre
capitalizado corretamente no perfil, para evitar exibir nomes em
caixa-alta ou minúsculas em conversas e contratos.

#### Acceptance Criteria

1. WHEN o motorista digita ou cola um valor no campo "Nome" da
   `MotoristaPerfilPage`, THE MotoristaPerfilPage SHALL aplicar
   `capitalizeName` ao perder o foco do campo (`onBlur`) antes de
   salvar.
2. WHEN o `MotoristaService` recebe `name` em
   `updateMotoristaProfile`, THE MotoristaService SHALL persistir o
   valor exatamente como `capitalizeName(name)`.
3. WHEN a `MotoristaPerfilPage` carrega dados do usuário,
   THE MotoristaPerfilPage SHALL exibir o nome aplicando
   `capitalizeName` ao valor retornado, mesmo que o banco contenha
   versão em caixa-alta.
4. WHERE o nome contém apenas espaços ou está vazio,
   THE MotoristaPerfilPage SHALL bloquear o salvamento e exibir a
   mensagem "Informe seu nome completo".

### Requirement 2 — Verificação de e-mail por código OTP

**User Story:** Como motorista, quero confirmar meu e-mail por código
OTP igual o embarcador faz, para garantir que recebo notificações.

#### Acceptance Criteria

1. WHEN o motorista altera o valor do campo "E-mail" e clica em
   "Verificar e-mail", THE MotoristaPerfilPage SHALL chamar
   `sendEmailVerificationCode(email)` do `VerificationService`.
2. WHEN `sendEmailVerificationCode` é invocado com sucesso,
   THE MotoristaPerfilPage SHALL abrir o `ModalVerificacaoEmail`
   reaproveitado do embarcador, sem alterações no componente.
3. WHEN o usuário confirma o código no modal,
   THE MotoristaPerfilPage SHALL chamar
   `confirmEmailVerificationCode(code)` e, em sucesso, exibir um
   selo "E-mail verificado ✓" ao lado do campo.
4. IF `sendEmailVerificationCode` lança `VerificationError` com
   código `RATE_LIMITED`, THEN THE MotoristaPerfilPage SHALL exibir
   "Muitas tentativas. Tente novamente em algumas horas." e bloquear
   o botão "Verificar e-mail" pelos próximos 60 segundos.
5. IF o e-mail digitado é igual ao e-mail já verificado no banco,
   THEN THE MotoristaPerfilPage SHALL exibir o selo "E-mail
   verificado ✓" sem chamar a RPC.
6. THE MotoristaPerfilPage SHALL bloquear o salvamento de um e-mail
   alterado se ele ainda não foi verificado, exibindo "Verifique o
   novo e-mail antes de salvar".

### Requirement 3 — Validação de placa no padrão Mercosul

**User Story:** Como motorista, quero que minha placa seja validada
no padrão Mercosul brasileiro para evitar erros de digitação.

#### Acceptance Criteria

1. WHEN o motorista digita no campo "Placa",
   THE MotoristaPerfilPage SHALL converter automaticamente para
   maiúsculas e remover caracteres não alfanuméricos.
2. THE MotoristaPerfilPage SHALL limitar o campo "Placa" a no
   máximo 7 caracteres.
3. IF o valor de "Placa" não casa com o `Placa_Mercosul_Regex`,
   THEN THE MotoristaPerfilPage SHALL exibir "Placa inválida.
   Formato esperado: ABC1D23" abaixo do campo e bloquear o salvamento
   do perfil.
4. WHEN o valor de "Placa" casa com o `Placa_Mercosul_Regex`,
   THE MotoristaPerfilPage SHALL remover qualquer mensagem de erro do
   campo e habilitar o botão "Salvar Alterações" (se as demais
   validações também passarem).

### Requirement 4 — Reorganização do formulário em três seções

**User Story:** Como motorista, quero o formulário do perfil dividido
em três seções claras (Dados Pessoais, Veículo, Proprietário), cada
uma com seus próprios documentos.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar exatamente três seções,
   na ordem: "Dados Pessoais", "Veículo", "Proprietário".
2. THE MotoristaPerfilPage SHALL renderizar na seção "Dados
   Pessoais", além de campos de identificação, slots de upload para
   `TiposDocumento_DadosPessoais`.
3. THE MotoristaPerfilPage SHALL renderizar na seção "Veículo", além
   dos campos do veículo, slots de upload para
   `TiposDocumento_Veiculo`.
4. WHERE o motorista marca o checkbox "O caminhão NÃO é meu (é de
   outro proprietário)", THE MotoristaPerfilPage SHALL exibir a seção
   "Proprietário" com slots de `TiposDocumento_Proprietario`.
5. IF o checkbox "O caminhão NÃO é meu" está desmarcado,
   THEN THE MotoristaPerfilPage SHALL ocultar a seção "Proprietário"
   e não exigir nenhum documento dela.
6. THE MotoristaPerfilPage SHALL preservar o estado de cada seção
   (campos preenchidos e documentos enviados) ao alternar entre
   elas.
7. THE MotoristaPerfilPage SHALL exibir, ao lado de cada título de
   seção, um contador "X/Y documentos enviados" referente APENAS aos
   documentos daquela seção.

### Requirement 5 — Seleção de modelo de caminhão por lista

**User Story:** Como motorista, quero escolher um modelo de caminhão
de uma lista pré-definida em vez de digitar.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar o campo "Modelo" como um
   `<select>` populado com `Modelos_Caminhao`, na ordem definida no
   glossário.
2. WHEN o motorista seleciona "Outro" no `<select>` "Modelo",
   THE MotoristaPerfilPage SHALL exibir um campo de texto adicional
   rotulado "Especifique o modelo".
3. IF o campo "Especifique o modelo" está vazio quando "Outro" está
   selecionado, THEN THE MotoristaPerfilPage SHALL bloquear o
   salvamento e exibir "Informe o modelo do caminhão".
4. THE MotoristaPerfilPage SHALL limitar "Especifique o modelo" a no
   máximo 60 caracteres.
5. WHEN o motorista escolhe um item diferente de "Outro",
   THE MotoristaService SHALL persistir o rótulo exato do
   `Modelos_Caminhao` em `motoristas.vehicle_model`.
6. WHEN o motorista escolhe "Outro" e preenche o texto,
   THE MotoristaService SHALL persistir o texto digitado em
   `motoristas.vehicle_model`.

### Requirement 6 — Anos de fabricação e modelo separados

**User Story:** Como motorista, quero anos de fabricação e modelo
separados, com 4 dígitos cada.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar dois campos numéricos
   distintos: "Ano de fabricação" e "Ano modelo".
2. THE MotoristaPerfilPage SHALL aceitar em "Ano de fabricação"
   apenas valores inteiros dentro de `AnoFabricacao_Range`.
3. THE MotoristaPerfilPage SHALL aceitar em "Ano modelo" apenas
   valores inteiros dentro de `AnoModelo_Range`.
4. IF "Ano modelo" é menor que "Ano de fabricação",
   THEN THE MotoristaPerfilPage SHALL exibir "Ano modelo deve ser
   maior ou igual ao ano de fabricação" e bloquear o salvamento.
5. WHEN ambos os campos são válidos,
   THE MotoristaService SHALL persistir os valores em colunas
   distintas (`vehicle_year_manufacture` e `vehicle_year_model`).

### Requirement 7 — Upload com câmera ou arquivo

**User Story:** Como motorista, quero fazer upload de documentos
abrindo a câmera direto ou escolhendo arquivo.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar, em cada slot de
   documento, dois botões visíveis: "Abrir câmera" e "Escolher
   arquivo".
2. WHEN o motorista clica em "Abrir câmera" em um slot que aceita
   `image/*`, THE MotoristaPerfilPage SHALL acionar um `<input
   type="file" accept="image/*" capture="environment">` que prioriza
   a câmera traseira do dispositivo.
3. WHEN o motorista clica em "Escolher arquivo" em um slot que
   aceita imagem ou PDF, THE MotoristaPerfilPage SHALL acionar um
   `<input type="file" accept="image/*,application/pdf">` sem o
   atributo `capture`.
4. WHERE o slot é exclusivamente uma foto (ex.:
   `foto_segurando_cnh`, `foto_frente_caminhao`,
   `foto_caminhao_completo`), THE MotoristaPerfilPage SHALL aceitar
   apenas `image/*` em ambos os botões.
5. IF o arquivo selecionado tem tamanho maior que `MaxFileSize`,
   THEN THE MotoristaPerfilPage SHALL exibir "Arquivo muito grande.
   Máximo permitido: 5MB." e não chamar `uploadDocument`.
6. IF o arquivo selecionado tem `mimeType` fora dos aceitos pelo
   slot, THEN THE MotoristaPerfilPage SHALL exibir "Tipo de arquivo
   não suportado neste slot" e não chamar `uploadDocument`.
7. THE DocumentsService SHALL preservar a assinatura pública das
   funções `uploadDocument`, `getSignedUrl`, `deleteDocument`,
   `validateDocumentType`, `resolveProfilePhotoUrl` e da constante
   `VALID_DOCUMENT_TYPES` (não-regressão para o embarcador).

### Requirement 8 — Compactação visual do formulário

**User Story:** Como motorista, quero o formulário do perfil bem mais
compacto, sem espaços desnecessários.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL aplicar `padding` interno máximo de
   16 px em cada cartão de seção (atualmente 20 px) e
   `space-y-3` (12 px) entre campos.
2. THE MotoristaPerfilPage SHALL usar tamanho de fonte máximo de 14
   px (`text-sm`) em rótulos e inputs e 16 px em títulos de seção.
3. THE MotoristaPerfilPage SHALL usar `max-w-3xl` no container
   principal mantendo o layout existente, sem aumentar largura.
4. THE MotoristaPerfilPage SHALL renderizar campos relacionados em
   grid de 2 colunas em telas `>= md` (a partir de 768 px) e em uma
   coluna abaixo disso, eliminando linhas em branco supérfluas.
5. THE MotoristaPerfilPage SHALL renderizar a barra de progresso
   global em altura máxima de 8 px (`h-2`) e sem moldura adicional
   além do cartão.

### Requirement 9 — Campo PIS com aviso amarelo não bloqueante

**User Story:** Como motorista, quero ver no formulário um aviso
amigável caso eu não preencha o PIS, sem bloquear o salvar.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar o campo "PIS" como
   último campo da seção "Dados Pessoais", imediatamente acima do
   botão "Salvar Alterações".
2. WHEN o motorista digita no campo "PIS",
   THE MotoristaPerfilPage SHALL aceitar apenas dígitos e limitar a
   `PIS_Length` caracteres.
3. WHERE o campo "PIS" está vazio no momento do salvamento,
   THE MotoristaPerfilPage SHALL exibir um aviso amarelo (fundo
   `bg-yellow-50`, texto `text-yellow-800`) com a mensagem
   "Transportadoras hoje em dia pedem muito o PIS, favor preencher" e
   PERMITIR o salvamento normalmente.
4. IF o campo "PIS" possui valor com tamanho diferente de
   `PIS_Length`, THEN THE MotoristaPerfilPage SHALL exibir "PIS deve
   ter exatamente 11 dígitos" e bloquear o salvamento.
5. WHEN o campo "PIS" possui exatamente `PIS_Length` dígitos,
   THE MotoristaService SHALL persistir o valor em
   `motorista_pis.pis_number`.

### Requirement 10 — Campos operacionais do veículo (km/l, eixos, capacidade)

**User Story:** Como motorista, quero informar quantos km meu
caminhão faz por litro, quantos eixos minha carreta tem e a
capacidade de carga em toneladas.

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar na seção "Veículo" três
   campos numéricos: "Consumo (km/l do cavalo)", "Eixos da carreta" e
   "Capacidade de carga (toneladas)".
2. THE MotoristaPerfilPage SHALL aceitar em "Consumo (km/l)" apenas
   valores dentro de `KmPorLitro_Range` com até uma casa decimal.
3. THE MotoristaPerfilPage SHALL aceitar em "Eixos" apenas inteiros
   dentro de `Eixos_Range`.
4. THE MotoristaPerfilPage SHALL aceitar em "Capacidade" apenas
   valores dentro de `Capacidade_Range` com até uma casa decimal.
5. WHEN qualquer um dos três campos está preenchido com valor
   válido, THE MotoristaService SHALL persistir o valor em
   `motoristas.km_per_liter`, `motoristas.trailer_axles` ou
   `motoristas.cargo_capacity_ton` respectivamente.
6. IF qualquer um dos três campos está fora do range definido,
   THEN THE MotoristaPerfilPage SHALL exibir "Valor fora do
   intervalo permitido" abaixo do campo correspondente e bloquear o
   salvamento.
7. THE MotoristaPerfilPage SHALL permitir salvar o perfil mesmo com
   estes três campos vazios, mas exibir aviso "Preencha consumo,
   eixos e capacidade para desbloquear cálculos no painel".

### Requirement 11 — Valor do diesel com origem dupla (perfil e dashboard)

**User Story:** Como motorista, no painel de fretes quero ver no
centro do cabeçalho o valor do diesel da minha região, edito ali
mesmo e os cálculos atualizam ao vivo. Esse mesmo valor mora no perfil
dentro de "Veículo / Documentos".

#### Acceptance Criteria

1. THE MotoristaPerfilPage SHALL renderizar dentro da seção
   "Veículo" um campo "Valor do diesel (R$/litro)".
2. THE HomePageMotorista SHALL renderizar o componente
   `DieselDashboardInput` no centro do cabeçalho do dashboard.
3. THE DieselDashboardInput SHALL aceitar apenas valores dentro de
   `ValorDiesel_Range` com até duas casas decimais.
4. WHEN o valor do diesel é alterado em qualquer um dos dois locais
   (perfil ou dashboard), THE MotoristaService SHALL persistir o
   valor em `motoristas.diesel_price` em uma única requisição
   debounced de 600 ms.
5. WHEN o valor do diesel é persistido com sucesso pelo dashboard,
   THE HomePageMotorista SHALL recalcular imediatamente todos os
   cards/linhas de frete visíveis sem recarregar a lista do servidor.
6. IF a persistência do valor do diesel falha,
   THEN THE HomePageMotorista SHALL reverter o valor exibido para o
   último valor válido e mostrar uma toast "Não foi possível salvar
   o valor do diesel".
7. WHERE o usuário não é motorista (visitante ou embarcador),
   THE HomePageMotorista SHALL NÃO renderizar `DieselDashboardInput`.

### Requirement 12 — Cálculos financeiros por frete

**User Story:** Como motorista, em cada card de frete quero ver
distância, litros estimados, custo de diesel, pedágio (placeholder),
valor do frete e lucro líquido.

#### Acceptance Criteria

1. WHERE o motorista possui `km_per_liter` e `diesel_price`
   preenchidos e o frete possui `distance_km`, THE FreteCard SHALL
   exibir um bloco "Cálculo financeiro" com as linhas: "Distância",
   "Litros estimados", "Custo de diesel", "Pedágio", "Valor do
   frete" e "Lucro líquido (estimado)".
2. THE FreteCard SHALL calcular `LitrosEstimados =
   distance_km / km_per_liter`, arredondado a duas casas decimais.
3. THE FreteCard SHALL calcular `CustoDiesel = LitrosEstimados ×
   diesel_price`, formatado como moeda brasileira (`pt-BR`, `BRL`).
4. THE FreteCard SHALL exibir o pedágio como `—` (travessão) e o
   rótulo "Pedágio (em breve)".
5. THE FreteCard SHALL calcular `LucroLiquidoEstimado =
   frete.value − CustoDiesel` (pedágio tratado como 0) e exibir um
   asterisco com nota "* sem pedágio".
6. WHERE o frete não tem `distance_km` definido,
   THE FreteCard SHALL exibir "Distância não disponível" no lugar do
   cálculo financeiro, sem travar a renderização do restante do
   card.
7. WHERE o usuário visualizando o card NÃO é motorista,
   THE FreteCard SHALL NÃO renderizar o bloco "Cálculo financeiro"
   (não-regressão para visitantes e embarcadores).

### Requirement 13 — Aviso quando dados de cálculo estão incompletos

**User Story:** Como motorista, se eu não tiver km/l ou diesel
preenchido, quero um aviso convidando a completar essas infos para
desbloquear os cálculos.

#### Acceptance Criteria

1. WHERE o motorista NÃO possui `km_per_liter` preenchido OU NÃO
   possui `diesel_price` preenchido, THE FreteCard SHALL substituir
   o bloco "Cálculo financeiro" por um link "Configure seu veículo
   para ver os cálculos" que navega para `/perfil/motorista`.
2. THE HomePageMotorista SHALL exibir, acima da grade de fretes, um
   banner de aviso amarelo com a mesma mensagem quando qualquer um
   dos dois valores está faltando.
3. WHEN o motorista preenche os dois valores e retorna ao
   dashboard, THE HomePageMotorista SHALL ocultar o banner sem
   reload manual.

### Requirement 14 — Backlog "Para Depois"

**User Story:** Como time do FreteGO, quero um arquivo único com a
lista de tarefas adiadas, para não perder ideias.

#### Acceptance Criteria

1. THE Feature SHALL criar o arquivo `.kiro/PARA_DEPOIS.md` na
   primeira execução da implementação.
2. THE ParaDepoisFile SHALL conter as seguintes entradas iniciais,
   cada uma com data e descrição:
   - "Sistema de aprovação de documentos (admin aprova/rejeita CNH,
     CRLV, etc)"
   - "Dashboard administrativo do dono (acesso a tudo e todos)"
   - "Forma de pagamento do embarcador integrada (Mercado Pago,
     Stripe, etc)"
   - "API de pedágios — cálculo automático baseado na rota e número
     de eixos do caminhão"
3. THE ParaDepoisFile SHALL seguir o formato:
   ```markdown
   ## YYYY-MM-DD — <título curto>
   <descrição>
   ```
4. WHEN o usuário, em conversa com o assistente, disser "deixa pra
   depois" ou "depois a gente faz" sobre uma tarefa identificável,
   THE Feature SHALL adicionar uma nova entrada ao topo do
   `ParaDepoisFile` com data atual e descrição da tarefa.
5. THE ParaDepoisFile SHALL ser commitado junto com a feature, sem
   conflitar com nenhum spec existente.

### Requirement 15 — Migrations não-destrutivas

**User Story:** Como sistema FreteGO, quero garantir que novas
colunas sejam adicionadas sem quebrar dados existentes.

#### Acceptance Criteria

1. THE Feature SHALL criar uma migration nova
   (`017_motorista_painel_fields.sql`) usando exclusivamente
   `ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS` para os campos:
   `vehicle_year_manufacture INTEGER`,
   `vehicle_year_model INTEGER`,
   `km_per_liter NUMERIC(4,1)`,
   `trailer_axles INTEGER`,
   `cargo_capacity_ton NUMERIC(5,1)`,
   `diesel_price NUMERIC(5,2)`,
   `is_owner BOOLEAN DEFAULT TRUE`.
2. THE Migration SHALL adicionar o tipo
   `'documento_proprietario'` à lista canônica do CHECK constraint
   `documents_document_type_check`, sem remover nenhum tipo
   existente.
3. THE Migration SHALL ser idempotente (pode ser aplicada múltiplas
   vezes sem erro).
4. IF o banco já contém valor em `motoristas.vehicle_year`,
   THEN THE Migration SHALL copiar esse valor para
   `vehicle_year_manufacture` quando este último for nulo, sem
   apagar `vehicle_year`.
5. THE Migration SHALL preservar todas as colunas e dados das
   tabelas usadas pelo embarcador (`embarcadores`, `fretes`,
   `users`) — nenhum `DROP`, `RENAME` ou `TYPE` mudança nessas
   tabelas é permitido nesta feature.

### Requirement 16 — Não-regressão do fluxo do embarcador

**User Story:** Como sistema FreteGO, quero que tudo do embarcador
continue funcionando exatamente como está, sem regressões.

#### Acceptance Criteria

1. THE Feature SHALL limitar as alterações a estes arquivos:
   `src/pages/MotoristaPerfilPage.tsx`,
   `src/pages/HomePage.tsx` (apenas o ramo
   `userType === 'motorista'`),
   `src/services/motorista.ts`,
   `src/services/documents.ts` (adições retrocompatíveis),
   `src/components/FreteCard.tsx` (props opcionais retrocompatíveis),
   `src/components/DieselDashboardInput.tsx` (novo),
   `supabase/migrations/017_motorista_painel_fields.sql` (novo),
   `.kiro/PARA_DEPOIS.md` (novo).
2. THE Feature SHALL NÃO alterar nenhum dos arquivos:
   `src/pages/EmbarcadorPerfilPage.tsx`,
   `src/pages/EmbarcadorPage.tsx`,
   `src/services/embarcador.ts`,
   `src/services/fretes.ts`,
   `src/services/verification.ts`,
   `src/components/ModalVerificacaoEmail.tsx`,
   `src/components/LogoUploadField.tsx`,
   `src/components/FreteForm.tsx`.
3. THE FreteCard SHALL renderizar exatamente o mesmo layout atual
   quando nenhuma das novas props (`motoristaCalc`, `dieselPrice`,
   `kmPerLiter`) for passada.
4. THE HomePage SHALL renderizar exatamente o mesmo layout atual
   para visitantes e embarcadores.
5. WHEN os testes existentes do embarcador são executados após a
   implementação, THE Test_Suite SHALL apresentar 100% dos casos de
   embarcador passando (sem novos `failing` introduzidos por esta
   feature).
