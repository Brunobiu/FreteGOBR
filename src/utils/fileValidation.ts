/**
 * File Validation Utilities
 *
 * Validates file types and sizes for document uploads
 */

/**
 * Allowed MIME types for document uploads
 */
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'] as const;

/**
 * Maximum file size in bytes (10MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * File validation result interface
 */
export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates a file's MIME type
 *
 * @param file - The file to validate
 * @returns True if file type is allowed, false otherwise
 */
export function validateFileType(file: File): boolean {
  return ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number]);
}

/**
 * Validates a file's size
 *
 * @param file - The file to validate
 * @returns True if file size is within limit, false otherwise
 */
export function validateFileSize(file: File): boolean {
  return file.size <= MAX_FILE_SIZE;
}

/**
 * Validates a file completely (type and size)
 *
 * @param file - The file to validate
 * @returns Validation result with errors if any
 */
export function validateFile(file: File): FileValidationResult {
  const errors: string[] = [];

  if (!validateFileType(file)) {
    errors.push('Tipo de arquivo não permitido. Use PDF, JPG ou PNG.');
  }

  if (!validateFileSize(file)) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    errors.push(`Arquivo muito grande (${sizeMB}MB). Tamanho máximo: 10MB.`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Gets a human-readable file size string
 *
 * @param bytes - File size in bytes
 * @returns Formatted file size string (e.g., "2.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Gets file extension from file name
 *
 * @param fileName - The file name
 * @returns File extension (lowercase) or empty string if none
 */
export function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

/**
 * Checks if a file extension is allowed
 *
 * @param extension - File extension (without dot)
 * @returns True if extension is allowed, false otherwise
 */
export function isAllowedExtension(extension: string): boolean {
  const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png'];
  return allowedExtensions.includes(extension.toLowerCase());
}

/**
 * Validates multiple files at once
 *
 * @param files - Array of files to validate
 * @returns Array of validation results
 */
export function validateFiles(files: File[]): FileValidationResult[] {
  return files.map((file) => validateFile(file));
}

/**
 * Gets MIME type from file extension
 *
 * @param extension - File extension (without dot)
 * @returns MIME type or null if unknown
 */
export function getMimeTypeFromExtension(extension: string): string | null {
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
  };

  return mimeTypes[extension.toLowerCase()] || null;
}
