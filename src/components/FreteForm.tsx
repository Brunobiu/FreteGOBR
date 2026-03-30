import { useState, useEffect } from 'react';
import { getEstados, getCidades, type Estado, type Cidade } from '../services/ibge';
import type { CreateFreteData } from '../services/fretes';

const VEHICLE_TYPES = [
  { value: 'truck_34', label: 'Caminhão 3/4', pesoMax: 4000 },
  { value: 'truck_toco', label: 'Caminhão Toco', pesoMax: 8000 },
  { value: 'truck_truck', label: 'Caminhão Truck', pesoMax: 14000 },
  { value: 'bitruck', label: 'Bitruck', pesoMax: 19000 },
  { value: 'carreta_simples', label: 'Carreta Simples', pesoMax: 25000 },
  { value: 'carreta_ls', label: 'Carreta LS', pesoMax: 30000 },
  { value: 'carreta_eixo', label: 'Carreta Eixo Estendido', pesoMax: 33000 },
  { value: 'bitrem', label: 'Bitrem', pesoMax: 37000 },
  { value: 'rodotrem', label: 'Rodotrem', pesoMax: 48000 },
  { value: 'van', label: 'Van / VUC', pesoMax: 1500 },
  { value: 'pickup', label: 'Pickup', pesoMax: 1000 },
];

const AGENDAMENTO_CARGA = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];
const AGENDAMENTO_DESCARGA = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];

interface FreteFormProps {
  embarcadorId: string;
  onSubmit: (data: CreateFreteData) => Promise<void>;
  onCancel?: () => void;
}

export default function FreteForm({ embarcadorId, onSubmit, onCancel }: FreteFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados e cidades
  const [estados, setEstados] = useState<Estado[]>([]);
  const [origemUF, setOrigemUF] = useState('');
  const [origemCidades, setOrigemCidades] = useState<Cidade[]>([]);
  const [origemCidade, setOrigemCidade] = useState('');
  const [destinoUF, setDestinoUF] = useState('');
  const [destinoCidades, setDestinoCidades] = useState<Cidade[]>([]);
  const [destinoCidade, setDestinoCidade] = useState('');

  // Filtro de cidades
  const [origemCidadeFilter, setOrigemCidadeFilter] = useState('');
  const [destinoCidadeFilter, setDestinoCidadeFilter] = useState('');

  // Carga
  const [cargoType, setCargoType] = useState('');
  const [customCargoType, setCustomCargoType] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [weight, setWeight] = useState('');
  const [value, setValue] = useState('');
  const [specifications, setSpecifications] = useState('');

  // Agendamento
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

  // Auto-preenche peso quando seleciona veículo
  useEffect(() => {
    const vt = VEHICLE_TYPES.find((v) => v.value === vehicleType);
    if (vt) setWeight(vt.pesoMax.toString());
  }, [vehicleType]);

  const filteredOrigemCidades = origemCidades.filter((c) =>
    c.nome.toLowerCase().includes(origemCidadeFilter.toLowerCase())
  );
  const filteredDestinoCidades = destinoCidades.filter((c) =>
    c.nome.toLowerCase().includes(destinoCidadeFilter.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalCargoType = cargoType === 'outro' ? customCargoType : cargoType;
    if (!finalCargoType) {
      setError('Tipo de carga é obrigatório');
      return;
    }
    if (!origemUF || !origemCidade) {
      setError('Origem é obrigatória');
      return;
    }
    if (!destinoUF || !destinoCidade) {
      setError('Destino é obrigatório');
      return;
    }
    if (!vehicleType) {
      setError('Tipo de veículo é obrigatório');
      return;
    }
    if (!weight || Number(weight) <= 0) {
      setError('Peso é obrigatório');
      return;
    }
    if (!value || Number(value) <= 0) {
      setError('Valor é obrigatório');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        embarcadorId,
        origin: `${origemCidade}, ${origemUF}`,
        originLocation: { latitude: 0, longitude: 0 },
        destination: `${destinoCidade}, ${destinoUF}`,
        destinationLocation: { latitude: 0, longitude: 0 },
        cargoType: finalCargoType,
        vehicleType,
        weight: Number(weight),
        value: Number(value),
        deadline: new Date(),
        loadingTime: AGENDAMENTO_CARGA.indexOf(agendamentoCarga),
        unloadingTime: AGENDAMENTO_DESCARGA.indexOf(agendamentoDescarga),
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
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              onChange={(e) => setOrigemCidadeFilter(e.target.value)}
              placeholder={origemUF ? 'Digite a cidade...' : 'Selecione o estado'}
              disabled={!origemUF}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
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
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              onChange={(e) => setDestinoCidadeFilter(e.target.value)}
              placeholder={destinoUF ? 'Digite a cidade...' : 'Selecione o estado'}
              disabled={!destinoUF}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
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

      {/* Carga */}
      <div className="bg-gray-800 p-4 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white">Detalhes da Carga</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tipo de Carga *</label>
            <select
              value={cargoType}
              onChange={(e) => setCargoType(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Selecione</option>
              <option value="geral">Carga Geral</option>
              <option value="granel">Granel</option>
              <option value="refrigerada">Refrigerada</option>
              <option value="perigosa">Perigosa</option>
              <option value="fragil">Frágil</option>
              <option value="container">Container</option>
              <option value="veiculo">Veículo</option>
              <option value="mudanca">Mudança</option>
              <option value="outro">Outro (digitar)</option>
            </select>
            {cargoType === 'outro' && (
              <input
                type="text"
                value={customCargoType}
                onChange={(e) => setCustomCargoType(e.target.value)}
                placeholder="Digite o tipo de carga"
                className="mt-2 w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tipo de Veículo *</label>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Selecione</option>
              {VEHICLE_TYPES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label} (até {(v.pesoMax / 1000).toFixed(0)}t)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Peso (kg) *</label>
            <input
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              min={0}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Valor (R$) *</label>
            <input
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              min={0}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Agendamento */}
      <div className="bg-gray-800 p-4 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white">Agendamento</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Agendamento de Carga</label>
            <select
              value={agendamentoCarga}
              onChange={(e) => setAgendamentoCarga(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {AGENDAMENTO_CARGA.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Agendamento de Descarga</label>
            <select
              value={agendamentoDescarga}
              onChange={(e) => setAgendamentoDescarga(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {AGENDAMENTO_DESCARGA.map((a) => (
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
          placeholder="Informações adicionais sobre a carga..."
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
