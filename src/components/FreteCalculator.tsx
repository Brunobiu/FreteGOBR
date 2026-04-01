import { useState, useEffect } from 'react';
import { getEstados, getCidades, type Estado, type Cidade } from '../services/ibge';
import { geocodeAddress } from '../services/geolocation';
import { calcularFrete, type FreteCalcResult } from '../services/calculator';

interface FreteCalculatorProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FreteCalculator({ isOpen, onClose }: FreteCalculatorProps) {
  const [estados, setEstados] = useState<Estado[]>([]);
  const [origemUF, setOrigemUF] = useState('');
  const [origemCidades, setOrigemCidades] = useState<Cidade[]>([]);
  const [origemCidade, setOrigemCidade] = useState('');
  const [origemFilter, setOrigemFilter] = useState('');
  const [destinoUF, setDestinoUF] = useState('');
  const [destinoCidades, setDestinoCidades] = useState<Cidade[]>([]);
  const [destinoCidade, setDestinoCidade] = useState('');
  const [destinoFilter, setDestinoFilter] = useState('');
  const [freteValue, setFreteValue] = useState('');
  const [loadingDays, setLoadingDays] = useState(0);
  const [unloadingDays, setUnloadingDays] = useState(0);
  const [custoKm, setCustoKm] = useState('3.50');
  const [result, setResult] = useState<FreteCalcResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEstados().then(setEstados).catch(console.error);
  }, []);
  useEffect(() => {
    if (origemUF) {
      getCidades(origemUF).then(setOrigemCidades);
      setOrigemCidade('');
      setOrigemFilter('');
    }
  }, [origemUF]);
  useEffect(() => {
    if (destinoUF) {
      getCidades(destinoUF).then(setDestinoCidades);
      setDestinoCidade('');
      setDestinoFilter('');
    }
  }, [destinoUF]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const filteredOrigem = origemCidades.filter((c) =>
    c.nome.toLowerCase().includes(origemFilter.toLowerCase())
  );
  const filteredDestino = destinoCidades.filter((c) =>
    c.nome.toLowerCase().includes(destinoFilter.toLowerCase())
  );

  const handleCalcular = async () => {
    setError(null);
    if (!origemCidade || !destinoCidade) {
      setError('Selecione origem e destino');
      return;
    }
    if (!freteValue || Number(freteValue) <= 0) {
      setError('Informe o valor do frete');
      return;
    }

    setIsCalculating(true);
    try {
      const [origResults, destResults] = await Promise.all([
        geocodeAddress(`${origemCidade}, ${origemUF}`),
        geocodeAddress(`${destinoCidade}, ${destinoUF}`),
      ]);
      if (origResults.length === 0 || destResults.length === 0) {
        setError('Não foi possível localizar as cidades');
        return;
      }

      const calc = calcularFrete({
        origin: origResults[0].point,
        destination: destResults[0].point,
        freteValue: Number(freteValue),
        loadingDays,
        unloadingDays,
        custoKm: Number(custoKm) || undefined,
      });
      setResult(calc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao calcular');
    } finally {
      setIsCalculating(false);
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-75" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-gray-900 rounded-lg max-w-lg w-full border border-gray-800 shadow-xl p-6 max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-white">Calculadora de Frete</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            {/* Origem */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Origem - Estado</label>
                <select
                  value={origemUF}
                  onChange={(e) => setOrigemUF(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                >
                  <option value="">UF</option>
                  {estados.map((e) => (
                    <option key={e.sigla} value={e.sigla}>
                      {e.sigla}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Cidade</label>
                <input
                  type="text"
                  value={origemFilter}
                  onChange={(e) => {
                    setOrigemFilter(e.target.value);
                    setOrigemCidade('');
                  }}
                  placeholder="Cidade"
                  disabled={!origemUF}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm disabled:opacity-50"
                />
                {origemFilter && !origemCidade && filteredOrigem.length > 0 && (
                  <div className="mt-1 max-h-24 overflow-y-auto bg-gray-800 border border-gray-700 rounded">
                    {filteredOrigem.slice(0, 8).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setOrigemCidade(c.nome);
                          setOrigemFilter(c.nome);
                        }}
                        className="w-full text-left px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                      >
                        {c.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Destino */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Destino - Estado</label>
                <select
                  value={destinoUF}
                  onChange={(e) => setDestinoUF(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                >
                  <option value="">UF</option>
                  {estados.map((e) => (
                    <option key={e.sigla} value={e.sigla}>
                      {e.sigla}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Cidade</label>
                <input
                  type="text"
                  value={destinoFilter}
                  onChange={(e) => {
                    setDestinoFilter(e.target.value);
                    setDestinoCidade('');
                  }}
                  placeholder="Cidade"
                  disabled={!destinoUF}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm disabled:opacity-50"
                />
                {destinoFilter && !destinoCidade && filteredDestino.length > 0 && (
                  <div className="mt-1 max-h-24 overflow-y-auto bg-gray-800 border border-gray-700 rounded">
                    {filteredDestino.slice(0, 8).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setDestinoCidade(c.nome);
                          setDestinoFilter(c.nome);
                        }}
                        className="w-full text-left px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                      >
                        {c.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Valor + Custo/km */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Valor do Frete (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={freteValue}
                  onChange={(e) => setFreteValue(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Custo/km (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={custoKm}
                  onChange={(e) => setCustoKm(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                />
              </div>
            </div>

            {/* Agendamento */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Carga (dias)</label>
                <select
                  value={loadingDays}
                  onChange={(e) => setLoadingDays(Number(e.target.value))}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                >
                  {[0, 1, 2, 3, 4, 5].map((d) => (
                    <option key={d} value={d}>
                      D{d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Descarga (dias)</label>
                <select
                  value={unloadingDays}
                  onChange={(e) => setUnloadingDays(Number(e.target.value))}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                >
                  {[0, 1, 2, 3, 4, 5].map((d) => (
                    <option key={d} value={d}>
                      D{d}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              onClick={handleCalcular}
              disabled={isCalculating}
              className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isCalculating ? 'Calculando...' : 'Calcular'}
            </button>

            {/* Resultado */}
            {result && (
              <div className="bg-gray-800 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white mb-2">Resultado</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Distância</p>
                    <p className="text-white font-medium">
                      {result.distanceKm.toLocaleString('pt-BR')} km
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Dias de viagem</p>
                    <p className="text-white font-medium">{result.travelDays} dia(s)</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Dias totais</p>
                    <p className="text-white font-medium">{result.totalDays} dia(s)</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Custo estimado</p>
                    <p className="text-red-400 font-medium">
                      {formatCurrency(result.custoEstimado)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Lucro líquido</p>
                    <p
                      className={`font-bold ${result.lucroLiquido >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {formatCurrency(result.lucroLiquido)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Lucro/dia</p>
                    <p
                      className={`font-bold ${result.lucroPorDia >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {formatCurrency(result.lucroPorDia)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
