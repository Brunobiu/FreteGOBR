/**
 * MarketplacePostDetailPage — detalhe de um anúncio do Marketplace.
 *
 * Mostra a galeria (colagem → lightbox), a identidade do autor, o valor, há
 * quanto tempo foi anunciado, a localização e a descrição completa. O dono do
 * anúncio vê a ação "Remover anúncio". O envio de mensagem ao anunciante é
 * escopo futuro.
 *
 * Validates: Requirements 7.1-7.8, 8.4-8.8, 9.1-9.3, 11.1, 11.2
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getMarketplacePost, deleteMarketplacePost, type MarketplacePost } from '../services/marketplace';
import { formatBRL, formatRelativeAge } from '../utils/marketplacePost';
import { resolveProfilePhotoUrl } from '../services/documents';
import MarketplacePhotoCollage from '../components/marketplace/MarketplacePhotoCollage';
import MarketplaceLightbox from '../components/marketplace/MarketplaceLightbox';
import MotoristaBottomNav from '../components/MotoristaBottomNav';

export default function MarketplacePostDetailPage() {
  useDocumentTitle('Anúncio');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [post, setPost] = useState<MarketplacePost | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getMarketplacePost(id)
      .then((p) => {
        if (!cancelled) setPost(p);
      })
      .catch(() => {
        if (!cancelled) setPost(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    if (!post?.authorPhotoPath) {
      setAvatarUrl(null);
      return;
    }
    resolveProfilePhotoUrl(post.authorPhotoPath)
      .then((url) => {
        if (!cancelled) setAvatarUrl(url);
      })
      .catch(() => {
        if (!cancelled) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [post?.authorPhotoPath]);

  const isOwner = Boolean(user && post && user.id === post.authorId);

  async function handleRemove() {
    if (!post) return;
    if (typeof window !== 'undefined' && !window.confirm('Remover este anúncio?')) return;
    setRemoving(true);
    try {
      await deleteMarketplacePost(post.id);
      navigate('/motorista/marketplace');
    } catch {
      setRemoving(false);
    }
  }

  const initial = (post?.authorName || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-gray-100 pb-24">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center hover:bg-gray-200"
            aria-label="Voltar"
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900">Anúncio</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Carregando...</div>
        ) : !post ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
            <p className="text-sm text-gray-700 font-medium">Anúncio indisponível.</p>
            <p className="text-xs text-gray-500 mt-1">
              Ele pode ter sido removido pelo autor.
            </p>
            <button
              type="button"
              onClick={() => navigate('/motorista/marketplace')}
              className="mt-4 inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-full"
            >
              Voltar ao Marketplace
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Galeria (colagem → lightbox) */}
            <MarketplacePhotoCollage photoUrls={post.photoUrls} onOpen={setLightboxIndex} />

            {/* Autor */}
            <div className="flex items-center gap-2">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover bg-gray-200" />
              ) : (
                <span className="w-9 h-9 rounded-full bg-gray-200 text-gray-600 text-sm font-semibold flex items-center justify-center">
                  {initial}
                </span>
              )}
              <span className="text-sm font-medium text-gray-800">{post.authorName}</span>
            </div>

            {/* Título + valor */}
            <div>
              <h2 className="text-xl font-bold text-gray-900">{post.title}</h2>
              {post.price != null && (
                <p className="mt-0.5 text-lg font-semibold text-gray-900">{formatBRL(post.price)}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Anunciado {formatRelativeAge(new Date(post.createdAt), new Date())}
                {post.locationLabel ? ` · ${post.locationLabel}` : ''}
              </p>
            </div>

            {/* Descrição */}
            {post.description.trim().length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Descrição</h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{post.description}</p>
              </div>
            )}

            {/* Ação do dono */}
            {isOwner && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing}
                className="w-full py-2.5 rounded-full border border-red-300 text-red-600 hover:bg-red-50 text-sm font-semibold disabled:opacity-50"
              >
                {removing ? 'Removendo...' : 'Remover anúncio'}
              </button>
            )}
          </div>
        )}
      </main>

      {lightboxIndex !== null && post && (
        <MarketplaceLightbox
          photoUrls={post.photoUrls}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {user?.userType === 'motorista' && <MotoristaBottomNav />}
    </div>
  );
}
