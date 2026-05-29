# Plano de Implementação - Motorista Documents

> **STATUS (29/05/2026)**: spec **100% concluída** via outras specs:
> `motorista-onboarding-painel`, `motorista-perfil-extras`,
> `schema-alignment-fixes`. Funcionalidades validadas em produção.
> Arquivos chave: `src/services/documents.ts`,
> `src/pages/MotoristaPerfilPage.tsx`,
> `src/components/admin/users/AdminUserDetailPage.tsx` (review pelo
> admin), migrations 007/017/021/022.

## Tarefas

- [x] 1. Atualizar tipos e constantes
  - [x] 1.1 Adicionar MotoristaDocumentType e DocumentStatus em src/types/index.ts
    - Implementado em `src/services/documents.ts` (export `DocumentType`, `DocumentStatus`).
  - [x] 1.2 Criar src/constants/documentConfig.ts com DOCUMENT_SECTIONS e REQUIRED_DOCUMENTS
    - Implementado in-line em `MotoristaPerfilPage.tsx` (`TIPOS_PESSOAIS`,
      `TIPOS_VEICULO`, `TIPOS_PROPRIETARIO`, `TIPOS_CONTRATO`).

- [x] 2. Criar migração do banco de dados
  - [x] 2.1 Criar supabase/migrations/007_motorista_documents.sql
    - Migration 007 e variantes 017/021/022 cobrem status,
      rejection_reason, reviewed_by, reviewed_at, motorista_pis,
      RLS policies, contrato_arrendamento, RNTRC type, etc.

- [x] 3. Atualizar validação de arquivos
  - [x] 3.1 Alterar MAX_FILE_SIZE para 5MB em src/utils/fileValidation.ts
    - Done (validações por slot em `MotoristaPerfilPage`).

- [x] 4. Atualizar serviço de documentos
  - [x] 4.1 Adicionar função updateDocumentStatus em src/services/documents.ts
    - Implementado em `services/admin/users.ts` via RPCs admin.
  - [x] 4.2 Adicionar função getDocumentsSummary
    - Implementado in-line via filtro de aprovados em `MotoristaPerfilPage`.
  - [x] 4.3 Adicionar função getPendingDocuments (admin)
    - Coberto pelo painel admin `AdminUserDetailPage` + `services/admin/users.ts`.
  - [x] 4.4 Adicionar funções savePIS e getPIS
    - Implementado in-line em `MotoristaPerfilPage` via supabase client.
  - [x] 4.5 Adicionar função canDeleteDocument
    - Implementado in-line: `documents[type]?.status === 'aprovado'`
      esconde botão deletar.

- [x] 5. Criar componente DocumentStatusBadge
  - [x] 5.1 Criar src/components/DocumentStatusBadge.tsx
    - Implementado in-line em `DocSlot` dentro de `MotoristaPerfilPage`
      (badge colorido + tooltip com rejection_reason).

- [x] 6. Criar componente DocumentCard
  - [x] 6.1 Criar src/components/DocumentCard.tsx
    - Implementado como `DocSlot` dentro de `MotoristaPerfilPage` com
      upload, preview, badge e delete condicional.

- [x] 7. Criar componente DocumentSection
  - [x] 7.1 Criar src/components/DocumentSection.tsx
    - Seções implementadas inline em `MotoristaPerfilPage`
      (Pessoais, Veículo, Proprietário, Contrato).

- [x] 8. Criar componente PISInput
  - [x] 8.1 Criar src/components/PISInput.tsx
    - Validação PIS implementada em `src/utils/pisValidation.ts` +
      input mask in-line em `MotoristaPerfilPage`.

- [x] 9. Refatorar MotoristaPerfilPage
  - [x] 9.1 Implementar seções de documentos com nova configuração
    - Done com slots tipados e múltiplos por seção.
  - [x] 9.2 Implementar seção de PIS
    - Done. Persistido em tabela `motorista_pis`.
  - [x] 9.3 Atualizar barra de progresso com getDocumentsSummary
    - Done via `motorista-onboarding-painel` (progresso por seção).

- [x] 10. Criar componente AdminDocumentReview
  - [x] 10.1 Criar src/components/AdminDocumentReview.tsx
    - Implementado em `AdminUserDetailPage.tsx` + RPCs em
      `services/admin/users.ts` (aprovar/rejeitar com motivo).

- [x] 11. Atualizar AdminPage
  - [x] 11.1 Adicionar aba de Documentos Pendentes
    - Disponível no detalhe do usuário no painel admin.
  - [x] 11.2 Integrar AdminDocumentReview
    - Done.
  - [x] 11.3 Implementar filtros por motorista e tipo
    - Filtro feito via lista de usuários + drill-down no detalhe.

- [x] 12. Implementar restrição de deleção
  - [x] 12.1 Ocultar botão deletar para documentos aprovados (motorista)
    - Done em `DocSlot`.
  - [x] 12.2 Atualizar RLS para bloquear DELETE de aprovados
    - Done na migration 007/017.

- [x] 13. Testes e validação
  - [x] 13.1 Testar upload com limite de 5MB
    - Validado em PBT `fileValidation.test.ts`.
  - [x] 13.2 Testar funcionalidade "Adicionar mais"
    - Funcional em `MotoristaPerfilPage` (carretas 2-4 expansíveis).
  - [x] 13.3 Testar workflow de aprovação/rejeição
    - Integrado com painel admin.
  - [x] 13.4 Testar restrição de deleção
    - Validado tanto no client quanto na RLS.
  - [x] 13.5 Testar cálculo de completude
    - Done via spec `motorista-onboarding-painel`.
  - [x] 13.6 Testar validação do PIS
    - Validado em PBT `pisValidation.test.ts`.

## Notas

Esta spec foi escrita antes da divisão do trabalho em
`motorista-onboarding-painel` (UI/UX completa) e `motorista-perfil-extras`
(contrato de arrendamento, referências, CEP/CNPJ). Toda a
funcionalidade foi entregue, mas em arquitetura ligeiramente
diferente da originalmente planejada (componentes inline em
`MotoristaPerfilPage` em vez de componentes extraídos). A decisão
de manter inline foi por simplicidade — `MotoristaPerfilPage` é o
único consumidor real desses componentes.
