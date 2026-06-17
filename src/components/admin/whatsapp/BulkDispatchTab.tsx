/**
 * BulkDispatchTab (task 20.4, Req 5, 7, 8, 9, 11)
 *
 * Aba de Disparo em Massa da Active_Instance: monta a Contact_List (com contador
 * de válidos/inválidos), compõe os Contents (ContentEditor), define
 * Distribution_Mode (BLOCK/INTERLEAVED), Send_Interval (predefinido/custom) e
 * Execution_Quota, e cria o disparo (rascunho ou iniciar agora). Após criado,
 * expõe os controles (Pausar/Continuar/Cancelar) e a barra de progresso.
 *
 * Validações client-side espelham o backend (defesa em profundidade): lista
 * vazia, sem Content, intervalo/quota inválidos e — para "Iniciar agora" —
 * sessão não conectada (`Conecte o WhatsApp antes de iniciar o disparo.`).
 * Mutações exigem `SETTINGS_EDIT`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import { normalizeNumbers, validateSendInterval, validateExecutionQuota } from '../../../services/admin/whatsapp/validation';
import { createContactList } from '../../../services/admin/whatsapp/contacts';
import {
  createDispatchJob,
  transitionDispatch,
  WHATSAPP_NO_VALID_CONTENT_MESSAGE,
  type DispatchJobStatus,
  type DispatchAction,
} from '../../../services/admin/whatsapp/dispatch';
import { getDispatchProgress, type DispatchProgress } from '../../../services/admin/whatsapp/stats';
import { getSession, WHATSAPP_NOT_CONNECTED_MESSAGE, type SessionStatus } from '../../../services/admin/whatsapp/session';
import type { DistributionMode } from '../../../services/admin/whatsapp/distribution';
import ContentEditor from './ContentEditor';

interface Props {
  instanceId: string;
}

/** Send_Interval predefinidos (Req 8.2), em segundos, + opção personalizada. */
const INTERVAL_PRESETS: Array<{ label: string; value: number }> = [
  { label: '30s', value: 30 },
  { label: '45s', value: 45 },
  { label: '1 min', value: 60 },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
  { label: '15 min', value: 900 },
];

const ACTIVE_STATUSES: DispatchJobStatus[] = ['QUEUED', 'RUNNING', 'PAUSED'];

interface CreatedJob {
  id: string;
  status: DispatchJobStatus;
  updatedAt: string;
}

export default function BulkDispatchTab({ instanceId }: Props) {
  const { allowed: canEdit } = useAdminPermission('SETTINGS_EDIT');

  // Contact_List
  const [numbers, setNumbers] = useState('');
  const [listName, setListName] = useState('');
  const counter = useMemo(() => normalizeNumbers(numbers), [numbers]);

  // Contents
  const [contentIds, setContentIds] = useState<string[]>([]);

  // Configuração
  const [mode, setMode] = useState<DistributionMode>('INTERLEAVED');
  const [blockSize, setBlockSize] = useState(2);
  const [intervalSec, setIntervalSec] = useState(60);
  const [customInterval, setCustomInterval] = useState(false);
  const [quota, setQuota] = useState(100);

  // Sessão (bloqueia iniciar quando não conectada)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('DISCONNECTED');

  // Estado do disparo criado
  const [job, setJob] = useState<CreatedJob | null>(null);
  const [progress, setProgress] = useState<DispatchProgress | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Carrega o status da sessão (para bloquear "Iniciar agora" se desconectada).
  useEffect(() => {
    let cancelled = false;
    getSession(instanceId)
      .then((s) => {
        if (!cancelled) setSessionStatus(s.status);
      })
      .catch(() => {
        if (!cancelled) setSessionStatus('DISCONNECTED');
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  const loadProgress = useCallback(
    (jobId: string) => {
      getDispatchProgress(instanceId, jobId)
        .then(setProgress)
        .catch(() => setProgress(null));
    },
    [instanceId]
  );

  // Poll leve do progresso enquanto o disparo está ativo (realtime fica na task 21).
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (job && ACTIVE_STATUSES.includes(job.status)) {
      pollRef.current = setInterval(() => loadProgress(job.id), 8000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [job, loadProgress]);

  const resetComposer = () => {
    setNumbers('');
    setListName('');
    setContentIds([]);
    setProgress(null);
  };

  const handleCreate = async (start: boolean) => {
    setError(null);
    setNotice(null);

    // Validações client-side (espelham o backend).
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
    if (start && sessionStatus !== 'CONNECTED') {
      setError(WHATSAPP_NOT_CONNECTED_MESSAGE);
      return;
    }

    setCreating(true);
    try {
      const name = listName.trim() || `Lista ${new Date().toLocaleString('pt-BR')}`;
      const list = await createContactList(instanceId, name, numbers);

      const result = await createDispatchJob(instanceId, {
        kind: 'BULK',
        distributionMode: mode,
        blockSize: mode === 'BLOCK' ? blockSize : null,
        sendIntervalSec: intervalSec,
        executionQuota: quota,
        listId: list.id,
        contentIds,
        status: start ? 'QUEUED' : 'DRAFT',
      });

      if ('ok' in result) {
        setJob({ id: result.data.id, status: result.data.status, updatedAt: result.updated_at });
        setNotice(start ? 'Disparo iniciado.' : 'Rascunho salvo.');
        loadProgress(result.data.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o disparo.');
    } finally {
      setCreating(false);
    }
  };

  const handleControl = async (action: DispatchAction) => {
    if (!job) return;
    setError(null);
    setNotice(null);
    try {
      const res = await transitionDispatch(instanceId, job.id, action, job.updatedAt);
      if ('ok' in res) {
        setJob({ id: job.id, status: res.data.status, updatedAt: res.updated_at });
      } else {
        setNotice('Esta ação já estava aplicada.');
      }
      loadProgress(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível atualizar o disparo.';
      setError(message === 'STALE_VERSION' ? 'Outro admin atualizou. Recarregue a página.' : message);
    }
  };

  if (!canEdit) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-500">
        Você não tem permissão para criar disparos nesta instância.
      </div>
    );
  }

  const progressPct = progress ? Math.round(progress.progress * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Lista de contatos */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-wider text-gray-500">Contatos</h3>
          <span className="text-[11px] text-gray-400">
            <span className="text-green-400">{counter.valid.length} válidos</span>
            {counter.invalid.length > 0 && (
              <span className="ml-2 text-red-400">{counter.invalid.length} inválidos</span>
            )}
          </span>
        </div>
        <input
          type="text"
          value={listName}
          onChange={(e) => setListName(e.target.value)}
          placeholder="Nome da lista (opcional)"
          className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
        />
        <textarea
          value={numbers}
          onChange={(e) => setNumbers(e.target.value)}
          rows={4}
          placeholder="Cole os números (um por linha ou separados por vírgula)"
          className="w-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 focus:border-green-500 focus:outline-none"
        />
      </section>

      {/* Conteúdos */}
      <ContentEditor instanceId={instanceId} onChange={(s) => setContentIds(s.contentIds)} />

      {/* Configuração de distribuição / pacing / quota */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
            Distribuição
          </label>
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
              placeholder="Tamanho do bloco"
              className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100"
            />
          )}
        </div>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
            Intervalo entre envios
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

      {/* Ações de criação */}
      {!job && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCreate(true)}
            disabled={creating}
            className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {creating ? 'Criando...' : 'Criar e iniciar'}
          </button>
          <button
            type="button"
            onClick={() => void handleCreate(false)}
            disabled={creating}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            Salvar rascunho
          </button>
          {sessionStatus !== 'CONNECTED' && (
            <span className="text-[11px] text-yellow-400">{WHATSAPP_NOT_CONNECTED_MESSAGE}</span>
          )}
        </div>
      )}

      {/* Controles + progresso do disparo criado */}
      {job && (
        <section className="space-y-2 rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-300">
              Status: <span className="font-semibold text-gray-100">{job.status}</span>
            </span>
            <div className="flex items-center gap-1.5">
              {job.status === 'RUNNING' && (
                <ControlButton label="Pausar" onClick={() => void handleControl('PAUSE')} />
              )}
              {job.status === 'PAUSED' && (
                <ControlButton label="Continuar" onClick={() => void handleControl('RESUME')} />
              )}
              {ACTIVE_STATUSES.includes(job.status) && (
                <ControlButton label="Cancelar" danger onClick={() => void handleControl('CANCEL')} />
              )}
              <ControlButton label="Atualizar" onClick={() => loadProgress(job.id)} />
            </div>
          </div>

          {progress && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
                <div className="h-full bg-green-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-gray-400">
                <span>
                  {progress.sentCount}/{progress.totalCount} enviados ({progressPct}%)
                </span>
                <span>{progress.remainingCount} restantes</span>
              </div>
              {progress.isComplete && (
                <div className="text-[11px] text-green-400">
                  Concluído — {progress.summary.sent} enviados, {progress.summary.failed} falhas,{' '}
                  {progress.summary.skipped} ignorados.
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setJob(null);
              resetComposer();
            }}
            className="text-[11px] text-gray-500 hover:text-gray-300"
          >
            + Novo disparo
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

function ControlButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2.5 py-1 text-xs ${
        danger
          ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
          : 'border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  );
}
