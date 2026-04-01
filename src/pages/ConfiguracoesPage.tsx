import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../services/supabase';
import AppHeader from '../components/AppHeader';

export default function ConfiguracoesPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword.length < 6) {
      setError('Nova senha deve ter no mínimo 6 caracteres');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    setIsSaving(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
      if (authError) throw new Error(authError.message);
      setSuccess('Senha alterada com sucesso!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar senha');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Tem certeza que deseja excluir sua conta? Esta ação é irreversível.')) return;
    if (!confirm('ÚLTIMA CHANCE: Todos os seus dados serão perdidos. Confirma?')) return;

    try {
      if (user) {
        await supabase.from('users').update({ is_active: false }).eq('id', user.id);
      }
      await logout();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir conta');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Configurações</h1>
          <button onClick={() => navigate(-1)} className="text-sm text-gray-400 hover:text-white">
            ← Voltar
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-200 text-sm">
            {success}
          </div>
        )}

        {/* Trocar senha */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Alterar Senha</h2>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Senha Atual</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nova Senha</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Confirmar Nova Senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Salvando...' : 'Alterar Senha'}
            </button>
          </form>
        </div>

        {/* Excluir conta */}
        <div className="bg-gray-900 border border-red-900/50 rounded-lg p-5">
          <h2 className="text-lg font-semibold text-red-400 mb-2">Zona de Perigo</h2>
          <p className="text-sm text-gray-400 mb-4">
            Ao excluir sua conta, todos os seus dados serão desativados permanentemente.
          </p>
          <button
            onClick={handleDeleteAccount}
            className="px-5 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
          >
            Excluir Minha Conta
          </button>
        </div>
      </main>
    </div>
  );
}
