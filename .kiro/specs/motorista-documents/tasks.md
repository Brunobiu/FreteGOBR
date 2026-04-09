# Plano de Implementação - Motorista Documents

## Tarefas

- [ ] 1. Atualizar tipos e constantes
  - [ ] 1.1 Adicionar MotoristaDocumentType e DocumentStatus em src/types/index.ts
  - [ ] 1.2 Criar src/constants/documentConfig.ts com DOCUMENT_SECTIONS e REQUIRED_DOCUMENTS

- [ ] 2. Criar migração do banco de dados
  - [ ] 2.1 Criar supabase/migrations/007_motorista_documents.sql
    - Adicionar colunas status, rejection_reason, reviewed_by, reviewed_at
    - Criar tabela motorista_pis
    - Criar RLS policies

- [ ] 3. Atualizar validação de arquivos
  - [ ] 3.1 Alterar MAX_FILE_SIZE para 5MB em src/utils/fileValidation.ts

- [ ] 4. Atualizar serviço de documentos
  - [ ] 4.1 Adicionar função updateDocumentStatus em src/services/documents.ts
  - [ ] 4.2 Adicionar função getDocumentsSummary
  - [ ] 4.3 Adicionar função getPendingDocuments (admin)
  - [ ] 4.4 Adicionar funções savePIS e getPIS
  - [ ] 4.5 Adicionar função canDeleteDocument

- [ ] 5. Criar componente DocumentStatusBadge
  - [ ] 5.1 Criar src/components/DocumentStatusBadge.tsx
    - Badge colorido por status (amarelo/verde/vermelho)
    - Tooltip com motivo de rejeição

- [ ] 6. Criar componente DocumentCard
  - [ ] 6.1 Criar src/components/DocumentCard.tsx
    - Área de upload com drag & drop
    - Preview do documento
    - Integrar DocumentStatusBadge
    - Botão deletar condicional

- [ ] 7. Criar componente DocumentSection
  - [ ] 7.1 Criar src/components/DocumentSection.tsx
    - Renderizar DocumentCards por seção
    - Botão "Adicionar mais" para seções dinâmicas

- [ ] 8. Criar componente PISInput
  - [ ] 8.1 Criar src/components/PISInput.tsx
    - Input com máscara para 11 dígitos
    - Validação em tempo real

- [ ] 9. Refatorar MotoristaPerfilPage
  - [ ] 9.1 Implementar seções de documentos com nova configuração
  - [ ] 9.2 Implementar seção de PIS
  - [ ] 9.3 Atualizar barra de progresso com getDocumentsSummary

- [ ] 10. Criar componente AdminDocumentReview
  - [ ] 10.1 Criar src/components/AdminDocumentReview.tsx
    - Lista de documentos pendentes
    - Botões aprovar/rejeitar
    - Modal para motivo de rejeição

- [ ] 11. Atualizar AdminPage
  - [ ] 11.1 Adicionar aba de Documentos Pendentes
  - [ ] 11.2 Integrar AdminDocumentReview
  - [ ] 11.3 Implementar filtros por motorista e tipo

- [ ] 12. Implementar restrição de deleção
  - [ ] 12.1 Ocultar botão deletar para documentos aprovados (motorista)
  - [ ] 12.2 Atualizar RLS para bloquear DELETE de aprovados

- [ ] 13. Testes e validação
  - [ ] 13.1 Testar upload com limite de 5MB
  - [ ] 13.2 Testar funcionalidade "Adicionar mais"
  - [ ] 13.3 Testar workflow de aprovação/rejeição
  - [ ] 13.4 Testar restrição de deleção
  - [ ] 13.5 Testar cálculo de completude
  - [ ] 13.6 Testar validação do PIS
