/**
 * ChatHandoffBar — barra exibida acima da Input_Bar do chat de frete.
 *
 * Enquanto os dois lados não trocam o mínimo de mensagens (`unlocked === false`)
 * mostra um aviso (nudge) e os botões ficam travados; liberados, abrem o
 * WhatsApp do peer e, no lado do motorista, o modal de envio de documentos.
 *
 * - Embarcador (`showDocuments === false`): layout legado — nudge à esquerda +
 *   botão WhatsApp à direita (sem regressão).
 * - Motorista (`showDocuments === true`): nudge ACIMA + linha com dois botões de
 *   largura igual (Enviar documentos à esquerda, WhatsApp à direita).
 *
 * Feature: chat-enviar-documentos (Req 1, 2, 3).
 */

export interface ChatHandoffBarProps {
  /** Ambos os lados atingiram o limiar de mensagens (mesma fonte do WhatsApp). */
  unlocked: boolean;
  /** Mensagem de erro transitória (ex.: contato indisponível). */
  error: string | null;
  /** Abre o WhatsApp do peer. */
  onOpenWhatsapp: () => void;
  /** Exibe o botão "Enviar documentos" (apenas no lado do motorista). */
  showDocuments?: boolean;
  /** Abre o modal de envio de documentos. */
  onOpenDocuments?: () => void;
}

const LOCKED_BTN =
  'bg-gray-200 text-gray-400 cursor-not-allowed';
const TITLE_LOCKED = 'Disponível depois de algumas mensagens dos dois lados';

/** Logotipo do WhatsApp (glifo oficial simplificado), na cor atual. */
function WhatsappGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.06zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.074-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  );
}

/** Ícone de documento (papel com dobra), traço na cor atual. */
function DocumentGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

export function ChatHandoffBar({
  unlocked,
  error,
  onOpenWhatsapp,
  showDocuments = false,
  onOpenDocuments,
}: ChatHandoffBarProps) {
  // Embarcador: layout legado (nudge à esquerda + WhatsApp à direita).
  if (!showDocuments) {
    return (
      <div className="border-t border-gray-200 bg-white px-2 py-2 shrink-0">
        {error && <p className="text-[11px] text-red-600 mb-1 text-center">{error}</p>}
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[12px] text-gray-600 leading-tight">
            {unlocked
              ? 'Vocês já podem conversar no WhatsApp.'
              : 'Converse um pouco para liberar o WhatsApp.'}
          </span>
          <button
            type="button"
            onClick={unlocked ? onOpenWhatsapp : undefined}
            disabled={!unlocked}
            title={unlocked ? 'Abrir WhatsApp' : TITLE_LOCKED}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition ${
              unlocked
                ? 'bg-[#25D366] text-white hover:brightness-95 active:brightness-90 shadow-sm'
                : LOCKED_BTN
            }`}
          >
            <WhatsappGlyph className="w-4 h-4" />
            WhatsApp
          </button>
        </div>
      </div>
    );
  }

  // Motorista: nudge acima + dois botões de largura igual (docs | WhatsApp).
  return (
    <div className="border-t border-gray-200 bg-white px-2 py-2 shrink-0">
      {error && <p className="text-[11px] text-red-600 mb-1 text-center">{error}</p>}
      <p className="text-[12px] text-gray-600 leading-tight mb-1.5 text-center">
        {unlocked
          ? 'Vocês já podem conversar no WhatsApp e enviar documentos.'
          : 'Converse um pouco para liberar os botões.'}
      </p>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={unlocked ? onOpenDocuments : undefined}
          disabled={!unlocked}
          title={unlocked ? 'Enviar documentos' : TITLE_LOCKED}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition ${
            unlocked
              ? 'bg-blue-600 text-white hover:bg-blue-700 active:brightness-95 shadow-sm'
              : LOCKED_BTN
          }`}
        >
          <DocumentGlyph className="w-4 h-4" />
          Enviar documentos
        </button>
        <button
          type="button"
          onClick={unlocked ? onOpenWhatsapp : undefined}
          disabled={!unlocked}
          title={unlocked ? 'Abrir WhatsApp' : TITLE_LOCKED}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition ${
            unlocked
              ? 'bg-[#25D366] text-white hover:brightness-95 active:brightness-90 shadow-sm'
              : LOCKED_BTN
          }`}
        >
          <WhatsappGlyph className="w-4 h-4" />
          WhatsApp
        </button>
      </div>
    </div>
  );
}

export default ChatHandoffBar;
