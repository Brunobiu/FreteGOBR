/**
 * pages/RedefinirSenhaPage.tsx
 *
 * Página de destino do link de redefinição de senha (`/redefinir-senha`).
 * O Supabase estabelece automaticamente uma sessão de recuperação a partir do
 * hash da URL (evento PASSWORD_RECOVERY). Aqui o usuário define a nova senha.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { updatePasswordInRecovery } from '../services/auth';
import PasswordInput from '../components/PasswordInput';
import SiteFooter from '../components/SiteFooter';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function RedefinirSenhaPage() {
  useDocumentTitle('Redefinir senha');
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Detecta a sessão de recuperação criada pelo Supabase a partir do link.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    // Caso a sessão já tenha sido estabelecida antes do listener registrar.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setIsSaving(true);
    try {
      await updatePasswordInRecovery(password);
      setDone(true);
      try {
        await supabase.auth.signOut();
      } catch {
        /* best-effort */
      }
      setTimeout(() => {
        navigate('/login', {
          state: { successMessage: 'Senha redefinida com sucesso. Faça login.' },
        });
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
          <img src="/logo.png" alt="FreteGO" className="w-40 h-12 object-contain mx-auto mb-4" />
          <h1 className="text-lg font-bold text-gray-800 text-center mb-1">Redefinir senha</h1>

          {done ? (
            <p className="mt-3 text-sm text-green-600 text-center">
              Senha redefinida com sucesso! Redirecionando para o login...
            </p>
          ) : !ready ? (
            <p className="mt-3 text-xs text-gray-500 text-center">
              Validando o link de redefinição. Se você chegou aqui sem clicar no link do e-mail,
              solicite um novo link na tela de login.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <PasswordInput
                placeholder="Nova senha (mín. 6 caracteres)"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSaving}
                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
              />
              <PasswordInput
                placeholder="Confirmar nova senha"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isSaving}
                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-sm disabled:opacity-50"
              >
                {isSaving ? 'Salvando...' : 'Redefinir senha'}
              </button>
            </form>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
