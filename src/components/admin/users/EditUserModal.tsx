/**
 * EditUserModal - editar dados basicos + aba Moderacao.
 *
 * - Pre-preenche com expectedUpdatedAt capturado na abertura
 * - Trata STALE_VERSION com botao Recarregar
 * - Toast por code de erro
 */

import { useState } from 'react';
import {
  editUser,
  USERS_ERROR_MESSAGES,
  UsersServiceError,
  type EditUserPayload,
  type UserRow,
} from '../../../services/admin/users';
import BanUserForm from './BanUserForm';

type Tab = 'dados' | 'moderacao';

interface Props {
  user: UserRow;
  canModerate: boolean;
  onClose: () => void;
  onSaved: (updated: UserRow) => void;
  onReload: () => void;
}

export default function EditUserModal({ user, canModerate, onClose, onSaved, onReload }: Props) {
  const [tab, setTab] = useState<Tab>('dados');
  const [data, setData] = useState<EditUserPayload>({
    name: user.name,
    email: user.email,
    phone: user.phone,
    cpf: user.cpf ?? null,
    cnpj: user.cnpj ?? null,
    company_name: user.company_name ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleVersion, setStaleVersion] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await editUser(user.id, data, user.updated_at);
      onSaved(updated);
    } catch (err) {
      if (err instanceof UsersServiceError) {
        if (err.code === 'STALE_VERSION') {
          setStaleVersion(true);
        } else {
          setError(USERS_ERROR_MESSAGES[err.code]);
        }
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 id="edit-user-title" className="text-sm font-semibold text-gray-200">
            Editar usuario
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-gray-500 hover:text-white"
          >
            ×
          </button>
        </div>

        {staleVersion ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-amber-300">Os dados foram alterados por outro admin.</p>
            <p className="text-xs text-gray-400">
              Recarregue antes de salvar para ver os dados atuais.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setStaleVersion(false);
                  onReload();
                  onClose();
                }}
                className="px-3 py-1.5 rounded text-sm bg-cyan-500 hover:bg-cyan-600 text-white"
              >
                Recarregar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 pt-3 flex gap-2 border-b border-gray-800">
              <button
                type="button"
                onClick={() => setTab('dados')}
                className={`pb-2 text-xs font-medium transition ${
                  tab === 'dados'
                    ? 'text-cyan-300 border-b-2 border-cyan-500'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Dados
              </button>
              {canModerate && (
                <button
                  type="button"
                  onClick={() => setTab('moderacao')}
                  className={`pb-2 text-xs font-medium transition ${
                    tab === 'moderacao'
                      ? 'text-cyan-300 border-b-2 border-cyan-500'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Moderacao
                </button>
              )}
            </div>

            {tab === 'dados' && (
              <form onSubmit={handleSubmit} className="p-5 space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Nome</label>
                  <input
                    type="text"
                    value={data.name}
                    onChange={(e) => setData({ ...data, name: e.target.value })}
                    required
                    className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Telefone</label>
                  <input
                    type="text"
                    value={data.phone}
                    onChange={(e) => setData({ ...data, phone: e.target.value })}
                    required
                    className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Email</label>
                  <input
                    type="email"
                    value={data.email ?? ''}
                    onChange={(e) => setData({ ...data, email: e.target.value || null })}
                    className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                  />
                </div>

                {user.user_type === 'motorista' && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">CPF</label>
                    <input
                      type="text"
                      value={data.cpf ?? ''}
                      onChange={(e) => setData({ ...data, cpf: e.target.value || null })}
                      className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                    />
                  </div>
                )}

                {user.user_type === 'embarcador' && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Razao social</label>
                      <input
                        type="text"
                        value={data.company_name ?? ''}
                        onChange={(e) =>
                          setData({
                            ...data,
                            company_name: e.target.value || null,
                          })
                        }
                        required
                        className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">CNPJ</label>
                      <input
                        type="text"
                        value={data.cnpj ?? ''}
                        onChange={(e) => setData({ ...data, cnpj: e.target.value || null })}
                        className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
                      />
                    </div>
                  </>
                )}

                {error && (
                  <div className="text-sm text-red-400" role="alert">
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    autoFocus
                    className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-1.5 rounded text-sm bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white"
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            )}

            {tab === 'moderacao' && canModerate && (
              <div className="p-5">
                <BanUserForm
                  user={user}
                  onChanged={(updated) => onSaved(updated)}
                  onClose={onClose}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
