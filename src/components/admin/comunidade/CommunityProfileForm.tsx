/**
 * CommunityProfileForm — bloco "Perfil Comunidade" do painel admin.
 *
 * Foto (upload bucket público) + nome + nome secundário + toggle enabled.
 * Validação no front (nome 0..120 / secundário 0..160; MIME png/jpeg/webp ≤5MB).
 * spec frete-comunidade (Fase 5, task 17 / Req 2.x, 14.3).
 */

import { useRef, useState } from 'react';
import {
  uploadCommunityPhoto,
  upsertCommunityProfile,
  validatePhotoFile,
  CommunityError,
  type CommunityProfile,
} from '../../../services/admin/comunidade';

interface Props {
  profile: CommunityProfile;
  canEdit: boolean;
  onSaved: () => void;
}

export default function CommunityProfileForm({ profile, canEdit, onSaved }: Props) {
  const [name, setName] = useState(profile.name);
  const [secondaryName, setSecondaryName] = useState(profile.secondaryName);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [photoPath, setPhotoPath] = useState<string | null>(profile.photoPath);
  const [photoPreview, setPhotoPreview] = useState<string | null>(profile.photoUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePhoto = async (file: File) => {
    setError(null);
    const invalid = validatePhotoFile(file);
    if (invalid) {
      setError('Tipo de arquivo inválido. Envie PNG, JPEG ou WEBP de até 5 MB.');
      return;
    }
    try {
      const path = await uploadCommunityPhoto(file);
      setPhotoPath(path);
      setPhotoPreview(URL.createObjectURL(file));
    } catch (err) {
      setError(err instanceof CommunityError ? err.message : 'Falha ao enviar a foto.');
    }
  };

  const handleSave = async () => {
    if (!canEdit) return;
    if (name.length > 120 || secondaryName.length > 160) {
      setError('Nome até 120 e nome secundário até 160 caracteres.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertCommunityProfile(
        { photoPath, name, secondaryName, enabled },
        profile.updatedAt
      );
      onSaved();
    } catch (err) {
      setError(err instanceof CommunityError ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Perfil Comunidade</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="h-20 w-20 overflow-hidden rounded-full border border-gray-200 bg-gray-50">
            {photoPreview ? (
              <img src={photoPreview} alt="Foto comunidade" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">
                sem foto
              </div>
            )}
          </div>
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded bg-gray-100 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200"
              >
                Trocar foto
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handlePhoto(f);
                }}
              />
            </>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Nome</label>
            <input
              type="text"
              value={name}
              maxLength={120}
              disabled={!canEdit}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">
              Nome secundário
            </label>
            <input
              type="text"
              value={secondaryName}
              maxLength={160}
              disabled={!canEdit}
              onChange={(e) => setSecondaryName(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Feature habilitada (fretes comunidade visíveis no feed)
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {canEdit && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar perfil'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
