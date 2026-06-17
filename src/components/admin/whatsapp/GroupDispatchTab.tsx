/**
 * GroupDispatchTab (task 20.6, Req 12.1-12.7)
 *
 * Aba de Disparo em Grupo: seleciona 1+ grupos (GroupSelector), compõe o
 * conteúdo multimídia (ContentEditor), define Send_Interval/Execution_Quota e
 * dispara — agora (createGroupDispatch) ou agendado (scheduleGroupDispatch).
 * Reusa o MESMO motor durável do disparo em massa (`kind=GROUP`).
 *
 * Seleção vazia ⇒ `Selecione ao menos um grupo.` (Req 12.7, reforçado no
 * service/backend). Mutações exigem `SETTINGS_EDIT`. O acompanhamento do envio
 * fica na aba Fila (task 20.11).
 */

import { useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { validateSendInterval, validateExecutionQuota } from '../../../services/admin/whatsapp/validation';
import {
  createGroupDispatch,
  scheduleGroupDispatch,
} from '../../../services/admin/whatsapp/groups';
import { WHATSAPP_NO_GROUPS_SELECTED_MESSAGE, WHATSAPP_NO_VALID_CONTENT_MESSAGE } from '../../../services/admin/whatsapp/dispatch';
import GroupSelector from './GroupSelector';
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

export default function GroupDispatchTab({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  const [groups, setGroups] = useState<string[]>([]);
  const [contentIds, setContentIds] = useState<string[]>([]);
  const [intervalSec, setIntervalSec] = useState(60);
  const [customInterval, setCustomInterval] = useState(false);
  const [quota, setQuota] = useState(100);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    setGroups([]);
    setContentIds([]);
    setScheduledAt('');
  };

  const handleDispatch = async () => {
    setError(null);
    setNotice(null);

    if (groups.length === 0) {
      setError(WHATSAPP_NO_GROUPS_SELECTED_MESSAGE);
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
    if (scheduleMode && !scheduledAt) {
      setError('Informe uma data e hora futuras.');
      return;
    }

    setBusy(true);
    try {
      if (scheduleMode) {
        const res = await scheduleGroupDispatch(instanceId, {
          groupJids: groups,
          contentIds,
          sendIntervalSec: intervalSec,
          executionQuota: quota,
          scheduledAt: new Date(scheduledAt),
        });
        if ('ok' in res) {
          setNotice('Disparo em grupo agendado.');
          reset();
        }
      } else {
        const res = await createGroupDispatch(instanceId, {
          groupJids: groups,
          contentIds,
          sendIntervalSec: intervalSec,
          executionQuota: quota,
        });
        if ('ok' in res) {
          setNotice('Disparo em grupo iniciado. Acompanhe na aba Fila.');
          reset();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível disparar para os grupos.');
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-500">
        Você não tem permissão para disparar para grupos nesta instância.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GroupSelector instanceId={instanceId} selected={groups} onChange={setGroups} />

      <ContentEditor instanceId={instanceId} onChange={(s) => setContentIds(s.contentIds)} />

      {/* Intervalo / quota */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
            Intervalo entre grupos
          </label>
          <select
            value={customInterval ? 'custom' : String(intervalSec)}
            onChange={(e) => {
              if (e.target.value === 'custom') {
                setCustomInterval(true);
              } else {
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
              placeholder="segundos"
              className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
            />
          )}
        </div>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
            Quota por execução
          </label>
          <input
            type="number"
            min={1}
            value={quota}
            onChange={(e) => setQuota(Number(e.target.value))}
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
          />
        </div>
      </section>

      {/* Agendamento opcional */}
      <section className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={scheduleMode}
            onChange={(e) => setScheduleMode(e.target.checked)}
            className="rounded border-gray-600 bg-gray-700"
          />
          Agendar para depois
        </label>
        {scheduleMode && (
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
          />
        )}
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleDispatch()}
          disabled={busy}
          className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? 'Processando...' : scheduleMode ? 'Agendar disparo' : 'Enviar agora'}
        </button>
      </div>

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
