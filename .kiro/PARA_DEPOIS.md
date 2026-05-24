# Para Depois

Backlog de tarefas adiadas. Entradas mais recentes ficam no topo.
Cada item segue o formato `## YYYY-MM-DD — <título curto>` com
descrição abaixo.

---

## 2026-05-24 — API de pedágios — opções pesquisadas e estratégia curto prazo

Cálculo automático de pedágios baseado na rota (origem → destino) e
no número de eixos do caminhão do motorista. Hoje o painel de fretes
exibe pedágio como `—` (placeholder).

### Opções pesquisadas

- **TollGuru** — API paga (~US$260/mês para 20k chamadas);
  cobertura BR confirmada.
- **QualP** — líder do mercado BR, sem self-service; integração
  requer contato comercial direto.
- **AWS Location Service `CalculateRoute`** — pay-per-use
  (~US$0,50/1000 requests) com opção de incluir pedágios.
- **Tabela estática de pedágios** — base local de praças por BR
  (GO/SP/MG/MT/MS) e número de eixos como mitigação.

### Estratégia curto prazo (mitigação)

Manter o placeholder `—` no `FreteCard` até a entrega da próxima
feature dedicada. A primeira iteração da integração deve usar a
**tabela estática** das BRs principais (GO/SP/MG/MT/MS) por
número de eixos como aproximação, sem chamada de API. A integração
paga (TollGuru ou AWS) entra em uma segunda iteração após validar
volume real de uso.

## 2026-05-22 — Forma de pagamento integrada

Integração de gateway de pagamento (Mercado Pago, Stripe ou Asaas)
para o embarcador adiantar parte do frete e processar pagamentos
recorrentes de planos. Hoje a página de Planos é apenas estática.

## 2026-05-22 — Dashboard administrativo do dono

Painel exclusivo para o dono da plataforma com acesso global a
usuários, fretes, documentos, métricas, denúncias e moderação. Vai
exigir RLS específica de admin e UI separada.

## 2026-05-22 — Sistema de aprovação de documentos

Fluxo de admin aprovar/rejeitar CNH, CRLV, RNTRC e demais documentos
enviados pelos motoristas. Hoje todos os documentos ficam com
status `pendente` e ninguém aprova. Precisa de tela de admin, RPC
de aprovar/rejeitar e notificação ao motorista quando houver
mudança de status.
