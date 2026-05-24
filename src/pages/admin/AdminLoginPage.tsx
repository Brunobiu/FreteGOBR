/**
 * AdminLoginPage
 *
 * Login admin via username (nao telefone). Usa lockout admin
 * (prefixo admin:username:). Tempo minimo de 500ms em qualquer
 * resposta de falha (delegado ao loginAdmin).
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginAdmin } from '../../services/admin/auth';
import { logAdminAction } from '../../services/admin/audit';
import {
  checkAdminLockout,
  recordAdminAttempt,
  getAdminLockoutMessage,
} from '../../services/admin/bruteForce';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutMsg, setLockoutMsg] = useState<string | null>(null);

  // Pre-checa lockout ao mudar username
  useEffect(() => {
    if (!username) {
      setLockoutMsg(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const status = await checkAdminLockout(username);
      if (cancelled) return;
      if (status.isLocked && status.lockedUntil) {
        setLockoutMsg(getAdminLockoutMessage(status.lockedUntil));
      } else {
        setLockoutMsg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lock = await checkAdminLockout(username);
      if (lock.isLocked && lock.lockedUntil) {
        setError(getAdminLockoutMessage(lock.lockedUntil));
        return;
      }

      const result = await loginAdmin(username, password);
      if (result.step === 'denied') {
        await recordAdminAttempt(username, '0.0.0.0', false);
        await logAdminAction({
          action: 'ADMIN_LOGIN_FAILURE',
          targetType: 'username',
          targetId: username,
          after: { reason: result.reason },
        }).catch(() => null);
        setError('Credenciais invalidas');
        return;
      }
      await recordAdminAttempt(username, '0.0.0.0', true);
      await logAdminAction({
        action: 'ADMIN_LOGIN_SUCCESS',
        targetType: 'username',
        targetId: username,
      }).catch(() => null);
      navigate(result.step === 'mfa-setup' ? '/admin/mfa-setup' : '/admin/mfa-verify', {
        replace: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4"
      >
        <div className="text-center">
          <div className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-300 border border-red-500/30 mb-3">
            Acesso Admin
          </div>
          <h1 className="text-xl font-semibold">Painel Administrativo</h1>
          <p className="text-xs text-gray-500 mt-1">Acesso restrito</p>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Usuario</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-cyan-500"
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-cyan-500"
            autoComplete="current-password"
            required
          />
        </div>

        {(error || lockoutMsg) && <div className="text-sm text-red-400">{lockoutMsg ?? error}</div>}

        <button
          type="submit"
          disabled={busy || !!lockoutMsg}
          className="w-full px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition"
        >
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
