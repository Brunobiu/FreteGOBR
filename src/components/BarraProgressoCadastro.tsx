interface BarraProgressoCadastroProps {
  percent: number;
  missing: string[];
}

/**
 * Barra de progresso do onboarding do embarcador.
 * Cor: vermelha < 50%, amarela < 100%, verde = 100%.
 */
export function BarraProgressoCadastro({ percent, missing }: BarraProgressoCadastroProps) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));

  const colorClass =
    safePercent >= 100 ? 'bg-green-500' : safePercent >= 50 ? 'bg-yellow-500' : 'bg-red-500';

  const textColor =
    safePercent >= 100 ? 'text-green-700' : safePercent >= 50 ? 'text-yellow-700' : 'text-red-700';

  return (
    <div className="w-full bg-white border border-gray-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">Progresso do cadastro</span>
        <span className={`text-sm font-semibold ${textColor}`}>{safePercent}% completo</span>
      </div>
      <div
        className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={safePercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-2 ${colorClass} transition-all duration-300`}
          style={{ width: `${safePercent}%` }}
        />
      </div>

      {missing.length > 0 && (
        <ul className="mt-3 text-xs text-gray-600 list-disc list-inside space-y-1">
          {missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {missing.length === 0 && (
        <p className="mt-3 text-xs text-green-700 font-medium">
          ✓ Cadastro completo. Você já pode postar fretes.
        </p>
      )}
    </div>
  );
}

export default BarraProgressoCadastro;
