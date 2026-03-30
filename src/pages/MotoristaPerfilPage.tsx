import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getMotoristaProfile, getUserData, updateMotoristaProfile } from '../services/motorista';
import {
  uploadDocument,
  getSignedUrl,
  getDocumentsByUser,
  deleteDocument,
} from '../services/documents';
import type { DocumentMetadata } from '../services/documents';
import AppHeader from '../components/AppHeader';

const DOC_SECTIONS = [
  { type: 'profile_photo' as const, label: 'Foto de Perfil' },
  { type: 'cpf' as const, label: 'CPF' },
  { type: 'cnh' as const, label: 'CNH' },
  { type: 'antt' as const, label: 'ANTT' },
  { type: 'vehicle_registration' as const, label: 'Documento do Veículo (CRLV)' },
  { type: 'vehicle_insurance' as const, label: 'Seguro do Veículo' },
];

export default function MotoristaPerfilPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');

  // Docs
  const [documents, setDocuments] = useState<Record<string, DocumentMetadata>>({});
  const [docUrls, setDocUrls] = useState<Record<string, string>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadAll = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const userData = await getUserData(user.id);
      setName(userData.name || '');
      setEmail(userData.email || '');
      setCpf(userData.cpf || '');

      const profile = await getMotoristaProfile(user.id);
      if (profile) {
        setVehicleType(profile.vehicleType || '');
        setVehiclePlate(profile.vehiclePlate || '');
        setVehicleModel(profile.vehicleModel || '');
        setVehicleYear(profile.vehicleYear?.toString() || '');
      }

      // Load docs
      const docs = await getDocumentsByUser(user.id);
      const docsMap: Record<string, DocumentMetadata> = {};
      const urlsMap: Record<string, string> = {};
      for (const doc of docs) {
        docsMap[doc.documentType] = doc;
        try {
          urlsMap[doc.documentType] = await getSignedUrl(doc.id);
        } catch {
          /* ignore */
        }
      }
      setDocuments(docsMap);
      setDocUrls(urlsMap);
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
    setUploadingDoc(docType);
    setError(null);
    try {
      const doc = await uploadDocument(user.id, docType as DocumentMetadata['documentType'], file);
      const url = await getSignedUrl(doc.id);
      setDocuments((prev) => ({ ...prev, [docType]: doc }));
      setDocUrls((prev) => ({ ...prev, [docType]: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no upload');
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleDocDelete = async (docType: string) => {
    const doc = documents[docType];
    if (!doc || !confirm('Deletar este documento?')) return;
    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => {
        const n = { ...prev };
        delete n[docType];
        return n;
      });
      setDocUrls((prev) => {
        const n = { ...prev };
        delete n[docType];
        return n;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao deletar');
    }
  };

  const completedDocs = Object.keys(documents).length;
  const totalDocs = DOC_SECTIONS.length;
  const progress = Math.round((completedDocs / totalDocs) * 100);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950">
        <AppHeader />
        <div className="flex justify-center py-20 text-gray-400">Carregando perfil...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Meu Perfil</h1>
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-white">
            ← Voltar aos fretes
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-200 text-sm">
            {success}
          </div>
        )}

        {/* Progresso */}
        <div className="mb-6 bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex justify-between text-sm text-gray-400 mb-2">
            <span>Perfil {progress}% completo</span>
            <span>
              {completedDocs}/{totalDocs} documentos
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Dados pessoais */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold text-white">Dados Pessoais</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Nome *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">CPF</label>
                <input
                  type="text"
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value)}
                  placeholder="000.000.000-00"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Veículo */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold text-white">Veículo</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Tipo *</label>
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Selecione</option>
                  <option value="truck">Caminhão</option>
                  <option value="van">Van</option>
                  <option value="pickup">Pickup</option>
                  <option value="carreta">Carreta</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Placa</label>
                <input
                  type="text"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                  maxLength={8}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Modelo</label>
                <input
                  type="text"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Ano</label>
                <input
                  type="number"
                  value={vehicleYear}
                  onChange={(e) => setVehicleYear(e.target.value)}
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Documentos */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold text-white">Documentos</h2>
            {DOC_SECTIONS.map((sec) => (
              <div
                key={sec.type}
                className="flex items-center justify-between p-3 bg-gray-800 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  {documents[sec.type] ? (
                    <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  <div>
                    <p className="text-sm text-white">{sec.label}</p>
                    {documents[sec.type] && (
                      <p className="text-xs text-gray-500">{documents[sec.type].fileName}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {documents[sec.type] && docUrls[sec.type] && (
                    <a
                      href={docUrls[sec.type]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Ver
                    </a>
                  )}
                  {documents[sec.type] && (
                    <button
                      onClick={() => handleDocDelete(sec.type)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Deletar
                    </button>
                  )}
                  <label className="cursor-pointer px-3 py-1 bg-gray-700 text-white text-xs rounded hover:bg-gray-600">
                    {uploadingDoc === sec.type
                      ? 'Enviando...'
                      : documents[sec.type]
                        ? 'Trocar'
                        : 'Enviar'}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      disabled={uploadingDoc === sec.type}
                      onChange={(e) => {
                        if (e.target.files?.[0]) handleDocUpload(sec.type, e.target.files[0]);
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          {/* Botão salvar */}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-5 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700"
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
      </main>
    </div>
  );
}
