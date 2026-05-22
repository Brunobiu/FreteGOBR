import { useState, useEffect, useRef } from 'react';
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
import { supabase } from '../services/supabase';
import AppHeader from '../components/AppHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Document section definitions ─────────────────────────────────────────────

const REQUIRED_DOC_TYPES = [
  'crlv_cavalo',
  'rntrc_cavalo',
  'cnh',
  'foto_segurando_cnh',
  'foto_frente_caminhao',
  'comprovante_endereco_proprietario',
  'foto_caminhao_completo',
];

const PDF_IMG = '.pdf,.jpg,.jpeg,.png';
const IMG_ONLY = '.jpg,.jpeg,.png';
const MAX_SIZE = 5 * 1024 * 1024;

interface SlotDef {
  type: string;
  label: string;
  accept: string;
  note?: string;
  optional?: boolean;
}

interface SectionDef {
  id: string;
  title: string;
  slots: SlotDef[];
  expandable?: boolean; // for carreta 2-4
}

const SECTIONS: SectionDef[] = [
  {
    id: 'doc_cavalo',
    title: 'DOC Cavalo/Carretas',
    expandable: true,
    slots: [
      { type: 'crlv_cavalo', label: 'CRLV Cavalo', accept: PDF_IMG },
      { type: 'crlv_carreta_1', label: 'CRLV Carreta 1', accept: PDF_IMG },
      { type: 'crlv_carreta_2', label: 'CRLV Carreta 2', accept: PDF_IMG },
      { type: 'crlv_carreta_3', label: 'CRLV Carreta 3', accept: PDF_IMG },
      { type: 'crlv_carreta_4', label: 'CRLV Carreta 4', accept: PDF_IMG },
    ],
  },
  {
    id: 'antt',
    title: 'ANTT',
    slots: [
      { type: 'rntrc_cavalo', label: 'RNTRC Cavalo', accept: PDF_IMG },
      { type: 'rntrc_carreta_1', label: 'RNTRC Carreta 1', accept: PDF_IMG },
      { type: 'rntrc_carreta_2', label: 'RNTRC Carreta 2', accept: PDF_IMG },
    ],
  },
  {
    id: 'cnh',
    title: 'CNH',
    slots: [{ type: 'cnh', label: 'CNH', accept: PDF_IMG }],
  },
  {
    id: 'foto_cnh',
    title: 'Foto segurando CNH',
    slots: [
      {
        type: 'foto_segurando_cnh',
        label: 'Foto segurando CNH',
        accept: IMG_ONLY,
        note: 'Use câmera traseira, não frontal',
      },
    ],
  },
  {
    id: 'foto_frente',
    title: 'Foto em frente ao caminhão',
    slots: [
      { type: 'foto_frente_caminhao', label: 'Foto em frente ao caminhão', accept: IMG_ONLY },
    ],
  },
  {
    id: 'comp_proprietario',
    title: 'Comprovante de Endereço - Proprietário',
    slots: [
      {
        type: 'comprovante_endereco_proprietario',
        label: 'Comprovante de Endereço (Proprietário)',
        accept: PDF_IMG,
      },
    ],
  },
  {
    id: 'comp_motorista',
    title: 'Comprovante de Endereço - Motorista',
    slots: [
      {
        type: 'comprovante_endereco_motorista',
        label: 'Comprovante de Endereço (Motorista)',
        accept: PDF_IMG,
        optional: true,
      },
    ],
  },
  {
    id: 'foto_caminhao',
    title: 'Foto do caminhão completo',
    slots: [
      { type: 'foto_caminhao_completo', label: 'Foto do caminhão completo', accept: IMG_ONLY },
    ],
  },
];

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ doc }: { doc: DocRecord | undefined }) {
  if (!doc) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
        Pendente envio
      </span>
    );
  }
  const status = doc.status ?? 'pendente';
  if (status === 'aprovado') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
        ✓ Aprovado
      </span>
    );
  }
  if (status === 'rejeitado') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
        Rejeitado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
      Aguardando aprovação
    </span>
  );
}

// ─── Single document slot ──────────────────────────────────────────────────────

interface SlotProps {
  slot: SlotDef;
  doc: DocRecord | undefined;
  uploading: boolean;
  onUpload: (type: string, file: File) => void;
  onDelete: (type: string) => void;
}

function DocSlot({ slot, doc, uploading, onUpload, onDelete }: SlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const status = doc?.status ?? (doc ? 'pendente' : undefined);
  const canDelete = doc && status !== 'aprovado';

  return (
    <div className="flex flex-col gap-1 p-3 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">
            {slot.label}
            {slot.optional && <span className="ml-1 text-xs text-gray-400">(opcional)</span>}
          </p>
          {slot.note && <p className="text-xs text-gray-500 mt-0.5">{slot.note}</p>}
          {doc && <p className="text-xs text-gray-400 truncate mt-0.5">{doc.fileName}</p>}
          {doc?.status === 'rejeitado' && doc.rejectionReason && (
            <p className="text-xs text-red-600 mt-0.5">Motivo: {doc.rejectionReason}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge doc={doc} />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-1">
        {doc?.url && (
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            Ver
          </a>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(slot.type)}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Deletar
          </button>
        )}
        {status !== 'aprovado' && (
          <>
            <label className="cursor-pointer px-3 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200">
              {uploading ? 'Enviando...' : doc ? 'Trocar' : 'Enviar'}
              <input
                ref={inputRef}
                type="file"
                accept={slot.accept}
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    onUpload(slot.type, e.target.files[0]);
                    e.target.value = '';
                  }
                }}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}

// ─── PIS section ───────────────────────────────────────────────────────────────

interface PisSectionProps {
  userId: string;
}

function PisSection({ userId }: PisSectionProps) {
  const [pis, setPis] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    supabase
      .from('motorista_pis')
      .select('pis_number')
      .eq('user_id', userId)
      .single()
      .then(({ data }) => {
        if (data?.pis_number) setPis(data.pis_number);
      });
  }, [userId]);

  const handleSave = async () => {
    if (pis.length !== 11) {
      setMsg({ type: 'err', text: 'PIS deve ter exatamente 11 dígitos.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    const { error } = await supabase
      .from('motorista_pis')
      .upsert({ user_id: userId, pis_number: pis }, { onConflict: 'user_id' });
    setSaving(false);
    if (error) {
      setMsg({ type: 'err', text: 'Erro ao salvar PIS.' });
    } else {
      setMsg({ type: 'ok', text: 'PIS salvo!' });
      setTimeout(() => setMsg(null), 3000);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <h2 className="text-base font-semibold text-gray-800 mb-3">Número PIS</h2>
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={pis}
          onChange={(e) => setPis(e.target.value.replace(/\D/g, '').slice(0, 11))}
          placeholder="00000000000"
          maxLength={11}
          className="w-48 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar PIS'}
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-xs ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function MotoristaPerfilPage() {
  useDocumentTitle('Perfil do Motorista');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Personal data
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');

  // Vehicle
  const [vehicleType, setVehicleType] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');

  // Documents
  const [documents, setDocuments] = useState<Record<string, DocRecord>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  // Carreta expansion
  const [showExtraCarretas, setShowExtraCarretas] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadAll = async () => {
    if (!user) return;
    try {
      setIsLoading(true);

      const [userData, profile, { data: rawDocs }] = await Promise.all([
        getUserData(user.id),
        getMotoristaProfile(user.id),
        supabase
          .from('documents')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
      ]);

      setName(userData.name || '');
      setEmail(userData.email || '');
      setCpf(userData.cpf || '');

      if (profile) {
        setVehicleType(profile.vehicleType || '');
        setVehiclePlate(profile.vehiclePlate || '');
        setVehicleModel(profile.vehicleModel || '');
        setVehicleYear(profile.vehicleYear?.toString() || '');
      }

      if (rawDocs) {
        const docsMap: Record<string, DocRecord> = {};
        // Keep only the latest per type
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

        // Fetch signed URLs in parallel
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

        // Auto-expand if any carreta 2-4 docs exist
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
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateMotoristaProfile(user.id, {
        name,
        email,
        cpf,
        vehicleType,
        vehiclePlate,
        vehicleModel,
        vehicleYear: vehicleYear ? parseInt(vehicleYear) : undefined,
      });
      setSuccess('Perfil salvo com sucesso!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDocUpload = async (docType: string, file: File) => {
    if (!user) return;

    if (!validateDocumentType(docType)) {
      setError(`Tipo de documento inválido: "${docType}". Recarregue a página e tente novamente.`);
      return;
    }

    if (file.size > MAX_SIZE) {
      setError(`Arquivo muito grande. Máximo permitido: 5MB.`);
      return;
    }

    setUploadingDoc(docType);
    setError(null);
    try {
      // If replacing, delete old first
      const existing = documents[docType];
      if (existing && existing.status !== 'aprovado') {
        await deleteDocument(existing.id);
      }

      const doc = await uploadDocument(user.id, docType, file);
      let url: string | undefined;
      try {
        url = await getSignedUrl(doc.id);
      } catch {
        /* ignore */
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

  // Progress: count required docs that are 'aprovado'
  const approvedRequired = REQUIRED_DOC_TYPES.filter(
    (t) => documents[t]?.status === 'aprovado'
  ).length;
  const progress = Math.round((approvedRequired / REQUIRED_DOC_TYPES.length) * 100);

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
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Meu Perfil</h1>
          <button
            onClick={() => navigate('/')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Voltar aos fretes
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        {/* Progress */}
        <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Documentos obrigatórios aprovados</span>
            <span>
              {approvedRequired}/{REQUIRED_DOC_TYPES.length}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">{progress}% completo</p>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Personal data */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Dados Pessoais</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Nome *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
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
            </div>
          </div>

          {/* Vehicle */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Veículo</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Tipo *</label>
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Selecione</option>
                  <option value="truck">Caminhão</option>
                  <option value="van">Van</option>
                  <option value="pickup">Pickup</option>
                  <option value="carreta">Carreta</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Placa</label>
                <input
                  type="text"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                  maxLength={8}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Modelo</label>
                <input
                  type="text"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Ano</label>
                <input
                  type="number"
                  value={vehicleYear}
                  onChange={(e) => setVehicleYear(e.target.value)}
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Documents */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Documentos</h2>

            {SECTIONS.map((section) => {
              const baseSlots = section.expandable
                ? section.slots.slice(0, 2) // CRLV Cavalo + Carreta 1
                : section.slots;
              const extraSlots = section.expandable ? section.slots.slice(2) : [];

              return (
                <div
                  key={section.id}
                  className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3"
                >
                  <h3 className="text-sm font-semibold text-gray-700">{section.title}</h3>

                  <div className="space-y-2">
                    {baseSlots.map((slot) => (
                      <DocSlot
                        key={slot.type}
                        slot={slot}
                        doc={documents[slot.type]}
                        uploading={uploadingDoc === slot.type}
                        onUpload={handleDocUpload}
                        onDelete={handleDocDelete}
                      />
                    ))}

                    {section.expandable &&
                      showExtraCarretas &&
                      extraSlots.map((slot) => (
                        <DocSlot
                          key={slot.type}
                          slot={slot}
                          doc={documents[slot.type]}
                          uploading={uploadingDoc === slot.type}
                          onUpload={handleDocUpload}
                          onDelete={handleDocDelete}
                        />
                      ))}
                  </div>

                  {section.expandable && !showExtraCarretas && (
                    <button
                      type="button"
                      onClick={() => setShowExtraCarretas(true)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      + Adicionar mais carretas (Carreta 2, 3, 4)
                    </button>
                  )}
                  {section.expandable && showExtraCarretas && (
                    <button
                      type="button"
                      onClick={() => setShowExtraCarretas(false)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      − Ocultar carretas extras
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Save button */}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-5 py-2 bg-gray-200 text-gray-800 text-sm rounded-lg hover:bg-gray-300"
            >
              ← Voltar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>

        {/* PIS - outside form to avoid accidental submit */}
        {user && (
          <div className="mt-6">
            <PisSection userId={user.id} />
          </div>
        )}
      </main>
    </div>
  );
}
