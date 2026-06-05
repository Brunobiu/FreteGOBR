# Requirements Document

> Sistema de Testes Automatizados e Validações Contínuas — FreteGO

## Introduction

Este documento define os requisitos para um sistema completo de testes automatizados e validações contínuas que cobre todo o SaaS FreteGO — um marketplace de fretes que conecta motoristas e embarcadores, com painel administrativo de RBAC server-side, auditoria por construção, versionamento otimista e RLS no Postgres.

O objetivo é garantir estabilidade, segurança, integridade dos dados e prevenção de regressões à medida que o produto evolui. O sistema de testes é tratado como parte permanente da plataforma: toda nova feature deve obrigatoriamente gerar novos testes específicos, e nenhuma entrega é considerada "pronta" sem cobertura de testes, cenários de falha, validações e critérios de aceite.

A stack de testes existente é **Vitest + fast-check** (property-based testing), com pipeline de CI em **GitHub Actions** (`.github/workflows/ci.yml`), hooks de pre-commit via **Husky + lint-staged**, e testes organizados em `src/__tests__/` seguindo a convenção `cp<N><Nome>.property.test.ts`. Testes E2E utilizam o **Playwright** (MCP disponível).

Convenções de idioma: o texto descritivo, user stories e mensagens user-facing são em **pt-BR**; palavras-chave EARS (WHEN, WHILE, IF, THE, SHALL), nomes de sistema, identifiers e error codes são em **inglês**, conforme `project-conventions.md`.

Os requisitos estão agrupados por categoria de teste:
- A. Testes Unitários
- B. Testes de Integração
- C. Testes End-to-End (E2E)
- D. Testes de Segurança
- E. Testes de Performance
- F. Testes de Regressão
- G. Validação de Dados (frontend e backend)
- H. Contratos e APIs
- I. Pipeline CI/CD
- J. Observabilidade
- K. Padrão Futuro Obrigatório (governança de specs)

## Glossary

- **Test_System**: O conjunto completo de testes automatizados, ferramentas e validações contínuas do FreteGO, abrangendo todas as categorias deste documento.
- **Unit_Test_Suite**: Conjunto de testes unitários que exercitam funções, serviços, helpers, hooks e regras de negócio isoladamente.
- **Integration_Test_Suite**: Conjunto de testes que exercitam fluxos ponta a ponta entre múltiplos componentes/serviços (incluindo Supabase) sem navegador.
- **E2E_Test_Suite**: Conjunto de testes que simulam o comportamento real do usuário via navegador usando Playwright.
- **Security_Test_Suite**: Conjunto de testes que validam autenticação, autorização, isolamento de dados e resistência a vetores de ataque.
- **Performance_Test_Suite**: Conjunto de testes de carga e stress que medem tempo de resposta, uso de recursos e comportamento sob concorrência.
- **Regression_Suite**: A coleção completa de testes automatizados executada para detectar quebras de funcionalidades existentes.
- **Data_Validator**: Componente lógico de validação de entrada e saída, presente tanto no frontend quanto no backend (Edge Functions e RPCs Postgres).
- **Contract_Test_Suite**: Conjunto de testes que verifica a compatibilidade de contratos (payloads, schemas, status HTTP) entre frontend e backend.
- **CI_Pipeline**: O workflow de integração contínua em GitHub Actions que executa lint, type-check, testes, cobertura e build.
- **Observability_Layer**: O conjunto de logs estruturados, métricas, tracing, alertas e rastreamento de erros do FreteGO.
- **Spec_Governance_Process**: O processo obrigatório que exige Requirements, Design, Tasks, testes, cenários de falha, validações e atualização de regressão e documentação para toda feature nova.
- **Coverage_Reporter**: Ferramenta que mede e reporta a cobertura de código dos testes (provider de cobertura do Vitest).
- **Property_Test**: Teste baseado em propriedades escrito com fast-check, que gera múltiplas entradas para validar invariantes, round-trips, idempotência e relações metamórficas.
- **Test_Generator**: Geradores fast-check (`fc.*`) responsáveis por produzir entradas válidas, inválidas e extremas conforme convenções do projeto.
- **RLS_Engine**: Row-Level Security do Postgres/Supabase que restringe acesso a dados por usuário.
- **Coverage_Threshold**: O percentual mínimo de cobertura exigido para módulos críticos definidos neste documento.
- **Critical_Module**: Módulo de regra de negócio sensível (cálculo de lucro, comissão, assinatura, cobrança, limites de uso, autenticação, permissões).
- **Test_Fixture**: Dados e estado controlados usados para preparar a execução de um teste de forma determinística.

## Requirements

---

## Categoria A — Testes Unitários

### Requirement 1: Cobertura unitária de regras financeiras

**User Story:** Como desenvolvedor, quero testes unitários para todas as regras de cálculo financeiro, para que o motorista receba valores corretos e auditáveis.

#### Acceptance Criteria

1. THE Unit_Test_Suite SHALL conter testes para a função de cálculo de lucro líquido do frete cobrindo entradas válidas, inválidas, vazias, nulas, undefined e tipos incorretos.
2. THE Unit_Test_Suite SHALL conter testes para o cálculo de lucro por hora cobrindo entradas válidas, inválidas e limites extremos.
3. THE Unit_Test_Suite SHALL conter testes para o cálculo de frete de retorno cobrindo entradas válidas, inválidas e edge cases.
4. THE Unit_Test_Suite SHALL conter testes para as regras de comissão cobrindo todos os ramos de decisão definidos no domínio.
5. WHEN um valor numérico de entrada for `NaN`, `Infinity` ou `-Infinity`, THE Data_Validator SHALL rejeitar a entrada com o error code `INVALID_NUMERIC_INPUT`.
6. FOR ALL pares de entradas financeiras válidas, THE Property_Test SHALL verificar que `lucro_liquido = receita - custos_totais` (invariante de consistência).
7. WHERE um cálculo financeiro produzir overflow numérico, THE Data_Validator SHALL sinalizar o error code `NUMERIC_OVERFLOW`.

### Requirement 2: Cobertura unitária de regras de assinatura, cobrança e limites de uso

**User Story:** Como desenvolvedor, quero testes unitários das regras de assinatura, cobrança e limites de uso, para que planos e bloqueios sejam aplicados corretamente.

#### Acceptance Criteria

1. THE Unit_Test_Suite SHALL conter testes para as regras de assinatura/plano cobrindo cada estado de plano (trial, ativo, expirado, cancelado).
2. THE Unit_Test_Suite SHALL conter testes para as regras de cobrança cobrindo entradas válidas, inválidas e limites.
3. THE Unit_Test_Suite SHALL conter testes para as regras de limite de uso cobrindo valores abaixo, no limite e acima do limite.
4. WHEN o uso de um recurso atingir o limite do plano, THE Test_System SHALL verificar que a operação retorna o error code `USAGE_LIMIT_REACHED`.
5. WHILE uma assinatura estiver no estado `expired`, THE Test_System SHALL verificar que recursos pagos permanecem bloqueados.
6. FOR ALL transições de estado de assinatura geradas pelo Test_Generator, THE Property_Test SHALL verificar que apenas transições permitidas pela máquina de estados ocorrem.

### Requirement 3: Cobertura unitária de autenticação, permissões e validações

**User Story:** Como desenvolvedor, quero testes unitários de autenticação, roles e validações, para que o controle de acesso e os formulários sejam confiáveis.

#### Acceptance Criteria

1. THE Unit_Test_Suite SHALL conter testes para as regras de autenticação cobrindo credenciais válidas, inválidas, vazias e nulas.
2. THE Unit_Test_Suite SHALL conter testes para permissões e roles cobrindo cada permissão definida no RBAC.
3. THE Unit_Test_Suite SHALL conter testes para validações de formulário cobrindo campos obrigatórios, formatos inválidos e tamanhos extremos.
4. THE Unit_Test_Suite SHALL conter testes para validações de payload cobrindo payloads válidos, malformados, vazios e com campos faltantes.
5. WHEN uma role sem a permissão necessária solicitar uma ação protegida, THE Test_System SHALL verificar que a ação retorna o error code `permission_denied`.
6. FOR ALL telefones, CPFs, CNPJs e e-mails gerados a partir de templates fixos válidos (`fc.constantFrom`), THE Property_Test SHALL verificar que a validação aceita os válidos e rejeita os inválidos.

### Requirement 4: Cobertura unitária de helpers, serviços, hooks, middlewares e jobs

**User Story:** Como desenvolvedor, quero testes unitários para helpers, serviços internos, hooks, middlewares e jobs assíncronos, para que componentes de base permaneçam estáveis.

#### Acceptance Criteria

1. THE Unit_Test_Suite SHALL conter testes para os serviços internos cobrindo caminhos de sucesso e de erro.
2. THE Unit_Test_Suite SHALL conter testes para helpers e utilitários cobrindo entradas válidas, vazias e extremas.
3. THE Unit_Test_Suite SHALL conter testes para hooks de React cobrindo estados inicial, de carregamento, de sucesso e de erro.
4. THE Unit_Test_Suite SHALL conter testes para middlewares cobrindo requisições autorizadas e não autorizadas.
5. THE Unit_Test_Suite SHALL conter testes para filas e background jobs cobrindo processamento bem-sucedido, falha e reprocessamento.
6. THE Test_System SHALL validar o tratamento de `JOB_FAILED` mesmo sem uma falha real do job, exercitando a lógica de erro de forma independente do cenário real.
7. WHEN um job for marcado com `JOB_FAILED`, THE Test_System SHALL considerar suficiente a presença do error code `JOB_FAILED`, sem exigir a marcação de estados adicionais.

### Requirement 5: Cobertura unitária de parsing, transformação e tratamento de erros

**User Story:** Como desenvolvedor, quero testes unitários para parsing, transformação de dados e tratamento de erros, para que a conversão de dados seja correta e reversível.

#### Acceptance Criteria

1. THE Unit_Test_Suite SHALL conter testes para cada parser do sistema cobrindo entradas válidas e inválidas.
2. THE Unit_Test_Suite SHALL conter um pretty printer correspondente para cada parser que serializa dados de volta ao formato de origem.
3. FOR ALL objetos válidos gerados pelo Test_Generator, THE Property_Test SHALL verificar a propriedade de round-trip: `parse(print(x))` produz um objeto equivalente a `x`.
4. WHEN um parser receber uma entrada malformada, THE Data_Validator SHALL retornar um erro descritivo com o error code `PARSE_ERROR`.
5. THE Unit_Test_Suite SHALL conter testes para transformação de dados cobrindo normalização, encoding e conversão de tipos.
6. WHERE o CSV export for testado, THE Property_Test SHALL verificar prefixo BOM UTF-8, separador `;`, escape RFC 4180 e truncamento em 10000 linhas.

### Requirement 6: Robustez unitária sob concorrência e race conditions

**User Story:** Como desenvolvedor, quero testes que exercitem concorrência e race conditions, para que operações simultâneas não corrompam estado.

#### Acceptance Criteria

1. THE Unit_Test_Suite SHALL conter testes que simulam execução concorrente de operações que compartilham estado.
2. WHEN duas atualizações concorrentes ocorrerem sobre o mesmo registro versionado, THE Test_System SHALL verificar que a segunda recebe o error code `STALE_VERSION`.
3. FOR ALL ordens de aplicação de operações comutativas geradas pelo Test_Generator, THE Property_Test SHALL verificar a propriedade de confluência (o resultado final independe da ordem).
4. WHERE uma operação for declarada idempotente, THE Property_Test SHALL verificar que aplicá-la duas vezes produz o mesmo resultado que aplicá-la uma vez.

---

## Categoria B — Testes de Integração

### Requirement 7: Integração de cadastro e autenticação

**User Story:** Como usuário, quero que os fluxos de cadastro e autenticação funcionem ponta a ponta, para que eu consiga acessar a plataforma com segurança.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL exercitar o fluxo completo de cadastro de motorista da submissão à persistência no Postgres.
2. THE Integration_Test_Suite SHALL exercitar o fluxo completo de cadastro de embarcador da submissão à persistência no Postgres.
3. THE Integration_Test_Suite SHALL exercitar os fluxos de login e logout incluindo a emissão e a invalidação de sessão.
4. THE Integration_Test_Suite SHALL exercitar o fluxo de recuperação de senha da solicitação até a redefinição.
5. WHEN um token JWT expirado for usado em uma requisição autenticada, THE Test_System SHALL verificar que a resposta tem status HTTP 401.
6. IF a autenticação falhar por credenciais inválidas, THEN THE Test_System SHALL verificar que a mensagem user-facing canônica `Não foi possível autenticar.` é retornada.
7. IF o envio de código de verificação falhar, THEN THE Test_System SHALL verificar que a mensagem user-facing canônica `Não foi possível enviar o código.` é retornada.
8. IF um cadastro falhar por dado duplicado, THEN THE Test_System SHALL verificar que a mensagem user-facing canônica anti-enumeration `Não foi possível concluir o cadastro.` é retornada, sem exigir ausência de registros parciais (dados parciais podem existir temporariamente antes do cleanup).

### Requirement 8: Integração do ciclo de vida do frete

**User Story:** Como motorista e embarcador, quero que o ciclo de vida do frete funcione ponta a ponta, para que negociações sejam concluídas corretamente.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL exercitar a publicação de frete da submissão à persistência.
2. THE Integration_Test_Suite SHALL exercitar a edição de frete incluindo versionamento otimista via `expected_updated_at`.
3. THE Integration_Test_Suite SHALL exercitar a candidatura de um motorista em um frete.
4. THE Integration_Test_Suite SHALL exercitar a confirmação de fechamento de frete.
5. THE Integration_Test_Suite SHALL exercitar o aceite de termos vinculado à conclusão de um frete.
6. IF uma edição de frete usar um `expected_updated_at` desatualizado, THEN THE Test_System SHALL verificar que a operação retorna o error code `STALE_VERSION` sem alterar o registro.

### Requirement 9: Integração de chat e mensagens

**User Story:** Como usuário, quero que o chat funcione ponta a ponta, para que motoristas e embarcadores se comuniquem com confiabilidade.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL exercitar a abertura de uma conversa de chat entre dois usuários habilitados.
2. THE Integration_Test_Suite SHALL exercitar o envio e a entrega de mensagens dentro de uma conversa.
3. WHEN um usuário sem vínculo com a conversa tentar enviar uma mensagem, THE Test_System SHALL verificar que a operação é bloqueada pelo RLS_Engine.
4. THE Integration_Test_Suite SHALL verificar que a ordem cronológica das mensagens é preservada na persistência e na leitura.

### Requirement 10: Integração de assinaturas, pagamentos e webhooks

**User Story:** Como usuário e operador, quero que assinatura, cancelamento, pagamentos e webhooks funcionem ponta a ponta, para que cobranças e estados de plano sejam consistentes.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL exercitar o fluxo de assinatura de plano da seleção à ativação.
2. THE Integration_Test_Suite SHALL exercitar o cancelamento de assinatura e a transição de estado resultante.
3. THE Integration_Test_Suite SHALL exercitar o processamento de pagamento com provedor mockado para casos de aprovação e recusa.
4. WHEN um webhook for recebido com assinatura/HMAC inválido, THE Test_System SHALL verificar que o evento é rejeitado com o error code `WEBHOOK_SIGNATURE_INVALID`.
5. WHEN o mesmo webhook for entregue mais de uma vez, THE Test_System SHALL verificar que o processamento é idempotente e não duplica efeitos, sem exigir o rastreamento de entregas duplicadas.

### Requirement 11: Integração de notificações, uploads e arquivos

**User Story:** Como usuário, quero que notificações e uploads de arquivos funcionem ponta a ponta, para que eu receba avisos e envie documentos com segurança.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL exercitar o envio de notificações da geração do evento à entrega ao destinatário.
2. THE Integration_Test_Suite SHALL exercitar o upload de arquivos da seleção à persistência no Storage.
3. WHEN um arquivo com MIME type não permitido for enviado, THE Test_System SHALL verificar que o upload é rejeitado com o error code `INVALID_FILE_TYPE`.
4. WHEN o upload de um arquivo malicioso for concluído, THE Test_System SHALL verificar que o arquivo é rejeitado pela validação de conteúdo após a conclusão do upload.
5. IF um upload falhar antes da conclusão por rede, limite ou timeout, THEN THE Test_System SHALL considerar que nenhuma validação de conteúdo adicional é necessária.
6. THE Integration_Test_Suite SHALL verificar que arquivos enviados só são acessíveis por usuários autorizados via URLs assinadas.

### Requirement 12: Integração de LGPD, exclusão de dados e auditoria

**User Story:** Como usuário e operador, quero que solicitações LGPD, exclusão de conta e auditoria funcionem ponta a ponta, para que a privacidade e a rastreabilidade sejam garantidas.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL exercitar a exclusão de conta cobrindo a remoção ou anonimização dos dados associados.
2. THE Integration_Test_Suite SHALL exercitar a solicitação LGPD de exportação de dados do usuário.
3. THE Integration_Test_Suite SHALL exercitar a solicitação LGPD de exclusão de dados do usuário.
4. WHEN uma mutação admin auditável for executada, THE Test_System SHALL aprovar a verificação de auditoria somente quando um registro correspondente estiver efetivamente PERSISTIDO em `admin_audit_logs` com `action`, `target_type` e `target_id`; a mera execução do processo NÃO é suficiente.
5. IF o registro de auditoria de uma mutação admin falhar, THEN THE Test_System SHALL verificar que a operação principal é concluída mesmo assim (a falha de audit logging NÃO bloqueia a mutação administrativa).
6. WHEN uma RPC protegida for chamada sem permissão, THE Test_System SHALL verificar que um log `<MODULE>_VIEW_DENIED` é gravado com `before=NULL`.

### Requirement 13: Integração de filas assíncronas e APIs externas

**User Story:** Como operador, quero que filas assíncronas e integrações externas funcionem ponta a ponta de forma resiliente, para que falhas externas não derrubem o sistema.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL exercitar o enfileiramento e o processamento de jobs assíncronos.
2. THE Integration_Test_Suite SHALL exercitar a integração com APIs externas usando dublês (mocks/stubs) para 1 a 3 cenários representativos.
3. IF uma API externa retornar erro ou timeout, THEN THE Test_System SHALL verificar que o sistema aplica retry ou degradação parcial sem perder dados.
4. WHEN um bloco de um fetch agregado falhar, THE Test_System SHALL verificar que os demais blocos continuam disponíveis e o bloco com falha reporta erro isolado.

---

## Categoria C — Testes End-to-End (E2E)

### Requirement 14: Simulação de comportamento real do usuário

**User Story:** Como usuário, quero que os fluxos principais sejam testados como eu os uso de verdade, para que a interface se comporte como esperado.

#### Acceptance Criteria

1. THE E2E_Test_Suite SHALL abrir o frontend, navegar pelas telas principais e preencher formulários usando Playwright.
2. WHEN um formulário for submetido com dados válidos, THE Test_System SHALL verificar a mensagem de sucesso, o estado resultante e a persistência dos dados.
3. WHEN um formulário for submetido com dados inválidos, THE Test_System SHALL verificar que AMBAS as condições ocorrem — a submissão é bloqueada E uma mensagem de erro em pt-BR é exibida — aprovando o teste somente quando as duas forem satisfeitas.
4. WHEN um usuário sem permissão acessar uma rota protegida, THE Test_System SHALL verificar o redirect e que o conteúdo protegido não é exibido (`Stealth_404` quando aplicável).
5. THE E2E_Test_Suite SHALL verificar a persistência de dados após refresh de página em fluxos com estado.

### Requirement 15: Cobertura de dispositivos, navegadores e condições adversas

**User Story:** Como usuário em diferentes dispositivos, quero que a aplicação funcione em desktop e mobile sob condições variadas, para que minha experiência seja consistente.

#### Acceptance Criteria

1. THE E2E_Test_Suite SHALL executar os fluxos principais em viewport desktop e em viewport mobile (`<768px`).
2. WHERE a listagem do painel admin for renderizada em mobile, THE Test_System SHALL verificar que a tabela vira lista de cards single-column.
3. WHEN a sessão de um usuário expirar durante a navegação, THE Test_System SHALL verificar que o usuário é levado à reautenticação.
4. IF a conexão de rede for perdida enquanto existir uma operação ativa em andamento, THEN THE Test_System SHALL verificar que a interface exibe opções de recuperação e permite nova tentativa.
5. WHILE não existir operação ativa em andamento, THE Test_System SHALL verificar que opções de recuperação de rede NÃO são exibidas.
6. WHILE múltiplos usuários atuarem simultaneamente sobre o mesmo recurso, THE Test_System SHALL verificar que a interface reflete o controle de versão otimista sem corromper estado.

---

## Categoria D — Testes de Segurança

### Requirement 16: Autenticação, autorização e isolamento de dados

**User Story:** Como engenheiro de segurança, quero testes que garantam autenticação, autorização e isolamento de dados, para que nenhum usuário acesse dados de outro.

#### Acceptance Criteria

1. WHEN o usuário A tentar ler dados pertencentes ao usuário B, THE Test_System SHALL verificar que o RLS_Engine bloqueia o acesso.
2. WHEN o usuário A tentar atualizar ou excluir registros do usuário B, THE Test_System SHALL verificar que a operação é negada.
3. WHEN um usuário não autenticado acessar um recurso protegido, THE Test_System SHALL verificar que a resposta tem status HTTP 401.
4. WHEN um usuário sem role admin acessar um endpoint admin, THE Test_System SHALL verificar que o acesso é negado com `permission_denied`.
5. WHEN um usuário sem permissão para uma ação protegida disparar uma requisição que também contém erros de validação simultâneos, THE Test_System SHALL verificar que o sistema retorna `permission_denied` (precedência sobre quaisquer outros erros).
6. FOR ALL pares de usuários distintos gerados pelo Test_Generator, THE Property_Test SHALL verificar a invariante de isolamento: nenhum usuário lê linhas de outro em tabelas com RLS.
7. THE Security_Test_Suite SHALL verificar que o Master Admin (`admin_username='Nexus_Vortex99'`) é imutável a mutações admin.

### Requirement 17: Resistência a vetores de injeção e ataques web

**User Story:** Como engenheiro de segurança, quero testes contra injeção e ataques web comuns, para que entradas maliciosas não comprometam o sistema.

#### Acceptance Criteria

1. THE Security_Test_Suite SHALL testar tentativas de SQL Injection nos campos de entrada e verificar que são neutralizadas por queries parametrizadas.
2. THE Security_Test_Suite SHALL testar tentativas de NoSQL Injection e verificar que são rejeitadas.
3. THE Security_Test_Suite SHALL testar tentativas de XSS em conteúdo gerado por usuário e verificar que o conteúdo é escapado.
4. THE Security_Test_Suite SHALL testar tentativas de CSRF em endpoints que alteram estado e verificar que são rejeitadas.
5. THE Security_Test_Suite SHALL testar tentativas de SSRF e verificar que URLs internas/privadas são bloqueadas.
6. FOR ALL payloads maliciosos gerados pelo Test_Generator, THE Property_Test SHALL verificar a condição de erro: a entrada é rejeitada e nenhum efeito colateral persiste.

### Requirement 18: Proteção contra abuso e força bruta

**User Story:** Como engenheiro de segurança, quero testes de rate limiting e anti-força-bruta, para que tentativas abusivas sejam contidas.

#### Acceptance Criteria

1. WHEN o número de tentativas de login exceder o limite configurado, THE Test_System SHALL verificar que respostas subsequentes têm status HTTP 429.
2. WHEN o limite de requisições por IP for excedido, THE Test_System SHALL verificar que a resposta inclui o cabeçalho `Retry-After`.
3. THE Security_Test_Suite SHALL testar tentativas de enumeração de usuários e verificar que as respostas são indistinguíveis para identidades existentes e inexistentes.
4. IF um upload contiver um arquivo malicioso ou com MIME type forjado, THEN THE Test_System SHALL verificar que o arquivo é rejeitado por validação de conteúdo.

### Requirement 19: Não vazamento de dados sensíveis e secrets

**User Story:** Como engenheiro de segurança, quero garantir que dados sensíveis e secrets nunca sejam expostos, para que a confidencialidade seja preservada.

#### Acceptance Criteria

1. FOR ALL respostas de API geradas durante os testes, THE Property_Test SHALL verificar que hashes de senha e secrets nunca aparecem no payload.
2. WHEN ocorrer um erro de servidor, THE Test_System SHALL verificar que stack traces não são retornados ao cliente.
3. THE Security_Test_Suite SHALL verificar que tokens e credenciais não são gravados em logs.
4. THE Security_Test_Suite SHALL verificar que os cabeçalhos de segurança HTTP esperados estão presentes nas respostas.
5. THE Security_Test_Suite SHALL escanear o código-fonte em busca de secrets hardcoded e falhar caso algum seja encontrado.

---

## Categoria E — Testes de Performance

### Requirement 20: Carga, stress e uso de recursos

**User Story:** Como operador, quero testes de carga e stress, para que o sistema mantenha desempenho aceitável sob volume.

#### Acceptance Criteria

1. THE Performance_Test_Suite SHALL medir o tempo de resposta dos endpoints críticos sob carga representativa.
2. WHEN a carga simulada atingir o volume-alvo definido, THE Test_System SHALL verificar que o tempo de resposta do percentil 95 permanece dentro do limite configurado.
3. THE Performance_Test_Suite SHALL medir consumo de memória e CPU durante a execução de carga.
4. THE Performance_Test_Suite SHALL simular múltiplos usuários simultâneos e medir o throughput resultante.
5. WHILE um pico de requisições estiver em curso, THE Test_System SHALL verificar que filas absorvem o excesso sem perda de itens.
6. IF múltiplos serviços externos ficarem indisponíveis simultaneamente durante um teste de stress, THEN THE Test_System SHALL verificar que o sistema degrada de forma controlada sem falha total.

---

## Categoria F — Testes de Regressão

### Requirement 21: Suíte de regressão e compatibilidade

**User Story:** Como desenvolvedor, quero uma suíte de regressão automática, para que nenhuma funcionalidade existente quebre silenciosamente.

#### Acceptance Criteria

1. THE Regression_Suite SHALL executar automaticamente toda a coleção de testes a cada commit e a cada pull request.
2. WHEN qualquer teste da Regression_Suite falhar, THE CI_Pipeline SHALL bloquear o merge e o deploy.
3. WHEN um teste falhar e só passar após retry (teste flaky), THE CI_Pipeline SHALL ainda assim bloquear o merge e o deploy.
4. IF a falha for um problema de infraestrutura da própria pipeline, THEN THE CI_Pipeline SHALL NÃO bloquear o merge automaticamente.
5. THE Test_System SHALL tratar o mecanismo padrão de bloqueio de deploy como confiável, sem exigir um fail-safe adicional.
6. WHEN uma nova feature for adicionada, THE Spec_Governance_Process SHALL exigir que novos testes sejam incorporados à Regression_Suite.
7. THE Regression_Suite SHALL manter a compatibilidade com testes existentes, executando-os sem modificação não justificada.
8. IF um teste existente passar a falhar após uma mudança, THEN THE Test_System SHALL reportar o teste afetado e o exemplo que falhou.

---

## Categoria G — Validação de Dados

### Requirement 22: Validação de entrada no frontend e no backend

**User Story:** Como desenvolvedor, quero que toda entrada seja validada no frontend e no backend, para que dados inválidos nunca cheguem ao banco.

#### Acceptance Criteria

1. THE Data_Validator SHALL validar tipo, formato, tamanho e obrigatoriedade de cada campo de entrada no frontend.
2. THE Data_Validator SHALL revalidar tipo, formato, tamanho e obrigatoriedade de cada campo de entrada no backend.
3. WHEN uma entrada contiver caracteres perigosos detectados, THE Data_Validator SHALL sanitizá-la antes do processamento; a sanitização ocorre apenas quando caracteres perigosos forem detectados.
4. THE Data_Validator SHALL normalizar e padronizar o encoding das entradas antes da persistência.
5. WHEN uma regra de negócio for violada por uma entrada, THE Data_Validator SHALL rejeitar a entrada na própria camada de validação com um error code específico.
6. FOR ALL entradas vazias, nulas, `undefined` e de tipo incorreto geradas pelo Test_Generator, THE Property_Test SHALL verificar que a validação as rejeita de forma consistente no frontend e no backend.

### Requirement 23: Validação de saída e respostas padronizadas

**User Story:** Como desenvolvedor, quero que toda saída seja validada, para que os contratos de resposta sejam consistentes.

#### Acceptance Criteria

1. THE Data_Validator SHALL validar a estrutura JSON de cada resposta de API contra seu schema esperado.
2. WHEN uma resposta de sucesso for retornada, THE Test_System SHALL verificar que o status HTTP corresponde à operação executada.
3. WHEN um erro for retornado, THE Test_System SHALL verificar que a mensagem segue o padrão de mensagens de erro padronizadas do projeto.
4. THE Test_System SHALL verificar que respostas não incluem campos sensíveis fora do contrato definido.

---

## Categoria H — Contratos e APIs

### Requirement 24: Testes de contrato frontend/backend

**User Story:** Como desenvolvedor, quero testes de contrato entre frontend e backend, para que mudanças de payload não quebrem a integração.

#### Acceptance Criteria

1. THE Contract_Test_Suite SHALL verificar que os payloads consumidos pelo frontend correspondem aos payloads produzidos pelo backend.
2. WHEN o schema de um payload for alterado de forma incompatível, THE Test_System SHALL detectar a incompatibilidade automaticamente durante a execução e falhar o teste de contrato correspondente.
3. WHEN o schema de um payload for alterado de forma compatível, THE Test_System SHALL NÃO falhar o teste de contrato.
4. THE Contract_Test_Suite SHALL verificar a estabilidade do contrato de cada webhook consumido ou emitido.
5. WHERE existir versionamento de API, THE Contract_Test_Suite SHALL verificar a compatibilidade entre versões suportadas.
6. FOR ALL objetos de contrato serializados e desserializados, THE Property_Test SHALL verificar a propriedade de round-trip entre frontend e backend.

---

## Categoria I — Pipeline CI/CD

### Requirement 25: Execução de testes e gates de qualidade no pipeline

**User Story:** Como operador, quero que o pipeline rode todos os testes e bloqueie deploys com falha, para que apenas código validado chegue à produção.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL executar lint, type-check, testes e build a cada commit e a cada pull request.
2. WHEN uma etapa de qualidade do CI_Pipeline (lint, type-check, testes, build) falhar, THE CI_Pipeline SHALL bloquear o deploy.
3. IF a falha de uma etapa do CI_Pipeline decorrer de um problema de infraestrutura da própria pipeline, THEN THE CI_Pipeline SHALL NÃO bloquear o merge automaticamente.
4. THE CI_Pipeline SHALL validar a aplicação de migrations do Supabase antes do deploy.
5. THE CI_Pipeline SHALL validar a presença das variáveis de ambiente obrigatórias antes do deploy.
6. WHEN os testes forem concluídos, THE Coverage_Reporter SHALL gerar um relatório de cobertura.
7. WHILE um Critical_Module for avaliado, THE Coverage_Reporter SHALL verificar que a cobertura atinge ou supera o Coverage_Threshold definido.
8. IF a cobertura de um Critical_Module ficar abaixo do Coverage_Threshold, THEN THE CI_Pipeline SHALL falhar a verificação de cobertura.

---

## Categoria J — Observabilidade

### Requirement 26: Logs estruturados, métricas, tracing e alertas

**User Story:** Como operador, quero observabilidade testável, para que erros e eventos relevantes sejam rastreáveis em produção.

#### Acceptance Criteria

1. THE Observability_Layer SHALL emitir logs estruturados de forma contínua, sem depender exclusivamente da ocorrência de eventos específicos.
2. WHEN um erro não tratado ocorrer, THE Observability_Layer SHALL registrar o erro com um identificador de correlação.
3. THE Observability_Layer SHALL expor métricas de desempenho e de uso para monitoramento.
4. WHEN uma métrica monitorada cruzar um limiar configurado, THE Observability_Layer SHALL disparar um alerta.
5. THE Test_System SHALL verificar, com 1 a 3 exemplos representativos, que eventos auditáveis produzem registros de auditoria correspondentes.
6. THE Observability_Layer SHALL propagar o identificador de tracing entre frontend, Edge Functions e RPCs em um fluxo de requisição.

---

## Categoria K — Padrão Futuro Obrigatório (Governança de Specs)

### Requirement 27: Toda feature futura gera testes e documentação obrigatórios

**User Story:** Como responsável técnico, quero que toda feature nova siga um padrão obrigatório de entrega, para que a qualidade evolua junto com o produto.

#### Acceptance Criteria

1. WHEN uma nova feature for iniciada, THE Spec_Governance_Process SHALL exigir os documentos Requirements, Design e Tasks antes da implementação.
2. WHEN uma nova feature for implementada, THE Spec_Governance_Process SHALL exigir testes automatizados, cenários de falha e validações correspondentes.
3. WHEN uma nova feature for concluída, THE Spec_Governance_Process SHALL exigir a atualização da Regression_Suite e da documentação técnica.
4. IF uma feature não possuir testes completos e critérios de aceite, THEN THE Spec_Governance_Process SHALL impedir que a feature seja marcada como concluída.
5. THE Spec_Governance_Process SHALL exigir critérios de aceite testáveis para cada entrega.
6. THE Spec_Governance_Process SHALL exigir, para cada feature concluída, testes completos, validações completas, cenários de falha, testes de regressão atualizados e documentação técnica atualizada, independentemente da configuração de governança do projeto.
