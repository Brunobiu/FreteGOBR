import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getMotoristaProfile, getUserData, updateMotoristaProfile } from '../services/motorista';
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
import { capitalizeName } from '../utils/textCase';
import { formatPlate, isValidMercosulPlate } from '../utils/plateValidation';
import { supabase } from '../services/supabase';
import AppHeader from '../components/AppHeader';
import ModalVerificacaoEmail from '../components/ModalVerificacaoEmail';

// ─── Constantes ───────────────────────────────────────────────────────────────

const PDF_IMG = 'image/*,application/pdf';
const IMG_ONLY = 'image/*';
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

// Tipos de documento por seção (Req 4)
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

// ─── Componente de Slot de Documento (com câmera ou arquivo) ────────────────

interface DocSlotProps {
  slot: SlotConfig;
  doc: DocRecord | undefined;
  uploading: boolean;
  onUpload: (type: string, file: File) => void;
  onDelete: (type: string) => void;
}

function DocSlot({ slot, doc, uploading, onUpload, onDelete }: DocSlotProps) {
  // Dois inputs separados: um com `capture` para câmera, outro padrão.
  // Em desktop, ambos abrem o seletor de arquivos (capture é ignorado).
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const status = doc?.status ?? (doc ? 'pendente' : undefined);
  const canDelete = doc && status !== 'aprovado';
  const isImageOnly = slot.accept === IMG_ONLY;

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
            {/* Inputs ocultos. capture="environment" prioriza câmera traseira;
                fallback: navegadores desktop ignoram `capture` e abrem o seletor. */}
            <input
              ref={cameraRef}
              type="file"
              accept={isImageOnly ? IMG_ONLY : 'image/*'}
              capture="environment"
              hidden
              disabled={uploading}
              onChange={handlePick}
            />
            <input
              ref={fileRef}
              type="file"
              accept={slot.accept}
              hidden
              disabled={uploading}
              onChange={handlePick}
            />
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={uploading}
              className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] rounded hover:bg-blue-100 disabled:opacity-50"
            >
              📷 Câmera
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-2 py-0.5 bg-gray-100 text-gray-700 text-[10px] rounded hover:bg-gray-200 disabled:opacity-50"
            >
              📎 {uploading ? 'Enviando...' : doc ? 'Trocar arquivo' : 'Escolher arquivo'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

export default function MotoristaPerfilPage() {
  useDocumentTitle('Perfil do Motorista');
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // === Dados pessoais ========================================================
  const [name, setName] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emailVerifiedAtServer, setEmailVerifiedAtServer] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [emailRateLimitedUntil, setEmailRateLimitedUntil] = useState<number | null>(null);
  const [cpf, setCpf] = useState('');
  const [pis, setPis] = useState('');

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

  // === Documentos ===========================================================
  const [documents, setDocuments] = useState<Record<string, DocRecord>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [showExtraCarretas, setShowExtraCarretas] = useState(false);

  // === Erros por campo ======================================================
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // O e-mail está "sujo" se o input difere do valor verificado no servidor
  const emailDirty =
    emailInput.trim() !== '' && emailInput.trim() !== (emailVerifiedAtServer ?? '');
  const emailVerifiedNow =
    emailInput.trim() === (emailVerifiedAtServer ?? '') && emailInput.trim() !== '';

  const loadAll = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);

      const [userData, profile, { data: rawDocs }, verifStatus, { data: pisRow }] =
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
        ]);

      setName(userData.name ? capitalizeName(userData.name) : '');
      setEmailInput(userData.email || '');
      setEmailVerifiedAtServer(verifStatus.emailVerified ? userData.email || '' : null);
      setCpf(userData.cpf || '');
      setPis(pisRow?.pis_number ?? '');

      if (profile) {
        setVehicleType(profile.vehicleType || '');
        setVehiclePlate(profile.vehiclePlate || '');
        // Modelo: se está na lista pré-definida, seleciona; senão, "Outro" + texto.
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
        setKmPerLiter(profile.kmPerLiter?.toString() ?? '');
        setTrailerAxles(profile.trailerAxles?.toString() ?? '');
        setCargoCapacityTon(profile.cargoCapacityTon?.toString() ?? '');
        setDieselPrice(profile.dieselPrice?.toFixed(2) ?? '');
        setIsNotOwner(profile.isOwner === false);
      }

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
      setError(err instanceof Error ? err.message : 'Erro ao carregar perfil');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadAll();
  }, [user, loadAll]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSendEmailCode = async () => {
    setError(null);
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
    setSuccess('E-mail confirmado!');
    setTimeout(() => setSuccess(null), 3000);
    await refreshUser();
  };

  const handleDocUpload = async (docType: string, file: File) => {
    if (!user) return;

    if (!validateDocumentType(docType)) {
      setError(`Tipo de documento inválido: "${docType}".`);
      return;
    }

    if (file.size > MAX_SIZE) {
      setError('Arquivo muito grande. Máximo permitido: 5MB.');
      return;
    }

    setUploadingDoc(docType);
    setError(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no upload');
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
      setError(err instanceof Error ? err.message : 'Erro ao deletar');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const errs: Record<string, string> = {};

    // Nome
    const trimmedName = name.trim();
    if (!trimmedName) errs.name = 'Informe seu nome completo';

    // Placa Mercosul (apenas se tiver algum valor)
    if (vehiclePlate && !isValidMercosulPlate(vehiclePlate)) {
      errs.plate = 'Placa inválida. Formato esperado: ABC1D23';
    }

    // Modelo "Outro" exige texto
    if (vehicleModelSelect === 'Outro' && !vehicleModelOutro.trim()) {
      errs.model = 'Informe o modelo do caminhão';
    }

    // Anos
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

    // Ranges operacionais
    if (kmPerLiter && (parseFloat(kmPerLiter) < 1 || parseFloat(kmPerLiter) > 10)) {
      errs.kmPerLiter = 'Valor fora do intervalo permitido (1,0 a 10,0)';
    }
    if (trailerAxles && (parseInt(trailerAxles) < 2 || parseInt(trailerAxles) > 9)) {
      errs.trailerAxles = 'Valor fora do intervalo permitido (2 a 9)';
    }
    if (
      cargoCapacityTon &&
      (parseFloat(cargoCapacityTon) < 1 || parseFloat(cargoCapacityTon) > 80)
    ) {
      errs.cargoCapacityTon = 'Valor fora do intervalo permitido (1,0 a 80,0)';
    }
    if (dieselPrice && (parseFloat(dieselPrice) < 1 || parseFloat(dieselPrice) > 20)) {
      errs.dieselPrice = 'Valor fora do intervalo permitido (R$ 1,00 a R$ 20,00)';
    }

    // PIS — bloqueia se preenchido com tamanho diferente de 11
    if (pis && pis.length !== 11) {
      errs.pis = 'PIS deve ter exatamente 11 dígitos';
    }

    // E-mail dirty exige verificação antes de salvar
    if (emailDirty) {
      errs.email = 'Verifique o novo e-mail antes de salvar';
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError('Verifique os campos destacados em vermelho.');
      // Foco no primeiro campo com erro
      const first = document.querySelector<HTMLElement>('[data-error="true"]');
      first?.focus();
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const finalModel =
        vehicleModelSelect === 'Outro' ? vehicleModelOutro.trim() : vehicleModelSelect;

      await updateMotoristaProfile(user.id, {
        name: trimmedName,
        cpf: cpf || undefined,
        vehicleType: vehicleType || undefined,
        vehiclePlate: vehiclePlate || undefined,
        vehicleModel: finalModel || undefined,
        vehicleYearManufacture: yearFab,
        vehicleYearModel: yearMod,
        kmPerLiter: kmPerLiter ? parseFloat(kmPerLiter) : undefined,
        trailerAxles: trailerAxles ? parseInt(trailerAxles) : undefined,
        cargoCapacityTon: cargoCapacityTon ? parseFloat(cargoCapacityTon) : undefined,
        dieselPrice: dieselPrice ? parseFloat(dieselPrice) : undefined,
        isOwner: !isNotOwner,
      });

      // PIS — salva apenas quando tem 11 dígitos exatos
      if (pis && pis.length === 11) {
        await supabase
          .from('motorista_pis')
          .upsert({ user_id: user.id, pis_number: pis }, { onConflict: 'user_id' });
      }

      setSuccess('Perfil salvo com sucesso!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Computed ───────────────────────────────────────────────────────────────

  const countDocs = (types: string[]) => types.filter((t) => documents[t]).length;

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

        {error && (
          <div
            role="alert"
            className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs"
          >
            {error}
          </div>
        )}
        {success && (
          <div className="mb-3 p-2.5 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs">
            {success}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 1 — Dados Pessoais (Motorista)
              ────────────────────────────────────────────────────────────────── */}
          <section className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">Dados Pessoais</h2>
              <span className="text-[11px] text-gray-500">
                {countDocs(TIPOS_PESSOAIS)}/{TIPOS_PESSOAIS.length} documentos
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Nome *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={(e) => setName(capitalizeName(e.target.value))}
                  required
                  data-error={fieldErrors.name ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                  onChange={(e) => setCpf(e.target.value)}
                  placeholder="000.000.000-00"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        setFieldErrors((p) => ({ ...p, email: '' }));
                      }}
                      placeholder="seu@email.com"
                      data-error={fieldErrors.email ? 'true' : undefined}
                      className={`flex-1 px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                      className="px-3 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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

            {/* Documentos pessoais */}
            <div className="mt-3 space-y-2">
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

            {/* PIS — último campo da seção, acima do Salvar */}
            <div className="mt-3 pt-3 border-t border-gray-100">
              <label className="block text-xs text-gray-600 mb-1">PIS (11 dígitos)</label>
              <input
                type="text"
                value={pis}
                onChange={(e) => setPis(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="00000000000"
                maxLength={11}
                data-error={fieldErrors.pis ? 'true' : undefined}
                className={`w-48 px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
          </section>

          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 2 — Veículo
              ────────────────────────────────────────────────────────────────── */}
          <section className="bg-white border border-gray-200 rounded-lg p-4">
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
                  onChange={(e) => setVehicleType(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  onChange={(e) => setVehiclePlate(formatPlate(e.target.value))}
                  placeholder="ABC1D23"
                  maxLength={7}
                  data-error={fieldErrors.plate ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                  onChange={(e) => setVehicleModelSelect(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    onChange={(e) => setVehicleModelOutro(e.target.value)}
                    maxLength={60}
                    data-error={fieldErrors.model ? 'true' : undefined}
                    className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                  onChange={(e) => setVehicleYearManufacture(e.target.value.slice(0, 4))}
                  min={1980}
                  max={CURRENT_YEAR + 1}
                  placeholder="2020"
                  data-error={fieldErrors.yearManufacture ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                  onChange={(e) => setVehicleYearModel(e.target.value.slice(0, 4))}
                  min={1980}
                  max={CURRENT_YEAR + 2}
                  placeholder="2021"
                  data-error={fieldErrors.yearModel ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.yearModel ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.yearModel && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.yearModel}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Consumo (km/l do cavalo)</label>
                <input
                  type="number"
                  step="0.1"
                  value={kmPerLiter}
                  onChange={(e) => setKmPerLiter(e.target.value)}
                  placeholder="2.5"
                  min={1}
                  max={10}
                  data-error={fieldErrors.kmPerLiter ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    fieldErrors.kmPerLiter ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {fieldErrors.kmPerLiter && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.kmPerLiter}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Eixos da carreta</label>
                <input
                  type="number"
                  value={trailerAxles}
                  onChange={(e) => setTrailerAxles(e.target.value)}
                  placeholder="6"
                  min={2}
                  max={9}
                  data-error={fieldErrors.trailerAxles ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                  type="number"
                  step="0.1"
                  value={cargoCapacityTon}
                  onChange={(e) => setCargoCapacityTon(e.target.value)}
                  placeholder="30"
                  min={1}
                  max={80}
                  data-error={fieldErrors.cargoCapacityTon ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                  type="number"
                  step="0.01"
                  value={dieselPrice}
                  onChange={(e) => setDieselPrice(e.target.value)}
                  placeholder="5.99"
                  min={1}
                  max={20}
                  data-error={fieldErrors.dieselPrice ? 'true' : undefined}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                  onChange={(e) => setIsNotOwner(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                />
                <span>O caminhão NÃO é meu (é de outro proprietário)</span>
              </label>
            </div>
          </section>

          {/* ──────────────────────────────────────────────────────────────────
              SEÇÃO 3 — Proprietário (renderiza apenas se isNotOwner)
              ────────────────────────────────────────────────────────────────── */}
          {isNotOwner && (
            <section className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-800">Proprietário</h2>
                <span className="text-[11px] text-gray-500">
                  {countDocs(TIPOS_PROPRIETARIO)}/{TIPOS_PROPRIETARIO.length} documentos
                </span>
              </div>

              <div className="space-y-2">
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
            </section>
          )}

          {/* Botões de ação */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              ← Voltar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Salvando...' : 'Salvar Alterações'}
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
