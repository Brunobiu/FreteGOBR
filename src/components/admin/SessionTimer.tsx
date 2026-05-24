/**
 * SessionTimer - mostra tempo restante de sessao no header
 */

import { useAdminContext } from './AdminProvider';

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function SessionTimer() {
  const { sessionTimeRemainingMs } = useAdminContext();
  const isWarning = sessionTimeRemainingMs <= 5 * 60 * 1000;
  return (
    <div
      className={`text-xs font-mono px-2 py-1 rounded ${
        isWarning ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-800 text-gray-400'
      }`}
      title="Tempo restante de sessao"
    >
      {formatMs(sessionTimeRemainingMs)}
    </div>
  );
}
