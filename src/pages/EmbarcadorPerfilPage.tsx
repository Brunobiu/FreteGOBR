import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  getEmbarcadorProfile,
  getUserData,
  updateEmbarcadorProfile,
  getEmbarcadorOnboardingProgress,
  type EmbarcadorOnboardingProgress,
} from '../services/embarcador';
import { uploadDocument, getSignedUrl, getDocumentByType } from '../services/documents';
import { sendEmailVerificationCode, VerificationError } from '../services/verification';
import {
  formatCnpj,
  isValidCnpjLength,
  lookupCnpj,
  sanitizeCnpj,
  CnpjLookupError,
} from '../services/cnpj';
import { supabase } from '../services/supabase';
import AppHeader from '../components/AppHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import BarraProgressoCadastro from '../components/BarraProgressoCadastro';
import LogoUploadField from '../components/LogoUploadField';
import ModalVerificacaoEmail from '../components/ModalVerificacaoEmail';
import { BRAZIL_STATES } from '../utils/brazilStates';

/**
 * Formata um telefone armazenado como dígitos (10 ou 11) no padrão visual
 * `(DD) D NNNN-NNNN` ou `(DD) NNNN-NNNN`.
 */
function formatPhoneDisplay(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return raw ?? '';
}

export default function EmbarcadorPerfilPage() {
  useDocumentTitle('Perfil do Embarcador');
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Read-only
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Editable
  const [companyName, setCompanyName] = useState('');
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);

  // CNPJ
  const [cnpjInput, setCnpjInput] = useState('');
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState<string | null>(null);

  // Filial
  const [branchState, setBranchState] = useState<string>('');
  const [branchCity, setBranchCity] = useState<string>('');
  const [savingBranch, setSavingBranch] = useState(false);
  const [branchSaved, setBranchSaved] = useState(false);

  // E-mail
  const [savedEmail, setSavedEmail] = useState<string>('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  // Photo
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Progress
  const [progress, setProgress] = useState<EmbarcadorOnboardingProgress | null>(null);

  const refreshProgress = useCallback(async () => {
    if (!user) return;
    try {
      const p = await getEmbarcadorOnboardingProgress(user.id);
      setProgress(p);
    } catch {
      // tolerante: progresso é opcional para o render
    }
  }, [user]);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);

      // Lê tudo em paralelo
      const [userData, profile, photoDoc, progressResult] = await Promise.all([
        getUserData(user.id),
        getEmbarcadorProfile(user.id),
        getDocumentByType(user.id, 'profile_photo').catch(() => null),
        getEmbarcadorOnboardingProgress(user.id).catch(() => null),
      ]);

      // Lê email_verified diretamente
      const { data: userRow } = await supabase
        .from('users')
        .select('email_verified, phone')
        .eq('id', user.id)
        .maybeSingle();

      setName(userData.name || '');
      // Mantemos o input limpo até o usuário verificar.
      // Se já foi verificado, mostramos o email salvo abaixo (modo readonly).
      setSavedEmail(userData.email || '');
      setEmailInput('');
      setEmailVerified(!!userRow?.email_verified);
      setPhone(userRow?.phone || user.phone || '');

      if (photoDoc) {
        const url = await getSignedUrl(photoDoc.id).catch(() => null);
        setProfilePhotoUrl(url);
      }

      if (profile) {
        setCompanyName(profile.companyName || '');
        if (profile.cnpj) setCnpjInput(formatCnpj(profile.cnpj));
        setBranchState((profile.branchState || '').toUpperCase());
        setBranchCity(profile.branchCity || '');
      }

      // Lê company_logo_url direto da tabela embarcadores
      const { data: emb } = await supabase
        .from('embarcadores')
        .select('company_logo_url')
        .eq('id', user.id)
        .maybeSingle();
      setCompanyLogoUrl(emb?.company_logo_url ?? null);

      if (progressResult) setProgress(progressResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar perfil');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadProfile();
  }, [user, loadProfile]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !user) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      const doc = await uploadDocument(user.id, 'profile_photo', e.target.files[0]);
      const url = await getSignedUrl(doc.id);
      setProfilePhotoUrl(url);
      // Atualiza o usuário em memória pra refletir a nova foto no header.
      await refreshUser();
      setSuccess('Foto atualizada!');
      setTimeout(() => setSuccess(null), 3000);
      await refreshProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no upload');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSendEmailCode = async () => {
    setError(null);
    if (!emailInput || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput)) {
      setError('Informe um e-mail válido.');
      return;
    }
    setSendingCode(true);
    try {
      await sendEmailVerificationCode(emailInput);
      setShowEmailModal(true);
    } catch (err) {
      if (err instanceof VerificationError) setError(err.message);
      else setError('Erro ao enviar código. Tente novamente.');
    } finally {
      setSendingCode(false);
    }
  };

  const handleEmailVerified = async (verifiedEmail: string) => {
    setShowEmailModal(false);
    setSavedEmail(verifiedEmail);
    setEmailVerified(true);
    setSuccess('E-mail confirmado!');
    setTimeout(() => setSuccess(null), 3000);
    await refreshProgress();
  };

  const handleLogoUploaded = async (url: string) => {
    setCompanyLogoUrl(url);
    setSuccess('Logo atualizado!');
    setTimeout(() => setSuccess(null), 3000);
    await refreshProgress();
  };

  /**
   * Quando o usuário termina de digitar o CNPJ (14 dígitos), consulta a
   * BrasilAPI e preenche o nome da empresa.
   */
  const handleCnpjChange = async (raw: string) => {
    const formatted = formatCnpj(raw);
    setCnpjInput(formatted);
    setCnpjError(null);
    if (!isValidCnpjLength(formatted)) return;

    setCnpjLoading(true);
    try {
      const data = await lookupCnpj(formatted);
      setCompanyName(data.razaoSocial || data.nomeFantasia || '');
      // Persiste imediatamente no banco
      if (user) {
        await updateEmbarcadorProfile(user.id, {
          cnpj: sanitizeCnpj(formatted),
          companyName: data.razaoSocial || data.nomeFantasia || '',
        });
      }
    } catch (err) {
      if (err instanceof CnpjLookupError) {
        setCnpjError(err.message);
      } else {
        setCnpjError('Erro ao consultar CNPJ.');
      }
    } finally {
      setCnpjLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // Valida o telefone (10 ou 11 dígitos) antes de salvar.
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone && !/^\d{10,11}$/.test(cleanPhone)) {
      setPhoneError('Telefone inválido (10 ou 11 dígitos).');
      return;
    }
    setPhoneError(null);

    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateEmbarcadorProfile(user.id, {
        branchState: branchState || null,
        branchCity: branchCity.trim() || null,
      });

      // Telefone (WhatsApp) é editável: grava em users.phone e embarcadores.whatsapp.
      if (cleanPhone) {
        const { error: phoneErr } = await supabase
          .from('users')
          .update({ phone: cleanPhone })
          .eq('id', user.id);
        if (phoneErr) throw new Error(phoneErr.message);
        await supabase.from('embarcadores').update({ whatsapp: cleanPhone }).eq('id', user.id);
      }

      setSuccess('Perfil salvo com sucesso!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBranch = async () => {
    if (!user) return;
    setSavingBranch(true);
    setError(null);
    try {
      await updateEmbarcadorProfile(user.id, {
        branchState: branchState || null,
        branchCity: branchCity.trim() || null,
      });
      setBranchSaved(true);
      setTimeout(() => setBranchSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar filial');
    } finally {
      setSavingBranch(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <AppHeader />
        <div className="flex justify-center py-20 text-gray-600">Carregando perfil...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Perfil da Empresa</h1>
          <button
            onClick={() => navigate('/embarcador')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Voltar
          </button>
        </div>

        {/* Barra de progresso */}
        {progress && (
          <BarraProgressoCadastro percent={progress.percent} missing={progress.missing} />
        )}

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

        <form onSubmit={handleSave} className="space-y-6">
          {/* Foto de perfil */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Foto de Perfil</h2>
            <div className="flex items-center space-x-6">
              <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center overflow-hidden border border-gray-300">
                {profilePhotoUrl ? (
                  <img src={profilePhotoUrl} alt="Foto" className="w-full h-full object-cover" />
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
              <label className="cursor-pointer px-4 py-2 bg-gray-200 border border-gray-300 text-gray-800 text-sm rounded-lg hover:bg-gray-300">
                {uploadingPhoto ? 'Enviando...' : 'Alterar foto'}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handlePhotoUpload}
                  disabled={uploadingPhoto}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Dados pessoais (somente leitura) */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Dados Pessoais</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Nome</label>
                <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800 text-sm">
                  {name || '—'}
                </p>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Telefone (WhatsApp)</label>
                <input
                  type="tel"
                  value={formatPhoneDisplay(phone)}
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/\D/g, '').slice(0, 11));
                    setPhoneError(null);
                  }}
                  placeholder="(00) 0 0000-0000"
                  inputMode="numeric"
                  maxLength={17}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                    phoneError ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {phoneError && <p className="mt-1 text-[11px] text-red-600">{phoneError}</p>}
              </div>
            </div>
          </div>

          {/* E-mail com verificação */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">E-mail</h2>
            {emailVerified ? (
              <div className="flex items-center justify-between">
                <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800 text-sm flex-1">
                  {savedEmail || '—'}
                </p>
                <span className="ml-3 inline-flex items-center text-xs text-green-700 bg-green-50 px-2 py-1 rounded-md border border-green-200 font-medium">
                  ✓ E-mail confirmado
                </span>
              </div>
            ) : (
              <div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="seu@email.com"
                    className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={handleSendEmailCode}
                    disabled={sendingCode || !emailInput}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sendingCode ? 'Enviando...' : 'Verificar e-mail'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Enviaremos um código de 6 dígitos para você confirmar.
                </p>
              </div>
            )}
          </div>

          {/* Empresa */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Empresa</h2>

            <div>
              <label className="block text-xs text-gray-600 mb-1">CNPJ *</label>
              <input
                type="text"
                value={cnpjInput}
                onChange={(e) => handleCnpjChange(e.target.value)}
                placeholder="00.000.000/0000-00"
                maxLength={18}
                inputMode="numeric"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {cnpjLoading && <p className="mt-1 text-xs text-blue-600">Consultando CNPJ...</p>}
              {cnpjError && <p className="mt-1 text-xs text-red-600">{cnpjError}</p>}
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Razão Social</label>
              <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800 text-sm min-h-[2.5rem]">
                {companyName || '—'}
              </p>
              <p className="mt-1 text-[11px] text-gray-400">
                Preenchido automaticamente a partir do CNPJ.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label htmlFor="branch_state" className="block text-xs text-gray-600 mb-1">
                  Filial — Estado
                </label>
                <select
                  id="branch_state"
                  value={branchState}
                  onChange={(e) => setBranchState(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Selecione…</option>
                  {BRAZIL_STATES.map((s) => (
                    <option key={s.uf} value={s.uf}>
                      {s.uf} — {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="branch_city" className="block text-xs text-gray-600 mb-1">
                  Filial — Cidade
                </label>
                <input
                  id="branch_city"
                  type="text"
                  value={branchCity}
                  onChange={(e) => setBranchCity(e.target.value.slice(0, 120))}
                  placeholder="Ex: Indiara"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveBranch}
                  disabled={savingBranch}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingBranch ? 'Salvando…' : 'Salvar filial'}
                </button>
                {branchSaved && <span className="text-xs text-green-700">✓ Filial salva</span>}
              </div>
            </div>

            {user && (
              <LogoUploadField
                userId={user.id}
                currentLogoUrl={companyLogoUrl}
                onUploaded={handleLogoUploaded}
              />
            )}
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => navigate('/embarcador')}
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
      </main>

      {/* Modal de verificação */}
      <ModalVerificacaoEmail
        email={emailInput}
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        onSuccess={handleEmailVerified}
      />
    </div>
  );
}
