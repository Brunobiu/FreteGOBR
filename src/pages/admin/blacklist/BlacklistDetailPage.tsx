/**
 * BlacklistDetailPage - /admin/blacklist/:id
 *
 * Detalhe completo de uma entrada da blacklist, com 5 blocos isolados:
 * header, dados, source user, tentativas (gated AUDIT_VIEW), historico (gated AUDIT_VIEW).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getBlacklistDetail,
  isUuid,
  reactivateEntry,
  type BlacklistDetailBundle,
} from '../../../services/admin/blacklist';
import Stealth404 from '../../../components/admin/Stealth404';
import BlacklistEntryHeader from '../../../components/admin/blacklist/BlacklistEntryHeader';
import BlacklistEntryDataBlock from '../../../components/admin/blacklist/BlacklistEntryDataBlock';
import BlacklistSourceUserBlock from '../../../components/admin/blacklist/BlacklistSourceUserBlock';
import BlacklistAttemptsBlock from '../../../components/admin/blacklist/BlacklistAttemptsBlock';
import BlacklistAuditHistoryBlock from '../../../components/admin/blacklist/BlacklistAuditHistoryBlock';
import BlacklistEditModal from '../../../components/admin/blacklist/BlacklistEditModal';
import BlacklistRemoveModal from '../../../components/admin/blacklist/BlacklistRemoveModal';

const REACTIVATE_DEFAULT_REASON = 'Reativação via painel admin';

export default function BlacklistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bundle, setBundle] = useState<BlacklistDetailBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsPage, setAttemptsPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  const [showEdit, setShowEdit] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const fetchDetail = useCallback(async (entryId: string, page: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getBlacklistDetail(entryId, page);
      setBundle(result);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') {
        setNotFound(true);
      } else {
        setError((err as Error).message ?? 'Falha ao carregar entrada.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!id || !isUuid(id)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    void fetchDetail(id, attemptsPage);
  }, [id, attemptsPage, reloadKey, fetchDetail]);

  if (notFound) return <Stealth404 />;

  if (loading && !bundle) {
    return (
      <div className="text-sm text-gray-400" aria-busy="true">
        Carregando...
      </div>
    );
  }

  if (error && !bundle) {
    return (
      <div className="rounded bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
        {error}{' '}
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="underline">
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!bundle) return null;

  async function handleReactivate() {
    if (!bundle) return;
    setReactivating(true);
    try {
      await reactivateEntry(
        bundle.entry.id,
        {
          reason: bundle.entry.reason || REACTIVATE_DEFAULT_REASON,
          expiresAt: bundle.entry.expires_at,
        },
        bundle.entry.updated_at
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      alert((err as Error).message ?? 'Falha ao reativar.');
    } finally {
      setReactivating(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link to="/admin/blacklist" className="text-cyan-300 hover:text-cyan-200 underline">
          ← Voltar
        </Link>
        <span className="text-gray-600">/</span>
        <span>Entrada {bundle.entry.id.slice(0, 8)}</span>
      </div>

      <BlacklistEntryHeader
        entry={bundle.entry}
        onEdit={() => setShowEdit(true)}
        onRemove={() => setShowRemove(true)}
        onReactivate={() => void handleReactivate()}
      />

      {reactivating && <div className="text-xs text-gray-400">Reativando...</div>}

      <BlacklistEntryDataBlock entry={bundle.entry} />

      <BlacklistSourceUserBlock sourceUser={bundle.sourceUser} error={bundle.errors.sourceUser} />

      <BlacklistAttemptsBlock
        rows={bundle.attempts}
        total={bundle.attemptsTotal}
        page={bundle.attemptsPage}
        pageSize={bundle.attemptsPageSize}
        onPageChange={setAttemptsPage}
        error={bundle.errors.attempts}
      />

      <BlacklistAuditHistoryBlock rows={bundle.history} error={bundle.errors.history} />

      {showEdit && (
        <BlacklistEditModal
          entry={bundle.entry}
          expectedUpdatedAt={bundle.entry.updated_at}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      {showRemove && (
        <BlacklistRemoveModal
          entry={bundle.entry}
          onClose={() => setShowRemove(false)}
          onRemoved={() => {
            setShowRemove(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
