# Refatoração UX - FreteGO

## Resumo

Reorganizar completamente o fluxo de navegação. Eliminar dashboards desnecessários, manter tudo em página única, usar modais em vez de trocar de página.

## Princípios

1. Página principal = listagem de fretes (pública, sem login)
2. Motorista NÃO tem dashboard — só perfil + listagem de fretes
3. Embarcador tem dashboard simples = seus fretes + botão postar + sugestão
4. Tudo que puder ser modal, é modal (nunca tirar o usuário da página)
5. Documentos ficam dentro do perfil, não em página separada

---

## Passos

- [ ] Passo 1: Refatorar página principal (/)
  - Rota `/` mostra listagem de fretes (não redireciona pra login)
  - Visitante vê fretes, filtros e mapa
  - Se clicar em "Contratar", pede login
  - Header com botões "Entrar" e "Cadastrar" (se não logado)
  - Header com foto/nome do usuário e link pro perfil (se logado)

- [ ] Passo 2: Refatorar fluxo do Motorista
  - Remover MotoristaDashboardPage (não existe mais)
  - Remover MotoristaHomePage (não existe mais)
  - Após login, motorista cai na listagem de fretes (/)
  - Header mostra: logo, nome do motorista, foto, link "Perfil"
  - Calculadora vira um botão pequeno no header que abre modal

- [ ] Passo 3: Refatorar perfil do Motorista
  - Página única `/perfil/motorista`
  - Tudo numa página só: dados pessoais, foto, documentos (CPF, CNH, ANTT, veículo, seguro)
  - Botão "Voltar" retorna pra listagem de fretes
  - Sem abas, sem navegação lateral

- [ ] Passo 4: Refatorar fluxo do Embarcador
  - Remover EmbarcadorDashboardPage com navegação complexa
  - Após login, embarcador cai na sua página principal `/embarcador`
  - Página mostra: seus fretes + botão "Postar Frete" (verde, +) + botão "Sugestão de Viagem"
  - "Postar Frete" abre modal (não muda de página)
  - "Sugestão de Viagem" abre modal
  - Header mostra: logo, nome da empresa, foto, link "Perfil"

- [ ] Passo 5: Refatorar perfil do Embarcador
  - Página única `/perfil/embarcador`
  - Tudo numa página só: dados pessoais, foto de perfil, logo da empresa, nome da empresa, WhatsApp
  - Botão "Voltar" retorna pra página do embarcador

- [ ] Passo 6: Refatorar App.tsx (rotas)
  - `/` = listagem pública de fretes (com header dinâmico)
  - `/login` = login
  - `/register` = cadastro
  - `/perfil/motorista` = perfil do motorista (protegida)
  - `/embarcador` = página principal do embarcador (protegida)
  - `/perfil/embarcador` = perfil do embarcador (protegida)
  - Remover rotas: `/motorista/*`, `/embarcador/dashboard`, `/embarcador/meus-fretes`, `/embarcador/postar-frete`, `/motorista/documentos`, `/motorista/calculadora`

- [ ] Passo 7: Criar header dinâmico
  - Componente `AppHeader` usado em todas as páginas
  - Não logado: logo + "Entrar" + "Cadastrar"
  - Motorista logado: logo + nome + foto + "Perfil" + "Sair"
  - Embarcador logado: logo + nome da empresa + foto + "Perfil" + "Sair"
  - Calculadora como ícone/botão pequeno (só pra motorista)

- [ ] Passo 8: Limpar arquivos removidos
  - Deletar páginas/componentes que não são mais usados
  - Atualizar imports
  - Rodar testes
  - Commitar

## Notas

- Esses passos são executados ANTES de continuar as fases 18+
- Após concluir, voltamos ao fluxo normal de fases
- Services e lógica de backend não mudam, só o frontend/rotas
