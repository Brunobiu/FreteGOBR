/**
 * AdminMfaVerifyPage
 */

import { useNavigate } from 'react-router-dom';
import MfaVerifyForm from '../../components/admin/MfaVerifyForm';
import { getAdminSession, markMfaVerified } from '../../services/admin/auth';
import { logAdminAction } from '../../services/admin/audit';

export default function AdminMfaVerifyPage() {
  const navigate = useNavigate();
  const session = getAdminSession();

  if (!session) {
    navigate('/admin/login', { replace: true });
    return null;
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
        <h1 className="text-xl font-semibold mb-1">Verificar MFA</h1>
        <p className="text-xs text-gray-500 mb-5">
          Digite o codigo do app autenticador ou um backup code.
        </p>
        <MfaVerifyForm
          userId={session.userId}
          onSuccess={(usedBackupCode) => {
            // Persiste a flag mfaVerified no localStorage ANTES de navegar.
            markMfaVerified();

            // Audit log em background (não bloqueia navegação)
            void logAdminAction({
              action: 'ADMIN_MFA_VERIFY',
              after: { usedBackupCode },
            }).catch(() => null);

            // Pequeno delay garante que o write em localStorage foi consolidado
            // antes do AdminGuard montar e chamar validateAdminSession().
            // Sem isso, mobile com I/O lento pode ler localStorage antigo
            // e cair em Stealth404 por mfa_required.
            setTimeout(() => {
              navigate('/admin', { replace: true });
            }, 50);
          }}
        />
      </div>
    </main>
  );
}
