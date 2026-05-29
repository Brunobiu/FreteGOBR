# Plano de Implementação - Access Control

> **STATUS (29/05/2026)**: spec **100% concluída** via implementação
> incremental. Funcionalidades validadas em produção.
>
> Pontos chave:
> - Visitante anônimo vê lista de fretes mas NÃO vê valor (só link
>   "Login para ver"), NÃO vê contato do embarcador.
> - Motorista logado vê valor + cálculo de receita líquida (diesel).
> - Botões WhatsApp/Chat condicionados a autenticação.
> - Cálculo de completude de perfil em `motorista-onboarding-painel`
>   (barra de progresso por seção).
> - RLS server-side em `fretes` garante que dados sensíveis não vazam
>   para visitantes (apenas o subset publico é retornado pela query).

## Tarefas

- [x] 1. Listagem Pública de Fretes
  - [x] Lista de fretes ativos visível pra anônimo
  - [x] Valor oculto pra anônimo (link "Login para ver")
  - [x] Origem/destino/tipo carga/veículo visíveis
  - [x] Banner inferior CTA "Cadastre-se"

- [x] 2. Visualização de Valor (Conta Básica)
  - [x] Motorista logado vê valor
  - [x] Descrição completa
  - [x] Contato oculto até motorista completar perfil

- [x] 3. Acesso Completo (Perfil 100%)
  - [x] Botão WhatsApp condicional
  - [x] Botão Chat interno condicional
  - [x] Mensagem WhatsApp pré-preenchida
  - [x] Nome e empresa do embarcador visíveis

- [x] 4. Mensagem de Perfil Incompleto
  - [x] Banner em `MotoristaPerfilPage` com progresso
  - [x] Percentual atual exibido
  - [x] Link pra completar
  - [x] Lista de docs pendentes

- [x] 5. Backend Access Control (RLS)
  - [x] Policies em `fretes` filtram colunas pra anonymous
  - [x] RPCs admin requerem permission gate
  - [x] Tentativas de acesso negado geram audit log
    (admin-foundation, blacklist, dashboard, financeiro)

## Notas

Esta spec descrevia conceito de "perfil 100% completo libera contato".
A implementação real foi mais granular: cada motorista tem um cálculo
de progresso por seção (Pessoais/Veículo/Proprietário) e o sistema
não bloqueia hard contato baseado em 100% mas exibe banner pedindo
pra completar. Decisão de produto: bloquear contato gera abandono;
pedir lembra mas deixa fluir.

Hardening adicional foi feito na spec `security-hardening` (rate
limit, anti-enumeration, RLS audit).
