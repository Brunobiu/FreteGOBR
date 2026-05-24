/**
 * UserDetailPage - /admin/users/:id
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  forceLogout,
  getUserDetail,
  isValidUuid,
  requestPasswordReset,
  toggleActive,
  unbanUser,
  USERS_ERROR_MESSAGES,
  UsersServiceError,
  type UserDetailBundle,
  type UserRow,
} from '../../../services/admin/users';
import { useAdminContext } from '../../../components/admin/AdminProvider';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import UserDetailHeader from '../../../components/admin/users/UserDetailHeader';
import UserDocumentsBlock from '../../../components/admin/users/UserDocumentsBlock';
import UserFretesBlock from '../../../components/admin/users/UserFretesBlock';
import UserRatingsBlock from '../../../components/admin/users/UserRatingsBlock';
import UserChatMetadataBlock from '../../../components/admin/users/UserChatMetadataBlock';
import UserBanInfoBlock from '../../../components/admin/users/UserBanInfoBlock';
import EditUserModal from '../../../components/admin/users/EditUserModal';
import DeleteUserModal from '../../../components/admin/users/DeleteUserModal';

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAdminContext();
  const selfId = session?.userId ?? null;

  const { allowed: canView } = useAdminPermission('USER_VIEW');
  const { allowed: canEdit } = useAdminPermission('USER_EDIT');
  const { allowed: canToggleActive } = useAdminPermission('USER_TOGGLE_ACTIVE');
  const { allowed: canDelete } = useAdminPermission('USER_DELETE');

  const [bundle, setBundle] = useState<UserDetailBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadBundle = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const b = await getUserDetail(id);
      setBundle(b);
      setNotFound(false);
    } catch (err) {
      if (err instanceof UsersServiceError && err.code === 'NOT_FOUND') {
        setNotFound(true);
      } else {
        setActionMsg((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id || !isValidUuid(id) || !canView) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    void loadBundle();
  }, [id, canView, loadBundle]);

  if (!canView || notFound) {
    return <Stealth404 />;
  }

  if (loading || !bundle) {
    return <div className="text-gray-500 text-sm">Carregando usuario...</div>;
  }

  const user = bundle.user;

  async function handleToggleActive() {
    try {
      const updated = await toggleActive(user.id, !user.is_active, user.updated_at);
      setBundle((b) => (b ? { ...b, user: updated } : b));
      setActionMsg(updated.is_active ? 'Conta ativada.' : 'Conta desativada.');
    } catch (err) {
      handleErr(err);
    }
  }

  async function handleResetPassword() {
    try {
      const r = await requestPasswordReset(user.id);
      setActionMsg(`Link de reset enviado por ${r.channel}.`);
    } catch (err) {
      handleErr(err);
    }
  }

  async function handleForceLogout() {
    try {
      const r = await forceLogout(user.id);
      setActionMsg(`Sessoes encerradas. ${r.revokedTokens} token(s) revogados.`);
    } catch (err) {
      handleErr(err);
    }
  }

  async function handleUnban() {
    try {
      const updated = await unbanUser(user.id, user.updated_at);
      setBundle((b) => (b ? { ...b, user: updated } : b));
      setActionMsg('Usuario desbanido.');
    } catch (err) {
      handleErr(err);
    }
  }

  function handleErr(err: unknown) {
    if (err instanceof UsersServiceError) {
      setActionMsg(USERS_ERROR_MESSAGES[err.code]);
    } else {
      setActionMsg((err as Error).message);
    }
  }

  function handleSaved(updated: UserRow) {
    setBundle((b) => (b ? { ...b, user: updated } : b));
    setEditing(false);
    setActionMsg('Salvo.');
  }

  function handleDeleted() {
    setDeleting(false);
    navigate('/admin/users', { replace: true });
  }

  return (
    <div className="space-y-4">
      <Link to="/admin/users" className="text-sm text-cyan-400 hover:text-cyan-300">
        ← Voltar
      </Link>

      <UserDetailHeader
        user={user}
        selfId={selfId}
        canEdit={canEdit}
        canToggleActive={canToggleActive}
        canDelete={canDelete}
        onEdit={() => setEditing(true)}
        onToggleActive={() => void handleToggleActive()}
        onResetPassword={() => void handleResetPassword()}
        onForceLogout={() => void handleForceLogout()}
        onDelete={() => setDeleting(true)}
      />

      {actionMsg && (
        <div className="rounded bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 text-sm text-cyan-300">
          {actionMsg}
        </div>
      )}

      <UserBanInfoBlock
        user={user}
        bannedByName={bundle.bannedByName}
        canUnban={canToggleActive && user.id !== selfId}
        onUnban={() => void handleUnban()}
      />

      <UserDocumentsBlock documents={bundle.documents} error={bundle.errors.documents} />

      <UserFretesBlock
        userType={user.user_type}
        fretes={bundle.fretes}
        total={bundle.fretesTotal}
        error={bundle.errors.fretes}
      />

      <UserRatingsBlock ratings={bundle.ratings} error={bundle.errors.ratings} />

      <UserChatMetadataBlock chat={bundle.chat} error={bundle.errors.chat} />

      {editing && (
        <EditUserModal
          user={user}
          canModerate={canToggleActive}
          onClose={() => setEditing(false)}
          onSaved={handleSaved}
          onReload={() => void loadBundle()}
        />
      )}

      {deleting && (
        <DeleteUserModal user={user} onClose={() => setDeleting(false)} onDeleted={handleDeleted} />
      )}
    </div>
  );
}
