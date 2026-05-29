# Plano de Implementação - Login Redesign

> **STATUS (29/05/2026)**: spec **substituída** por design final
> diferente do originalmente proposto. Login atualmente usa:
> - Tema **light** verde FreteGO (não escuro como na spec original).
> - Sem imagem de fundo de caminhão (decisão de produto: cleaner).
> - Card branco com sombra, escolha de perfil (embarcador/motorista),
>   campos com focus verde.
> - Link "Fale conosco" pra ticket público (notifications-hub).
>
> Funcionalidades: validação de telefone, validação de senha,
> proteção honeypot, navegação para cadastro — tudo entregue.

## Tarefas

- [x] 1. Preparação de assets
  - [x] 1.1 Logo FreteGO (substituiu imagem de fundo de caminhão)

- [x] 2. Refatorar LoginForm.tsx
  - [x] 2.1 Layout limpo (sem painel marketing escuro)
  - [x] 2.2 Estilos light mode (bg-white, rounded, shadow)
  - [x] 2.3 Logo FreteGO no topo
  - [x] 2.4 Texto e labels em light theme
  - [x] 2.5 Inputs com bg-white + border-gray-300 + focus verde
  - [x] 2.6 Erros em red-500
  - [x] 2.7 Link de cadastro em verde

- [x] 3. Checkpoint - Validação do form
  - [x] Form renderiza isolado
  - [x] Funcionalidades validadas em produção

- [x] 4. LoginPage container
  - [x] 4.1 Wrapper bg-gray-100 (cleaner que imagem)
  - [x] 4.2 Sem overlay (não usa imagem de fundo)
  - [x] 4.3 Centralização flex
  - [x] 4.4 Fallback solido (já é o default)

- [x] 5. Responsividade
  - [x] Mobile: card responsivo com mx-4
  - [x] Desktop: card max-w + centralizado

- [x] 6. Validação de funcionalidades
  - [x] Login completo com validação de telefone e senha
  - [x] Honeypot anti-bot
  - [x] Link cadastro funcional
  - [x] Link "Fale conosco" → /contato

- [x] 7. Acessibilidade
  - [x] Contraste OK no light theme
  - [x] Focus visível com ring-green
  - [x] Labels associados a inputs

## Notas

A spec original previa tema escuro com imagem de caminhão de fundo.
Durante a evolução do projeto, a paleta global mudou pra
verde claro (light theme) e o login ficou em linha com o restante
do app. Isso é uma decisão de produto que tornou parte da spec
obsoleta — o resultado funcional foi atingido com aparência
diferente.
