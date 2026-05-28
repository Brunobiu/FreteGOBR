import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  getMotoristaProfile,
  getUserData,
  updateMotoristaProfile,
  getMotoristaReferences,
  replaceMotoristaReferences,
} from '../services/motorista';
import {
  uploadDocument,
  getSignedUrl,
  deleteDocument,
  validateDocumentType,
} from '../services/documents';
import {
  sendEmailVerificationCode,
  getVerificationStatus,
  VerificationError,
} from '../services/verification';
import { lookupCnpj, formatCnpj, sanitizeCnpj, CnpjLookupError } from '../services/cnpj';
import { lookupCep, formatCep, sanitizeCep, CepLookupError } from '../services/cep';
import { capitalizeName } from '../utils/textCase';
import { formatPlate, isValidMercosulPlate } from '../utils/plateValidation';
import { sanitizePhone, formatPhoneBR, isValidPhoneBR } from '../utils/phoneFormat';
import { maskDecimal, maskedToNumber, numberToMasked } from '../utils/numberMask';
import { supabase } from '../services/supabase';
import AppHeader from '../components/AppHeader';
import ModalVerificacaoEmail from '../components/ModalVerificacaoEmail';

// ─── Constantes ───────────────────────────────────────────────────────────────

const PDF_IMG = 'image/*,application/pdf';
const IMG_ONLY = 'image/*';
const PDF_ONLY = 'application/pdf';
const MAX_SIZE = 5 * 1024 * 1024;

const VEHICLE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'truck', label: 'Caminhão' },
  { value: 'van', label: 'Van' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'carreta', label: 'Carreta' },
  { value: 'bitrem', label: 'Bitrem' },
  { value: 'rodotrem', label: 'Rodotrem' },
  { value: 'vanderleia', label: 'Vanderleia' },
];

const MODELOS_CAMINHAO = [
  'Volvo FH',
  'Volvo VM',
  'Scania R450',
  'Scania G',
  'Mercedes Atego',
  'Mercedes Axor',
  'Mercedes Actros',
  'Iveco Hi-Way',
  'Iveco Tector',
  'Ford Cargo',
  'VW Constellation',
  'VW Delivery',
  'DAF XF',
  'MAN TGX',
  'Outro',
] as const;

// Tipos de documento por seção
const TIPOS_PESSOAIS = ['cnh', 'foto_segurando_cnh', 'comprovante_endereco_motorista'];
const TIPOS_VEICULO = [
  'crlv_cavalo',
  'crlv_carreta_1',
  'crlv_carreta_2',
  'crlv_carreta_3',
  'crlv_carreta_4',
  'rntrc_cavalo',
  'rntrc_carreta_1',
  'rntrc_carreta_2',
  'foto_frente_caminhao',
  'foto_caminhao_completo',
];
const TIPOS_PROPRIETARIO = ['comprovante_endereco_proprietario', 'documento_proprietario'];
const TIPOS_CONTRATO = ['contrato_arrendamento'];

const CURRENT_YEAR = new Date().getFullYear();

type SecaoKey = 'dadosPessoais' | 'veiculo' | 'proprietario' | 'contrato';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type DocStatus = 'pendente' | 'aprovado' | 'rejeitado';

interface DocRecord {
  id: string;
  documentType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  status?: DocStatus;
  rejectionReason?: string;
  url?: string;
}

interface SlotConfig {
  type: string;
  label: string;
  accept: string;
  note?: string;
  optional?: boolean;
}

interface ReferenciaLocal {
  id: string;
  companyName: string;
  phone: string;
  persisted: boolean;
}

// ─── Componente de Slot de Documento (com câmera ou arquivo) ────────────────

interface DocSlotProps {
  slot: SlotConfig;
  doc: DocRecord | undefined;
  uploading: boolean;
  onUpload: (type: string, file: File) => void;
  onDelete: (type: string) => void;
}

function DocSlot({ slot, doc, uploading, onUpload, onDelete }: DocSlotProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const status = doc?.status ?? (doc ? 'pendente' : undefined);
  const canDelete = doc && status !== 'aprovado';
  const isImageOnly = slot.accept === IMG_ONLY;
  const isPdfOnly = slot.accept === PDF_ONLY;

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUpload(slot.type, file);
    e.target.value = '';
  };

  const statusBadge = (() => {
    if (!doc) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
          Não enviado
        </span>
      );
    }
    if (status === 'aprovado') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
          ✓ Aprovado
        </span>
      );
    }
    if (status === 'rejeitado') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
          Rejeitado
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700">
        Aguardando
      </span>
    );
  })();

  return (
    <div className="flex flex-col gap-1 p-2.5 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-800">
            {slot.label}
            {slot.optional && <span className="ml-1 text-[10px] text-gray-400">(opcional)</span>}
          </p>
          {slot.note && <p className="text-[10px] text-gray-500 mt-0.5">{slot.note}</p>}
          {doc && <p className="text-[10px] text-gray-400 truncate mt-0.5">{doc.fileName}</p>}
          {doc?.status === 'rejeitado' && doc.rejectionReason && (
            <p className="text-[10px] text-red-600 mt-0.5">Motivo: {doc.rejectionReason}</p>
          )}
        </div>
        <div className="shrink-0">{statusBadge}</div>
      </div>

      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        {doc?.url && (
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-blue-600 hover:underline"
          >
            Ver
          </a>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(slot.type)}
            className="text-[10px] text-red-500 hover:text-red-700"
          >
            Deletar
          </button>
        )}
        {status !== 'aprovado' && (
          <>
            {/* Slots PDF-only não exibem câmera (não faz sentido tirar foto). */}
            {!isPdfOnly && (
              <input
                ref={cameraRef}
                type="file"
                accept={isImageOnly ? IMG_ONLY : 'image/*'}
                capture="environment"
                hidden
                disabled={uploading}
                onChange={handlePick}
              />
            )}
            <input
              ref={fileRef}
              type="file"
              accept={slot.accept}
              hidden
              disabled={uploading}
              onChange={handlePick}
            />
            {!isPdfOnly && (
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={uploading}
                className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] rounded hover:bg-blue-100 disabled:opacity-50"
              >
                📷 Câmera
              </button>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-2 py-0.5 bg-gray-100 text-gray-700 text-[10px] rounded hover:bg-gray-200 disabled:opacity-50"
            >
              📎{' '}
              {uploading
                ? 'Enviando...'
                : doc
                  ? 'Trocar arquivo'
                  : isPdfOnly
                    ? 'Anexar PDF'
                    : 'Escolher arquivo'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function MotoristaPerfilPage() {
  useDocumentTitle('Perfil do Motorista');
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [topError, setTopError] = useState<string | null>(null);

  // === Dados pessoais ========================================================
  const [name, setName] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emailVerifiedAtServer, setEmailVerifiedAtServer] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [emailRateLimitedUntil, setEmailRateLimitedUntil] = useState<number | null>(null);
  const [cpf, setCpf] = useState('');
  const [rgNumber, setRgNumber] = useState('');
  const [pis, setPis] = useState('');

  // === Endereço (Migration 018) =============================================
  const [addressCep, setAddressCep] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [addressComplement, setAddressComplement] = useState('');
  const [addressNeighborhood, setAddressNeighborhood] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressUf, setAddressUf] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const lastCepRef = useRef<string>('');
  const cepReqIdRef = useRef(0);

  // === Referências profissionais ============================================
  const [references, setReferences] = useState<ReferenciaLocal[]>([]);

  // === Veículo ==============================================================
  const [vehicleType, setVehicleType] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleModelSelect, setVehicleModelSelect] = useState('');
  const [vehicleModelOutro, setVehicleModelOutro] = useState('');
  const [vehicleYearManufacture, setVehicleYearManufacture] = useState('');
  const [vehicleYearModel, setVehicleYearModel] = useState('');
  const [kmPerLiter, setKmPerLiter] = useState('');
  const [trailerAxles, setTrailerAxles] = useState('');
  const [cargoCapacityTon, setCargoCapacityTon] = useState('');
  const [dieselPrice, setDieselPrice] = useState('');

  // === Proprietário =========================================================
  const [isNotOwner, setIsNotOwner] = useState(false);
  const [ownerCnpj, setOwnerCnpj] = useState('');
  const [ownerCompanyName, setOwnerCompanyName] = useState('');
  const [ownerPisNumber, setOwnerPisNumber] = useState('');
  const [ownerIsDriver, setOwnerIsDriver] = useState(false);

  // === Tipo de RNTRC (Migration 022) ========================================
  const [rntrcType, setRntrcType] = useState<'fisica' | 'juridica' | ''>('');
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState<string | null>(null);
  const lastCnpjRef = useRef<string>('');
  const cnpjReqIdRef = useRef(0);

  // === Documentos ===========================================================
  const [documents, setDocuments] = useState<Record<string, DocRecord>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [showExtraCarretas, setShowExtraCarretas] = useState(false);

  // === Erros por campo ======================================================
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // === Estado dirty/saving/feedback por seção ==============================
  const [dirty, setDirty] = useState<Record<SecaoKey, boolean>>({
    dadosPessoais: false,
    veiculo: false,
    proprietario: false,
    contrato: false,
  });
  const [saving, setSaving] = useState<Record<SecaoKey, boolean>>({
    dadosPessoais: false,
    veiculo: false,
    proprietario: false,
    contrato: false,
  });
  const [sectionFeedback, setSectionFeedback] = useState<
    Record<SecaoKey, { type: 'success' | 'error'; msg: string } | null>
  >({
    dadosPessoais: null,
    veiculo: null,
    proprietario: null,
    contrato: null,
  });

  const markDirty = (s: SecaoKey) => setDirty((p) => ({ ...p, [s]: true }));
  const setSecaoFeedback = (s: SecaoKey, fb: { type: 'success' | 'error'; msg: string } | null) =>
    setSectionFeedback((p) => ({ ...p, [s]: fb }));

  const emailDirty =
    emailInput.trim() !== '' && emailInput.trim() !== (emailVerifiedAtServer ?? '');
  const emailVerifiedNow =
    emailInput.trim() === (emailVerifiedAtServer ?? '') && emailInput.trim() !== '';

  // ─── Carregamento inicial ────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);

      const [userData, profile, { data: rawDocs }, verifStatus, { data: pisRow }, refsList] =
        await Promise.all([
          getUserData(user.id),
          getMotoristaProfile(user.id),
          supabase
            .from('documents')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          getVerificationStatus(),
          supabase.from('motorista_pis').select('pis_number').eq('user_id', user.id).maybeSingle(),
          getMotoristaReferences(user.id).catch(() => []),
        ]);

      setName(userData.name ? capitalizeName(userData.name) : '');
      setEmailInput(userData.email || '');
      setEmailVerifiedAtServer(verifStatus.emailVerified ? userData.email || '' : null);
      setCpf(userData.cpf || '');
      setPis(pisRow?.pis_number ?? '');

      if (profile) {
        setVehicleType(profile.vehicleType || '');
        setVehiclePlate(profile.vehiclePlate || '');
        if (profile.vehicleModel) {
          if ((MODELOS_CAMINHAO as readonly string[]).includes(profile.vehicleModel)) {
            setVehicleModelSelect(profile.vehicleModel);
            setVehicleModelOutro('');
          } else {
            setVehicleModelSelect('Outro');
            setVehicleModelOutro(profile.vehicleModel);
          }
        }
        setVehicleYearManufacture(
          profile.vehicleYearManufacture?.toString() ?? profile.vehicleYear?.toString() ?? ''
        );
        setVehicleYearModel(profile.vehicleYearModel?.toString() ?? '');
        setKmPerLiter(numberToMasked(profile.kmPerLiter ?? null, 1));
        setTrailerAxles(profile.trailerAxles?.toString() ?? '');
        setCargoCapacityTon(numberToMasked(profile.cargoCapacityTon ?? null, 3));
        setDieselPrice(numberToMasked(profile.dieselPrice ?? null, 2));
        setIsNotOwner(profile.isOwner === false);

        // Migration 018: endereço, RG, owner_*
        setAddressCep(profile.addressCep ?? '');
        lastCepRef.current = sanitizeCep(profile.addressCep ?? '');
        setAddressStreet(profile.addressStreet ?? '');
        setAddressNumber(profile.addressNumber ?? '');
        setAddressComplement(profile.addressComplement ?? '');
        setAddressNeighborhood(profile.addressNeighborhood ?? '');
        setAddressCity(profile.addressCity ?? '');
        setAddressUf(profile.addressUf ?? '');
        setRgNumber(profile.rgNumber ?? '');
        setOwnerCnpj(profile.ownerCnpj ?? '');
        lastCnpjRef.current = sanitizeCnpj(profile.ownerCnpj ?? '');
        setOwnerCompanyName(profile.ownerCompanyName ?? '');
        setOwnerPisNumber(profile.ownerPisNumber ?? '');
        setOwnerIsDriver(profile.ownerIsDriver ?? false);
        setRntrcType((profile.rntrcType as 'fisica' | 'juridica') ?? '');
      }

      setReferences(
        refsList.map((r) => ({
          id: r.id,
          companyName: r.companyName,
          phone: r.phone,
          persisted: true,
        }))
      );

      if (rawDocs) {
        const docsMap: Record<string, DocRecord> = {};
        for (const d of rawDocs) {
          if (!docsMap[d.document_type]) {
            docsMap[d.document_type] = {
              id: d.id,
              documentType: d.document_type,
              fileName: d.file_name,
              fileSize: d.file_size,
              mimeType: d.mime_type,
              uploadedAt: new Date(d.created_at),
              status: d.status ?? 'pendente',
              rejectionReason: d.rejection_reason ?? undefined,
            };
          }
        }

        const urlEntries = await Promise.all(
          Object.entries(docsMap).map(async ([type, doc]) => {
            try {
              const url = await getSignedUrl(doc.id);
              return [type, url] as [string, string];
            } catch {
              return [type, undefined] as [string, undefined];
            }
          })
        );
        for (const [type, url] of urlEntries) {
          if (url) docsMap[type].url = url;
        }

        setDocuments(docsMap);

        const hasExtra = ['crlv_carreta_2', 'crlv_carreta_3', 'crlv_carreta_4'].some(
          (t) => docsMap[t]
        );
        if (hasExtra) setShowExtraCarretas(true);
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Erro ao carregar perfil');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadAll();
  }, [user, loadAll]);

  // ─── Lookup automático de CEP ────────────────────────────────────────────
  useEffect(() => {
    const digits = sanitizeCep(addressCep);
    if (digits.length !== 8) {
      setCepError(null);
      return;
    }
    if (digits === lastCepRef.current) return;
    lastCepRef.current = digits;

    const myReq = ++cepReqIdRef.current;
    setCepLoading(true);
    setCepError(null);
    (async () => {
      try {
        const data = await lookupCep(digits);
        if (myReq !== cepReqIdRef.current) return;
        setAddressStreet(data.logradouro);
        setAddressNeighborhood(data.bairro);
        setAddressCity(data.localidade);
        setAddressUf(data.uf);
      } catch (err) {
        if (myReq !== cepReqIdRef.current) return;
        if (err instanceof CepLookupError && err.code === 'NOT_FOUND') {
          setCepError('CEP não encontrado. Verifique o número digitado.');
        } else if (err instanceof CepLookupError && err.code === 'NETWORK') {
          setCepError('Não foi possível consultar o CEP agora. Tente novamente.');
        } else {
          setCepError('Erro ao consultar CEP.');
        }
      } finally {
        if (myReq === cepReqIdRef.current) setCepLoading(false);
      }
    })();
  }, [addressCep]);

  // ─── Lookup automático de CNPJ do proprietário ───────────────────────────
  useEffect(() => {
    const digits = sanitizeCnpj(ownerCnpj);
    if (digits.length !== 14) {
      setCnpjError(null);
      return;
    }
    if (digits === lastCnpjRef.current) return;
    lastCnpjRef.current = digits;

    const myReq = ++cnpjReqIdRef.current;
    setCnpjLoading(true);
    setCnpjError(null);
    (async () => {
      try {
        const data = await lookupCnpj(digits);
        if (myReq !== cnpjReqIdRef.current) return;
        setOwnerCompanyName(data.razaoSocial || data.nomeFantasia || '');
      } catch (err) {
        if (myReq !== cnpjReqIdRef.current) return;
        if (err instanceof CnpjLookupError && err.code === 'NOT_FOUND') {
          setCnpjError('CNPJ não encontrado.');
        } else if (err instanceof CnpjLookupError && err.code === 'NETWORK') {
          setCnpjError('Não foi possível consultar o CNPJ agora. Tente novamente.');
        } else {
          setCnpjError('Erro ao consultar CNPJ.');
        }
      } finally {
        if (myReq === cnpjReqIdRef.current) setCnpjLoading(false);
      }
    })();
  }, [ownerCnpj]);

  // ─── Handlers de e-mail ─────────────────────────────────────────────────
  const handleSendEmailCode = async () => {
    setTopError(null);
    if (!emailInput || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput)) {
      setFieldErrors((p) => ({ ...p, email: 'Informe um e-mail válido.' }));
      return;
    }
    if (emailRateLimitedUntil && Date.now() < emailRateLimitedUntil) return;

    setSendingCode(true);
    try {
      await sendEmailVerificationCode(emailInput);
      setShowEmailModal(true);
    } catch (err) {
      if (err instanceof VerificationError && err.code === 'RATE_LIMITED') {
        setEmailRateLimitedUntil(Date.now() + 60_000);
        setFieldErrors((p) => ({
          ...p,
          email: 'Muitas tentativas. Tente novamente em algumas horas.',
        }));
      } else {
        setFieldErrors((p) => ({
          ...p,
          email: err instanceof Error ? err.message : 'Erro ao enviar código',
        }));
      }
    } finally {
      setSendingCode(false);
    }
  };

  const handleEmailVerified = async (verifiedEmail: string) => {
    setShowEmailModal(false);
    setEmailVerifiedAtServer(verifiedEmail);
    setSecaoFeedback('dadosPessoais', { type: 'success', msg: 'E-mail confirmado!' });
    setTimeout(() => setSecaoFeedback('dadosPessoais', null), 3000);
    await refreshUser();
  };

  // ─── Handlers de upload de documento ────────────────────────────────────
  const handleDocUpload = async (docType: string, file: File) => {
    if (!user) return;

    if (!validateDocumentType(docType)) {
      setTopError(`Tipo de documento inválido: "${docType}".`);
      return;
    }

    // Validação extra: contrato_arrendamento somente PDF
    if (docType === 'contrato_arrendamento' && file.type !== 'application/pdf') {
      setTopError('Apenas arquivos PDF são aceitos para o contrato de arrendamento.');
      return;
    }

    if (file.size > MAX_SIZE) {
      setTopError('Arquivo muito grande. Máximo permitido: 5MB.');
      return;
    }

    setUploadingDoc(docType);
    setTopError(null);
    try {
      const existing = documents[docType];
      if (existing && existing.status !== 'aprovado') {
        await deleteDocument(existing.id);
      }
      const doc = await uploadDocument(user.id, docType, file);
      let url: string | undefined;
      try {
        url = await getSignedUrl(doc.id);
      } catch {
        // ignore
      }
      setDocuments((prev) => ({
        ...prev,
        [docType]: {
          id: doc.id,
          documentType: docType,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          uploadedAt: doc.uploadedAt,
          status: 'pendente',
          url,
        },
      }));
      // Marca dirty na seção correspondente
      if (TIPOS_PESSOAIS.includes(docType)) markDirty('dadosPessoais');
      else if (TIPOS_VEICULO.includes(docType)) markDirty('veiculo');
      else if (TIPOS_PROPRIETARIO.includes(docType)) markDirty('proprietario');
      else if (TIPOS_CONTRATO.includes(docType)) markDirty('contrato');
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Erro no upload');
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleDocDelete = async (docType: string) => {
    const doc = documents[docType];
    if (!doc || doc.status === 'aprovado') return;
    if (!confirm('Deletar este documento?')) return;
    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => {
        const n = { ...prev };
        delete n[docType];
        return n;
      });
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Erro ao deletar');
    }
  };

  // ─── Handlers de referências ────────────────────────────────────────────
  const addReference = () => {
    setReferences((prev) => [
      ...prev,
      { id: `tmp_${Date.now()}_${prev.length}`, companyName: '', phone: '', persisted: false },
    ]);
    markDirty('dadosPessoais');
  };
  const updateReference = (id: string, patch: Partial<ReferenciaLocal>) => {
    setReferences((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    markDirty('dadosPessoais');
  };
  const removeReference = (id: string) => {
    setReferences((prev) => prev.filter((r) => r.id !== id));
    markDirty('dadosPessoais');
  };

  // ─── Handler "Sou eu o proprietário" ────────────────────────────────────
  const handleSouEuProprietario = () => {
    // Marca a flag e mantém os campos editáveis. Os dados de
    // identidade pessoal (CPF/RG/PIS/endereço) já moram em "Dados
    // Pessoais"; aqui apenas marcamos `owner_is_driver = true`
    // para o admin saber que é o mesmo. Também limpamos o CNPJ
    // (caso estivesse preenchido, deixa de fazer sentido).
    setOwnerIsDriver(true);
    setOwnerCnpj('');
    setOwnerCompanyName('');
    setOwnerPisNumber('');
    markDirty('proprietario');
  };

  const countDocs = (types: string[]) => types.filter((t) => documents[t]).length;

  // ─── Save Dados Pessoais ────────────────────────────────────────────────
  const handleSaveDadosPessoais = async () => {
    if (!user) return;
    const errs: Record<string, string> = {};

    const trimmedName = name.trim();
    if (!trimmedName) errs.name = 'Informe seu nome completo';
    if (emailDirty) errs.email = 'Verifique o novo e-mail antes de salvar';
    if (pis && pis.length !== 11) errs.pis = 'PIS deve ter exatamente 11 dígitos';
    if (addressUf && !/^[A-Z]{2}$/.test(addressUf)) errs.addressUf = 'UF deve ter 2 letras';

    // Validação cruzada de referências
    references.forEach((r) => {
      const nameFilled = r.companyName.trim() !== '';
      const phoneDigits = sanitizePhone(r.phone);
      const phoneFilled = phoneDigits.length > 0;
      if (nameFilled && !isValidPhoneBR(r.phone)) {
        errs[`ref_${r.id}_phone`] = 'Telefone inválido (use 10 ou 11 dígitos)';
      }
      if (phoneFilled && !nameFilled) {
        errs[`ref_${r.id}_name`] = 'Informe o nome da empresa';
      }
    });

    setFieldErrors((p) => ({ ...p, ...errs }));
    if (Object.keys(errs).length > 0) {
      setSecaoFeedback('dadosPessoais', {
        type: 'error',
        msg: 'Verifique os campos destacados.',
      });
      const first = document.querySelector<HTMLElement>('[data-error="true"]');
      first?.focus();
      return;
    }

    setSaving((p) => ({ ...p, dadosPessoais: true }));
    try {
      await updateMotoristaProfile(user.id, {
        name: trimmedName,
        cpf: cpf || undefined,
        rgNumber: rgNumber || undefined,
        addressCep: sanitizeCep(addressCep) || undefined,
        addressStreet: addressStreet || undefined,
        addressNumber: addressNumber || undefined,
        addressComplement: addressComplement || undefined,
        addressNeighborhood: addressNeighborhood || undefined,
        addressCity: addressCity || undefined,
        addressUf: addressUf || undefined,
      });

      if (pis && pis.length === 11) {
        await supabase
          .from('motorista_pis')
          .upsert({ user_id: user.id, pis_number: pis }, { onConflict: 'user_id' });
      }

      // Replace-all de referências (filtra vazias dentro do service)
      await replaceMotoristaReferences(
        user.id,
        references.map((r) => ({ companyName: r.companyName, phone: sanitizePhone(r.phone) }))
      );

      setDirty((p) => ({ ...p, dadosPessoais: false }));
      setSecaoFeedback('dadosPessoais', { type: 'success', msg: 'Seção salva.' });
      setTimeout(() => setSecaoFeedback('dadosPessoais', null), 3000);
    } catch (err) {
      setSecaoFeedback('dadosPessoais', {
        type: 'error',
        msg: err instanceof Error ? err.message : 'Erro ao salvar.',
      });
    } finally {
      setSaving((p) => ({ ...p, dadosPessoais: false }));
    }
  };

  // ─── Save Veículo ───────────────────────────────────────────────────────
  const handleSaveVeiculo = async () => {
    if (!user) return;
    const errs: Record<string, string> = {};

    if (vehiclePlate && !isValidMercosulPlate(vehiclePlate)) {
      errs.plate = 'Placa inválida. Formato esperado: ABC1D23';
    }
    if (vehicleModelSelect === 'Outro' && !vehicleModelOutro.trim()) {
      errs.model = 'Informe o modelo do caminhão';
    }
    const yearFab = vehicleYearManufacture ? parseInt(vehicleYearManufacture) : undefined;
    const yearMod = vehicleYearModel ? parseInt(vehicleYearModel) : undefined;
    if (yearFab !== undefined && (yearFab < 1980 || yearFab > CURRENT_YEAR + 1)) {
      errs.yearManufacture = 'Ano de fabricação fora do intervalo permitido';
    }
    if (yearMod !== undefined && (yearMod < 1980 || yearMod > CURRENT_YEAR + 2)) {
      errs.yearModel = 'Ano modelo fora do intervalo permitido';
    }
    if (yearFab !== undefined && yearMod !== undefined && yearMod < yearFab) {
      errs.yearModel = 'Ano modelo deve ser maior ou igual ao ano de fabricação';
    }
    if (kmPerLiter) {
      const v = maskedToNumber(kmPerLiter, 1);
      if (Number.isNaN(v) || v < 1 || v > 10) {
        errs.kmPerLiter = 'Valor fora do intervalo permitido (1,0 a 10,0)';
      }
    }
    if (trailerAxles && (parseInt(trailerAxles) < 2 || parseInt(trailerAxles) > 9)) {
      errs.trailerAxles = 'Valor fora do intervalo permitido (2 a 9)';
    }
    if (cargoCapacityTon) {
      const v = maskedToNumber(cargoCapacityTon, 3);
      if (Number.isNaN(v) || v < 1 || v > 80) {
        errs.cargoCapacityTon = 'Valor fora do intervalo permitido (1,000 a 80,000)';
      }
    }
    if (dieselPrice) {
      const v = maskedToNumber(dieselPrice, 2);
      if (Number.isNaN(v) || v < 1 || v > 20) {
        errs.dieselPrice = 'Valor fora do intervalo permitido (R$ 1,00 a R$ 20,00)';
      }
    }

    setFieldErrors((p) => ({ ...p, ...errs }));
    if (Object.keys(errs).length > 0) {
      setSecaoFeedback('veiculo', { type: 'error', msg: 'Verifique os campos destacados.' });
      return;
    }

    setSaving((p) => ({ ...p, veiculo: true }));
    try {
      const finalModel =
        vehicleModelSelect === 'Outro' ? vehicleModelOutro.trim() : vehicleModelSelect;

      await updateMotoristaProfile(user.id, {
        vehicleType: vehicleType || undefined,
        vehiclePlate: vehiclePlate || undefined,
        vehicleModel: finalModel || undefined,
        vehicleYearManufacture: yearFab,
        vehicleYearModel: yearMod,
        kmPerLiter: kmPerLiter ? maskedToNumber(kmPerLiter, 1) : undefined,
        trailerAxles: trailerAxles ? parseInt(trailerAxles) : undefined,
        cargoCapacityTon: cargoCapacityTon ? maskedToNumber(cargoCapacityTon, 3) : undefined,
        dieselPrice: dieselPrice ? maskedToNumber(dieselPrice, 2) : undefined,
        isOwner: !isNotOwner,
        rntrcType: rntrcType || undefined,
      });

      setDirty((p) => ({ ...p, veiculo: false }));
      setSecaoFeedback('veiculo', { type: 'success', msg: 'Seção salva.' });
      setTimeout(() => setSecaoFeedback('veiculo', null), 3000);
    } catch (err) {
      setSecaoFeedback('veiculo', {
        type: 'error',
        msg: err instanceof Error ? err.message : 'Erro ao salvar.',
      });
    } finally {
      setSaving((p) => ({ ...p, veiculo: false }));
    }
  };

  // ─── Save Proprietário ──────────────────────────────────────────────────
  const handleSaveProprietario = async () => {
    if (!user) return;
    const errs: Record<string, string> = {};

    if (ownerPisNumber && ownerPisNumber.length !== 11) {
      errs.ownerPis = 'PIS deve ter exatamente 11 dígitos';
    }

    setFieldErrors((p) => ({ ...p, ...errs }));
    if (Object.keys(errs).length > 0) {
      setSecaoFeedback('proprietario', {
        type: 'error',
        msg: 'Verifique os campos destacados.',
      });
      return;
    }

    setSaving((p) => ({ ...p, proprietario: true }));
    try {
      await updateMotoristaProfile(user.id, {
        ownerCnpj: sanitizeCnpj(ownerCnpj) || undefined,
        ownerCompanyName: ownerCompanyName || undefined,
        ownerPisNumber: ownerPisNumber || undefined,
        ownerIsDriver: ownerIsDriver,
      });
      setDirty((p) => ({ ...p, proprietario: false }));
      setSecaoFeedback('proprietario', { type: 'success', msg: 'Seção salva.' });
      setTimeout(() => setSecaoFeedback('proprietario', null), 3000);
    } catch (err) {
      setSecaoFeedback('proprietario', {
        type: 'error',
        msg: err instanceof Error ? err.message : 'Erro ao salvar.',
      });
    } finally {
      setSaving((p) => ({ ...p, proprietario: false }));
    }
  };

  // ─── Save Contrato (apenas reseta dirty) ────────────────────────────────
  const handleSaveContrato = () => {
    setDirty((p) => ({ ...p, contrato: false }));
    setSecaoFeedback('contrato', { type: 'success', msg: 'Seção salva.' });
    setTimeout(() => setSecaoFeedback('contrato', null), 3000);
  };

  // ─── Helper de rodapé "Salvar" por seção ────────────────────────────────
  const SectionFooter = ({ section, onSave }: { section: SecaoKey; onSave: () => void }) => {
    const fb = sectionFeedback[section];
    return (
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        {fb ? (
          <span
            className={`text-[11px] px-2 py-1 rounded ${
              fb.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {fb.msg}
          </span>
        ) : (
          <span className="text-[11px] text-gray-400">
            {dirty[section] ? 'Há alterações não salvas' : '—'}
          </span>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty[section] || saving[section]}
          className="min-h-[44px] px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving[section] ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader />
        <div className="flex justify-center py-20 text-gray-600">Carregando perfil...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-800">Meu Perfil</h1>
          <button
            onClick={() => navigate('/')}
            className="text-xs text-gray-600 hover:text-gray-900"
          >
            ← Voltar aos fretes
          </button>
        </div>

        {topError && (
          <div
            role="alert"
            className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs"
          >
            {topError}
          </div>
        )}

        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 1 — Dados Pessoais (Motorista)
              ────────────────────────────────────────────────────────────────── */}
          <section className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">Dados Pessoais</h2>
              <span className="text-[11px] text-gray-500">
                {countDocs(TIPOS_PESSOAIS)}/{TIPOS_PESSOAIS.length} documentos
              </span>
            </div>

            {/* Foto de perfil do motorista */}
            <div className="flex items-center gap-4 mb-4 pb-4 border-b border-gray-100">
              <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center overflow-hidden border border-gray-300 flex-shrink-0">
                {documents.profile_photo?.url ? (
                  <img
                    src={documents.profile_photo.url}
                    alt="Foto"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg className="w-10 h-10 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 mb-1">Foto de perfil</p>
                <p className="text-[11px] text-gray-500 mb-2">
                  Aparece para os embarcadores no chat e nas notificações.
                </p>
                <label
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    uploadingDoc === 'profile_photo'
                      ? 'bg-gray-200 text-gray-500 cursor-wait'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                  {uploadingDoc === 'profile_photo'
                    ? 'Enviando...'
                    : documents.profile_photo
                      ? 'Trocar foto'
                      : 'Enviar foto'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={uploadingDoc === 'profile_photo'}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        await handleDocUpload('profile_photo', file);
                        await refreshUser();
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Nome *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    markDirty('dadosPessoais');
                  }}
                  onBlur={(e) => setName(capitalizeName(e.target.value))}
                  required
                  data-error={fieldErrors.name ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.name ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.name && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.name}</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">CPF</label>
                <input
                  type="text"
                  value={cpf}
                  onChange={(e) => {
                    setCpf(e.target.value);
                    markDirty('dadosPessoais');
                  }}
                  placeholder="000.000.000-00"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">RG</label>
                <input
                  type="text"
                  value={rgNumber}
                  onChange={(e) => {
                    setRgNumber(e.target.value);
                    markDirty('dadosPessoais');
                  }}
                  maxLength={20}
                  placeholder="00.000.000-0"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-600 mb-1">E-mail</label>
                {emailVerifiedNow ? (
                  <div className="flex items-center gap-2">
                    <p className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800 text-sm">
                      {emailInput}
                    </p>
                    <span className="px-2 py-1 bg-green-50 border border-green-200 text-green-700 text-[11px] font-medium rounded-md">
                      ✓ E-mail confirmado
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => {
                        setEmailInput(e.target.value);
                        markDirty('dadosPessoais');
                        setFieldErrors((p) => ({ ...p, email: '' }));
                      }}
                      placeholder="seu@email.com"
                      data-error={fieldErrors.email ? 'true' : undefined}
                      className={`flex-1 px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        fieldErrors.email ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleSendEmailCode}
                      disabled={
                        sendingCode ||
                        !emailDirty ||
                        (emailRateLimitedUntil !== null && Date.now() < emailRateLimitedUntil)
                      }
                      className="min-h-[44px] px-3 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sendingCode ? 'Enviando...' : 'Verificar e-mail'}
                    </button>
                  </div>
                )}
                {fieldErrors.email && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.email}</p>
                )}
              </div>
            </div>

            {/* Endereço */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-700 mb-2">Endereço</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">CEP</label>
                  <input
                    type="text"
                    value={formatCep(addressCep)}
                    onChange={(e) => {
                      setAddressCep(sanitizeCep(e.target.value));
                      markDirty('dadosPessoais');
                    }}
                    placeholder="00000-000"
                    maxLength={9}
                    inputMode="numeric"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {cepLoading && (
                    <p className="mt-1 text-[11px] text-gray-500">Buscando endereço...</p>
                  )}
                  {cepError && <p className="mt-1 text-[11px] text-red-600">{cepError}</p>}
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Logradouro</label>
                  <input
                    type="text"
                    value={addressStreet}
                    onChange={(e) => {
                      setAddressStreet(e.target.value);
                      markDirty('dadosPessoais');
                    }}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Número</label>
                  <input
                    type="text"
                    value={addressNumber}
                    onChange={(e) => {
                      setAddressNumber(e.target.value);
                      markDirty('dadosPessoais');
                    }}
                    maxLength={10}
                    placeholder="123 ou S/N"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Complemento</label>
                  <input
                    type="text"
                    value={addressComplement}
                    onChange={(e) => {
                      setAddressComplement(e.target.value);
                      markDirty('dadosPessoais');
                    }}
                    placeholder="Apto 101 (opcional)"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Bairro</label>
                  <input
                    type="text"
                    value={addressNeighborhood}
                    onChange={(e) => {
                      setAddressNeighborhood(e.target.value);
                      markDirty('dadosPessoais');
                    }}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Cidade</label>
                  <input
                    type="text"
                    value={addressCity}
                    onChange={(e) => {
                      setAddressCity(e.target.value);
                      markDirty('dadosPessoais');
                    }}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">UF</label>
                  <input
                    type="text"
                    value={addressUf}
                    onChange={(e) => {
                      setAddressUf(e.target.value.toUpperCase().slice(0, 2));
                      markDirty('dadosPessoais');
                    }}
                    maxLength={2}
                    placeholder="GO"
                    data-error={fieldErrors.addressUf ? 'true' : undefined}
                    className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      fieldErrors.addressUf ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  {fieldErrors.addressUf && (
                    <p className="mt-1 text-[11px] text-red-600">{fieldErrors.addressUf}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Documentos pessoais */}
            <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
              <DocSlot
                slot={{ type: 'cnh', label: 'CNH (frente e verso)', accept: PDF_IMG }}
                doc={documents.cnh}
                uploading={uploadingDoc === 'cnh'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
              <DocSlot
                slot={{
                  type: 'foto_segurando_cnh',
                  label: 'Foto segurando CNH',
                  accept: IMG_ONLY,
                  note: 'Use a câmera traseira, não a frontal.',
                }}
                doc={documents.foto_segurando_cnh}
                uploading={uploadingDoc === 'foto_segurando_cnh'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
              <DocSlot
                slot={{
                  type: 'comprovante_endereco_motorista',
                  label: 'Comprovante de endereço (motorista)',
                  accept: PDF_IMG,
                }}
                doc={documents.comprovante_endereco_motorista}
                uploading={uploadingDoc === 'comprovante_endereco_motorista'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
            </div>

            {/* PIS */}
            <div className="mt-3 pt-3 border-t border-gray-100">
              <label className="block text-xs text-gray-600 mb-1">PIS (11 dígitos)</label>
              <input
                type="text"
                value={pis}
                onChange={(e) => {
                  setPis(e.target.value.replace(/\D/g, '').slice(0, 11));
                  markDirty('dadosPessoais');
                }}
                placeholder="00000000000"
                maxLength={11}
                inputMode="numeric"
                data-error={fieldErrors.pis ? 'true' : undefined}
                className={`w-48 px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  fieldErrors.pis ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              {fieldErrors.pis && (
                <p className="mt-1 text-[11px] text-red-600">{fieldErrors.pis}</p>
              )}
              {!pis && (
                <p className="mt-1 text-[11px] text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-2 py-1 inline-block">
                  ⚠ Transportadoras hoje em dia pedem muito o PIS, favor preencher.
                </p>
              )}
            </div>

            {/* Referências profissionais */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-700 mb-2">
                Referências profissionais (opcional)
              </h3>
              {references.length === 0 ? (
                <p className="text-[11px] text-gray-500 mb-2">
                  Nenhuma referência cadastrada ainda.
                </p>
              ) : (
                <div className="space-y-2">
                  {references.map((r) => (
                    <div
                      key={r.id}
                      className="relative flex flex-col sm:flex-row sm:items-end gap-2 p-3 sm:p-2.5 border border-gray-200 rounded-lg bg-gray-50"
                    >
                      <div className="flex-1">
                        <label className="block text-[11px] text-gray-600 mb-1">
                          Nome da empresa
                        </label>
                        <input
                          type="text"
                          value={r.companyName}
                          onChange={(e) =>
                            updateReference(r.id, { companyName: e.target.value.slice(0, 80) })
                          }
                          onBlur={(e) =>
                            updateReference(r.id, { companyName: capitalizeName(e.target.value) })
                          }
                          maxLength={80}
                          data-error={fieldErrors[`ref_${r.id}_name`] ? 'true' : undefined}
                          className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            fieldErrors[`ref_${r.id}_name`] ? 'border-red-400' : 'border-gray-300'
                          }`}
                        />
                        {fieldErrors[`ref_${r.id}_name`] && (
                          <p className="mt-1 text-[11px] text-red-600">
                            {fieldErrors[`ref_${r.id}_name`]}
                          </p>
                        )}
                      </div>
                      <div className="flex-1">
                        <label className="block text-[11px] text-gray-600 mb-1">Telefone</label>
                        <input
                          type="text"
                          value={formatPhoneBR(r.phone)}
                          onChange={(e) =>
                            updateReference(r.id, { phone: sanitizePhone(e.target.value) })
                          }
                          inputMode="tel"
                          placeholder="(00) 00000-0000"
                          data-error={fieldErrors[`ref_${r.id}_phone`] ? 'true' : undefined}
                          className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            fieldErrors[`ref_${r.id}_phone`] ? 'border-red-400' : 'border-gray-300'
                          }`}
                        />
                        {fieldErrors[`ref_${r.id}_phone`] && (
                          <p className="mt-1 text-[11px] text-red-600">
                            {fieldErrors[`ref_${r.id}_phone`]}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeReference(r.id)}
                        aria-label="Remover referência"
                        className="absolute top-1 right-1 sm:static sm:self-end min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-1 text-red-500 hover:text-red-700"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={addReference}
                className="mt-2 min-h-[44px] px-3 py-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                + Adicionar referência
              </button>
            </div>

            <SectionFooter section="dadosPessoais" onSave={handleSaveDadosPessoais} />
          </section>

          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 2 — Veículo
              ────────────────────────────────────────────────────────────────── */}
          <section className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">Veículo</h2>
              <span className="text-[11px] text-gray-500">
                {countDocs(TIPOS_VEICULO)}/{TIPOS_VEICULO.length} documentos
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Tipo</label>
                <select
                  value={vehicleType}
                  onChange={(e) => {
                    setVehicleType(e.target.value);
                    markDirty('veiculo');
                  }}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Selecione...</option>
                  {VEHICLE_TYPES.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Placa (Mercosul)</label>
                <input
                  type="text"
                  value={vehiclePlate}
                  onChange={(e) => {
                    setVehiclePlate(formatPlate(e.target.value));
                    markDirty('veiculo');
                  }}
                  placeholder="ABC1D23"
                  maxLength={7}
                  data-error={fieldErrors.plate ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.plate ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.plate && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.plate}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Modelo</label>
                <select
                  value={vehicleModelSelect}
                  onChange={(e) => {
                    setVehicleModelSelect(e.target.value);
                    markDirty('veiculo');
                  }}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Selecione...</option>
                  {MODELOS_CAMINHAO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {vehicleModelSelect === 'Outro' && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Especifique o modelo</label>
                  <input
                    type="text"
                    value={vehicleModelOutro}
                    onChange={(e) => {
                      setVehicleModelOutro(e.target.value);
                      markDirty('veiculo');
                    }}
                    maxLength={60}
                    data-error={fieldErrors.model ? 'true' : undefined}
                    className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      fieldErrors.model ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  {fieldErrors.model && (
                    <p className="mt-1 text-[11px] text-red-600">{fieldErrors.model}</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-600 mb-1">Ano de fabricação</label>
                <input
                  type="number"
                  value={vehicleYearManufacture}
                  onChange={(e) => {
                    setVehicleYearManufacture(e.target.value.slice(0, 4));
                    markDirty('veiculo');
                  }}
                  min={1980}
                  max={CURRENT_YEAR + 1}
                  placeholder="2020"
                  data-error={fieldErrors.yearManufacture ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.yearManufacture ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.yearManufacture && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.yearManufacture}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Ano modelo</label>
                <input
                  type="number"
                  value={vehicleYearModel}
                  onChange={(e) => {
                    setVehicleYearModel(e.target.value.slice(0, 4));
                    markDirty('veiculo');
                  }}
                  min={1980}
                  max={CURRENT_YEAR + 2}
                  placeholder="2021"
                  data-error={fieldErrors.yearModel ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.yearModel ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.yearModel && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.yearModel}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Consumo (km por litro do cavalo)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={kmPerLiter}
                  onChange={(e) => {
                    setKmPerLiter(maskDecimal(e.target.value, 1));
                    markDirty('veiculo');
                  }}
                  placeholder="2,5"
                  data-error={fieldErrors.kmPerLiter ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.kmPerLiter ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                <p className="mt-1 text-[10px] text-gray-500">
                  Ex: caminhão pesado carregado faz 2,5 a 4 km/L.
                </p>
                {fieldErrors.kmPerLiter && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.kmPerLiter}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Eixos da carreta</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={trailerAxles}
                  onChange={(e) => {
                    // Só dígitos, máximo 2 (range 2..9, mas evita 99 errado também)
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                    setTrailerAxles(digits);
                    markDirty('veiculo');
                  }}
                  placeholder="6"
                  maxLength={2}
                  data-error={fieldErrors.trailerAxles ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.trailerAxles ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.trailerAxles && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.trailerAxles}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Capacidade (toneladas)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={cargoCapacityTon}
                  onChange={(e) => {
                    // Máx 5 dígitos crus (ex: "47000" → "47,000")
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 5);
                    setCargoCapacityTon(maskDecimal(digits, 3));
                    markDirty('veiculo');
                  }}
                  placeholder="30,000"
                  data-error={fieldErrors.cargoCapacityTon ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.cargoCapacityTon ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.cargoCapacityTon && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.cargoCapacityTon}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Valor do diesel (R$/litro)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={dieselPrice}
                  onChange={(e) => {
                    setDieselPrice(maskDecimal(e.target.value, 2));
                    markDirty('veiculo');
                  }}
                  placeholder="5,99"
                  data-error={fieldErrors.dieselPrice ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.dieselPrice ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.dieselPrice && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.dieselPrice}</p>
                )}
              </div>
            </div>

            {(!kmPerLiter || !trailerAxles || !cargoCapacityTon) && (
              <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-yellow-800">
                ⚠ Preencha consumo, eixos e capacidade para desbloquear cálculos no painel.
              </div>
            )}

            {/* Documentos do veículo */}
            <div className="mt-3 space-y-2">
              <DocSlot
                slot={{ type: 'crlv_cavalo', label: 'CRLV do cavalo', accept: PDF_IMG }}
                doc={documents.crlv_cavalo}
                uploading={uploadingDoc === 'crlv_cavalo'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
              <DocSlot
                slot={{ type: 'crlv_carreta_1', label: 'CRLV da carreta 1', accept: PDF_IMG }}
                doc={documents.crlv_carreta_1}
                uploading={uploadingDoc === 'crlv_carreta_1'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />

              {/* Tipo de RNTRC (ANTT) — Pessoa Física ou Jurídica */}
              <div className="col-span-1 md:col-span-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs font-semibold text-blue-800 mb-1.5">
                  Tipo da sua RNTRC (ANTT)
                </p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                    <input
                      type="radio"
                      name="rntrc_type"
                      value="fisica"
                      checked={rntrcType === 'fisica'}
                      onChange={() => {
                        setRntrcType('fisica');
                        markDirty('veiculo');
                      }}
                      className="accent-blue-600"
                    />
                    Pessoa Física
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                    <input
                      type="radio"
                      name="rntrc_type"
                      value="juridica"
                      checked={rntrcType === 'juridica'}
                      onChange={() => {
                        setRntrcType('juridica');
                        markDirty('veiculo');
                      }}
                      className="accent-blue-600"
                    />
                    Pessoa Jurídica
                  </label>
                </div>
              </div>

              <DocSlot
                slot={{ type: 'rntrc_cavalo', label: 'RNTRC do cavalo', accept: PDF_IMG }}
                doc={documents.rntrc_cavalo}
                uploading={uploadingDoc === 'rntrc_cavalo'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
              <DocSlot
                slot={{
                  type: 'rntrc_carreta_1',
                  label: 'RNTRC da carreta 1',
                  accept: PDF_IMG,
                  optional: true,
                }}
                doc={documents.rntrc_carreta_1}
                uploading={uploadingDoc === 'rntrc_carreta_1'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />

              {!showExtraCarretas && (
                <button
                  type="button"
                  onClick={() => setShowExtraCarretas(true)}
                  className="text-[11px] text-blue-600 hover:underline"
                >
                  + adicionar mais carretas
                </button>
              )}

              {showExtraCarretas && (
                <>
                  <DocSlot
                    slot={{
                      type: 'crlv_carreta_2',
                      label: 'CRLV da carreta 2',
                      accept: PDF_IMG,
                      optional: true,
                    }}
                    doc={documents.crlv_carreta_2}
                    uploading={uploadingDoc === 'crlv_carreta_2'}
                    onUpload={handleDocUpload}
                    onDelete={handleDocDelete}
                  />
                  <DocSlot
                    slot={{
                      type: 'rntrc_carreta_2',
                      label: 'RNTRC da carreta 2',
                      accept: PDF_IMG,
                      optional: true,
                    }}
                    doc={documents.rntrc_carreta_2}
                    uploading={uploadingDoc === 'rntrc_carreta_2'}
                    onUpload={handleDocUpload}
                    onDelete={handleDocDelete}
                  />
                  <DocSlot
                    slot={{
                      type: 'crlv_carreta_3',
                      label: 'CRLV da carreta 3',
                      accept: PDF_IMG,
                      optional: true,
                    }}
                    doc={documents.crlv_carreta_3}
                    uploading={uploadingDoc === 'crlv_carreta_3'}
                    onUpload={handleDocUpload}
                    onDelete={handleDocDelete}
                  />
                  <DocSlot
                    slot={{
                      type: 'crlv_carreta_4',
                      label: 'CRLV da carreta 4',
                      accept: PDF_IMG,
                      optional: true,
                    }}
                    doc={documents.crlv_carreta_4}
                    uploading={uploadingDoc === 'crlv_carreta_4'}
                    onUpload={handleDocUpload}
                    onDelete={handleDocDelete}
                  />
                </>
              )}

              <DocSlot
                slot={{
                  type: 'foto_frente_caminhao',
                  label: 'Foto da frente do caminhão',
                  accept: IMG_ONLY,
                }}
                doc={documents.foto_frente_caminhao}
                uploading={uploadingDoc === 'foto_frente_caminhao'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
              <DocSlot
                slot={{
                  type: 'foto_caminhao_completo',
                  label: 'Foto do caminhão completo (conjunto)',
                  accept: IMG_ONLY,
                }}
                doc={documents.foto_caminhao_completo}
                uploading={uploadingDoc === 'foto_caminhao_completo'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
            </div>

            {/* Toggle proprietário */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isNotOwner}
                  onChange={(e) => {
                    setIsNotOwner(e.target.checked);
                    markDirty('veiculo');
                  }}
                  className="rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                />
                <span>O caminhão NÃO é meu (é de outro proprietário)</span>
              </label>
            </div>

            <SectionFooter section="veiculo" onSave={handleSaveVeiculo} />
          </section>

          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 3 — Proprietário (renderiza apenas se isNotOwner)
              ────────────────────────────────────────────────────────────────── */}
          {isNotOwner && (
            <section className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-800">Proprietário</h2>
                <span className="text-[11px] text-gray-500">
                  {countDocs(TIPOS_PROPRIETARIO)}/{TIPOS_PROPRIETARIO.length} documentos
                </span>
              </div>

              <button
                type="button"
                onClick={handleSouEuProprietario}
                className="mb-3 min-h-[44px] px-3 py-2 bg-gray-100 text-gray-700 text-xs rounded-lg hover:bg-gray-200 border border-gray-200"
              >
                Sou eu o proprietário
              </button>

              {ownerIsDriver && (
                <p className="mb-3 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                  ✓ Você marcou que é o proprietário. Os dados pessoais serão usados como
                  referência.
                </p>
              )}

              {!ownerIsDriver && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">CNPJ do proprietário</label>
                    <input
                      type="text"
                      value={formatCnpj(ownerCnpj)}
                      onChange={(e) => {
                        setOwnerCnpj(sanitizeCnpj(e.target.value));
                        markDirty('proprietario');
                      }}
                      placeholder="00.000.000/0000-00"
                      maxLength={18}
                      inputMode="numeric"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {cnpjLoading && (
                      <p className="mt-1 text-[11px] text-gray-500">Buscando empresa...</p>
                    )}
                    {cnpjError && <p className="mt-1 text-[11px] text-red-600">{cnpjError}</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nome da empresa</label>
                    <input
                      type="text"
                      value={ownerCompanyName}
                      disabled
                      placeholder="Preenchido automaticamente pela Receita"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 text-base sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      PIS do proprietário (11 dígitos)
                    </label>
                    <input
                      type="text"
                      value={ownerPisNumber}
                      onChange={(e) => {
                        setOwnerPisNumber(e.target.value.replace(/\D/g, '').slice(0, 11));
                        markDirty('proprietario');
                      }}
                      placeholder="00000000000"
                      maxLength={11}
                      inputMode="numeric"
                      data-error={fieldErrors.ownerPis ? 'true' : undefined}
                      className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        fieldErrors.ownerPis ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    {fieldErrors.ownerPis && (
                      <p className="mt-1 text-[11px] text-red-600">{fieldErrors.ownerPis}</p>
                    )}
                    {!ownerPisNumber && (
                      <p className="mt-1 text-[11px] text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-2 py-1 inline-block">
                        ⚠ PIS do proprietário não informado.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
                <DocSlot
                  slot={{
                    type: 'documento_proprietario',
                    label: 'Documento do proprietário (CNH ou RG)',
                    accept: PDF_IMG,
                  }}
                  doc={documents.documento_proprietario}
                  uploading={uploadingDoc === 'documento_proprietario'}
                  onUpload={handleDocUpload}
                  onDelete={handleDocDelete}
                />
                <DocSlot
                  slot={{
                    type: 'comprovante_endereco_proprietario',
                    label: 'Comprovante de endereço do proprietário',
                    accept: PDF_IMG,
                  }}
                  doc={documents.comprovante_endereco_proprietario}
                  uploading={uploadingDoc === 'comprovante_endereco_proprietario'}
                  onUpload={handleDocUpload}
                  onDelete={handleDocDelete}
                />
              </div>

              <SectionFooter section="proprietario" onSave={handleSaveProprietario} />
            </section>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 4 — Contrato de Arrendamento (apenas se isNotOwner)
              ────────────────────────────────────────────────────────────────── */}
          {isNotOwner && (
            <section className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-800">Contrato de Arrendamento</h2>
                <span className="text-[11px] text-gray-500">
                  {countDocs(TIPOS_CONTRATO)}/{TIPOS_CONTRATO.length} documento
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mb-3">
                Anexe o contrato de arrendamento em PDF (máximo 5MB).
              </p>
              <DocSlot
                slot={{
                  type: 'contrato_arrendamento',
                  label: 'Contrato de arrendamento (PDF)',
                  accept: PDF_ONLY,
                }}
                doc={documents.contrato_arrendamento}
                uploading={uploadingDoc === 'contrato_arrendamento'}
                onUpload={handleDocUpload}
                onDelete={handleDocDelete}
              />
              <SectionFooter section="contrato" onSave={handleSaveContrato} />
            </section>
          )}

          {/* Botão voltar */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="min-h-[44px] px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              ← Voltar
            </button>
          </div>
        </form>
      </main>

      <ModalVerificacaoEmail
        email={emailInput}
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        onSuccess={handleEmailVerified}
      />
    </div>
  );
}
