# FreteGO - Guia de Teste Manual

## 🌐 Servidor: http://localhost:5173

---

## Rotas Disponíveis

### Públicas (sem login)
| Rota | Descrição |
|------|-----------|
| http://localhost:5173/login | Página de login |
| http://localhost:5173/register | Página de cadastro |
| http://localhost:5173/fretes | Listagem pública de fretes (com filtros e mapa) |
| http://localhost:5173/embarcador/:id/perfil | Perfil público do embarcador |

### Motorista (após login como motorista)
| Rota | Descrição |
|------|-----------|
| http://localhost:5173/motorista/dashboard | Dashboard do motorista (com sugestão de viagem) |
| http://localhost:5173/motorista/fretes | Listagem de fretes disponíveis |
| http://localhost:5173/motorista/perfil | Editar perfil do motorista |
| http://localhost:5173/motorista/documentos | Upload de documentos (CPF, CNH, ANTT, etc.) |
| http://localhost:5173/motorista/calculadora | Calculadora de frete (em breve) |

### Embarcador (após login como embarcador)
| Rota | Descrição |
|------|-----------|
| http://localhost:5173/embarcador/dashboard | Dashboard do embarcador |
| http://localhost:5173/embarcador/postar-frete | Postar novo frete |
| http://localhost:5173/embarcador/meus-fretes | Gerenciar fretes (editar, excluir, analytics) |
| http://localhost:5173/embarcador/perfil | Editar perfil do embarcador |

---

## Fluxo de Teste Sugerido

### 1. Cadastrar Embarcador
- Acesse `/register`
- Selecione "Embarcador"
- Preencha nome, empresa, telefone e senha
- Senha: mínimo 6 caracteres, 1 letra, 1 número

### 2. Postar Frete (como Embarcador)
- Acesse `/embarcador/postar-frete`
- Preencha origem, destino (com lat/lng), tipo de carga, veículo, peso, valor, prazo
- Coordenadas de exemplo:
  - Goiânia: lat -16.6869, lng -49.2648
  - São Paulo: lat -23.5505, lng -46.6333
  - Brasília: lat -15.7801, lng -47.9292

### 3. Verificar Fretes
- Acesse `/embarcador/meus-fretes` para ver seus fretes
- Acesse `/fretes` para ver a listagem pública
- Teste os filtros e o botão "Ver mapa"

### 4. Cadastrar Motorista
- Faça logout
- Acesse `/register`
- Selecione "Motorista"
- Preencha os dados

### 5. Testar como Motorista
- Acesse `/motorista/dashboard` — teste "Me sugerir uma viagem"
- Acesse `/motorista/fretes` — veja os fretes disponíveis
- Clique em um frete → botão "Contratar via WhatsApp"
- Acesse `/motorista/documentos` — faça upload de documentos
- Acesse `/motorista/perfil` — edite dados e foto

---

## SQL para Limpar Banco de Dados

Execute no SQL Editor do Supabase (nesta ordem):

```sql
-- Limpar todos os dados (mantém estrutura)
DELETE FROM chat_messages;
DELETE FROM chat_conversations;
DELETE FROM notifications;
DELETE FROM audit_logs;
DELETE FROM frete_clicks;
DELETE FROM avaliacoes;
DELETE FROM fretes;
DELETE FROM documents;
DELETE FROM motoristas;
DELETE FROM embarcadores;
DELETE FROM users;
```

Depois, vá em **Authentication > Users** no Supabase e delete todos os usuários de lá também.
