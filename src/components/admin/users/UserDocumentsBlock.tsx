/**
 * UserDocumentsBlock - lista documentos do usuario com aprovar/recusar.
 * - "Ver" abre um MODAL preso à tela (não nova aba), com botão de voltar.
 * - Aprovar/Recusar atualiza só o documento (sem recarregar a página).
 * A foto de perfil (profile_photo) NÃO entra na lista — é avatar.
 */

import { useEffect, useState } from 'react';
import {
  getDocumentSignedUrl,
  reviewDocument,
  USERS_ERROR_MESSAGES,
  UsersServiceError,
  type UserDocument,
} from '../../../services/admin/users';

interface Props {
  documents: UserDocument[];
  error?: string;
  canEdit?: boolean;
  /** Recarrega o bundle do usuário (rebusca documentos do servidor). */
  onReload?: () => void;
}

/** Agrupamento visual dos documentos no painel admin (ordem: Perfil → Tração → Carroceria). */
const DOC_GROUPS: { key: string; title: string; types: string[] }[] = [
  {
    key: 'perfil',
    title: 'Perfil',
    types: ['cnh', 'foto_segurando_cnh', 'comprovante_endereco_motorista'],
  },
  {
    key: 'tracao',
    title: 'Tração (cavalo)',
    types: ['crlv_cavalo', 'rntrc_cavalo', 'foto_frente_caminhao', 'foto_caminhao_completo'],
  },
  {
    key: 'carroceria',
    title: 'Carroceria',
    types: [
      'crlv_carreta_1',
      'rntrc_carreta_1',
      'crlv_carreta_2',
      'rntrc_carreta_2',
      'crlv_carreta_3',
      'rntrc_carreta_3',
      'crlv_carreta_4',
      'rntrc_carreta_4',
    ],
  },
];

/** Rótulo amigável por tipo de documento (igual ao que o motorista vê). */
const DOC_LABELS: Record<string, string> = {
  cnh: 'CNH',
  foto_segurando_cnh: 'Foto segurando CNH',
  comprovante_endereco_motorista: 'Comprovante de endereço',
  crlv_cavalo: 'CRLV do cavalo',
  rntrc_cavalo: 'ANTT (cavalo)',
  foto_frente_caminhao: 'Foto da frente',
  foto_caminhao_completo: 'Foto do conjunto',
  crlv_carreta_1: 'CRLV da carreta 1',
  rntrc_carreta_1: 'ANTT da carreta 1',
  crlv_carreta_2: 'CRLV da carreta 2',
  rntrc_carreta_2: 'ANTT da carreta 2',
  crlv_carreta_3: 'CRLV do Dolly',
  rntrc_carreta_3: 'ANTT do Dolly',
  crlv_carreta_4: 'CRLV da carreta 3',
  rntrc_carreta_4: 'ANTT da carreta 3',
  contrato_arrendamento: 'Contrato de arrendamento',
};

function docLabel(type: string): string {
  return DOC_LABELS[type] ?? type;
}

function statusBadge(status: string) {
  if (status === 'rejeitado')
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400">
        Recusado
      </span>
    );
  // Reenvio após recusa: aguarda decisão do admin (Aprovar/Recusar).
  if (status === 'pendente')
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-blue-400">
        Aguardando análise
      </span>
    );
  // Aprovação imediata: qualquer documento enviado e não recusado vale como OK.
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-400">
      Aprovado
    </span>
  );
}

/** Modal de visualização do documento (imagem ou PDF), preso ao viewport. */
function DocViewerModal({
  doc,
  url,
  loading,
  onClose,
}: {
  doc: UserDocument;
  url: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isPdf =
    (url ?? '').toLowerCase().includes('.pdf') || doc.file_name.toLowerCase().endsWith('.pdf');

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-3xl max-h-[90vh] bg-gray-900 border border-gray-700 rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho com voltar */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-800 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300"
          >
            ← Voltar
          </button>
          <span className="text-xs text-gray-400 truncate">{doc.document_type}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-gray-400 hover:text-white text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-auto bg-gray-950 flex items-center justify-center p-3">
          {loading ? (
            <p className="text-sm text-gray-400">Carregando documento...</p>
          ) : !url ? (
            <p className="text-sm text-red-400">Não foi possível carregar o documento.</p>
          ) : isPdf ? (
            <iframe title="Documento" src={url} className="w-full h-[75vh] rounded bg-white" />
          ) : (
            <img
              src={url}
              alt={doc.document_type}
              className="max-w-full max-h-[78vh] object-contain rounded"
              loading="lazy"
              decoding="async"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function UserDocumentsBlock({ documents, error, canEdit, onReload }: Props) {
  // Estado local dos documentos: permite atualizar o status sem recarregar a página.
  const [docs, setDocs] = useState<UserDocument[]>(
    documents.filter((d) => d.document_type !== 'profile_photo')
  );
  useEffect(() => {
    setDocs(documents.filter((d) => d.document_type !== 'profile_photo'));
  }, [documents]);

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Viewer modal
  const [viewerDoc, setViewerDoc] = useState<UserDocument | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  async function handleView(doc: UserDocument) {
    setViewerDoc(doc);
    setViewerUrl(null);
    setViewerLoading(true);
    const url = await getDocumentSignedUrl(doc.file_path);
    setViewerUrl(url);
    setViewerLoading(false);
  }

  async function handleReview(doc: UserDocument, approve: boolean) {
    if (busy) return;
    let reason: string | undefined;
    if (!approve) {
      reason = window.prompt('Motivo da recusa (opcional):') ?? undefined;
    }
    setBusy(doc.id);
    setMsg(null);
    try {
      const newStatus = await reviewDocument(doc.id, approve, reason);
      // Atualiza só este documento na lista (sem recarregar a página).
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, status: newStatus } : d)));
      setMsg(approve ? 'Documento aprovado.' : 'Documento recusado.');
      window.dispatchEvent(new CustomEvent('fretego-docs-reviewed'));
    } catch (err) {
      if (err instanceof UsersServiceError) setMsg(USERS_ERROR_MESSAGES[err.code]);
      else setMsg('Erro ao revisar documento.');
    } finally {
      setBusy(null);
    }
  }

  const rejectedCount = docs.filter((d) => d.status === 'rejeitado').length;

  // Renderiza uma linha de documento.
  const renderRow = (d: UserDocument) => (
    <li
      key={d.id}
      className="flex items-center justify-between gap-3 text-sm border border-gray-800 rounded-md px-3 py-2"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-gray-200 truncate">{docLabel(d.document_type)}</span>
          {statusBadge(d.status)}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {d.file_name} · {new Date(d.uploaded_at).toLocaleDateString('pt-BR')}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => handleView(d)}
          className="text-xs text-cyan-400 hover:text-cyan-300"
        >
          Ver
        </button>
        {/* Documento REENVIADO após recusa (status 'pendente'): aguarda decisão
            do admin — mostra Aprovar e Recusar. */}
        {canEdit && d.status === 'pendente' && (
          <button
            type="button"
            onClick={() => handleReview(d, true)}
            disabled={busy === d.id}
            className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
          >
            {busy === d.id ? '...' : 'Aprovar'}
          </button>
        )}
        {/* Documento vigente (aprovado por envio imediato OU reenvio pendente):
            o admin sempre pode RECUSAR se algo estiver errado. A versão já
            recusada (histórico) não recebe ação — fica como evidência. */}
        {canEdit && d.status !== 'rejeitado' && (
          <button
            type="button"
            onClick={() => handleReview(d, false)}
            disabled={busy === d.id}
            className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            {busy === d.id ? '...' : 'Recusar'}
          </button>
        )}
      </div>
    </li>
  );

  // Agrupa os documentos por área (Perfil → Tração → Carroceria) e mantém
  // qualquer tipo não mapeado num grupo "Outros" no fim.
  const usedTypes = new Set(DOC_GROUPS.flatMap((g) => g.types));
  const outros = docs.filter((d) => !usedTypes.has(d.document_type));

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">Documentos ({docs.length})</h3>
        <div className="flex items-center gap-2">
          {rejectedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/15 text-red-400">
              {rejectedCount} recusado{rejectedCount > 1 ? 's' : ''}
            </span>
          )}
          {onReload && (
            <button
              type="button"
              onClick={onReload}
              title="Recarregar documentos"
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              ↻ Atualizar
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-xs text-red-400 mb-2">Falha ao carregar documentos.</div>}
      {msg && <div className="text-xs text-cyan-300 mb-2">{msg}</div>}
      {docs.length === 0 && !error && (
        <div className="text-xs text-gray-500">Nenhum documento enviado.</div>
      )}

      <div className="space-y-4">
        {DOC_GROUPS.map((group) => {
          // Mantém a ordem definida em group.types e inclui TODAS as versões de
          // cada tipo (histórico de recusados + atual), recusados ao final por
          // data. Assim o admin vê o "lixo" acumulado.
          const groupDocs = group.types.flatMap((t) =>
            docs
              .filter((d) => d.document_type === t)
              .sort((a, b) => +new Date(a.uploaded_at) - +new Date(b.uploaded_at))
          );
          if (groupDocs.length === 0) return null;
          return (
            <div key={group.key}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
                {group.title}
              </p>
              <ul className="space-y-2">{groupDocs.map(renderRow)}</ul>
            </div>
          );
        })}

        {outros.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              Outros
            </p>
            <ul className="space-y-2">{outros.map(renderRow)}</ul>
          </div>
        )}
      </div>

      {viewerDoc && (
        <DocViewerModal
          doc={viewerDoc}
          url={viewerUrl}
          loading={viewerLoading}
          onClose={() => setViewerDoc(null)}
        />
      )}
    </section>
  );
}
