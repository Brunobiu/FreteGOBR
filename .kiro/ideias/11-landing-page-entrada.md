# Ideia 11 — Landing Page como Página de Entrada

**Prioridade:** A definir
**Status:** Aguardando execução

## Conceito

Mudar a primeira página do site. Em vez de cair direto nos fretes, o usuário vê uma Landing Page bonita e profissional. No header da landing tem a logo + botão "Entrar". Ao clicar "Entrar", vai para o formulário de login/criar conta. Após logar, aí sim vai para os fretes.

Se o usuário já está logado (sessão ativa), a landing page ainda aparece mas o header mostra a foto do usuário em vez de "Entrar". Ao clicar na foto ou em "Ver Fretes", vai direto para a área de fretes sem precisar logar de novo.

**Futuro (não agora):** substituir a landing por versão 3D. Por enquanto, criar uma landing page estática bonita.

## Regras de Negócio (rascunho)

### Fluxo de Navegação

#### Usuário NÃO logado:
1. Acessa `fretego.com.br` → vê Landing Page
2. Header: Logo + "Entrar" (botão)
3. Clica "Entrar" → vai para `/login` (formulário de login/registro)
4. Loga com sucesso → redireciona para `/home` (fretes)

#### Usuário JÁ logado (sessão ativa):
1. Acessa `fretego.com.br` → vê Landing Page (mesma página)
2. Header: Logo + foto/avatar do usuário (já logado automaticamente)
3. Clica na foto → dropdown com "Ver Fretes", "Meu Perfil", "Sair"
4. Clica "Ver Fretes" → vai para `/home` (fretes)
5. Não precisa logar de novo — sessão persistida

### Landing Page — Conteúdo

#### Header (fixo no topo)
- Logo FreteGO (esquerda)
- Navegação: "Como funciona", "Para Motoristas", "Para Embarcadores" (links âncora)
- Direita: botão "Entrar" (se não logado) OU foto do usuário (se logado)

#### Hero Section
- Título grande: "Conectamos quem precisa enviar com quem precisa transportar"
- Subtítulo: breve descrição do FreteGO
- CTA: "Começar agora" (vai para /login se não logado, /home se logado)
- Imagem/ilustração de caminhão ou mapa

#### Seções (scroll down)
- **Como funciona:** 3 passos simples (Publique → Encontre → Transporte)
- **Para Motoristas:** benefícios (fretes na sua rota, lucro por hora, frete de retorno)
- **Para Embarcadores:** benefícios (motoristas verificados, rastreamento, pagamento seguro)
- **Números:** KPIs públicos (X motoristas, Y fretes publicados, Z cidades)
- **Depoimentos:** (futuro — placeholder por enquanto)

#### Footer
- Links úteis, contato, redes sociais, termos de uso

### Comportamento Técnico
- Rota `/` = Landing Page (pública, sem auth necessário)
- Rota `/home` = Fretes (protegida, requer auth)
- Rota `/login` = Formulário login/registro
- Sessão Supabase: verificar `supabase.auth.getSession()` no load da landing para decidir header
- Sem redirect automático: mesmo logado, a landing aparece (o usuário escolhe quando entrar nos fretes)

### Mobile
- Landing responsiva (mobile-first)
- Header: hamburger menu em mobile
- Hero: imagem menor ou oculta
- Seções empilhadas

## Dependências Técnicas

- React Router: mudar rota `/` de `HomePage` para `LandingPage`
- Novo componente `LandingPage.tsx` (ou `src/pages/LandingPage.tsx`)
- Header da landing separado do `AppHeader` interno (são layouts diferentes)
- Supabase Auth: check de sessão para decidir estado do header
- Sem deps novas (Tailwind já cobre tudo)

## Integração com Existente

- `App.tsx` / Router: mudar rota raiz
- `LoginPage.tsx` / `RegisterPage.tsx`: já existem, manter
- `HomePage.tsx`: continua existindo em `/home`, protegida
- `ProtectedRoute.tsx`: continua protegendo `/home` e demais rotas internas
- `AppHeader.tsx`: header interno (fretes) permanece igual — landing tem header próprio

## Notas para Implementação

- **MVP:** landing page estática com Tailwind, sem animações pesadas. Bonita mas simples.
- **Futuro:** versão 3D (Three.js / React Three Fiber) — NÃO implementar agora
- Considerar SEO: landing page é a porta de entrada, precisa de meta tags boas (título, descrição, OG)
- Considerar performance: landing deve carregar rápido (lazy load das seções abaixo do fold)
- Imagens: usar WebP otimizado, ou ilustrações SVG inline
- O "Entrar" no header pode ser um link simples para `/login` — sem modal
- Animações sutis no scroll (intersection observer + classes Tailwind `animate-`) — opcional no MVP
- Não quebrar deep links: se alguém acessa `/home` direto sem estar logado, redireciona para `/login` (já funciona assim com ProtectedRoute)
