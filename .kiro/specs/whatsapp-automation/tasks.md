# Implementation Plan: WhatsApp Automation

## Overview

Plano incremental e orientado a testes para construir o `WhatsApp_Module` em
`/admin/whatsapp` de ponta a ponta, conforme `design.md` e os 31 requisitos. A
ordem é: (1) fundação de schema/RLS na migration **044**; (2) lógica pura com seus
property tests `fast-check` (P1–P14); (3) modelo em memória + property tests de
servidor; (4) RPCs `SECURITY DEFINER` + camada de serviços; (5) Edge Functions
(proxy Evolution, worker durável, webhook); (6) componentes de UI e abas; (7) fiação
final do `AdminWhatsAppPage` substituindo o placeholder.

Convenções obrigatórias respeitadas em todas as tarefas:
- **admin-patterns**: `executeAdminMutation` (audit-by-construction), RBAC em duas
  camadas via `is_admin_with_permission`, versionamento otimista
  `updated_at`/`STALE_VERSION`, idempotência `_SKIPPED`, `Stealth404`, RPCs
  `SECURITY DEFINER` com `SET search_path=public` + `REVOKE ALL FROM PUBLIC` +
  `GRANT EXECUTE TO authenticated`, anti-enumeração canônica.
- **project-conventions**: TS strict + React 18 + Supabase; mensagens user-facing em
  pt-BR e action/error codes em inglês; CSV herdado (BOM UTF-8, `;`, RFC 4180,
  `\r\n`, 10000 linhas, filename `whatsapp_<YYYYMMDD>_<HHmm>.csv`); migration 044
  idempotente + par `_rollback.sql`; **Max_Instances data-driven (sem `5` hardcoded)**;
  reuso da rota `/admin/whatsapp`.
- **testing-governance**: lógica pura com property tests em
  `src/__tests__/admin/whatsapp/` (`cpN_<nome>.property.test.ts`, ≥100 iterações);
  caminhos negativos; validação frontend **e** backend; Regression_Suite atualizada;
  geradores canônicos (`fc.constantFrom` para telefones, nunca `fc.stringOf`).
- Property tests (CPs P1–P14) são **obrigatórios** e, por convenção do painel, **não**
  são marcados com `*`. Apenas testes de integração/E2E em `tests/whatsapp/` (rodam só
  no CI) são marcados com `*` como opcionais para MVP.

## Tasks

- [x] 1. Migration 044 — schema, isolamento por `instance_id`, RLS, storage e cron
  - [x] 1.1 Criar `supabase/migrations/044_whatsapp_automation.sql` com `BEGIN`, bloco `DO $check$` defensivo (exige `is_admin_with_permission` da migration 030), domínios/CHECKs de status (`session_status`, `dispatch_status`, `recipient_status`, `distribution_mode`, `dispatch_kind`, `media_type`, `conversation_mode`, `msg_direction`), tabela `whatsapp_instances` (id, label, display_order, enabled, evolution_instance_name UNIQUE) e **seed idempotente de 5 linhas** via `INSERT ... ON CONFLICT DO NOTHING` (Max_Instances = COUNT de linhas habilitadas, sem `5` hardcoded em lógica)
    - _Requirements: 18.2, 29.1, 29.3, 29.4, 29.5, 29.7_
  - [x] 1.2 Adicionar tabelas de contatos/conteúdos com `instance_id NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE`, `created_at/updated_at` + trigger de touch e índices `(instance_id, ...)`: `whatsapp_contact_lists`, `whatsapp_contacts` (UNIQUE(list_id,phone), `recipient_data jsonb`), `whatsapp_contents` (body, position, is_valid), `whatsapp_content_media` (media_type, storage_path, mime_type)
    - _Requirements: 2.5, 5.3, 6.4, 6.5, 25.3_
  - [x] 1.3 Adicionar `whatsapp_dispatch_jobs` (kind, status, distribution_mode, block_size, send_interval_sec CHECK>0, execution_quota CHECK>=1, contadores, exec_sent_count, source_job_id, started_at/completed_at, last_send_at, failure_code) e `whatsapp_dispatch_recipients` (target_kind, phone, group_jid, recipient_data, assigned_content_id, seq UNIQUE(job,seq), status, sent_at, failure_reason, provider_message_id, INDEX(job,status))
    - _Requirements: 2.5, 7.6, 8.5, 10.1, 10.3, 20.10, 23.1_
  - [x] 1.4 Adicionar `whatsapp_group_dispatches` (group_jids text[]), `whatsapp_scheduled_dispatches` (scheduled_at, executed_at, índice parcial WHERE executed_at IS NULL), `whatsapp_groups` (group_jid, name, participant_count, UNIQUE(instance_id,group_jid)) e `whatsapp_extracted_contacts` (extraction_id, source_group_jid, phone, is_valid)
    - _Requirements: 2.5, 12.2, 13.1, 13.2, 17.1, 17.8_
  - [x] 1.5 Adicionar `whatsapp_sessions` (UNIQUE(instance_id), status, qr_code, last_connected_at), `whatsapp_ai_configs` (UNIQUE(instance_id), enabled, ai_prompt, knowledge_base, has_api_key, handoff_message), `whatsapp_conversations` (contact_phone, mode default `AI_MODE`, responder_lock, last_message_*, UNIQUE(instance_id,contact_phone)), `whatsapp_messages` (direction, body, provider_event_id, UNIQUE(instance_id,provider_event_id)) e `whatsapp_ai_replies` (provider_event_id, status, UNIQUE(instance_id,provider_event_id))
    - _Requirements: 2.5, 4.2, 14.2, 16.6, 26.1, 31.1, 31.3, 31.12_
  - [x] 1.6 Habilitar RLS em todas as tabelas `whatsapp_*` e criar políticas por `instance_id` com `DROP POLICY IF EXISTS` antes de `CREATE POLICY`: leitura exige `is_admin_with_permission('SETTINGS_VIEW')`, escrita exige `SETTINGS_EDIT`, sempre restritas a `instance_id` válido (entidades-filho validadas contra o `instance_id` do pai) — uniforme para qualquer quantidade de instâncias
    - _Requirements: 2.6, 2.7, 18.3, 29.6_
  - [x] 1.7 Criar bucket privado `whatsapp-media` (`INSERT ... ON CONFLICT DO NOTHING`) com políticas de storage escopadas por `instance_id` no path `<instance_id>/<content_id>/<filename>` e acesso somente por signed URL
    - _Requirements: 6.4, 18.3_
  - [x] 1.8 Agendar o worker via `pg_cron` (`* * * * *`) usando `pg_net`/`net.http_post` para a Edge Function `whatsapp-job-worker`, com secret de invocação `whatsapp_worker_secret` lido do Vault; incluir bloco `-- VERIFY` comentado ao final
    - _Requirements: 10.2, 13.3, 27.1_
  - [x] 1.9 Criar `supabase/migrations/044_whatsapp_automation_rollback.sql` documentado (não auto-aplicado) que desfaz objetos na ordem inversa (cron job, RPCs, políticas, tabelas, domínios, bucket) preservando dados de outras migrations
    - _Requirements: 18.2_
  - [ ]* 1.10 Escrever teste de integração de isolamento RLS em `tests/whatsapp/rls_isolation.test.ts`: tentativa de acesso cruzado entre instâncias retorna vazio/erro (reforça P1)
    - _Requirements: 2.6, 2.7, 18.3_

- [x] 2. Lógica pura (sem I/O) + property tests `fast-check` (P4, P5, P7, P8, P10, P11, P12, P14)
  - [x] 2.1 Implementar `src/services/admin/whatsapp/validation.ts::normalizeNumbers(raw)` — aceita separação por vírgula/quebra de linha/ambos, normaliza removendo espaços e pontuação, deduplica, valida E.164, retorna `{ valid, invalid }`
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 24.2_
  - [x] 2.2 Escrever `src/__tests__/admin/whatsapp/cp4_contact_normalization.property.test.ts`
    - **Property 4: Normalização, deduplicação e validação de contatos**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5, 24.2**
  - [x] 2.3 Implementar `distribution.ts::assignContents(recipients, contents, mode, blockSize)` — `INTERLEAVED`: `contents[i mod M]`; `BLOCK`: `contents[floor(i/blockSize) mod M]`; total, exatamente um content por recipient
    - _Requirements: 7.2, 7.3, 7.4, 7.5_
  - [x] 2.4 Escrever `src/__tests__/admin/whatsapp/cp5_content_distribution.property.test.ts`
    - **Property 5: Distribuição atribui exatamente um conteúdo por destinatário**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**
  - [x] 2.5 Implementar `render.ts::renderMessage(template, data)` — substitui `{{nome}}`/`{{telefone}}`/`{{empresa}}`; ausente/vazio → string vazia/fallback; variável desconhecida → removida; nunca vaza marcador literal; não altera template
    - _Requirements: 25.2, 25.4, 25.5, 25.7_
  - [x] 2.6 Escrever `src/__tests__/admin/whatsapp/cp8_message_render.property.test.ts`
    - **Property 8: Renderização nunca vaza marcador literal**
    - **Validates: Requirements 25.2, 25.4, 25.5**
  - [x] 2.7 Implementar `csv.ts::toCsv(rows)` + `parseCsv` reutilizando o helper herdado do projeto (BOM UTF-8, `;`, escape RFC 4180, `\r\n`, truncamento em 10000 linhas)
    - _Requirements: 24.6, 24.7_
  - [x] 2.8 Escrever `src/__tests__/admin/whatsapp/cp10_csv_escaping.property.test.ts`
    - **Property 10: Escaping de CSV conforme a convenção do projeto (round-trip)**
    - **Validates: Requirements 24.6**
  - [x] 2.9 Implementar `stats.ts::estimatedCompletionMs(pending, intervalSec)` — `pending × intervalSec`, zero quando `pending = 0`
    - _Requirements: 28.3, 28.4_
  - [x] 2.10 Escrever `src/__tests__/admin/whatsapp/cp11_eta.property.test.ts`
    - **Property 11: Fórmula do tempo estimado de conclusão**
    - **Validates: Requirements 28.3, 28.4**
  - [x] 2.11 Implementar `stats.ts::progressPercent(processed, total)` — `processados/total` em `[0,1]`, onde processados = `SENT + FAILED + SKIPPED`
    - _Requirements: 11.4, 28.2_
  - [x] 2.12 Escrever `src/__tests__/admin/whatsapp/cp12_progress_percent.property.test.ts`
    - **Property 12: Percentual de progresso é uma razão válida**
    - **Validates: Requirements 11.4, 28.2**
  - [x] 2.13 Implementar `extractor` puro `buildDispatchReadyList(numbers)` — dedup de válidos, exclui inválidos, junta por vírgula sem espaços; dedup idempotente
    - _Requirements: 17.6, 17.9, 17.10_
  - [x] 2.14 Escrever `src/__tests__/admin/whatsapp/cp7_dispatch_ready_list.property.test.ts`
    - **Property 7: Dispatch_Ready_List é única, sem espaços e sem inválidos**
    - **Validates: Requirements 17.6, 17.9, 17.10**
  - [x] 2.15 Implementar `dispatch.ts::shouldSendNow(now, lastSendAt, intervalSec)` — decisão pura de pacing: enviar sse `now >= lastSendAt + intervalSec`
    - _Requirements: 8.6_
  - [x] 2.16 Escrever `src/__tests__/admin/whatsapp/cp14_pacing_interval.property.test.ts`
    - **Property 14: O pacing respeita o Send_Interval**
    - **Validates: Requirements 8.6**
  - [x] 2.17 Implementar validadores compartilhados front+back em `validation.ts` (Send_Interval `<=0`/NaN → `Informe um intervalo válido.`; Execution_Quota `<1`/NaN → `Informe uma quantidade válida.`; Content sem texto e sem mídia → inválido; MIME suportado → `INVALID_FILE_TYPE`; Knowledge_Base acima do limite → `O conteúdo excede o limite permitido.`; AI_Prompt vazio → `Informe um prompt válido.`) com testes unitários de caminho negativo
    - _Requirements: 5.6, 6.3, 6.5, 8.2, 8.4, 15.2, 15.3, 26.3_

- [x] 3. Modelo de servidor em memória (reducers) + property tests de servidor (P1, P2, P3, P6, P9, P13)
  - [x] 3.1 Implementar em `src/__tests__/admin/whatsapp/_model/` um store + reducers puros que espelham a lógica das RPCs/worker (isolamento por `instance_id`, claim/idempotência de recipient, quota/pacing, guarda de Conversation_Mode, idempotência de webhook, sessão única)
    - _Requirements: 2.6, 4.2, 8.5, 10.4, 16.6, 31.2_
  - [x] 3.2 Escrever `cp1_instance_isolation.property.test.ts`
    - **Property 1: Isolamento total entre instâncias**
    - **Validates: Requirements 2.6, 2.7, 26.5, 30.6, 31.18, 29.4**
  - [x] 3.3 Escrever `cp3_recipient_idempotency.property.test.ts`
    - **Property 3: Idempotência por destinatário (nenhum envio duplicado)**
    - **Validates: Requirements 10.4, 10.5, 23.3, 23.4, 27.2**
  - [x] 3.4 Escrever `cp6_execution_quota.property.test.ts`
    - **Property 6: A quota nunca é excedida por execução**
    - **Validates: Requirements 8.5, 8.7**
  - [x] 3.5 Escrever `cp2_single_responder.property.test.ts`
    - **Property 2: Responsável único (sem auto-reply em modo não-AI-allowed)**
    - **Validates: Requirements 16.7, 31.2, 31.5, 31.10, 31.11**
  - [x] 3.6 Escrever `cp9_webhook_idempotency.property.test.ts`
    - **Property 9: Idempotência do auto-reply por evento de webhook**
    - **Validates: Requirements 16.6, 31.12**
  - [x] 3.7 Escrever `cp13_single_session.property.test.ts`
    - **Property 13: No máximo uma sessão por instância**
    - **Validates: Requirements 4.2**

- [x] 4. Checkpoint — fundação (schema, lógica pura e propriedades)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Fundação de RBAC, segredos e anti-enumeração do módulo
  - [x] 5.1 Criar template/funções SQL auxiliares para as RPCs `whatsapp_*` (`SECURITY DEFINER`, `SET search_path=public`): guarda `auth.uid()` → `permission_denied`; `is_admin_with_permission('SETTINGS_VIEW'|'SETTINGS_EDIT')`; log negativo `WHATSAPP_VIEW_DENIED` (`before=NULL`, `after={user_id,reason}`); `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`
    - _Requirements: 1.4, 1.5, 1.6, 18.4_
  - [x] 5.2 Implementar guarda de acesso por instância e anti-enumeração (instância/registro/conversa inexistente ou cruzada → Canonical_Message `Não foi possível concluir a operação.`) reutilizando `CANONICAL_MESSAGES`; helper de Vault por `instance_id` (`whatsapp_evolution_key_<id>`, `whatsapp_ai_key_<id>`) sem retorno em texto puro
    - _Requirements: 2.8, 18.5, 18.7, 30.8_
  - [x] 5.3 Escrever testes unitários de gating e anti-enumeração (`expectPermissionDenied` com precedência, `WHATSAPP_VIEW_DENIED`, `expectAntiEnumeration`, `expectNoSecrets`)
    - _Requirements: 1.2, 1.6, 2.8, 18.5_

- [x] 6. Instâncias e sessão única por instância (RPCs + serviços)
  - [x] 6.1 Implementar RPC `whatsapp_list_instances` (data-driven, iterando linhas habilitadas, sem limite fixo) + `src/services/admin/whatsapp/instances.ts` retornando label, display_order e status de conexão derivado da sessão
    - _Requirements: 2.1, 2.2, 29.1, 29.2, 29.7_
  - [x] 6.2 Implementar RPCs de sessão (`whatsapp_get_session`, `whatsapp_set_session_status`) garantindo UNIQUE(instance_id) e `session.ts` com `connect/disconnect` via `executeAdminMutation` (audit com `instance_id`), reuso da mesma sessão por todos os módulos
    - _Requirements: 3.3, 3.6, 4.1, 4.2, 4.3, 4.4, 4.6, 2.9, 2.10_
  - [x] 6.3 Escrever testes unitários de transição de status de sessão, sessão única por instância, bloqueio quando não `CONNECTED` (`Conecte o WhatsApp antes de iniciar o disparo.`) e audit de conexão/desconexão
    - _Requirements: 3.4, 3.8, 4.5, 2.9_

- [x] 7. Edge Function `whatsapp-evolution-proxy` (conexão e grupos)
  - [x] 7.1 Implementar `supabase/functions/whatsapp-evolution-proxy/index.ts` (`verify_jwt = true`): connect/QR/status/logout por `instance_id` derivando `frego_wa_<instance_id>`, lendo `Evolution_Api_Key` do Vault (chave nunca trafega ao browser); erro/indisponibilidade → `Não foi possível conectar o WhatsApp.` mantendo `DISCONNECTED`
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 4.4_
  - [x] 7.2 Implementar no proxy a listagem de grupos/participantes da Evolution e o cache em `whatsapp_groups`, com paginação/lotes para grupos grandes
    - _Requirements: 12.1, 17.1, 17.14_
  - [ ]* 7.3 Escrever teste de integração do proxy contra um mock da Evolution API (connect/QR/status) em `tests/whatsapp/`
    - _Requirements: 3.1, 3.3, 3.5_

- [x] 8. Contatos e CSV (importação/exportação)
  - [x] 8.1 Implementar RPCs de Contact_List/Contact + `contacts.ts` persistindo com `instance_id`, revalidando a lista no backend (reuso de `normalizeNumbers`) antes de criar disparo; bloqueio de lista vazia (`Informe ao menos um contato válido.`)
    - _Requirements: 5.4, 5.6, 5.7, 2.5_
  - [x] 8.2 Implementar `CSV_Import` em `csv.ts` + RPC: lê Contact_Number e colunas mapeadas de Recipient_Data, aplica regras do Req 5, reporta linha inválida (nº + motivo) sem descartar em silêncio; arquivo inválido/sem coluna → `Não foi possível importar o arquivo.`; resumo lido/importado/inválido; validação front+back
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.9, 24.10_
  - [x] 8.3 Implementar `CSV_Export` em `csv.ts` (contatos e resultados) com `truncated:true` no audit e filename `whatsapp_<YYYYMMDD>_<HHmm>.csv`, distinto da Dispatch_Ready_List por vírgula
    - _Requirements: 24.6, 24.7, 24.8_
  - [x] 8.4 Escrever testes unitários de CSV_Import (linha inválida reportada, arquivo inválido) e CSV_Export (escape/truncamento/filename)
    - _Requirements: 24.3, 24.4, 24.7, 24.8_

- [x] 9. Conteúdos multimídia e upload de mídia
  - [x] 9.1 Implementar RPCs de Content + `contents.ts`: múltiplos Contents por disparo, `is_valid` (texto OU ≥1 mídia), persistência com `instance_id`, validação front+back
    - _Requirements: 6.1, 6.5, 6.6_
  - [x] 9.2 Implementar `MediaUploader`/serviço de upload para o bucket `whatsapp-media` com validação de MIME (`INVALID_FILE_TYPE`) e associação ao Content, aceitando qualquer combinação de texto/imagem/vídeo/áudio/documento
    - _Requirements: 6.2, 6.3, 6.4_
  - [x] 9.3 Escrever testes unitários de `INVALID_FILE_TYPE` (rejeição após upload concluído) e Content inválido bloqueando uso em disparo
    - _Requirements: 6.3, 6.5_

- [ ] 10. Criação de disparo: distribuição persistida e variáveis de mensagem
  - [x] 10.1 Implementar RPC `whatsapp_create_dispatch_job` que persiste o job, gera os `dispatch_recipients` com `seq` determinístico, grava `assigned_content_id` (via `assignContents`) e `recipient_data` snapshot **antes** do início, com revalidação de lista/conteúdos/intervalo/quota
    - _Requirements: 7.6, 8.8, 10.1, 25.7_
  - [x] 10.2 Implementar `dispatch.ts::createDispatchJob` (mutação via `executeAdminMutation`, audit com `instance_id`) e o tipo `MutationResult<T>` (ok/skipped)
    - _Requirements: 9.8, 10.1, 18.6_
  - [~] 10.3 Integrar `renderMessage` na pré-visualização `MessagePreview` (dados de exemplo, variáveis reconhecidas), sem alterar o template armazenado
    - _Requirements: 25.6, 25.7_
  - [~] 10.4 Escrever testes unitários de criação (revalidação backend, lista vazia, intervalo/quota inválidos, distribuição persistida com exatamente um content por recipient)
    - _Requirements: 5.7, 7.4, 8.2, 8.4_

- [ ] 11. Controles do disparo, rascunhos, histórico e reenvio de falhados
  - [x] 11.1 Implementar RPC `whatsapp_transition_dispatch` (START/PAUSE/RESUME/CANCEL) com a máquina de estados, versionamento otimista (`STALE_VERSION`), transição já aplicada → `_SKIPPED`, transição inválida → `INVALID_STATE_TRANSITION`, audit da transição válida
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
  - [x] 11.2 Implementar `dispatch.ts::transitionDispatch` + tratamento de `STALE_VERSION`/`_SKIPPED` na camada de serviço
    - _Requirements: 9.5, 9.6, 9.7_
  - [-] 11.3 Implementar RPCs/serviço de Drafts: salvar como `DRAFT` sem habilitar worker, editar (conteúdos/lista/modo/intervalo/quota) com `expected_updated_at`/`STALE_VERSION`, iniciar (`DRAFT`→`QUEUED`) revalidando no backend; bloqueios canônicos; audit
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8_
  - [-] 11.4 Implementar RPCs/serviço de Campaign_History: preservação de jobs terminais, listagem com `Execution_Duration`, detalhe escopado, Duplicar/Reenviar/Reutilizar como nova (gravando `source_job_id`), audit com origem
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.9, 20.10, 20.11, 20.12_
  - [-] 11.5 Implementar RPC/serviço `resendFailed`: novo job só com `FAILED` da origem → `QUEUED`, preservando os `SENT`; sem `FAILED` → `{skipped:true, reason:'NO_FAILED_RECIPIENTS'}` + `_SKIPPED`; audit com origem e qtd
    - _Requirements: 23.3, 23.4, 23.5, 23.6, 23.7_
  - [~] 11.6 Escrever testes unitários de transições inválidas/repetidas/stale, drafts (stale + início inválido) e failed-resend (skip sem falhas)
    - _Requirements: 9.5, 9.6, 9.7, 21.4, 21.6, 23.5_

- [ ] 12. Worker durável, agendados, recuperação e disparo em grupo
  - [x] 12.1 Implementar `supabase/functions/whatsapp-job-worker/index.ts` (`verify_jwt=false`, valida `whatsapp_worker_secret`): claim de jobs elegíveis (`FOR UPDATE SKIP LOCKED`) e claim atômico do próximo recipient `PENDING`→`SENDING`, idempotência por recipient (nunca reenvia `SENT`)
    - _Requirements: 10.2, 10.4, 10.5_
  - [~] 12.2 Implementar no worker o pacing por relógio (`shouldSendNow`) e a quota por execução (`exec_sent_count >= execution_quota` → `PAUSED` com pendentes)
    - _Requirements: 8.5, 8.6, 8.7_
  - [~] 12.3 Implementar no worker o envio via sessão da própria instância (`renderMessage` no momento do envio), marcação `SENT`/`FAILED`+`failure_reason`, prosseguimento, e transição para `COMPLETED` quando todos processados
    - _Requirements: 10.3, 10.6, 10.7, 10.9, 25.2_
  - [~] 12.4 Implementar no tick a varredura de Scheduled_Dispatches vencidos (`scheduled_at <= now AND executed_at IS NULL` → `QUEUED`), executando na primeira varredura disponível após indisponibilidade
    - _Requirements: 13.3, 13.6_
  - [~] 12.5 Implementar a semântica de recuperação (o próprio tick): retoma `QUEUED`/`RUNNING` do próximo `PENDING`, mantém `PAUSED`, não perde agendados, e marca **somente** o job inconsistente como `FAILED`/`JOB_FAILED` seguindo com os demais; cada job usa só sua sessão/`instance_id`
    - _Requirements: 10.8, 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7_
  - [~] 12.6 Implementar RPCs/serviço de Scheduled_Dispatch (`scheduled.ts`): criar exigindo data/hora futura (`Informe uma data e hora futuras.`), destinatários/grupos e ≥1 content; listar pendentes; cancelar (→`CANCELLED`); audit com `instance_id`
    - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.7_
  - [~] 12.7 Implementar Group_Dispatch (`groups.ts`) reutilizando o motor durável (`kind=GROUP`, recipients por grupo do cache), interval entre grupos, agendamento; seleção vazia → `Selecione ao menos um grupo.`
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_
  - [ ]* 12.8 Escrever teste de integração do ciclo durável em `tests/whatsapp/`: criar job, simular ticks, "reiniciar" no meio e verificar retomada sem reenvio + recuperação de agendado vencido
    - _Requirements: 10.4, 27.2, 27.4_

- [~] 13. Checkpoint — motor de disparo durável e recuperação
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Estatísticas e progresso (leitura)
  - [x] 14.1 Implementar RPC + `stats.ts` para Dispatch_Statistics por job (enviado/pendente/concluído/erro + `estimatedCompletionMs`), escopado por `instance_id`
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.6_
  - [~] 14.2 Implementar RPC de progresso/resumo (total, enviados, restantes, `progressPercent`, resumo final ao `COMPLETED`) lendo do estado persistido
    - _Requirements: 11.1, 11.3, 11.4, 11.5_
  - [~] 14.3 Escrever testes unitários de estatísticas/progresso com escopo por instância e fórmulas corretas
    - _Requirements: 28.6, 11.4_

- [x] 15. Configuração de IA por instância (chave, prompt, base)
  - [x] 15.1 Implementar RPCs + `ai.ts`: salvar AI_Api_Key no Vault (chave vazia → `Informe uma chave de API válida.`, só indicador `has_api_key`), AI_Prompt (vazio → `Informe um prompt válido.`), Knowledge_Base (acima do limite → `O conteúdo excede o limite permitido.`, sem truncar) com `expected_updated_at`/`STALE_VERSION`, audit sem gravar segredo, isolamento por `instance_id`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 26.1, 26.2, 26.3, 26.6, 26.7, 26.8_
  - [x] 15.2 Escrever testes unitários de validação de IA (chave/prompt/KB), isolamento de config entre instâncias, `STALE_VERSION` e `expectNoSecrets`
    - _Requirements: 14.2, 15.3, 26.3, 26.5_

- [x] 16. Edge Function `whatsapp-webhook` — auto-resposta idempotente com guarda de modo
  - [x] 16.1 Implementar `supabase/functions/whatsapp-webhook/index.ts` (`verify_jwt=false`, valida token/assinatura Evolution): resolve `instance_id` pela instância Evolution, `INSERT message ON CONFLICT(provider_event_id) DO NOTHING` (idempotência), upsert da Conversation (cria em `AI_MODE`), trata corpo como dado não confiável
    - _Requirements: 16.6, 31.3, 31.12_
  - [x] 16.2 Implementar o caminho de auto-reply sob lock (`claim_ai_reply` UNIQUE + `SELECT mode FOR UPDATE`): envia somente em modo AI-allowed (`AI_MODE`/`RETURNED_TO_AI`) com IA habilitada e `has_api_key`, usando prompt/chave/KB/histórico da própria instância; sucesso → `SENT`; erro provedor → `AI_PROVIDER_ERROR` (sem resposta); `HUMAN_MODE`/`AI_PAUSED`/desabilitado → `BLOCKED`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.7, 31.5, 31.10, 31.11_
  - [x] 16.3 Escrever testes unitários do webhook: idempotência por `provider_event_id`, guarda de modo (sem reply em não-AI-allowed), `AI_PROVIDER_ERROR`, isolamento de config por instância
    - _Requirements: 16.4, 16.6, 31.11, 26.4_
  - [ ]* 16.4 Escrever teste de integração de replay do mesmo `provider_event_id` contra a Edge Function em `tests/whatsapp/`
    - _Requirements: 16.6, 31.12_

- [ ] 17. Central de Conversas e transferência híbrida IA ↔ humano
  - [x] 17.1 Implementar RPCs + `conversations.ts` de listagem/detalhe escopados por `instance_id` (contato, prévia, horário, modo, histórico cronológico), revalidando `SETTINGS_VIEW`; id inexistente/cruzado → `Não foi possível concluir a operação.`
    - _Requirements: 30.1, 30.2, 30.3, 30.6, 30.7, 30.8_
  - [-] 17.2 Implementar RPCs de transição de Conversation_Mode (Human_Takeover→`HUMAN_MODE`, Return_To_AI→`RETURNED_TO_AI`/`AI_MODE`, handoff automático com `AI_Handoff_Message`→`HUMAN_MODE`) sob lock, com `expected_updated_at`/`STALE_VERSION`, já-aplicada → `_SKIPPED`, fora do domínio → `INVALID_CONVERSATION_MODE`, audit (modo anterior/novo, `instance_id`, conversa), histórico preservado, isolamento por conversa/instância
    - _Requirements: 30.4, 30.9, 31.1, 31.4, 31.6, 31.7, 31.8, 31.13, 31.14, 31.15, 31.16, 31.17, 31.18, 31.19, 31.20_
  - [~] 17.3 Escrever testes unitários de transições de modo (válidas/inválidas/skip/stale), `INVALID_CONVERSATION_MODE`, anti-enumeração de conversa e preservação de histórico
    - _Requirements: 30.8, 31.15, 31.19, 31.20_

- [ ] 18. Extrator de Contatos
  - [ ] 18.1 Implementar RPC/serviço de extração processando grupos em lotes com `Promise.allSettled` (degradação parcial: sinaliza grupos que falharam sem abortar); indisponibilidade total → `Não foi possível concluir a operação.`; seleção vazia → `Selecione ao menos um grupo.`; audit com `instance_id` e nº de grupos
    - _Requirements: 17.4, 17.11, 17.12, 17.13, 17.16_
  - [~] 18.2 Implementar `extractor.ts`: estatísticas (total, únicos, grupos analisados), dedup opcional entre grupos, `buildDispatchReadyList` (copiar/exportar texto) e CSV distinto; opera só sobre grupos/sessão da Active_Instance
    - _Requirements: 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.15_
  - [~] 18.3 Escrever testes unitários do extrator (seleção vazia, degradação parcial, indisponibilidade total anti-enum)
    - _Requirements: 17.11, 17.12, 17.13_

- [ ] 19. Superfícies de leitura — Dashboard, Fila e Logs de Erro (RPCs)
  - [~] 19.1 Implementar RPC `whatsapp_get_dashboard(p_instance_id)` (revalida `SETTINGS_VIEW`, `Promise.allSettled` por bloco): conexão, enviadas hoje, em andamento, agendadas, concluídos hoje, com erro, fila atual, Replies_Received, Active_Conversations — todos por `instance_id`
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.8, 19.9, 19.10, 19.11, 19.12, 19.13_
  - [~] 19.2 Implementar RPC/serviço da Execution_Queue agrupando por estado com o mapa de rótulos (Aguardando→`QUEUED`, Em execução→`RUNNING`, Pausada→`PAUSED`, Agendada→Scheduled, Concluída→`COMPLETED`, Cancelada→`CANCELLED`, Erro→`FAILED`), progresso e data relevante, escopo por instância
    - _Requirements: 22.1, 22.2, 22.4, 22.6, 22.7, 22.8_
  - [~] 19.3 Implementar RPC/serviço do Error_Log (lista `FAILED` com número e `failure_reason` em pt-BR sem segredos), escopo por instância
    - _Requirements: 23.1, 23.2, 23.7, 23.8_
  - [~] 19.4 Escrever testes unitários dos contadores do dashboard, mapeamento de estados da fila e escopo por instância (`expectNoSecrets` no error log)
    - _Requirements: 19.2, 19.3, 19.4, 22.8, 23.8_

- [ ] 20. Componentes de UI e abas (escopados à Active_Instance, estilo compacto)
  - [~] 20.1 Implementar `InstancePanel.tsx` data-driven (itera instâncias configuradas, sem nº fixo) com status `🟢 Conectado`/`🔴 Desconectado` e seleção de Active_Instance
    - _Requirements: 2.1, 2.2, 2.3, 29.2_
  - [~] 20.2 Implementar `ConnectionCard.tsx` (QR + status, conectar/desconectar; `Não foi possível conectar o WhatsApp.`)
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_
  - [~] 20.3 Implementar `InstanceDashboard.tsx` (cards de KPI compactos, atualização em tempo real e refresh manual)
    - _Requirements: 19.1, 19.6, 19.7_
  - [~] 20.4 Implementar `BulkDispatchTab.tsx` (lista de contatos + contador válidos/inválidos, distribuição BLOCK/INTERLEAVED, Send_Interval predefinido/custom, Execution_Quota, controles iniciar/pausar/continuar/cancelar, progresso/barra)
    - _Requirements: 5.1, 5.4, 5.5, 7.1, 8.1, 8.3, 9.1, 9.2, 9.3, 9.4, 11.1, 11.2_
  - [~] 20.5 Implementar `ContentEditor.tsx`/`MediaUploader.tsx`/`MessagePreview.tsx` (múltiplos conteúdos, upload com MIME, pré-visualização de variáveis)
    - _Requirements: 6.1, 6.2, 6.3, 25.1, 25.6_
  - [~] 20.6 Implementar `GroupDispatchTab.tsx` (seleção de 1+ grupos, conteúdo multimídia, interval, agendamento; `Selecione ao menos um grupo.`)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.7_
  - [~] 20.7 Implementar `ScheduledDispatchTab.tsx` (data/hora futura, destinatários/grupos, conteúdo, listar/cancelar pendentes)
    - _Requirements: 13.1, 13.2, 13.4, 13.5_
  - [~] 20.8 Implementar `AIServiceTab.tsx` (chave/prompt/KB com indicador de chave configurada e pendência quando ausente)
    - _Requirements: 14.5, 15.1, 26.2_
  - [~] 20.9 Implementar `ConversationInbox.tsx` (lista com contato/prévia/horário/indicador 🤖👤⏸🔄, histórico completo, "Assumir Atendimento"/"Retornar para IA" com `SETTINGS_EDIT`, realtime)
    - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.5, 31.6, 31.7, 31.9_
  - [~] 20.10 Implementar `ContactExtractorTab.tsx` (listar/buscar grupos, seleção múltipla, iniciar extração com progresso, estatísticas, dedup, Dispatch_Ready_List copiar/exportar, exportar CSV)
    - _Requirements: 17.1, 17.2, 17.3, 17.5, 17.6, 17.7, 17.8_
  - [~] 20.11 Implementar `ExecutionQueue.tsx` (grupos por estado, progresso, ações de controle conforme estado com `SETTINGS_EDIT`)
    - _Requirements: 22.1, 22.2, 22.3, 22.5, 22.7_
  - [~] 20.12 Implementar `CampaignHistory.tsx` (lista com `Execution_Duration`/totais, detalhe, Duplicar/Reenviar/Reutilizar como nova)
    - _Requirements: 20.2, 20.3, 20.4, 20.5, 20.9, 20.11_
  - [~] 20.13 Implementar `DraftsList.tsx` (lista com datas/resumo, editar e iniciar)
    - _Requirements: 21.2, 21.3, 21.5_
  - [~] 20.14 Implementar `ErrorLog.tsx` (lista `FAILED` com motivo + "Reenviar apenas os que falharam") e `StatisticsPanel` (totais + ETA por disparo)
    - _Requirements: 23.2, 23.3, 28.1, 28.5_
  - [~] 20.15 Implementar gating de UI: `Stealth404` para `SETTINGS_VIEW` ausente e exibição de controles de mutação somente com `SETTINGS_EDIT`
    - _Requirements: 1.1, 1.2, 1.3, 22.5, 31.16_

- [ ] 21. Tempo real e fiação final do `AdminWhatsAppPage`
  - [~] 21.1 Implementar hooks `useWhatsAppInstance.ts` e `useRealtimeDispatch.ts` (assinatura `postgres_changes` filtrada por `instance_id` em jobs/recipients/sessions/conversations/messages)
    - _Requirements: 11.2, 19.6, 22.3, 28.5, 30.5_
  - [~] 21.3 Implementar fallback de polling leve (~10s) e botão de atualização manual relendo do estado persistido
    - _Requirements: 11.3, 19.7_
  - [~] 21.2 Reescrever `src/pages/admin/whatsapp/AdminWhatsAppPage.tsx` substituindo o placeholder: `Instance_Panel` no topo + abas (Massa, Grupo, Programados, IA+Inbox, Extrator) e superfícies (Dashboard, Fila, Histórico, Drafts, Erros), reusando a rota `/admin/whatsapp` e o item de menu, sem alterar outras rotas; todas as operações escopadas à Active_Instance
    - _Requirements: 2.4, 4.1, 16.3, 18.1_

- [ ] 22. Regression_Suite e cobertura
  - [~] 22.1 Incorporar os novos testes (unit + property P1–P14) à Regression_Suite e atualizar `tests/coverage.config.ts`/Critical_Modules para manter o threshold de cobertura
    - _Requirements: 18.6_

- [~] 23. Checkpoint final
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas com `*` são opcionais para MVP (testes de integração/E2E em `tests/whatsapp/`, executados só no CI). Os property tests (CPs P1–P14) são obrigatórios e, por convenção do painel FreteGO, **não** levam `*`.
- Cada tarefa referencia cláusulas específicas dos requisitos para rastreabilidade.
- Os checkpoints garantem validação incremental em quebras razoáveis.
- Property tests validam as invariantes universais (P1–P14); testes unitários cobrem exemplos, caminhos negativos e limites.
- Toda mutação passa por `executeAdminMutation` (audit), RBAC em duas camadas, versionamento otimista e idempotência `_SKIPPED`; toda RPC é `SECURITY DEFINER` com `instance_id` e anti-enumeração.
- Nenhuma camada codifica o número de instâncias: elevar Max_Instances é apenas `INSERT` em `whatsapp_instances`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.3", "2.5", "2.7", "2.9", "2.11", "2.13", "2.15"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.2", "2.4", "2.6", "2.8", "2.10", "2.12", "2.14", "2.16", "2.17", "3.1"] },
    { "id": 2, "tasks": ["1.6", "1.7", "1.8", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "5.1", "5.2"] },
    { "id": 3, "tasks": ["1.9", "5.3", "6.1", "6.2", "7.1", "8.1", "9.1", "15.1"] },
    { "id": 4, "tasks": ["1.10", "6.3", "7.2", "8.2", "8.3", "9.2", "10.1", "15.2", "16.1"] },
    { "id": 5, "tasks": ["7.3", "8.4", "9.3", "10.2", "11.1", "12.6", "16.2", "17.1", "18.1", "19.1", "19.2", "19.3"] },
    { "id": 6, "tasks": ["10.3", "10.4", "11.2", "11.3", "11.4", "11.5", "12.1", "14.1", "14.2", "16.3", "17.2", "18.2", "19.4"] },
    { "id": 7, "tasks": ["11.6", "12.2", "12.3", "12.4", "12.5", "12.7", "14.3", "16.4", "17.3", "18.3"] },
    { "id": 8, "tasks": ["12.8", "20.1", "20.2", "20.3", "20.4", "20.5", "20.6", "20.7", "20.8", "20.9", "20.10", "20.11", "20.12", "20.13", "20.14", "20.15"] },
    { "id": 9, "tasks": ["21.1", "21.3"] },
    { "id": 10, "tasks": ["21.2"] },
    { "id": 11, "tasks": ["22.1"] }
  ]
}
```
