/**
 * UserDocumentsBlock - lista documentos do usuario.
 * URLs assinadas geradas sob demanda (TTL 10min).
 */

import { useState } from 'react';
import { supabase } from '../../../services/supabase';
import type { UserDocument } from '../../../services/admin/users';

interface Props {
  documents: UserDocument[];
  error?: string;
}

const SIGNED_URL_TTL_SEC = 600;

export default function UserDocumentsBlock({ documents, error }: Props) {
  const [signing, setSigning] = useState<string | null>(null);

  async function handleView(doc: UserDocument) {
    setSigning(doc.id);
    try {
      // documents.file_url contem o path no storage (bucket 'documents')
      // Para esta spec, abrimos o file_url direto se for publico,
      // ou geramos signed url do bucket 'documents' usando file_name como path.
      const { data } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.file_name, SIGNED_URL_TTL_SEC);
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank', 'noopener');
      }
    } catch {
      // ignore
    } finally {
      setSigning(null);
    }
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Documentos ({documents.length})</h3>
      {error && <div className="text-xs text-red-400 mb-2">Falha ao carregar documentos.</div>}
      {documents.length === 0 && !error && (
        <div className="text-xs text-gray-500">Nenhum documento enviado.</div>
      )}
      <ul className="space-y-2">
        {documents.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="text-gray-200 truncate">{d.file_name}</div>
              <div className="text-xs text-gray-500">
                {d.document_type} · {new Date(d.uploaded_at).toLocaleDateString('pt-BR')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleView(d)}
              disabled={signing === d.id}
              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
            >
              {signing === d.id ? 'Abrindo...' : 'Ver'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
