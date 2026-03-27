/**
 * Document Service
 *
 * Handles document upload, retrieval, and deletion using Supabase Storage
 */

import { supabase } from './supabase';

/**
 * Document types supported by the system
 */
export type DocumentType =
  | 'cpf'
  | 'cnh'
  | 'antt'
  | 'vehicle_registration'
  | 'vehicle_insurance'
  | 'profile_photo';

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

/**
 * Uploads a document to Supabase Storage
 *
 * @param userId - The ID of the user uploading the document
 * @param documentType - The type of document being uploaded
 * @param file - The file to upload
 * @returns Promise resolving to document metadata
 * @throws DocumentError if upload fails
 */
export async function uploadDocument(
  userId: string,
  documentType: DocumentType,
  file: File
): Promise<DocumentMetadata> {
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
      throw new DocumentError('Erro ao salvar informações do documento', 'DATABASE_ERROR', 500);
    }

    return {
      id: docData.id,
      userId: docData.user_id,
      documentType: docData.document_type as DocumentType,
      fileName: docData.file_name,
      fileSize: docData.file_size,
      mimeType: docData.mime_type,
      uploadedAt: new Date(docData.created_at),
    };
  } catch (error) {
    if (error instanceof DocumentError) {
      throw error;
    }
    throw new DocumentError('Erro ao fazer upload do documento', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Gets all documents for a specific user
 *
 * @param userId - The ID of the user
 * @returns Promise resolving to array of document metadata
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

    return data.map((doc) => ({
      id: doc.id,
      userId: doc.user_id,
      documentType: doc.document_type as DocumentType,
      fileName: doc.file_name,
      fileSize: doc.file_size,
      mimeType: doc.mime_type,
      uploadedAt: new Date(doc.created_at),
    }));
  } catch (error) {
    if (error instanceof DocumentError) {
      throw error;
    }
    throw new DocumentError('Erro ao buscar documentos', 'UNKNOWN_ERROR', 500);
  }
}

/**
 * Deletes a document
 *
 * @param documentId - The ID of the document to delete
 * @returns Promise that resolves when deletion is complete
 * @throws DocumentError if deletion fails
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
 *
 * @param documentId - The ID of the document
 * @param expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns Promise resolving to signed URL
 * @throws DocumentError if URL generation fails
 */
export async function getSignedUrl(documentId: string, expiresIn: number = 3600): Promise<string> {
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

    // Generate signed URL
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
 *
 * @param userId - The ID of the user
 * @param documentType - The type of document to retrieve
 * @returns Promise resolving to document metadata or null if not found
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
        // No rows returned
        return null;
      }
      throw new DocumentError('Erro ao buscar documento', 'FETCH_FAILED', 500);
    }

    return {
      id: data.id,
      userId: data.user_id,
      documentType: data.document_type as DocumentType,
      fileName: data.file_name,
      fileSize: data.file_size,
      mimeType: data.mime_type,
      uploadedAt: new Date(data.created_at),
    };
  } catch (error) {
    if (error instanceof DocumentError) {
      throw error;
    }
    throw new DocumentError('Erro ao buscar documento', 'UNKNOWN_ERROR', 500);
  }
}
