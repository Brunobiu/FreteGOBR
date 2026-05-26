# 00 — Regras Gerais para Todas as Ideias

**Este arquivo NÃO é uma feature para executar.** É um lembrete permanente que deve ser lido ANTES de implementar qualquer ideia desta pasta.

---

## Regra Principal: TUDO reflete no Painel Admin

O Bruno (Master Admin, `Nexus_Vortex99`) é usuário root. Ele tem acesso total e poder de fazer o que quiser. **Toda feature implementada para motorista ou embarcador DEVE ter reflexo no painel admin.** Sem exceção.

### O que isso significa na prática:

| Feature do usuário | O que o admin precisa ver/fazer |
|---|---|
| Frete de Retorno | Ver quais fretes de retorno foram sugeridos, aceitos, ignorados |
| Lucro por Hora | Ver configurações de custo dos motoristas, médias |
| Painel Financeiro Motorista | Ver receita/custo/lucro de qualquer motorista |
| Avaliação Mútua | Moderar avaliações, remover ofensivas, ver médias |
| Compartilhar Frete | Ver quantas vezes cada frete foi compartilhado (analytics) |
| Tutoriais | CRUD de vídeos, ver quem assistiu/concluiu, métricas |
| Revalidação 30 dias | Ver pendentes, forçar revalidação, configurar período |
| Onboarding Tour | Ver quem completou, quem abandonou |
| Expiração de Fretes | Ver fretes expirados, configurar tempo (se quiser mudar de 5 dias) |
| Enviar Documentação | Ver logs de envio, quem enviou pra quem |
| Landing Page | Analytics de conversão (visitou → cadastrou) |
| Trial 30 dias | Ver quem está no trial, quem expirou, estender manualmente |
| Assinatura Stripe | Assinantes ativos, inadimplentes, MRR, cancelamentos pendentes, aprovar/rejeitar |

### Notificações Automáticas do Sistema

O sistema deve enviar notificações automaticamente (sem intervenção do admin) nos seguintes casos:

- **Pagamento:** cobrar 1 dia ANTES do vencimento (lembrete) + cobrar no dia + notificar 1 dia DEPOIS se falhou
- **Trial expirando:** avisar 5 dias antes, 1 dia antes, no dia
- **Revalidação:** avisar 5 dias antes, 1 dia antes, no dia do bloqueio
- **Novo tutorial:** notificar todos do segmento quando admin adicionar vídeo
- **Avaliação:** notificar após frete encerrado para avaliar (prazo 7 dias)
- **Frete de retorno:** notificar quando um bom frete de retorno aparecer (opcional)

### Dados no Banco

Tudo vai para o Supabase (Postgres). Toda ação relevante gera registro no banco para o admin consultar. Padrões herdados:
- Audit logs para ações admin
- Histórico de eventos para ações do sistema (pagamentos, bloqueios, notificações)
- Soft delete quando fizer sentido (preservar histórico)

### Responsividade

**Todas as features de usuário devem ser responsivas (mobile-first).** Motoristas usam celular. Embarcadores podem usar desktop ou celular. Landing page responsiva. Painel admin: desktop-first mas funcional em tablet.

---

## Ordem de Execução

1. **Primeiro:** terminar admin-financeiro (spec atual em andamento)
2. **Depois:** implementar as ideias desta pasta, uma por vez, transformando em spec formal

As ideias NÃO serão executadas nesta sessão. São backlog para sessões futuras.

---

## Resumo das Ideias (índice rápido)

| # | Arquivo | Feature |
|---|---------|---------|
| 01 | `01-frete-retorno-automatico.md` | PostGIS busca fretes perto do destino |
| 02 | `02-lucro-liquido-por-hora.md` | R$/hora para comparar fretes |
| 03 | `03-painel-financeiro-motorista.md` | Dashboard receita/custo/lucro |
| 04 | `04-avaliacao-mutua-reputacao.md` | Notas 1-5 + reputação |
| 05 | `05-compartilhar-frete.md` | Share via WhatsApp/Telegram/SMS/Email |
| 06 | `06-tutoriais-video.md` | Vídeos + métricas de visualização |
| 07 | `07-revalidacao-documentos-motorista.md` | Confirmar dados a cada 30 dias |
| 08 | `08-onboarding-tour-guiado.md` | Tour guiado no primeiro acesso |
| 09 | `09-expiracao-automatica-fretes.md` | Fretes expiram em 5 dias sem edição |
| 10 | `10-enviar-documentacao-chat.md` | ZIP com todos os docs em 1 clique |
| 11 | `11-landing-page-entrada.md` | Landing page como porta de entrada |
| 12 | `12-trial-30-dias-bloqueio.md` | 30 dias grátis + bloqueio |
| 13 | `13-assinatura-stripe-motorista.md` | Planos pagos + Stripe + recorrência |
