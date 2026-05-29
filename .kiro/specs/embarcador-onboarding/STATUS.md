# STATUS — embarcador-onboarding

> **29/05/2026** — spec **funcionalmente concluída**.

Funcionalidades entregues e validadas em produção:

- ✅ Cadastro de embarcador (nome, telefone, senha, empresa)
- ✅ Login com mensagem de sucesso e telefone pré-preenchido
- ✅ Header com BadgeEmpresa truncado em 20 chars no mobile
- ✅ ConfiguracoesPage sem Zona de Perigo pra embarcador
- ✅ EmbarcadorPerfilPage com barra de progresso por seção
- ✅ Verificação de e-mail por OTP (modal com código)
- ✅ Upload de logo da empresa (validação de tipo/tamanho)
- ✅ Bloqueio de "Postar Frete" se cadastro incompleto (UI + RPC)
- ✅ Mensagens anti-enumeration na verificação
- ✅ Migration 010 + bucket `company_logos` aplicados

## Pendências documentadas (não bloqueiam)

- Smoke tests manuais (16.1 a 16.12) — uso real validou
- Property tests opcionais (15.1 a 15.3) — não críticos
- Checkpoint final (17) — substituído por validação contínua

Ver `tasks.md` pra detalhes de cada item.
