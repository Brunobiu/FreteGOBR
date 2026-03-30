# FreteGO - Guia de Teste Manual

## 🌐 Servidor: http://localhost:5173

---

## Rotas

| Rota | Descrição | Acesso |
|------|-----------|--------|
| http://localhost:5173/ | Listagem de fretes (página principal) | Pública |
| http://localhost:5173/login | Login | Pública |
| http://localhost:5173/register | Cadastro | Pública |
| http://localhost:5173/perfil/motorista | Perfil do motorista (dados + documentos) | Motorista logado |
| http://localhost:5173/embarcador | Página do embarcador (fretes + postar) | Embarcador logado |
| http://localhost:5173/perfil/embarcador | Perfil do embarcador | Embarcador logado |

---

## Fluxo de Teste

### 1. Visitante (sem login)
- Acesse `/` — veja os fretes disponíveis
- Use filtros e mapa
- Clique num frete — veja detalhes
- Tente contratar — pede login

### 2. Cadastrar Motorista
- Clique "Cadastrar" no header
- Selecione "Motorista", preencha dados
- Após cadastro, cai na listagem de fretes
- Header mostra seu nome + link "Perfil"

### 3. Perfil do Motorista
- Clique "Perfil" no header → `/perfil/motorista`
- Tudo numa página: dados pessoais, veículo, documentos
- Faça upload de documentos
- Salve alterações
- "Voltar" retorna pra listagem de fretes

### 4. Cadastrar Embarcador
- Faça logout, cadastre como embarcador
- Após cadastro, cai em `/embarcador`

### 5. Página do Embarcador
- Veja seus fretes na página principal
- Clique "Postar Frete" (botão verde +) → abre modal
- Preencha e publique
- Frete aparece na lista sem sair da página

### 6. Perfil do Embarcador
- Clique "Perfil" → `/perfil/embarcador`
- Edite nome, empresa, WhatsApp, foto
- "Voltar" retorna pra página do embarcador

---

## SQL para Limpar Banco

```sql
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

Depois delete os usuários em Authentication > Users no Supabase.

## SQL para Criar Bucket de Storage

Execute o conteúdo de `supabase/storage/setup_storage.sql` no SQL Editor.

## SQL para Corrigir Schema

Execute o conteúdo de `supabase/migrations/004_fix_schema_alignment.sql` no SQL Editor.
