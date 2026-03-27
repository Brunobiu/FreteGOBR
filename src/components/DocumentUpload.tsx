import { useState, useRef } from 'react';
import { validateFile } from '../utils/fileValidation';
import { uploadDocument, getSignedUrl, deleteDocument } from '../services/documents';
import type { DocumentType, DocumentMetadata } from '../services/documents';

interface DocumentUploadProps {
  userId: string;
  documentType: DocumentType;
  label: string;
  existingDocument?: DocumentMetadata;
  onUploadSuccess?: (document: DocumentMetadata) => void;
  onDeleteSuccess?: () => void;
}

export function DocumentUpload({
  userId,
  documentType,
  label,
  existingDocument,
  onUploadSuccess,
  onDeleteSuccess,
}: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing document URL
  useState(() => {
    if (existingDocument) {
      getSignedUrl(existingDocument.id)
        .then((url) => setDocumentUrl(url))
        .catch(() => setDocumentUrl(null));
    }
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setPreview(null);

    // Validate file
    const validation = validateFile(file);
    if (!validation.isValid) {
      setError(validation.errors.join(' '));
      return;
    }

    // Show preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }

    // Upload file
    setIsUploading(true);
    setUploadProgress(0);

    // Simulate progress (Supabase doesn't provide real progress)
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 10, 90));
    }, 200);

    try {
      const document = await uploadDocument(userId, documentType, file);
      setUploadProgress(100);
      clearInterval(progressInterval);

      // Get signed URL for preview
      const url = await getSignedUrl(document.id);
      setDocumentUrl(url);

      if (onUploadSuccess) {
        onUploadSuccess(document);
      }
    } catch (err) {
      clearInterval(progressInterval);
      setError(err instanceof Error ? err.message : 'Erro ao fazer upload');
      setPreview(null);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDelete = async () => {
    if (!existingDocument) return;

    if (!confirm('Tem certeza que deseja deletar este documento?')) {
      return;
    }

    try {
      await deleteDocument(existingDocument.id);
      setDocumentUrl(null);
      setPreview(null);
      if (onDeleteSuccess) {
        onDeleteSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao deletar documento');
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-300">{label}</label>

      {/* Upload Area */}
      {!existingDocument && !documentUrl && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
          className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-blue-500 bg-blue-900/20'
              : 'border-gray-600 bg-gray-800 hover:border-gray-500 hover:bg-gray-750'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileSelect}
            className="hidden"
            disabled={isUploading}
          />

          {isUploading ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-400">Fazendo upload...</div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="text-xs text-gray-500">{uploadProgress}%</div>
            </div>
          ) : (
            <>
              <svg
                className="mx-auto h-12 w-12 text-gray-500"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="mt-2 text-sm text-gray-400">
                Arraste um arquivo ou clique para selecionar
              </p>
              <p className="mt-1 text-xs text-gray-500">PDF, JPG ou PNG até 10MB</p>
            </>
          )}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="relative">
          <img
            src={preview}
            alt="Preview"
            className="w-full h-48 object-cover rounded-lg border border-gray-700"
          />
        </div>
      )}

      {/* Existing Document */}
      {(existingDocument || documentUrl) && !preview && (
        <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg border border-gray-700">
          <div className="flex items-center space-x-3">
            <svg
              className="h-8 w-8 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="text-sm text-gray-300">
                {existingDocument?.fileName || 'Documento enviado'}
              </p>
              <p className="text-xs text-gray-500">
                {existingDocument?.uploadedAt
                  ? new Date(existingDocument.uploadedAt).toLocaleDateString('pt-BR')
                  : ''}
              </p>
            </div>
          </div>
          <div className="flex space-x-2">
            {documentUrl && (
              <a
                href={documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                Ver
              </a>
            )}
            <button
              onClick={handleDelete}
              className="px-3 py-1 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Deletar
            </button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
}
