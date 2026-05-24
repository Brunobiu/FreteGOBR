/**
 * AdminMfaSetupPage - configura MFA no primeiro acesso
 */

import { useNavigate } from 'react-router-dom';
import MfaSetupForm from '../../components/admin/MfaSetupForm';
import { getAdminSession, markMfaVerified } from '../../services/admin/auth';

export default function AdminMfaSetupPage() {
  const navigate = useNavigate();
  const session = getAdminSession();

  if (!session) {
    navigate('/admin/login', { replace: true });
    return null;
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
        <h1 className="text-xl font-semibold mb-1">Configurar MFA</h1>
        <p className="text-xs text-gray-500 mb-5">
          Escaneie o QR code no Google Authenticator, Authy ou app compatible e digite o codigo
          gerado.
        </p>
        <MfaSetupForm
          username={session.username}
          onComplete={() => {
            markMfaVerified();
            navigate('/admin', { replace: true });
          }}
        />
      </div>
    </main>
  );
}
