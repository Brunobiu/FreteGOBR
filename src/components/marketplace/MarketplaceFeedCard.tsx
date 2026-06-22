/**
 * MarketplaceFeedCard — item do feed do Marketplace.
 *
 * Mostra a primeira foto do anúncio, o valor (quando houver) + título, uma
 * descrição curta (line-clamp 2 linhas) e a identidade do autor (foto + nome).
 * Ao tocar, navega para o detalhe do anúncio.
 *
 * Validates: Requirements 6.3, 6.4, 6.5, 6.6, 9.1, 9.2, 9.3, 9.4
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MarketplacePost } from '../../services/marketplace';
import { formatBRL } from '../../utils/marketplacePost';
import { resolveProfilePhotoUrl } from '../../services/documents';

interface Props {
  post: MarketplacePost;
}

export default function MarketplaceFeedCard({ post }: Props) {
  const navigate = useNavigate();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!post.authorPhotoPath) {
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
  }, [post.authorPhotoPath]);

  const cover = post.photoUrls[0] ?? null;
  const initial = (post.authorName || '?').trim().charAt(0).toUpperCase();

  return (
    <button
      type="button"
      onClick={() => navigate(`/motorista/marketplace/${post.id}`)}
      className="text-left bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-green-500"
      aria-label={`Abrir anúncio: ${post.title}`}
    >
      {/* Capa: primeira foto */}
      <div className="aspect-square bg-gray-100">
        {cover ? (
          <img
            src={cover}
            alt={post.title}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16v12H4z"
              />
            </svg>
          </div>
        )}
      </div>

      <div className="p-2.5">
        {/* Valor + título */}
        <p className="text-sm text-gray-900 leading-snug line-clamp-2">
          {post.price != null && (
            <span className="font-semibold">{formatBRL(post.price)} · </span>
          )}
          <span className={post.price != null ? '' : 'font-semibold'}>{post.title}</span>
        </p>

        {/* Descrição curta */}
        {post.description.trim().length > 0 && (
          <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{post.description}</p>
        )}

        {/* Identidade do autor */}
        <div className="mt-2 flex items-center gap-1.5">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="w-5 h-5 rounded-full object-cover bg-gray-200"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="w-5 h-5 rounded-full bg-gray-200 text-gray-600 text-[10px] font-semibold flex items-center justify-center">
              {initial}
            </span>
          )}
          <span className="text-[11px] text-gray-600 truncate">{post.authorName}</span>
        </div>
      </div>
    </button>
  );
}
