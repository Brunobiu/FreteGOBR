import { useState, useEffect } from 'react';
import { getEstados, getCidades, type Estado, type Cidade } from '../services/ibge';
import { geocodeAddress } from '../services/geolocation';
import type { CreateFreteData } from '../services/fretes';

// ─── Constants ────────────────────────────────────────────────────────────────

const CARGO_TYPES = [
  'Carga Geral',
  'Granel Pressurizada',
  'Conteinerizada',
  'Frigorificada ou Aquecida',
  'Granel líquido',
  'Granel sólido',
  'Neogranel',
  'Perigosa',
] as const;

const SPECIES = [
  'Animais', 'Big Bag', 'Bobina', 'Caixas', 'Container', 'Diversos',
  'Fardos', 'Fracionada', 'Granel', 'Metro Cúbico', 'Milheiro',
  'Mudança', 'Paletes', 'Passageiro', 'Sacos', 'Tambor', 'Unidades',
];

const VEHICLE_CATEGORIES = [
  {
    label: 'Leves',
    vehicles: [
      { value: 'vuc', label: 'VUC' },
      { value: 'tres_quartos', label: '3/4' },
      { value: 'fiorino', label: 'Fiorino' },
      { value: 'toco', label: 'Toco' },
    ],
  },
  {
    label: 'Médios',
    vehicles: [
      { value: 'bitruck', label: 'Bitruck' },
      { value: 'truck', label: 'Truck' },
    ],
  },
  {
    label: 'Pesados',
    vehicles: [
      { value: 'bitrem', label: 'Bitrem' },
      { value: 'carreta', label: 'Carreta' },
      { value: 'carreta_4_eixo', label: 'Carreta 4º eixo' },
      { value: 'carreta_ls', label: 'Carreta LS' },
      { value: 'rodotrem', label: 'Rodotrem' },
      { value: 'vanderleia', label: 'Vanderleia' },
    ],
  },
];

const BODY_CATEGORIES = [
  {
    label: 'Fechada',
    bodies: ['Baú', 'Baú Frigorífico', 'Baú Refrigerado', 'Sider'],
  },
  {
    label: 'Aberta',
    bodies: ['Caçamba', 'Grade Baixa', 'Graneleiro', 'Plataforma', 'Prancha'],
  },
  {
    label: 'Especial',
    bodies: [
      'Apenas Cavalo', 'Bug Porta Container', 'Cavaqueira', 'Cegonheiro',
      'Gaiola', 'Hopper', 'Munck', 'Silo', 'Tanque',
    ],
  },
];

const PAYMENT_METHODS = [
  'Pix/Ted', 'Depósito em conta', 'Crédito em cartão', 'Pix', 'Cheque', 'E-frete', 'Outros',
];

const AGENDAMENTO = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];

// ─── Types ────────────────────────────────────────────────────────────────────

interface FreteFormProps {
  embarcadorId: string;
  onSubmit: (data: CreateFreteData & Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RadioGroup({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-4">
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="accent-blue-600"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FreteForm({ embarcadorId, onSubmit, onCancel }: FreteFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Origin / Destination
  const [estados, setEstados] = useState<Estado[]>([]);
  const [origemUF, setOrigemUF] = useState('');
  const [origemCidades, setOrigemCidades] = useState<Cidade[]>([]);
  const [origemCidade, setOrigemCidade] = useState('');
  const [origemCidadeFilter, setOrigemCidadeFilter] = useState('');
  const [destinoUF, setDestinoUF] = useState('');
  const [destinoCidades, setDestinoCidades] = useState<Cidade[]>([]);
  const [destinoCidade, setDestinoCidade] = useState('');
  const [destinoCidadeFilter, setDestinoCidadeFilter] = useState('');

  // Agendamento
  const [agendamentoCarga, setAgendamentoCarga] = useState('D0');
  const [agendamentoDescarga, setAgendamentoDescarga] = useState('D0');

  // Dados da Carga
  const [cargoType, setCargoType] = useState('');
  const [onuNumber, setOnuNumber] = useState('');
  const [temperature, setTemperature] = useState('');
  const [species, setSpecies] = useState('');
  const [product, setProduct] = useState('');

  // Peso e Volume
  const [weightUnit, setWeightUnit] = useState<'toneladas' | 'quilos'>('toneladas');
  const [totalWeight, setTotalWeight] = useState('');
  const [volumes, setVolumes] = useState('');
  const [cubedWeight, setCubedWeight] = useState('');
  const [cubicMeters, setCubicMeters] = useState('');
  const [freightType, setFreightType] = useState<'completa' | 'complemento'>('completa');
  const [occupancyPct, setOccupancyPct] = useState('');

  // Veículos
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);

  // Carrocerias
  const [selectedBodies, setSelectedBodies] = useState<string[]>([]);

  // Opções Adicionais
  const [requiresLona, setRequiresLona] = useState('nao');
  const [requiresTracker, setRequiresTracker] = useState('nao');
  const [requiresInsurance, setRequiresInsurance] = useState('sim');

  // Pagamento
  const [valueKnown, setValueKnown] = useState('a_combinar');
  const [freteValue, setFreteValue] = useState('');
  const [priceCalc, setPriceCalc] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [advancePct, setAdvancePct] = useState('');
  const [observations, setObservations] = useState('');

  // ── Effects ──────────────────────────────────────────────────────────────────

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

  // ── Derived ───────────────────────────────────────────────────────────────────

  const filteredOrigemCidades = origemCidades.filter((c) =>
    c.nome.toLowerCase().includes(origemCidadeFilter.toLowerCase())
  );
  const filteredDestinoCidades = destinoCidades.filter((c) =>
    c.nome.toLowerCase().includes(destinoCidadeFilter.toLowerCase())
  );

  // ── Toggle helpers ────────────────────────────────────────────────────────────

  const toggleVehicle = (value: string) =>
    setSelectedVehicles((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );

  const toggleAllVehicles = (vehicles: { value: string }[]) => {
    const vals = vehicles.map((v) => v.value);
    const allSelected = vals.every((v) => selectedVehicles.includes(v));
    if (allSelected) {
      setSelectedVehicles((prev) => prev.filter((v) => !vals.includes(v)));
    } else {
      setSelectedVehicles((prev) => [...new Set([...prev, ...vals])]);
    }
  };

  const toggleBody = (body: string) =>
    setSelectedBodies((prev) =>
      prev.includes(body) ? prev.filter((b) => b !== body) : [...prev, body]
    );

  const toggleAllBodies = (bodies: string[]) => {
    const allSelected = bodies.every((b) => selectedBodies.includes(b));
    if (allSelected) {
      setSelectedBodies((prev) => prev.filter((b) => !bodies.includes(b)));
    } else {
      setSelectedBodies((prev) => [...new Set([...prev, ...bodies])]);
    }
  };

  const togglePayment = (method: string) =>
    setPaymentMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );

  // ── Submit ────────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!origemUF || !origemCidade) { setError('Origem é obrigatória'); return; }
    if (!destinoUF || !destinoCidade) { setError('Destino é obrigatório'); return; }
    if (!cargoType) { setError('Tipo de carga é obrigatório'); return; }
    if (selectedVehicles.length === 0) { setError('Selecione pelo menos um tipo de veículo'); return; }

    setIsSubmitting(true);
    try {
      const originStr = `${origemCidade}, ${origemUF}`;
      const destStr = `${destinoCidade}, ${destinoUF}`;
      let originLoc = { latitude: 0, longitude: 0 };
      let destLoc = { latitude: 0, longitude: 0 };
      try { const r = await geocodeAddress(originStr); if (r.length > 0) originLoc = r[0].point; } catch { /* fallback */ }
      try { const r = await geocodeAddress(destStr); if (r.length > 0) destLoc = r[0].point; } catch { /* fallback */ }

      await onSubmit({
        embarcadorId,
        origin: originStr,
        originLocation: originLoc,
        destination: destStr,
        destinationLocation: destLoc,
        cargoType,
        vehicleType: selectedVehicles.join(', '),
        weight: totalWeight ? parseFloat(totalWeight) : 0,
        value: freteValue ? parseFloat(freteValue) : 0,
        deadline: new Date(),
        loadingTime: AGENDAMENTO.indexOf(agendamentoCarga),
        unloadingTime: AGENDAMENTO.indexOf(agendamentoDescarga),
        specifications: observations || undefined,
        // Extra fields (new)
        cargo_species: species || undefined,
        product: product || undefined,
        onu_number: cargoType === 'Perigosa' ? onuNumber || undefined : undefined,
        temperature: cargoType === 'Frigorificada ou Aquecida' ? (temperature ? parseFloat(temperature) : undefined) : undefined,
        weight_unit: weightUnit,
        total_weight: totalWeight ? parseFloat(totalWeight) : undefined,
        volumes: volumes ? parseInt(volumes) : undefined,
        cubed_weight: cubedWeight ? parseFloat(cubedWeight) : undefined,
        cubic_meters: cubicMeters ? parseFloat(cubicMeters) : undefined,
        freight_type: freightType,
        occupancy_percentage: freightType === 'complemento' && occupancyPct ? parseInt(occupancyPct) : undefined,
        body_types: selectedBodies.length > 0 ? selectedBodies.join(', ') : undefined,
        requires_lona: requiresLona === 'sim',
        requires_tracker: requiresTracker === 'sim',
        requires_insurance: requiresInsurance === 'sim',
        value_known: valueKnown === 'ja_sei',
        price_calculation: valueKnown === 'ja_sei' ? priceCalc || undefined : undefined,
        payment_methods: paymentMethods.length > 0 ? paymentMethods.join(', ') : undefined,
        advance_percentage: advancePct ? parseInt(advancePct) : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar frete');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ── Origem ── */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Origem</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Estado *</label>
            <select
              value={origemUF}
              onChange={(e) => setOrigemUF(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
            >
              <option value="">Selecione</option>
              {estados.map((e) => (
                <option key={e.sigla} value={e.sigla}>{e.sigla} - {e.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Cidade *</label>
            <input
              type="text"
              value={origemCidadeFilter}
              onChange={(e) => { setOrigemCidadeFilter(e.target.value); setOrigemCidade(''); }}
              placeholder={origemUF ? 'Digite a cidade...' : 'Selecione o estado'}
              disabled={!origemUF}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 disabled:opacity-50"
            />
            {origemCidadeFilter && !origemCidade && filteredOrigemCidades.length > 0 && (
              <div className="mt-1 max-h-32 overflow-y-auto bg-white border border-gray-300 rounded-lg shadow-md">
                {filteredOrigemCidades.slice(0, 10).map((c) => (
                  <button key={c.id} type="button"
                    onClick={() => { setOrigemCidade(c.nome); setOrigemCidadeFilter(c.nome); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                  >{c.nome}</button>
                ))}
              </div>
            )}
            {origemCidade && <p className="mt-1 text-xs text-green-600">✓ {origemCidade}, {origemUF}</p>}
          </div>
        </div>
      </div>

      {/* ── Destino ── */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Destino</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Estado *</label>
            <select
              value={destinoUF}
              onChange={(e) => setDestinoUF(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
            >
              <option value="">Selecione</option>
              {estados.map((e) => (
                <option key={e.sigla} value={e.sigla}>{e.sigla} - {e.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Cidade *</label>
            <input
              type="text"
              value={destinoCidadeFilter}
              onChange={(e) => { setDestinoCidadeFilter(e.target.value); setDestinoCidade(''); }}
              placeholder={destinoUF ? 'Digite a cidade...' : 'Selecione o estado'}
              disabled={!destinoUF}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400 disabled:opacity-50"
            />
            {destinoCidadeFilter && !destinoCidade && filteredDestinoCidades.length > 0 && (
              <div className="mt-1 max-h-32 overflow-y-auto bg-white border border-gray-300 rounded-lg shadow-md">
                {filteredDestinoCidades.slice(0, 10).map((c) => (
                  <button key={c.id} type="button"
                    onClick={() => { setDestinoCidade(c.nome); setDestinoCidadeFilter(c.nome); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                  >{c.nome}</button>
                ))}
              </div>
            )}
            {destinoCidade && <p className="mt-1 text-xs text-green-600">✓ {destinoCidade}, {destinoUF}</p>}
          </div>
        </div>
      </div>

      {/* ── Agendamento ── */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Agendamento</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Carga</label>
            <select value={agendamentoCarga} onChange={(e) => setAgendamentoCarga(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm">
              {AGENDAMENTO.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Descarga</label>
            <select value={agendamentoDescarga} onChange={(e) => setAgendamentoDescarga(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm">
              {AGENDAMENTO.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Dados da Carga ── */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Dados da Carga</h3>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Tipo de carga *</label>
          <select value={cargoType} onChange={(e) => setCargoType(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm">
            <option value="">Selecione</option>
            {CARGO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {cargoType === 'Perigosa' && (
          <div>
            <label className="block text-xs text-gray-600 mb-1">Número ONU</label>
            <input type="text" value={onuNumber} onChange={(e) => setOnuNumber(e.target.value)}
              placeholder="Ex: UN1203"
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
          </div>
        )}

        {cargoType === 'Frigorificada ou Aquecida' && (
          <div>
            <label className="block text-xs text-gray-600 mb-1">Temperatura (°C)</label>
            <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)}
              placeholder="Ex: -18"
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-600 mb-1">Espécie</label>
          <select value={species} onChange={(e) => setSpecies(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm">
            <option value="">Selecione</option>
            {SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Produto</label>
          <input type="text" value={product} onChange={(e) => setProduct(e.target.value)}
            placeholder="Qual produto será carregado? (Ex: Milho, Soja...)"
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
        </div>
      </div>

      {/* ── Peso e Volume ── */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Peso e Volume</h3>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Unidade de medida</label>
          <RadioGroup name="weightUnit"
            options={[{ label: 'Por toneladas', value: 'toneladas' }, { label: 'Por quilos', value: 'quilos' }]}
            value={weightUnit} onChange={(v) => setWeightUnit(v as 'toneladas' | 'quilos')} />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Peso total ({weightUnit === 'toneladas' ? 'ton' : 'kg'})
          </label>
          <input type="number" min="0" step="0.01" value={totalWeight} onChange={(e) => setTotalWeight(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Volumes <span className="text-gray-400">(opcional)</span></label>
            <input type="number" min="0" value={volumes} onChange={(e) => setVolumes(e.target.value)}
              placeholder="Qtd"
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Peso Cubado <span className="text-gray-400">(opcional)</span></label>
            <input type="number" min="0" step="0.01" value={cubedWeight} onChange={(e) => setCubedWeight(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Metragem m³ <span className="text-gray-400">(opcional)</span></label>
            <input type="number" min="0" step="0.01" value={cubicMeters} onChange={(e) => setCubicMeters(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Tipo de frete</label>
          <RadioGroup name="freightType"
            options={[{ label: 'Completa', value: 'completa' }, { label: 'Complemento', value: 'complemento' }]}
            value={freightType} onChange={(v) => setFreightType(v as 'completa' | 'complemento')} />
        </div>

        {freightType === 'complemento' && (
          <div>
            <label className="block text-xs text-gray-600 mb-1">% de ocupação estimada</label>
            <input type="number" min="1" max="100" value={occupancyPct} onChange={(e) => setOccupancyPct(e.target.value)}
              placeholder="Ex: 50"
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
          </div>
        )}
      </div>

      {/* ── Veículos ── */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Tipos de Veículo Aceitos *</h3>
        {VEHICLE_CATEGORIES.map((cat) => {
          const allSelected = cat.vehicles.every((v) => selectedVehicles.includes(v.value));
          return (
            <div key={cat.label}>
              <div className="flex items-center gap-2 mb-1.5">
                <input type="checkbox" id={`cat-${cat.label}`} checked={allSelected}
                  onChange={() => toggleAllVehicles(cat.vehicles)}
                  className="accent-blue-600" />
                <label htmlFor={`cat-${cat.label}`} className="text-xs font-medium text-gray-700 cursor-pointer">
                  Todos os {cat.label}
                </label>
              </div>
              <div className="flex flex-wrap gap-2 pl-5">
                {cat.vehicles.map((v) => (
                  <button key={v.value} type="button" onClick={() => toggleVehicle(v.value)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      selectedVehicles.includes(v.value)
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                    }`}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {selectedVehicles.length > 0 && (
          <p className="text-xs text-green-600">{selectedVehicles.length} tipo(s) selecionado(s)</p>
        )}
      </div>

      {/* ── Carrocerias ── */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Carrocerias</h3>
        {BODY_CATEGORIES.map((cat) => {
          const allSelected = cat.bodies.every((b) => selectedBodies.includes(b));
          return (
            <div key={cat.label}>
              <div className="flex items-center gap-2 mb-1.5">
                <input type="checkbox" id={`body-cat-${cat.label}`} checked={allSelected}
                  onChange={() => toggleAllBodies(cat.bodies)}
                  className="accent-blue-600" />
                <label htmlFor={`body-cat-${cat.label}`} className="text-xs font-medium text-gray-700 cursor-pointer">
                  Todos — {cat.label}
                </label>
              </div>
              <div className="flex flex-wrap gap-2 pl-5">
                {cat.bodies.map((b) => (
                  <button key={b} type="button" onClick={() => toggleBody(b)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      selectedBodies.includes(b)
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                    }`}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Opções Adicionais ── */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Opções Adicionais</h3>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Precisa de lona?</label>
          <RadioGroup name="lona"
            options={[{ label: 'Sim', value: 'sim' }, { label: 'Não', value: 'nao' }]}
            value={requiresLona} onChange={setRequiresLona} />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Precisa de rastreador?</label>
          <RadioGroup name="tracker"
            options={[{ label: 'Sim', value: 'sim' }, { label: 'Não', value: 'nao' }]}
            value={requiresTracker} onChange={setRequiresTracker} />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Terá seguro?</label>
          <RadioGroup name="insurance"
            options={[{ label: 'Sim', value: 'sim' }, { label: 'Não', value: 'nao' }]}
            value={requiresInsurance} onChange={setRequiresInsurance} />
        </div>
      </div>

      {/* ── Dados de Pagamento ── */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Dados de Pagamento</h3>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Informações de valor</label>
          <RadioGroup name="valueKnown"
            options={[{ label: 'Já sei o valor', value: 'ja_sei' }, { label: 'A combinar', value: 'a_combinar' }]}
            value={valueKnown} onChange={setValueKnown} />
        </div>

        {valueKnown === 'ja_sei' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Valor do Frete (R$)</label>
              <input type="number" min="0" step="0.01" value={freteValue} onChange={(e) => setFreteValue(e.target.value)}
                placeholder="0,00"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Cálculo do valor</label>
              <select value={priceCalc} onChange={(e) => setPriceCalc(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm">
                <option value="">Selecione</option>
                <option value="toneladas">Por toneladas</option>
                <option value="quilos">Por quilos</option>
                <option value="total">Total</option>
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-600 mb-2">Forma de pagamento</label>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button key={m} type="button" onClick={() => togglePayment(m)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  paymentMethods.includes(m)
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                }`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Adiantamento % <span className="text-gray-400">(opcional)</span></label>
          <input type="number" min="0" max="100" value={advancePct} onChange={(e) => setAdvancePct(e.target.value)}
            placeholder="Ex: 30"
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Observações <span className="text-gray-400">({observations.length}/500)</span>
          </label>
          <textarea value={observations}
            onChange={(e) => { if (e.target.value.length <= 500) setObservations(e.target.value); }}
            maxLength={500} rows={3}
            placeholder="Informações adicionais..."
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400" />
        </div>
      </div>

      {/* ── Botões ── */}
      <div className="flex justify-end space-x-3">
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="px-5 py-2 bg-gray-200 text-gray-800 text-sm rounded-lg hover:bg-gray-300">
            Cancelar
          </button>
        )}
        <button type="submit" disabled={isSubmitting}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {isSubmitting ? 'Publicando...' : 'Publicar Frete'}
        </button>
      </div>
    </form>
  );
}
