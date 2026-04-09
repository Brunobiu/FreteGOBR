/**
 * FileValidatorAdvanced - Validação de arquivos por Magic Bytes
 * Verifica o conteúdo real do arquivo, não apenas a extensão
 */

export interface MagicByteSignature {
  signature: number[];
  offset?: number;
  mimeType: string;
  extensions: string[];
  description: string;
}

export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
  detectedType?: string;
  detectedMimeType?: string;
  compressionRatio?: number;
}

// Tamanho máximo de arquivo (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Tamanho máximo descomprimido (50MB)
const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024;

// Ratio máximo de compressão (proteção contra zip bombs)
const MAX_COMPRESSION_RATIO = 100;

class FileValidatorAdvanced {
  // Magic byte signatures for allowed file types
  private static MAGIC_BYTES: MagicByteSignature[] = [
    // PDF
    {
      signature: [0x25, 0x50, 0x44, 0x46], // %PDF
      mimeType: 'application/pdf',
      extensions: ['pdf'],
      description: 'PDF Document'
    },
    // JPEG
    {
      signature: [0xFF, 0xD8, 0xFF],
      mimeType: 'image/jpeg',
      extensions: ['jpg', 'jpeg'],
      description: 'JPEG Image'
    },
    // PNG
    {
      signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      mimeType: 'image/png',
      extensions: ['png'],
      description: 'PNG Image'
    },
    // GIF87a
    {
      signature: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
      mimeType: 'image/gif',
      extensions: ['gif'],
      description: 'GIF Image (87a)'
    },
    // GIF89a
    {
      signature: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
      mimeType: 'image/gif',
      extensions: ['gif'],
      description: 'GIF Image (89a)'
    },
    // WebP
    {
      signature: [0x52, 0x49, 0x46, 0x46], // RIFF (WebP starts with RIFF)
      mimeType: 'image/webp',
      extensions: ['webp'],
      description: 'WebP Image'
    },
  ];

  // Dangerous file signatures to block
  private static DANGEROUS_SIGNATURES: MagicByteSignature[] = [
    // Windows Executable
    {
      signature: [0x4D, 0x5A], // MZ
      mimeType: 'application/x-msdownload',
      extensions: ['exe', 'dll', 'com'],
      description: 'Windows Executable'
    },
    // ELF (Linux executable)
    {
      signature: [0x7F, 0x45, 0x4C, 0x46], // .ELF
      mimeType: 'application/x-executable',
      extensions: ['elf', 'so'],
      description: 'Linux Executable'
    },
    // Shell script
    {
      signature: [0x23, 0x21], // #!
      mimeType: 'application/x-sh',
      extensions: ['sh', 'bash'],
      description: 'Shell Script'
    },
  ];

  /**
   * Validates file by magic bytes, MIME type, and extension
   */
  static async validateFile(file: File): Promise<FileValidationResult> {
    const errors: string[] = [];

    // 1. Check if file exists
    if (!file) {
      return {
        isValid: false,
        errors: ['Arquivo não fornecido']
      };
    }

    // 2. Check file size
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`Arquivo muito grande. Máximo: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    if (file.size === 0) {
      errors.push('Arquivo vazio');
      return { isValid: false, errors };
    }

    // 3. Read magic bytes
    let magicBytes: number[];
    try {
      magicBytes = await this.readMagicBytes(file);
    } catch (error) {
      errors.push('Erro ao ler arquivo');
      return { isValid: false, errors };
    }

    // 4. Check for dangerous file types
    const dangerousType = this.detectDangerousType(magicBytes);
    if (dangerousType) {
      errors.push(`Tipo de arquivo não permitido: ${dangerousType.description}`);
      await this.logSecurityEvent('dangerous_file_upload', file.name, dangerousType.description);
      return { isValid: false, errors };
    }

    // 5. Detect file type by magic bytes
    const detectedType = this.detectFileType(magicBytes);

    if (!detectedType) {
      errors.push('Tipo de arquivo não permitido');
      await this.logSecurityEvent('invalid_file_type', file.name);
      return { isValid: false, errors };
    }

    // 6. Validate MIME type matches magic bytes
    if (file.type && file.type !== detectedType.mimeType) {
      // Allow some flexibility for JPEG variations
      const isJpegVariation = 
        (file.type === 'image/jpeg' || file.type === 'image/jpg') &&
        detectedType.mimeType === 'image/jpeg';
      
      if (!isJpegVariation) {
        errors.push('Tipo de arquivo não corresponde ao conteúdo');
        await this.logSecurityEvent('mime_type_mismatch', file.name, {
          declared: file.type,
          detected: detectedType.mimeType
        });
      }
    }

    // 7. Validate extension
    const extension = this.getFileExtension(file.name);
    if (!detectedType.extensions.includes(extension)) {
      errors.push(`Extensão de arquivo inválida. Esperado: ${detectedType.extensions.join(', ')}`);
    }

    // 8. Check for compression bombs (simplified check)
    const compressionRatio = await this.estimateCompressionRatio(file);
    if (compressionRatio > MAX_COMPRESSION_RATIO) {
      errors.push('Arquivo suspeito detectado (possível compression bomb)');
      await this.logSecurityEvent('compression_bomb_attempt', file.name, { ratio: compressionRatio });
    }

    return {
      isValid: errors.length === 0,
      errors,
      detectedType: detectedType.description,
      detectedMimeType: detectedType.mimeType,
      compressionRatio
    };
  }

  /**
   * Reads the first bytes of a file (magic bytes)
   */
  static async readMagicBytes(
    file: File,
    bytesToRead: number = 16
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const blob = file.slice(0, bytesToRead);

      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        resolve(Array.from(bytes));
      };

      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * Detects file type by magic bytes
   */
  static detectFileType(magicBytes: number[]): MagicByteSignature | null {
    for (const signature of this.MAGIC_BYTES) {
      if (this.matchesSignature(magicBytes, signature.signature, signature.offset)) {
        return signature;
      }
    }
    return null;
  }

  /**
   * Detects dangerous file types
   */
  private static detectDangerousType(magicBytes: number[]): MagicByteSignature | null {
    for (const signature of this.DANGEROUS_SIGNATURES) {
      if (this.matchesSignature(magicBytes, signature.signature, signature.offset)) {
        return signature;
      }
    }
    return null;
  }

  /**
   * Checks if magic bytes match a signature
   */
  private static matchesSignature(
    bytes: number[],
    signature: number[],
    offset: number = 0
  ): boolean {
    if (bytes.length < signature.length + offset) return false;

    return signature.every((byte, index) => bytes[index + offset] === byte);
  }

  /**
   * Gets file extension from filename
   */
  static getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
  }

  /**
   * Estimates compression ratio (simplified)
   * In production, would need to actually decompress and check
   */
  private static async estimateCompressionRatio(file: File): Promise<number> {
    // For images and PDFs, we can't easily determine compression ratio
    // This is a simplified check - in production, use proper decompression
    
    // Check if file is suspiciously small for its type
    const extension = this.getFileExtension(file.name);
    
    // Minimum expected sizes for different file types
    const minSizes: Record<string, number> = {
      'pdf': 1024,      // 1KB minimum for PDF
      'jpg': 512,       // 512B minimum for JPEG
      'jpeg': 512,
      'png': 256,       // 256B minimum for PNG
      'gif': 128,       // 128B minimum for GIF
    };

    const minSize = minSizes[extension] || 100;
    
    // If file is smaller than minimum, it might be suspicious
    if (file.size < minSize) {
      return MAX_COMPRESSION_RATIO + 1; // Flag as suspicious
    }

    return 1; // Normal ratio
  }

  /**
   * Validates file is an allowed image type
   */
  static async validateImage(file: File): Promise<FileValidationResult> {
    const result = await this.validateFile(file);
    
    if (result.isValid) {
      const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedImageTypes.includes(result.detectedMimeType || '')) {
        return {
          isValid: false,
          errors: ['Apenas imagens são permitidas (JPEG, PNG, GIF, WebP)'],
          detectedType: result.detectedType,
          detectedMimeType: result.detectedMimeType
        };
      }
    }

    return result;
  }

  /**
   * Validates file is a PDF
   */
  static async validatePDF(file: File): Promise<FileValidationResult> {
    const result = await this.validateFile(file);

    if (result.isValid) {
      if (result.detectedMimeType !== 'application/pdf') {
        return {
          isValid: false,
          errors: ['Apenas arquivos PDF são permitidos'],
          detectedType: result.detectedType,
          detectedMimeType: result.detectedMimeType
        };
      }
    }

    return result;
  }

  /**
   * Validates file is an allowed document type (PDF or image)
   */
  static async validateDocument(file: File): Promise<FileValidationResult> {
    const result = await this.validateFile(file);

    if (result.isValid) {
      const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/png'
      ];
      
      if (!allowedTypes.includes(result.detectedMimeType || '')) {
        return {
          isValid: false,
          errors: ['Apenas PDF, JPEG ou PNG são permitidos'],
          detectedType: result.detectedType,
          detectedMimeType: result.detectedMimeType
        };
      }
    }

    return result;
  }

  /**
   * Logs security events
   */
  private static async logSecurityEvent(
    eventType: string,
    filename: string,
    details?: unknown
  ): Promise<void> {
    console.warn(`[FILE SECURITY] ${eventType}:`, filename, details);
    // In production, this would call AuditLogger
    // AuditLogger.logSecurityEvent(eventType, { filename, details });
  }
}

export default FileValidatorAdvanced;
