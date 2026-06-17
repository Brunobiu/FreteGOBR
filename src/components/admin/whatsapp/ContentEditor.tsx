/**
 * ContentEditor (task 20.5, Req 6.1, 6.5, 6.6, 25.1)
 *
 * Editor dos múltiplos WhatsApp_Contents de uma composição (Req 6.1). Cada
 * Content tem TEXTO (template com Message_Variables) e/ou MÍDIA. Os Contents são
 * persistidos (standalone, `dispatchJobId = null`) à medida que são adicionados,
 * e seus ids são repassados ao parent (`onChange`) para virarem os `contentIds`
 * do disparo. A validade (texto OU ≥1 mídia — Req 6.5) é reforçada no backend.
 *
 * Observações desta iteração: a criação parte do TEXTO (a mídia é anexada a um
 * Content já criado, via `MediaUploader`); Content só-mídia e reordenação ficam
 * para iterações seguintes. O gate `SETTINGS_EDIT` é do parent (a aba).
 */

import { useState } from 'react';
import {
  createContent,
  updateContent,
  deleteContent,
  type WhatsAppContent,
} from '../../../services/admin/whatsapp/contents';
import MediaUploader from './MediaUploader';
import MessagePreview from './MessagePreview';

/** Estado local de cada Content em edição. */
interface ContentItem {
  id: string;
  body: string;
  mediaCount: number;
  updatedAt: string | null;
}

interface Props {
  instanceId: string;
  /** Notifica os contentIds atuais e se há ao menos um Content válido. */
  onChange: (state: { contentIds: string[]; count: number }) => void;
}

function toItem(c: WhatsAppContent): ContentItem {
  return { id: c.id, body: c.body ?? '', mediaCount: c.mediaCount, updatedAt: c.updatedAt };
}

export default function ContentEditor({ instanceId, onChange }: Props) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Atualiza a lista e notifica o parent com os ids resultantes. */
  const commit = (next: ContentItem[]) => {
    setItems(next);
    onChange({ contentIds: next.map((i) => i.id), count: next.length });
  };

  const handleAdd = async () => {
    const body = draft.trim();
    if (body.length === 0) {
      setError('Informe um texto ou anexe ao menos uma mídia.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createContent(instanceId, { body, position: items.length });
      commit([...items, toItem(created)]);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível adicionar o conteúdo.');
    } finally {
      setBusy(false);
    }
  };

  const handleBodyChange = (id: string, body: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, body } : i)));
  };

  /** Salva o texto editado (texto vazio só é permitido se houver mídia — Req 6.5). */
  const handleBodyBlur = async (item: ContentItem) => {
    const body = item.body.trim();
    if (body.length === 0 && item.mediaCount === 0) {
      setError('Informe um texto ou anexe ao menos uma mídia.');
      return;
    }
    setError(null);
    try {
      const updated = await updateContent(instanceId, item.id, {
        body,
        position: items.findIndex((i) => i.id === item.id),
        mediaCount: item.mediaCount,
        expectedUpdatedAt: item.updatedAt,
      });
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, updatedAt: updated.updatedAt } : i))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o conteúdo.');
    }
  };

  const handleMediaCount = (id: string, count: number) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, mediaCount: count } : i)));
  };

  const handleRemove = async (id: string) => {
    setError(null);
    try {
      await deleteContent(instanceId, id);
      commit(items.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover o conteúdo.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500">
          Conteúdos {items.length > 0 && `(${items.length})`}
        </h3>
      </div>

      {/* Contents já adicionados */}
      {items.map((item, idx) => (
        <div key={item.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">Conteúdo {idx + 1}</span>
            <button
              type="button"
              onClick={() => void handleRemove(item.id)}
              className="text-[11px] text-red-300 hover:text-red-200"
            >
              Remover
            </button>
          </div>

          <textarea
            value={item.body}
            onChange={(e) => handleBodyChange(item.id, e.target.value)}
            onBlur={() => void handleBodyBlur(item)}
            rows={3}
            placeholder="Texto da mensagem (use {{nome}}, {{telefone}}, {{empresa}})"
            className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
          />

          <MediaUploader
            instanceId={instanceId}
            contentId={item.id}
            onCountChange={(count) => handleMediaCount(item.id, count)}
          />

          {item.body.trim().length > 0 && <MessagePreview template={item.body} />}
        </div>
      ))}

      {/* Composer de novo Content */}
      <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/50 p-3 space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Novo conteúdo: digite o texto da mensagem..."
          className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={busy || draft.trim().length === 0}
          className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? 'Adicionando...' : '+ Adicionar conteúdo'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-900/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
