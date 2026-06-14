# Requirements Document

## Introduction

Redesenho completo da página `/assistente` do motorista com UI estilo Siri (dark mode), integração com IA real via Supabase Edge Function e persistência de conversas no banco. O assistente responde exclusivamente sobre fretes disponíveis na região do motorista, utilizando dados de localização, raio configurado e contexto financeiro (diesel, km/L, capacidade) para recomendar cargas com estimativa de lucratividade. O provedor de IA é configurado pelo admin no painel existente (AssistantSettings), agora com suporte a OpenAI além dos existentes (Claude, Gemini, Grok, Llama).

## Glossary

- **Assistant_Page**: Página `/assistente` do motorista, redesenhada com UI dark estilo Siri
- **AI_Proxy**: Supabase Edge Function que intermedia a comunicação entre o frontend do motorista e o provedor de IA configurado pelo admin
- **Active_Provider**: Provedor de IA ativo configurado no admin (`claude`, `gemini`, `grok`, `llama` ou `openai`)
- **Freight_Context**: Conjunto de fretes ativos filtrados por localização efetiva do motorista e raio configurado, enriquecidos com estimativas financeiras
- **Calc_Context**: Dados operacionais do motorista (preço diesel, km/L, capacidade de carga em toneladas) usados para calcular lucratividade
- **Effective_Location**: Localização efetiva do motorista (GPS ou override manual) provida por `useEffectiveLocation`
- **Radius**: Raio de busca configurado pelo motorista (50, 100, 200 ou 500 km)
- **Greeting_Card**: Saudação contextual exibida na tela inicial do assistente, variando por período do dia
- **Quick_Card**: Cartão de pergunta rápida clicável exibido na tela inicial, que envia a mensagem imediatamente ao ser tocado
- **Star_Icon**: Ícone animado de estrela amarela com brilho púrpura/azul, versão ampliada do AiFab
- **Conversation_Table**: Tabela Supabase `motorista_ai_conversations` que persiste conversas do motorista
- **Message_Table**: Tabela Supabase `motorista_ai_messages` que persiste mensagens individuais de cada conversa
- **System_Prompt**: Prompt de sistema enviado ao provedor de IA que restringe o assistente a responder exclusivamente sobre fretes

## Requirements

### Requirement 1: Saudação Contextual por Período do Dia

**User Story:** Como motorista, quero ser recebido pelo assistente com uma saudação personalizada pelo período do dia e meu nome, para que a experiência pareça pessoal e acolhedora.

#### Acceptance Criteria

1. WHEN a hora local do motorista for entre 05:00 e 11:59, THE Assistant_Page SHALL exibir "Bom dia, {nome} 👋" onde {nome} é o primeiro nome do motorista autenticado
2. WHEN a hora local do motorista for entre 12:00 e 17:59, THE Assistant_Page SHALL exibir "Boa tarde, {nome} 👋" onde {nome} é o primeiro nome do motorista autenticado
3. WHEN a hora local do motorista for entre 18:00 e 04:59, THE Assistant_Page SHALL exibir "Boa noite, {nome} 👋" onde {nome} é o primeiro nome do motorista autenticado
4. IF o nome do motorista não estiver disponível, THEN THE Assistant_Page SHALL exibir a saudação sem o nome (ex: "Bom dia 👋")

### Requirement 2: UI Dark Estilo Siri com Estrela Animada

**User Story:** Como motorista, quero ver uma interface escura e moderna com um ícone animado central, para que a experiência do assistente seja visualmente atraente e distinta.

#### Acceptance Criteria

1. THE Assistant_Page SHALL utilizar fundo escuro (slate-950 ou equivalente) em toda a tela quando nenhuma conversa estiver ativa
2. THE Assistant_Page SHALL exibir o Star_Icon centralizado na tela inicial, com tamanho maior que o AiFab (mínimo 80px de diâmetro)
3. THE Star_Icon SHALL reproduzir o estilo visual do AiFab (estrela amarela de 4 pontas sobre círculo amarelo com sombra) com animação de pulso ou brilho contínuo
4. THE Star_Icon SHALL possuir brilho externo púrpura/azul animado ao redor do círculo amarelo
5. THE Assistant_Page SHALL posicionar o Greeting_Card acima do Star_Icon e os Quick_Cards abaixo dele

### Requirement 3: Cartões de Pergunta Rápida

**User Story:** Como motorista, quero ter sugestões de perguntas prontas para clicar, para que eu consiga interagir com o assistente sem precisar digitar.

#### Acceptance Criteria

1. THE Assistant_Page SHALL exibir no mínimo 3 Quick_Cards na tela inicial abaixo do Star_Icon
2. WHEN o motorista tocar em um Quick_Card, THE Assistant_Page SHALL enviar imediatamente o texto do Quick_Card como mensagem ao AI_Proxy, sem exigir confirmação adicional
3. THE Quick_Cards SHALL conter perguntas relevantes sobre fretes, incluindo pelo menos "Quais fretes tem na minha região?" e "Qual o frete mais lucrativo?"
4. WHEN uma conversa estiver ativa, THE Assistant_Page SHALL ocultar a tela inicial (Greeting_Card, Star_Icon e Quick_Cards) e exibir as mensagens no formato de chat

### Requirement 4: Barra de Input e Interface de Chat

**User Story:** Como motorista, quero digitar perguntas livremente e ver as respostas em formato de conversa, para que eu tenha uma experiência natural de chat.

#### Acceptance Criteria

1. THE Assistant_Page SHALL exibir uma barra de input fixa na parte inferior da tela com placeholder "Pergunte qualquer coisa..."
2. WHEN o motorista enviar uma mensagem (Enter ou botão), THE Assistant_Page SHALL exibir a mensagem do motorista como bolha de chat alinhada à direita (estilo WhatsApp)
3. WHEN o AI_Proxy retornar uma resposta, THE Assistant_Page SHALL exibir a resposta como bolha de chat alinhada à esquerda com avatar do assistente
4. WHILE o AI_Proxy estiver processando, THE Assistant_Page SHALL exibir indicador de digitação (dots animados) na área de mensagens
5. THE Assistant_Page SHALL permitir scroll vertical suave nas mensagens e auto-scroll para a mensagem mais recente

### Requirement 5: Foco Exclusivo em Fretes

**User Story:** Como motorista, quero que o assistente responda apenas sobre fretes disponíveis, para que eu receba informações relevantes e confiáveis sobre cargas.

#### Acceptance Criteria

1. THE AI_Proxy SHALL enviar um System_Prompt que restringe o assistente a responder exclusivamente sobre fretes disponíveis, rotas, lucratividade e logística de carga
2. WHEN o motorista perguntar sobre assuntos não relacionados a fretes, THE AI_Proxy SHALL instruir o provedor de IA a responder educadamente que só auxilia com questões de frete
3. THE System_Prompt SHALL instruir o assistente a responder em pt-BR
4. THE AI_Proxy SHALL incluir no System_Prompt o Freight_Context filtrado pela Effective_Location e Radius do motorista

### Requirement 6: Contexto de Localização e Raio

**User Story:** Como motorista, quero que o assistente considere minha localização e raio configurado para sugerir fretes próximos, para que as recomendações sejam geograficamente relevantes.

#### Acceptance Criteria

1. THE AI_Proxy SHALL filtrar fretes ativos cuja origem esteja dentro do Radius configurado pelo motorista a partir da Effective_Location
2. WHEN a Effective_Location não estiver disponível, THE AI_Proxy SHALL utilizar todos os fretes ativos sem filtro geográfico e informar ao motorista que a localização não está ativa
3. THE AI_Proxy SHALL incluir no Freight_Context a distância estimada entre a Effective_Location do motorista e a origem de cada frete filtrado
4. THE Freight_Context SHALL conter no máximo 20 fretes, ordenados por relevância (lucro/km estimado decrescente)

### Requirement 7: Análise de Lucratividade

**User Story:** Como motorista, quero que o assistente calcule e apresente estimativas de lucro por frete, para que eu tome decisões financeiras informadas.

#### Acceptance Criteria

1. THE AI_Proxy SHALL calcular o lucro líquido estimado de cada frete no Freight_Context usando Calc_Context (preço diesel, km/L e capacidade de carga)
2. THE AI_Proxy SHALL calcular o lucro por km de cada frete no Freight_Context
3. IF o Calc_Context do motorista estiver incompleto (sem km/L ou sem preço diesel), THEN THE AI_Proxy SHALL incluir os fretes no contexto sem estimativa de lucratividade e informar ao motorista que configure o perfil
4. THE AI_Proxy SHALL incluir no Freight_Context os campos: origem, destino, distância, valor do frete, lucro líquido estimado e lucro por km estimado

### Requirement 8: Provedor de IA Configurável (OpenAI)

**User Story:** Como admin, quero adicionar OpenAI como provedor de IA disponível no sistema, para que eu possa escolher qual provedor o assistente do motorista utiliza.

#### Acceptance Criteria

1. THE admin AssistantSettings SHALL incluir "openai" como opção no domínio fechado de Active_Provider, além dos existentes (claude, gemini, grok, llama)
2. WHEN o admin configurar "openai" como Active_Provider e salvar a API key via Vault, THE AI_Proxy SHALL utilizar a API da OpenAI para gerar respostas
3. THE AI_Proxy SHALL ler a chave do Active_Provider exclusivamente do Vault (padrão `assistant_provider_key_<provider>`)
4. IF a chave do Active_Provider não estiver configurada no Vault, THEN THE AI_Proxy SHALL retornar erro tipado `missing_api_key` sem expor segredos
5. THE AI_Proxy SHALL suportar modelos da família GPT (gpt-4o, gpt-4o-mini e equivalentes) quando OpenAI for o Active_Provider

### Requirement 9: Edge Function como Proxy de IA

**User Story:** Como desenvolvedor, quero que a comunicação com o provedor de IA passe por uma Edge Function segura, para que chaves de API não fiquem expostas no frontend.

#### Acceptance Criteria

1. THE AI_Proxy SHALL ser implementada como Supabase Edge Function acessível apenas por usuários autenticados com role `authenticated`
2. THE AI_Proxy SHALL receber como input: mensagem do motorista, ID da conversa e ID do motorista
3. THE AI_Proxy SHALL montar o Freight_Context consultando fretes ativos, Effective_Location e Calc_Context do motorista a partir do Supabase
4. THE AI_Proxy SHALL enviar ao provedor de IA: System_Prompt + Freight_Context + histórico recente da conversa (últimas 10 mensagens)
5. THE AI_Proxy SHALL retornar a resposta do provedor em formato JSON com campos `ok`, `content` e `error` (quando aplicável)
6. IF o provedor de IA retornar erro ou timeout, THEN THE AI_Proxy SHALL retornar `{ ok: false, error: "provider_call_failed" }` sem expor detalhes internos

### Requirement 10: Persistência de Conversas no Supabase

**User Story:** Como motorista, quero que minhas conversas sejam salvas no servidor, para que eu acesse o histórico em qualquer dispositivo.

#### Acceptance Criteria

1. THE Conversation_Table SHALL armazenar: id (UUID PK), motorista_id (FK para users), title, created_at e updated_at
2. THE Message_Table SHALL armazenar: id (UUID PK), conversation_id (FK para Conversation_Table), role (user/assistant), content (text), metadata (jsonb nullable) e created_at
3. WHEN o motorista enviar a primeira mensagem de uma nova conversa, THE Assistant_Page SHALL criar um registro na Conversation_Table e persistir a mensagem na Message_Table
4. WHEN o AI_Proxy retornar uma resposta, THE Assistant_Page SHALL persistir a resposta na Message_Table vinculada à conversa ativa
5. THE Conversation_Table SHALL aplicar RLS que permite ao motorista acessar apenas suas próprias conversas (motorista_id = auth.uid())
6. THE Message_Table SHALL aplicar RLS que permite ao motorista acessar apenas mensagens de suas próprias conversas
7. WHEN o motorista abrir o Assistant_Page, THE Assistant_Page SHALL carregar a lista de conversas do Supabase (não mais do localStorage)

### Requirement 11: Gerenciamento de Conversas

**User Story:** Como motorista, quero criar novas conversas e apagar conversas antigas, para que eu mantenha meu histórico organizado.

#### Acceptance Criteria

1. THE Assistant_Page SHALL exibir botão para criar nova conversa, resetando a tela para o estado inicial (Greeting_Card + Star_Icon + Quick_Cards)
2. THE Assistant_Page SHALL exibir lista de conversas anteriores acessível por menu ou sidebar
3. WHEN o motorista selecionar uma conversa anterior, THE Assistant_Page SHALL carregar e exibir as mensagens daquela conversa
4. WHEN o motorista solicitar exclusão de uma conversa, THE Assistant_Page SHALL remover a conversa e suas mensagens do Supabase após confirmação
5. THE Assistant_Page SHALL inferir o título da conversa a partir da primeira mensagem do motorista (máximo 40 caracteres)

### Requirement 12: Sem Limites de Uso

**User Story:** Como motorista, quero usar o assistente quantas vezes quiser sem restrições, para que eu tenha acesso livre à ferramenta.

#### Acceptance Criteria

1. THE AI_Proxy SHALL processar mensagens do motorista sem limite de quantidade por período
2. THE AI_Proxy SHALL processar mensagens sem exigir assinatura, plano pago ou créditos
3. THE Assistant_Page SHALL permitir criação ilimitada de conversas por motorista
