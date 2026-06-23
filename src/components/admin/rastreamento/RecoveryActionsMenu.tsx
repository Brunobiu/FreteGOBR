/**
 * RecoveryActionsMenu — ações de recuperação por linha da At_Risk_List.
 *
 * GATED por `RASTREAMENTO_MANAGE` (prop `canManage`): em modo somente-leitura as
 * ações são OCULTADAS por completo (retorna `null`), não apenas desabilitadas
 * (Req 7.10). Ações (Req 7.6): abrir conversa no WhatsApp (Conversation_Inbox de
 * whatsapp-automation), copiar telefone, copiar mensagem pronta, marcar como
 * contatado e ver histórico. O envio real é delegado server-side; a UI só aciona.
 */

import { useEffect, useRef, useState } from 'react';
import type { AtRiskRow } from '../../../services/admin/rastreamento/atRiskList';

interface Props {
  canManage: boolean;
  row: AtRiskRow;
  onOpenWhatsapp: (row: AtRiskRow) => void;
  onCopyPhone: (row: AtRiskRow) => void;
  onCopyMessage: (row: AtRiskRow) => void;
  onMarkContacted: (row: AtRiskRow) => void;
  onTriggerRecovery: (row: AtRiskRow) => void;
  onViewHistory: (row: AtRiskRow) => void;
}

export default function RecoveryActionsMenu({
  canManage,
  row,
  onOpenWhatsapp,
  onCopyPhone,
  onCopyMessage,
  onMarkContacted,
  onTriggerRecovery,
  onViewHistory,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Somente-leitura: ações OCULTADAS por completo (Req 7.10).
  if (!canManage) return null;

  const item = (label: string, fn: () => void) => (
    <button
      type="button"
      onClick={() => {
        fn();
        setOpen(false);
      }}
      className="w-full text-left text-xs px-2.5 py-1 text-gray-300 hover:bg-gray-800"
    >
      {label}
    </button>
  );

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="Ações de recuperação"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2.5 py-1 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
      >
        Recuperar
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 w-48 rounded-lg border border-gray-700 bg-gray-900 shadow-xl py-1">
          {item('Abrir conversa no WhatsApp', () => onOpenWhatsapp(row))}
          {item('Acionar recuperação', () => onTriggerRecovery(row))}
          {item('Copiar telefone', () => onCopyPhone(row))}
          {item('Copiar mensagem pronta', () => onCopyMessage(row))}
          {item('Marcar como contatado', () => onMarkContacted(row))}
          {item('Ver histórico de mensagens', () => onViewHistory(row))}
        </div>
      )}
    </div>
  );
}
