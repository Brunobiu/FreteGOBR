# FreteGO - Roadmap de Desenvolvimento

## Legenda
- ✅ Feito
- 🔄 Em andamento / parcial
- ⏳ Pendente
- 🗄️ Precisa de migration no banco
- 🎨 Só visual (sem banco)

---

## FASE 1 - Base do Sistema ✅

| # | Feature | Status | Banco |
|---|---------|--------|-------|
| 1.1 | Cadastro motorista/embarcador | ✅ | - |
| 1.2 | Login com seleção de perfil | ✅ | - |
| 1.3 | Lista de fretes pública | ✅ | - |
| 1.4 | Mapa interativo com fretes | ✅ | - |
| 1.5 | Filtros de busca | ✅ | - |
| 1.6 | Sugestão de viagem por localização | ✅ | - |
| 1.7 | Chat básico | ✅ | - |
| 1.8 | Security hardening | ✅ | ✅ |

---

## FASE 2 - Visual / Layout 🎨

| # | Feature | Status | Banco | Spec |
|---|---------|--------|-------|------|
| 2.1 | Tema cinza claro (light mode) | ⏳ | ❌ | layout-theme |
| 2.2 | Login com imagem de fundo | ⏳ | ❌ | login-redesign |
| 2.3 | Dashboard tabela estilo Cargill | ⏳ | ❌ | dashboard-redesign |

---

## FASE 3 - Formulário de Frete 🗄️

| # | Feature | Status | Banco | Spec |
|---|---------|--------|-------|------|
| 3.1 | Autocomplete de cidade ao digitar | ✅ | ❌ | - |
| 3.2 | Tipo de carga (lista atualizada) | ⏳ | 🗄️ | frete-form-enhancement |
| 3.3 | Espécie da carga | ⏳ | 🗄️ | frete-form-enhancement |
| 3.4 | Produto (campo texto) | ⏳ | 🗄️ | frete-form-enhancement |
| 3.5 | Peso total + unidade (ton/kg) | ⏳ | 🗄️ | frete-form-enhancement |
| 3.6 | Volumes, Peso Cubado, m³, Dimensões | ⏳ | 🗄️ | frete-form-enhancement |
| 3.7 | Tipo de frete (Completa/Complemento) | ⏳ | 🗄️ | frete-form-enhancement |
| 3.8 | Lona / Rastreador / Seguro (Sim/Não) | ⏳ | 🗄️ | frete-form-enhancement |
| 3.9 | Veículos categorizados (Leves/Médios/Pesados) | ⏳ | 🗄️ | frete-form-enhancement |
| 3.10 | Carrocerias categorizadas (Fechada/Aberta/Especial) | ⏳ | 🗄️ | frete-form-enhancement |
| 3.11 | Valor (Já sei / A combinar) + cálculo | ⏳ | 🗄️ | frete-form-enhancement |
| 3.12 | Formas de pagamento + adiantamento % | ⏳ | 🗄️ | frete-form-enhancement |
| 3.13 | Observações (500 chars, sem telefone) | ⏳ | 🗄️ | frete-form-enhancement |

**Migration necessária:** `ALTER TABLE fretes ADD COLUMN` para ~10 campos novos

---

## FASE 4 - Controle de Acesso 🗄️

| # | Feature | Status | Banco | Spec |
|---|---------|--------|-------|------|
| 4.1 | Visitante não vê valor do frete | ⏳ | ❌ | access-control |
| 4.2 | Conta básica vê valor + descrição | ⏳ | ❌ | access-control |
| 4.3 | Perfil 100% libera contato (WhatsApp + chat) | ⏳ | ❌ | access-control |
| 4.4 | Botão WhatsApp com mensagem automática | ⏳ | ❌ | access-control |
| 4.5 | Botão chat interno no frete | ⏳ | ❌ | access-control |

---

## FASE 5 - Documentos do Motorista 🗄️

| # | Feature | Status | Banco | Spec |
|---|---------|--------|-------|------|
| 5.1 | DOC Cavalo/Carretas (5 campos + adicionar mais) | ⏳ | 🗄️ | motorista-documents |
| 5.2 | ANTT (3 campos) | ⏳ | 🗄️ | motorista-documents |
| 5.3 | CNH (1 campo) | ⏳ | 🗄️ | motorista-documents |
| 5.4 | Foto segurando CNH | ⏳ | 🗄️ | motorista-documents |
| 5.5 | Foto em frente ao caminhão | ⏳ | 🗄️ | motorista-documents |
| 5.6 | Comprovante endereço proprietário | ⏳ | 🗄️ | motorista-documents |
| 5.7 | Comprovante endereço motorista | ⏳ | 🗄️ | motorista-documents |
| 5.8 | Foto caminhão completo | ⏳ | 🗄️ | motorista-documents |
| 5.9 | Número PIS | ⏳ | 🗄️ | motorista-documents |
| 5.10 | Limite de tamanho de arquivo | ⏳ | ❌ | motorista-documents |
| 5.11 | Aprovação admin para perfil 100% | ⏳ | 🗄️ | motorista-documents |
| 5.12 | Documentos não podem ser apagados pelo motorista | ⏳ | ❌ | motorista-documents |
| 5.13 | Motorista pode visualizar/editar docs no perfil | ⏳ | ❌ | motorista-documents |

**Migration necessária:** Tabela `documents` com status de aprovação

---

## FASE 6 - Chat Interno 🗄️

| # | Feature | Status | Banco | Spec |
|---|---------|--------|-------|------|
| 6.1 | Chat entre motorista e embarcador | ⏳ | 🗄️ | chat-whatsapp |
| 6.2 | Enviar documentos pelo chat (2 cliques) | ⏳ | ❌ | chat-whatsapp |
| 6.3 | Histórico de conversas | ⏳ | 🗄️ | chat-whatsapp |

---

## FASE 7 - Calculadora de Lucro 🗄️

| # | Feature | Status | Banco | Spec |
|---|---------|--------|-------|------|
| 7.1 | Perfil motorista: km do caminhão + valor diesel | ⏳ | 🗄️ | a criar |
| 7.2 | Mostrar lucro estimado em cada frete | ⏳ | ❌ | a criar |
| 7.3 | Comparar até 5 rotas | ⏳ | ❌ | a criar |
| 7.4 | Forçar localização do motorista | ⏳ | ❌ | a criar |

---

## FASE 8 - Futuro (não agora)

| # | Feature |
|---|---------|
| 8.1 | App Android e iOS |
| 8.2 | Plano pago pro embarcador |
| 8.3 | IA para sugestão de frete |
| 8.4 | Rastreamento de carga |

---

## Ordem de Implementação Recomendada

1. **Fase 2** - Layout (rápido, sem banco, impacto visual imediato)
2. **Fase 3** - Formulário de frete (migration simples + formulário)
3. **Fase 4** - Controle de acesso (sem banco, lógica frontend)
4. **Fase 5** - Documentos motorista (migration + upload)
5. **Fase 6** - Chat interno (migration + realtime)
6. **Fase 7** - Calculadora de lucro

---

## Migrations Necessárias (resumo)

```sql
-- Fase 3: Formulário de frete
ALTER TABLE fretes ADD COLUMN cargo_species VARCHAR(50);
ALTER TABLE fretes ADD COLUMN product VARCHAR(255);
ALTER TABLE fretes ADD COLUMN weight_unit VARCHAR(20);
ALTER TABLE fretes ADD COLUMN freight_type VARCHAR(20);
ALTER TABLE fretes ADD COLUMN body_types TEXT;
ALTER TABLE fretes ADD COLUMN requires_lona BOOLEAN;
ALTER TABLE fretes ADD COLUMN requires_tracker BOOLEAN;
ALTER TABLE fretes ADD COLUMN requires_insurance BOOLEAN;
ALTER TABLE fretes ADD COLUMN value_known BOOLEAN;
ALTER TABLE fretes ADD COLUMN payment_methods TEXT;

-- Fase 5: Documentos
ALTER TABLE documents ADD COLUMN status VARCHAR(20) DEFAULT 'pendente';
ALTER TABLE documents ADD COLUMN reviewed_by UUID;
ALTER TABLE documents ADD COLUMN rejection_reason TEXT;

-- Fase 7: Calculadora
ALTER TABLE motoristas ADD COLUMN truck_km_per_liter DECIMAL(5,2);
ALTER TABLE motoristas ADD COLUMN diesel_price DECIMAL(6,2);
```
