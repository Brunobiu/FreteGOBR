/**
 * EnviarDocumentosModal — modal sobreposto à conversa para o motorista enviar
 * seus próprios documentos do cadastro como anexos do chat.
 *
 * Carrega o catálogo (documentos + CT-e de referências), exibe checkboxes
 * agrupados, e envia os selecionados com um clique reusando o pipeline de
 * anexos. Falhas são isoladas por item (permite reenviar só o que falhou).
 *
 * Segurança: o catálogo e o envio só lidam com arquivos do PRÓPRIO motorista
 * (RLS de `documents` no download + RLS de `chat-attachments` no upload).
 *
 * Feature: chat-enviar-documentos (Req 4, 5, 6, 7, 8).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listSendableDriverDocuments,
  sendDriverDocuments,
  type SendableDocument,
  type SendResult,
} from '../services/chatDocuments';
import { DOC_GROUP_TITLES, selectSendables, type DocGroupKey } from '../services/driverDocsCatalog';
import { getDocumentSignedUrlByPath } from '../services/motorista';

export interface EnviarDocumentosModalProps {
  open: boolean;
  conversationId: string;
  /** Id do motorista autenticado — origem dos documentos. */
  userId: string;
  /** Espelha o gating da barra; defesa extra contra envio fora do gate. */
  unlocked: boolean;
  onClose: () => void;
  onSent?: (result: SendResult) => void;
}

type LoadStatus = 'loading' | 'ready' | 'empty' | 'error';

const GROUP_ORDER: DocGroupKey[] = ['perfil', 'tracao', 'carroceria', 'outros', 'referencias'];

function isImageItem(item: SendableDocument): boolean {
  return item.mimeType != null && item.mimeType.startsWith('image/');
}

export function EnviarDocumentosModal({
  open,
  conversationId,
  userId,
  unlocked,
  onClose,
  onSent,
}: EnviarDocumentosModalProps) {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [catalog, setCatalog] = useState<SendableDocument[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Carrega o catálogo ao abrir. Fail-safe: erro → estado 'error' com retry.
  const load = useCallback(async () => {
    setStatus('loading');
    setSendError(null);
    setFailedIds(new Set());
    setSelectedIds(new Set());
    try {
      const items = await listSendableDriverDocuments(userId);
      setCatalog(items);
      setStatus(items.length === 0 ? 'empty' : 'ready');
    } catch {
      setStatus('error');
    }
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus('loading');
    setSelectedIds(new Set());
    setFailedIds(new Set());
    setSendError(null);
    (async () => {
      try {
        const items = await listSendableDriverDocuments(userId);
        if (cancelled) return;
        setCatalog(items);
        setStatus(items.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  // Esc fecha; trava o scroll de fundo; foca o botão de fechar ao abrir.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, sending, onClose]);

  // Miniaturas (lazy) só para itens de imagem; falha silenciosa → ícone.
  useEffect(() => {
    if (!open || status !== 'ready') return;
    let cancelled = false;
    (async () => {
      const imageItems = catalog.filter(isImageItem);
      for (const item of imageItems) {
        const url = await getDocumentSignedUrlByPath(item.sourcePath);
        if (cancelled || !url) continue;
        setThumbs((prev) => ({ ...prev, [item.id]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, status, catalog]);

  const grouped = useMemo(() => {
    const map = new Map<DocGroupKey, SendableDocument[]>();
    for (const item of catalog) {
      const arr = map.get(item.groupKey) ?? [];
      arr.push(item);
      map.set(item.groupKey, arr);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      key: g,
      title: DOC_GROUP_TITLES[g],
      items: map.get(g)!,
    }));
  }, [catalog]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(catalog.map((i) => i.id)));
  const clearAll = () => setSelectedIds(new Set());

  const handleSend = async () => {
    if (sending || selectedIds.size === 0) return;
    if (!unlocked) {
      setSendError('Os botões ainda não estão liberados. Converse um pouco primeiro.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const items = selectSendables(catalog, selectedIds);
      const result = await sendDriverDocuments(conversationId, userId, items);
      if (result.failed.length === 0) {
        onSent?.(result);
        onClose();
        return;
      }
      // Falha parcial: mantém aberto, seleciona só os que falharam p/ reenvio.
      const failed = new Set(result.failed.map((f) => f.item.id));
      setFailedIds(failed);
      setSelectedIds(failed);
      setSendError(
        `Não foi possível enviar ${result.failed.length} documento(s). Tente novamente.`
      );
      if (result.sent.length > 0) onSent?.(result);
    } catch {
      setSendError('Não foi possível enviar os documentos. Tente novamente.');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const selectedCount = selectedIds.size;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Enviar documentos"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => !sending && onClose()}
      />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-800">Enviar documentos</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => !sending && onClose()}
            aria-label="Fechar"
            className="p-1 text-gray-400 hover:text-gray-700 rounded-full"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {status === 'loading' && (
            <p className="text-[13px] text-gray-500 py-8 text-center">Carregando documentos…</p>
          )}

          {status === 'error' && (
            <div className="py-8 text-center">
              <p className="text-[13px] text-gray-600 mb-3">
                Não foi possível carregar seus documentos.
              </p>
              <button
                type="button"
                onClick={load}
                className="text-[13px] font-semibold text-blue-600 hover:text-blue-700"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {status === 'empty' && (
            <p className="text-[13px] text-gray-600 py-8 text-center">
              Você ainda não tem documentos enviados no cadastro. Conclua seu cadastro de
              documentos para poder enviá-los aqui.
            </p>
          )}

          {status === 'ready' && (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-wider text-gray-500">
                  {selectedCount} selecionado(s)
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-[12px] text-blue-600 hover:text-blue-700"
                  >
                    Selecionar todos
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="text-[12px] text-gray-500 hover:text-gray-700"
                  >
                    Limpar
                  </button>
                </div>
              </div>

              {grouped.map((group) => (
                <section key={group.key} className="mb-3">
                  <h3 className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">
                    {group.title}
                  </h3>
                  <ul className="space-y-1">
                    {group.items.map((item) => {
                      const checked = selectedIds.has(item.id);
                      const failed = failedIds.has(item.id);
                      return (
                        <li key={item.id}>
                          <label
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer border ${
                              failed
                                ? 'border-red-200 bg-red-50'
                                : checked
                                  ? 'border-blue-200 bg-blue-50'
                                  : 'border-transparent hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(item.id)}
                              className="w-4 h-4 accent-blue-600"
                            />
                            <span className="w-9 h-9 rounded bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                              {thumbs[item.id] ? (
                                <img
                                  src={thumbs[item.id]}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <svg
                                  className="w-4 h-4 text-gray-400"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                  />
                                </svg>
                              )}
                            </span>
                            <span className="flex-1 text-[13px] text-gray-800 truncate">
                              {item.label}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-gray-200 shrink-0">
          {sendError && <p className="text-[12px] text-red-600 mb-2">{sendError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !sending && onClose()}
              disabled={sending}
              className="px-3 py-2 text-[13px] text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || selectedCount === 0 || status !== 'ready'}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? 'Enviando…' : `Enviar (${selectedCount})`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default EnviarDocumentosModal;
