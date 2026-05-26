# Ideia 6 — Tutoriais em Vídeo (Admin + Usuários)

**Prioridade:** A definir
**Status:** Aguardando execução

## Conceito

Sistema completo de tutoriais em vídeo com duas faces:
1. **Painel Admin:** gerenciar vídeos (adicionar, excluir, segmentar por tipo de usuário, ver quem assistiu/concluiu)
2. **Painel do Usuário (motorista/embarcador):** aba "Tutoriais" com os vídeos disponíveis, progresso de visualização, notificação de novo vídeo

## Regras de Negócio (rascunho)

### Lado Admin (Dashboard)

#### CRUD de Vídeos
- Adicionar vídeo: título, descrição, URL do vídeo (YouTube embed ou upload direto), thumbnail, duração
- Segmentação: "motorista", "embarcador" ou "todos"
- Ordenação: drag-and-drop ou campo `order` numérico
- Status: ativo/inativo (inativo não aparece para usuários)
- Excluir vídeo (soft delete — preserva histórico de quem assistiu)

#### Métricas por Vídeo
- Quantos usuários viram (iniciaram)
- Quantos concluíram (assistiram até o fim ou marcaram como concluído)
- % de conclusão geral
- Lista de usuários que viram / não viram

#### Métricas Gerais
- Total de tutoriais ativos
- % de usuários que concluíram TODOS os tutoriais
- Usuários que nunca abriram a aba de tutoriais
- Filtro por tipo (motorista/embarcador)

#### Notificação Automática
- Ao adicionar novo vídeo ativo: disparar notificação para todos os usuários do segmento
- Notificação: "Novo tutorial disponível: <título>"
- Integra com sistema de notificações existente (NotificationBell)

### Lado Usuário (Motorista / Embarcador)

#### Aba Tutoriais
- Nova aba no painel do usuário (sidebar ou menu)
- Lista de vídeos disponíveis para o tipo do usuário
- Cada card: thumbnail, título, duração, badge "Novo" (se não assistiu), check verde (se concluiu)
- Player inline ou modal com o vídeo (YouTube embed ou player nativo)

#### Progresso
- Marcar como "assistido" quando o vídeo chega ao fim (ou botão manual "Marcar como concluído")
- Barra de progresso geral: "Você concluiu X de Y tutoriais"
- Badge de notificação na aba quando há vídeos novos não assistidos

#### Notificação
- Ícone de notificação (sino) com badge quando novo tutorial é adicionado
- Ao clicar: leva direto para a aba de tutoriais
- Notificação some após o usuário abrir a aba

## Modelo de Dados (rascunho)

### Tabela `tutorials`
- `id` uuid PK
- `title` text NOT NULL
- `description` text
- `video_url` text NOT NULL (YouTube embed URL ou path no storage)
- `thumbnail_url` text
- `duration_seconds` int
- `target_audience` text CHECK ('motorista', 'embarcador', 'todos')
- `sort_order` int DEFAULT 0
- `is_active` boolean DEFAULT true
- `created_at` timestamptz
- `created_by` uuid FK users (admin que criou)
- `deleted_at` timestamptz NULL (soft delete)

### Tabela `tutorial_views`
- `id` uuid PK
- `tutorial_id` uuid FK tutorials
- `user_id` uuid FK users
- `started_at` timestamptz (quando iniciou)
- `completed_at` timestamptz NULL (quando concluiu — NULL se só iniciou)
- `UNIQUE (tutorial_id, user_id)` — 1 registro por usuário por tutorial

## Dependências Técnicas

- Sistema de notificações existente (para disparar "novo tutorial")
- Player de vídeo (YouTube iframe embed é o mais simples — sem deps extras)
- Painel admin existente (novo módulo)
- RLS: usuário só vê tutoriais do seu tipo + "todos"; admin vê tudo

## Integração com Existente

- Painel admin: novo módulo "Tutoriais" na sidebar (permission: TUTORIAL_MANAGE ou similar)
- Painel do usuário: nova aba "Tutoriais" na navegação
- Sistema de notificações (NotificationBell, tabela notifications)
- Padrões admin: listagem compacta, paginação, CSV export das métricas

## Notas para Implementação

- Vídeos via YouTube embed (sem upload de vídeo no storage — economiza banda e storage)
- Detecção de "concluiu": usar YouTube IFrame API `onStateChange` para detectar fim do vídeo
- Alternativa simples: botão "Marcar como concluído" manual (mais confiável)
- Admin pode ver relatório: "Usuários que NÃO concluíram todos os tutoriais" — útil para onboarding
- Considerar gamificação futura: badge "Estudioso" para quem conclui todos
- Migration: criar tabelas + RLS + permissão TUTORIAL_MANAGE no RBAC existente
- Sem deps npm novas (YouTube embed é iframe puro)
