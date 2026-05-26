# Ideia 8 — Onboarding Tour Guiado (Primeiro Acesso)

**Prioridade:** A definir
**Status:** Aguardando execução

## Conceito

Na primeira vez que o usuário cria conta e entra na plataforma, aparece um tour guiado passo a passo com balões (tooltips) destacando cada área da interface. O elemento sendo explicado fica com cor forte/iluminado e o resto da tela fica escurecido (overlay escuro semi-transparente). O usuário só pode clicar em "Entendi" para avançar — não pode interagir com o resto até concluir o tour. Só acontece uma vez (primeiro login após criar conta).

## Fluxo do Tour (Motorista)

### Passo 1 — Foto e Dados do Perfil
- Destaque: ícone/avatar do perfil no topo
- Balão: "Aqui você coloca sua foto e adiciona os dados do seu caminhão, carreta e documentos."
- Botão: "Entendi"

### Passo 2 — Notificações
- Destaque: sino de notificações
- Balão: "Aqui você vê todas as notificações: novos fretes, mensagens e atualizações."
- Botão: "Entendi"

### Passo 3 — Localização
- Destaque: área do mapa ou indicador de localização
- Balão: "Mantenha a localização ativa para ter maior precisão nos fretes próximos a você."
- Botão: "Entendi"

### Passo 4 — Assistente Iara (IA)
- Destaque: botão/avatar da Iara
- Balão: "Se tiver dúvida ou quiser encontrar um frete, é só perguntar para a Iara. Ela te ajuda com tudo!"
- Botão: "Entendi"

### Passo 5 — Grade de Fretes
- Destaque: área da listagem/cards de fretes
- Balão: "Aqui ficam todos os fretes disponíveis para você. Explore, filtre e encontre o melhor para sua rota!"
- Botão: "Entendi"

### Passo Final — Boas-vindas
- Sem destaque específico (tela toda volta ao normal)
- Modal central: "Bem-vindo ao FreteGO! 🚚" + breve mensagem de boas-vindas
- Botão: "Começar"

## Regras de Negócio (rascunho)

### Quando Aparece
- Apenas no PRIMEIRO login após criar conta (flag `has_seen_tour = false`)
- Após completar o tour, marca `has_seen_tour = true` — nunca mais aparece
- Se o usuário fechar o app no meio do tour, recomeça do início no próximo login

### Comportamento Visual
- **Overlay escuro** (backdrop semi-transparente `bg-black/60`) cobrindo toda a tela
- **Elemento destacado** fica "recortado" do overlay (z-index acima, ou clip-path no overlay)
- **Balão/tooltip** posicionado ao lado do elemento destacado (cima/baixo/esquerda/direita conforme espaço)
- **Único botão clicável:** "Entendi" (ou "Próximo" / "Começar" no último)
- Não pode clicar em nenhum outro lugar da tela durante o tour
- Transição suave entre passos (fade do overlay + slide do balão)

### Variações por Tipo de Usuário
- **Motorista:** tour focado em perfil, fretes, mapa, Iara
- **Embarcador:** tour focado em publicar frete, ver interessados, chat, Iara
- Passos diferentes conforme `user.type`

### Admin
- Não tem tour (admin já sabe usar)
- Mas pode ver métricas: quantos usuários completaram o tour, quantos abandonaram

## Dependências Técnicas

- Flag `has_seen_tour` no perfil do usuário (coluna em `users` ou tabela separada)
- Componente genérico de tour/spotlight (sem lib externa — implementar com overlay + z-index)
- Posicionamento dinâmico dos balões (calcular posição do elemento-alvo via `getBoundingClientRect`)

## Integração com Existente

- `ProtectedRoute.tsx` ou `App.tsx` — verificar flag e renderizar tour
- Componentes existentes da home (AppHeader, NotificationBell, InteractiveMap, AskAiAvatar, FreteCard)
- Sistema de notificações (não disparar notificações durante o tour)
- Perfil do usuário (flag `has_seen_tour`)

## Notas para Implementação

- **Sem deps externas** (não usar react-joyride ou similar — manter padrão do projeto)
- Componente `OnboardingTour.tsx` com:
  - Array de steps: `{ targetSelector: string, title: string, description: string, position: 'top'|'bottom'|'left'|'right' }`
  - Estado: `currentStep` (0..N)
  - Overlay com `pointer-events: none` exceto no botão "Entendi"
  - Spotlight via `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)` no elemento-alvo (hack CSS clássico)
- Flag no banco: `ALTER TABLE users ADD COLUMN has_seen_tour boolean DEFAULT false`
- Marcar como visto via RPC ou update direto (RLS permite user atualizar próprio perfil)
- Mobile-first: balões devem funcionar bem em tela pequena (posicionar abaixo do elemento quando possível)
- Considerar: botão "Pular tour" discreto para usuários impacientes (marca como visto sem completar)
- Animações: `transition-all duration-300` nos balões + fade no overlay
