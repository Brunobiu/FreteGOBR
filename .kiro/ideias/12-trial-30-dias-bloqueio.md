# Ideia 12 — Trial de 30 Dias + Bloqueio após Expiração

**Prioridade:** A definir
**Status:** Aguardando execução

## Conceito

Todo usuário novo (motorista e embarcador) ganha 30 dias grátis para usar o sistema. Um contador visual mostra quantos dias restam. Após os 30 dias, o acesso é bloqueado — só volta a entrar se pagar (integração com Stripe virá depois, em outra feature). Por enquanto, implementar apenas o trial + bloqueio.

## Regras de Negócio (rascunho)

### Trial
- Começa a contar a partir da data de criação da conta (`created_at`)
- Duração: 30 dias corridos
- Dias restantes: `30 - FLOOR((NOW() - created_at) / 1 dia)`
- Visível para o usuário em algum lugar da interface (header, sidebar ou banner)

### Contador Visual
- Exibir em local visível (ex: badge no header, ou banner discreto no topo)
- Formato: "Teste grátis: X dias restantes" ou "🕐 X dias"
- Cores:
  - Verde: > 10 dias
  - Amarelo: 5-10 dias
  - Vermelho: < 5 dias
  - Piscando/destaque: último dia
- Não ser intrusivo demais — discreto mas visível

### Bloqueio após 30 dias
- Quando `NOW() - created_at > 30 dias` E usuário NÃO pagou:
  - Não pode acessar fretes
  - Não pode usar chat
  - Não pode publicar fretes
  - Vê tela de bloqueio: "Seu período de teste expirou. Assine para continuar."
  - Botão "Assinar" (por enquanto: placeholder, leva para página "Em breve" ou contato)
- Fretes em andamento: decidir se bloqueia ou permite concluir (recomendo: permite concluir fretes ativos)
- Admin NÃO é afetado pelo trial (painel admin sempre acessível)

### O que NÃO implementar agora
- Stripe / pagamento recorrente (feature separada futura)
- Planos diferentes (básico, premium)
- Cupons de desconto
- Extensão manual do trial pelo admin (pode ser útil mas fica pra depois)

### Exceções
- Admin: sem trial, acesso ilimitado
- Usuários que já pagaram (futuro): flag `is_subscribed = true` bypassa o trial
- Possível: admin pode estender trial de um usuário específico (campo `trial_ends_at` editável)

## Modelo de Dados (rascunho)

### Alteração em `users`
- `trial_ends_at` timestamptz DEFAULT `created_at + INTERVAL '30 days'`
  - Permite que admin estenda manualmente se necessário
  - Ou simplesmente calcular `created_at + 30 days` sem campo extra (mais simples)
- `is_subscribed` boolean DEFAULT false (para futuro — quando Stripe entrar, marca true)

### Lógica de Bloqueio
```sql
-- Usuário bloqueado se:
trial_ends_at < NOW() AND is_subscribed = false AND user_type != 'admin'
```

## Dependências Técnicas

- Campo `created_at` em `users` (já existe)
- Novo campo `trial_ends_at` e/ou `is_subscribed` (migration simples)
- Interceptação no frontend (ProtectedRoute ou hook global)
- Tela de bloqueio (novo componente)
- Sem deps externas (Stripe vem depois)

## Integração com Existente

- `ProtectedRoute.tsx` — adicionar check de trial antes de renderizar conteúdo
- `AppHeader.tsx` ou layout — exibir contador de dias
- `users` table — novo campo
- Login flow — após login, verificar se trial expirou
- Painel admin — não afetado (bypass)

## Notas para Implementação

- **MVP:** campo `trial_ends_at` + check no frontend + tela de bloqueio + contador visual
- **Cálculo:** `diasRestantes = Math.max(0, Math.ceil((trialEndsAt - Date.now()) / 86400000))`
- **Check no frontend:** hook `useTrialStatus()` que retorna `{ daysLeft, isExpired, isSubscribed }`
- **Check no backend (RLS):** opcional — pode adicionar policy que bloqueia queries se trial expirou (defense in depth)
- **Tela de bloqueio:** componente `TrialExpiredPage.tsx` com mensagem + botão placeholder "Assinar"
- **Contador:** componente `TrialBadge.tsx` reutilizável (header ou sidebar)
- Não bloquear fretes em andamento — só novos aceites/publicações
- Admin pode ver no painel: lista de usuários com trial expirando (útil para conversão)
- Futuro: quando Stripe entrar, o botão "Assinar" vai para checkout real e marca `is_subscribed = true`
