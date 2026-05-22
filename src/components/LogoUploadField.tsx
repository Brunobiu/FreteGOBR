import { useState, useRef } from 'react';
import { uploadCompanyLogo } from '../services/embarcador';

interface LogoUploadFieldProps {
  userId: string;
  currentLogoUrl: string | null;
  onUploaded: (url: string) => void;
}

/**
 * Campo de upload do logo da empresa. Mostra preview ou placeholder e
 * delega a validação/upload ao serviço `uploadCompanyLogo`.
 */
export function LogoUploadField({ userId, currentLogoUrl, onUploaded }: LogoUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadCompanyLogo(userId, file);
      onUploaded(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar logo');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">Logo da Empresa</label>
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden border border-gray-300">
          {currentLogoUrl ? (
            <img
              src={currentLogoUrl}
              alt="Logo da empresa"
              className="w-full h-full object-contain"
            />
          ) : (
            <span className="text-2xl text-gray-300">🏢</span>
          )}
        </div>
        <label className="cursor-pointer px-4 py-2 bg-gray-100 border border-gray-300 text-gray-800 text-sm rounded-lg hover:bg-gray-200 inline-flex items-center">
          {uploading ? 'Enviando...' : currentLogoUrl ? 'Alterar logo' : 'Adicionar logo'}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleChange}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-gray-500">JPG, PNG ou WEBP. Máximo 2 MB.</p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default LogoUploadField;
