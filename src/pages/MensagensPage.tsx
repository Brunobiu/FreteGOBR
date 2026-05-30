import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  getUserConversations,
  getFreteMessages,
  sendFreteMessage,
  sendFreteAttachment,
  resolveAttachmentUrl,
  getConversationPeer,
  markFreteMessagesAsRead,
  subscribeToFreteMessages,
  getTotalUnreadCount,
  type FreteConversation,
  type FreteMessage,
  type ConversationPeer,
} from '../services/chatFrete';
import { resolveProfilePhotoUrl } from '../services/documents';
import { supabase } from '../services/supabase';

const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20MB
const TYPING_TIMEOUT_MS = 3000;

/**
 * Página de mensagens estilo WhatsApp/Telegram.
 * - Lista fixa à esquerda com scroll próprio.
 * - Thread fixa à direita com scroll próprio (mensagens + input fixos).
 * - Suporte a anexos (imagem, áudio, arquivo) via botão e drag-and-drop.
 * - Tiquinhos de leitura (✓✓ cinza = enviada / azul = lida).
 * - Indicador "digitando..." em tempo real via broadcast do Supabase.
 * - Tela inicial vazia com fundo temático até o usuário escolher uma conversa.
 *
 * Continuidade de chat para motorista com trial expirado (Req 5.7, 6.2):
 * `/mensagens` é INTENCIONALMENTE acessível a motorista bloqueado — esta rota
 * NÃO recebe `TrialGate`/`MotoristaProtectedRoute` (ver `App.tsx`, onde usa
 * apenas `ProtectedRoute`). O bloqueio "duro" (`TrialExpiredPage`) aplica-se ao
 * feed de fretes (HomePage) e às telas de descoberta/assistente, não ao chat.
 *
 * A continuidade é AUTORITATIVA no servidor: a RLS de `conversations`/`messages`
 * (+ `fretes`) só retorna as conversas dos fretes em andamento do próprio
 * motorista (um `conversations` só existe quando há contato sobre um frete
 * específico). Este componente apenas reflete o que o servidor permite —
 * `getUserConversations`/`getFreteMessages`/`sendFreteMessage` operam sobre
 * tabelas protegidas por RLS e não chamam nenhum RPC de feed/novo-aceite
 * (`getActiveFretes`, `toggle_frete_like`) que negaria a um motorista bloqueado.
 * NÃO duplicar a lógica de continuidade aqui — a fonte de verdade é a RLS.
 */
export default function MensagensPage() {
  useDocumentTitle('Mensagens');
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetConvId = searchParams.get('conversation');

  const [conversations, setConversations] = useState<FreteConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<FreteMessage[]>([]);
  const [peer, setPeer] = useState<ConversationPeer | null>(null);
  const [peerPhoto, setPeerPhoto] = useState<string | null>(null);
  const [convPhotos, setConvPhotos] = useState<Record<string, string | null>>({});
  const [newMessage, setNewMessage] = useState('');
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingDebounceRef = useRef<number | null>(null);
  const peerTypingTimerRef = useRef<number | null>(null);
  const isTypingRef = useRef(false);
  const dragCounterRef = useRef(0);

  const reloadConversations = async () => {
    if (!user) return;
    try {
      setLoadingConvs(true);
      const list = await getUserConversations(user.id);
      setConversations(list);

      // Resolve em paralelo as fotos/logos pra cada conversa
      const photoEntries = await Promise.all(
        list.map(async (c) => {
          const src = c.otherUser?.photo;
          if (!src) return [c.id, null] as const;
          const url = await resolveProfilePhotoUrl(src);
          return [c.id, url] as const;
        })
      );
      setConvPhotos(Object.fromEntries(photoEntries));
    } catch (err) {
      console.error('Erro ao carregar conversas', err);
    } finally {
      setLoadingConvs(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) reloadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);

  // Realtime global: escuta INSERTs em messages pra atualizar a lista
  // lateral (preview da última mensagem + badge de não lidas) sem refresh.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`mensagens-list-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as {
            conversation_id: string;
            sender_id: string;
            content: string | null;
            attachment_type: string | null;
          };

          let preview = row.content && row.content.trim() !== '' ? row.content : '';
          if (!preview && row.attachment_type === 'image') preview = '🖼 Imagem';
          else if (!preview && row.attachment_type === 'audio') preview = '🎤 Áudio';
          else if (!preview && row.attachment_type === 'file') preview = '📎 Arquivo';

          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === row.conversation_id);
            if (idx === -1) {
              // Conversa nova chegou (criada do outro lado) — recarrega tudo.
              reloadConversations();
              return prev;
            }
            const conv = prev[idx];
            const isFromMe = row.sender_id === user.id;
            const isActive = activeId === row.conversation_id;
            const updated: FreteConversation = {
              ...conv,
              lastMessage: preview || conv.lastMessage,
              unreadCount:
                isFromMe || isActive ? (conv.unreadCount ?? 0) : (conv.unreadCount ?? 0) + 1,
            };
            // Move pro topo
            const next = [updated, ...prev.filter((_, i) => i !== idx)];
            return next;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeId]);

  useEffect(() => {
    if (targetConvId) setActiveId(targetConvId);
  }, [targetConvId]);

  // Carrega mensagens + peer info quando troca conversa
  useEffect(() => {
    if (!activeId || !user) {
      setPeer(null);
      setPeerPhoto(null);
      setPeerTyping(false);
      return;
    }
    let cancelled = false;
    setLoadingMsgs(true);
    setMessages([]);

    (async () => {
      try {
        const [msgs, peerInfo] = await Promise.all([
          getFreteMessages(activeId),
          getConversationPeer(activeId),
        ]);
        if (cancelled) return;

        const enriched = await Promise.all(
          msgs.map(async (m) => {
            if (!m.attachmentPath) return m;
            const url = await resolveAttachmentUrl(m.attachmentPath);
            return { ...m, attachmentUrl: url };
          })
        );
        if (cancelled) return;

        setMessages(enriched);
        setPeer(peerInfo);

        if (peerInfo) {
          const photoSrc =
            peerInfo.userType === 'embarcador'
              ? (peerInfo.companyLogo ?? peerInfo.profilePhoto)
              : peerInfo.profilePhoto;
          if (photoSrc) {
            const resolved = await resolveProfilePhotoUrl(photoSrc);
            if (!cancelled) setPeerPhoto(resolved);
          } else {
            setPeerPhoto(null);
          }
        }

        // Marca mensagens como lidas + atualiza badge global do header
        await markFreteMessagesAsRead(activeId, user.id);
        setConversations((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, unreadCount: 0 } : c))
        );
        try {
          const total = await getTotalUnreadCount(user.id);
          window.dispatchEvent(
            new CustomEvent<number>('fretego-chat-unread-count', { detail: total })
          );
        } catch {
          /* ignore */
        }

        // Marca como lidas as notificações tipo `new_message` desta conversa
        // (vem do trigger SQL com link `/mensagens?conversation=<id>`).
        try {
          await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('type', 'new_message')
            .eq('link', `/mensagens?conversation=${activeId}`)
            .is('read_at', null);
          window.dispatchEvent(new Event('fretego-notifications-refresh'));
        } catch {
          /* ignore */
        }
      } catch (err) {
        console.error('Erro ao carregar mensagens', err);
      } finally {
        if (!cancelled) setLoadingMsgs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId, user]);

  // Realtime de INSERT em messages (mensagens novas)
  useEffect(() => {
    if (!activeId || !user) return;
    const unsub = subscribeToFreteMessages(activeId, async (msg) => {
      let enriched = msg;
      if (msg.attachmentPath) {
        const url = await resolveAttachmentUrl(msg.attachmentPath);
        enriched = { ...msg, attachmentUrl: url };
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === enriched.id)) return prev;
        return [...prev, enriched];
      });
      if (msg.senderId !== user.id) {
        setPeerTyping(false);
        markFreteMessagesAsRead(activeId, user.id).catch(() => {});
        // Marca notificação `new_message` desta conversa como lida
        // (estamos com a janela aberta, então não faz sentido alertar).
        supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('type', 'new_message')
          .eq('link', `/mensagens?conversation=${activeId}`)
          .is('read_at', null)
          .then(() => {
            // Atualiza o badge do sino
            window.dispatchEvent(new Event('fretego-notifications-refresh'));
          });
      }
    });
    return unsub;
  }, [activeId, user]);

  // Realtime de UPDATE em messages — pra atualizar read_at (ticks azuis)
  // quando o outro lado lê o que eu enviei.
  useEffect(() => {
    if (!activeId || !user) return;
    const channel = supabase
      .channel(`message-updates-${activeId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; read_at: string | null };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === row.id ? { ...m, readAt: row.read_at ? new Date(row.read_at) : null } : m
            )
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId, user]);

  // Canal de "digitando..." — broadcast leve, sem persistir
  useEffect(() => {
    if (!activeId || !user) return;
    const channel = supabase.channel(`typing-${activeId}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on('broadcast', { event: 'typing' }, (payload) => {
        const data = payload.payload as { userId: string; typing: boolean };
        if (data.userId === user.id) return;
        setPeerTyping(data.typing);
        if (peerTypingTimerRef.current) {
          clearTimeout(peerTypingTimerRef.current);
          peerTypingTimerRef.current = null;
        }
        if (data.typing) {
          // Auto-clear caso o outro lado não envie o `false`.
          peerTypingTimerRef.current = window.setTimeout(
            () => setPeerTyping(false),
            TYPING_TIMEOUT_MS + 1000
          );
        }
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
    };
  }, [activeId, user]);

  const broadcastTyping = (typing: boolean) => {
    if (!typingChannelRef.current || !user) return;
    typingChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: user.id, typing },
    });
  };

  const handleTypingChange = (val: string) => {
    setNewMessage(val.slice(0, 1000));
    if (val.trim().length > 0) {
      if (!isTypingRef.current) {
        isTypingRef.current = true;
        broadcastTyping(true);
      }
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
      typingDebounceRef.current = window.setTimeout(() => {
        isTypingRef.current = false;
        broadcastTyping(false);
      }, TYPING_TIMEOUT_MS);
    } else if (isTypingRef.current) {
      isTypingRef.current = false;
      broadcastTyping(false);
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    }
  };

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, peerTyping]);

  const handleSelect = (id: string) => {
    setActiveId(id);
    const next = new URLSearchParams(searchParams);
    next.set('conversation', id);
    setSearchParams(next, { replace: true });
  };

  const handleClose = () => {
    setActiveId(null);
    setMessages([]);
    setPeer(null);
    setPeerPhoto(null);
    setPeerTyping(false);
    const next = new URLSearchParams(searchParams);
    next.delete('conversation');
    setSearchParams(next, { replace: true });
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !activeId || !user) return;
    // Sinaliza que parou de digitar antes de enviar
    if (isTypingRef.current) {
      isTypingRef.current = false;
      broadcastTyping(false);
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    }
    setSending(true);
    try {
      await sendFreteMessage(activeId, user.id, newMessage.trim());
      setNewMessage('');
    } catch (err) {
      console.error('Erro ao enviar', err);
    } finally {
      setSending(false);
    }
  };

  const detectAttachmentType = (file: File): 'image' | 'audio' | 'file' => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'file';
  };

  const handleAttach = async (file: File, type?: 'image' | 'audio' | 'file') => {
    if (!activeId || !user) return;
    setAttachmentError(null);
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setAttachmentError('Arquivo muito grande (máx. 20MB).');
      return;
    }
    setSending(true);
    try {
      await sendFreteAttachment(activeId, user.id, file, type ?? detectAttachmentType(file));
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Erro ao enviar anexo');
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: mime });
        const file = new File([blob], `audio_${Date.now()}.${mime.split('/')[1]}`, {
          type: mime,
        });
        stream.getTracks().forEach((t) => t.stop());
        await handleAttach(file, 'audio');
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setAttachmentError('Não foi possível acessar o microfone.');
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (!recording || !recorderRef.current) return;
    recorderRef.current.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const cancelRecording = () => {
    if (!recorderRef.current) return;
    recorderRef.current.ondataavailable = null;
    recorderRef.current.onstop = null;
    recorderRef.current.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current.stop();
    recorderRef.current = null;
    recordedChunksRef.current = [];
    setRecording(false);
  };

  // ── Drag-and-drop ──────────────────────────────────────────────────
  const handleDragEnter = (e: React.DragEvent) => {
    if (!activeId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types.includes('Files')) {
      dragCounterRef.current++;
      setDragOver(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragOver(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!activeId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);
    if (!activeId) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      await handleAttach(file);
    }
  };

  const formatTime = (date: Date) =>
    new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden">
      <AppHeader />

      <main className="max-w-6xl w-full mx-auto px-2 sm:px-4 py-2 sm:py-3 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-800">Mensagens</h1>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Voltar
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex-1 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] h-full min-h-0">
            {/* Lista de conversas */}
            <aside
              className={`border-r border-gray-200 overflow-y-auto bg-gray-50/40 min-h-0 ${
                activeId ? 'hidden md:block' : 'block'
              }`}
            >
              {loadingConvs ? (
                <p className="text-sm text-gray-500 text-center py-8">Carregando...</p>
              ) : conversations.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                    <svg
                      className="w-6 h-6 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-700">Nenhuma mensagem ainda</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Inicie uma conversa a partir de um frete.
                  </p>
                </div>
              ) : (
                <ul>
                  {conversations.map((conv) => {
                    const photo = convPhotos[conv.id] ?? null;
                    const initials = (conv.otherUser?.name ?? '?').charAt(0).toUpperCase();
                    return (
                      <li key={conv.id}>
                        <button
                          type="button"
                          onClick={() => handleSelect(conv.id)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 border-b border-gray-100 hover:bg-gray-100 transition-colors text-left ${
                            activeId === conv.id ? 'bg-blue-50' : ''
                          }`}
                        >
                          {photo ? (
                            <img
                              src={photo}
                              alt={conv.otherUser?.name ?? ''}
                              className="w-8 h-8 rounded-full object-cover border border-gray-200 shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold text-xs shrink-0">
                              {initials}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-gray-800 truncate leading-tight">
                              {conv.otherUser?.name ?? 'Usuário'}
                            </p>
                            {conv.frete && (
                              <p className="text-[10px] text-gray-400 truncate leading-tight">
                                {conv.frete.origin} → {conv.frete.destination}
                              </p>
                            )}
                            <p className="text-[11px] text-gray-500 truncate leading-tight">
                              {conv.lastMessage ?? 'Sem mensagens'}
                            </p>
                          </div>
                          {(conv.unreadCount ?? 0) > 0 && (
                            <span className="bg-blue-600 text-white text-[9px] font-semibold rounded-full px-1.5 py-0.5 shrink-0">
                              {conv.unreadCount}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            {/* Área da conversa */}
            <section
              className={`relative flex-col min-h-0 ${activeId ? 'flex' : 'hidden md:flex'}`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {!activeId ? (
                <EmptyChatState />
              ) : (
                <>
                  {/* Overlay drag-and-drop */}
                  {dragOver && (
                    <div className="absolute inset-0 z-30 bg-blue-50/90 border-4 border-dashed border-blue-400 rounded flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                        <svg
                          className="w-14 h-14 text-blue-500 mx-auto mb-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12"
                          />
                        </svg>
                        <p className="text-base font-semibold text-blue-700">
                          Solte aqui pra enviar
                        </p>
                        <p className="text-xs text-blue-600 mt-1">
                          Imagens, áudios ou arquivos (até 20MB cada)
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Header */}
                  <header className="flex items-center gap-2.5 px-3 py-2 border-b border-gray-200 bg-white shrink-0">
                    <button
                      onClick={handleClose}
                      className="md:hidden text-gray-500 hover:text-gray-800"
                      aria-label="Voltar"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                    </button>

                    {peerPhoto ? (
                      <img
                        src={peerPhoto}
                        alt={peer?.name ?? ''}
                        className="w-9 h-9 rounded-full object-cover border border-gray-200 shrink-0"
                        onError={() => setPeerPhoto(null)}
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm shrink-0">
                        {(peer?.name ?? '?').charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-gray-800 truncate leading-tight">
                        {peer?.name ?? 'Usuário'}
                      </p>
                      {peerTyping ? (
                        <p className="text-[11px] text-blue-600 italic truncate leading-tight">
                          digitando...
                        </p>
                      ) : (
                        <>
                          {active?.frete && (
                            <p className="text-[10px] text-blue-600 truncate leading-tight">
                              {active.frete.origin} → {active.frete.destination}
                            </p>
                          )}
                          {peer?.userType === 'embarcador' && peer.companyName && (
                            <p className="text-[10px] text-gray-500 truncate leading-tight">
                              {peer.companyName}
                            </p>
                          )}
                          {peer?.userType === 'motorista' &&
                            (peer.vehicleModel || peer.vehiclePlate) && (
                              <p className="text-[10px] text-gray-500 truncate leading-tight">
                                {[peer.vehicleModel, peer.vehiclePlate?.toUpperCase()]
                                  .filter(Boolean)
                                  .join(' · ')}
                                {peer.cargoCapacity ? ` · ${peer.cargoCapacity}t` : ''}
                                {peer.trailerAxles ? ` · ${peer.trailerAxles}eix` : ''}
                              </p>
                            )}
                        </>
                      )}
                    </div>

                    {/* Botão de fechar */}
                    <button
                      onClick={handleClose}
                      className="hidden md:inline-flex text-gray-400 hover:text-gray-700 p-1"
                      aria-label="Fechar conversa"
                      title="Fechar conversa"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </header>

                  {/* Mensagens */}
                  <div className="flex-1 min-h-0 overflow-y-auto chat-bg p-3 space-y-1.5">
                    {loadingMsgs ? (
                      <p className="text-center text-[11px] text-gray-400 py-8">Carregando...</p>
                    ) : messages.length === 0 ? (
                      <p className="text-center text-[11px] text-gray-400 py-8">
                        Diga olá. Inicie a conversa.
                      </p>
                    ) : (
                      messages.map((msg) => {
                        const isMine = msg.senderId === user?.id;
                        return (
                          <div
                            key={msg.id}
                            className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                          >
                            <div className="max-w-[78%]">
                              <div
                                className={`px-2.5 py-1.5 rounded-lg text-[13px] shadow-sm ${
                                  isMine
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white border border-gray-200 text-gray-800'
                                }`}
                              >
                                {msg.attachmentType === 'image' && msg.attachmentUrl && (
                                  <a
                                    href={msg.attachmentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <img
                                      src={msg.attachmentUrl}
                                      alt={msg.attachmentName ?? 'imagem'}
                                      className="rounded max-w-full max-h-60 mb-1 cursor-zoom-in"
                                    />
                                  </a>
                                )}
                                {msg.attachmentType === 'audio' && msg.attachmentUrl && (
                                  <audio
                                    controls
                                    src={msg.attachmentUrl}
                                    className="mb-1 max-w-full h-8"
                                  />
                                )}
                                {msg.attachmentType === 'file' && msg.attachmentUrl && (
                                  <a
                                    href={msg.attachmentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`flex items-center gap-1.5 mb-1 px-1.5 py-1 rounded ${
                                      isMine
                                        ? 'bg-blue-700/40 hover:bg-blue-700/60'
                                        : 'bg-gray-100 hover:bg-gray-200'
                                    }`}
                                  >
                                    <svg
                                      className="w-4 h-4 shrink-0"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 12h6m-3-3v6m9 1a9 9 0 11-18 0 9 9 0 0118 0z"
                                      />
                                    </svg>
                                    <div className="min-w-0">
                                      <p className="text-[11px] font-medium truncate">
                                        {msg.attachmentName}
                                      </p>
                                      {msg.attachmentSize && (
                                        <p className="text-[9px] opacity-70">
                                          {formatBytes(msg.attachmentSize)}
                                        </p>
                                      )}
                                    </div>
                                  </a>
                                )}

                                {msg.content && (
                                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                                )}

                                <div
                                  className={`flex items-center justify-end gap-1 mt-0.5 ${
                                    isMine ? 'text-white/70' : 'text-gray-400'
                                  }`}
                                >
                                  <span className="text-[9px]">{formatTime(msg.createdAt)}</span>
                                  {isMine && <ReadTicks read={!!msg.readAt} />}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {peerTyping && (
                      <div className="flex justify-start">
                        <div className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 shadow-sm">
                          <TypingDots />
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input */}
                  <footer className="border-t border-gray-200 bg-white p-2 shrink-0">
                    {attachmentError && (
                      <p className="text-[11px] text-red-600 mb-1.5">{attachmentError}</p>
                    )}
                    {recording ? (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 flex-1 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[11px] text-red-700 font-medium">
                            Gravando áudio...
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={cancelRecording}
                          className="px-2 py-1 text-[11px] text-gray-600 hover:text-gray-800"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={stopRecording}
                          className="p-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700"
                          aria-label="Enviar áudio"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                            />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleAttach(f, 'image');
                            e.target.value = '';
                          }}
                        />
                        <input
                          ref={fileInputRef}
                          type="file"
                          hidden
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleAttach(f, 'file');
                            e.target.value = '';
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={sending}
                          title="Anexar arquivo"
                          className="p-1.5 text-gray-500 hover:text-blue-600 disabled:opacity-50"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                            />
                          </svg>
                        </button>

                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          disabled={sending}
                          title="Enviar imagem"
                          className="p-1.5 text-gray-500 hover:text-blue-600 disabled:opacity-50"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                        </button>

                        <button
                          type="button"
                          onClick={startRecording}
                          disabled={sending}
                          title="Gravar áudio"
                          className="p-1.5 text-gray-500 hover:text-red-600 disabled:opacity-50"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 11a7 7 0 01-14 0m7 7v3m-4 0h8m-4-7a3 3 0 01-3-3V6a3 3 0 116 0v5a3 3 0 01-3 3z"
                            />
                          </svg>
                        </button>

                        <input
                          type="text"
                          value={newMessage}
                          onChange={(e) => handleTypingChange(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                          maxLength={1000}
                          placeholder="Digite uma mensagem..."
                          className="flex-1 px-3 py-1.5 text-[13px] bg-gray-100 border border-gray-200 rounded-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleSend}
                          disabled={sending || !newMessage.trim()}
                          className="p-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50"
                          aria-label="Enviar"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                            />
                          </svg>
                        </button>
                      </div>
                    )}
                  </footer>
                </>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Componentes auxiliares ──────────────────────────────────────────────────

/**
 * Tela inicial mostrada quando nenhuma conversa está aberta.
 */
function EmptyChatState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 chat-empty-bg">
      <div className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center mb-5 shadow-inner">
        <svg
          className="w-12 h-12 text-blue-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 7h13a4 4 0 014 4v0a4 4 0 01-4 4h-2l-2 3v-3H7a4 4 0 01-4-4V7z"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-800">FreteGO Mensagens</h2>
      <p className="text-sm text-gray-500 mt-1 max-w-sm">
        Selecione uma conversa para conversar com motoristas e embarcadores. Suas mensagens ficam
        salvas mesmo sem internet.
      </p>
    </div>
  );
}

/**
 * Tiquinhos de leitura estilo WhatsApp.
 *  - Cinza (✓✓): mensagem entregue ao servidor.
 *  - Azul (✓✓): destinatário leu.
 */
function ReadTicks({ read }: { read: boolean }) {
  const color = read ? 'text-sky-300' : 'text-current opacity-70';
  return (
    <svg
      className={`w-3.5 h-3.5 ${color}`}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={read ? 'Lida' : 'Enviada'}
    >
      <polyline points="2,10 6,14 12,5" />
      <polyline points="7,10 11,14 17,5" />
    </svg>
  );
}

/**
 * Animação dos 3 pontinhos do "digitando...".
 */
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full typing-dot" />
      <span
        className="w-1.5 h-1.5 bg-gray-400 rounded-full typing-dot"
        style={{ animationDelay: '0.15s' }}
      />
      <span
        className="w-1.5 h-1.5 bg-gray-400 rounded-full typing-dot"
        style={{ animationDelay: '0.3s' }}
      />
    </span>
  );
}
