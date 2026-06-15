# Funcionalidades do Motorista — Mapa para Limites por Plano

> Documento de planejamento. Lista **todas** as funcionalidades que o motorista
> tem hoje no FreteGO, agrupadas por categoria. Use a coluna de cada plano para
> marcar o que cada tier libera. **Nada de gating foi implementado ainda** — isto
> é só o mapa pra você decidir.

## Como ler este documento

Temos **3 planos** (todos parcela única, renovam ao fim do ciclo):

| Plano        | Ciclo    | Preço/mês | Total     | Destaque |
| ------------ | -------- | --------- | --------- | -------- |
| **Semestral** | 6 meses  | R$ 29,90  | R$ 179,40 | ⭐ (forçado / recomendado) |
| **Trimestral** | 3 meses | R$ 34,90  | R$ 104,70 | — |
| **Mensal**    | 1 mês    | R$ 39,90  | R$ 39,90  | — |

Estratégia que você descreveu:
- **6 meses = tudo 100%** (experiência completa, sem limites).
- **3 meses = limita algumas coisas** (intermediário).
- **1 mês = limita mais** (entrada / básico).

Para cada funcionalidade abaixo, marque:
- ✅ liberado / ❌ bloqueado / 🔢 liberado com limite numérico (anote o número).

> Existe também o **trial de 30 dias grátis** (todo motorista novo). Durante o
> trial o acesso é completo. Vencido o trial sem assinar, o motorista entra em
> `suspended`: **vê o feed mas não interage** (não curte, não contata, não usa
> chat). Vale decidir se o trial dá experiência de "6 meses" ou de algum tier
> intermediário.

---

## 1. Cadastro e Perfil (base — provavelmente livre em todos)

Acessível pelo **Menu do Motorista** (`/motorista/menu`). São os blocos de
preenchimento do perfil:

| # | Funcionalidade | Rota | 6 meses | 3 meses | 1 mês |
| - | -------------- | ---- | :-----: | :-----: | :---: |
| 1.1 | **Perfil / Dados pessoais** | `/motorista/perfil` | ✅ | ✅ | ✅ |
| 1.2 | **Tração** (cavalo mecânico + documentos) | `/motorista/tracao` | ✅ | ✅ | ✅ |
| 1.3 | **Carroceria** (implemento + documentos) | `/motorista/carroceria` | ✅ | ✅ | ✅ |
| 1.4 | **Complemento** (consumo km/l, peso, capacidade) | `/motorista/complemento` | ✅ | ✅ | ✅ |
| 1.5 | **Referências** (contatos) | `/motorista/referencias` | ✅ | ✅ | ✅ |
| 1.6 | **Contrato / Documentos** | `/motorista/contrato` | ✅ | ✅ | ✅ |
| 1.7 | **Configurações** (conta, tema, app) | `/configuracoes` | ✅ | ✅ | ✅ |
| 1.8 | **Tutorial** (vídeos de onboarding) | `/tutorial` | ✅ | ✅ | ✅ |

> Sugestão: o cadastro completo é pré-requisito pra usar o resto, então faz
> sentido deixar 100% livre em todos os planos. O **gate de contato com
> embarcador** já exige hoje: perfil + tração + carroceria + complemento
> preenchidos (referências é opcional).

---

## 2. Feed de Fretes (o coração do app)

Tela inicial do motorista (`/` → `/fretes`). Candidata óbvia a limites por tier.

| # | Funcionalidade | Detalhe | 6 meses | 3 meses | 1 mês |
| - | -------------- | ------- | :-----: | :-----: | :---: |
| 2.1 | **Ver lista de fretes disponíveis** | Feed principal | ✅ | ❓ | ❓ |
| 2.2 | **Filtro por raio de distância** | Opções: 50 / 100 / 200 / 500 km | ✅ todos os raios | ❓ limitar raio máx? | ❓ limitar raio máx? |
| 2.3 | **Filtro por categoria de commodity** | Carrossel de categorias | ✅ | ❓ | ❓ |
| 2.4 | **Cálculo financeiro do frete** | Lucro líquido/km, custo diesel (usa complemento) | ✅ | ❓ | ❓ |
| 2.5 | **Input de preço do diesel** | Personaliza o cálculo | ✅ | ❓ | ❓ |
| 2.6 | **Atualização em tempo real do feed** | Novos fretes aparecem sozinhos | ✅ | ✅ | ✅ |
| 2.7 | **Curtir / demonstrar interesse no frete** | Notifica o embarcador | ✅ | 🔢 limite/dia? | 🔢 limite/dia? |

> **Ideias de limite no feed** (você decide):
> - Raio: 6m libera até 500km; 3m até 200km; 1m até 100km.
> - Curtidas/interesses: 6m ilimitado; 3m X por dia; 1m Y por dia.
> - Cálculo financeiro avançado só no 6m (1m vê só o valor bruto).

---

## 3. Detalhe do Frete (modal) e Contato com Embarcador

Ao abrir um frete (`FreteModal`). Aqui está o **maior valor** do app — onde o
motorista fecha negócio.

| # | Funcionalidade | Detalhe | 6 meses | 3 meses | 1 mês |
| - | -------------- | ------- | :-----: | :-----: | :---: |
| 3.1 | **Ver detalhes completos do frete** | Origem, destino, valor, carga | ✅ | ❓ | ❓ |
| 3.2 | **Contato via WhatsApp** | Deep link direto pro embarcador | ✅ | ❓ | ❓ |
| 3.3 | **Abrir chat interno com o embarcador** | Conversa dentro do app | ✅ | ❓ | ❓ |
| 3.4 | **Frete de Retorno** | Busca cargas a partir do destino (evita voltar vazio) | ✅ | ❓ recurso premium? | ❌ premium? |
| 3.5 | **Ver card do embarcador** | Nome, CNPJ, foto pública | ✅ | ✅ | ✅ |

> **Frete de Retorno** é um diferencial forte — bom candidato a recurso
> exclusivo do 6 meses (ou 6m + 3m). Hoje só exige perfil completo.
> **Contato (WhatsApp + chat)** é o que gera dinheiro pro motorista — pense bem
> antes de limitar muito no 1 mês (mas pode limitar **quantidade** de contatos/dia).

---

## 4. Chat / Mensagens

Slot **Chat** na bottom nav + página `/mensagens`.

| # | Funcionalidade | Detalhe | 6 meses | 3 meses | 1 mês |
| - | -------------- | ------- | :-----: | :-----: | :---: |
| 4.1 | **Lista de conversas** | Todos os chats com embarcadores | ✅ | ❓ | ❓ |
| 4.2 | **Enviar mensagem de texto** | — | ✅ | ✅ | ✅ |
| 4.3 | **Enviar áudio** | Gravação de voz | ✅ | ❓ | ❌ premium? |
| 4.4 | **Enviar anexo** (foto/documento) | Clipe de upload | ✅ | ❓ | ❌ premium? |
| 4.5 | **Badge de conversas não lidas** | Contador em tempo real | ✅ | ✅ | ✅ |
| 4.6 | **Card do frete dentro do chat** | Origem→destino + selo ativo/inativo | ✅ | ✅ | ✅ |
| 4.7 | **Mensagens em tempo real** | Aparecem instantâneas | ✅ | ✅ | ✅ |

> Áudio e anexo são bons candidatos a "premium" — 1 mês só texto, 6m completo.

---

## 5. Mapa e Rota

| # | Funcionalidade | Rota / Detalhe | 6 meses | 3 meses | 1 mês |
| - | -------------- | -------------- | :-----: | :-----: | :---: |
| 5.1 | **Mapa fullscreen** | `/motorista/mapa` — fretes no mapa | ✅ | ❓ | ❓ |
| 5.2 | **Rota traçada origem→destino** | Linha da viagem | ✅ | ❓ | ❓ |
| 5.3 | **Cidades do trajeto** | Lista origem → cidades → destino | ✅ | ❓ | ❌ premium? |
| 5.4 | **Mini-mapa no detalhe do frete** | Dentro do modal | ✅ | ✅ | ✅ |

---

## 6. Assistente de IA

| # | Funcionalidade | Rota / Detalhe | 6 meses | 3 meses | 1 mês |
| - | -------------- | -------------- | :-----: | :-----: | :---: |
| 6.1 | **Assistente IA** | `/assistente` (botão flutuante AiFab) | ✅ | ❓ limite de perguntas? | ❌ ou muito limitado |

> A IA tem **custo por requisição** (Gemini/OpenAI). Forte candidata a:
> - 6m: ilimitado (ou cota alta).
> - 3m: X perguntas/dia.
> - 1m: bloqueado ou cota baixa.
> ⚠️ Hoje a chave de IA está inconsistente (`assistant_config` aponta Gemini com
> model do Claude, só há chave Gemini no Vault). Precisa configurar no painel
> admin → Anúncios → Assistente antes de cobrar por isso.

---

## 7. Marketplace e Extras

| # | Funcionalidade | Rota / Detalhe | 6 meses | 3 meses | 1 mês |
| - | -------------- | -------------- | :-----: | :-----: | :---: |
| 7.1 | **Marketplace de anúncios** | `/motorista/marketplace` | ✅ | ❓ | ❓ |
| 7.2 | **Tabela ANTT** | `/motorista/tabela-antt` — piso de frete oficial | ✅ | ✅ | ✅ |
| 7.3 | **Anúncios / carrossel no topo** | Banner promocional | ✅ | ✅ | ✅ |

---

## 8. Notificações (transversal — provavelmente livre)

| # | Funcionalidade | Detalhe | 6 meses | 3 meses | 1 mês |
| - | -------------- | ------- | :-----: | :-----: | :---: |
| 8.1 | **Notificações em tempo real** | Sino no header + contador | ✅ | ✅ | ✅ |
| 8.2 | **Push notifications** | Mobile (device tokens) | ✅ | ✅ | ✅ |

> Notificações são parte da experiência básica; limitar aqui prejudica o app
> sem gerar percepção de "premium". Sugiro livre em todos.

---

## 9. Assinatura (sempre acessível)

| # | Funcionalidade | Rota / Detalhe |
| - | -------------- | -------------- |
| 9.1 | **Tela de Planos** | `/motorista/plano` — escolher e assinar (Asaas) |
| 9.2 | **Status do trial / badge** | "X dias restantes" / "PRO" / "FREE" no menu |

> Sempre livre — é por aqui que o motorista paga. Independente do tier.

---

## Resumo: candidatos a diferencial entre planos

Funcionalidades onde faz mais sentido criar a separação de valor:

| Funcionalidade | Sugestão de gating |
| -------------- | ------------------ |
| **Frete de Retorno** (3.4) | Só 6m (ou 6m+3m) |
| **Raio de busca** (2.2) | 6m: 500km · 3m: 200km · 1m: 100km |
| **Curtidas / interesses por dia** (2.7) | 6m: ilimitado · 3m: cota média · 1m: cota baixa |
| **Contatos (WhatsApp/chat) por dia** (3.2/3.3) | 6m: ilimitado · 3m: cota · 1m: cota baixa |
| **Áudio + anexo no chat** (4.3/4.4) | Só 6m (ou 6m+3m) |
| **Assistente IA** (6.1) | 6m: alto · 3m: cota · 1m: bloqueado/baixo (tem custo real) |
| **Cidades do trajeto no mapa** (5.3) | Só 6m (ou 6m+3m) |
| **Cálculo financeiro avançado** (2.4) | Só 6m mostra lucro líquido/km completo |

## O que deixar 100% livre em todos os planos

- Cadastro e perfil completo (categoria 1)
- Ver o feed básico de fretes (2.1)
- Texto no chat (4.2)
- Notificações (categoria 8)
- Tabela ANTT (7.2)
- Tela de planos / assinatura (categoria 9)

---

### Próximo passo

Quando você decidir o que cada plano libera, me devolve este documento com as
colunas preenchidas (ou só me fala "6m tudo, 3m sem frete de retorno e raio até
200, 1m só básico" etc.) e eu implemento o gating — provavelmente via um helper
puro tipo `planFeatures.ts` (mapeia `PlanId` → set de features/limites) +
checagem no front **e** no servidor (RLS/RPC), seguindo o padrão de
`canInteract` que já existe em `trialStatus.ts`.
