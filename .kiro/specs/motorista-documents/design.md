# Documento de Design - Motorista Documents

## Visão Geral

Sistema completo de documentos do motorista com 9 categorias, workflow de aprovação e controle de status.

## Arquitetura

### Novos Componentes

```
src/components/
├── DocumentSection.tsx         # Seção de documentos com múltiplos campos
├── DocumentStatusBadge.tsx     # Badge de status (pendente/aprovado/rejeitado)
├── DocumentCard.tsx            # Card individual de documento
├── PISInput.tsx                # Input para número PIS
├── AdminDocumentReview.tsx     # Componente de revisão para admin
```

### Tipos de Documento

```typescript
export type MotoristaDocumentType =
  | 'crlv_cavalo' | 'crlv_carreta_1' | 'crlv_carreta_2' | 'crlv_carreta_3' | 'crlv_carreta_4'
  | 'rntrc_cavalo' | 'rntrc_carreta_1' | 'rntrc_carreta_2'
  | 'cnh' | 'foto_segurando_cnh' | 'foto_frente_caminhao' | 'foto_caminhao_completo'
  | 'comprovante_endereco_proprietario' | 'comprovante_endereco_motorista';

export type DocumentStatus = 'pendente' | 'aprovado' | 'rejeitado';

export interface MotoristaDocument {
  id: string;
  userId: string;
  documentType: MotoristaDocumentType;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  status: DocumentStatus;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  uploadedAt: Date;
}
```

### Configuração das Seções

```typescript
export const DOCUMENT_SECTIONS = [
  {
    id: 'crlv',
    title: 'DOC Cavalo/Carretas',
    allowAddMore: true,
    maxItems: 5,
    documents: [
      { type: 'crlv_cavalo', label: 'CRLV Cavalo', required: true },
      { type: 'crlv_carreta_1', label: 'CRLV Carreta 1', required: false },
      // ... carretas 2, 3, 4
    ],
  },
  {
    id: 'antt',
    title: 'ANTT',
    documents: [
      { type: 'rntrc_cavalo', label: 'RNTRC Cavalo', required: true },
      { type: 'rntrc_carreta_1', label: 'RNTRC Carreta 1', required: false },
      { type: 'rntrc_carreta_2', label: 'RNTRC Carreta 2', required: false },
    ],
  },
  // ... demais seções
];

export const REQUIRED_DOCUMENTS = [
  'crlv_cavalo', 'rntrc_cavalo', 'cnh', 'foto_segurando_cnh',
  'foto_frente_caminhao', 'comprovante_endereco_proprietario', 'foto_caminhao_completo'
];

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
```

## Migração do Banco de Dados

```sql
-- 007_motorista_documents.sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pendente';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS motorista_pis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  pis_number VARCHAR(11) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);
```

## Propriedades de Corretude

1. **Validação de Tamanho**: Arquivos > 5MB DEVEM ser rejeitados
2. **Controle de Deleção**: Documentos aprovados NÃO PODEM ser deletados pelo motorista
3. **Cálculo de Completude**: (docs_obrigatórios_aprovados / total_obrigatórios) * 100
4. **Validação PIS**: Exatamente 11 dígitos numéricos
