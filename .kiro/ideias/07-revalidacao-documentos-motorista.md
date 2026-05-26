# Ideia 7 — Revalidação de Documentos do Motorista (30 dias)

**Prioridade:** A definir
**Status:** Aguardando execução

## Conceito

A cada 30 dias, o sistema pede para o motorista confirmar que seus documentos e dados cadastrais ainda estão corretos (veículo, carreta/conjunto, empresa). Motoristas trocam muito de caminhão, trela e conjunto — os dados ficam desatualizados rápido. Até confirmar, o motorista fica com "cadastro pendente" e não pode operar na plataforma.

## Regras de Negócio (rascunho)

### Ciclo de Revalidação
- **Período:** 30 dias corridos desde a última confirmação
- **Trigger:** cron job diário (ou check no login) verifica se `last_revalidation + 30 dias < NOW()`
- **Bloqueio:** quando vence, motorista entra em estado "revalidação pendente"
  - Não pode aceitar fretes
  - Não pode ver fretes disponíveis (ou vê mas com overlay "Confirme seus dados")
  - Não pode usar chat (exceto mensagens de fretes já em andamento)
  - Fretes já em andamento NÃO são afetados (não cancela frete ativo)

### Fluxo do Motorista
1. Login normal → sistema detecta que revalidação venceu
2. Tela de bloqueio: "Seus dados precisam ser confirmados a cada 30 dias"
3. Checklist de confirmação:
   - [ ] Dados do veículo (placa, tipo, ano) — "Ainda é esse veículo?"
   - [ ] Dados da carreta/conjunto (se aplicável) — "Ainda usa essa carreta?"
   - [ ] RNTRC — "Ainda válido?"
   - [ ] Empresa/autônomo — "Ainda trabalha na mesma empresa?" ou "Ainda é autônomo?"
   - [ ] CNH — "Ainda válida?" (verificar vencimento se tiver data)
4. Para cada item: botão "Confirmar" (mantém) ou "Atualizar" (abre edição)
5. Após confirmar TODOS os itens → status volta ao normal, `last_revalidation = NOW()`
6. Se atualizar algum dado → pode precisar de re-aprovação do admin (opcional no MVP)

### Notificações
- **5 dias antes:** notificação "Sua confirmação de dados vence em 5 dias"
- **1 dia antes:** notificação "Amanhã seus dados precisam ser confirmados"
- **No dia:** notificação "Confirme seus dados para continuar usando a plataforma"
- **Após bloqueio:** notificação diária até confirmar

### Painel Admin
- Ver lista de motoristas com revalidação pendente
- Ver histórico de revalidações de cada motorista
- Configurar período (30 dias é default, mas admin pode mudar)
- Forçar revalidação de um motorista específico (ex: suspeita de dados errados)
- Relatório: % de motoristas em dia vs pendentes

## Modelo de Dados (rascunho)

### Alteração em `users` (ou tabela de perfil do motorista)
- `last_revalidation_at` timestamptz — última vez que confirmou
- `revalidation_due_at` timestamptz — quando vence (= last + 30 dias)
- `revalidation_status` text CHECK ('ok', 'pending', 'overdue') — calculado ou trigger

### Tabela `revalidation_history` (opcional, para auditoria)
- `id` uuid PK
- `user_id` uuid FK users
- `confirmed_at` timestamptz
- `items_confirmed` jsonb (quais itens confirmou sem alterar)
- `items_updated` jsonb (quais itens alterou)

## Dependências Técnicas

- Cron job ou Edge Function scheduled (Supabase suporta pg_cron ou Edge Function com cron trigger)
- Sistema de notificações existente
- Tela de bloqueio/interceptação no frontend (similar ao fluxo de onboarding pendente)
- Dados do veículo/documentos do motorista (já existem no schema)

## Integração com Existente

- Fluxo de login/proteção de rotas (ProtectedRoute.tsx) — interceptar se revalidação pendente
- Perfil do motorista (dados do veículo, RNTRC, empresa)
- Sistema de notificações (NotificationBell)
- Painel admin: novo bloco ou módulo "Revalidações"
- Onboarding do motorista (reusar componentes de edição de dados)

## Notas para Implementação

- **MVP simples:** check no login + tela de confirmação com botões "Confirmar tudo" / "Preciso atualizar"
- **Evolução:** checklist item a item com edição inline
- Cuidado: não bloquear motorista que está com frete em andamento (só bloquear novos aceites)
- pg_cron no Supabase: `SELECT cron.schedule('revalidation-check', '0 6 * * *', $$UPDATE users SET revalidation_status = 'overdue' WHERE ...$$)`
- Alternativa sem cron: verificar no frontend a cada login/navegação (mais simples, menos preciso para notificações)
- Considerar grace period: 3 dias após vencer antes de bloquear (para não pegar motorista de surpresa)
