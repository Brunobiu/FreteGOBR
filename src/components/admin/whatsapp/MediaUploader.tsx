/**
 * MediaUploader (task 20.5 / 9.2, Req 6.2, 6.3, 6.4)
 *
 * Anexa mídias (imagem/vídeo/áudio/documento) a um WhatsApp_Content já
 * persistido, via `uploadContentMedia` (valida o MIME ANTES do upload —
 * `INVALID_FILE_TYPE` — e sobe ao bucket privado `whatsapp-media` isolado por
 * instância). Remove mídias via `removeContentMedia`.
 *
 * Como não há serviço de LISTAGEM de mídias (apenas `mediaCount` no Content),
 * este uploader rastreia as mídias enviadas NESTA sessão de composição — fluxo
 * principal (contents criados agora). Notifica o parent da contagem para a
 * regra de validade do Content (texto OU ≥1 mídia — Req 6.5).
 *
 * Requer um `contentId` persistido (a composição cria o Content antes de
 * permitir anexos). O gate `SETTINGS_EDIT` é responsabilidade do parent.
 */

import { useRef, useState } from 'react';
import {
  uploadContentMedia,
  removeContentMedia,
  MediaValidationError,
  type WhatsAppContentMedia,
  type WhatsAppMediaType,
} from '../../../services/admin/whatsapp/media';
import { SUPPORTED_MIME_SET } from '../../../services/admin/whatsapp/validation';

interface Props {
  instanceId: string;
  contentId: string;
  /** Notifica o parent quando a quantidade de mídias muda (validade Req 6.5). */
  onCountChange?: (count: number) => void;
}

const MEDIA_LABEL: Record<WhatsAppMediaType, string> = {
  IMAGE: 'Imagem',
  VIDEO: 'Vídeo',
  AUDIO: 'Áudio',
  DOCUMENT: 'Documento',
};

/** Atributo `accept` do input a partir dos MIME suportados (Req 6.3). */
const ACCEPT = Array.from(SUPPORTED_MIME_SET).join(',');

export default function MediaUploader({ instanceId, contentId, onCountChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<WhatsAppContentMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Permite re-selecionar o mesmo arquivo depois.
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadContentMedia(instanceId, contentId, file);
      setMedia((prev) => {
        const next = [...prev, uploaded];
        onCountChange?.(next.length);
        return next;
      });
    } catch (err) {
      // MIME inválido (INVALID_FILE_TYPE) ou falha de upload — mensagem pt-BR.
      const message =
        err instanceof MediaValidationError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Não foi possível anexar o arquivo.';
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (mediaId: string) => {
    setError(null);
    try {
      await removeContentMedia(instanceId, mediaId);
      setMedia((prev) => {
        const next = prev.filter((m) => m.id !== mediaId);
        onCountChange?.(next.length);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover o anexo.');
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => void handleSelect(e)}
          disabled={uploading}
          className="hidden"
          id={`media-${contentId}`}
        />
        <label
          htmlFor={`media-${contentId}`}
          className={`cursor-pointer rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 ${
            uploading ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          {uploading ? 'Enviando...' : '+ Anexar mídia'}
        </label>
        {media.length > 0 && (
          <span className="text-[11px] text-gray-500">
            {media.length} anexo{media.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {media.length > 0 && (
        <ul className="space-y-1">
          {media.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs"
            >
              <span className="text-gray-300">{MEDIA_LABEL[m.mediaType] ?? 'Arquivo'}</span>
              <button
                type="button"
                onClick={() => void handleRemove(m.id)}
                className="text-red-300 hover:text-red-200"
                aria-label="Remover anexo"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="rounded border border-red-900/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
