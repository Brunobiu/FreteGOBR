# Frete Comunidade — Documentação Técnica

Muleta de lançamento: um perfil-fantasma global, controlado só pelo admin, que
publica em lote fretes coletados em grupos de WhatsApp de caminhoneiro. Esses
fretes entram na MESMA tabela `fretes` e aparecem no MESMO feed/mapa do
motorista, com identidade visual própria ("Frete Comunidade") e um botão
WhatsApp no lugar do Chat. A feature é desligável por uma flag global.

Spec completa: `.kiro/specs/frete-comunidade/{requirements,design,tasks}.md`.

## Visão geral

- Acesso só admin (`/admin/frete-comunidade`), gating `FINANCEIRO_VIEW` (ver) e
  `FINANCEIRO_EDIT` (publicar/editar perfil). Sem pagamento envolvido.
- Publicação por planilha **CSV** (MVP; XLSX é fase futura).
- Duas regras transversais que valem para **TODOS os fretes** (embarcador real
  + comunidade): **auto-expiração em 5 dias** e **bloqueio de duplicado**.

## Formato da planilha (CSV)

Baixe o modelo pelo botão "Baixar modelo" — ele já vem com o cabeçalho correto,
BOM UTF-8, separador `;` e uma linha de exemplo. Colunas, na ordem exata:

| Coluna | Obrigatória | Observação |
| --- | --- | --- |
| transportadora | sim | nome que diferencia anúncios do mesmo trajeto |
| origem | sim | cidade (será resolvida no preview para calcular km) |
| destino | sim | cidade (será resolvida no preview) |
| local de carregamento | sim | endereço/ponto de carga |
| local de descarregamento | sim | endereço/ponto de descarga |
| valor | sim | numérico > 0; aceita `8500,00` ou `8500.00` |
| tipo de produto | sim | ex.: "Soja em grãos" |
| telefone (whatsapp) | sim | BR válido (10/11 dígitos); aceita máscara |

Convenções de CSV (herdadas do projeto): BOM UTF-8, separador `;`, RFC 4180
(aspas duplas, aspa interna duplicada), quebra `\r\n`. Limite de **200 linhas**
por importação.

## Fluxo de importação

1. **Baixar modelo** → preencher a planilha → **upload** do CSV.
2. O sistema parseia (`parseCommunityCsv`) e abre o **Preview editável**.
3. As cidades vêm abreviadas dos grupos; o admin **edita célula a célula** e usa
   o **autocomplete de cidade** (IBGE) para resolver origem e destino em
   coordenadas. Só com origem E destino resolvidas a linha calcula km e fica
   **elegível para publicar** (`isRowPublishable`).
4. O preview mostra o status por linha: válida / com erro / duplicada / cidade
   pendente, com um resumo de contagens. Linha inválida ou com cidade pendente
   **não publica**.
5. Em duplicados (tupla completa igual), o admin escolhe **excluir** (não
   publicar) ou **atualizar** o frete existente (zera o contador de expiração).
6. **Publicar** → `community_publish_fretes` insere/atualiza/pula por linha,
   com resiliência (uma falha de linha não derruba o lote) e retorna
   `{published, updated, skipped, errors}`.

Geocoding reusa o mesmo mecanismo do `FreteForm` do embarcador (IBGE para
autocomplete + Nominatim para coordenadas + OSRM/Haversine para km).

## Auto-expiração (geral, 5 dias, reset ao editar)

- Um frete é visível no feed enquanto `now < updated_at + 5 dias`.
  `updated_at` é a Data_Referencia_Expiracao; inicia em `created_at` e é
  reiniciado a cada edição (trigger no Postgres).
- Vale para **todos** os fretes (embarcador real + comunidade).
- Fonte de verdade da visibilidade é o **filtro na leitura** (`fretes_select_policy`,
  migration 062) — não depende do cron. Espelho TS em `communityExpiry.ts`
  (`isVisibleByExpiry`, `daysUntilExpiry`) validado por property test.
- Dono e admin não regridem: continuam vendo seus fretes por ramos próprios da
  RLS; só o feed público do motorista respeita os 5 dias.
- Limpeza/observabilidade: cron diário idempotente `community_expire_stale_fretes`
  muda `status` para `encerrado` em ativos > 5 dias (a 2ª passada afeta 0 linhas).

## Deduplicação (geral, todos os campos)

- Bloqueia só quando **TODOS** os campos coincidem após normalização: origem,
  destino, local de carregamento, local de descarregamento, valor (2 casas),
  produto, transportadora, telefone (só dígitos). Se **um** campo difere, os
  fretes coexistem (várias transportadoras anunciam o mesmo trajeto).
- Rede de segurança no banco: índice único funcional `uq_fretes_dedup_active`
  (só `status='ativo'`). A normalização SQL espelha `computeDedupKey` (TS),
  validado por property test de paridade.
- `createFrete` (embarcador) e a RPC de publicação traduzem a violação `23505`
  para a mensagem canônica anti-enumeração: **"Não foi possível concluir o
  cadastro."** (sem revelar o frete existente).

## Habilitar / desabilitar a feature

A flag `enabled` mora no singleton `community_profile`. Com `enabled = false`,
a `fretes_select_policy` oculta os fretes de comunidade do feed do motorista
(fretes de embarcador continuam normais). Toggle pelo perfil no painel admin.

## Identidade visual no app do motorista

- `FreteCard` (quando `source === 'comunidade'`): foto do perfil + "Frete
  Comunidade" + "Frete sugerido pela comunidade". Restante do card idêntico.
- `FreteModal`: identidade comunidade + nome da transportadora; o botão "Chat" é
  substituído por **"WhatsApp"** (`buildWhatsAppDeepLink`), com mensagem fixa
  que inclui o domínio `https://www.fretegobr.com.br`. Sem telefone válido, o
  botão é ocultado e mostra "Contato indisponível".

## Componentes e arquivos

- Núcleo puro: `src/utils/communitySheet.ts`, `communityDedup.ts`,
  `communityExpiry.ts`, `communityFrete.ts`.
- Serviço admin: `src/services/admin/comunidade.ts` (RPCs + upload + erros).
- Leitura pública do perfil (feed): `src/services/communityPublic.ts`.
- UI admin: `src/pages/admin/comunidade/CommunityListPage.tsx` +
  `src/components/admin/comunidade/*` (perfil, importação, preview, autocomplete,
  tabela).
- Banco: migrations `061` (colunas + perfil + dedup index), `062` (RLS de
  expiração + flag no feed), `063` (RPCs de perfil, listagem, publicação, cron).

## Operação do cron

`community_expire_stale_fretes()` é idempotente e roda via `pg_cron` (diário)
quando a extensão está disponível. Não é necessário para a correção da
visibilidade (que é por filtro na leitura) — serve para materializar o `status`
na lista admin e métricas. Pode ser chamada manualmente por service-role.

## Códigos de erro (internos → pt-BR)

| Código | Mensagem user-facing |
| --- | --- |
| `INVALID_FILE_TYPE` | Tipo de arquivo inválido. Envie um arquivo no formato permitido. |
| `INVALID_TEMPLATE` | A planilha não está no formato do modelo. Baixe o modelo correto e tente novamente. |
| `EMPTY_SHEET` | A planilha não contém fretes. |
| `INVALID_INPUT` | Dados inválidos. Verifique os campos e tente novamente. |
| `NO_PROFILE` | Configure o perfil comunidade antes de publicar. |
| `FEATURE_DISABLED` | A feature Frete Comunidade está desativada. |
| `CITY_UNRESOLVED` | Resolva as cidades de origem e destino antes de publicar esta linha. |
| `DEDUP_BLOCKED` (23505) | Não foi possível concluir o cadastro. (anti-enumeração) |
| `STALE_VERSION` | Outro admin atualizou. Recarregando. |
| `permission_denied` (42501) | Você não tem permissão para acessar esta área. (UI faz Stealth_404) |
