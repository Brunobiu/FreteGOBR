/**
 * AdminLayoutRoute
 *
 * Wrapper que monta o AdminProvider e roteia internamente entre
 * paginas publicas (login, mfa-*) e privadas (atras do AdminGuard
 * + AdminShell).
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { AdminProvider } from './AdminProvider';
import AdminGuard from './AdminGuard';
import AdminShell from './AdminShell';
import Stealth404 from './Stealth404';
import AdminLoginPage from '../../pages/admin/AdminLoginPage';
import AdminMfaSetupPage from '../../pages/admin/AdminMfaSetupPage';
import AdminMfaVerifyPage from '../../pages/admin/AdminMfaVerifyPage';
import AdminDashboardPage from '../../pages/admin/AdminDashboardPage';
import AdminAuditPage from '../../pages/admin/AdminAuditPage';
import AdminProfilePage from '../../pages/admin/AdminProfilePage';
import UsersListPage from '../../pages/admin/users/UsersListPage';
import AdminsListPage from '../../pages/admin/users/AdminsListPage';
import UserDetailPage from '../../pages/admin/users/UserDetailPage';
import FretesListPage from '../../pages/admin/fretes/FretesListPage';
import FreteDetailPage from '../../pages/admin/fretes/FreteDetailPage';
import BlacklistListPage from '../../pages/admin/blacklist/BlacklistListPage';
import BlacklistBulkImportPage from '../../pages/admin/blacklist/BlacklistBulkImportPage';
import BlacklistDetailPage from '../../pages/admin/blacklist/BlacklistDetailPage';
import FinanceiroListPage from '../../pages/admin/financeiro/FinanceiroListPage';
import FinanceiroConfiguracoesPage from '../../pages/admin/financeiro/FinanceiroConfiguracoesPage';
import AdminAnunciosPage from '../../pages/admin/AdminAnunciosPage';
import AdminTicketsPage from '../../pages/admin/AdminTicketsPage';
import AdminTicketDetailPage from '../../pages/admin/AdminTicketDetailPage';
import AdminSupportChatPage from '../../pages/admin/AdminSupportChatPage';

export default function AdminLayoutRoute() {
  return (
    <AdminProvider>
      <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route path="mfa-setup" element={<AdminMfaSetupPage />} />
        <Route path="mfa-verify" element={<AdminMfaVerifyPage />} />
        <Route element={<AdminGuard />}>
          <Route element={<AdminShell />}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="users" element={<UsersListPage />} />
            <Route path="users/admins" element={<AdminsListPage />} />
            <Route path="users/:id" element={<UserDetailPage />} />
            <Route path="fretes" element={<FretesListPage />} />
            <Route path="fretes/:id" element={<FreteDetailPage />} />
            <Route path="blacklist" element={<BlacklistListPage />} />
            <Route path="blacklist/bulk" element={<BlacklistBulkImportPage />} />
            <Route path="blacklist/:id" element={<BlacklistDetailPage />} />
            <Route path="financeiro" element={<FinanceiroListPage />} />
            <Route path="financeiro/configuracoes" element={<FinanceiroConfiguracoesPage />} />
            <Route path="audit" element={<AdminAuditPage />} />
            <Route path="anuncios" element={<AdminAnunciosPage />} />
            <Route
              path="comunicados"
              element={<Navigate to="/admin/anuncios?tab=comunicados" replace />}
            />
            <Route path="suporte/tickets" element={<AdminTicketsPage />} />
            <Route path="suporte/tickets/:id" element={<AdminTicketDetailPage />} />
            <Route path="suporte/chat" element={<AdminSupportChatPage />} />
            <Route path="perfil" element={<AdminProfilePage />} />
          </Route>
        </Route>
        <Route path="*" element={<Stealth404 />} />
      </Routes>
    </AdminProvider>
  );
}
