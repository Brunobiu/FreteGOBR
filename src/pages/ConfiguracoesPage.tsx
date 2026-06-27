import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import AppHeader from '../components/AppHeader';
import PasswordInput from '../components/PasswordInput';
import AccountDeletionModal from '../components/AccountDeletionModal';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  isBiometricAvailable,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
} from '../services/biometricAuth';

export default function ConfiguracoesPage() {
  useDocumentTitle('Configurações');
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDeletion, setShowDeletion] = useState(false);

  // Biometria (app nativo): disponibilidade + estado do opt-in.
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const available = await isBiometricAvailable();
      if (cancelled) return;
      setBioAvailable(available);
      if (available) setBioEnabled(await isBiometricEnabled());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleBiometric = async () => {
    setError(null);
    setSuccess(null);
    setBioBusy(true);
    try {
      if (bioEnabled) {
        await disableBiometric();
        setBioEnabled(false);
        setSuccess('Entrada por biometria desativada.');
      } else {
        const { data } = await supabase.auth.getSession();
        const refresh = data.session?.refresh_token;
        if (!refresh) throw new Error('Sessão indisponível. Faça login novamente.');
        await enableBiometric(refresh);
        setBioEnabled(true);
        setSuccess('Entrada por biometria ativada.');
      }
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível alterar a biometria.');
    } finally {
      setBioBusy(false);
    }
  };

  const handleAccountDeleted = async () => {
    // A conta e a sessão já foram removidas no servidor; limpa o estado local
    // e leva o usuário para a tela de login.
    try {
      await logout();
    } catch {
      /* best-effort */
    }
    navigate('/login', { replace: true });
  };

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

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Configurações</h1>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Voltar
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        {/* Trocar senha */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Alterar Senha</h2>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Senha Atual</label>
              <PasswordInput
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Nova Senha</label>
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Confirmar Nova Senha</label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
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

        {/* Entrada por biometria (somente app nativo com hardware disponível) */}
        {bioAvailable && (
          <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-1">Entrada por biometria</h2>
            <p className="text-xs text-gray-500 mb-4">
              Desbloqueie o app com sua digital ou reconhecimento facial, sem digitar a senha. Você
              continua logado; a biometria é só uma trava de segurança ao abrir.
            </p>
            <button
              type="button"
              onClick={handleToggleBiometric}
              disabled={bioBusy}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                bioEnabled
                  ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {bioBusy ? 'Aguarde...' : bioEnabled ? 'Desativar biometria' : 'Ativar biometria'}
            </button>
          </div>
        )}

        {/* Privacidade — exclusão de conta (LGPD) */}
        <div className="bg-white border border-red-200 rounded-lg p-5 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">Privacidade</h2>
          <p className="text-xs text-gray-500 mb-4">
            Você pode solicitar a exclusão da sua conta e dos seus dados pessoais. A ação é imediata
            e irreversível.
          </p>
          <button
            type="button"
            onClick={() => setShowDeletion(true)}
            className="px-4 py-2 border border-red-300 text-red-700 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
          >
            Excluir minha conta e meus dados
          </button>
        </div>
      </main>

      {showDeletion && (
        <AccountDeletionModal
          onClose={() => setShowDeletion(false)}
          onDeleted={handleAccountDeleted}
        />
      )}
    </div>
  );
}
