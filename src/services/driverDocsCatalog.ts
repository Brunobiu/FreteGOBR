/**
 * Camada pura do catálogo de documentos enviáveis do motorista
 * (feature `chat-enviar-documentos`).
 *
 * Núcleo determinístico e testável por property-based testing: monta o catálogo
 * de Sendable_Document a partir dos documentos do cadastro + CT-e das
 * referências, rotula em pt-BR, agrupa na ordem canônica, classifica o anexo por
 * MIME e resolve a seleção. NÃO importa Supabase nem React — só tipos.
 *
 * Toda a lógica de "o que pode ser enviado" deriva daqui; verificar estas
 * funções cobre o núcleo das Req 5, 6, 7 e 9 da spec.
 */

import type { DocumentType } from './documents';

/** Grupo visual do catálogo, na ordem canônica do projeto. */
export type DocGroupKey = 'perfil' | 'tracao' | 'carroceria' | 'outros' | 'referencias';

/** Item enviável unificado (documento do cadastro OU CT-e de referência). */
export interface SendableDocument {
  /** Id estável e único: `doc:<documentId>` ou `ref:<referenceId>`. */
  id: string;
  kind: 'document' | 'reference_cte';
  /** Presente quando `kind === 'document'`. */
  docType?: DocumentType;
  groupKey: DocGroupKey;
  /** Rótulo pt-BR (nunca vazio). */
  label: string;
  /** Caminho no bucket `documents` (file_path ou cte_file_path). */
  sourcePath: string;
  /** Nome do arquivo para o anexo no chat. */
  fileName: string;
  /** MIME conhecido (documents) ou null (CT-e → inferir por download). */
  mimeType: string | null;
}

/** Entrada mínima de documento (subconjunto de DocumentMetadata). */
export interface CatalogDocInput {
  id: string;
  documentType: DocumentType;
  filePath: string;
  fileName: string;
  mimeType: string | null;
}

/** Entrada mínima de referência (subconjunto de MotoristaReference). */
export interface CatalogRefInput {
  id: string;
  companyName: string;
  ctePath: string | null;
  cteName: string | null;
}

/**
 * Rótulo pt-BR canônico por tipo de documento. Espelha os rótulos que o
 * motorista vê no cadastro / painel (`UserDocumentsBlock`), para consistência.
 */
export const DRIVER_DOC_LABELS: Record<string, string> = {
  cnh: 'CNH',
  foto_segurando_cnh: 'Foto segurando CNH',
  comprovante_endereco_motorista: 'Comprovante de endereço (motorista)',
  comprovante_endereco_proprietario: 'Comprovante de endereço (proprietário)',
  crlv_cavalo: 'CRLV do cavalo',
  rntrc_cavalo: 'ANTT (cavalo)',
  foto_frente_caminhao: 'Foto da frente do caminhão',
  foto_caminhao_completo: 'Foto do caminhão completo',
  crlv_carreta_1: 'CRLV da carreta 1',
  rntrc_carreta_1: 'ANTT da carreta 1',
  crlv_carreta_2: 'CRLV da carreta 2',
  rntrc_carreta_2: 'ANTT da carreta 2',
  crlv_carreta_3: 'CRLV da carreta 3',
  crlv_carreta_4: 'CRLV da carreta 4',
  documento_proprietario: 'Documento do proprietário',
  contrato_arrendamento: 'Contrato de arrendamento',
  cpf: 'CPF',
  antt: 'ANTT',
  vehicle_registration: 'Documento do veículo',
  vehicle_insurance: 'Seguro do veículo',
  profile_photo: 'Foto de perfil',
};

/** Título pt-BR de cada grupo, exibido como seção no modal. */
export const DOC_GROUP_TITLES: Record<DocGroupKey, string> = {
  perfil: 'Perfil',
  tracao: 'Tração (cavalo)',
  carroceria: 'Carroceria',
  outros: 'Outros',
  referencias: 'Referências',
};

/** Ordem canônica dos grupos no catálogo. */
const GROUP_ORDER: Record<DocGroupKey, number> = {
  perfil: 0,
  tracao: 1,
  carroceria: 2,
  outros: 3,
  referencias: 4,
};

/** Mapa tipo → grupo. Tipos não mapeados caem em `outros`. */
const GROUP_BY_TYPE: Record<string, DocGroupKey> = {
  cnh: 'perfil',
  foto_segurando_cnh: 'perfil',
  comprovante_endereco_motorista: 'perfil',
  comprovante_endereco_proprietario: 'perfil',
  crlv_cavalo: 'tracao',
  rntrc_cavalo: 'tracao',
  foto_frente_caminhao: 'tracao',
  foto_caminhao_completo: 'tracao',
  crlv_carreta_1: 'carroceria',
  rntrc_carreta_1: 'carroceria',
  crlv_carreta_2: 'carroceria',
  rntrc_carreta_2: 'carroceria',
  crlv_carreta_3: 'carroceria',
  crlv_carreta_4: 'carroceria',
  documento_proprietario: 'outros',
  contrato_arrendamento: 'outros',
  cpf: 'outros',
  antt: 'outros',
  vehicle_registration: 'outros',
  vehicle_insurance: 'outros',
};

/**
 * Tipos que NUNCA entram no catálogo de envio. `profile_photo` é o avatar do
 * usuário, não um documento (mesma regra do painel admin).
 */
const EXCLUDED_DOC_TYPES: ReadonlySet<string> = new Set<string>(['profile_photo']);

function groupForType(type: string): DocGroupKey {
  return GROUP_BY_TYPE[type] ?? 'outros';
}

/**
 * Rótulo total de um tipo: conhecido → rótulo canônico; desconhecido →
 * fallback legível (humaniza o enum). Nunca retorna string vazia.
 */
export function docLabel(type: string): string {
  const known = DRIVER_DOC_LABELS[type];
  if (known) return known;
  const humanized = type.replace(/_/g, ' ').trim();
  if (humanized.length === 0) return 'Documento';
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

/**
 * Classifica o anexo do chat por MIME: `'image'` se e somente se o MIME começa
 * com `image/`; qualquer outro valor (PDF, null, desconhecido) → `'file'`.
 */
export function attachmentKindForMime(mime: string | null): 'image' | 'file' {
  return mime != null && mime.startsWith('image/') ? 'image' : 'file';
}

/**
 * Monta o Document_Catalog (puro e determinístico):
 *  - 1 item por documento, EXCETO `profile_photo` e docs sem `filePath`;
 *  - 1 item por referência COM `ctePath`; referências sem CT-e são omitidas;
 *  - todo item tem `sourcePath` e `label` não-vazios e `id` estável;
 *  - ordenado por grupo canônico (perfil → tracao → carroceria → outros →
 *    referencias), preservando a ordem de entrada dentro de cada grupo (estável).
 */
export function buildSendableCatalog(
  docs: CatalogDocInput[],
  refs: CatalogRefInput[]
): SendableDocument[] {
  const items: SendableDocument[] = [];

  for (const d of docs) {
    if (EXCLUDED_DOC_TYPES.has(d.documentType)) continue;
    if (!d.filePath) continue; // sem arquivo => não enviável (defensivo)
    items.push({
      id: `doc:${d.id}`,
      kind: 'document',
      docType: d.documentType,
      groupKey: groupForType(d.documentType),
      label: docLabel(d.documentType),
      sourcePath: d.filePath,
      fileName: d.fileName,
      mimeType: d.mimeType,
    });
  }

  for (const r of refs) {
    if (!r.ctePath) continue; // referência sem CT-e não é enviável (só arquivo)
    const empresa = r.companyName?.trim() || 'sem nome';
    items.push({
      id: `ref:${r.id}`,
      kind: 'reference_cte',
      groupKey: 'referencias',
      label: `Referência: ${empresa} (CT-e)`,
      sourcePath: r.ctePath,
      fileName: r.cteName || `cte_${r.id}`,
      mimeType: null,
    });
  }

  // Ordenação estável por grupo canônico (idx como desempate).
  return items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const byGroup = GROUP_ORDER[a.item.groupKey] - GROUP_ORDER[b.item.groupKey];
      return byGroup !== 0 ? byGroup : a.idx - b.idx;
    })
    .map(({ item }) => item);
}

/**
 * Retorna o subconjunto exato do catálogo cujos ids estão em `selectedIds`
 * (sem duplicatas; ids inexistentes são ignorados). Preserva a ordem do catálogo.
 */
export function selectSendables(
  catalog: SendableDocument[],
  selectedIds: ReadonlySet<string> | string[]
): SendableDocument[] {
  const idSet = new Set<string>(selectedIds);
  return catalog.filter((item) => idSet.has(item.id));
}
