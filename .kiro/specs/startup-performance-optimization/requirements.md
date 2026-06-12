# Requirements Document

## Introduction

Esta feature otimiza a inicialização e a percepção de velocidade do aplicativo FreteGO
(React 18 + TypeScript + Vite + TailwindCSS + Supabase + React Router v6), sem alterar
nenhuma regra de negócio, fluxo, layout ou contrato de API existente.

O objetivo central: o usuário deve enxergar a interface (estrutura da tela) o mais rápido
possível, enquanto dados secundários carregam em segundo plano sem bloquear a experiência.
A ordem de carregamento é estrita — (1) validar autenticação, (2) renderizar a estrutura da
tela, (3) exibir o conteúdo principal, (4) por último carregar listas, estatísticas,
notificações, contadores, imagens e dados secundários.

A regra-mãe é a **não-regressão**: todas as alterações são incrementais e 100% compatíveis
com a arquitetura atual. Nenhuma funcionalidade existente (login, navegação, rotas,
permissões, telas, realtime, cálculos do motorista) pode quebrar ou mudar de comportamento
observável. Quando uma otimização tiver risco de regressão, a alternativa mais segura deve
ser adotada.

Este documento define requisitos verificáveis em EARS. A estratégia técnica concreta
(quais componentes lazy, qual camada de cache, etc.) é detalhada na fase de design; aqui
descrevemos **o quê** o sistema deve fazer, não **como**.

## Glossary

- **App**: O aplicativo cliente FreteGO (bundle React executado no navegador e no app nativo Capacitor).
- **Bootstrap**: Sequência de inicialização do App em `src/main.tsx` até o primeiro render útil.
- **Auth_Provider**: O `AuthProvider` em `src/hooks/useAuth.tsx`, responsável por validar e expor o estado de autenticação.
- **Auth_State**: O estado de autenticação exposto pelo Auth_Provider (`user`, `isAuthenticated`, `isLoading`).
- **Cached_Session**: A sessão do usuário previamente persistida em `localStorage` (`fretego_user` + `fretego_access_token`).
- **Shell**: A estrutura visual estável de uma tela — cabeçalho (AppHeader), menu, navegação e barra inferior (MotoristaBottomNav) — sem o conteúdo de dados.
- **Primary_Content**: O conteúdo principal da página atual (ex: o feed de fretes na HomePage).
- **Secondary_Data**: Dados não essenciais ao primeiro uso — listas auxiliares, estatísticas, notificações, contadores, imagens decorativas, perfis públicos, contexto de cálculo.
- **First_Useful_Paint**: O momento em que o usuário vê o Shell renderizado (não uma tela branca nem um spinner de tela cheia).
- **Skeleton**: Placeholder visual exibido apenas na área que ainda não carregou seus dados.
- **Route_Component**: Um componente de página associado a uma rota do React Router v6.
- **Lazy_Component**: Um Route_Component ou componente pesado carregado via importação dinâmica (`React.lazy` / `import()`).
- **Eager_Component**: Um componente importado estaticamente que entra no bundle inicial.
- **Data_Cache**: Mecanismo de cache em memória que armazena resultados de requisições para reutilização entre telas e dentro de uma sessão.
- **Cache_Entry**: Uma entrada do Data_Cache identificada por uma chave estável derivada da requisição e seus parâmetros.
- **Supabase_Query**: Uma requisição de leitura ao backend Supabase (REST/RPC) feita pelo App.
- **Realtime_Channel**: Uma assinatura de canal `postgres_changes` do Supabase.
- **Build_Pipeline**: A configuração de build do Vite (`vite.config.ts`), incluindo `manualChunks`.
- **Chunk**: Um arquivo JavaScript gerado pelo code splitting do Build_Pipeline.
- **Behavior_Baseline**: O comportamento observável do App antes desta feature (saídas de UI, navegação, permissões, resultados de cálculo, dados exibidos).
- **Regression_Suite**: O conjunto de testes automatizados (unit + property) que protege o Behavior_Baseline.
- **Audit_Report**: O documento de auditoria de performance produzido por esta feature, listando gargalos identificados.

## Requirements

### Requirement 1: Validação de autenticação não bloqueante no bootstrap

**User Story:** Como usuário com sessão salva, quero que o App valide minha autenticação sem me prender numa tela de carregamento, para que eu veja a interface imediatamente ao abrir o app.

#### Acceptance Criteria

1. WHILE existe uma Cached_Session válida em `localStorage`, THE Auth_Provider SHALL expor `isAuthenticated` como verdadeiro usando os dados em cache antes de concluir qualquer Supabase_Query de verificação.
2. WHEN o Bootstrap inicia com uma Cached_Session presente, THE Auth_Provider SHALL permitir o First_Useful_Paint do Shell sem aguardar a conclusão da chamada `getCurrentUser`.
3. WHEN a verificação de sessão em segundo plano conclui e indica sessão inválida, THE Auth_Provider SHALL limpar a Cached_Session e atualizar o Auth_State para não autenticado.
4. IF a verificação de sessão em segundo plano falha por erro de rede, THEN THE Auth_Provider SHALL preservar o Auth_State derivado da Cached_Session, mantendo o usuário autenticado sem deslogá-lo.
5. WHEN não existe Cached_Session no Bootstrap, THE Auth_Provider SHALL definir `isAuthenticated` como falso e `isLoading` como falso sem realizar Supabase_Query.
6. THE Auth_Provider SHALL preservar o comportamento de auto-refresh de token a cada 50 minutos definido no Behavior_Baseline.

### Requirement 2: Renderização imediata da estrutura da tela (Shell)

**User Story:** Como usuário, quero ver o cabeçalho, o menu e a navegação aparecerem na hora, para que eu perceba que o app está respondendo mesmo antes dos dados chegarem.

#### Acceptance Criteria

1. WHEN uma tela é aberta, THE App SHALL renderizar o Shell antes de o Primary_Content estar disponível, independentemente do estado do Primary_Content.
2. THE App SHALL renderizar o Shell sem aguardar a conclusão de qualquer Supabase_Query de Secondary_Data.
3. WHILE o Primary_Content está sendo carregado, THE App SHALL exibir um Skeleton apenas na região do Primary_Content, mantendo o Shell interativo.
4. THE App SHALL evitar exibir uma tela branca durante o intervalo entre o Bootstrap e o First_Useful_Paint.
5. WHILE um Lazy_Component está sendo baixado, THE App SHALL exibir um fallback visível em vez de uma tela em branco.

### Requirement 3: Ordem de carregamento priorizada

**User Story:** Como usuário, quero que o app carregue primeiro o que importa para eu usar a tela e só depois os detalhes, para que a experiência principal não fique travada por dados secundários.

#### Acceptance Criteria

1. WHEN uma tela carrega, THE App SHALL disponibilizar o Auth_State antes de iniciar o carregamento do Primary_Content.
2. WHEN o Shell está renderizado, THE App SHALL iniciar o carregamento do Primary_Content antes de iniciar o carregamento de Secondary_Data.
3. WHEN o carregamento do Primary_Content é iniciado, THE App SHALL permitir que o carregamento de Secondary_Data (listas auxiliares, estatísticas, notificações, contadores, imagens, perfis públicos) inicie imediatamente em seguida, sem atraso adicional.
4. WHEN o carregamento do Primary_Content não chega a iniciar, THE App SHALL ainda permitir que o Secondary_Data seja carregado.
5. THE App SHALL renderizar o Primary_Content assim que seus dados estiverem disponíveis, independentemente do estado de carregamento de qualquer Secondary_Data.
6. IF um item de Secondary_Data falha ao carregar, THEN THE App SHALL manter o Shell e o Primary_Content funcionais e exibir degradação apenas na região afetada.

### Requirement 4: Carregamento paralelo de dados independentes

**User Story:** Como usuário, quero que requisições independentes aconteçam ao mesmo tempo, para que a tela termine de carregar mais rápido.

#### Acceptance Criteria

1. WHEN uma tela precisa de múltiplos conjuntos de dados sem dependência entre si, THE App SHALL iniciar as Supabase_Query correspondentes em paralelo.
2. THE App SHALL encadear Supabase_Query em sequência somente quando o resultado de uma for entrada necessária da outra.
3. WHEN um subconjunto de Supabase_Query paralelas falha, THE App SHALL processar os resultados bem-sucedidos sem ser bloqueado pela falha do subconjunto.
4. THE App SHALL preservar os mesmos dados finais exibidos definidos no Behavior_Baseline após a paralelização.

### Requirement 5: Lazy loading e code splitting de páginas e componentes pesados

**User Story:** Como usuário, quero baixar apenas o código necessário para a tela atual, para que a abertura inicial seja leve e rápida.

#### Acceptance Criteria

1. THE Build_Pipeline SHALL gerar Chunks separados para Route_Components não exibidos no First_Useful_Paint.
2. THE App SHALL carregar um Lazy_Component via importação dinâmica somente quando esse componente for necessário para a tela atual.
3. WHERE um componente é pesado e não é imediatamente necessário ao First_Useful_Paint, THE App SHALL carregá-lo por importação dinâmica.
4. WHEN uma rota com Lazy_Component é acessada, THE App SHALL renderizar o componente corretamente após o carregamento do Chunk, preservando a navegação definida no Behavior_Baseline.
5. IF o carregamento de um Chunk via importação dinâmica falha, THEN THE App SHALL tentar um carregamento de fallback ou exibir um estado de erro recuperável, sem derrubar o restante da aplicação.
6. THE App SHALL preservar todas as rotas existentes (públicas, protegidas, admin e honeypot) definidas no Behavior_Baseline.

### Requirement 6: Cache de dados e prevenção de requisições duplicadas

**User Story:** Como usuário, quero que dados já buscados sejam reaproveitados, para que o app não refaça as mesmas requisições e responda mais rápido.

#### Acceptance Criteria

1. WHEN uma Supabase_Query é solicitada e existe um Cache_Entry válido para a mesma chave, THE App SHALL retornar o dado do Data_Cache sem disparar nova requisição de rede.
2. WHEN duas solicitações idênticas de Supabase_Query ocorrem simultaneamente, THE App SHALL coalescê-las em uma única requisição de rede.
3. WHEN um Cache_Entry expira ou é invalidado, THE App SHALL buscar dados atualizados na próxima solicitação.
4. WHEN uma operação de escrita altera dados cacheados, THE App SHALL invalidar ou atualizar os Cache_Entry afetados para refletir o estado correto.
5. THE Data_Cache SHALL retornar dados equivalentes aos que a Supabase_Query retornaria diretamente, conforme o Behavior_Baseline.
6. WHERE um Realtime_Channel está ativo para um conjunto de dados, THE App SHALL manter a consistência entre o Data_Cache e os eventos recebidos do Realtime_Channel.

### Requirement 7: Persistência de dados reaproveitáveis na navegação

**User Story:** Como usuário, quero que dados já carregados continuem disponíveis ao trocar de tela e voltar, para que eu não veja recarregamentos desnecessários.

#### Acceptance Criteria

1. WHEN o usuário navega de uma tela para outra e retorna, THE App SHALL reutilizar os Cache_Entry válidos sem reinicializar dados reaproveitáveis.
2. WHILE um Cache_Entry permanece válido, THE App SHALL exibir os dados em cache imediatamente ao reentrar na tela correspondente.
3. THE App SHALL preservar dados reaproveitáveis em memória durante a sessão de navegação, respeitando as regras de invalidação do Requirement 6.
4. THE App SHALL preservar o comportamento de atualização em tempo real (Realtime_Channel) das telas definido no Behavior_Baseline.

### Requirement 8: Carregamento sob demanda de conteúdo abaixo da dobra e imagens

**User Story:** Como usuário, quero que conteúdo fora da área visível e imagens carreguem só quando eu chegar perto deles, para que a tela inicial fique pronta mais cedo.

#### Acceptance Criteria

1. WHERE um componente está posicionado abaixo da dobra, THE App SHALL adiar seu carregamento até que ele se aproxime da área visível.
2. THE App SHALL aplicar lazy loading às imagens não críticas ao First_Useful_Paint.
3. WHEN uma imagem com lazy loading entra na área visível, THE App SHALL carregá-la e exibi-la.
4. THE App SHALL preservar o layout e as dimensões visuais das imagens definidos no Behavior_Baseline, evitando deslocamento de layout.

### Requirement 9: Skeletons e placeholders sem bloqueio de interface

**User Story:** Como usuário, quero ver indicadores de carregamento apenas nas partes que ainda estão carregando, para que eu possa usar o resto da tela imediatamente.

#### Acceptance Criteria

1. WHILE uma região de dados está carregando, THE App SHALL exibir um Skeleton restrito a essa região.
2. THE App SHALL manter o Shell e as regiões já carregadas interativos enquanto outras regiões exibem Skeleton.
3. WHILE existe pelo menos uma região de conteúdo já carregada, THE App SHALL evitar substituir a tela inteira por um indicador de carregamento de tela cheia enquanto outras regiões estão pendentes.
4. WHEN os dados de uma região chegam, THE App SHALL substituir o Skeleton pelo conteúdo correspondente sem recarregar o restante da tela.

### Requirement 10: Auditoria de performance de inicialização

**User Story:** Como desenvolvedor, quero um relatório das oportunidades de otimização e gargalos de abertura, para que eu saiba exatamente onde agir sem adivinhação.

#### Acceptance Criteria

1. THE Audit_Report SHALL listar as Supabase_Query desnecessárias ou duplicadas identificadas no fluxo de inicialização.
2. THE Audit_Report SHALL listar as renderizações desnecessárias e as oportunidades de memoização identificadas.
3. THE Audit_Report SHALL listar os Eager_Components e imports pesados que podem ser convertidos em Lazy_Components ou Chunks separados.
4. THE Audit_Report SHALL listar os recursos que podem ser carregados sob demanda e os gargalos de abertura priorizados por impacto.
5. THE Audit_Report SHALL referenciar arquivos e pontos específicos do código-base para cada item identificado.

### Requirement 11: Otimização do build sem alterar contratos

**User Story:** Como desenvolvedor, quero que o build produza chunks bem divididos, para que a carga inicial transfira menos bytes sem mudar o comportamento do app.

#### Acceptance Criteria

1. THE Build_Pipeline SHALL preservar a separação de Chunks existente (vendor, supabase, leaflet, forms) definida no Behavior_Baseline.
2. WHERE bibliotecas pesadas não são necessárias ao First_Useful_Paint, THE Build_Pipeline SHALL isolá-las em Chunks carregados sob demanda.
3. THE Build_Pipeline SHALL produzir um bundle funcional cujo resultado de execução é equivalente ao Behavior_Baseline.
4. THE App SHALL passar a verificação de build (`build`/`tsc`) sem novos erros após as alterações de Build_Pipeline.

### Requirement 12: Não-regressão e preservação de comportamento

**User Story:** Como responsável pelo produto, quero garantia de que nenhuma funcionalidade existente quebre, para que a otimização seja segura e reversível.

#### Acceptance Criteria

1. THE App SHALL preservar o fluxo de login, registro e logout definido no Behavior_Baseline.
2. THE App SHALL preservar todas as rotas, redirecionamentos e guardas de rota (ProtectedRoute, MotoristaProtectedRoute, AdminGuard) definidos no Behavior_Baseline.
3. THE App SHALL preservar as permissões e o gating de acesso (RBAC, Stealth_404) definidos no Behavior_Baseline.
4. THE App SHALL preservar os layouts e o conteúdo visual das telas definidos no Behavior_Baseline, exceto a introdução de Skeletons e placeholders descritos nesta especificação.
5. THE App SHALL preservar as regras de negócio e os resultados de cálculo (ex: contexto de cálculo do motorista, filtro por raio, trial/assinatura) definidos no Behavior_Baseline.
6. THE App SHALL preservar os contratos de API e RPC do Supabase, sem alterar assinaturas, parâmetros ou formatos de resposta.
7. WHEN as alterações desta feature são aplicadas, THE Regression_Suite SHALL passar integralmente.
8. IF uma otimização proposta apresenta risco de alterar o Behavior_Baseline, THEN THE App SHALL adotar a alternativa que preserva o comportamento existente.

### Requirement 13: Cobertura de testes da otimização

**User Story:** Como desenvolvedor, quero testes que protejam tanto as otimizações quanto a não-regressão, para que a feature seja considerada concluída segundo a governança de testes do projeto.

#### Acceptance Criteria

1. THE Regression_Suite SHALL incluir testes unitários para a lógica de cache (chaves, expiração, invalidação, coalescência).
2. THE Regression_Suite SHALL incluir testes de propriedade (fast-check) para invariantes do Data_Cache, incluindo a propriedade de idempotência (ler do cache repetidamente retorna o mesmo valor) e a propriedade de equivalência (cache retorna o mesmo dado que a fonte).
3. THE Regression_Suite SHALL incluir testes para os caminhos negativos (falha de rede na verificação de sessão, falha de carregamento de Chunk, falha parcial de Secondary_Data).
4. THE Regression_Suite SHALL incluir testes que verifiquem a ordem de prioridade de carregamento (Auth_State antes de Primary_Content antes de Secondary_Data).
5. THE Regression_Suite SHALL armazenar os testes de código puro em `src/__tests__/` seguindo a convenção `cp<N>_<nome>.property.test.ts` para testes de propriedade.
