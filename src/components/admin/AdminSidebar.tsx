/**
 * AdminSidebar - menu lateral do painel admin
 *
 * Topo: FreteGO + avatar + nome (sem hamburguer dentro).
 * Hamburguer fica FORA da sidebar (renderizado no AdminShell).
 */

import { NavLink } from 'react-router-dom';
import { useAdminPermission } from '../../hooks/useAdminPermission';
import { useAdminContext } from './AdminProvider';
import type { AdminAction } from '../../services/admin/permissions';
import { supabase } from '../../services/supabase';

function resolvePhotoSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const { data } = supabase.storage.from('documents').getPublicUrl(value);
  return data.publicUrl ?? null;
}

interface MenuItem {
  to: string;
  label: string;
  icon: string;
  permission?: AdminAction;
  end?: boolean;
}

const ITEMS: MenuItem[] = [
  {
    to: '/admin',
    label: 'Dashboard',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0h6',
    permission: 'DASHBOARD_VIEW',
    end: true,
  },
  {
    to: '/admin/users',
    label: 'Usuarios',
    icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5.13a4 4 0 11-8 0 4 4 0 018 0zm6 3a3 3 0 11-6 0 3 3 0 016 0z',
    permission: 'USER_VIEW',
  },
  { to: '/admin/fretes', label: 'Fretes', icon: 'M5 13l4 4L19 7', permission: 'FRETE_VIEW' },
  // Financeiro (comissão) OCULTO da sidebar a pedido do produto — rota e código
  // permanecem intactos (037), apenas não aparece no menu. Substituído por
  // "Assinaturas" no fluxo de cobrança de motoristas (spec assinaturas-pagamento).
  // {
  //   to: '/admin/financeiro',
  //   label: 'Financeiro',
  //   icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1',
  //   permission: 'FINANCEIRO_VIEW',
  // },
  {
    to: '/admin/assinaturas',
    label: 'Assinaturas',
    icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    permission: 'FINANCEIRO_VIEW',
  },
  {
    to: '/admin/trial',
    label: 'Trial',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    permission: 'USER_VIEW',
  },
  {
    to: '/admin/blacklist',
    label: 'Blacklist',
    icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636',
    permission: 'BLACKLIST_VIEW',
  },
  {
    to: '/admin/crm',
    label: 'CRM',
    icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
    permission: 'CRM_VIEW',
  },
  {
    to: '/admin/marketing',
    label: 'Marketing',
    icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
    permission: 'MARKETING_VIEW',
  },
  {
    to: '/admin/suporte/tickets',
    label: 'Tickets',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    permission: 'SUPORTE_VIEW',
  },
  {
    to: '/admin/suporte/chat',
    label: 'Chat Suporte',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    permission: 'SUPORTE_VIEW',
  },
  {
    to: '/admin/assistant',
    label: 'Assistente',
    icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z',
    permission: 'ASSISTANT_VIEW',
  },
  {
    to: '/admin/settings',
    label: 'Configuracoes',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    permission: 'SETTINGS_VIEW',
  },
  {
    to: '/admin/audit',
    label: 'Auditoria',
    icon: 'M9 12l2 2 4-4M7 8h10M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z',
    permission: 'AUDIT_VIEW',
  },
  {
    to: '/admin/anuncios',
    label: 'Anuncios',
    icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
    permission: 'FINANCEIRO_EDIT',
  },
  {
    to: '/admin/whatsapp',
    label: 'WhatsApp',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    permission: 'SETTINGS_VIEW',
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

function MenuLink({ item }: { item: MenuItem }) {
  const { allowed } = useAdminPermission(item.permission ?? 'USER_VIEW');
  if (item.permission && !allowed) return null;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition ${
          isActive
            ? 'bg-cyan-500/15 text-cyan-300'
            : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-100'
        }`
      }
    >
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
      </svg>
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

export default function AdminSidebar({ open, onClose }: Props) {
  const { session, logout } = useAdminContext();
  const initial = (session?.displayName ?? 'A').charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 z-30 md:hidden transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed md:static z-40 inset-y-0 left-0 w-56 bg-gray-900 border-r border-gray-800 flex flex-col transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full md:hidden'
        }`}
      >
        {/* Topo: avatar + FreteGO/Admin */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 overflow-hidden flex items-center justify-center text-white text-sm font-semibold shrink-0">
            {(() => {
              const src = resolvePhotoSrc(session?.photoUrl);
              return src ? (
                <img
                  src={src}
                  alt="avatar"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                  className="w-full h-full object-cover"
                />
              ) : (
                initial
              );
            })()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 leading-tight">
              FreteGO
            </div>
            <div className="text-[13px] font-semibold text-gray-100 truncate leading-tight">
              {session?.displayName ?? 'Admin'}
            </div>
          </div>
        </div>

        {/* Itens principais */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {ITEMS.map((it) => (
            <MenuLink key={it.to} item={it} />
          ))}
        </nav>

        {/* Rodape: meu perfil + sair */}
        <div className="border-t border-gray-800 p-2 space-y-0.5">
          <NavLink
            to="/admin/perfil"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-300'
                  : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-100'
              }`
            }
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>Meu perfil</span>
          </NavLink>

          <button
            type="button"
            onClick={() => void logout()}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] text-gray-400 hover:bg-red-500/10 hover:text-red-300 transition"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            <span>Sair</span>
          </button>
        </div>
      </aside>
    </>
  );
}
