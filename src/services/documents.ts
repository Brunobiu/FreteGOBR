/**
 * Document Service
 *
 * Handles document upload, retrieval, and deletion using Supabase Storage.
 *
 * Os tipos válidos de documento são definidos em VALID_DOCUMENT_TYPES
 * (fonte única de verdade) e devem espelhar exatamente o CHECK constraint
 * de documents.document_type definido na migration 009.
 */

import { supabase } from './supabase';

/**
 * Lista canônica de tipos de documento aceitos pelo sistema.
 * Sincronizada com supabase/migrations/009_consolidated_alignment.sql.
 */
export const VALID_DOCUMENT_TYPES = [
  // Tipos genéricos
  'cpf',
  'cnh',
  'antt',
  'vehicle_registration',
  'vehicle_insurance',
  'profile_photo',
  // CRLV (cavalo + carretas 1 a 4)
  'crlv_cavalo',
  'crlv_carreta_1',
  'crlv_carreta_2',
  'crlv_carreta_3',
  'crlv_carreta_4',
  // RNTRC (cavalo + carretas 1 e 2)
  'rntrc_cavalo',
  'rntrc_carreta_1',
  'rntrc_carreta_2',
  // Fotos específicas do motorista
  'foto_segurando_cnh',
  'foto_frente_caminhao',
  'foto_caminhao_completo',
  // Comprovantes de endereço
  'comprovante_endereco_proprietario',
  'comprovante_endereco_motorista',
] as const;

export type DocumentType = (typeof VALID_DOCUMENT_TYPES)[number];

/**
 * Type guard que valida se uma string arbitrária é um DocumentType válido.
 * Usado tanto no client (validação prévia) quanto na defesa em profundidade
 * dentro de uploadDocument.
 */
export function validateDocumentType(type: string): type is DocumentType {
  return (VALID_DOCUMENT_TYPES as readonly string[]).includes(type);
}

/**
 * Status de revisão de um documento (alinhado ao CHECK no banco).
 */
export type DocumentStatus = 'pendente' | 'aprovado' | 'rejeitado';

/**
 * Document metadata interface
 */
export interface DocumentMetadata {
  id: string;
  userId: string;
  documentType: DocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  status?: DocumentStatus;
  rejectionReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  url?: string;
}

/**
 * Custom error class for document errors
 */
export class DocumentError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocumentRow(row: any): DocumentMetadata {
  return {
    id: row.id,
    userId: row.user_id,
    documentType: row.document_type as DocumentType,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    uploadedAt: new Date(row.created_at),
    status: (row.status as DocumentStatus | undefined) ?? undefined,
    rejectionReason: row.rejection_reason ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
  };
}

/**
 * Uploads a document to Supabase Storage.
 *
 * @param userId - The ID of the user uploading the document
 * @param documentType - The type of document being uploaded
 * @param file - The file to upload
 * @returns Promise resolving to document metadata
 * @throws DocumentError if validation or upload fails
 */
export async function uploadDocument(
  userId: string,
  documentType: DocumentType | string,
  file: File
): Promise<DocumentMetadata> {
  // Defesa em profundidade: validar tipo antes de qualquer chamada de rede.
  if (!validateDocumentType(documentType)) {
    throw new DocumentError(
      `Tipo de documento inválido: "${documentType}"`,
      'INVALID_DOCUMENT_TYPE',
      400
    );
  }

  try {
    // Generate unique file name
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${documentType}_${Date.now()}.${fileExt}`;

    // Upload file to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      throw new DocumentError(`Erro ao fazer upload: ${uploadError.message}`, 'UPLOAD_FAILED', 500);
    }

    // Create document record in database
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .insert({
        user_id: userId,
        document_type: documentType,
        file_name: file.name,
        file_path: uploadData.path,
        file_size: file.size,
        mime_type: file.type,
      })
      .select()
      .single();

    if (docError) {
      // Rollback: delete uploaded file
      await supabase.storage.from('documents').remove([fileName]);
      throw new DocumentError(
        `Erro ao salvar informações do documento: ${docError.message}`,
        'DATABASE_ERROR',
        500
      );
    }

    // Defesa em profundidade: caso o trigger SQL sync_profile_photo_url
    // não esteja ativo no ambiente, atualizamos manualmente o avatar.
    if (documentType === 'profile_photo') {
      const { error: avatarError } = await supabase
        .from('users')
        .update({ profile_photo_url: uploadData.path })
        .eq('id', userId);
      if (avatarError) {
        // Não interrompe o upload — o trigger SQL pode já ter feito o trabalho.
        // eslint-disable-next-line no-console
        console.warn('[documents] sync profile_photo_url falhou:', avatarError.message);
      }
    }

    return mapDocumentRow(docData);
  } catch (error) {
    if (error instanceof DocumentError) {
      throw error;
    }
    throw new DocumentError('Erro ao fazer upload do documento', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Gets all documents for a specific user
 */
export async function getDocumentsByUser(userId: string): Promise<DocumentMetadata[]> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DocumentError('Erro ao buscar documentos', 'FETCH_FAILED', 500);
    }

    return (data ?? []).map(mapDocumentRow);
  } catch (error) {
    if (error instanceof DocumentError) {
      throw error;
    }
    throw new DocumentError('Erro ao buscar documentos', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Deletes a document
 */
export async function deleteDocument(documentId: string): Promise<void> {
  try {
    // Get document info
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .select('file_path')
      .eq('id', documentId)
      .single();

    if (docError || !docData) {
      throw new DocumentError('Documento não encontrado', 'NOT_FOUND', 404);
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('documents')
      .remove([docData.file_path]);

    if (storageError) {
      throw new DocumentError('Erro ao deletar arquivo do storage', 'STORAGE_DELETE_FAILED', 500);
    }

    // Delete from database
    const { error: dbError } = await supabase.from('documents').delete().eq('id', documentId);

    if (dbError) {
      throw new DocumentError('Erro ao deletar registro do documento', 'DATABASE_ERROR', 500);
    }
  } catch (error) {
    if (error instanceof DocumentError) {
      throw error;
    }
    throw new DocumentError('Erro ao deletar documento', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Gets a signed URL for accessing a document
 */
export async function getSignedUrl(documentId: string, expiresIn: number = 3600): Promise<string> {
  try {
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .select('file_path')
      .eq('id', documentId)
      .single();

    if (docError || !docData) {
      throw new DocumentError('Documento não encontrado', 'NOT_FOUND', 404);
    }

    const { data: urlData, error: urlError } = await supabase.storage
      .from('documents')
      .createSignedUrl(docData.file_path, expiresIn);

    if (urlError || !urlData) {
      throw new DocumentError('Erro ao gerar URL do documento', 'URL_GENERATION_FAILED', 500);
    }

    return urlData.signedUrl;
  } catch (error) {
    if (error instanceof DocumentError) {
      throw error;
    }
    throw new DocumentError('Erro ao gerar URL do documento', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Gets a document by type for a specific user
 */
export async function getDocumentByType(
  userId: string,
  documentType: DocumentType
): Promise<DocumentMetadata | null> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .eq('document_type', documentType)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new DocumentError('Erro ao buscar documento', 'FETCH_FAILED', 500);
    }

    return mapDocumentRow(data);
  } catch (error) {
    if (error instanceof DocumentError) {
      throw error;
    }
    throw new DocumentError('Erro ao buscar documento', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Resolve uma referência de foto de perfil para uma URL acessível.
 * - Se já for uma URL (http/https), retorna como está.
 * - Se for um path de storage (privado), gera uma signed URL temporária.
 * - Se for null/undefined, retorna null.
 */
export async function resolveProfilePhotoUrl(
  pathOrUrl: string | null | undefined
): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  try {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(pathOrUrl, 3600);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
