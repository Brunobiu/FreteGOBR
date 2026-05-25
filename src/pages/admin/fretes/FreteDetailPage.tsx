/**
 * FreteDetailPage - /admin/fretes/:id
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  forceCloseFrete,
  getFreteDetail,
  isUuid,
  reactivateFrete,
  FRETES_ERROR_MESSAGES,
  FretesServiceError,
  type FreteDetailBundle,
  type FreteRow,
} from '../../../services/admin/fretes';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import FreteDetailHeader from '../../../components/admin/fretes/FreteDetailHeader';
import FreteFlagInfoBlock from '../../../components/admin/fretes/FreteFlagInfoBlock';
import FreteDataBlock from '../../../components/admin/fretes/FreteDataBlock';
import FreteEmbarcadorBlock from '../../../components/admin/fretes/FreteEmbarcadorBlock';
import FreteMapBlock from '../../../components/admin/fretes/FreteMapBlock';
import FreteClicksBlock from '../../../components/admin/fretes/FreteClicksBlock';
import FreteAuditHistoryBlock from '../../../components/admin/fretes/FreteAuditHistoryBlock';
import EditFreteModal from '../../../components/admin/fretes/EditFreteModal';
import CancelFreteModal from '../../../components/admin/fretes/CancelFreteModal';
import DeleteFreteModal from '../../../components/admin/fretes/DeleteFreteModal';
import FlagFreteModal from '../../../components/admin/fretes/FlagFreteModal';
import ModerateContentModal from '../../../components/admin/fretes/ModerateContentModal';

export default function FreteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { allowed: canView } = useAdminPermission('FRETE_VIEW');
  const { allowed: canEdit } = useAdminPermission('FRETE_EDIT');
  const { allowed: canForceClose } = useAdminPermission('FRETE_FORCE_CLOSE');
  const { allowed: canDelete } = useAdminPermission('FRETE_DELETE');
  const { allowed: canViewUser } = useAdminPermission('USER_VIEW');
  const { allowed: canViewAudit } = useAdminPermission('AUDIT_VIEW');

  const [bundle, setBundle] = useState<FreteDetailBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [clicksPage, setClicksPage] = useState(1);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  // modais
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [flagMode, setFlagMode] = useState<'flag' | 'unflag' | null>(null);
  const [moderating, setModerating] = useState(false);

  const loadBundle = useCallback(
    async (page = 1) => {
      if (!id) return;
      setLoading(true);
      try {
        const b = await getFreteDetail(id, page);
        setBundle(b);
        setNotFound(false);
      } catch (err) {
        if (err instanceof FretesServiceError && err.code === 'NOT_FOUND') {
          setNotFound(true);
        } else {
          setActionMsg((err as Error).message);
        }
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    if (!id || !isUuid(id) || !canView) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    void loadBundle(clicksPage);
  }, [id, canView, clicksPage, loadBundle]);

  if (!canView || notFound) {
    return <Stealth404 />;
  }

  if (loading || !bundle) {
    return <div className="text-gray-500 text-sm">Carregando frete...</div>;
  }

  const frete = bundle.frete;

  function handleErr(err: unknown) {
    if (err instanceof FretesServiceError) {
      setActionMsg(FRETES_ERROR_MESSAGES[err.code]);
    } else {
      setActionMsg((err as Error).message);
    }
  }

  async function handleForceClose() {
    try {
      const r = await forceCloseFrete(frete.id);
      if ('skipped' in r) {
        setActionMsg('Frete ja estava encerrado.');
      } else {
        setActionMsg('Frete encerrado.');
        void loadBundle(clicksPage);
      }
    } catch (err) {
      handleErr(err);
    }
  }

  async function handleReactivate() {
    try {
      const r = await reactivateFrete(frete.id);
      if ('skipped' in r) {
        setActionMsg('Frete ja estava ativo.');
      } else {
        setActionMsg('Frete reativado.');
        void loadBundle(clicksPage);
      }
    } catch (err) {
      handleErr(err);
    }
  }

  function handleSaved(updated: FreteRow) {
    setBundle((b) => (b ? { ...b, frete: updated } : b));
    setEditing(false);
    setActionMsg('Frete atualizado.');
  }

  return (
    <div className="space-y-4">
      <Link to="/admin/fretes" className="text-sm text-cyan-400 hover:text-cyan-300">
        ← Voltar para fretes
      </Link>

      <FreteDetailHeader
        frete={frete}
        canEdit={canEdit}
        canForceClose={canForceClose}
        canDelete={canDelete}
        onEdit={() => setEditing(true)}
        onForceClose={() => void handleForceClose()}
        onCancel={() => setCancelling(true)}
        onReactivate={() => void handleReactivate()}
        onFlag={() => setFlagMode('flag')}
        onUnflag={() => setFlagMode('unflag')}
        onDelete={() => setDeleting(true)}
      />

      {actionMsg && (
        <div className="rounded bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 text-sm text-cyan-300">
          {actionMsg}
        </div>
      )}

      <FreteFlagInfoBlock frete={frete} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          <FreteDataBlock frete={frete} canEdit={canEdit} onModerate={() => setModerating(true)} />
          <FreteMapBlock origin={frete.origin} destination={frete.destination} />
          <FreteClicksBlock
            clicks={bundle.clicks}
            total={bundle.clicksTotal}
            page={bundle.clicksPage}
            pageSize={bundle.clicksPageSize}
            canViewUser={canViewUser}
            onPageChange={setClicksPage}
            error={bundle.errors.clicks}
          />
        </div>
        <div className="space-y-4">
          <FreteEmbarcadorBlock
            embarcador={bundle.embarcador}
            canViewUser={canViewUser}
            error={bundle.errors.embarcador}
          />
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Metricas</h3>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Visualizacoes</dt>
                <dd className="text-gray-200">{bundle.metrics.views_count}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Cliques</dt>
                <dd className="text-gray-200">{bundle.metrics.clicks_count}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Dias ativo</dt>
                <dd className="text-gray-200">{bundle.metrics.days_active}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Conversao estimada</dt>
                <dd className="text-gray-200">
                  {bundle.metrics.estimated_conversion === null
                    ? '—'
                    : `${bundle.metrics.estimated_conversion.toFixed(2)}%`}
                </dd>
              </div>
            </dl>
          </div>
          {canViewAudit && (
            <FreteAuditHistoryBlock entries={bundle.history} error={bundle.errors.history} />
          )}
        </div>
      </div>

      {editing && (
        <EditFreteModal
          frete={frete}
          onClose={() => setEditing(false)}
          onSaved={handleSaved}
          onReload={() => void loadBundle(clicksPage)}
        />
      )}
      {cancelling && (
        <CancelFreteModal
          frete={frete}
          onClose={() => setCancelling(false)}
          onCancelled={() => {
            setCancelling(false);
            setActionMsg('Frete cancelado.');
            void loadBundle(clicksPage);
          }}
        />
      )}
      {deleting && (
        <DeleteFreteModal
          frete={frete}
          onClose={() => setDeleting(false)}
          onDeleted={(clicks) => {
            setDeleting(false);
            navigate('/admin/fretes', {
              replace: true,
              state: {
                toast: `Frete excluido com sucesso. ${clicks} cliques removidos.`,
              },
            });
          }}
        />
      )}
      {flagMode && (
        <FlagFreteModal
          frete={frete}
          mode={flagMode}
          onClose={() => setFlagMode(null)}
          onChanged={() => {
            setFlagMode(null);
            void loadBundle(clicksPage);
          }}
        />
      )}
      {moderating && (
        <ModerateContentModal
          frete={frete}
          onClose={() => setModerating(false)}
          onModerated={() => {
            setModerating(false);
            setActionMsg('Conteudo moderado.');
            void loadBundle(clicksPage);
          }}
        />
      )}
    </div>
  );
}
