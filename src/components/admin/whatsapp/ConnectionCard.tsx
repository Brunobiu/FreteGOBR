/**
 * ConnectionCard (task 20.2, Req 3.2-3.6)
 *
 * Cartão de conexão da Active_Instance: exibe o status da sessão e o QR Code
 * quando em pareamento, com ações Conectar / Desconectar / Atualizar. Toda a
 * comunicação com a Evolution passa pela Edge Function `whatsapp-evolution-proxy`
 * (via `connection.ts`) — a Evolution_Api_Key nunca chega ao browser.
 *
 * Gating (task 20.15): Conectar/Desconectar exigem `SETTINGS_EDIT`; sem a
 * permissão, os botões não aparecem (o status segue visível com `SETTINGS_VIEW`).
 * Erro/indisponibilidade ⇒ Canonical_Message `Não foi possível conectar o
 * WhatsApp.` mantendo o status DISCONNECTED (Req 3.5).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { getSession, type SessionStatus } from '../../../services/admin/whatsapp/session';
import {
  connectInstance,
  refreshQr,
  getConnectionStatus,
  disconnectInstance,
} from '../../../services/admin/whatsapp/connection';

interface Props {
  instanceId: string;
}

const STATUS_PRESENTATION: Record<SessionStatus, { label: string; dot: string; text: string }> = {
  CONNECTED: { label: 'Conectado', dot: 'bg-green-400', text: 'text-green-400' },
  CONNECTING: { label: 'Conectando', dot: 'bg-yellow-400', text: 'text-yellow-400' },
  QR_PENDING: { label: 'Aguardando leitura do QR', dot: 'bg-yellow-400', text: 'text-yellow-400' },
  EXPIRED: { label: 'Sessão expirada', dot: 'bg-orange-400', text: 'text-orange-400' },
  DISCONNECTED: { label: 'Desconectado', dot: 'bg-red-400', text: 'text-red-400' },
};

export default function ConnectionCard({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [status, setStatus] = useState<SessionStatus>('DISCONNECTED');
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carrega o status persistido da sessão ao montar / trocar de instância.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setQr(null);
    setLoading(true);
    getSession(instanceId)
      .then((s) => {
        if (!cancelled) {
          setStatus(s.status);
          setQr(s.qrCode);
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('DISCONNECTED');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  const handleConnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await connectInstance(instanceId);
    setStatus(res.status);
    setQr(res.qr);
    if (!res.ok) setError(res.message ?? 'Não foi possível conectar o WhatsApp.');
    setLoading(false);
  }, [instanceId]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Em pareamento, reobtém o QR; caso contrário, consulta o estado.
    const res = status === 'QR_PENDING' ? await refreshQr(instanceId) : await getConnectionStatus(instanceId);
    setStatus(res.status);
    setQr(res.qr);
    if (!res.ok) setError(res.message ?? 'Não foi possível conectar o WhatsApp.');
    setLoading(false);
  }, [instanceId, status]);

  const handleDisconnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await disconnectInstance(instanceId);
    setStatus(res.status);
    setQr(null);
    if (!res.ok) setError(res.message ?? 'Não foi possível conectar o WhatsApp.');
    setLoading(false);
  }, [instanceId]);

  const presentation = STATUS_PRESENTATION[status] ?? STATUS_PRESENTATION.DISCONNECTED;
  const isConnected = status === 'CONNECTED';

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${presentation.dot}`} aria-hidden="true" />
          <span className={`text-sm font-semibold ${presentation.text}`}>{presentation.label}</span>
        </div>

        {canEdit && (
          <div className="flex items-center gap-1.5">
            {!isConnected && (
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={loading}
                className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? '...' : 'Conectar'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={loading}
              className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
            >
              Atualizar
            </button>
            {isConnected && (
              <button
                type="button"
                onClick={() => void handleDisconnect()}
                disabled={loading}
                className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              >
                Desconectar
              </button>
            )}
          </div>
        )}
      </div>

      {/* QR de pareamento */}
      {qr && status === 'QR_PENDING' && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <img
            src={qr}
            alt="QR Code para parear o WhatsApp"
            className="h-48 w-48 rounded bg-white p-2"
            decoding="async"
          />
          <p className="text-center text-[11px] text-gray-500">
            Abra o WhatsApp no celular &gt; Aparelhos conectados &gt; Conectar um aparelho e
            aponte para o QR.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded border border-red-900/40 bg-red-500/10 p-2 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
