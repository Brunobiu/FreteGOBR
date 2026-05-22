# Para Depois

Backlog de tarefas adiadas. Entradas mais recentes ficam no topo.
Cada item segue o formato `## YYYY-MM-DD — <título curto>` com
descrição abaixo.

---

## 2026-05-22 — API de pedágios

Cálculo automático de pedágios baseado na rota (origem → destino) e
no número de eixos do caminhão do motorista. Hoje o painel de fretes
exibe pedágio como `—` (placeholder). Investigar APIs públicas
(QualP, Sem Parar, etc) ou base de dados de praças de pedágio para
estimar o valor por viagem.

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
