/**
 * SettingsBlockSkeleton — placeholder de carregamento de uma seção de
 * configurações (módulo /admin/settings). Spec finalizacao-lancamento.
 */

export default function SettingsBlockSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      className="bg-white border border-gray-200 rounded p-4 space-y-3 animate-pulse"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-4 w-40 bg-gray-200 rounded" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-3 w-32 bg-gray-100 rounded" />
          <div className="h-7 flex-1 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  );
}
