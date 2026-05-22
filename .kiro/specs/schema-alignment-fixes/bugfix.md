# Bugfix Requirements Document

## Introduction

Este documento captura múltiplos bugs relacionados ao desalinhamento entre o código TypeScript da aplicação FreteGO e o schema do banco de dados Supabase. O usuário relata que praticamente todas as operações principais da aplicação falham: cadastro retorna erro 422 (mas às vezes salva mesmo assim), upload de foto de perfil não funciona, atualização de dados pessoais não persiste, motoristas não conseguem ver o valor dos fretes, upload de documentos do motorista não salva, criação de fretes resulta em 401 Unauthorized e tabelas de chat retornam 406 Not Acceptable.

A investigação técnica identificou 15 inconsistências distintas entre código e banco que se manifestam como esses 7 sintomas. As causas-raiz são:

- Migrations corretivas (004, 006, 007, 008) podem não ter sido aplicadas ou foram aplicadas parcialmente
- Duas implementações conflitantes de chat usando tabelas diferentes (`chat_conversations` vs `conversations`)
- CHECK constraints do banco rejeitam tipos de documento que o frontend tenta enviar
- Políticas RLS dependem de registros em tabelas-filhas que podem não existir
- Fluxo de cadastro não é transacional, podendo deixar dados parcialmente criados
- Mapeamento de colunas entre serviços TypeScript e tabelas do Postgres está incompleto

A correção exige uma migration consolidada idempotente que garanta o estado correto do schema, alinhamento das constantes de tipo no código TypeScript com os CHECK constraints do banco, ajuste das políticas RLS para serem permissivas o suficiente para os fluxos legítimos, tornar o fluxo de cadastro transacional e completar o mapeamento de colunas (`profile_photo_url`, `status` de documento, etc).

A metodologia de bug condition `C(X)` é usada para garantir que apenas os fluxos quebrados sejam corrigidos enquanto todos os fluxos que já funcionam continuem funcionando.

## Bug Analysis

### Current Behavior (Defect)

O comportamento atual abaixo descreve o que está quebrado em cada bug identificado.

**Bug 1 — Chat duplicado em duas tabelas**

1.1 QUANDO o frontend acessa o chat de suporte (chat.ts) via tabela `chat_conversations` ou o chat de frete (chatFrete.ts) via tabela `conversations` E uma das migrations (001 ou 008) não foi aplicada ENTÃO o sistema retorna 406 Not Acceptable porque a tabela esperada não existe ou está sem RLS configurada corretamente.

**Bug 2 — Colunas de veículo ausentes em motoristas**

1.2 QUANDO o frontend chama `updateMotoristaProfile` com `vehiclePlate`, `vehicleModel` ou `vehicleYear` E a migration 004 não foi aplicada ENTÃO o sistema retorna erro do Postgres "column does not exist" porque a tabela `motoristas` não tem essas colunas.

**Bug 3 — CHECK constraint de document_type incompatível**

1.3 QUANDO o motorista tenta fazer upload de um documento com tipo `crlv_cavalo`, `rntrc_cavalo`, `foto_segurando_cnh`, `foto_frente_caminhao`, `comprovante_endereco_proprietario`, `comprovante_endereco_motorista`, `foto_caminhao_completo`, `crlv_carreta_1` a `crlv_carreta_4` ou `rntrc_carreta_1` a `rntrc_carreta_2` ENTÃO o sistema rejeita a inserção com violação do CHECK constraint `documents_document_type_check` porque esses tipos não estão na lista permitida pelo banco.

**Bug 4 — RLS de fretes exige registro em embarcadores**

1.4 QUANDO um usuário com `user_type = 'embarcador'` tenta criar um frete E não existe registro correspondente em `embarcadores` (porque o cadastro falhou parcialmente ou a migration 006 não foi aplicada) ENTÃO o sistema retorna 401 Unauthorized porque a política `fretes_insert_policy` faz `EXISTS (SELECT 1 FROM embarcadores WHERE id = auth.uid())`.

**Bug 5 — Cadastro não-transacional**

1.5 QUANDO o usuário se cadastra e a inserção em `users` tem sucesso mas a inserção subsequente em `motoristas` ou `embarcadores` falha ENTÃO o sistema deixa o usuário em estado inconsistente (existe em `users` mas não na tabela específica) e o login posterior falha em operações que dependem do registro filho.

**Bug 6 — profile_photo no CHECK constraint**

1.6 QUANDO o embarcador faz upload da foto de perfil com tipo `profile_photo` E a migration 004 não foi aplicada ENTÃO o sistema rejeita a inserção porque o CHECK constraint original (`'cpf' | 'cnh' | 'antt' | 'vehicle' | 'photo'`) não inclui `profile_photo`.

**Bug 7 — profile_photo_url não é atualizado**

1.7 QUANDO o usuário faz upload de uma nova foto de perfil ENTÃO o registro é criado em `documents` mas a coluna `users.profile_photo_url` não é atualizada, fazendo com que o avatar não apareça em outras telas que leem diretamente de `users.profile_photo_url`.

**Bug 8 — Erro silencioso ao buscar fretes**

1.8 QUANDO `getActiveFretes` recebe um erro do Supabase com mensagem contendo "lock" ou "auth" ou código `PGRST301` ENTÃO o sistema retorna `[]` silenciosamente, sem propagar o erro para o usuário, ocultando problemas reais de RLS ou autenticação.

**Bug 9 — RLS de chat_conversations excessivamente restritiva**

1.9 QUANDO o usuário tenta acessar `chat_conversations` E a migration 003 foi aplicada mas a coluna `user_id` do registro não corresponde exatamente a `auth.uid()` por algum desalinhamento ENTÃO o sistema retorna 406 Not Acceptable bloqueando todo o fluxo de chat de suporte.

**Bug 10 — Parâmetro inconsistente em increment_frete_views**

1.10 QUANDO o frontend chama `supabase.rpc('increment_frete_views', { frete_id_param: ... })` E a função no banco está definida com nome diferente (`p_frete_id` vs `frete_id_param`) ENTÃO o sistema retorna erro 404 (function not found) ou inválido por parâmetro desconhecido.

**Bug 11 — Status de documento não mapeado**

1.11 QUANDO o frontend lê documentos via `documents.ts` ENTÃO os campos `status`, `rejection_reason`, `reviewed_by`, `reviewed_at` (adicionados pela migration 007) não são mapeados na interface `DocumentMetadata`, então o status fica indisponível para a UI mesmo quando existe no banco.

**Bug 12 — Falta validação client-side de tipos de documento**

1.12 QUANDO o frontend permite passar qualquer string como `documentType` no upload (via cast `as any` em `MotoristaPerfilPage`) E o tipo não é compatível com o CHECK constraint do banco ENTÃO o erro só é detectado no servidor com mensagem genérica de violação de constraint, dificultando o feedback ao usuário.

**Bug 13 — RLS bloqueia admin de ver documentos**

1.13 QUANDO o admin acessa o painel para aprovar documentos E a política `documents_select_policy` da migration 003 ou 004 está em conflito com a política da migration 007 (que tenta adicionar UPDATE para admin) ENTÃO o admin pode não conseguir visualizar todos os documentos pendentes para revisão.

**Bug 14 — Índices ausentes em queries comuns**

1.14 QUANDO o sistema executa queries frequentes em `documents` filtrando por `(user_id, document_type, status)` ou em `conversations` filtrando por `(motorista_id, embarcador_id)` E os índices compostos correspondentes não existem ENTÃO o tempo de resposta degrada conforme o volume de dados cresce.

**Bug 15 — Tratamento de erro genérico em chat**

1.15 QUANDO uma operação de chat falha por permissão, validação ou rede ENTÃO o sistema lança `Error('Erro ao ...')` com a mensagem original do Supabase concatenada, sem código de erro estruturado, dificultando a distinção entre erro de RLS (recuperável via re-login) e erro de rede (recuperável via retry).

### Expected Behavior (Correct)

O comportamento esperado abaixo corresponde clausula-a-clausula ao defeito documentado em cada item de 1.X.

**Correção Bug 1 — Chat com tabelas garantidas**

2.1 QUANDO o frontend acessa o chat de suporte ou o chat de frete ENTÃO o sistema DEVE garantir que ambas as tabelas (`chat_conversations`/`chat_messages` para suporte e `conversations`/`messages` para chat de frete) existam, tenham RLS habilitada e políticas funcionais aplicadas via migration consolidada idempotente.

**Correção Bug 2 — Colunas de veículo presentes**

2.2 QUANDO o frontend chama `updateMotoristaProfile` com `vehiclePlate`, `vehicleModel` ou `vehicleYear` ENTÃO o sistema DEVE persistir os valores nas colunas correspondentes da tabela `motoristas`, garantidas via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` na migration consolidada.

**Correção Bug 3 — CHECK constraint completo**

2.3 QUANDO o motorista tenta fazer upload de um documento com qualquer tipo válido do conjunto declarado em `MotoristaPerfilPage.tsx` (incluindo todos os tipos `crlv_*`, `rntrc_*`, `cnh`, `foto_segurando_cnh`, `foto_frente_caminhao`, `comprovante_endereco_*`, `foto_caminhao_completo`, `profile_photo`) ENTÃO o sistema DEVE aceitar a inserção, com o CHECK constraint atualizado para incluir todos esses tipos e o tipo `DocumentType` em `documents.ts` alinhado com o constraint.

**Correção Bug 4 — RLS de fretes pragmática**

2.4 QUANDO um usuário com `user_type = 'embarcador'` tenta criar um frete ENTÃO o sistema DEVE permitir a inserção desde que `embarcador_id = auth.uid()` e o usuário seja do tipo embarcador, e DEVE garantir que existe um registro em `embarcadores` para todos os usuários com `user_type = 'embarcador'` via backfill na migration consolidada.

**Correção Bug 5 — Cadastro transacional**

2.5 QUANDO o usuário se cadastra ENTÃO o sistema DEVE garantir que o registro só existe em `users` se também existir o registro correspondente em `motoristas` ou `embarcadores`, fazendo rollback compensatório em caso de falha (deletar `users` se a inserção subsequente falhar) ou usando uma RPC transacional no Postgres.

**Correção Bug 6 — profile_photo aceito**

2.6 QUANDO o embarcador faz upload da foto de perfil com tipo `profile_photo` ENTÃO o sistema DEVE aceitar a inserção (consequência direta da correção 2.3).

**Correção Bug 7 — profile_photo_url sincronizado**

2.7 QUANDO o usuário faz upload de uma nova foto de perfil (`document_type = 'profile_photo'`) ENTÃO o sistema DEVE atualizar `users.profile_photo_url` com a URL ou path do arquivo recém-enviado, seja via trigger no Postgres ou via passo adicional no `uploadDocument` quando o tipo for `profile_photo`.

**Correção Bug 8 — Erro propagado**

2.8 QUANDO `getActiveFretes` recebe um erro do Supabase ENTÃO o sistema DEVE registrar o erro com detalhes em log e propagar uma exceção tipada (ou retornar um resultado discriminado com erro) para que a UI possa exibir mensagem ao usuário, em vez de mascarar com array vazio.

**Correção Bug 9 — RLS de chat_conversations operacional**

2.9 QUANDO o usuário tenta acessar `chat_conversations` ENTÃO o sistema DEVE permitir SELECT/INSERT/UPDATE para o próprio `user_id = auth.uid()` (e admin), com a política RLS reaplicada de forma idempotente na migration consolidada.

**Correção Bug 10 — Parâmetro consistente**

2.10 QUANDO o frontend chama `supabase.rpc('increment_frete_views', { frete_id_param: ... })` ENTÃO o sistema DEVE executar a função com sucesso, com a função no banco usando exatamente o nome de parâmetro `frete_id_param` (recriada via `CREATE OR REPLACE FUNCTION` na migration consolidada).

**Correção Bug 11 — Status mapeado**

2.11 QUANDO o frontend lê documentos via `documents.ts` ENTÃO o sistema DEVE mapear `status`, `rejection_reason`, `reviewed_by`, `reviewed_at` na interface `DocumentMetadata` e em todas as funções de leitura (`getDocumentsByUser`, `getDocumentByType`).

**Correção Bug 12 — Validação client-side**

2.12 QUANDO o frontend tenta fazer upload de documento ENTÃO o sistema DEVE validar `documentType` contra a lista canônica de tipos antes de chamar o backend, com mensagem de erro específica em português caso o tipo seja inválido.

**Correção Bug 13 — Admin enxerga documentos**

2.13 QUANDO o admin acessa o painel para aprovar documentos ENTÃO o sistema DEVE permitir SELECT em todos os registros de `documents` para usuários com `user_type = 'admin'`, com políticas RLS unificadas e não-conflitantes na migration consolidada.

**Correção Bug 14 — Índices presentes**

2.14 QUANDO o sistema executa queries frequentes em `documents (user_id, document_type, status)` ou em `conversations (motorista_id, embarcador_id)` ENTÃO o sistema DEVE usar índices compostos criados de forma idempotente (`CREATE INDEX IF NOT EXISTS`) na migration consolidada.

**Correção Bug 15 — Erros estruturados em chat**

2.15 QUANDO uma operação de chat falha ENTÃO o sistema DEVE lançar uma `ChatError` tipada com `code` discriminado (`PERMISSION_DENIED`, `NOT_FOUND`, `NETWORK_ERROR`, `VALIDATION_ERROR`, `UNKNOWN`) e mensagem em português, similar ao padrão já usado em `DocumentError`.

### Unchanged Behavior (Regression Prevention)

O comportamento abaixo já funciona ou é regulado por outras specs e DEVE CONTINUAR funcionando após as correções.

**Autenticação e segurança**

3.1 QUANDO um usuário válido faz login com telefone e senha corretos ENTÃO o sistema DEVE CONTINUAR retornando o `AuthResponse` com `accessToken`, `refreshToken` e o objeto `User`.

3.2 QUANDO um usuário tenta login com credenciais inválidas ENTÃO o sistema DEVE CONTINUAR retornando o erro genérico anti-enumeração `Credenciais inválidas` com tempo mínimo de resposta de 500ms.

3.3 QUANDO o sistema valida senha no cadastro ENTÃO o sistema DEVE CONTINUAR aplicando todas as regras existentes de `validatePassword` (comprimento, complexidade, etc).

3.4 QUANDO o sistema processa requisições autenticadas ENTÃO o sistema DEVE CONTINUAR usando `auth.uid()` do JWT do Supabase para identificar o usuário em todas as políticas RLS.

**Fretes — leitura e CRUD**

3.5 QUANDO um visitante anônimo acessa a listagem pública de fretes ENTÃO o sistema DEVE CONTINUAR retornando apenas fretes com `status = 'ativo'` (mascarando o valor para não-autenticados em `FreteCard`).

3.6 QUANDO um embarcador autenticado lista seus próprios fretes via `getFretesByEmbarcador` ENTÃO o sistema DEVE CONTINUAR retornando todos os fretes do embarcador independente do status.

3.7 QUANDO o motorista clica em um frete ENTÃO o sistema DEVE CONTINUAR registrando o clique via RPC `record_frete_click` e incrementando o contador.

3.8 QUANDO um usuário autenticado visualiza um frete ENTÃO o sistema DEVE CONTINUAR exibindo todos os campos do frete corretamente, incluindo `value` formatado em BRL no `FreteCard`.

3.9 QUANDO um embarcador edita um frete que ele criou ENTÃO o sistema DEVE CONTINUAR permitindo a atualização via `updateFrete` e a política `fretes_update_policy`.

**Geolocalização e cálculo**

3.10 QUANDO o frontend faz geocoding de origem/destino ENTÃO o sistema DEVE CONTINUAR usando `geocodeAddress` e armazenando como `POINT(longitude latitude)` em PostGIS.

3.11 QUANDO o frontend busca fretes próximos via `findNearbyFretes` ENTÃO o sistema DEVE CONTINUAR usando a função PostGIS `find_nearby_fretes` com raio em km e ordenação por distância.

**Documentos — fluxo já funcional**

3.12 QUANDO o usuário faz upload de qualquer documento dentro do conjunto válido ENTÃO o sistema DEVE CONTINUAR salvando o arquivo no Supabase Storage bucket `documents` com o path `{userId}/{tipo}_{timestamp}.{ext}`.

3.13 QUANDO o usuário lista seus próprios documentos ENTÃO o sistema DEVE CONTINUAR retornando apenas os documentos do `auth.uid()` (filtro por RLS).

3.14 QUANDO o usuário deleta um documento próprio que não está aprovado ENTÃO o sistema DEVE CONTINUAR deletando do Storage e do banco em ordem.

3.15 QUANDO o frontend gera URL assinada para um documento ENTÃO o sistema DEVE CONTINUAR usando `createSignedUrl` com expiração padrão de 3600s.

**Perfil — campos já mapeados**

3.16 QUANDO o motorista atualiza apenas `name`, `email`, `cpf` (sem mexer em campos de veículo ou foto) ENTÃO o sistema DEVE CONTINUAR persistindo essas mudanças em `users` corretamente.

3.17 QUANDO o embarcador atualiza `name`, `email`, `companyName`, `whatsapp` ENTÃO o sistema DEVE CONTINUAR persistindo essas mudanças nas tabelas correspondentes.

3.18 QUANDO o motorista cadastra ou atualiza seu PIS via `motorista_pis` ENTÃO o sistema DEVE CONTINUAR aceitando a operação com a RLS da migration 007.

**Avaliações e ratings**

3.19 QUANDO um motorista avalia um embarcador ENTÃO o sistema DEVE CONTINUAR criando o registro em `avaliacoes` respeitando a constraint UNIQUE `(embarcador_id, motorista_id)`.

3.20 QUANDO o frontend lê avaliações públicas ENTÃO o sistema DEVE CONTINUAR retornando todas via `avaliacoes_select_policy` com `USING (true)`.

**Notificações e admin**

3.21 QUANDO o admin acessa o painel administrativo ENTÃO o sistema DEVE CONTINUAR retornando todos os registros visíveis via `EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')`.

3.22 QUANDO uma notificação é criada para o usuário ENTÃO o sistema DEVE CONTINUAR persistindo em `notifications` e exibindo no `NotificationBell`.

**Idempotência da migration**

3.23 QUANDO a migration consolidada é executada mais de uma vez no mesmo ambiente ENTÃO o sistema DEVE garantir que cada execução resulta no mesmo estado final, sem erros de "objeto já existe" (uso de `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `CREATE OR REPLACE`).

3.24 QUANDO a migration consolidada é executada em um ambiente onde nenhuma das migrations corretivas (004, 006, 007, 008) foi aplicada ENTÃO o sistema DEVE alcançar o mesmo estado final que um ambiente onde todas elas foram aplicadas em sequência.

## Bug Conditions e Propriedades (Pseudocódigo)

A seguir, as bug conditions formais para cada bug, expressas em pseudocódigo. F representa o sistema antes da correção, F' representa o sistema após a correção.

### Bug 1 — Chat duplicado

```pascal
FUNCTION isBugCondition_1(X)
  INPUT: X = (operation, table_name)
  OUTPUT: boolean

  RETURN (X.table_name IN {'chat_conversations', 'chat_messages',
                           'conversations', 'messages'})
     AND (table_does_not_exist(X.table_name) OR rls_misconfigured(X.table_name))
END FUNCTION

// Property: Fix Checking
FOR ALL X WHERE isBugCondition_1(X) DO
  result ← F'(X)
  ASSERT result.success = true AND no_406_error(result)
END FOR
```

### Bug 2 — Colunas de veículo ausentes

```pascal
FUNCTION isBugCondition_2(X)
  INPUT: X = (userId, updateData)
  OUTPUT: boolean

  RETURN (X.updateData has_field 'vehiclePlate' OR
          X.updateData has_field 'vehicleModel' OR
          X.updateData has_field 'vehicleYear')
     AND column_missing('motoristas', X.updateData.field_name)
END FUNCTION

FOR ALL X WHERE isBugCondition_2(X) DO
  result ← F'(updateMotoristaProfile, X)
  ASSERT result.success = true AND persisted_value_matches(X.updateData)
END FOR
```

### Bug 3 — CHECK constraint incompleto

```pascal
FUNCTION isBugCondition_3(X)
  INPUT: X = (userId, documentType, file)
  OUTPUT: boolean

  VALID_TYPES ← {'cpf', 'cnh', 'antt', 'vehicle_registration',
                 'vehicle_insurance', 'profile_photo',
                 'crlv_cavalo', 'crlv_carreta_1', 'crlv_carreta_2',
                 'crlv_carreta_3', 'crlv_carreta_4',
                 'rntrc_cavalo', 'rntrc_carreta_1', 'rntrc_carreta_2',
                 'foto_segurando_cnh', 'foto_frente_caminhao',
                 'comprovante_endereco_proprietario',
                 'comprovante_endereco_motorista',
                 'foto_caminhao_completo'}

  RETURN X.documentType IN VALID_TYPES
     AND check_constraint_rejects(X.documentType)
END FUNCTION

FOR ALL X WHERE isBugCondition_3(X) DO
  result ← F'(uploadDocument, X)
  ASSERT result.success = true AND record_persisted(result.id)
END FOR
```

### Bug 4 — RLS de fretes

```pascal
FUNCTION isBugCondition_4(X)
  INPUT: X = (userId, freteData)
  OUTPUT: boolean

  RETURN user_type(X.userId) = 'embarcador'
     AND X.freteData.embarcadorId = X.userId
     AND NOT exists_in_table('embarcadores', X.userId)
END FUNCTION

FOR ALL X WHERE isBugCondition_4(X) DO
  result ← F'(createFrete, X)
  ASSERT result.success = true AND no_401_error(result)
END FOR
```

### Bug 5 — Cadastro transacional

```pascal
FUNCTION isBugCondition_5(X)
  INPUT: X = (registerData, simulated_failure_point)
  OUTPUT: boolean

  RETURN X.simulated_failure_point IN {'after_users_insert',
                                       'during_motoristas_insert',
                                       'during_embarcadores_insert'}
END FUNCTION

FOR ALL X WHERE isBugCondition_5(X) DO
  result ← F'(register, X)
  ASSERT result.success = false IMPLIES NOT exists_in_table('users', X.userId)
  ASSERT result.success = true IMPLIES
         exists_in_table('users', X.userId) AND
         (exists_in_table('motoristas', X.userId) OR
          exists_in_table('embarcadores', X.userId))
END FOR
```

### Bug 6 — profile_photo no constraint

Subset de Bug 3 com `documentType = 'profile_photo'`.

### Bug 7 — profile_photo_url sincronizado

```pascal
FUNCTION isBugCondition_7(X)
  INPUT: X = (userId, file)
  OUTPUT: boolean

  RETURN true   // toda upload de profile_photo dispara o bug
END FUNCTION

FOR ALL X WHERE isBugCondition_7(X) DO
  result ← F'(uploadDocument(X.userId, 'profile_photo', X.file))
  ASSERT result.success = true
  ASSERT users_table.profile_photo_url(X.userId) IS NOT NULL
  ASSERT users_table.profile_photo_url(X.userId) corresponds_to result.fileName
END FOR
```

### Bug 8 — Erro silencioso

```pascal
FUNCTION isBugCondition_8(X)
  INPUT: X = (filters, simulated_supabase_error)
  OUTPUT: boolean

  RETURN X.simulated_supabase_error.message contains_any {'lock', 'auth'}
     OR X.simulated_supabase_error.code = 'PGRST301'
END FUNCTION

FOR ALL X WHERE isBugCondition_8(X) DO
  result ← F'(getActiveFretes, X)
  ASSERT raises_exception(result) OR returns_error_discriminator(result)
  ASSERT NOT (result = [] AND no_log_emitted())
END FOR
```

### Bug 9 — RLS chat_conversations

```pascal
FUNCTION isBugCondition_9(X)
  INPUT: X = (userId, operation)
  OUTPUT: boolean

  RETURN X.operation IN {'select', 'insert', 'update'}
     AND X.userId = auth.uid()
     AND target_row.user_id = X.userId
     AND policy_blocks(X)
END FUNCTION

FOR ALL X WHERE isBugCondition_9(X) DO
  result ← F'(chat_operation, X)
  ASSERT result.success = true
END FOR
```

### Bug 10 — Parâmetro RPC

```pascal
FUNCTION isBugCondition_10(X)
  INPUT: X = (freteId, parameter_name)
  OUTPUT: boolean

  RETURN X.parameter_name = 'frete_id_param'
     AND function_signature_mismatch('increment_frete_views', X.parameter_name)
END FUNCTION

FOR ALL X WHERE isBugCondition_10(X) DO
  result ← F'(rpc('increment_frete_views', { frete_id_param: X.freteId }))
  ASSERT result.success = true
  ASSERT views_count_incremented(X.freteId)
END FOR
```

### Bug 11 — Status não mapeado

```pascal
FUNCTION isBugCondition_11(X)
  INPUT: X = (userId, documentRow_with_status)
  OUTPUT: boolean

  RETURN X.documentRow.status IS NOT NULL
END FUNCTION

FOR ALL X WHERE isBugCondition_11(X) DO
  result ← F'(getDocumentsByUser, X.userId)
  ASSERT result[i].status = X.documentRow.status FOR ALL matching i
  ASSERT result[i].rejectionReason mapped FOR rejected docs
END FOR
```

### Bug 12 — Validação client-side

```pascal
FUNCTION isBugCondition_12(X)
  INPUT: X = (documentType_string)
  OUTPUT: boolean

  RETURN X.documentType_string NOT IN canonical_types_list
END FUNCTION

FOR ALL X WHERE isBugCondition_12(X) DO
  result ← F'(uploadDocument, X)
  ASSERT raises_typed_error(result, 'INVALID_DOCUMENT_TYPE')
  ASSERT NO server_call_made
END FOR
```

### Bug 13 — Admin RLS documentos

```pascal
FUNCTION isBugCondition_13(X)
  INPUT: X = (adminUserId, documentId)
  OUTPUT: boolean

  RETURN user_type(X.adminUserId) = 'admin'
     AND document_owner(X.documentId) != X.adminUserId
END FUNCTION

FOR ALL X WHERE isBugCondition_13(X) DO
  result ← F'(getDocument, X)
  ASSERT result.success = true
  ASSERT result.data IS NOT NULL
END FOR
```

### Bug 14 — Índices ausentes

```pascal
FUNCTION isBugCondition_14(X)
  INPUT: X = (table_name, columns)
  OUTPUT: boolean

  RETURN (X.table_name, X.columns) IN {
    ('documents', ['user_id', 'document_type', 'status']),
    ('conversations', ['motorista_id', 'embarcador_id'])
  }
  AND NOT index_exists(X.table_name, X.columns)
END FUNCTION

FOR ALL X WHERE isBugCondition_14(X) DO
  result ← F'(after_migration, X)
  ASSERT index_exists(X.table_name, X.columns)
END FOR
```

### Bug 15 — Erros tipados em chat

```pascal
FUNCTION isBugCondition_15(X)
  INPUT: X = (operation, simulated_error)
  OUTPUT: boolean

  RETURN X.operation IN chat_operations
     AND X.simulated_error IS NOT NULL
END FUNCTION

FOR ALL X WHERE isBugCondition_15(X) DO
  result ← F'(operation, X)
  ASSERT raised_error instance_of ChatError
  ASSERT raised_error.code IN {'PERMISSION_DENIED', 'NOT_FOUND',
                                'NETWORK_ERROR', 'VALIDATION_ERROR', 'UNKNOWN'}
END FOR
```

### Propriedade Geral de Preservação

```pascal
// Para todos os inputs que NÃO disparam nenhum dos bugs acima,
// o sistema corrigido deve se comportar identicamente ao original.
FOR ALL X WHERE NOT (isBugCondition_1(X) OR isBugCondition_2(X) OR
                     isBugCondition_3(X) OR isBugCondition_4(X) OR
                     isBugCondition_5(X) OR isBugCondition_6(X) OR
                     isBugCondition_7(X) OR isBugCondition_8(X) OR
                     isBugCondition_9(X) OR isBugCondition_10(X) OR
                     isBugCondition_11(X) OR isBugCondition_12(X) OR
                     isBugCondition_13(X) OR isBugCondition_14(X) OR
                     isBugCondition_15(X)) DO
  ASSERT F(X) = F'(X)
END FOR
```
