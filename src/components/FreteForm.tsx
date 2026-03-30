import { useState, useEffect } from 'react';
import { getEstados, getCidades, type Estado, type Cidade } from '../services/ibge';
import { geocodeAddress } from '../services/geolocation';
import type { CreateFreteData } from '../services/fretes';

const VEHICLE_TYPES = [
  { value: 'bitrem_cacamba', label: 'Bitrem Caçamba' },
  { value: 'bitrem_graneleiro', label: 'Bitrem Graneleiro' },
  { value: 'caminhao_simples', label: 'Caminhão Simples' },
  { value: 'ls_4eixo_cavalo', label: 'LS 4º Eixo Cavalo' },
  { value: 'ls_simples_cacamba', label: 'LS Simples Caçamba' },
  { value: 'ls_simples_graneleiro', label: 'LS Simples Graneleiro' },
  { value: 'ls_trucada_6', label: 'LS Trucada 6 eixos' },
  { value: 'ls_trucada_7', label: 'LS Trucada 7 eixos' },
  { value: 'rodotrem_cacamba_25', label: 'Rodotrem Caçamba 25m' },
  { value: 'rodotrem_cacamba_30', label: 'Rodotrem Caçamba 30m' },
  { value: 'rodotrem_graneleiro_25', label: 'Rodotrem Graneleiro 25m' },
  { value: 'rodotrem_graneleiro_30', label: 'Rodotrem Graneleiro 30m' },
  { value: 'rodotrem_graneleiro_198', label: 'Rodotrem Graneleiro 19.8m' },
  { value: 'toco_cacamba', label: 'Toco Caçamba' },
  { value: 'toco_graneleiro', label: 'Toco Graneleiro' },
  { value: 'trucado_graneleiro', label: 'Trucado Graneleiro' },
  { value: 'vanderleia_graneleiro', label: 'Vanderléia Graneleiro' },
];

const CARGO_TYPES = [
  'Carga Geral',
  'Granel',
  'Refrigerada',
  'Perigosa',
  'Frágil',
  'Container',
  'Veículo',
  'Mudança',
  'Soja',
  'Milho',
  'Algodão',
  'Fertilizante',
  'Combustível',
  'Cimento',
  'Madeira',
];

const AGENDAMENTO = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];

interface FreteFormProps {
  embarcadorId: string;
  onSubmit: (data: CreateFreteData) => Promise<void>;
  onCancel?: () => void;
}

export default function FreteForm({ embarcadorId, onSubmit, onCancel }: FreteFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estados, setEstados] = useState<Estado[]>([]);
  const [origemUF, setOrigemUF] = useState('');
  const [origemCidades, setOrigemCidades] = useState<Cidade[]>([]);
  const [origemCidade, setOrigemCidade] = useState('');
  const [origemCidadeFilter, setOrigemCidadeFilter] = useState('');
  const [destinoUF, setDestinoUF] = useState('');
  const [destinoCidades, setDestinoCidades] = useState<Cidade[]>([]);
  const [destinoCidade, setDestinoCidade] = useState('');
  const [destinoCidadeFilter, setDestinoCidadeFilter] = useState('');

  const [cargoType, setCargoType] = useState('');
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);
  const [specifications, setSpecifications] = useState('');
  const [agendamentoCarga, setAgendamentoCarga] = useState('D0');
  const [agendamentoDescarga, setAgendamentoDescarga] = useState('D0');

  useEffect(() => {
    getEstados().then(setEstados).catch(console.error);
  }, []);
  useEffect(() => {
    if (origemUF) {
      getCidades(origemUF).then(setOrigemCidades).catch(console.error);
      setOrigemCidade('');
      setOrigemCidadeFilter('');
    }
  }, [origemUF]);
  useEffect(() => {
    if (destinoUF) {
      getCidades(destinoUF).then(setDestinoCidades).catch(console.error);
      setDestinoCidade('');
      setDestinoCidadeFilter('');
    }
  }, [destinoUF]);

  const toggleVehicle = (value: string) => {
    setSelectedVehicles((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const filteredOrigemCidades = origemCidades.filter((c) =>
    c.nome.toLowerCase().includes(origemCidadeFilter.toLowerCase())
  );
  const filteredDestinoCidades = destinoCidades.filter((c) =>
    c.nome.toLowerCase().includes(destinoCidadeFilter.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!origemUF || !origemCidade) {
      setError('Origem é obrigatória');
      return;
    }
    if (!destinoUF || !destinoCidade) {
      setError('Destino é obrigatório');
      return;
    }
    if (!cargoType) {
      setError('Tipo de carga é obrigatório');
      return;
    }
    if (selectedVehicles.length === 0) {
      setError('Selecione pelo menos um tipo de veículo');
      return;
    }

    setIsSubmitting(true);
    try {
      const originStr = `${origemCidade}, ${origemUF}`;
      const destStr = `${destinoCidade}, ${destinoUF}`;
      let originLoc = { latitude: 0, longitude: 0 };
      let destLoc = { latitude: 0, longitude: 0 };
      try {
        const r = await geocodeAddress(originStr);
        if (r.length > 0) originLoc = r[0].point;
      } catch {
        /* fallback */
      }
      try {
        const r = await geocodeAddress(destStr);
        if (r.length > 0) destLoc = r[0].point;
      } catch {
        /* fallback */
      }

      await onSubmit({
        embarcadorId,
        origin: originStr,
        originLocation: originLoc,
        destination: destStr,
        destinationLocation: destLoc,
        cargoType,
        vehicleType: selectedVehicles.join(', '),
        weight: 0,
        value: 0,
        deadline: new Date(),
        loadingTime: AGENDAMENTO.indexOf(agendamentoCarga),
        unloadingTime: AGENDAMENTO.indexOf(agendamentoDescarga),
        specifications: specifications || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar frete');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Origem */}
      <div className="bg-gray-800 p-4 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white">Origem</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Estado *</label>
            <select
              value={origemUF}
              onChange={(e) => setOrigemUF(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
            >
              <option value="">Selecione</option>
              {estados.map((e) => (
                <option key={e.sigla} value={e.sigla}>
                  {e.sigla} - {e.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Cidade *</label>
            <input
              type="text"
              value={origemCidadeFilter}
              onChange={(e) => {
                setOrigemCidadeFilter(e.target.value);
                setOrigemCidade('');
              }}
              placeholder={origemUF ? 'Digite a cidade...' : 'Selecione o estado'}
              disabled={!origemUF}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 disabled:opacity-50"
            />
            {origemCidadeFilter && !origemCidade && filteredOrigemCidades.length > 0 && (
              <div className="mt-1 max-h-32 overflow-y-auto bg-gray-700 border border-gray-600 rounded-lg">
                {filteredOrigemCidades.slice(0, 10).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setOrigemCidade(c.nome);
                      setOrigemCidadeFilter(c.nome);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600"
                  >
                    {c.nome}
                  </button>
                ))}
              </div>
            )}
            {origemCidade && (
              <p className="mt-1 text-xs text-green-400">
                ✓ {origemCidade}, {origemUF}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Destino */}
      <div className="bg-gray-800 p-4 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white">Destino</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Estado *</label>
            <select
              value={destinoUF}
              onChange={(e) => setDestinoUF(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
            >
              <option value="">Selecione</option>
              {estados.map((e) => (
                <option key={e.sigla} value={e.sigla}>
                  {e.sigla} - {e.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Cidade *</label>
            <input
              type="text"
              value={destinoCidadeFilter}
              onChange={(e) => {
                setDestinoCidadeFilter(e.target.value);
                setDestinoCidade('');
              }}
              placeholder={destinoUF ? 'Digite a cidade...' : 'Selecione o estado'}
              disabled={!destinoUF}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 disabled:opacity-50"
            />
            {destinoCidadeFilter && !destinoCidade && filteredDestinoCidades.length > 0 && (
              <div className="mt-1 max-h-32 overflow-y-auto bg-gray-700 border border-gray-600 rounded-lg">
                {filteredDestinoCidades.slice(0, 10).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setDestinoCidade(c.nome);
                      setDestinoCidadeFilter(c.nome);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600"
                  >
                    {c.nome}
                  </button>
                ))}
              </div>
            )}
            {destinoCidade && (
              <p className="mt-1 text-xs text-green-400">
                ✓ {destinoCidade}, {destinoUF}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tipo de Carga */}
      <div className="bg-gray-800 p-4 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white">Tipo de Carga *</h3>
        <select
          value={cargoType}
          onChange={(e) => setCargoType(e.target.value)}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
        >
          <option value="">Selecione</option>
          {CARGO_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Tipo de Veículo - seleção múltipla */}
      <div className="bg-gray-800 p-4 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white">Tipos de Veículo Aceitos *</h3>
        <p className="text-xs text-gray-400">
          Selecione quais tipos de caminhão podem fazer este frete
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {VEHICLE_TYPES.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => toggleVehicle(v.value)}
              className={`px-3 py-2 text-xs rounded-lg border transition-colors text-left ${
                selectedVehicles.includes(v.value)
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {selectedVehicles.length > 0 && (
          <p className="text-xs text-green-400">{selectedVehicles.length} tipo(s) selecionado(s)</p>
        )}
      </div>

      {/* Agendamento */}
      <div className="bg-gray-800 p-4 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white">Agendamento</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Carga</label>
            <select
              value={agendamentoCarga}
              onChange={(e) => setAgendamentoCarga(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
            >
              {AGENDAMENTO.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Descarga</label>
            <select
              value={agendamentoDescarga}
              onChange={(e) => setAgendamentoDescarga(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
            >
              {AGENDAMENTO.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Especificações */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Especificações Adicionais</label>
        <textarea
          value={specifications}
          onChange={(e) => setSpecifications(e.target.value)}
          rows={3}
          placeholder="Informações adicionais..."
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500"
        />
      </div>

      {/* Botões */}
      <div className="flex justify-end space-x-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-600"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Publicando...' : 'Publicar Frete'}
        </button>
      </div>
    </form>
  );
}
