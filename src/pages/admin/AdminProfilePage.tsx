/**
 * AdminProfilePage - perfil do admin logado
 *
 * Mostra/edita: nome, CPF, email, foto de perfil, username (read-only).
 * Username e usado apenas pra login e nunca aparece no painel principal.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase';
import { useAdminContext } from '../../components/admin/AdminProvider';
import { logAdminAction } from '../../services/admin/audit';

interface ProfileData {
  name: string;
  cpf: string | null;
  email: string | null;
  profile_photo_url: string | null;
  admin_username: string | null;
}

export default function AdminProfilePage() {
  const { session, refreshRoles } = useAdminContext();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      const { data: row } = await supabase
        .from('users')
        .select('name, cpf, email, profile_photo_url, admin_username')
        .eq('id', session.userId)
        .maybeSingle();
      if (cancelled) return;
      setData(
        row
          ? {
              name: row.name ?? '',
              cpf: row.cpf,
              email: row.email,
              profile_photo_url: row.profile_photo_url,
              admin_username: row.admin_username,
            }
          : null
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !session) return;
    setSaving(true);
    setMsg(null);
    try {
      const before = { name: data.name, cpf: data.cpf, email: data.email };
      const { error } = await supabase
        .from('users')
        .update({
          name: data.name,
          cpf: data.cpf,
          email: data.email,
        })
        .eq('id', session.userId);
      if (error) throw error;
      await logAdminAction({
        action: 'ADMIN_PROFILE_UPDATE',
        targetType: 'users',
        targetId: session.userId,
        before,
        after: { name: data.name, cpf: data.cpf, email: data.email },
      }).catch(() => null);
      setMsg('Salvo.');
      await refreshRoles();
    } catch (err) {
      setMsg(`Erro: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !session) return;
    setSaving(true);
    setMsg(null);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `admin/${session.userId}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      // Cache-bust pra navegador pegar versao nova
      const url = `${pub.publicUrl}?v=${Date.now()}`;
      const { error: updErr } = await supabase
        .from('users')
        .update({ profile_photo_url: url })
        .eq('id', session.userId);
      if (updErr) throw updErr;
      setData((d) => (d ? { ...d, profile_photo_url: url } : d));

      // Atualiza a sessao em localStorage para a sidebar pegar na hora
      const stored = localStorage.getItem('fretego_admin_session');
      if (stored) {
        try {
          const s = JSON.parse(stored);
          s.photoUrl = url;
          localStorage.setItem('fretego_admin_session', JSON.stringify(s));
          // Dispara um storage event sintetico pra outros hooks reagirem
          window.dispatchEvent(new StorageEvent('storage', { key: 'fretego_admin_session' }));
        } catch {
          // ignore
        }
      }
      setMsg('Foto atualizada.');
    } catch (err) {
      setMsg(`Erro: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-gray-500">Carregando...</div>;
  }
  if (!data) {
    return <div className="text-gray-500">Perfil nao encontrado.</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Meu perfil</h1>
        <p className="text-sm text-gray-500 mt-1">
          Dados do administrador. Username e usado apenas para login.
        </p>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-gray-800 overflow-hidden flex items-center justify-center text-gray-400 text-2xl font-semibold">
            {data.profile_photo_url ? (
              <img
                src={data.profile_photo_url}
                alt="avatar"
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              (data.name || 'A').charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <label className="text-sm text-cyan-400 hover:text-cyan-300 cursor-pointer">
              Trocar foto
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
                disabled={saving}
              />
            </label>
            <p className="text-xs text-gray-500 mt-1">PNG, JPG, ate 2MB.</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Username (apenas para login)</label>
            <input
              type="text"
              value={data.admin_username ?? ''}
              disabled
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800/60 border border-gray-700 text-gray-500 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Nome</label>
            <input
              type="text"
              value={data.name}
              onChange={(e) => setData({ ...data, name: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">CPF</label>
            <input
              type="text"
              value={data.cpf ?? ''}
              onChange={(e) => setData({ ...data, cpf: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-cyan-500"
              placeholder="000.000.000-00"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={data.email ?? ''}
              onChange={(e) => setData({ ...data, email: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {msg && <div className="text-sm text-cyan-300">{msg}</div>}

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 text-white font-medium transition"
          >
            {saving ? 'Salvando...' : 'Salvar alteracoes'}
          </button>
        </form>
      </div>
    </div>
  );
}
