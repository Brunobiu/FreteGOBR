# Requirements Document

## Introduction

Esta spec entrega a feature **Frete Comunidade** do FreteGO: uma muleta temporária de
lançamento para abastecer o feed de fretes enquanto não há volume suficiente de
embarcadores reais postando. No lançamento o app terá muitos motoristas mas
poucos/nenhum embarcador; um feed vazio faz o motorista abandonar. A solução é um
perfil-fantasma global ("Usuário Comunidade"), controlado exclusivamente pelo admin,
que publica fretes coletados pelo dono em grupos de caminhoneiro. A feature é
**desligável** quando houver embarcadores reais suficientes.

Pontos de design já confirmados com o dono, capturados aqui como requisitos:

1. **Item novo no menu admin "Frete Comunidade"**, gated pela permissão admin existente
   (sugestão de design: FINANCEIRO_VIEW/FINANCEIRO_EDIT ou permissão equivalente — o
   `design.md` decide a action exata), com Stealth_404 e audit negativo para acesso sem
   permissão, seguindo `admin-patterns.md`.
2. **Perfil Comunidade global**: uma foto (upload), um nome e um nome secundário. Config
   única para todos os fretes comunidade.
3. **Importação por planilha**: baixar modelo, fazer upload (somente o arquivo no formato
   do Modelo_Planilha), ver preview EDITÁVEL (correção célula a célula) com erros
   destacados, autocomplete/geocoding obrigatório das cidades de origem e destino (elas
   vêm abreviadas dos grupos de WhatsApp e precisam ser resolvidas para calcular km),
   detecção de duplicados com escolha excluir/atualizar, e publicação em lote.
4. **Armazenamento sem nova tabela**: fretes comunidade entram na MESMA tabela `fretes`,
   marcados por uma flag/origem, e aparecem no MESMO feed/mapa de todos os motoristas,
   sem filtro especial.
5. **Visual do motorista**: card e modal mostram foto + "Frete Comunidade" + "Frete
   sugerido pela comunidade" no lugar do embarcador, além do nome da transportadora
   daquele frete; o modal troca o botão "Chat" por um botão "WhatsApp" que abre o número
   da transportadora com mensagem pré-preenchida contendo o link do domínio do FreteGO.
6. **Regras gerais para TODOS os fretes**: auto-expiração em 5 dias (reset ao editar) e
   bloqueio de duplicado SOMENTE quando TODOS os campos significativos do frete forem
   iguais (origem, destino, local de carregamento, local de descarregamento, valor, tipo
   de produto, transportadora e telefone) — se um único campo diferir, é permitido
   coexistir no feed.

A feature respeita as convenções do projeto: UI/mensagens em pt-BR, identifiers/codes em
inglês, padrões admin (audit-by-construction via `executeAdminMutation`, RBAC server-side
via `is_admin_with_permission`, Stealth_404, versionamento otimista, migrations
idempotentes com par `_rollback`, numeração incremental — última migration aplicada: 060,
próxima livre: 061). A tabela `fretes` e o fluxo atual de embarcador/motorista devem
continuar funcionando sem regressão.

**Fora de escopo (escopo futuro, NÃO implementar agora):** algoritmo de
recomendação/ordenação do feed (preferências do motorista por tipo de carga/região/
empresa, compatibilidade com o tipo de caminhão, e embaralhamento para variar a ordem).
Esse algoritmo se aplica ao par motorista+embarcador real; o Frete Comunidade NÃO usa
algoritmo — dispara tudo para todos. Registrado no Requisito 11.

## Glossary

- **FreteGO**: O sistema/aplicativo completo (app motorista + painel embarcador + painel admin).
- **Frete_Comunidade**: Registro na tabela `fretes` marcado com a origem/flag de comunidade
  (`source = 'comunidade'`), publicado pelo perfil global em vez de por um embarcador real.
- **Frete_Normal**: Frete postado por um embarcador real (`source = 'embarcador'` ou ausência
  da flag de comunidade). Comportamento atual preservado.
- **Usuario_Comunidade**: Perfil-fantasma global (identidade única) usado como autor visual de
  todos os Frete_Comunidade. Não é uma conta de login; é uma configuração.
- **Comunidade_Profile**: Configuração global única do Usuario_Comunidade — foto, nome e
  nome secundário.
- **Admin_Comunidade_Page**: Página do painel admin em `/admin/frete-comunidade`.
- **Planilha_Import**: Arquivo CSV/XLSX enviado pelo admin contendo as linhas de fretes a
  importar.
- **Modelo_Planilha**: Arquivo modelo (CSV/XLSX) baixável com as colunas corretas e cabeçalho.
- **Template_Validation**: Validação estrutural que compara o cabeçalho/colunas da
  Planilha_Import com o Modelo_Planilha (mesmas colunas, mesma ordem, mesmo cabeçalho).
  Falha resulta no error code `INVALID_TEMPLATE`.
- **Import_Parser**: Componente que lê a Planilha_Import e produz linhas estruturadas
  (válidas e inválidas).
- **Preview_Import**: Tela/estado intermediário, EDITÁVEL, que lista as linhas lidas,
  permite correção célula a célula, marca erros por linha, indica o status de resolução das
  cidades e identifica duplicados, ANTES de publicar.
- **Import_Row**: Uma linha lida da Planilha_Import (editável no Preview_Import), com seus
  campos e status (válida, erro, duplicada, cidade pendente).
- **City_Autocomplete**: Mecanismo de autocomplete de localidade nos campos de cidade
  (origem e destino) do Preview_Import; ao selecionar uma sugestão, resolve a localização.
  Reaproveita o mecanismo de seleção/geocoding de cidade do fluxo do embarcador, se existir
  (o `design.md` confirma qual).
- **City_Resolution**: Resolução (geocoding) de uma cidade abreviada para um nome
  completo/reconhecível com coordenadas. É pré-condição para o cálculo de distância (km) da
  rota. Uma cidade não resolvida fica com status "pendente".
- **Geocoding**: Conversão de um nome de cidade selecionado via City_Autocomplete em
  coordenadas (latitude/longitude) usadas para calcular a distância (km) da rota.
- **Dedup_Frete**: Regra de detecção de duplicados por chave composta que cobre TODOS os
  campos significativos do frete. É duplicado somente quando a tupla COMPLETA coincide.
- **Dedup_Key**: Chave normalizada de Dedup_Frete que inclui TODOS os campos significativos:
  `normalize(origin) + normalize(destination) + normalize(origin_detail) +
  normalize(destination_detail) + numeric(value) + normalize(product) +
  normalize(community_carrier_name) + digits(community_contact_phone)`. Cada componente
  textual é normalizado com trim, colapso de espaços internos e caixa-baixa
  (case-insensitive); `value` é comparado numericamente; telefone é comparado normalizado
  (apenas dígitos). Só há duplicidade quando TODOS os componentes coincidem.
- **Transportadora**: Nome da empresa transportadora anunciante do Frete_Comunidade,
  armazenado na coluna nova `community_carrier_name` da tabela `fretes`.
- **Contato_WhatsApp**: Telefone/WhatsApp de contato da transportadora informado na planilha
  para o Frete_Comunidade (campo novo `community_contact_phone`).
- **WhatsApp_Deep_Link**: URL `https://wa.me/<numero>?text=<mensagem>` aberta ao clicar no
  botão WhatsApp do Frete_Comunidade. A mensagem inclui o link do domínio do FreteGO
  (`FreteGO_Domain`).
- **FreteGO_Domain**: URL pública do domínio do FreteGO (ex.: `https://www.fretegobr.com.br`),
  definida como constante no `design.md`, incluída na mensagem do WhatsApp_Deep_Link.
- **Auto_Expiracao**: Regra que remove/encerra automaticamente qualquer frete (comunidade ou
  normal) após 5 dias da data de referência de expiração.
- **Data_Referencia_Expiracao**: Timestamp a partir do qual a Auto_Expiracao conta os 5 dias.
  Inicia em `created_at` e é reiniciado para `NOW()` a cada edição de qualquer campo do frete.
- **Stealth_404**: Resposta de "página não encontrada" idêntica ao 404 público para acessos sem
  permissão, sem revelar a existência da rota.
- **Compact_Layout_Pattern**: Padrão visual compacto do painel admin (sem `<h1>` grande,
  paginação 10/50/100 default 10, botões `text-xs`).
- **Admin_Permission**: Permissão admin server-side verificada por `is_admin_with_permission`.
- **executeAdminMutation**: Wrapper de audit-by-construction para mutações admin.

## Requirements

### Requirement 1: Acesso e gating do módulo Frete Comunidade

**User Story:** Como admin autorizado, quero acessar o módulo Frete Comunidade pelo menu
lateral, para gerenciar o perfil e a importação de fretes, sem que admins sem permissão
descubram a existência da rota.

#### Acceptance Criteria

1. THE FreteGO SHALL registrar a rota `/admin/frete-comunidade` renderizando a Admin_Comunidade_Page.
2. THE AdminSidebar SHALL exibir um item "Frete Comunidade" apontando para `/admin/frete-comunidade`, visível apenas para admins com a Admin_Permission de visualização definida no design.
3. WHEN um admin sem a Admin_Permission de visualização acessa `/admin/frete-comunidade`, THE AdminGuard SHALL renderizar Stealth_404.
4. WHEN um acesso a uma RPC do módulo ocorre sem a Admin_Permission requerida, THE FreteGO SHALL gravar um audit log negativo `COMMUNITY_VIEW_DENIED` com `before = NULL` e `after = { user_id, reason: 'permission_denied' }` e SHALL recusar a operação com erro `permission_denied`.
5. IF `auth.uid()` está ausente em qualquer RPC do módulo, THEN THE FreteGO SHALL recusar a operação com erro `permission_denied`.
6. THE Admin_Comunidade_Page SHALL seguir o Compact_Layout_Pattern, sem renderizar `<h1>` grande no topo.

### Requirement 2: Configuração do Perfil Comunidade global

**User Story:** Como admin autorizado, quero configurar uma foto, um nome e um nome
secundário únicos para o perfil comunidade, para que todos os fretes comunidade exibam a
mesma identidade visual ao motorista.

#### Acceptance Criteria

1. THE Admin_Comunidade_Page SHALL exibir um formulário de Comunidade_Profile com: upload de foto, campo de texto "Nome" e campo de texto "Nome secundário".
2. THE Comunidade_Profile SHALL ser uma configuração única e global (no máximo um registro vigente para todo o FreteGO).
3. WHEN o admin salva o Comunidade_Profile, THE FreteGO SHALL persistir foto, nome e nome secundário via executeAdminMutation com action `COMMUNITY_PROFILE_UPDATED`.
4. THE FreteGO SHALL validar, no frontend e no backend, que o campo "Nome" tem entre 1 e 120 caracteres após sanitização.
5. THE FreteGO SHALL validar, no frontend e no backend, que o campo "Nome secundário" tem entre 0 e 160 caracteres após sanitização.
6. WHEN o admin envia a foto, THE FreteGO SHALL aceitar apenas arquivos de imagem com tipo MIME em { image/png, image/jpeg, image/webp } e tamanho até 5 MB.
7. IF o arquivo de foto enviado tem MIME inválido, THEN THE FreteGO SHALL recusar o upload com o error code `INVALID_FILE_TYPE` e exibir mensagem em pt-BR.
8. WHEN o formulário do Comunidade_Profile é submetido com dados inválidos, THE Admin_Comunidade_Page SHALL bloquear o envio E exibir mensagem de erro em pt-BR.
9. WHEN nenhum Comunidade_Profile foi configurado ainda, THE Admin_Comunidade_Page SHALL exibir um estado vazio orientando o admin a configurar o perfil antes de publicar fretes comunidade.

### Requirement 3: Listagem dos fretes comunidade publicados

**User Story:** Como admin autorizado, quero ver a lista dos fretes comunidade já
publicados, para acompanhar o que está no ar.

#### Acceptance Criteria

1. THE Admin_Comunidade_Page SHALL exibir uma lista dos fretes com `source = 'comunidade'`, ordenada por `created_at` decrescente por padrão.
2. THE lista de fretes comunidade SHALL exibir paginação com seletor de tamanho 10/50/100, com padrão 10, seguindo o Compact_Layout_Pattern.
3. THE lista de fretes comunidade SHALL exibir, por linha, ao menos: origem, destino, valor, tipo de produto, Data_Referencia_Expiracao e dias restantes até a Auto_Expiracao.
4. WHEN não existe nenhum Frete_Comunidade publicado, THE Admin_Comunidade_Page SHALL exibir a mensagem "Nenhum frete comunidade publicado." em pt-BR.
5. WHEN o viewport tem largura inferior a 768px, THE lista de fretes comunidade SHALL renderizar uma lista de cards de coluna única.

### Requirement 4: Download do modelo de planilha

**User Story:** Como admin autorizado, quero baixar um modelo de planilha com as colunas
certas, para preencher os fretes coletados sem errar o formato.

#### Acceptance Criteria

1. THE Admin_Comunidade_Page SHALL exibir um botão "Baixar modelo" que faz o download do Modelo_Planilha.
2. THE Modelo_Planilha SHALL conter exatamente as colunas, na ordem: transportadora, origem, destino, local de carregamento, local de descarregamento, valor, tipo de produto, telefone (WhatsApp).
3. THE Modelo_Planilha SHALL incluir uma linha de cabeçalho com os rótulos das colunas em pt-BR e uma linha de exemplo preenchida.
4. WHERE o formato selecionado é CSV, THE Modelo_Planilha SHALL ser gerado com BOM UTF-8, separador `;` e quebra de linha `\r\n`, conforme o padrão de CSV Export do projeto.

### Requirement 5: Upload e parsing da planilha

**User Story:** Como admin autorizado, quero enviar a planilha preenchida e ter o sistema
lendo as linhas, para preparar a publicação dos fretes.

#### Acceptance Criteria

1. THE Admin_Comunidade_Page SHALL exibir um controle de upload que aceita arquivos CSV e XLSX.
2. WHEN o admin envia uma Planilha_Import, THE Import_Parser SHALL ler cada linha de dados e produzir uma Import_Row correspondente.
3. WHERE uma Import_Row possui todos os campos obrigatórios válidos, THE Import_Parser SHALL marcar a Import_Row como válida.
4. IF uma Import_Row possui campo obrigatório faltando ou inválido, THEN THE Import_Parser SHALL marcar a Import_Row como erro e registrar o motivo por campo.
5. THE Import_Parser SHALL tratar como obrigatórios os campos: transportadora, origem, destino, local de carregamento, local de descarregamento, valor, tipo de produto e telefone (WhatsApp).
6. THE Import_Parser SHALL validar que o campo valor é numérico e maior que zero.
7. THE Import_Parser SHALL validar que o campo telefone (WhatsApp) corresponde a um número de telefone brasileiro válido (apenas dígitos após normalização, com DDD).
8. IF a Planilha_Import tem MIME ou extensão fora de { CSV, XLSX }, THEN THE FreteGO SHALL recusar o upload com o error code `INVALID_FILE_TYPE` e exibir mensagem em pt-BR.
9. WHEN o admin envia uma Planilha_Import, THE Template_Validation SHALL verificar que as colunas, a ordem das colunas e o cabeçalho coincidem exatamente com o Modelo_Planilha.
10. IF a Planilha_Import tem colunas faltando, colunas fora de ordem ou cabeçalho diferente do Modelo_Planilha, THEN THE FreteGO SHALL recusar o upload com o error code `INVALID_TEMPLATE` e exibir mensagem em pt-BR orientando o admin a baixar o modelo correto.
11. IF a Planilha_Import não contém nenhuma linha de dados, THEN THE Admin_Comunidade_Page SHALL exibir a mensagem "A planilha não contém fretes." em pt-BR.
12. THE Import_Parser SHALL limitar uma única importação a no máximo 200 Import_Rows.

### Requirement 6: Preview editável da importação com erros destacados

**User Story:** Como admin autorizado, quero ver um preview EDITÁVEL dos fretes lidos, com
as linhas de erro destacadas, e poder corrigir cada célula antes de publicar, para
corrigir problemas (inclusive cidades abreviadas) sem publicar lixo.

#### Acceptance Criteria

1. WHEN o parsing da Planilha_Import termina, THE Preview_Import SHALL listar todas as Import_Rows lidas.
2. THE Preview_Import SHALL permitir ao admin editar célula a célula cada campo de cada Import_Row, incluindo o valor e o tipo de produto, antes de publicar.
3. WHEN o admin edita uma célula de uma Import_Row, THE Preview_Import SHALL revalidar a Import_Row e atualizar seu status (válida, erro, duplicada, cidade pendente).
4. THE Preview_Import SHALL destacar visualmente cada Import_Row marcada como erro e exibir o motivo do erro por campo, em pt-BR.
5. THE Preview_Import SHALL exibir um resumo com a contagem de linhas válidas, linhas com erro, linhas duplicadas e linhas com cidade pendente.
6. THE Preview_Import SHALL ocorrer ANTES de qualquer escrita na tabela `fretes`.
7. WHILE não existe nenhuma Import_Row válida, resolvida e não excluída, THE Preview_Import SHALL desabilitar o botão "Publicar".

### Requirement 7: Detecção e resolução de duplicados na importação

**User Story:** Como admin autorizado, quero que o sistema detecte fretes idênticos na
importação e me deixe escolher excluir ou atualizar, para não poluir o feed com
repetições, mas sem bloquear fretes que diferem em algum campo (ex.: transportadora ou
telefone distintos).

#### Acceptance Criteria

1. THE Preview_Import SHALL detectar como duplicado toda Import_Row cuja Dedup_Key seja igual à Dedup_Key de um frete já existente na tabela `fretes`.
2. THE Dedup_Frete SHALL considerar duplicado SOMENTE quando TODOS os componentes da Dedup_Key coincidem (origem, destino, local de carregamento, local de descarregamento, valor, tipo de produto, transportadora e telefone); se um único componente diferir, a Import_Row NÃO é duplicada.
3. THE Dedup_Frete SHALL comparar a Dedup_Key normalizando cada componente textual com trim, colapso de espaços internos e caixa-baixa (case-insensitive), comparando o valor numericamente e o telefone normalizado (apenas dígitos).
4. WHEN há Import_Rows duplicadas, THE Preview_Import SHALL exibir a contagem no formato "X fretes iguais" em pt-BR.
5. THE Preview_Import SHALL oferecer, para cada duplicado, a escolha entre "Excluir" (não publicar a linha) e "Atualizar" (atualizar o frete existente).
6. WHEN o admin escolhe "Excluir" para um duplicado, THE FreteGO SHALL não publicar a Import_Row correspondente.
7. WHEN o admin escolhe "Atualizar" para um duplicado, THE FreteGO SHALL atualizar os campos do frete existente com os valores da Import_Row E SHALL reiniciar a Data_Referencia_Expiracao para `NOW()`, recomeçando a contagem de 5 dias da Auto_Expiracao.
8. THE Preview_Import SHALL também detectar duplicados internos entre Import_Rows da mesma Planilha_Import (mesma Dedup_Key dentro do arquivo) e tratá-los como duplicados.

### Requirement 8: Publicação em lote dos fretes comunidade

**User Story:** Como admin autorizado, quero publicar todos os fretes válidos de uma vez,
para abastecer o feed rapidamente.

#### Acceptance Criteria

1. THE Preview_Import SHALL exibir um botão "Publicar" que publica todas as Import_Rows válidas, resolvidas e não excluídas em uma única ação.
2. WHEN o admin clica "Publicar", THE FreteGO SHALL inserir cada Import_Row válida como um Frete_Comunidade na tabela `fretes` com `source = 'comunidade'`, via executeAdminMutation com action `COMMUNITY_FRETES_PUBLISHED`.
3. THE FreteGO SHALL publicar apenas Import_Rows cujas cidades de origem e destino estejam resolvidas (City_Resolution concluída), pulando as linhas com cidade pendente.
4. WHEN a publicação envolve duplicados marcados como "Atualizar", THE FreteGO SHALL atualizar os fretes existentes correspondentes em vez de inserir novos.
5. WHEN a publicação termina, THE Admin_Comunidade_Page SHALL exibir uma mensagem de resultado em pt-BR informando quantos fretes foram publicados, quantos atualizados e quantos pulados/erro.
6. THE FreteGO SHALL associar cada Frete_Comunidade ao Comunidade_Profile vigente como autor visual.
7. IF não há Comunidade_Profile configurado no momento da publicação, THEN THE FreteGO SHALL bloquear a publicação e exibir a mensagem "Configure o perfil comunidade antes de publicar." em pt-BR.
8. THE publicação em lote SHALL processar as linhas com um pool de concorrência de no máximo 5, conforme o padrão de bulk do projeto.
9. IF a publicação de uma Import_Row individual falha, THEN THE FreteGO SHALL contabilizá-la como erro no resultado E SHALL prosseguir com as demais linhas.

### Requirement 9: Campos do Frete Comunidade, transportadora e contato WhatsApp

**User Story:** Como admin autorizado, quero que o frete comunidade reaproveite os campos
existentes de frete e armazene a transportadora e um telefone de contato, para que o
motorista veja as mesmas informações, saiba de qual transportadora é o frete e consiga
falar com o anunciante.

#### Acceptance Criteria

1. THE Frete_Comunidade SHALL reaproveitar os campos existentes de `fretes`: `origin` (origem), `destination` (destino), `origin_detail` (local de carregamento), `destination_detail` (local de descarregamento), `value` (valor) e `product` (tipo de produto).
2. THE FreteGO SHALL adicionar à tabela `fretes` uma coluna nova `community_contact_phone` para armazenar o Contato_WhatsApp.
3. THE FreteGO SHALL adicionar à tabela `fretes` uma coluna nova `community_carrier_name` para armazenar o nome da Transportadora.
4. THE FreteGO SHALL adicionar à tabela `fretes` uma coluna nova `source` indicando a origem do frete, com valor padrão correspondente a embarcador para os fretes existentes.
5. WHEN um Frete_Comunidade é publicado, THE FreteGO SHALL gravar `source = 'comunidade'`, `community_carrier_name` com o nome da transportadora da Import_Row e `community_contact_phone` com o telefone normalizado da Import_Row.
6. THE FreteGO SHALL validar, no frontend e no backend, que `community_carrier_name` tem entre 1 e 120 caracteres após sanitização para um Frete_Comunidade.
7. THE migration que adiciona as colunas novas SHALL ser idempotente e acompanhada de um par `_rollback`, com numeração incremental a partir de 061.
8. THE FreteGO SHALL preservar o funcionamento do fluxo atual de embarcador/motorista e dos fretes existentes na tabela `fretes` sem regressão.

### Requirement 10: Exibição e interação do motorista com o Frete Comunidade

**User Story:** Como motorista, quero ver os fretes comunidade no mesmo feed e mapa, com
identidade da comunidade, e conseguir falar pelo WhatsApp, para aproveitar os fretes
sugeridos pela comunidade.

#### Acceptance Criteria

1. THE FreteGO SHALL exibir os Frete_Comunidade no mesmo feed e mapa dos Frete_Normal, para todos os motoristas, sem filtro especial.
2. WHERE um frete é um Frete_Comunidade, THE card SHALL exibir, no lugar do nome/empresa do embarcador, a foto do Comunidade_Profile, o título "Frete Comunidade" e, em fonte menor, o texto "Frete sugerido pela comunidade".
3. WHEN o motorista abre o modal de um Frete_Comunidade, THE FreteGO SHALL exibir rota, valor, tipo de produto e o frete-retorno no lado esquerdo do modal, do mesmo modo que para um Frete_Normal.
4. WHERE o frete aberto é um Frete_Comunidade, THE modal SHALL exibir o nome da Transportadora (`community_carrier_name`) daquele frete, além do título "Frete Comunidade" e do texto "Frete sugerido pela comunidade".
5. WHERE o frete aberto é um Frete_Normal, THE modal SHALL exibir o botão "Chat".
6. WHERE o frete aberto é um Frete_Comunidade, THE modal SHALL exibir o botão "WhatsApp" no lugar do botão "Chat".
7. WHEN o motorista clica no botão "WhatsApp" de um Frete_Comunidade, THE FreteGO SHALL abrir o WhatsApp_Deep_Link para o `community_contact_phone` da Transportadora, com a mensagem pré-preenchida "Olá, vim pelo FreteGO (FreteGO_Domain). Seu frete foi sugerido pela comunidade, gostaria de mais informações.", onde FreteGO_Domain é o link do domínio do FreteGO (ex.: `https://www.fretegobr.com.br`).
8. IF um Frete_Comunidade não possui `community_contact_phone` válido, THEN THE FreteGO SHALL ocultar o botão "WhatsApp" e exibir uma indicação de contato indisponível em pt-BR.

### Requirement 11: Auto-expiração de fretes em 5 dias (todos os fretes)

**User Story:** Como dono do FreteGO, quero que todo frete expire automaticamente após 5
dias e que a contagem reinicie quando o frete for editado, para manter o feed atualizado
sem fretes velhos.

#### Acceptance Criteria

1. WHEN se passam 5 dias a partir da Data_Referencia_Expiracao de um frete, THE FreteGO SHALL remover/encerrar o frete automaticamente, tornando-o invisível no feed e no mapa do motorista.
2. THE Auto_Expiracao SHALL aplicar-se igualmente a Frete_Comunidade e a Frete_Normal.
3. THE Data_Referencia_Expiracao de um frete SHALL iniciar igual ao seu `created_at`.
4. WHEN qualquer campo de um frete é editado, THE FreteGO SHALL reiniciar a Data_Referencia_Expiracao para `NOW()`, recomeçando a contagem de 5 dias.
5. WHILE um frete está dentro da janela de 5 dias a partir da Data_Referencia_Expiracao, THE FreteGO SHALL manter o frete visível no feed e no mapa.
6. THE FreteGO SHALL aplicar a Auto_Expiracao de forma idempotente, de modo que reprocessar a expiração de um frete já expirado não altere o estado final.

### Requirement 12: Bloqueio de fretes duplicados na criação (todos os fretes)

**User Story:** Como dono do FreteGO, quero impedir a criação de fretes idênticos, mas
permitir que várias transportadoras anunciem o mesmo trajeto, para refletir a realidade
do mercado sem repetir o exato mesmo frete no feed.

#### Acceptance Criteria

1. WHEN um frete novo é criado, THE FreteGO SHALL calcular a Dedup_Key a partir de TODOS os campos significativos: origem, destino, local de carregamento, local de descarregamento, valor, tipo de produto, transportadora (`community_carrier_name`) e telefone (`community_contact_phone`).
2. IF já existe um frete ativo com a mesma Dedup_Key (TODOS os componentes coincidem), THEN THE FreteGO SHALL bloquear a criação do frete novo.
3. WHERE um frete novo difere de um frete existente em ao menos um componente da Dedup_Key, THE FreteGO SHALL permitir a criação, mesmo que origem, destino e locais coincidam (ex.: transportadora ou telefone diferentes).
4. THE Dedup_Frete SHALL aplicar-se tanto a Frete_Comunidade quanto a Frete_Normal.
5. WHEN a criação é bloqueada por duplicidade, THE FreteGO SHALL exibir mensagem canônica anti-enumeração em pt-BR, sem revelar dados do frete existente.
6. THE Dedup_Frete SHALL comparar a Dedup_Key com normalização consistente (componentes textuais com trim, colapso de espaços internos e case-insensitive; valor numérico; telefone apenas dígitos), igual à usada na importação (Requisito 7).

### Requirement 13: Escopo futuro — algoritmo de recomendação do feed (NÃO implementar)

**User Story:** Como dono do FreteGO, quero registrar o algoritmo de recomendação do feed
como escopo futuro, para deixar claro que não faz parte desta entrega.

#### Acceptance Criteria

1. THE FreteGO SHALL tratar o algoritmo de recomendação/ordenação do feed (preferências do motorista por tipo de carga/região/empresa, compatibilidade com o tipo de caminhão e embaralhamento de ordem) como escopo futuro, fora desta spec.
2. THE Frete_Comunidade SHALL ser distribuído para todos os motoristas sem aplicação de algoritmo de recomendação.
3. WHERE o algoritmo de recomendação vier a ser implementado no futuro, THE FreteGO SHALL aplicá-lo ao par motorista+embarcador real, não ao Frete_Comunidade.

### Requirement 14: Desligamento da feature

**User Story:** Como admin autorizado, quero poder desligar a feature Frete Comunidade
quando houver embarcadores reais suficientes, para remover a muleta de lançamento.

#### Acceptance Criteria

1. THE FreteGO SHALL prover um controle administrativo para habilitar/desabilitar a feature Frete Comunidade globalmente.
2. WHILE a feature Frete Comunidade está desabilitada, THE FreteGO SHALL ocultar os Frete_Comunidade do feed e do mapa do motorista.
3. WHILE a feature Frete Comunidade está desabilitada, THE Admin_Comunidade_Page SHALL bloquear novas publicações de Frete_Comunidade.
4. WHEN a feature Frete Comunidade é reabilitada, THE FreteGO SHALL voltar a exibir os Frete_Comunidade ativos e não expirados.

### Requirement 15: Resolução de cidade (geocoding) obrigatória no preview editável

**User Story:** Como admin autorizado, quero corrigir as cidades abreviadas vindas dos
grupos de WhatsApp usando autocomplete de localidade no preview editável, para que o
sistema reconheça as cidades e calcule a distância (km) da rota antes de publicar.

#### Acceptance Criteria

1. THE Preview_Import SHALL prover, nos campos de cidade de origem e de destino de cada Import_Row, um City_Autocomplete que sugere localidades conforme o admin digita.
2. WHEN o admin seleciona uma sugestão do City_Autocomplete, THE FreteGO SHALL executar a City_Resolution, obtendo as coordenadas (Geocoding) da localidade selecionada.
3. THE FreteGO SHALL reaproveitar o mecanismo de seleção/geocoding de cidade já usado no fluxo do embarcador, se existir (o `design.md` confirma qual mecanismo).
4. THE Preview_Import SHALL indicar visualmente, por Import_Row, se a cidade de origem e a cidade de destino estão RESOLVIDAS ou ainda PENDENTES.
5. WHILE a cidade de origem ou a cidade de destino de uma Import_Row está pendente (não resolvida), THE Preview_Import SHALL marcar a Import_Row com status "cidade pendente" e SHALL bloquear a publicação dessa Import_Row.
6. IF uma cidade abreviada não corresponde a nenhuma localidade reconhecível, THEN THE Preview_Import SHALL manter a Import_Row como "cidade pendente" e exibir orientação em pt-BR para o admin corrigir a cidade.
7. WHEN as cidades de origem e destino de uma Import_Row estão resolvidas, THE FreteGO SHALL usar as coordenadas resultantes para calcular a distância (km) da rota do frete.
8. THE Preview_Import SHALL habilitar a publicação de uma Import_Row somente quando ela está válida E com origem e destino resolvidas.

## Notas de Governança de Testes

Conforme `testing-governance.md`, as seguintes invariantes são candidatas obrigatórias a
property-based testing (a serem detalhadas como Correctness Properties no `design.md`):

- **Round-trip da planilha (parser/printer)**: gerar Modelo_Planilha → preencher →
  Import_Parser deve reproduzir as linhas equivalentes (parsers sempre exigem round-trip).
- **Dedup_Frete idempotente e simétrico**: a Dedup_Key é estável sob normalização; duas
  entradas equivalentes sempre colidem; reaplicar a detecção não muda o conjunto detectado.
- **Auto_Expiracao**: invariante de visibilidade (visível sse e somente se
  `NOW() < Data_Referencia_Expiracao + 5 dias`) e idempotência do reprocessamento.
- **Template_Validation (caminho negativo)**: planilha com coluna faltando, fora de ordem
  ou cabeçalho diferente do Modelo_Planilha SEMPRE falha com `INVALID_TEMPLATE`.
- **City_Resolution como pré-condição**: nenhuma Import_Row com cidade pendente pode ser
  publicada; o cálculo de km só ocorre quando origem e destino estão resolvidas.

Critérios de aceite obrigatórios (CPs) NÃO recebem asterisco; critérios opcionais recebem
asterisco, conforme convenção do projeto.
