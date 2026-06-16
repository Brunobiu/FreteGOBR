import { useId, useRef, useState } from 'react';
import {
  uploadContentMedia,
  removeContentMedia,
  MediaValidationError,
  type WhatsAppContentMedia,
} from '../../../services/admin/whatsapp/media';
import { SUPPORTED_MIME_SET } from '../../../services/admin/whatsapp/validation';

/**
 * MediaUploader — uploader compacto de midias de um WhatsApp_Content (task 9.2).
 *
 * Aceita arquivos (imagem/video/audio/documento), valida o MIME e chama o
 * servico `uploadContentMedia` (que sobe ao bucket privado `whatsapp-media` e
 * registra a midia, recalculando a validade do Content — Req 6.2, 6.3, 6.4, 6.5).
 * Mostra o status por arquivo durante o envio e lista as midias ja anexadas com
 * acao de remover.
 *
 * Acessibilidade: input rotulado, botoes com `aria-label`, e mensagens de erro
 * com `role="alert"`. Estilo compacto seguindo a convencao do painel admin
 * (project-conventions: botoes `text-xs px-2.5 py-1`).
 *
 * Sera integrado ao `ContentEditor` na task 20.5; por isso recebe a lista de
 * midias e notifica mudancas via `onChange`, sem assumir o estado externo.
 *
 * _Requirements: 6.2, 6.3, 6.4_
 */

/** Status de envio de um arquivo individual selecionado pelo usuario. */
interface UploadItem {
  /** Chave local estavel para render. */
  key: string;
  /** Nome do arquivo (exibicao). */
  name: string;
  /** Estado do envio. */
  status: 'uploading' | 'error';
  /** Mensagem de erro pt-BR (quando `status === 'error'`). */
  error?: string;
}

export interface MediaUploaderProps {
  /** Instancia ativa (isolamento multi-instancia). */
  instanceId: string;
  /** Content ao qual as midias sao anexadas. */
  contentId: string;
  /** Midias ja anexadas ao Content (controlado externamente quando informado). */
  media?: WhatsAppContentMedia[];
  /** Notifica a lista atualizada de midias apos anexar/remover. */
  onChange?: (media: WhatsAppContentMedia[]) => void;
  /** Desabilita interacoes (ex.: usuario sem SETTINGS_EDIT). */
  disabled?: boolean;
}

/** Rotulo pt-BR por media_type, para exibicao acessivel na lista. */
const MEDIA_TYPE_LABEL: Record<WhatsAppContentMedia['mediaType'], string> = {
  IMAGE: 'Imagem',
  VIDEO: 'Vídeo',
  AUDIO: 'Áudio',
  DOCUMENT: 'Documento',
};

/** Extrai o nome do arquivo a partir do storage_path (ultimo segmento). */
function fileNameFromPath(storagePath: string): string {
  const parts = storagePath.split('/');
  return parts[parts.length - 1] || storagePath;
}

export default function MediaUploader({
  instanceId,
  contentId,
  media,
  onChange,
  disabled = false,
}: MediaUploaderProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Lista de midias: controlada externamente (prop `media`) ou interna.
  const [internalMedia, setInternalMedia] = useState<WhatsAppContentMedia[]>(media ?? []);
  const attached = media ?? internalMedia;

  const [pending, setPending] = useState<UploadItem[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const acceptAttr = Array.from(SUPPORTED_MIME_SET).join(',');

  /** Propaga a nova lista para fora e/ou atualiza o estado interno. */
  const commitMedia = (next: WhatsAppContentMedia[]) => {
    if (media === undefined) {
      setInternalMedia(next);
    }
    onChange?.(next);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || disabled) return;

    const selected = Array.from(files);
    // Marca todos como "uploading" para feedback imediato.
    const items: UploadItem[] = selected.map((f, i) => ({
      key: `${Date.now()}_${i}_${f.name}`,
      name: f.name,
      status: 'uploading',
    }));
    setPending((prev) => [...prev, ...items]);

    let current = attached;
    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      const item = items[i];
      try {
        const created = await uploadContentMedia(instanceId, contentId, file);
        current = [...current, created];
        commitMedia(current);
        // Remove o item da lista de pendentes (sucesso).
        setPending((prev) => prev.filter((p) => p.key !== item.key));
      } catch (err) {
        const message =
          err instanceof MediaValidationError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Não foi possível enviar a mídia.';
        setPending((prev) =>
          prev.map((p) => (p.key === item.key ? { ...p, status: 'error', error: message } : p))
        );
      }
    }

    // Permite reenviar o mesmo arquivo (reseta o input).
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleRemove = async (mediaId: string) => {
    if (disabled || removingId) return;
    setRemovingId(mediaId);
    try {
      await removeContentMedia(instanceId, mediaId);
      commitMedia(attached.filter((m) => m.id !== mediaId));
    } catch {
      // Em falha, mantemos a midia na lista; o usuario pode tentar de novo.
    } finally {
      setRemovingId(null);
    }
  };

  const dismissError = (key: string) => {
    setPending((prev) => prev.filter((p) => p.key !== key));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="text-xs font-medium text-gray-700">
          Mídias do conteúdo
        </label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="text-xs px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Anexar arquivo
        </button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={acceptAttr}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {/* Lista de midias ja anexadas. */}
      {attached.length > 0 && (
        <ul className="space-y-1" aria-label="Mídias anexadas">
          {attached.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1"
            >
              <span className="min-w-0 truncate text-xs text-gray-700">
                <span className="font-medium">{MEDIA_TYPE_LABEL[m.mediaType]}</span>
                {' · '}
                {fileNameFromPath(m.storagePath)}
              </span>
              <button
                type="button"
                onClick={() => void handleRemove(m.id)}
                disabled={disabled || removingId === m.id}
                aria-label={`Remover ${fileNameFromPath(m.storagePath)}`}
                className="shrink-0 text-xs px-2.5 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {removingId === m.id ? 'Removendo…' : 'Remover'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Status por arquivo em envio / com erro. */}
      {pending.length > 0 && (
        <ul className="space-y-1">
          {pending.map((p) =>
            p.status === 'uploading' ? (
              <li
                key={p.key}
                className="flex items-center gap-2 rounded border border-gray-200 px-2 py-1 text-xs text-gray-500"
              >
                <span className="min-w-0 truncate">{p.name}</span>
                <span aria-live="polite">Enviando…</span>
              </li>
            ) : (
              <li
                key={p.key}
                role="alert"
                className="flex items-center justify-between gap-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700"
              >
                <span className="min-w-0 truncate">
                  {p.name}: {p.error}
                </span>
                <button
                  type="button"
                  onClick={() => dismissError(p.key)}
                  aria-label="Dispensar erro"
                  className="shrink-0 text-xs px-2 py-0.5 rounded hover:bg-red-100"
                >
                  ✕
                </button>
              </li>
            )
          )}
        </ul>
      )}

      {attached.length === 0 && pending.length === 0 && (
        <p className="text-xs text-gray-400">
          Nenhuma mídia anexada. O conteúdo pode ter texto, mídia ou ambos.
        </p>
      )}
    </div>
  );
}
