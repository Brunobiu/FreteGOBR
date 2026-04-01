# Checkpoint 6 - Validação de Autenticação

## Pré-requisitos

Antes de testar, você precisa configurar o Supabase:

### 1. Criar Projeto no Supabase

1. Acesse https://supabase.com
2. Faça login ou crie uma conta
3. Clique em "New Project"
4. Preencha:
   - Nome: FreteGO
   - Database Password: (escolha uma senha forte)
   - Region: South America (São Paulo)
5. Aguarde a criação do projeto (2-3 minutos)

### 2. Executar Migrations SQL

No painel do Supabase:

1. Vá em **SQL Editor** (menu lateral)
2. Clique em **New Query**
3. Copie e cole o conteúdo de `supabase/migrations/001_initial_schema.sql`
4. Clique em **Run** (ou pressione Ctrl+Enter)
5. Repita para `002_functions_and_triggers.sql`
6. Repita para `003_rls_policies.sql`

### 3. Configurar Variáveis de Ambiente

1. No Supabase, vá em **Settings** → **API**
2. Copie:
   - **Project URL** (ex: https://xxxxx.supabase.co)
   - **anon public** key (chave pública)
3. Crie o arquivo `.env` na raiz do projeto:

```env
VITE_SUPABASE_URL=sua_url_aqui
VITE_SUPABASE_ANON_KEY=sua_chave_aqui
```

### 4. Iniciar o Servidor de Desenvolvimento

```bash
npm run dev
```

Acesse http://localhost:5173

---

## Testes de Validação

### ✅ Teste 1: Registro de Motorista

1. Acesse http://localhost:5173/register
2. Preencha:
   - Tipo: **Motorista**
   - Nome: João Silva
   - Telefone: 11999999999
   - Senha: senha123
3. Clique em **Criar Conta**
4. **Esperado**: Redirecionar para /dashboard com nome do usuário exibido

### ✅ Teste 2: Registro de Embarcador

1. Acesse http://localhost:5173/register
2. Preencha:
   - Tipo: **Embarcador**
   - Nome: Maria Santos
   - Nome da Empresa: Transportes ABC
   - Telefone: 11988888888
   - Senha: senha456
3. Clique em **Criar Conta**
4. **Esperado**: Redirecionar para /dashboard com nome do usuário exibido

### ✅ Teste 3: Validação de Senha

1. Acesse http://localhost:5173/register
2. Tente criar conta com senhas inválidas:
   - `abc12` → Erro: "Senha deve ter no mínimo 6 caracteres"
   - `123456` → Erro: "Senha deve conter pelo menos 1 letra"
   - `abcdef` → Erro: "Senha deve conter pelo menos 1 número"
3. **Esperado**: Mensagens de erro exibidas corretamente

### ✅ Teste 4: Validação de Embarcador

1. Acesse http://localhost:5173/register
2. Selecione **Embarcador**
3. Preencha todos os campos EXCETO "Nome da Empresa"
4. Clique em **Criar Conta**
5. **Esperado**: Erro "Nome da empresa é obrigatório para embarcadores"

### ✅ Teste 5: Login com Credenciais Válidas

1. Acesse http://localhost:5173/login
2. Preencha:
   - Telefone: 11999999999
   - Senha: senha123
3. Clique em **Entrar**
4. **Esperado**: Redirecionar para /dashboard

### ✅ Teste 6: Login com Credenciais Inválidas

1. Acesse http://localhost:5173/login
2. Preencha:
   - Telefone: 11999999999
   - Senha: senhaerrada
3. Clique em **Entrar**
4. **Esperado**: Erro "Telefone ou senha incorretos"

### ✅ Teste 7: Logout

1. Estando logado no /dashboard
2. Clique no botão **Sair**
3. **Esperado**: Redirecionar para /login

### ✅ Teste 8: Proteção de Rotas

1. Faça logout (se estiver logado)
2. Tente acessar diretamente http://localhost:5173/dashboard
3. **Esperado**: Redirecionar automaticamente para /login

### ✅ Teste 9: Persistência de Sessão

1. Faça login
2. Feche o navegador
3. Abra novamente e acesse http://localhost:5173
4. **Esperado**: Continuar logado (redirecionar para /dashboard)

### ✅ Teste 10: Verificar RLS no Supabase

1. No Supabase, vá em **Table Editor**
2. Abra a tabela `users`
3. Verifique que os usuários criados estão lá
4. Vá em **Authentication** → **Users**
5. Verifique que os usuários aparecem na lista de autenticação
6. **Esperado**: Dados consistentes entre auth e tabela users

---

## Checklist Final

- [ ] Registro de motorista funciona
- [ ] Registro de embarcador funciona
- [ ] Validação de senha funciona
- [ ] Validação de empresa para embarcador funciona
- [ ] Login com credenciais válidas funciona
- [ ] Login com credenciais inválidas mostra erro
- [ ] Logout funciona
- [ ] Rotas protegidas bloqueiam acesso não autenticado
- [ ] Sessão persiste após fechar navegador
- [ ] RLS está ativo no banco (dados aparecem corretamente)

---

## Problemas Comuns

### Erro: "Failed to fetch"
- Verifique se o arquivo `.env` está configurado corretamente
- Verifique se as variáveis começam com `VITE_`
- Reinicie o servidor de desenvolvimento após criar o `.env`

### Erro: "Invalid API key"
- Verifique se copiou a chave **anon public** (não a service_role)
- Verifique se não há espaços extras na chave

### Erro: "relation does not exist"
- Execute as migrations SQL no Supabase
- Verifique se todas as 3 migrations foram executadas com sucesso

### Usuário criado mas não aparece no banco
- Verifique se o RLS está configurado corretamente
- Execute novamente o arquivo `003_rls_policies.sql`

---

## Próximos Passos

Após validar todos os testes acima, marque a Fase 6 como completa e prossiga para a Fase 7 (Gestão de documentos - Backend).
