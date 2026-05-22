# Guia de Testes Manuais - FreteGO

## Como subir o projeto

```bash
npm run dev
```

O projeto vai rodar em: **http://localhost:5173**

---

## Todas as Rotas

### Públicas (sem login)

| Rota | URL | Descrição |
|------|-----|-----------|
| Home | http://localhost:5173/ | Lista de fretes disponíveis (visitante) |
| Login | http://localhost:5173/login | Página de login |
| Cadastro | http://localhost:5173/register | Criar conta (motorista ou embarcador) |

### Motorista (precisa estar logado como motorista)

| Rota | URL | Descrição |
|------|-----|-----------|
| Perfil Motorista | http://localhost:5173/perfil/motorista | Perfil, dados pessoais, upload de documentos |
| Plano Motorista | http://localhost:5173/motorista/plano | Planos e assinatura (placeholder) |

### Embarcador (precisa estar logado como embarcador)

| Rota | URL | Descrição |
|------|-----|-----------|
| Dashboard Embarcador | http://localhost:5173/embarcador | Meus fretes, postar frete |
| Perfil Embarcador | http://localhost:5173/perfil/embarcador | Perfil e dados da empresa |
| Plano Embarcador | http://localhost:5173/embarcador/plano | Planos e assinatura (placeholder) |

### Admin (precisa estar logado como admin)

| Rota | URL | Descrição |
|------|-----|-----------|
| Painel Admin | http://localhost:5173/admin | Administração geral |
| Security Dashboard | http://localhost:5173/admin/security | Dashboard de segurança |

### Geral (qualquer usuário logado)

| Rota | URL | Descrição |
|------|-----|-----------|
| Configurações | http://localhost:5173/configuracoes | Configurações da conta |

### Honeypot (armadilhas - não testar)

| Rota | URL | Descrição |
|------|-----|-----------|
| Honeypot 1 | http://localhost:5173/admin-legacy | Armadilha para bots |
| Honeypot 2 | http://localhost:5173/wp-admin | Armadilha para bots |
| Honeypot 3 | http://localhost:5173/administrator | Armadilha para bots |

---

## Roteiro de Teste

### 1. Visitante (sem login)
- [ ] Acessar http://localhost:5173/
- [ ] Ver lista de fretes
- [ ] Clicar em um frete e ver detalhes
- [ ] Ver mapa (botão "Ver mapa")
- [ ] Tentar acessar rota protegida (deve redirecionar para login)

### 2. Criar conta Motorista
- [ ] Ir em http://localhost:5173/register
- [ ] Preencher: nome, telefone, senha (mín 8 chars + maiúscula + número + especial)
- [ ] Selecionar "Motorista"
- [ ] Criar conta
- [ ] Verificar redirecionamento

### 3. Testar como Motorista
- [ ] Acessar perfil: http://localhost:5173/perfil/motorista
- [ ] Tentar fazer upload de documento
- [ ] Ver plano: http://localhost:5173/motorista/plano
- [ ] Voltar para home e ver fretes
- [ ] Clicar em frete e ver detalhes
- [ ] Testar chat

### 4. Criar conta Embarcador
- [ ] Ir em http://localhost:5173/register
- [ ] Preencher: nome, telefone, senha, nome da empresa
- [ ] Selecionar "Embarcador"
- [ ] Criar conta

### 5. Testar como Embarcador
- [ ] Acessar dashboard: http://localhost:5173/embarcador
- [ ] Postar um frete (botão "Postar Frete")
- [ ] Preencher: origem, destino, tipo de carga, veículos
- [ ] Publicar e verificar se aparece na lista
- [ ] Ver perfil: http://localhost:5173/perfil/embarcador
- [ ] Ver plano: http://localhost:5173/embarcador/plano

### 6. Verificar frete publicado
- [ ] Deslogar
- [ ] Acessar http://localhost:5173/
- [ ] Verificar se o frete aparece na lista pública
- [ ] Clicar e ver detalhes

---

## Contas de Teste

### Contas existentes (do arquivo dados_teste.txt - incompletas)

| Tipo | Telefone | Senha | Nome | Empresa |
|------|----------|-------|------|---------|
| Embarcador | (65) 4 5465-4131 | *(não definida)* | *(não definido)* | *(não definida)* |

### Contas novas (preencher conforme for criando)

| Tipo | Telefone | Senha | Nome | Empresa |
|------|----------|-------|------|---------|
| | | | | |
| | | | | |
| | | | | |

---

## Requisitos de Senha

- Mínimo 8 caracteres
- Pelo menos 1 letra maiúscula (A-Z)
- Pelo menos 1 letra minúscula (a-z)
- Pelo menos 1 número (0-9)
- Pelo menos 1 caractere especial (!@#$%^&*)
- Não pode ser senha comum (123456, password, etc.)

Exemplo válido: `Frete2024!`






embarcador 
jose dias
(45) 6 4326-2123
vgfasdWD23423@@

(62) 9 9475-7290
Santana799637@@



motorista
antonio dias
(76) 8 5756-7564
(45) 5 6325-4353
Santana799637@@


rodar o projeto

cd "C:\Users\bruno\BRUNO\Meus Projetos\FreteGO\FreteGO"; & "C:\Program Files\nodejs\npm.cmd" run dev


