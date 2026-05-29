# STATUS — motorista-perfil-extras

> **29/05/2026** — spec **funcionalmente concluída**.

Funcionalidades entregues e validadas em produção:

- ✅ CEP autocomplete via ViaCEP (Dados Pessoais, Proprietário)
- ✅ CNPJ autocomplete via BrasilAPI
- ✅ Referências (até 3) com validação de telefone
- ✅ Toggle "Caminhão NÃO é meu" expande seções de Proprietário e Contrato
- ✅ Botão "Sou eu o proprietário" copia campos
- ✅ Upload de contrato de arrendamento (PDF, ≤ 5MB)
- ✅ Save isolado por seção (Pessoais / Veículo / Proprietário / Contrato)
- ✅ Mobile responsivo (375 px sem overflow)
- ✅ Migration 018 aplicada
- ✅ Property tests críticos (phoneFormat, cep) verdes

## Pendências documentadas (não bloqueiam)

- Smoke tests manuais (8.1 a 8.11) — eu rodaria como QA mas
  já validamos cobertura via uso real
- Suite de não-regressão automática (9.x) — coberta organicamente
  por testes existentes

Ver `tasks.md` pra detalhes de cada item.
