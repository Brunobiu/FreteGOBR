/**
 * ScheduledDispatchTab (task 20.7, Req 13.1, 13.2, 13.4, 13.5)
 *
 * Aba de Disparos Programados:
 *  - GESTÃO: lista os Scheduled_Dispatches PENDENTES da Active_Instance (data/
 *    hora, destino, conteúdo) e permite CANCELAR (Req 13.4, 13.5);
 *  - CRIAÇÃO: agenda um disparo de CONTATOS (BULK) para data/hora futura
 *    (Req 13.1, 13.2) — contatos + distribuição + conteúdo + intervalo/quota +
 *    data/hora. O agendamento para GRUPOS é feito na aba Grupo (toggle agendar).
 *
 * Data no passado ⇒ `Informe uma data e hora futuras.` (validado no service/
 * backend). Mutações exigem `SETTINGS_EDIT`.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { normalizeNumbers, validateSendInterval, validateExecutionQuota } from '../../../services/admin/whatsapp/validation';
import { createContactList } from '../../../services/admin/whatsapp/contacts';
import {
  createScheduledDispatch,
  listScheduledDispatches,
  cancelScheduledDispatch,
  type ScheduledDispatchListItem,
} from '../../../services/admin/whatsapp/scheduled';
import { WHATSAPP_NO_VALID_CONTENT_MESSAGE } from '../../../services/admin/whatsapp/dispatch';
import type { DistributionMode } from '../../../services/admin/whatsapp/distribution';
import ContentEditor from './ContentEditor';

interface Props {
  instanceId: string;
}

const INTERVAL_PRESETS: Array<{ label: string; value: number }> = [
  { label: '30s', value: 30 },
  { label: '45s', value: 45 },
  { label: '1 min', value: 60 },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
  { label: '15 min', value: 900 },
];

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export default function ScheduledDispatchTab({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  // Lista de pendentes
  const [pending, setPending] = useState<ScheduledDispatchListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Form de criação (BULK)
  const [numbers, setNumbers] = useState('');
  const [listName, setListName] = useState('');
  const [contentIds, setContentIds] = useState<string[]>([]);
  const [mode, setMode] = useState<DistributionMode>('INTERLEAVED');
  const [blockSize, setBlockSize] = useState(2);
  const [intervalSec, setIntervalSec] = useState(60);
  const [customInterval, setCustomInterval] = useState(false);
  const [quota, setQuota] = useState(100);
  const [scheduledAt, setScheduledAt] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const counter = normalizeNumbers(numbers);

  const loadList = useCallback(() => {
    let cancelled = false;
    setLoadingList(true);
    listScheduledDispatches(instanceId)
      .then((rows) => {
        if (!cancelled) setPending(rows);
      })
      .catch(() => {
        if (!cancelled) setPending([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useEffect(() => loadList(), [loadList]);

  const handleCancel = async (item: ScheduledDispatchListItem) => {
    setError(null);
    setNotice(null);
    try {
      await cancelScheduledDispatch(instanceId, item.scheduledId, item.updatedAt);
      setNotice('Agendamento cancelado.');
      loadList();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível cancelar.';
      setError(message === 'STALE_VERSION' ? 'Outro admin atualizou. Recarregue a página.' : message);
      loadList();
    }
  };

  const handleCreate = async () => {
    setError(null);
    setNotice(null);

    if (counter.valid.length === 0) {
      setError('Informe ao menos um contato válido.');
      return;
    }
    if (contentIds.length === 0) {
      setError(WHATSAPP_NO_VALID_CONTENT_MESSAGE);
      return;
    }
    const iv = validateSendInterval(intervalSec);
    if (!iv.ok) {
      setError(iv.message);
      return;
    }
    const q = validateExecutionQuota(quota);
    if (!q.ok) {
      setError(q.message);
      return;
    }
    if (mode === 'BLOCK' && (!Number.isInteger(blockSize) || blockSize < 1)) {
      setError('Informe o tamanho do bloco.');
      return;
    }
    if (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now()) {
      setError('Informe uma data e hora futuras.');
      return;
    }

    setBusy(true);
    try {
      const name = listName.trim() || `Lista ${new Date().toLocaleString('pt-BR')}`;
      const list = await createContactList(instanceId, name, numbers);
      const res = await createScheduledDispatch(instanceId, {
        kind: 'BULK',
        distributionMode: mode,
        blockSize: mode === 'BLOCK' ? blockSize : null,
        sendIntervalSec: intervalSec,
        executionQuota: quota,
        listId: list.id,
        contentIds,
        scheduledAt: new Date(scheduledAt),
      });
      if ('ok' in res) {
        setNotice('Disparo agendado.');
        setNumbers('');
        setListName('');
        setContentIds([]);
        setScheduledAt('');
        loadList();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível agendar o disparo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Pendentes */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-wider text-gray-500">
            Agendamentos pendentes {pending.length > 0 && `(${pending.length})`}
          </h3>
          <button
            type="button"
            onClick={loadList}
            disabled={loadingList}
            className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            {loadingList ? 'Carregando...' : '↻ Atualizar'}
          </button>
        </div>

        {pending.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs text-gray-500" role="status">
            Nenhum agendamento pendente.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {pending.map((item) => (
              <li
                key={item.scheduledId}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900 p-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm text-gray-100">{formatDateTime(item.scheduledAt)}</div>
                  <div className="text-[11px] text-gray-500">
                    {item.kind === 'GROUP' ? 'Grupos' : 'Contatos'} · {item.totalCount} destinatário(s) ·{' '}
                    {item.contentCount} conteúdo(s)
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void handleCancel(item)}
                    className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20"
                  >
                    Cancelar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Criar novo agendamento (BULK) */}
      {canEdit && (
        <section className="space-y-3 border-t border-gray-800 pt-4">
          <h3 className="text-[11px] uppercase tracking-wider text-gray-500">Novo agendamento (contatos)</h3>

          <input
            type="text"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="Nome da lista (opcional)"
            className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-400">
              <span className="text-green-400">{counter.valid.length} válidos</span>
              {counter.invalid.length > 0 && (
                <span className="ml-2 text-red-400">{counter.invalid.length} inválidos</span>
              )}
            </span>
          </div>
          <textarea
            value={numbers}
            onChange={(e) => setNumbers(e.target.value)}
            rows={3}
            placeholder="Cole os números (um por linha ou separados por vírgula)"
            className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
          />

          <ContentEditor instanceId={instanceId} onChange={(s) => setContentIds(s.contentIds)} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">Distribuição</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as DistributionMode)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
              >
                <option value="INTERLEAVED">Rodízio (intercalado)</option>
                <option value="BLOCK">Em blocos</option>
              </select>
              {mode === 'BLOCK' && (
                <input
                  type="number"
                  min={1}
                  value={blockSize}
                  onChange={(e) => setBlockSize(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">Intervalo</label>
              <select
                value={customInterval ? 'custom' : String(intervalSec)}
                onChange={(e) => {
                  if (e.target.value === 'custom') setCustomInterval(true);
                  else {
                    setCustomInterval(false);
                    setIntervalSec(Number(e.target.value));
                  }
                }}
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
              >
                {INTERVAL_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Personalizado</option>
              </select>
              {customInterval && (
                <input
                  type="number"
                  min={1}
                  value={intervalSec}
                  onChange={(e) => setIntervalSec(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">Quota por execução</label>
              <input
                type="number"
                min={1}
                value={quota}
                onChange={(e) => setQuota(Number(e.target.value))}
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">Data e hora</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy}
            className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? 'Agendando...' : 'Agendar disparo'}
          </button>
        </section>
      )}

      {notice && (
        <div className="rounded border border-green-900/40 bg-green-500/10 px-2 py-1 text-[11px] text-green-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded border border-red-900/40 bg-red-500/10 px-2 py-1 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
