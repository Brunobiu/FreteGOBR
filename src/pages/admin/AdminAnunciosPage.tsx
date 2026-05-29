import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminBannersPanel from '../../components/admin/anuncios/AdminBannersPanel';
import AdminCommoditiesPanel from '../../components/admin/anuncios/AdminCommoditiesPanel';
import AdminBroadcastPanel from '../../components/admin/anuncios/AdminBroadcastPanel';

type Tab = 'anuncios' | 'commodities' | 'comunicados';

/**
 * Página admin de Anúncios — agora com 3 abas:
 *  - Anúncios: banners do carrossel principal
 *  - Categorias: commodities exibidas no carrossel horizontal do motorista
 *  - Comunicados: avisos broadcast enviados aos usuários
 *
 * Aceita ?tab= no querystring para deep-link (ex: vindo de /admin/comunicados).
 */
export default function AdminAnunciosPage() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) ?? 'anuncios';
  const [tab, setTab] = useState<Tab>(
    initialTab === 'commodities' || initialTab === 'comunicados' ? initialTab : 'anuncios'
  );

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Anúncios</h1>
        <p className="text-sm text-gray-400 mt-1">
          Gerencie banners, categorias e comunicados do app.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700 mb-5 flex gap-1">
        <TabButton
          label="Anúncios"
          active={tab === 'anuncios'}
          onClick={() => setTab('anuncios')}
        />
        <TabButton
          label="Categorias"
          active={tab === 'commodities'}
          onClick={() => setTab('commodities')}
        />
        <TabButton
          label="Comunicados"
          active={tab === 'comunicados'}
          onClick={() => setTab('comunicados')}
        />
      </div>

      {tab === 'anuncios' && <AdminBannersPanel />}
      {tab === 'commodities' && <AdminCommoditiesPanel />}
      {tab === 'comunicados' && <AdminBroadcastPanel />}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors -mb-px border-b-2 ${
        active
          ? 'text-green-400 border-green-500 bg-gray-800/50'
          : 'text-gray-400 border-transparent hover:text-gray-200 hover:border-gray-600'
      }`}
    >
      {label}
    </button>
  );
}
