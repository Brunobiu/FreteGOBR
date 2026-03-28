import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getEmbarcadorProfile, getUserData, updateEmbarcadorProfile } from '../services/embarcador';
import { uploadDocument, getSignedUrl, getDocumentByType } from '../services/documents';

export default function EmbarcadorProfile() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (!user) return;

    const loadProfile = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load user data
        const userData = await getUserData(user.id);
        setName(userData.name || '');
        setEmail(userData.email || '');

        // Load profile photo if exists
        const profilePhotoDoc = await getDocumentByType(user.id, 'profile_photo');
        if (profilePhotoDoc) {
          const signedUrl = await getSignedUrl(profilePhotoDoc.id);
          setProfilePhotoUrl(signedUrl);
        }

        // Load embarcador profile
        const embarcadorProfile = await getEmbarcadorProfile(user.id);
        if (embarcadorProfile) {
          setCompanyName(embarcadorProfile.companyName || '');
          setWhatsapp(embarcadorProfile.whatsapp || '');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar perfil');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !user) return;

    const file = e.target.files[0];
    setUploadingPhoto(true);
    setError(null);

    try {
      const document = await uploadDocument(user.id, 'profile_photo', file);
      const signedUrl = await getSignedUrl(document.id);
      setProfilePhotoUrl(signedUrl);
      setSuccess('Foto atualizada com sucesso!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer upload da foto');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const formatWhatsApp = (value: string) => {
    // Remove tudo que não é número
    const numbers = value.replace(/\D/g, '');

    // Aplica a máscara (00) 0 0000-0000
    if (numbers.length <= 2) {
      return numbers;
    } else if (numbers.length <= 3) {
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    } else if (numbers.length <= 7) {
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3)}`;
    } else {
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
    }
  };

  const handleWhatsAppChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatWhatsApp(e.target.value);
    setWhatsapp(formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await updateEmbarcadorProfile(user.id, {
        name,
        email,
        companyName,
        whatsapp,
      });

      setSuccess('Perfil atualizado com sucesso!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar perfil');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-950">
        <div className="text-white">Carregando perfil...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Meu Perfil</h1>

        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-200">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-900/50 border border-green-700 rounded-lg text-green-200">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Profile Photo */}
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
            <label className="block text-sm font-medium text-gray-300 mb-4">Foto de Perfil</label>
            <div className="flex items-center space-x-6">
              <div className="w-24 h-24 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden">
                {profilePhotoUrl ? (
                  <img
                    src={profilePhotoUrl}
                    alt="Foto de perfil"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg className="w-12 h-12 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
              <div>
                <label
                  htmlFor="photo-upload"
                  className="cursor-pointer inline-flex items-center px-4 py-2 border border-gray-700 rounded-md shadow-sm text-sm font-medium text-white bg-gray-800 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  {uploadingPhoto ? 'Enviando...' : 'Alterar foto'}
                </label>
                <input
                  id="photo-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/jpg"
                  onChange={handlePhotoUpload}
                  disabled={uploadingPhoto}
                  className="hidden"
                />
                <p className="mt-2 text-xs text-gray-500">JPG, PNG até 10MB</p>
              </div>
            </div>
          </div>

          {/* Personal Information */}
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 space-y-4">
            <h2 className="text-xl font-semibold text-white mb-4">Informações Pessoais</h2>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
                Nome Completo *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                E-mail
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Company Information */}
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 space-y-4">
            <h2 className="text-xl font-semibold text-white mb-4">Informações da Empresa</h2>

            <div>
              <label htmlFor="companyName" className="block text-sm font-medium text-gray-300 mb-2">
                Nome da Empresa *
              </label>
              <input
                type="text"
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="whatsapp" className="block text-sm font-medium text-gray-300 mb-2">
                WhatsApp
              </label>
              <input
                type="text"
                id="whatsapp"
                value={whatsapp}
                onChange={handleWhatsAppChange}
                placeholder="(00) 0 0000-0000"
                maxLength={17}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
