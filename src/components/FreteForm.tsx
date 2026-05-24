import { useState, useEffect, useRef } from 'react';
import { getEstados, getCidades, type Estado, type Cidade } from '../services/ibge';
import {
  geocodeAddress,
  calculateRouteDistance,
  calculateDistance,
} from '../services/geolocation';
import type { CreateFreteData } from '../services/fretes';
import { parseCoordInput } from '../utils/coordParser';
import PublishingOverlay from './PublishingOverlay';

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
  'Animais',
  'Big Bag',
  'Bobina',
  'Caixas',
  'Container',
  'Diversos',
  'Fardos',
  'Fracionada',
  'Granel',
  'Metro Cúbico',
  'Milheiro',
  'Mudança',
  'Paletes',
  'Passageiro',
  'Sacos',
  'Tambor',
  'Unidades',
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
      'Apenas Cavalo',
      'Bug Porta Container',
      'Cavaqueira',
      'Cegonheiro',
      'Gaiola',
      'Hopper',
      'Munck',
      'Silo',
      'Tanque',
    ],
  },
];

const PAYMENT_METHODS = [
  'Pix/Ted',
  'Depósito em conta',
  'Crédito em cartão',
  'Pix',
  'Cheque',
  'E-frete',
  'Outros',
];

const AGENDAMENTO = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];

// ─── Types ────────────────────────────────────────────────────────────────────

interface FreteFormProps {
  embarcadorId: string;
  onSubmit: (data: CreateFreteData & Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  /**
   * Quando presente, o form abre em modo de edição com os campos pré-preenchidos
   * e o submit invoca onSubmit com `id` extra para identificar o registro.
   */
  initialFrete?: import('../services/fretes').Frete;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formata uma string de dígitos (centavos) como moeda BRL.
 * "300"     -> "R$ 3,00"
 * "30000"   -> "R$ 300,00"
 * "150050"  -> "R$ 1.500,50"
 */
function formatBRL(digits: string): string {
  if (!digits) return '';
  const padded = digits.padStart(3, '0');
  const reais = padded.slice(0, -2);
  const cents = padded.slice(-2);
  const formatted = reais.replace(/^0+/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${formatted || '0'},${cents}`;
}

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
        <label
          key={opt.value}
          className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700"
        >
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

export default function FreteForm({
  embarcadorId,
  onSubmit,
  onCancel,
  initialFrete,
}: FreteFormProps) {
  const isEditing = !!initialFrete;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Origin / Destination
  const [estados, setEstados] = useState<Estado[]>([]);
  const [origemUF, setOrigemUF] = useState('');
  const [origemUFFilter, setOrigemUFFilter] = useState('');
  const [origemCidades, setOrigemCidades] = useState<Cidade[]>([]);
  const [origemCidade, setOrigemCidade] = useState('');
  const [origemCidadeFilter, setOrigemCidadeFilter] = useState('');
  const [destinoUF, setDestinoUF] = useState('');
  const [destinoUFFilter, setDestinoUFFilter] = useState('');
  const [destinoCidades, setDestinoCidades] = useState<Cidade[]>([]);
  const [destinoCidade, setDestinoCidade] = useState('');
  const [destinoCidadeFilter, setDestinoCidadeFilter] = useState('');

  // Detalhes de carregamento e entrega — texto livre exibido apenas no
  // modal do motorista (não no card resumido). Migration 019.
  const [originDetail, setOriginDetail] = useState('');
  const [destinationDetail, setDestinationDetail] = useState('');
  // Coordenadas opcionais (Migration 020). O usuário pode colar uma URL
  // do Google Maps ou um par "lat, lng" — usamos `parseCoordInput` para
  // normalizar.
  const [originCoordInput, setOriginCoordInput] = useState('');
  const [destinationCoordInput, setDestinationCoordInput] = useState('');
  const [originCoordError, setOriginCoordError] = useState<string | null>(null);
  const [destinationCoordError, setDestinationCoordError] = useState<string | null>(null);

  // Distância calculada (km) — preenchida automaticamente após escolher
  // origem e destino. null = ainda não calculada; 0+ = valor real.
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [calculatingDistance, setCalculatingDistance] = useState(false);

  // Agendamento (removido da UI; mantido como placeholder para o submit)
  const agendamentoCarga = 'D0';
  const agendamentoDescarga = 'D0';

  // Dados da Carga
  const [cargoType, setCargoType] = useState('');
  const [cargoTypeOpen, setCargoTypeOpen] = useState(false);
  const [onuNumber, setOnuNumber] = useState('');
  const [temperature, setTemperature] = useState('');
  const [species, setSpecies] = useState('');
  const [speciesOpen, setSpeciesOpen] = useState(false);
  const [product, setProduct] = useState('');

  // Peso e Volume
  const [weightUnit, setWeightUnit] = useState<'toneladas' | 'quilos'>('toneladas');
  const [freightType, setFreightType] = useState<
    'completa' | 'complemento' | 'peso_balanca' | 'caixote_cheio'
  >('completa');
  const [occupancyPct, setOccupancyPct] = useState('');
  // Campos removidos da UI mas mantidos no submit como placeholders.
  const totalWeight = '';

  // Veículos
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);

  // Carrocerias
  const [selectedBodies, setSelectedBodies] = useState<string[]>([]);

  // Opções Adicionais
  const [requiresLona, setRequiresLona] = useState('nao');
  const [requiresTracker, setRequiresTracker] = useState('nao');
  const [requiresInsurance, setRequiresInsurance] = useState('nao');

  // Pagamento
  const [valueKnown, setValueKnown] = useState('ja_sei');
  const [freteValue, setFreteValue] = useState('');
  const [priceCalc, setPriceCalc] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [advancePct, setAdvancePct] = useState('');
  const [observations, setObservations] = useState('');

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    getEstados().then(setEstados).catch(console.error);
  }, []);

  // Preenche os campos quando `initialFrete` é fornecido (modo edição).
  useEffect(() => {
    if (!initialFrete) return;
    const f = initialFrete;

    // Parse "Cidade, UF"
    const parseLocation = (s: string) => {
      const parts = s.split(',').map((p) => p.trim());
      if (parts.length >= 2) {
        return { city: parts[0], uf: parts[parts.length - 1] };
      }
      return { city: s, uf: '' };
    };
    const origin = parseLocation(f.origin);
    const destination = parseLocation(f.destination);
    setOrigemUF(origin.uf);
    setOrigemUFFilter(origin.uf);
    setOrigemCidade(origin.city);
    setOrigemCidadeFilter(origin.city);
    setDestinoUF(destination.uf);
    setDestinoUFFilter(destination.uf);
    setDestinoCidade(destination.city);
    setDestinoCidadeFilter(destination.city);
    setOriginDetail(f.originDetail ?? '');
    setDestinationDetail(f.destinationDetail ?? '');
    setOriginCoordInput(
      f.originPinnedLat !== undefined && f.originPinnedLng !== undefined
        ? `${f.originPinnedLat}, ${f.originPinnedLng}`
        : ''
    );
    setDestinationCoordInput(
      f.destinationPinnedLat !== undefined && f.destinationPinnedLng !== undefined
        ? `${f.destinationPinnedLat}, ${f.destinationPinnedLng}`
        : ''
    );

    setCargoType(f.cargoType ?? '');
    setProduct(f.product ?? '');
    setSpecies(f.cargoSpecies ?? '');
    setOnuNumber(f.onuNumber ?? '');
    setTemperature(f.temperature !== undefined ? String(f.temperature) : '');

    if (f.vehicleType) {
      setSelectedVehicles(
        f.vehicleType
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      );
    }
    if (f.bodyTypes) {
      setSelectedBodies(
        f.bodyTypes
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean)
      );
    }

    setWeightUnit((f.weightUnit as 'toneladas' | 'quilos') ?? 'toneladas');
    setFreightType(
      (f.freightType as 'completa' | 'complemento' | 'peso_balanca' | 'caixote_cheio') ??
        'completa'
    );
    setOccupancyPct(f.occupancyPercentage !== undefined ? String(f.occupancyPercentage) : '');

    setRequiresLona(f.requiresLona ? 'sim' : 'nao');
    setRequiresTracker(f.requiresTracker ? 'sim' : 'nao');
    setRequiresInsurance(f.requiresInsurance ? 'sim' : 'nao');

    setValueKnown(f.valueKnown === false ? 'a_combinar' : 'ja_sei');
    if (f.value) {
      setFreteValue(Math.round(f.value * 100).toString());
    }
    setPriceCalc(f.priceCalculation ?? '');

    if (f.paymentMethods) {
      setPaymentMethods(
        f.paymentMethods
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      );
    }
    setAdvancePct(f.advancePercentage !== undefined ? String(f.advancePercentage) : '');

    setObservations(f.specifications ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFrete?.id]);

  // Refs para evitar que o useEffect de UF zere a cidade quando o UF foi
  // setado pelo modo edição (e a cidade já veio junto).
  const prevOrigemUF = useRef('');
  const prevDestinoUF = useRef('');

  // Refs para auto-foco entre os campos principais.
  const origemCidadeRef = useRef<HTMLInputElement | null>(null);
  const destinoUFRef = useRef<HTMLInputElement | null>(null);
  const destinoCidadeRef = useRef<HTMLInputElement | null>(null);
  const cargoTypeRef = useRef<HTMLButtonElement | null>(null);
  const speciesRef = useRef<HTMLButtonElement | null>(null);
  const productRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (origemUF) {
      getCidades(origemUF).then(setOrigemCidades).catch(console.error);
      // Só zera a cidade se o usuário trocou de UF (não na primeira carga)
      if (prevOrigemUF.current && prevOrigemUF.current !== origemUF) {
        setOrigemCidade('');
        setOrigemCidadeFilter('');
      }
      prevOrigemUF.current = origemUF;
    }
  }, [origemUF]);

  useEffect(() => {
    if (destinoUF) {
      getCidades(destinoUF).then(setDestinoCidades).catch(console.error);
      if (prevDestinoUF.current && prevDestinoUF.current !== destinoUF) {
        setDestinoCidade('');
        setDestinoCidadeFilter('');
      }
      prevDestinoUF.current = destinoUF;
    }
  }, [destinoUF]);

  // Calcula a distância da rota cidade→cidade (sempre, baseado no centro
  // geográfico de cada cidade).
  useEffect(() => {
    if (!origemCidade || !destinoCidade || !origemUF || !destinoUF) {
      setDistanceKm(null);
      return;
    }

    let cancelled = false;
    setCalculatingDistance(true);

    (async () => {
      try {
        const [oRes, dRes] = await Promise.all([
          geocodeAddress(`${origemCidade}, ${origemUF}`),
          geocodeAddress(`${destinoCidade}, ${destinoUF}`),
        ]);
        if (cancelled) return;
        const o = oRes[0]?.point;
        const d = dRes[0]?.point;
        if (!o || !d) {
          setDistanceKm(null);
          return;
        }
        const km = await calculateRouteDistance(o, d);
        if (cancelled) return;
        if (km !== null) {
          setDistanceKm(km);
        } else {
          setDistanceKm(Math.round(calculateDistance(o, d)));
        }
      } catch {
        if (!cancelled) setDistanceKm(null);
      } finally {
        if (!cancelled) setCalculatingDistance(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [origemCidade, destinoCidade, origemUF, destinoUF]);

  // ── Derived ───────────────────────────────────────────────────────────────────

  // Normaliza removendo acentos para que o filtro encontre "Goiânia"
  // mesmo digitando "goiania".
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');

  const filteredOrigemCidades = origemCidades.filter((c) =>
    normalize(c.nome).includes(normalize(origemCidadeFilter))
  );
  const filteredDestinoCidades = destinoCidades.filter((c) =>
    normalize(c.nome).includes(normalize(destinoCidadeFilter))
  );

  const filteredOrigemEstados = estados.filter(
    (e) =>
      normalize(e.sigla).includes(normalize(origemUFFilter)) ||
      normalize(e.nome).includes(normalize(origemUFFilter))
  );
  const filteredDestinoEstados = estados.filter(
    (e) =>
      normalize(e.sigla).includes(normalize(destinoUFFilter)) ||
      normalize(e.nome).includes(normalize(destinoUFFilter))
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

  // Erros por campo. A chave é o id do campo; o valor é a mensagem.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Limpa o erro de um campo específico quando ele passa a ser válido.
  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Valida campos individuais reativamente (some o vermelho ao preencher)
  useEffect(() => {
    if (origemUF) clearFieldError('origemUF');
  }, [origemUF]);
  useEffect(() => {
    if (origemCidade) clearFieldError('origemCidade');
  }, [origemCidade]);
  useEffect(() => {
    if (destinoUF) clearFieldError('destinoUF');
  }, [destinoUF]);
  useEffect(() => {
    if (destinoCidade) clearFieldError('destinoCidade');
  }, [destinoCidade]);
  useEffect(() => {
    if (cargoType) clearFieldError('cargoType');
  }, [cargoType]);
  useEffect(() => {
    if (species) clearFieldError('species');
  }, [species]);
  useEffect(() => {
    if (product.trim()) clearFieldError('product');
  }, [product]);
  useEffect(() => {
    if (selectedVehicles.length > 0) clearFieldError('vehicles');
  }, [selectedVehicles]);
  useEffect(() => {
    if (selectedBodies.length > 0) clearFieldError('bodies');
  }, [selectedBodies]);
  useEffect(() => {
    if (freteValue) clearFieldError('freteValue');
  }, [freteValue]);
  useEffect(() => {
    if (priceCalc) clearFieldError('priceCalc');
  }, [priceCalc]);
  useEffect(() => {
    if (paymentMethods.length > 0) clearFieldError('paymentMethods');
  }, [paymentMethods]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const errs: Record<string, string> = {};
    if (!origemUF) errs.origemUF = 'Selecione o estado';
    if (!origemCidade) errs.origemCidade = 'Selecione a cidade';
    if (!destinoUF) errs.destinoUF = 'Selecione o estado';
    if (!destinoCidade) errs.destinoCidade = 'Selecione a cidade';
    if (!cargoType) errs.cargoType = 'Selecione o tipo de carga';
    if (!species) errs.species = 'Selecione a espécie';
    if (!product.trim()) errs.product = 'Informe o produto';
    if (selectedVehicles.length === 0) errs.vehicles = 'Selecione pelo menos um tipo de veículo';
    if (selectedBodies.length === 0) errs.bodies = 'Selecione pelo menos um tipo de carroceria';
    if (valueKnown === 'ja_sei') {
      if (!freteValue) errs.freteValue = 'Informe o valor do frete';
      if (!priceCalc) errs.priceCalc = 'Selecione como o valor é calculado';
    }
    if (paymentMethods.length === 0)
      errs.paymentMethods = 'Selecione pelo menos uma forma de pagamento';

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError('Verifique os campos destacados em vermelho.');
      return;
    }

    // Parse das coordenadas opcionais (Migration 020). Se inválidas,
    // bloqueia o submit e foca o erro inline.
    const originPinned = originCoordInput.trim()
      ? parseCoordInput(originCoordInput)
      : null;
    const destinationPinned = destinationCoordInput.trim()
      ? parseCoordInput(destinationCoordInput)
      : null;
    if (originCoordInput.trim() && !originPinned) {
      setOriginCoordError('Link inválido. Cole um link do Google Maps.');
      setError('Verifique o link de origem.');
      return;
    } else {
      setOriginCoordError(null);
    }
    if (destinationCoordInput.trim() && !destinationPinned) {
      setDestinationCoordError('Link inválido. Cole um link do Google Maps.');
      setError('Verifique o link de destino.');
      return;
    } else {
      setDestinationCoordError(null);
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
        ...(isEditing && initialFrete ? { id: initialFrete.id } : {}),
        embarcadorId,
        origin: originStr,
        originLocation: originLoc,
        destination: destStr,
        destinationLocation: destLoc,
        cargoType,
        product: product || undefined,
        cargoSpecies: species || undefined,
        vehicleType: selectedVehicles.join(', '),
        weight: totalWeight ? parseFloat(totalWeight) : 0,
        // freteValue é guardado em centavos (string de dígitos). Convertemos
        // para reais com 2 casas decimais antes de enviar.
        value: freteValue ? parseInt(freteValue) / 100 : 0,
        deadline: new Date(),
        loadingTime: AGENDAMENTO.indexOf(agendamentoCarga),
        unloadingTime: AGENDAMENTO.indexOf(agendamentoDescarga),
        specifications: observations || undefined,
        // Campos estendidos
        onuNumber: cargoType === 'Perigosa' ? onuNumber || undefined : undefined,
        temperature:
          cargoType === 'Frigorificada ou Aquecida' && temperature
            ? parseFloat(temperature)
            : undefined,
        weightUnit,
        freightType,
        occupancyPercentage:
          freightType === 'complemento' && occupancyPct ? parseInt(occupancyPct) : undefined,
        bodyTypes: selectedBodies.length > 0 ? selectedBodies.join(', ') : undefined,
        requiresLona: requiresLona === 'sim',
        requiresTracker: requiresTracker === 'sim',
        requiresInsurance: requiresInsurance === 'sim',
        valueKnown: valueKnown === 'ja_sei',
        priceCalculation: valueKnown === 'ja_sei' ? priceCalc || undefined : undefined,
        paymentMethods: paymentMethods.length > 0 ? paymentMethods.join(', ') : undefined,
        advancePercentage: advancePct ? parseInt(advancePct) : undefined,
        distanceKm: distanceKm ?? undefined,
        originDetail: originDetail.trim() || undefined,
        destinationDetail: destinationDetail.trim() || undefined,
        originPinnedLat: originPinned?.latitude,
        originPinnedLng: originPinned?.longitude,
        destinationPinnedLat: destinationPinned?.latitude,
        destinationPinnedLng: destinationPinned?.longitude,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar frete');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <PublishingOverlay
        open={isSubmitting}
        message={isEditing ? 'Atualizando frete...' : 'Publicando frete...'}
      />
      <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ── Origem + Destino (compactado, com detalhes) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Origem */}
        <div className="bg-white border border-blue-200 rounded-lg p-3 space-y-2 relative">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-blue-700 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-600"></span> Origem
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">Estado *</label>
              <div className="relative">
                <input
                  type="text"
                  value={origemUFFilter}
                  onChange={(e) => {
                    setOrigemUFFilter(e.target.value);
                    setOrigemUF('');
                    setOrigemCidade('');
                    setOrigemCidadeFilter('');
                  }}
                  placeholder="UF"
                  className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {origemUFFilter && !origemUF && filteredOrigemEstados.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 max-h-40 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg z-30">
                    {filteredOrigemEstados.slice(0, 30).map((e) => (
                      <button
                        key={e.sigla}
                        type="button"
                        onClick={() => {
                          setOrigemUF(e.sigla);
                          setOrigemUFFilter(`${e.sigla} - ${e.nome}`);
                          setTimeout(() => origemCidadeRef.current?.focus(), 0);
                        }}
                        className="w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-blue-50"
                      >
                        {e.sigla} - {e.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {fieldErrors.origemUF && (
                <p className="mt-0.5 text-[10px] text-red-600">{fieldErrors.origemUF}</p>
              )}
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">Cidade *</label>
              <div className="relative">
                <input
                  ref={origemCidadeRef}
                  type="text"
                  value={origemCidadeFilter}
                  onChange={(e) => {
                    setOrigemCidadeFilter(e.target.value);
                    setOrigemCidade('');
                  }}
                  placeholder={origemUF ? 'Cidade' : 'Selecione UF'}
                  disabled={!origemUF}
                  className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {origemCidadeFilter && !origemCidade && filteredOrigemCidades.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 max-h-40 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg z-20">
                    {filteredOrigemCidades.slice(0, 50).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setOrigemCidade(c.nome);
                          setOrigemCidadeFilter(c.nome);
                          setTimeout(() => destinoUFRef.current?.focus(), 0);
                        }}
                        className="w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-blue-50"
                      >
                        {c.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {origemCidade && (
                <p className="mt-0.5 text-[10px] text-green-600">
                  ✓ {origemCidade}, {origemUF}
                </p>
              )}
              {!origemCidade && fieldErrors.origemCidade && (
                <p className="mt-0.5 text-[10px] text-red-600">{fieldErrors.origemCidade}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">
                Local de carregamento
              </label>
              <input
                type="text"
                value={originDetail}
                onChange={(e) => setOriginDetail(e.target.value.slice(0, 200))}
                placeholder="Ex: Fazenda São João"
                maxLength={200}
                className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">
                Link do Maps <span className="text-gray-400">(opcional)</span>
              </label>
              <input
                type="text"
                value={originCoordInput}
                onChange={(e) => {
                  setOriginCoordInput(e.target.value);
                  setOriginCoordError(null);
                }}
                placeholder="https://maps.google.com/..."
                className={`w-full px-2 py-1.5 bg-white border rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                  originCoordError ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              {originCoordError && (
                <p className="mt-0.5 text-[10px] text-red-600">{originCoordError}</p>
              )}
            </div>
          </div>
        </div>

        {/* Destino */}
        <div className="bg-white border border-orange-200 rounded-lg p-3 space-y-2 relative">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-orange-700 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span> Destino
            </h3>
            {origemCidade && destinoCidade && (
              <span className="px-1.5 py-0.5 bg-blue-50 border border-blue-200 rounded text-[10px] text-blue-700 font-semibold inline-flex items-center gap-1">
                {calculatingDistance ? (
                  <>
                    <svg
                      className="animate-spin w-3 h-3 text-blue-600"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        opacity="0.25"
                      />
                      <path
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>calculando</span>
                  </>
                ) : distanceKm !== null ? (
                  `${distanceKm.toLocaleString('pt-BR')} km`
                ) : (
                  '— km'
                )}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">Estado *</label>
              <div className="relative">
                <input
                  ref={destinoUFRef}
                  type="text"
                  value={destinoUFFilter}
                  onChange={(e) => {
                    setDestinoUFFilter(e.target.value);
                    setDestinoUF('');
                    setDestinoCidade('');
                    setDestinoCidadeFilter('');
                  }}
                  placeholder="UF"
                  className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
                {destinoUFFilter && !destinoUF && filteredDestinoEstados.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 max-h-40 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg z-30">
                    {filteredDestinoEstados.slice(0, 30).map((e) => (
                      <button
                        key={e.sigla}
                        type="button"
                        onClick={() => {
                          setDestinoUF(e.sigla);
                          setDestinoUFFilter(`${e.sigla} - ${e.nome}`);
                          setTimeout(() => destinoCidadeRef.current?.focus(), 0);
                        }}
                        className="w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-orange-50"
                      >
                        {e.sigla} - {e.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {fieldErrors.destinoUF && (
                <p className="mt-0.5 text-[10px] text-red-600">{fieldErrors.destinoUF}</p>
              )}
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">Cidade *</label>
              <div className="relative">
                <input
                  ref={destinoCidadeRef}
                  type="text"
                  value={destinoCidadeFilter}
                  onChange={(e) => {
                    setDestinoCidadeFilter(e.target.value);
                    setDestinoCidade('');
                  }}
                  placeholder={destinoUF ? 'Cidade' : 'Selecione UF'}
                  disabled={!destinoUF}
                  className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
                {destinoCidadeFilter && !destinoCidade && filteredDestinoCidades.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 max-h-40 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg z-20">
                    {filteredDestinoCidades.slice(0, 50).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setDestinoCidade(c.nome);
                          setDestinoCidadeFilter(c.nome);
                          setTimeout(() => cargoTypeRef.current?.focus(), 0);
                        }}
                        className="w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-orange-50"
                      >
                        {c.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!destinoCidade && fieldErrors.destinoCidade && (
                <p className="mt-0.5 text-[10px] text-red-600">{fieldErrors.destinoCidade}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">Local de entrega</label>
              <input
                type="text"
                value={destinationDetail}
                onChange={(e) => setDestinationDetail(e.target.value.slice(0, 200))}
                placeholder="Ex: Depósito Central"
                maxLength={200}
                className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">
                Link do Maps <span className="text-gray-400">(opcional)</span>
              </label>
              <input
                type="text"
                value={destinationCoordInput}
                onChange={(e) => {
                  setDestinationCoordInput(e.target.value);
                  setDestinationCoordError(null);
                }}
                placeholder="https://maps.google.com/..."
                className={`w-full px-2 py-1.5 bg-white border rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-orange-500 ${
                  destinationCoordError ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              {destinationCoordError && (
                <p className="mt-0.5 text-[10px] text-red-600">{destinationCoordError}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Dados da Carga ── */}
      <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-2">
        <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">
          Dados da Carga
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-gray-600 mb-0.5">Tipo de carga *</label>
            <div className="relative">
              <button
                ref={cargoTypeRef}
                type="button"
                onClick={() => setCargoTypeOpen((v) => !v)}
                className={`w-full px-2 py-1.5 bg-white border rounded text-xs text-left flex items-center justify-between focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                  fieldErrors.cargoType ? 'border-red-400' : 'border-gray-300'
                } ${cargoType ? 'text-gray-800' : 'text-gray-400'}`}
              >
                <span>{cargoType || 'Selecione'}</span>
                <span className="text-gray-400 text-[10px]">{cargoTypeOpen ? '▴' : '▾'}</span>
              </button>
              {cargoTypeOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg z-30">
                  {CARGO_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setCargoType(t);
                        setCargoTypeOpen(false);
                        setTimeout(() => speciesRef.current?.focus(), 0);
                      }}
                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 ${
                        cargoType === t ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {fieldErrors.cargoType && (
              <p className="mt-0.5 text-[10px] text-red-600">{fieldErrors.cargoType}</p>
            )}
          </div>

          <div>
            <label className="block text-[11px] text-gray-600 mb-0.5">Espécie *</label>
            <div className="relative">
              <button
                ref={speciesRef}
                type="button"
                onClick={() => setSpeciesOpen((v) => !v)}
                className={`w-full px-2 py-1.5 bg-white border rounded text-xs text-left flex items-center justify-between focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                  fieldErrors.species ? 'border-red-400' : 'border-gray-300'
                } ${species ? 'text-gray-800' : 'text-gray-400'}`}
              >
                <span>{species || 'Selecione'}</span>
                <span className="text-gray-400 text-[10px]">{speciesOpen ? '▴' : '▾'}</span>
              </button>
              {speciesOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg z-30">
                  {SPECIES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSpecies(s);
                        setSpeciesOpen(false);
                        setTimeout(() => productRef.current?.focus(), 0);
                      }}
                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 ${
                        species === s ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {fieldErrors.species && (
              <p className="mt-0.5 text-[10px] text-red-600">{fieldErrors.species}</p>
            )}
          </div>
        </div>

        {cargoType === 'Perigosa' && (
          <div>
            <label className="block text-[11px] text-gray-600 mb-0.5">Número ONU</label>
            <input
              type="text"
              value={onuNumber}
              onChange={(e) => setOnuNumber(e.target.value)}
              placeholder="Ex: UN1203"
              className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {cargoType === 'Frigorificada ou Aquecida' && (
          <div>
            <label className="block text-[11px] text-gray-600 mb-0.5">Temperatura (°C)</label>
            <input
              type="number"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="Ex: -18"
              className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-800 text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-600 mb-1">Produto *</label>
          <input
            ref={productRef}
            type="text"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="Qual produto será carregado? (Ex: Milho, Soja...)"
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400"
          />
          {fieldErrors.product && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.product}</p>
          )}
        </div>
      </div>

      {/* ── Peso e Volume ── */}
      <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-2">
        <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Peso e Volume</h3>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Unidade de medida</label>
          <RadioGroup
            name="weightUnit"
            options={[
              { label: 'Por toneladas', value: 'toneladas' },
              { label: 'Por quilos', value: 'quilos' },
            ]}
            value={weightUnit}
            onChange={(v) => setWeightUnit(v as 'toneladas' | 'quilos')}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Tipo de frete</label>
          <RadioGroup
            name="freightType"
            options={[
              { label: 'Carga completa', value: 'completa' },
              { label: 'Complemento', value: 'complemento' },
              { label: 'Peso de balança', value: 'peso_balanca' },
              { label: 'Caixote cheio', value: 'caixote_cheio' },
            ]}
            value={freightType}
            onChange={(v) =>
              setFreightType(v as 'completa' | 'complemento' | 'peso_balanca' | 'caixote_cheio')
            }
          />
        </div>

        {freightType === 'complemento' && (
          <div>
            <label className="block text-xs text-gray-600 mb-1">% de ocupação estimada</label>
            <input
              type="number"
              min="1"
              max="100"
              value={occupancyPct}
              onChange={(e) => setOccupancyPct(e.target.value)}
              placeholder="Ex: 50"
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400"
            />
          </div>
        )}
      </div>

      {/* ── Veículos ── */}
      <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-2">
        <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Tipos de Veículo Aceitos *</h3>
        {VEHICLE_CATEGORIES.map((cat) => {
          const allSelected = cat.vehicles.every((v) => selectedVehicles.includes(v.value));
          return (
            <div key={cat.label}>
              <div className="flex items-center gap-2 mb-1.5">
                <input
                  type="checkbox"
                  id={`cat-${cat.label}`}
                  checked={allSelected}
                  onChange={() => toggleAllVehicles(cat.vehicles)}
                  className="accent-blue-600"
                />
                <label
                  htmlFor={`cat-${cat.label}`}
                  className="text-xs font-medium text-gray-700 cursor-pointer"
                >
                  Todos os {cat.label}
                </label>
              </div>
              <div className="flex flex-wrap gap-2 pl-5">
                {cat.vehicles.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => toggleVehicle(v.value)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      selectedVehicles.includes(v.value)
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                    }`}
                  >
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
        {fieldErrors.vehicles && <p className="text-xs text-red-600">{fieldErrors.vehicles}</p>}
      </div>

      {/* ── Carrocerias ── */}
      <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-2">
        <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Carrocerias</h3>
        {BODY_CATEGORIES.map((cat) => {
          const allSelected = cat.bodies.every((b) => selectedBodies.includes(b));
          return (
            <div key={cat.label}>
              <div className="flex items-center gap-2 mb-1.5">
                <input
                  type="checkbox"
                  id={`body-cat-${cat.label}`}
                  checked={allSelected}
                  onChange={() => toggleAllBodies(cat.bodies)}
                  className="accent-blue-600"
                />
                <label
                  htmlFor={`body-cat-${cat.label}`}
                  className="text-xs font-medium text-gray-700 cursor-pointer"
                >
                  Todos — {cat.label}
                </label>
              </div>
              <div className="flex flex-wrap gap-2 pl-5">
                {cat.bodies.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggleBody(b)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      selectedBodies.includes(b)
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {fieldErrors.bodies && <p className="text-xs text-red-600">{fieldErrors.bodies}</p>}
      </div>

      {/* ── Opções Adicionais ── */}
      <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-2">
        <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Opções Adicionais</h3>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Precisa de lona?</label>
          <RadioGroup
            name="lona"
            options={[
              { label: 'Sim', value: 'sim' },
              { label: 'Não', value: 'nao' },
            ]}
            value={requiresLona}
            onChange={setRequiresLona}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Precisa de rastreador?</label>
          <RadioGroup
            name="tracker"
            options={[
              { label: 'Sim', value: 'sim' },
              { label: 'Não', value: 'nao' },
            ]}
            value={requiresTracker}
            onChange={setRequiresTracker}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Terá seguro?</label>
          <RadioGroup
            name="insurance"
            options={[
              { label: 'Sim', value: 'sim' },
              { label: 'Não', value: 'nao' },
            ]}
            value={requiresInsurance}
            onChange={setRequiresInsurance}
          />
        </div>
      </div>

      {/* ── Dados de Pagamento ── */}
      <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-2">
        <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Dados de Pagamento</h3>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Informações de valor</label>
          <RadioGroup
            name="valueKnown"
            options={[
              { label: 'O valor', value: 'ja_sei' },
              { label: 'A combinar', value: 'a_combinar' },
            ]}
            value={valueKnown}
            onChange={setValueKnown}
          />
        </div>

        {valueKnown === 'ja_sei' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Valor do Frete</label>
              <input
                type="text"
                inputMode="numeric"
                value={freteValue ? formatBRL(freteValue) : ''}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  // armazenamos em centavos como string crua
                  setFreteValue(digits);
                }}
                placeholder="R$ 0,00"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400"
              />
              {fieldErrors.freteValue && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.freteValue}</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Cálculo do valor</label>
              <select
                value={priceCalc}
                onChange={(e) => setPriceCalc(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
              >
                <option value="">Selecione</option>
                <option value="toneladas">Por toneladas</option>
                <option value="quilos">Por quilos</option>
                <option value="total">Total</option>
              </select>
              {fieldErrors.priceCalc && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.priceCalc}</p>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-600 mb-2">Forma de pagamento</label>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => togglePayment(m)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  paymentMethods.includes(m)
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {fieldErrors.paymentMethods && (
            <p className="mt-2 text-xs text-red-600">{fieldErrors.paymentMethods}</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Adiantamento <span className="text-gray-400">(opcional)</span>
          </label>
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={advancePct}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                setAdvancePct(v);
              }}
              placeholder="Ex: 80"
              className="w-full pl-3 pr-8 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 pointer-events-none">
              %
            </span>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Observações <span className="text-gray-400">({observations.length}/500)</span>
          </label>
          <textarea
            value={observations}
            onChange={(e) => {
              if (e.target.value.length <= 500) setObservations(e.target.value);
            }}
            maxLength={500}
            rows={3}
            placeholder="Informações adicionais..."
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm placeholder-gray-400"
          />
        </div>
      </div>

      {/* ── Botões ── */}
      <div className="flex justify-end space-x-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2 bg-gray-200 text-gray-800 text-sm rounded-lg hover:bg-gray-300"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting
            ? isEditing
              ? 'Salvando...'
              : 'Publicando...'
            : isEditing
              ? 'Salvar alterações'
              : 'Publicar Frete'}
        </button>
      </div>
    </form>
    </>
  );
}
