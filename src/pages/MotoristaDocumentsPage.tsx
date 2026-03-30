import { useState, useEffect } from 'react';
import { DocumentUpload } from '../components/DocumentUpload';
import { getDocumentsByUser } from '../services/documents';
import type { DocumentMetadata } from '../services/documents';
import { useAuth } from '../hooks/useAuth';

export default function MotoristaDocumentsPage() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<Record<string, DocumentMetadata>>({});
  const [isLoading, setIsLoading] = useState(true);

  const userId = user?.id ?? '';

  useEffect(() => {
    if (userId) loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadDocuments = async () => {
    try {
      const docs = await getDocumentsByUser(userId);
      const docsMap: Record<string, DocumentMetadata> = {};
      docs.forEach((doc) => {
        docsMap[doc.documentType] = doc;
      });
      setDocuments(docsMap);
    } catch (error) {
      console.error('Erro ao carregar documentos:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadSuccess = () => {
    loadDocuments();
  };

  const handleDeleteSuccess = () => {
    loadDocuments();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-gray-400">Carregando documentos...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Meus Documentos</h1>
          <p className="text-gray-400">Faça upload dos seus documentos para completar seu perfil</p>
        </div>

        <div className="space-y-6">
          {/* CPF */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <DocumentUpload
              userId={userId}
              documentType="cpf"
              label="CPF"
              existingDocument={documents.cpf}
              onUploadSuccess={handleUploadSuccess}
              onDeleteSuccess={handleDeleteSuccess}
            />
          </div>

          {/* CNH */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <DocumentUpload
              userId={userId}
              documentType="cnh"
              label="CNH - Carteira Nacional de Habilitação"
              existingDocument={documents.cnh}
              onUploadSuccess={handleUploadSuccess}
              onDeleteSuccess={handleDeleteSuccess}
            />
          </div>

          {/* ANTT */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <DocumentUpload
              userId={userId}
              documentType="antt"
              label="ANTT - Registro Nacional de Transportadores"
              existingDocument={documents.antt}
              onUploadSuccess={handleUploadSuccess}
              onDeleteSuccess={handleDeleteSuccess}
            />
          </div>

          {/* Vehicle Registration */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <DocumentUpload
              userId={userId}
              documentType="vehicle_registration"
              label="Documento do Veículo (CRLV)"
              existingDocument={documents.vehicle_registration}
              onUploadSuccess={handleUploadSuccess}
              onDeleteSuccess={handleDeleteSuccess}
            />
          </div>

          {/* Vehicle Insurance */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <DocumentUpload
              userId={userId}
              documentType="vehicle_insurance"
              label="Seguro do Veículo"
              existingDocument={documents.vehicle_insurance}
              onUploadSuccess={handleUploadSuccess}
              onDeleteSuccess={handleDeleteSuccess}
            />
          </div>

          {/* Profile Photo */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <DocumentUpload
              userId={userId}
              documentType="profile_photo"
              label="Foto de Perfil"
              existingDocument={documents.profile_photo}
              onUploadSuccess={handleUploadSuccess}
              onDeleteSuccess={handleDeleteSuccess}
            />
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="mt-8 bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h3 className="text-lg font-semibold text-white mb-4">Progresso do Perfil</h3>
          <div className="space-y-2">
            {[
              { type: 'cpf', label: 'CPF' },
              { type: 'cnh', label: 'CNH' },
              { type: 'antt', label: 'ANTT' },
              { type: 'vehicle_registration', label: 'Documento do Veículo' },
              { type: 'vehicle_insurance', label: 'Seguro do Veículo' },
              { type: 'profile_photo', label: 'Foto de Perfil' },
            ].map((item) => (
              <div key={item.type} className="flex items-center justify-between">
                <span className="text-sm text-gray-400">{item.label}</span>
                {documents[item.type] ? (
                  <span className="text-sm text-green-500">✓ Enviado</span>
                ) : (
                  <span className="text-sm text-gray-600">Pendente</span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-sm text-gray-400 mb-2">
              <span>Completude do perfil</span>
              <span>{Math.round((Object.keys(documents).length / 6) * 100)}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(Object.keys(documents).length / 6) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
