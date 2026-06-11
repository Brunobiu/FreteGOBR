import { useState } from 'react';
import AdminTutorialsPanel from '../../components/admin/tutoriais/AdminTutorialsPanel';
import type { TutorialAudience } from '../../services/tutorials';

/**
 * Página admin de Tutoriais — duas abas (motorista / embarcador). Em cada aba
 * o admin gerencia os vídeos exibidos no Tutorial daquele público.
 */
export default function AdminTutoriaisPage() {
  const [tab, setTab] = useState<TutorialAudience>('motorista');

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Tutoriais</h1>
        <p className="text-sm text-gray-400 mt-1">
          Adicione vídeos (link do YouTube ou arquivo) que aparecem no Tutorial de cada público.
        </p>
      </div>

      <div className="border-b border-gray-700 mb-5 flex gap-1">
        <TabButton
          label="Motorista"
          active={tab === 'motorista'}
          onClick={() => setTab('motorista')}
        />
        <TabButton
          label="Embarcador"
          active={tab === 'embarcador'}
          onClick={() => setTab('embarcador')}
        />
      </div>

      {/* key força remontagem ao trocar de aba (recarrega a lista certa). */}
      <AdminTutorialsPanel key={tab} audience={tab} />
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
